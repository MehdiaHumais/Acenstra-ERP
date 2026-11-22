import { NextRequest } from "next/server";
import { getDb } from "@/server/db/connection";
import {
  createRefreshToken,
  hashPassword,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserRefreshTokens,
  sha256Hex,
  signAccessToken,
  signMfaChallengeToken,
  signSessionToken,
  verifyAccessToken,
  verifyMfaChallengeToken,
  verifyPassword,
  verifySessionToken
} from "@/server/security/crypto";
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  generateTotpUri,
  verifyAndBurnRecoveryCode,
  verifyTotpCode
} from "@/server/security/totp";
import { ApiError } from "@/server/core/http";

export type UserRole =
  | "super_admin"
  | "company_admin"
  | "warehouse_manager"
  | "picker"
  | "driver"
  | "finance"
  | "sales"
  | "qa"
  | "qa_inspector"
  | "qa_manager"
  | "store_vendor"
  | "store_owner"
  | "store_manager"
  | "store_staff"
  | "ceo"
  // Legacy aliases for backward compatibility
  | "administrator"
  | "management"
  | "procurement"
  | "warehouse_staff"
  | "store_user"
  // Never an assignable role; used only for unidentifiable barcode scans in audit logs
  | "anonymous";

/**
 * Normalizes a stored/legacy role string to a canonical role code.
 *
 * Unknown non-empty codes are preserved as-is so custom roles created through
 * the access-control UI can be resolved from the database. An empty role is
 * treated as the least-privilege operational role instead of silently becoming
 * Super Admin (deny-by-default).
 */
export function normalizeRole(role: string): UserRole {
  const clean = (role || "").toLowerCase().trim();
  if (!clean) return "picker";
  if (clean === "super_admin" || clean === "super-admin" || clean === "administrator" || clean === "admin") {
    return "super_admin";
  }
  if (clean === "company_admin" || clean === "company-admin" || clean === "companyadmin") return "company_admin";
  if (clean === "warehouse_staff" || clean === "warehouse-staff") return "warehouse_staff";
  if (clean === "warehouse_manager" || clean === "warehouse") return "warehouse_manager";
  if (clean === "picker" || clean === "warehouse_operator" || clean === "warehouse_op" || clean === "operator") {
    return "picker";
  }
  if (clean === "driver") return "driver";
  if (clean === "finance" || clean === "finance_manager" || clean === "accountant") return "finance";
  if (clean === "sales" || clean === "sales_manager" || clean === "sales_staff" || clean === "salesperson") {
    return "sales";
  }
  if (clean === "procurement" || clean === "procurement_officer" || clean === "purchasing") return "procurement";
  if (clean === "qa_inspector" || clean === "quality_inspector") return "qa_inspector";
  if (clean === "qa_manager" || clean === "quality_manager") return "qa_manager";
  if (clean === "qa" || clean === "quality") return "qa";
  if (clean === "store_owner") return "store_owner";
  if (clean === "store_manager") return "store_manager";
  if (clean === "store_staff") return "store_staff";
  if (clean === "store_vendor" || clean === "store_user" || clean === "vendor") return "store_vendor";
  if (clean === "ceo" || clean === "management" || clean === "executive") return "ceo";
  // Custom role codes must survive normalization so DB-backed permissions apply.
  return clean as UserRole;
}

export function isStoreScopedRole(role?: string | null): boolean {
  const r = (role || "").toLowerCase().trim();
  return (
    r === "store_vendor" ||
    r === "store_user" ||
    r === "store_owner" ||
    r === "store_manager" ||
    r === "store_staff" ||
    r === "vendor"
  );
}

export type Permission =
  // Primary granular permissions (dot format)
  | "users.read"
  | "users.manage"
  | "roles.manage"
  | "settings.manage"
  | "products.read"
  | "products.manage"
  | "inventory.read"
  | "inventory.adjust"
  | "inventory.pick"
  | "inventory.reserve"
  | "inventory.count"
  | "inventory.approve_adjustment"
  | "purchase_orders.read"
  | "purchase_orders.manage"
  | "orders.read"
  | "orders.manage"
  | "deliveries.read"
  | "deliveries.update_assigned"
  | "invoices.read"
  | "invoices.manage"
  | "payments.record"
  | "quality_checks.manage"
  | "quality.read"
  | "quality.inspect"
  | "quality.decide"
  | "quality.capa"
  | "putaway.read"
  | "putaway.execute"
  | "putaway.manage"
  | "putaway.override"
  | "recalls.manage"
  | "audit.read"
  | "reports.executive.read"
  | "ai.recommendations.read"
  | "ai.actions.approve"
  | "stores.read"
  | "stores.manage"
  | "stores.consolidated.read"
  | "stores.export"
  | "stores.pos.manage"
  | "stores.consumption.manage"
  // Legacy colon permissions (for existing API routes and frontend components)
  | "dashboard:read"
  | "products:read"
  | "products:write"
  | "suppliers:read"
  | "suppliers:write"
  | "procurement:receive"
  | "inventory:read"
  | "inventory:adjust"
  | "warehouse:read"
  | "warehouse:update"
  | "orders:read"
  | "orders:write"
  | "orders:credit_override"
  | "deliveries:read"
  | "deliveries:update"
  | "traceability:read"
  | "traceability:quarantine"
  | "inbound.read"
  | "inbound.manage"
  | "inbound.arrival"
  | "inbound.receive"
  | "inbound.temperature"
  | "inbound.quality"
  | "inbound.documents"
  | "inbound.decision"
  | "inbound.driver_update"
  | "finance:read"
  | "finance:sdi"
  | "finance:payment"
  | "finance:invoice"
  | "finance:reconcile"
  | "finance:landed_cost"
  | "stores:read"
  | "stores:update"
  | "ai:read"
  | "ai:approve"
  | "audit:read"
  // Dynamic permission codes (custom roles and future modules)
  | (string & {});

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  // Anonymous barcode identity used only in audit logs; grants nothing.
  anonymous: [],
  // 1. Super Admin: Full system authorization across all models & operations
  super_admin: [
    "users.read",
    "users.manage",
    "roles.manage",
    "settings.manage",
    "products.read",
    "products.manage",
    "inventory.read",
    "inventory.adjust",
    "inventory.pick",
    "inventory.reserve",
    "inventory.count",
    "inventory.approve_adjustment",
    "purchase_orders.read",
    "purchase_orders.manage",
    "orders.read",
    "orders.manage",
    "deliveries.read",
    "deliveries.update_assigned",
    "invoices.read",
    "invoices.manage",
    "payments.record",
    "quality_checks.manage",
    "quality.read",
    "putaway.read",
    "quality.inspect",
    "quality.decide",
    "quality.capa",
    "putaway.read",
    "putaway.execute",
    "putaway.manage",
    "putaway.override",
    "recalls.manage",
    "audit.read",
    "reports.executive.read",
    "ai.recommendations.read",
    "ai.actions.approve",
    // Legacy mapping
    "dashboard:read",
    "products:read",
    "products:write",
    "suppliers:read",
    "suppliers:write",
    "procurement:receive",
    "inventory:read",
    "inventory:adjust",
    "warehouse:read",
    "warehouse:update",
    "orders:read",
    "orders:write",
    "orders:credit_override",
    "deliveries:read",
    "deliveries:update",
    "traceability:read",
    "traceability:quarantine",
    "finance:read",
    "finance:sdi",
    "finance:payment",
    "finance:invoice",
    "finance:reconcile",
    "finance:landed_cost",
    "stores:read",
    "stores:update",
    "stores.read",
    "stores.manage",
    "stores.consolidated.read",
    "stores.export",
    "stores.pos.manage",
    "stores.consumption.manage",
    "ai:read",
    "ai:approve",
    "audit:read",
    "inbound.read",
    "inbound.manage",
    "inbound.arrival",
    "inbound.receive",
    "inbound.temperature",
    "inbound.quality",
    "inbound.documents",
    "inbound.decision",
    "inbound.driver_update"
  ],

  // Company Admin: full company operations, users/roles and settings, but no
  // platform ownership or Super Admin escalation (enforced in access control).
  company_admin: [
    "users.read",
    "users.manage",
    "roles.manage",
    "permissions.manage",
    "settings.manage",
    "approvals.manage",
    "products.read",
    "products.manage",
    "inventory.read",
    "inventory.adjust",
    "inventory.pick",
    "inventory.reserve",
    "inventory.count",
    "inventory.approve_adjustment",
    "purchase_orders.read",
    "purchase_orders.manage",
    "orders.read",
    "orders.manage",
    "deliveries.read",
    "deliveries.update_assigned",
    "invoices.read",
    "invoices.manage",
    "payments.record",
    "quality_checks.manage",
    "quality.read",
    "quality.inspect",
    "quality.decide",
    "quality.capa",
    "putaway.read",
    "putaway.execute",
    "putaway.manage",
    "putaway.override",
    "recalls.manage",
    "audit.read",
    "reports.executive.read",
    "ai.recommendations.read",
    "ai.actions.approve",
    "stores.read",
    "stores.manage",
    "stores.consolidated.read",
    "stores.export",
    "module.commercial",
    "module.warehouse",
    "module.catalog",
    "module.finance",
    "module.settings",
    // Legacy colon aliases
    "dashboard:read",
    "products:read",
    "products:write",
    "suppliers:read",
    "suppliers:write",
    "procurement:receive",
    "inventory:read",
    "inventory:adjust",
    "warehouse:read",
    "warehouse:update",
    "orders:read",
    "orders:write",
    "orders:credit_override",
    "deliveries:read",
    "deliveries:update",
    "traceability:read",
    "traceability:quarantine",
    "finance:read",
    "finance:sdi",
    "finance:payment",
    "finance:invoice",
    "finance:reconcile",
    "finance:landed_cost",
    "stores:read",
    "stores:update",
    "ai:read",
    "ai:approve",
    "audit:read",
    "inbound.read",
    "inbound.manage",
    "inbound.arrival",
    "inbound.receive",
    "inbound.temperature",
    "inbound.quality",
    "inbound.documents",
    "inbound.decision",
    "inbound.driver_update"
  ],
  administrator: [
    "users.read",
    "users.manage",
    "roles.manage",
    "settings.manage",
    "products.read",
    "products.manage",
    "inventory.read",
    "inventory.adjust",
    "inventory.pick",
    "inventory.reserve",
    "inventory.count",
    "inventory.approve_adjustment",
    "purchase_orders.read",
    "purchase_orders.manage",
    "orders.read",
    "orders.manage",
    "deliveries.read",
    "deliveries.update_assigned",
    "invoices.read",
    "invoices.manage",
    "payments.record",
    "quality_checks.manage",
    "quality.read",
    "putaway.read",
    "quality.inspect",
    "quality.decide",
    "quality.capa",
    "putaway.read",
    "putaway.execute",
    "putaway.manage",
    "putaway.override",
    "recalls.manage",
    "audit.read",
    "reports.executive.read",
    "ai.recommendations.read",
    "ai.actions.approve",
    "dashboard:read",
    "products:read",
    "products:write",
    "suppliers:read",
    "suppliers:write",
    "procurement:receive",
    "inventory:read",
    "inventory:adjust",
    "warehouse:read",
    "warehouse:update",
    "orders:read",
    "orders:write",
    "orders:credit_override",
    "deliveries:read",
    "deliveries:update",
    "traceability:read",
    "traceability:quarantine",
    "finance:read",
    "finance:sdi",
    "finance:payment",
    "finance:invoice",
    "finance:reconcile",
    "finance:landed_cost",
    "stores:read",
    "stores:update",
    "stores.read",
    "stores.manage",
    "stores.consolidated.read",
    "stores.export",
    "stores.pos.manage",
    "stores.consumption.manage",
    "ai:read",
    "ai:approve",
    "audit:read",
    "inbound.read",
    "inbound.manage",
    "inbound.arrival",
    "inbound.receive",
    "inbound.temperature",
    "inbound.quality",
    "inbound.documents",
    "inbound.decision",
    "inbound.driver_update"
  ],

  // 2. Warehouse Manager: Full warehouse operations, inventory adjustments, PO receipt, fulfilment (cannot bypass QA decision)
  warehouse_manager: [
    "inventory.read",
    "inventory.adjust",
    "inventory.pick",
    "inventory.reserve",
    "inventory.count",
    "inventory.approve_adjustment",
    "products.read",
    "purchase_orders.read",
    "purchase_orders.manage",
    "orders.read",
    "orders.manage",
    "deliveries.read",
    "deliveries.update_assigned",
    "invoices.read",
    "quality_checks.manage",
    "quality.read",
    "putaway.read",
    "quality.capa",
    "putaway.read",
    "putaway.execute",
    "putaway.manage",
    "putaway.override",
    "recalls.manage",
    "audit.read",
    "ai.recommendations.read",
    "ai.actions.approve",
    "dashboard:read",
    "products:read",
    "procurement:receive",
    "inventory:read",
    "inventory:adjust",
    "warehouse:read",
    "warehouse:update",
    "orders:read",
    "deliveries:read",
    "deliveries:update",
    "traceability:read",
    "traceability:quarantine",
    "ai:read",
    "ai:approve",
    "audit:read",
    "inbound.read",
    "inbound.manage",
    "inbound.arrival",
    "inbound.receive",
    "inbound.temperature",
    "inbound.documents",
    "inbound.decision"
  ],
  warehouse_staff: [
    "inventory.read",
    "inventory.adjust",
    "inventory.pick",
    "inventory.reserve",
    "inventory.count",
    "products.read",
    "purchase_orders.read",
    "orders.read",
    "deliveries.read",
    "deliveries.update_assigned",
    "quality_checks.manage",
    "quality.read",
    "putaway.read",
    "quality.capa",
    "putaway.read",
    "putaway.execute",
    "dashboard:read",
    "products:read",
    "procurement:receive",
    "inventory:read",
    "inventory:adjust",
    "warehouse:read",
    "warehouse:update",
    "traceability:read",
    "traceability:quarantine",
    "inbound.read",
    "inbound.receive",
    "inbound.temperature",
    "inbound.documents"
  ],

  // 3. Picker: Picking tasks within assigned warehouse, view inventory & picking status, execute assigned put-away
  picker: [
    "inventory.read",
    "inventory.pick",
    "inventory.count",
    "orders.read",
    "deliveries.read",
    "quality.read",
    "putaway.read",
    "putaway.read",
    "putaway.execute",
    "audit.read",
    "dashboard:read",
    "products:read",
    "inventory:read",
    "warehouse:read",
    "warehouse:update",
    "orders:read",
    "inbound.read"
  ],

  // 4. Driver: Assigned deliveries, delivery status updates, arrival temperature logs
  driver: [
    "deliveries.read",
    "deliveries.update_assigned",
    "orders.read",
    "audit.read",
    "dashboard:read",
    "deliveries:read",
    "deliveries:update",
    "warehouse:read",
    "inbound.read",
    "inbound.driver_update"
  ],

  // 5. Finance: Full invoice lifecycle, payment recording, read-only commercial data, finance AI
  finance: [
    "invoices.read",
    "invoices.manage",
    "payments.record",
    "orders.read",
    "purchase_orders.read",
    "inventory.read",
    "inventory.approve_adjustment",
    "quality.read",
    "putaway.read",
    "audit.read",
    "ai.recommendations.read",
    "ai.actions.approve",
    "dashboard:read",
    "orders:read",
    "orders:credit_override",
    "finance:read",
    "finance:sdi",
    "finance:payment",
    "finance:invoice",
    "finance:reconcile",
    "finance:landed_cost",
    "stores:read",
    "stores.read",
    "stores.consolidated.read",
    "stores.export",
    "audit:read",
    "ai:read",
    "inbound.read"
  ],

  // 6. Sales: Orders management, customer pricing, authorized POs, deliveries visibility
  sales: [
    "orders.read",
    "orders.manage",
    "inventory.reserve",
    "purchase_orders.read",
    "products.read",
    "inventory.read",
    "quality.read",
    "putaway.read",
    "deliveries.read",
    "invoices.read",
    "audit.read",
    "ai.recommendations.read",
    "ai.actions.approve",
    "dashboard:read",
    "products:read",
    "inventory:read",
    "orders:read",
    "orders:write",
    "deliveries:read",
    "stores:read",
    "stores:update",
    "stores.read",
    "stores.consolidated.read",
    "stores.export",
    "ai:read",
    "inbound.read"
  ],
  procurement: [
    "products.read",
    "products.manage",
    "purchase_orders.read",
    "purchase_orders.manage",
    "inventory.read",
    "quality.read",
    "putaway.read",
    "audit.read",
    "ai.recommendations.read",
    "dashboard:read",
    "products:read",
    "products:write",
    "suppliers:read",
    "suppliers:write",
    "procurement:receive",
    "inventory:read",
    "traceability:read",
    "ai:read",
    "inbound.read",
    "inbound.manage",
    "inbound.arrival",
    "inbound.receive",
    "inbound.temperature",
    "inbound.quality",
    "inbound.documents",
    "inbound.decision"
  ],

  // 7. QA / QA Manager / QA Inspector: Quality checks, HACCP, hold/release/reject decisions, CAPA, recalls
  qa: [
    "quality_checks.manage",
    "quality.read",
    "putaway.read",
    "quality.inspect",
    "quality.decide",
    "quality.capa",
    "putaway.read",
    "putaway.execute",
    "putaway.manage",
    "putaway.override",
    "recalls.manage",
    "inventory.read",
    "inventory.adjust",
    "inventory.approve_adjustment",
    "products.read",
    "purchase_orders.read",
    "orders.read",
    "deliveries.read",
    "audit.read",
    "ai.recommendations.read",
    "ai.actions.approve",
    "dashboard:read",
    "products:read",
    "inventory:read",
    "traceability:read",
    "traceability:quarantine",
    "audit:read",
    "ai:read",
    "ai:approve",
    "inbound.read",
    "inbound.quality",
    "inbound.documents",
    "inbound.decision",
    "inbound.temperature"
  ],
  qa_manager: [
    "quality_checks.manage",
    "quality.read",
    "putaway.read",
    "quality.inspect",
    "quality.decide",
    "quality.capa",
    "putaway.read",
    "putaway.execute",
    "putaway.manage",
    "putaway.override",
    "recalls.manage",
    "inventory.read",
    "inventory.adjust",
    "inventory.approve_adjustment",
    "products.read",
    "purchase_orders.read",
    "orders.read",
    "deliveries.read",
    "audit.read",
    "ai.recommendations.read",
    "ai.actions.approve",
    "dashboard:read",
    "products:read",
    "inventory:read",
    "traceability:read",
    "traceability:quarantine",
    "audit:read",
    "ai:read",
    "ai:approve",
    "inbound.read",
    "inbound.quality",
    "inbound.documents",
    "inbound.decision",
    "inbound.temperature"
  ],
  qa_inspector: [
    "quality_checks.manage",
    "quality.read",
    "putaway.read",
    "quality.inspect",
    "quality.capa",
    "inventory.read",
    "products.read",
    "purchase_orders.read",
    "orders.read",
    "deliveries.read",
    "audit.read",
    "dashboard:read",
    "products:read",
    "inventory:read",
    "traceability:read",
    "audit:read",
    "inbound.read",
    "inbound.quality",
    "inbound.documents",
    "inbound.temperature"
  ],

  // 8. Store Vendor / Store Owner / Store Manager / Store Staff: Strictly scoped to own store
  store_vendor: [
    "orders.read",
    "orders.manage",
    "deliveries.read",
    "invoices.read",
    "payments.record",
    "products.read",
    "dashboard:read",
    "products:read",
    "orders:read",
    "orders:write",
    "deliveries:read",
    "stores.read"
  ],
  store_owner: [
    "orders.read",
    "orders.manage",
    "inventory.read",
    "inventory.adjust",
    "deliveries.read",
    "invoices.read",
    "payments.record",
    "products.read",
    "audit.read",
    "dashboard:read",
    "products:read",
    "orders:read",
    "orders:write",
    "deliveries:read",
    "stores:read",
    "stores:update",
    "stores.read",
    "stores.export",
    "stores.pos.manage",
    "stores.consumption.manage"
  ],
  store_manager: [
    "orders.read",
    "orders.manage",
    "inventory.read",
    "inventory.adjust",
    "deliveries.read",
    "invoices.read",
    "products.read",
    "dashboard:read",
    "products:read",
    "orders:read",
    "orders:write",
    "deliveries:read",
    "stores:read",
    "stores.read",
    "stores.export",
    "stores.pos.manage",
    "stores.consumption.manage"
  ],
  store_staff: [
    "orders.read",
    "inventory.read",
    "deliveries.read",
    "products.read",
    "dashboard:read",
    "products:read",
    "orders:read",
    "deliveries:read",
    "stores:read",
    "stores.read"
  ],
  store_user: [
    "orders.read",
    "orders.manage",
    "inventory.read",
    "deliveries.read",
    "invoices.read",
    "payments.record",
    "products.read",
    "dashboard:read",
    "products:read",
    "orders:read",
    "orders:write",
    "deliveries:read",
    "stores:read",
    "stores.read",
    "stores.export"
  ],

  // 9. CEO: Executive reporting and read-only visibility across all modules
  ceo: [
    "reports.executive.read",
    "users.read",
    "products.read",
    "inventory.read",
    "purchase_orders.read",
    "orders.read",
    "deliveries.read",
    "invoices.read",
    "audit.read",
    "ai.recommendations.read",
    "dashboard:read",
    "products:read",
    "suppliers:read",
    "inventory:read",
    "warehouse:read",
    "orders:read",
    "orders:credit_override",
    "deliveries:read",
    "traceability:read",
    "finance:read",
    "stores:read",
    "stores.read",
    "stores.consolidated.read",
    "stores.export",
    "ai:read",
    "audit:read",
    "inbound.read",
    "quality.read",
    "putaway.read"
  ],
  management: [
    "reports.executive.read",
    "users.read",
    "products.read",
    "inventory.read",
    "purchase_orders.read",
    "orders.read",
    "deliveries.read",
    "invoices.read",
    "audit.read",
    "ai.recommendations.read",
    "dashboard:read",
    "products:read",
    "suppliers:read",
    "inventory:read",
    "warehouse:read",
    "orders:read",
    "orders:credit_override",
    "deliveries:read",
    "traceability:read",
    "finance:read",
    "stores:read",
    "stores.read",
    "stores.consolidated.read",
    "stores.export",
    "ai:read",
    "audit:read",
    "inbound.read",
    "quality.read",
    "putaway.read"
  ]
};

// ---------------------------------------------------------------------------
// Module permissions + granular action permissions added on top of the
// historical role templates. Keeping this as an additive map preserves all
// existing integrations while enabling the five required navigation groups and
// the explicit action/approval model.
// ---------------------------------------------------------------------------

const ROLE_PERMISSION_EXTRAS: Record<string, string[]> = {
  super_admin: [
    "module.commercial",
    "module.warehouse",
    "module.catalog",
    "module.finance",
    "module.settings",
    "users.create",
    "users.edit",
    "users.suspend",
    "users.delete",
    "roles.read",
    "permissions.manage",
    "approvals.manage",
    "audit.security.read",
    "integrations.manage",
    "ai.configure",
    "exports.run",
    "bulk.run",
    "jobs.run"
  ],
  company_admin: [
    "users.create",
    "users.edit",
    "users.suspend",
    "users.delete",
    "roles.read",
    "audit.security.read",
    "exports.run",
    "bulk.run",
    "jobs.run",
    "orders.create",
    "orders.approve",
    "orders.amend",
    "orders.cancel",
    "procurement.po.approve",
    "finance.credit_limit.approve",
    "finance.refund.approve",
    "quality.release.approve",
    "recall.activate"
  ],
  administrator: ["module.commercial", "module.warehouse", "module.catalog", "module.finance", "module.settings"],
  ceo: [
    "module.commercial",
    "module.warehouse",
    "module.catalog",
    "module.finance",
    "orders.approve",
    "finance.credit_limit.approve",
    "quality.release.approve",
    "ai.actions.approve"
  ],
  management: ["module.commercial", "module.warehouse", "module.catalog", "module.finance"],
  sales: [
    "module.commercial",
    "orders.create",
    "orders.amend",
    "orders.cancel",
    "finance.credit_limit.approve",
    "exports.run"
  ],
  procurement: [
    "module.catalog",
    "module.warehouse",
    "procurement.po.create",
    "procurement.po.approve",
    "supplier.manage",
    "exports.run"
  ],
  warehouse_manager: [
    "module.warehouse",
    "module.catalog",
    "inventory.stock_count",
    "inventory.adjust.approve",
    "deliveries.assign"
  ],
  warehouse_staff: ["module.warehouse", "inventory.stock_count"],
  picker: ["module.warehouse", "inventory.adjust.approve"],
  driver: [
    "module.warehouse",
    "deliveries.pod.capture",
    "deliveries.temperature.record"
  ],
  qa: [
    "module.warehouse",
    "module.catalog",
    "quality.inspection.create",
    "quality.release.approve",
    "recall.activate"
  ],
  qa_manager: ["module.warehouse", "module.catalog", "quality.inspection.create", "quality.release.approve", "recall.activate"],
  qa_inspector: ["module.warehouse", "module.catalog", "quality.inspection.create"],
  finance: [
    "module.finance",
    "module.commercial",
    "finance.invoice.create",
    "finance.payment.record",
    "finance.payment.approve",
    "finance.refund.approve",
    "finance.credit_limit.approve",
    "exports.run"
  ],
  store_vendor: ["module.commercial", "orders.create", "orders.cancel"],
  store_owner: ["module.commercial", "orders.create"],
  store_manager: ["module.commercial", "orders.create"],
  store_staff: ["module.commercial"],
  store_user: ["module.commercial", "orders.create"]
};

for (const [roleCode, extras] of Object.entries(ROLE_PERMISSION_EXTRAS)) {
  const key = roleCode as UserRole;
  const existing = ROLE_PERMISSIONS[key];
  if (existing) {
    ROLE_PERMISSIONS[key] = Array.from(new Set([...existing, ...extras]));
  }
}

export interface UserScopeSet {
  company: string[];
  warehouse: string[];
  store: string[];
  customer: string[];
  supplier: string[];
  delivery: string[];
  task: string[];
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  roles?: UserRole[];
  store_id?: string | null;
  warehouse?: string | null;
  assignedWarehouse?: string | null;
  permissions?: string[];
  permission_denies?: string[];
  scopes?: UserScopeSet;
  mfa_enabled?: boolean;
  active?: boolean;
}

const DEFAULT_ADMIN: AuthenticatedUser = {
  id: "USR-ADMIN",
  email: "elena.conti@ascentra.it",
  name: "Elena Conti",
  role: "super_admin",
  roles: ["super_admin"],
  store_id: null,
  warehouse: "Milan Cold Hub",
  mfa_enabled: false
};

export function getDefaultAdminUser(): AuthenticatedUser {
  return DEFAULT_ADMIN;
}

// ============================================================================
// Persisted RBAC engine: roles, granular permissions, user assignments,
// per-user overrides, data scopes and configurable approval authority.
// ============================================================================

export const RBAC_SEED_VERSION = "2026.11-rbac-v5";

export interface PermissionDescriptor {
  code: string;
  module: string;
  action: string;
  label: string;
  description: string;
  sensitive: boolean;
}

export const RBAC_MODULES: Array<{ code: string; name: string; description: string }> = [
  {
    code: "module.commercial",
    name: "Commercial & Portals",
    description: "Overview, customer orders, B2B portal and store/vendor accounts."
  },
  {
    code: "module.warehouse",
    name: "Warehouse & Logistics",
    description: "Inbound quality, put-away, picking, inventory, FEFO and deliveries."
  },
  {
    code: "module.catalog",
    name: "Catalog, Supply & Safety",
    description: "Products, procurement, suppliers, traceability, recalls and quality."
  },
  {
    code: "module.finance",
    name: "Finance & Management",
    description: "Invoices, SdI, payments, margins, executive reporting and AI insights."
  },
  {
    code: "module.settings",
    name: "Settings & Architecture",
    description: "Users, roles, permissions, scopes, security events and platform settings."
  }
];

export interface SystemRoleDefinition {
  code: UserRole;
  name: string;
  description: string;
  roleType: "system" | "custom";
  protected: boolean;
  baseRole?: string;
}

export const SYSTEM_ROLE_DEFINITIONS: SystemRoleDefinition[] = [
  {
    code: "super_admin",
    name: "Super Admin",
    description: "Full ERP access, all modules/records, user and role administration, integrations, AI/OmniRoute and security audit. Historical financial records, stock movements and audit logs remain immutable and traceable.",
    roleType: "system",
    protected: true
  },
  {
    code: "company_admin",
    name: "Company Admin",
    description: "Manages company users, roles, customers, suppliers, operations and settings. Cannot alter platform ownership or protected Super Admin controls.",
    roleType: "system",
    protected: true
  },
  {
    code: "ceo",
    name: "CEO / Executive",
    description: "Executive dashboards, financial and operational reports, AI insights and assigned approvals. Read-only outside explicit approval authority.",
    roleType: "system",
    protected: true
  },
  {
    code: "sales",
    name: "Sales Manager / Sales Staff",
    description: "Customer records, orders, B2B portal support, authorized pricing/credit visibility and sales reporting.",
    roleType: "system",
    protected: false
  },
  {
    code: "procurement",
    name: "Procurement Officer",
    description: "Suppliers, purchase orders, procurement records, supplier performance and inbound shipment information.",
    roleType: "system",
    protected: false
  },
  {
    code: "warehouse_manager",
    name: "Warehouse Manager",
    description: "Warehouse operations, put-away, inventory, picking, packing, stock counts, assignments and operational reports.",
    roleType: "system",
    protected: false
  },
  {
    code: "picker",
    name: "Warehouse Operator / Picker",
    description: "Assigned put-away, picking, packing, scanning and stock movement tasks. No unrestricted stock adjustments or QA releases.",
    roleType: "system",
    protected: false
  },
  {
    code: "qa",
    name: "QA Manager / Inspector",
    description: "Quality inspections, HACCP, temperature exceptions, quarantine, release approvals, CAPA and traceability/recall investigation.",
    roleType: "system",
    protected: false
  },
  {
    code: "finance",
    name: "Finance Manager / Accountant",
    description: "Invoices, payments, bank reconciliation, SDI/FatturaPA, receivables, expenses, landed costs and financial reports.",
    roleType: "system",
    protected: false
  },
  {
    code: "driver",
    name: "Driver",
    description: "Assigned deliveries only: loading confirmation, vehicle temperature, delivery exceptions and Proof of Delivery.",
    roleType: "system",
    protected: false
  },
  {
    code: "store_vendor",
    name: "Store / Vendor User",
    description: "Own store/customer account only: orders, purchases, invoices, spending and available store analytics.",
    roleType: "system",
    protected: false
  }
];

const RBAC_MODULE_PREFIX: Record<string, string> = {
  module: "Settings & Architecture",
  users: "Settings & Architecture",
  roles: "Settings & Architecture",
  permissions: "Settings & Architecture",
  settings: "Settings & Architecture",
  audit: "Settings & Architecture",
  approvals: "Settings & Architecture",
  integrations: "Settings & Architecture",
  security: "Settings & Architecture",
  exports: "Settings & Architecture",
  bulk: "Settings & Architecture",
  jobs: "Settings & Architecture",
  dashboard: "Commercial & Portals",
  orders: "Commercial & Portals",
  stores: "Commercial & Portals",
  store: "Commercial & Portals",
  inventory: "Warehouse & Logistics",
  warehouse: "Warehouse & Logistics",
  putaway: "Warehouse & Logistics",
  deliveries: "Warehouse & Logistics",
  inbound: "Warehouse & Logistics",
  products: "Catalog, Supply & Safety",
  suppliers: "Catalog, Supply & Safety",
  purchase_orders: "Catalog, Supply & Safety",
  procurement: "Catalog, Supply & Safety",
  quality: "Catalog, Supply & Safety",
  quality_checks: "Catalog, Supply & Safety",
  traceability: "Catalog, Supply & Safety",
  recalls: "Catalog, Supply & Safety",
  invoices: "Finance & Management",
  payments: "Finance & Management",
  finance: "Finance & Management",
  reports: "Finance & Management",
  ai: "Finance & Management"
};

function describePermission(code: string): PermissionDescriptor {
  if (code === "*") {
    return {
      code,
      module: "Settings & Architecture",
      action: "all",
      label: "Full system access",
      description: "Unrestricted access to every module, action and record (Super Admin).",
      sensitive: true
    };
  }
  const moduleDef = RBAC_MODULES.find((m) => m.code === code);
  if (moduleDef) {
    return {
      code,
      module: moduleDef.name,
      action: "access",
      label: moduleDef.name,
      description: moduleDef.description,
      sensitive: false
    };
  }
  const [prefix, ...rest] = code.replace(":", ".").split(".");
  const action = rest.join(".") || "access";
  const moduleName = RBAC_MODULE_PREFIX[prefix] ?? "Settings & Architecture";
  const humanAction = action.replace(/[._]/g, " ");
  return {
    code,
    module: moduleName,
    action,
    label: `${prefix.replace(/[._]/g, " ")} ${humanAction}`.replace(/\b\w/g, (c) => c.toUpperCase()),
    description: `Allows '${code}' within ${moduleName}.`,
    sensitive: /approve|override|delete|adjust|manage|recall|credit|refund|configure|suspend/i.test(code)
  };
}

export function buildPermissionCatalog(): PermissionDescriptor[] {
  const codes = new Set<string>(["*", ...RBAC_MODULES.map((m) => m.code)]);
  for (const list of Object.values(ROLE_PERMISSIONS)) {
    for (const code of list) codes.add(code);
  }
  return Array.from(codes).sort().map(describePermission);
}

export const DEFAULT_APPROVAL_THRESHOLDS: Array<{
  actionCode: string;
  label: string;
  amountCents: number | null;
  requiresPermission: string;
  makerChecker: boolean;
}> = [
  {
    actionCode: "purchase_order.approve",
    label: "Purchase order approval",
    amountCents: 500000,
    requiresPermission: "procurement.po.approve",
    makerChecker: true
  },
  {
    actionCode: "inventory.adjust.approve",
    label: "Stock adjustment approval",
    amountCents: 0,
    requiresPermission: "inventory.adjust.approve",
    makerChecker: true
  },
  {
    actionCode: "quality.release.approve",
    label: "QA release approval",
    amountCents: null,
    requiresPermission: "quality.release.approve",
    makerChecker: true
  },
  {
    actionCode: "credit_limit.change",
    label: "Credit limit change",
    amountCents: 0,
    requiresPermission: "finance.credit_limit.approve",
    makerChecker: true
  },
  {
    actionCode: "finance.refund.approve",
    label: "Refund / credit note approval",
    amountCents: 0,
    requiresPermission: "finance.refund.approve",
    makerChecker: true
  },
  {
    actionCode: "recall.activate",
    label: "Recall activation",
    amountCents: null,
    requiresPermission: "recall.activate",
    makerChecker: true
  },
  {
    actionCode: "ai.consequential_action",
    label: "Consequential AI action",
    amountCents: null,
    requiresPermission: "ai.actions.approve",
    makerChecker: true
  }
];

/**
 * Seeds the permission catalogue, system roles, role-permission links, user
 * role assignments, default data scopes and approval thresholds. Idempotent and
 * safe to run on every request startup; versioned through rbac_meta so new
 * permission definitions are applied to existing installations.
 */
export function ensureRbacConfig(): void {
  const db = getDb();
  try {
    const meta = db.prepare("SELECT value FROM rbac_meta WHERE key = 'seed_version'").get() as
      | { value: string }
      | undefined;
    if (meta?.value === RBAC_SEED_VERSION) return;
  } catch {
    // Table may not exist on a partially initialized database; SCHEMA_SQL will
    // have created it before this function is reached.
    return;
  }

  const catalog = buildPermissionCatalog();
  const insertPermission = db.prepare(`
    INSERT OR REPLACE INTO permissions (code, module, action, label, description, sensitive)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const p of catalog) {
    insertPermission.run(p.code, p.module, p.action, p.label, p.description, p.sensitive ? 1 : 0);
  }

  const mergeRoleDefinition = db.prepare(`
    INSERT INTO roles (code, name, description, role_type, base_role, is_system, protected, active, created_by)
    VALUES (?, ?, ?, ?, ?, 1, ?, 1, 'system')
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      role_type = 'system',
      is_system = 1,
      protected = excluded.protected
  `);
  for (const role of SYSTEM_ROLE_DEFINITIONS) {
    mergeRoleDefinition.run(
      role.code,
      role.name,
      role.description,
      role.roleType,
      role.baseRole ?? null,
      role.protected ? 1 : 0
    );
  }

  // Rebuild system-role permission links from code so upgrades pick up new
  // permissions. Custom roles and their manually configured links are untouched.
  const deleteRolePerms = db.prepare("DELETE FROM role_permissions WHERE role_code = ?");
  const insertRolePerm = db.prepare(
    "INSERT OR IGNORE INTO role_permissions (role_code, permission_code) VALUES (?, ?)"
  );
  for (const role of SYSTEM_ROLE_DEFINITIONS) {
    deleteRolePerms.run(role.code);
    for (const permission of ROLE_PERMISSIONS[role.code] ?? []) {
      insertRolePerm.run(role.code, permission);
    }
  }

  // Backfill user-role assignments for existing accounts that predate RBAC.
  const users = db.prepare("SELECT id, role, warehouse, store_id FROM users").all() as Array<{
    id: string;
    role: string;
    warehouse: string | null;
    store_id: string | null;
  }>;
  const userHasRoles = db.prepare("SELECT 1 FROM user_roles WHERE user_id = ? LIMIT 1");
  const insertUserRole = db.prepare(
    "INSERT OR IGNORE INTO user_roles (user_id, role_code, assigned_by) VALUES (?, ?, 'system')"
  );
  const insertScope = db.prepare(
    "INSERT OR IGNORE INTO user_scopes (id, user_id, scope_type, scope_value, created_by) VALUES (?, ?, ?, ?, 'system')"
  );
  const maxScopeId =
    (db.prepare("SELECT COUNT(*) as c FROM user_scopes").get() as { c: number } | undefined)?.c ?? 0;
  let scopeSeq = maxScopeId;
  for (const user of users) {
    insertUserRole.run(user.id, normalizeRole(user.role));
    if (user.warehouse && user.warehouse !== "All") {
      scopeSeq += 1;
      insertScope.run(`SCP-${scopeSeq}`, user.id, "warehouse", user.warehouse);
    }
    if (user.store_id) {
      scopeSeq += 1;
      insertScope.run(`SCP-${scopeSeq}`, user.id, "store", user.store_id);
      scopeSeq += 1;
      insertScope.run(`SCP-${scopeSeq}`, user.id, "customer", user.store_id);
    }
  }

  const insertThreshold = db.prepare(`
    INSERT OR IGNORE INTO approval_thresholds
      (action_code, label, amount_cents, requires_permission, maker_checker, active, updated_by)
    VALUES (?, ?, ?, ?, ?, 1, 'system')
  `);
  for (const t of DEFAULT_APPROVAL_THRESHOLDS) {
    insertThreshold.run(t.actionCode, t.label, t.amountCents, t.requiresPermission, t.makerChecker ? 1 : 0);
  }

  db.prepare(
    "INSERT OR REPLACE INTO rbac_meta (key, value) VALUES ('seed_version', ?)"
  ).run(RBAC_SEED_VERSION);
}

function emptyScopes(): UserScopeSet {
  return { company: [], warehouse: [], store: [], customer: [], supplier: [], delivery: [], task: [] };
}

export interface EffectiveAuthorization {
  roles: string[];
  permissions: string[];
  denies: string[];
  scopes: UserScopeSet;
  is_super_admin: boolean;
}

/**
 * Resolves the effective authorization for a user from persisted role
 * assignments and individual overrides. Falls back to the built-in role
 * templates for synthetic users (tests, header simulation, legacy tokens).
 */
export function getEffectiveAuthorization(user: {
  id: string;
  role: string;
  roles?: string[];
  warehouse?: string | null;
  store_id?: string | null;
}): EffectiveAuthorization {
  ensureRbacConfig();
  const db = getDb();
  const primary = normalizeRole(user.role);
  let assigned: string[] = [];
  try {
    assigned = (
      db.prepare("SELECT role_code FROM user_roles WHERE user_id = ?").all(user.id) as Array<{ role_code: string }>
    ).map((r) => r.role_code);
  } catch {
    assigned = [];
  }
  const roles = Array.from(
    new Set([primary, ...(user.roles ?? []).map((r) => normalizeRole(r)), ...assigned].filter(Boolean))
  );

  const scopes = emptyScopes();
  scopes.warehouse = user.warehouse && user.warehouse !== "All" ? [user.warehouse] : [];
  scopes.store = user.store_id ? [user.store_id] : [];
  scopes.customer = user.store_id ? [user.store_id] : [];
  try {
    const scopeRows = db
      .prepare("SELECT scope_type, scope_value FROM user_scopes WHERE user_id = ?")
      .all(user.id) as Array<{ scope_type: string; scope_value: string }>;
    for (const row of scopeRows) {
      const key = row.scope_type as keyof UserScopeSet;
      if (key in scopes && !scopes[key].includes(row.scope_value)) {
        scopes[key].push(row.scope_value);
      }
    }
  } catch {
    // scope table best-effort
  }

  if (roles.includes("super_admin")) {
    const allScopes = emptyScopes();
    allScopes.company = ["*"];
    allScopes.warehouse = ["*"];
    allScopes.store = ["*"];
    allScopes.customer = ["*"];
    allScopes.supplier = ["*"];
    allScopes.delivery = ["*"];
    allScopes.task = ["*"];
    return { roles, permissions: ["*"], denies: [], scopes: allScopes, is_super_admin: true };
  }

  const permissions = new Set<string>();
  for (const roleCode of roles) {
    let rows: Array<{ permission_code: string }> = [];
    try {
      rows = db
        .prepare("SELECT permission_code FROM role_permissions WHERE role_code = ?")
        .all(roleCode) as Array<{ permission_code: string }>;
    } catch {
      rows = [];
    }
    if (rows.length > 0) {
      for (const row of rows) permissions.add(row.permission_code);
    } else {
      // Legacy/synthetic fallback so existing tokens keep their role template.
      for (const permission of ROLE_PERMISSIONS[roleCode as UserRole] ?? []) {
        permissions.add(permission);
      }
    }
  }

  const denies = new Set<string>();
  try {
    const overrides = db
      .prepare("SELECT permission_code, effect FROM user_permissions WHERE user_id = ?")
      .all(user.id) as Array<{ permission_code: string; effect: string }>;
    for (const override of overrides) {
      if (override.effect === "deny") {
        denies.add(override.permission_code);
        permissions.delete(override.permission_code);
      } else {
        permissions.add(override.permission_code);
      }
    }
  } catch {
    // override table best-effort
  }

  return {
    roles,
    permissions: Array.from(permissions),
    denies: Array.from(denies),
    scopes,
    is_super_admin: false
  };
}

/**
 * Attaches effective permissions and data scopes to an authenticated identity.
 * Called at every authentication/session-resolution boundary so permission
 * revocation and role changes take effect on the next request.
 */
export function hydrateAuthorization(user: AuthenticatedUser): AuthenticatedUser {
  const auth = getEffectiveAuthorization({
    id: user.id,
    role: user.role,
    roles: user.roles,
    warehouse: user.warehouse,
    store_id: user.store_id
  });
  return {
    ...user,
    role: normalizeRole(user.role),
    roles: auth.roles as UserRole[],
    permissions: auth.permissions,
    permission_denies: auth.denies,
    scopes: auth.scopes
  };
}

export function getApprovalThreshold(actionCode: string): {
  action_code: string;
  label: string;
  amount_cents: number | null;
  requires_permission: string;
  maker_checker: boolean;
  active: boolean;
} | null {
  ensureRbacConfig();
  const db = getDb();
  const row = db
    .prepare(
      "SELECT action_code, label, amount_cents, requires_permission, maker_checker, active FROM approval_thresholds WHERE action_code = ?"
    )
    .get(actionCode) as
    | {
        action_code: string;
        label: string;
        amount_cents: number | null;
        requires_permission: string;
        maker_checker: number;
        active: number;
      }
    | undefined;
  if (!row) return null;
  return {
    action_code: row.action_code,
    label: row.label,
    amount_cents: row.amount_cents,
    requires_permission: row.requires_permission,
    maker_checker: Boolean(row.maker_checker),
    active: Boolean(row.active)
  };
}

/**
 * Returns true when an action at the supplied amount requires approval.
 * A null/zero threshold means every invocation requires approval.
 */
export function approvalRequired(actionCode: string, amountCents?: number | null): boolean {
  const threshold = getApprovalThreshold(actionCode);
  if (!threshold || !threshold.active) return false;
  if (threshold.amount_cents === null || threshold.amount_cents <= 0) return true;
  if (amountCents === undefined || amountCents === null) return true;
  return amountCents >= threshold.amount_cents;
}

/**
 * Enforces configurable approval authority. The approver must hold the
 * permission configured for the action; maker-checker prevents the requester
 * from approving their own operation where configured.
 */
export function requireApprovalAuthority(
  user: AuthenticatedUser,
  actionCode: string,
  options: { amountCents?: number | null; requestedBy?: string | null } = {}
): void {
  const threshold = getApprovalThreshold(actionCode);
  if (!threshold || !threshold.active) {
    throw new ApiError(400, "APPROVAL_NOT_CONFIGURED", `No active approval authority configured for '${actionCode}'.`);
  }
  assertPermission(user, threshold.requires_permission);
  if (threshold.maker_checker && options.requestedBy && options.requestedBy === user.id) {
    throw new ApiError(
      403,
      "SEGREGATION_OF_DUTIES",
      `Maker-checker is enforced for '${actionCode}': the requester cannot approve their own operation.`
    );
  }
}

/**
 * Extract token from Authorization header or cookies
 */
export function extractTokenFromRequest(req?: NextRequest | Request): string | null {
  if (!req) return null;
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  if ("cookies" in req && typeof (req as NextRequest).cookies?.get === "function") {
    const cookie = (req as NextRequest).cookies.get("ascentra_session") || (req as NextRequest).cookies.get("ascentra_access");
    if (cookie?.value) return cookie.value;
  }

  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(/(?:ascentra_session|ascentra_access)=([^;]+)/);
  if (match) return decodeURIComponent(match[1]);

  return null;
}

/**
 * Extract refresh token from cookie or body
 */
export function extractRefreshTokenFromRequest(req?: NextRequest | Request): string | null {
  if (!req) return null;

  if ("cookies" in req && typeof (req as NextRequest).cookies?.get === "function") {
    const cookie = (req as NextRequest).cookies.get("ascentra_refresh");
    if (cookie?.value) return cookie.value;
  }

  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(/ascentra_refresh=([^;]+)/);
  if (match) return decodeURIComponent(match[1]);

  return null;
}

interface DbUserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  store_id: string | null;
  warehouse: string | null;
  mfa_enabled?: number | null;
  active?: number | null;
}

/**
 * Validates token and returns authenticated user from database
 */
export function getSessionUser(req?: NextRequest | Request): AuthenticatedUser | null {
  if (!req) return null;
  const db = getDb();
  let userRow: DbUserRow | undefined;

  const token = extractTokenFromRequest(req);
  if (token) {
    const verified = verifyAccessToken(token) || verifySessionToken(token);
    if (verified) {
      userRow = db
        .prepare("SELECT id, email, name, role, store_id, warehouse, mfa_enabled, active FROM users WHERE id = ? OR lower(email) = lower(?) LIMIT 1")
        .get(verified.sub ?? null, verified.email ?? null) as DbUserRow | undefined;
    }
  }

  // Fallback to refresh token if access token expired or missing
  if (!userRow) {
    const refreshToken = extractRefreshTokenFromRequest(req);
    if (refreshToken) {
      const tokenHash = sha256Hex(refreshToken);
      const refreshRow = db
        .prepare("SELECT user_id, revoked, expires_at FROM refresh_tokens WHERE token_hash = ? LIMIT 1")
        .get(tokenHash) as { user_id: string; revoked: number; expires_at: string } | undefined;
      if (refreshRow && !refreshRow.revoked && new Date(refreshRow.expires_at).getTime() > Date.now()) {
        userRow = db
          .prepare("SELECT id, email, name, role, store_id, warehouse, mfa_enabled, active FROM users WHERE id = ? LIMIT 1")
          .get(refreshRow.user_id) as DbUserRow | undefined;
      }
    }
  }

  if (userRow) {
    if (userRow.active === 0) return null;
    const normalizedRole = normalizeRole(userRow.role);
    return hydrateAuthorization({
      id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      role: normalizedRole,
      roles: [normalizedRole],
      store_id: userRow.store_id ?? null,
      warehouse: userRow.warehouse ?? "Milan Cold Hub",
      mfa_enabled: Boolean(userRow.mfa_enabled)
    });
  }

  // A cryptographically valid token is NOT enough: the account must still
  // exist and stay active. Returning the token payload after the users row is
  // gone would keep deleted/disabled accounts logged in until token expiry.
  return null;
}

/**
 * Explains why a request carrying a session token is no longer authorized.
 * Used to show a precise message ("account deleted", "account disabled")
 * instead of a generic sign-in prompt after an admin action.
 */
export function getSessionFailureReason(
  req?: NextRequest | Request
): "unauthenticated" | "account_deleted" | "account_disabled" {
  if (!req) return "unauthenticated";
  const token = extractTokenFromRequest(req);
  if (!token) return "unauthenticated";
  const verified = verifyAccessToken(token) || verifySessionToken(token);
  if (!verified) return "unauthenticated";
  const db = getDb();
  const row = db
    .prepare("SELECT active FROM users WHERE id = ? OR lower(email) = lower(?) LIMIT 1")
    .get(verified.sub ?? null, verified.email ?? null) as { active: number } | undefined;
  if (!row) {
    if (verified.email) {
      const tombstone = db
        .prepare("SELECT 1 AS hit FROM deleted_accounts WHERE lower(email) = lower(?) LIMIT 1")
        .get(verified.email);
      if (tombstone) return "account_deleted";
    }
    return "unauthenticated";
  }
  if (row.active === 0) return "account_disabled";
  return "unauthenticated";
}

/**
 * Resolves user from token, header simulation in dev/test, or returns null if unauthenticated.
 * NEVER falls back to admin or arbitrary database users.
 */
export function resolveRequestUser(req?: NextRequest | Request): AuthenticatedUser | null {
  if (!req) return null;

  // 1. Verified JWT / Session token (primary secure path)
  const sessionUser = getSessionUser(req);
  if (sessionUser) return sessionUser;

  // 2. Explicit simulation header (STRICTLY restricted to dev/test environments)
  if (process.env.NODE_ENV !== "production") {
    const roleHeader = req.headers.get("x-ascentra-role")?.trim();
    const emailHeader = req.headers.get("x-ascentra-user")?.trim();
    const storeHeader = req.headers.get("x-ascentra-store")?.trim();

    if (roleHeader) {
      const normalized = normalizeRole(roleHeader);
      const db = getDb();
      const userByRole = db
        .prepare("SELECT id, email, name, role, store_id, warehouse, mfa_enabled FROM users WHERE role = ? AND active = 1 LIMIT 1")
        .get(roleHeader) as DbUserRow | undefined;

      if (userByRole) {
        return hydrateAuthorization({
          id: userByRole.id,
          email: emailHeader || userByRole.email,
          name: userByRole.name,
          role: normalized,
          roles: [normalized],
          store_id: storeHeader !== undefined ? storeHeader : userByRole.store_id,
          warehouse: userByRole.warehouse || "Milan Cold Hub",
          mfa_enabled: Boolean(userByRole.mfa_enabled)
        });
      }

      return hydrateAuthorization({
        id: `USR-${normalized.toUpperCase()}`,
        email: emailHeader || `${normalized}@ascentra.it`,
        name: `Role (${normalized})`,
        role: normalized,
        roles: [normalized],
        store_id: storeHeader ?? null,
        warehouse: "Milan Cold Hub",
        mfa_enabled: false
      });
    }
  }

  // Strictly deny access if no valid identity is present
  return null;
}

/**
 * Enforces authenticated identity on any protected route.
 * Throws 401 Unauthorized if no valid session or token is present.
 */
export function requireAuthenticatedUser(req?: NextRequest | Request): AuthenticatedUser {
  if (!req) {
    throw new ApiError(401, "UNAUTHORIZED", "Authentication required. Please log in.");
  }
  const user = resolveRequestUser(req);
  if (!user) {
    const reason = getSessionFailureReason(req);
    if (reason === "account_deleted") {
      throw new ApiError(
        401,
        "ACCOUNT_DELETED",
        "This account has been deleted by an administrator. Contact your administrator if you need access again."
      );
    }
    if (reason === "account_disabled") {
      throw new ApiError(
        401,
        "ACCOUNT_DISABLED",
        "This account has been disabled. Please contact your administrator."
      );
    }
    throw new ApiError(401, "UNAUTHORIZED", "Authentication required. Please log in.");
  }
  return user;
}

export function hasPermission(user: AuthenticatedUser, permission: Permission): boolean {
  const normalized = normalizeRole(user.role);
  if (
    normalized === "super_admin" ||
    user.roles?.includes("super_admin") ||
    user.role === "super_admin"
  ) {
    return true;
  }

  let allowed: string[];
  if (Array.isArray(user.permissions)) {
    allowed = user.permissions;
  } else {
    allowed = getEffectiveAuthorization({
      id: user.id,
      role: user.role,
      roles: user.roles,
      warehouse: user.warehouse,
      store_id: user.store_id
    }).permissions;
  }

  if (allowed.includes("*") || allowed.includes(permission)) return true;

  const dotPerm = permission.includes(":") ? permission.replace(":", ".") : null;
  const colonPerm = permission.includes(".") ? permission.replace(".", ":") : null;
  if (dotPerm && allowed.includes(dotPerm)) return true;
  if (colonPerm && allowed.includes(colonPerm)) return true;
  return false;
}

export function assertPermission(user: AuthenticatedUser, permission: Permission): void {
  if (!hasPermission(user, permission)) {
    throw new ApiError(
      403,
      "FORBIDDEN_INSUFFICIENT_ROLE",
      `Role '${user.role}' (${user.email}) is not authorized for permission '${permission}'.`
    );
  }
}

// ----------------------------------------------------------------------------
// Scope Boundary Verifications
// ----------------------------------------------------------------------------

export function isPrivilegedCompanyRole(user: AuthenticatedUser): boolean {
  return (
    user.role === "super_admin" ||
    user.role === "company_admin" ||
    user.role === "administrator" ||
    user.role === "ceo" ||
    user.role === "management"
  );
}

function scopeList(user: AuthenticatedUser, key: keyof UserScopeSet): string[] {
  const scopes = user.scopes?.[key] ?? [];
  return scopes.map((s) => s.toLowerCase());
}

function scopeAllows(user: AuthenticatedUser, key: keyof UserScopeSet, value: string): boolean {
  const allowed = scopeList(user, key);
  return allowed.includes("*") || allowed.includes(value.toLowerCase());
}

export function assertWarehouseScope(user: AuthenticatedUser, targetWarehouse?: string | null): void {
  if (isPrivilegedCompanyRole(user)) return;
  if (!targetWarehouse) return;

  const scoped = [
    ...(user.warehouse ? [user.warehouse] : []),
    ...(user.scopes?.warehouse ?? [])
  ].map((w) => w.toLowerCase());

  if (scoped.length > 0 && !scoped.includes("*") && !scoped.includes(targetWarehouse.toLowerCase())) {
    throw new ApiError(
      403,
      "FORBIDDEN_WAREHOUSE_SCOPE",
      `Access denied. User belongs to '${user.warehouse ?? user.scopes?.warehouse.join(", ")}', cannot access '${targetWarehouse}'.`
    );
  }
}

export function assertStoreVendorScope(user: AuthenticatedUser, targetStoreId?: string | null): void {
  if (isPrivilegedCompanyRole(user)) return;
  if (!isStoreScopedRole(user.role)) return;

  const allowed = [
    ...(user.store_id ? [user.store_id] : []),
    ...(user.scopes?.store ?? []),
    ...(user.scopes?.customer ?? [])
  ];
  const normalized = Array.from(new Set(allowed));
  if (
    normalized.length === 0 ||
    (!normalized.includes("*") &&
      targetStoreId &&
      !normalized.some((s) => s.toLowerCase() === targetStoreId.toLowerCase()))
  ) {
    throw new ApiError(
      403,
      "FORBIDDEN_VENDOR_SCOPE",
      `Access denied. Vendor account is restricted to store '${user.store_id ?? normalized.join(", ")}'.`
    );
  }
}

export function assertDriverScope(user: AuthenticatedUser, assignedDriver?: string | null): void {
  if (
    user.role === "super_admin" ||
    user.role === "company_admin" ||
    user.role === "warehouse_manager" ||
    user.role === "administrator" ||
    user.role === "ceo" ||
    user.role === "management"
  ) {
    return;
  }
  if (user.role === "driver" && assignedDriver) {
    const deliveryScope = user.scopes?.delivery ?? [];
    const selfIdentifiers = [user.id, user.name, user.email, ...deliveryScope].map((v) => v.toLowerCase());
    if (!deliveryScope.includes("*") && !selfIdentifiers.includes(assignedDriver.toLowerCase())) {
      throw new ApiError(
        403,
        "FORBIDDEN_DRIVER_SCOPE",
        `Access denied. Drivers can only view and update their assigned delivery routes.`
      );
    }
  }
}

export const requireWarehouseAccess = assertWarehouseScope;
export const requireStoreVendorAccess = assertStoreVendorScope;
export const requireDriverAccess = assertDriverScope;

export function requireOrganizationAccess(user: AuthenticatedUser, organizationId?: string | null): void {
  if (user.role === "super_admin" || user.role === "company_admin" || user.role === "administrator") return;
  if (!organizationId) return;
  const companyScopes = user.scopes?.company ?? [];
  if (companyScopes.length > 0 && !companyScopes.includes("*") && !scopeAllows(user, "company", organizationId)) {
    throw new ApiError(403, "FORBIDDEN_ORGANIZATION_SCOPE", `Access denied to organization/store '${organizationId}'.`);
  }
  if (user.store_id && user.store_id !== organizationId && isStoreScopedRole(user.role)) {
    throw new ApiError(403, "FORBIDDEN_ORGANIZATION_SCOPE", `Access denied to organization/store '${organizationId}'.`);
  }
}

export function requireAssignedDelivery(user: AuthenticatedUser, deliveryDriver?: string | null): void {
  assertDriverScope(user, deliveryDriver);
}

/**
 * Validates record-level ownership and boundaries across all entities.
 * Prevents Insecure Direct Object References (IDOR/BOLA).
 */
export function requireRecordAccess(
  user: AuthenticatedUser,
  record: {
    warehouse?: string | null;
    customer_id?: string | null;
    driver?: string | null;
    supplier_id?: string | null;
  }
): void {
  // 1. Super Admin / Company Admin: platform- and company-wide operational authority
  if (user.role === "super_admin" || user.role === "company_admin" || user.role === "administrator") {
    return;
  }

  // 2. CEO has read-only executive visibility
  if (user.role === "ceo" || user.role === "management") {
    return;
  }

  // 3. Store Vendor: Strictly bounded to own customer/store ID
  if (isStoreScopedRole(user.role)) {
    const allowed = [
      ...(user.store_id ? [user.store_id] : []),
      ...(user.scopes?.store ?? []),
      ...(user.scopes?.customer ?? [])
    ];
    if (
      allowed.length === 0 ||
      (!allowed.includes("*") &&
        record.customer_id &&
        !allowed.some((s) => s.toLowerCase() === record.customer_id!.toLowerCase()))
    ) {
      throw new ApiError(
        403,
        "FORBIDDEN_RECORD_ACCESS",
        `Access denied. Account is restricted to store '${user.store_id ?? allowed.join(", ")}'.`
      );
    }
    return;
  }

  // 4. Driver: Strictly bounded to assigned deliveries
  if (user.role === "driver") {
    const deliveryScope = user.scopes?.delivery ?? [];
    const identifiers = [user.id, user.name, user.email, ...deliveryScope].map((v) => v.toLowerCase());
    if (record.driver && !deliveryScope.includes("*") && !identifiers.includes(record.driver.toLowerCase())) {
      throw new ApiError(
        403,
        "FORBIDDEN_RECORD_ACCESS",
        `Access denied. Delivery is assigned to '${record.driver}', not '${user.name}'.`
      );
    }
    return;
  }

  // 5. Warehouse staff / Pickers / QA: bounded to assigned warehouse(s)
  if (
    user.role === "warehouse_manager" ||
    user.role === "picker" ||
    user.role === "warehouse_staff" ||
    user.role === "qa" ||
    user.role === "qa_inspector" ||
    user.role === "qa_manager"
  ) {
    const warehouses = [
      ...(user.warehouse && user.warehouse !== "All" ? [user.warehouse] : []),
      ...(user.scopes?.warehouse ?? [])
    ].map((w) => w.toLowerCase());
    if (
      record.warehouse &&
      warehouses.length > 0 &&
      !warehouses.includes("*") &&
      !warehouses.includes(record.warehouse.toLowerCase())
    ) {
      throw new ApiError(
        403,
        "FORBIDDEN_RECORD_ACCESS",
        `Access denied. Record belongs to warehouse '${record.warehouse}', but user is assigned to '${user.warehouse ?? warehouses.join(", ")}'.`
      );
    }
    return;
  }

  // 6. Sales: optional assigned-customer restriction
  if (user.role === "sales" && record.customer_id) {
    const customerScope = user.scopes?.customer ?? [];
    if (customerScope.length > 0 && !customerScope.includes("*") && !scopeAllows(user, "customer", record.customer_id)) {
      throw new ApiError(403, "FORBIDDEN_RECORD_ACCESS", `Access denied. Customer '${record.customer_id}' is not assigned to this user.`);
    }
    return;
  }

  // 7. Procurement: optional assigned-supplier restriction
  if (user.role === "procurement" && record.supplier_id) {
    const supplierScope = user.scopes?.supplier ?? [];
    if (supplierScope.length > 0 && !supplierScope.includes("*") && !scopeAllows(user, "supplier", record.supplier_id)) {
      throw new ApiError(403, "FORBIDDEN_RECORD_ACCESS", `Access denied. Supplier '${record.supplier_id}' is not assigned to this user.`);
    }
  }
}

/**
 * Prevents non-authorized roles (such as CEO or Read-Only auditors) from performing sensitive state mutations.
 */
export function requireMutationAuthorization(user: AuthenticatedUser, actionDescription: string): void {
  if (user.role === "ceo" || user.role === "management") {
    throw new ApiError(
      403,
      "EXECUTIVE_READ_ONLY",
      `Executive role is read-only by default. '${actionDescription}' requires explicit operational delegation.`
    );
  }
}

/**
 * Reusable Centralized Authorization Guard
 */
export function requirePermission(
  req: NextRequest | Request,
  permission: Permission,
  scope?: {
    warehouse?: string | null;
    storeId?: string | null;
    driver?: string | null;
  }
): AuthenticatedUser {
  const user = requireAuthenticatedUser(req);

  assertPermission(user, permission);

  if (scope?.warehouse !== undefined) {
    assertWarehouseScope(user, scope.warehouse);
  }
  if (scope?.storeId !== undefined) {
    assertStoreVendorScope(user, scope.storeId);
  }
  if (scope?.driver !== undefined) {
    assertDriverScope(user, scope.driver);
  }

  return user;
}

// ----------------------------------------------------------------------------
// Authentication Lifecycle (Login, Refresh, Logout, MFA)
// ----------------------------------------------------------------------------

export interface LoginResult {
  mfaRequired: boolean;
  mfaToken?: string;
  accessToken?: string;
  refreshToken?: string;
  user: AuthenticatedUser;
}

export function authenticateUser(
  email: string,
  password: string,
  ipAddress = "127.0.0.1",
  userAgent = "AscentraClient"
): LoginResult {
  const db = getDb();
  const normalizedEmail = email.trim().toLowerCase();

  const row = db
    .prepare(`
      SELECT id, email, name, password_hash, role, store_id, warehouse, mfa_enabled, mfa_secret, failed_attempts, locked_until, active, must_change_password
      FROM users
      WHERE lower(email) = ?
    `)
    .get(normalizedEmail) as
    | {
        id: string;
        email: string;
        name: string;
        password_hash: string;
        role: string;
        store_id: string | null;
        warehouse: string | null;
        mfa_enabled: number;
        mfa_secret: string | null;
        failed_attempts: number;
        locked_until: string | null;
        active: number;
        must_change_password: number;
      }
    | undefined;

  // Account existence protection: Generic failure message, except when the
  // email belongs to a hard-deleted account (tombstone) — then say so clearly.
  if (!row) {
    const tombstone = db
      .prepare("SELECT email FROM deleted_accounts WHERE lower(email) = ? ORDER BY deleted_at DESC LIMIT 1")
      .get(normalizedEmail) as { email: string } | undefined;
    if (tombstone) {
      throw new ApiError(
        403,
        "ACCOUNT_DELETED",
        "This account has been deleted by an administrator. Contact your administrator if you need access again."
      );
    }
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
  }

  // A live account always wins over an old tombstone (the email may have been
  // re-issued after an earlier deletion). Clear stale tombstones on sight.
  db.prepare("DELETE FROM deleted_accounts WHERE lower(email) = ?").run(normalizedEmail);

  // Account lockout protection
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    const remainingMins = Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 60000);
    recordAuditEvent({
      actor: { id: row.id, email: row.email, name: row.name, role: normalizeRole(row.role) },
      action: "auth.login_lockout_blocked",
      entityType: "User",
      entityId: row.id,
      ipAddress
    });
    throw new ApiError(
      423,
      "ACCOUNT_LOCKED",
      `Account is temporarily locked due to repeated failed login attempts. Please try again in ${remainingMins} minutes.`
    );
  }

  // Disabled account check
  if (!row.active) {
    throw new ApiError(403, "ACCOUNT_DISABLED", "Your account is disabled. Please contact your administrator.");
  }

  // Password verification
  if (!verifyPassword(password, row.password_hash)) {
    const attempts = (row.failed_attempts || 0) + 1;
    let lockedUntil: string | null = null;
    if (attempts >= 5) {
      lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // Lock for 15 minutes
    }

    db.prepare("UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?").run(attempts, lockedUntil, row.id);

    recordAuditEvent({
      actor: { id: row.id, email: row.email, name: row.name, role: normalizeRole(row.role) },
      action: attempts >= 5 ? "auth.account_locked" : "auth.login_failed",
      entityType: "User",
      entityId: row.id,
      after: { attempts, locked: Boolean(lockedUntil) },
      ipAddress
    });

    if (lockedUntil) {
      throw new ApiError(
        423,
        "ACCOUNT_LOCKED",
        "Account has been locked due to 5 consecutive failed login attempts. Please try again in 15 minutes."
      );
    }

    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
  }

  // Password correct: Reset failed attempts
  db.prepare("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?").run(row.id);

  const normalizedRole = normalizeRole(row.role);
  const user: AuthenticatedUser = hydrateAuthorization({
    id: row.id,
    email: row.email,
    name: row.name,
    role: normalizedRole,
    roles: [normalizedRole],
    store_id: row.store_id,
    warehouse: row.warehouse,
    mfa_enabled: Boolean(row.mfa_enabled && row.mfa_secret)
  });

  // If MFA is actively configured, issue restricted MFA challenge token
  if (row.mfa_enabled && row.mfa_secret) {
    const mfaToken = signMfaChallengeToken(user.id, user.email);
    recordAuditEvent({
      actor: user,
      action: "auth.mfa_challenge_issued",
      entityType: "User",
      entityId: user.id,
      ipAddress
    });
    return {
      mfaRequired: true,
      mfaToken,
      user
    };
  }

  // Issue standard tokens
  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    roles: user.roles,
    store_id: user.store_id,
    warehouse: user.warehouse
  });
  (user as AuthenticatedUser & { must_change_password?: boolean }).must_change_password =
    Boolean(row.must_change_password);

  const { rawToken: refreshToken } = createRefreshToken(user.id, ipAddress, userAgent);

  recordAuditEvent({
    actor: user,
    action: "auth.login_success",
    entityType: "Session",
    entityId: user.id,
    after: { role: user.role, email: user.email },
    ipAddress
  });

  return {
    mfaRequired: false,
    accessToken,
    refreshToken,
    user
  };
}

export function completeMfaLogin(
  mfaToken: string,
  code: string,
  ipAddress = "127.0.0.1",
  userAgent = "AscentraClient"
): { accessToken: string; refreshToken: string; user: AuthenticatedUser } {
  const verified = verifyMfaChallengeToken(mfaToken);
  if (!verified) {
    throw new ApiError(401, "INVALID_MFA_CHALLENGE", "MFA session expired or invalid. Please log in again.");
  }

  const db = getDb();
  const row = db
    .prepare("SELECT id, email, name, role, store_id, warehouse, mfa_secret, mfa_backup_codes, active FROM users WHERE id = ?")
    .get(verified.sub) as
    | {
        id: string;
        email: string;
        name: string;
        role: string;
        store_id: string | null;
        warehouse: string | null;
        mfa_secret: string | null;
        mfa_backup_codes: string | null;
        active: number;
      }
    | undefined;

  if (!row || !row.active || !row.mfa_secret) {
    throw new ApiError(401, "MFA_NOT_CONFIGURED", "MFA configuration not found for account.");
  }

  const decryptedSecret = decryptSecret(row.mfa_secret);
  let passed = verifyTotpCode(decryptedSecret, code);

  // If TOTP failed, check recovery backup codes
  if (!passed && row.mfa_backup_codes) {
    try {
      const storedHashes = JSON.parse(row.mfa_backup_codes) as string[];
      const recoveryCheck = verifyAndBurnRecoveryCode(code, storedHashes);
      if (recoveryCheck.valid) {
        passed = true;
        // Update database with burned code
        db.prepare("UPDATE users SET mfa_backup_codes = ? WHERE id = ?").run(
          JSON.stringify(recoveryCheck.remainingHashes),
          row.id
        );
        recordAuditEvent({
          actor: { id: row.id, email: row.email, name: row.name, role: normalizeRole(row.role) },
          action: "auth.mfa_recovery_code_used",
          entityType: "User",
          entityId: row.id,
          after: { remainingCodes: recoveryCheck.remainingHashes.length },
          ipAddress
        });
      }
    } catch {
      // backup code parse error
    }
  }

  if (!passed) {
    recordAuditEvent({
      actor: { id: row.id, email: row.email, name: row.name, role: normalizeRole(row.role) },
      action: "auth.mfa_verify_failed",
      entityType: "User",
      entityId: row.id,
      ipAddress
    });
    throw new ApiError(401, "INVALID_MFA_CODE", "Invalid authentication code or recovery code.");
  }

  const normalizedRole = normalizeRole(row.role);
  const user: AuthenticatedUser = hydrateAuthorization({
    id: row.id,
    email: row.email,
    name: row.name,
    role: normalizedRole,
    roles: [normalizedRole],
    store_id: row.store_id,
    warehouse: row.warehouse,
    mfa_enabled: true
  });

  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    roles: user.roles,
    store_id: user.store_id,
    warehouse: user.warehouse
  });

  const { rawToken: refreshToken } = createRefreshToken(user.id, ipAddress, userAgent);

  recordAuditEvent({
    actor: user,
    action: "auth.mfa_verify_success",
    entityType: "Session",
    entityId: user.id,
    ipAddress
  });

  return { accessToken, refreshToken, user };
}

export function enrollMfa(user: AuthenticatedUser): { secret: string; uri: string; backupCodes: string[] } {
  const db = getDb();
  const rawSecret = generateTotpSecret(20);
  const uri = generateTotpUri({ email: user.email, secret: rawSecret });
  const { plaincodes, hashes } = generateRecoveryCodes(8);

  const encrypted = encryptSecret(rawSecret);

  // Store provisional secret and backup hashes (mfa_enabled remains 0 until verified)
  db.prepare("UPDATE users SET mfa_secret = ?, mfa_backup_codes = ?, mfa_enabled = 0 WHERE id = ?").run(
    encrypted,
    JSON.stringify(hashes),
    user.id
  );

  recordAuditEvent({
    actor: user,
    action: "auth.mfa_enroll_initiated",
    entityType: "User",
    entityId: user.id
  });

  return { secret: rawSecret, uri, backupCodes: plaincodes };
}

export function verifyMfaEnrollment(user: AuthenticatedUser, code: string): boolean {
  const db = getDb();
  const row = db.prepare("SELECT mfa_secret FROM users WHERE id = ?").get(user.id) as { mfa_secret: string | null } | undefined;

  if (!row?.mfa_secret) {
    throw new ApiError(400, "MFA_NOT_ENROLLED", "MFA enrollment has not been initiated.");
  }

  const rawSecret = decryptSecret(row.mfa_secret);
  if (!verifyTotpCode(rawSecret, code)) {
    throw new ApiError(400, "INVALID_CODE", "Invalid 6-digit TOTP code. Please try again.");
  }

  db.prepare("UPDATE users SET mfa_enabled = 1 WHERE id = ?").run(user.id);

  recordAuditEvent({
    actor: user,
    action: "auth.mfa_enroll_confirmed",
    entityType: "User",
    entityId: user.id
  });

  return true;
}

export function disableMfa(user: AuthenticatedUser, passwordOrCode: string): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT password_hash, mfa_secret FROM users WHERE id = ?")
    .get(user.id) as { password_hash: string; mfa_secret: string | null } | undefined;

  if (!row) throw new ApiError(404, "USER_NOT_FOUND", "User not found.");

  let authorized = verifyPassword(passwordOrCode, row.password_hash);
  if (!authorized && row.mfa_secret) {
    const rawSecret = decryptSecret(row.mfa_secret);
    authorized = verifyTotpCode(rawSecret, passwordOrCode);
  }

  if (!authorized) {
    throw new ApiError(401, "FORBIDDEN", "Incorrect password or authentication code.");
  }

  db.prepare("UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, mfa_backup_codes = NULL WHERE id = ?").run(user.id);

  recordAuditEvent({
    actor: user,
    action: "auth.mfa_disabled",
    entityType: "User",
    entityId: user.id
  });

  return true;
}

export function logoutSession(token: string, actor: AuthenticatedUser): void {
  const db = getDb();
  const tokenHash = sha256Hex(token);
  db.prepare("UPDATE user_sessions SET revoked = 1 WHERE token_hash = ?").run(tokenHash);
  revokeRefreshToken(token);

  recordAuditEvent({
    actor,
    action: "auth.logout",
    entityType: "Session",
    entityId: actor.id,
    after: { revoked: true }
  });
}

export function registerUser(
  input: {
    name: string;
    email: string;
    password: string;
    role?: UserRole;
    warehouse?: string;
    store_id?: string | null;
  },
  ipAddress = "127.0.0.1"
): { token: string; user: AuthenticatedUser } {
  const name = (input.name || "").trim();
  const normalizedEmail = (input.email || "").trim().toLowerCase();
  const password = input.password || "";
  const role = normalizeRole(input.role || "super_admin");
  const warehouse = (input.warehouse || "Milan Cold Hub").trim();

  if (!name) throw new ApiError(400, "VALIDATION_ERROR", "Full name is required.");
  if (!normalizedEmail || !normalizedEmail.includes("@")) throw new ApiError(400, "VALIDATION_ERROR", "A valid email address is required.");
  if (password.length < 8) throw new ApiError(400, "WEAK_PASSWORD", "Password must be at least 8 characters long.");

  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE lower(email) = ?").get(normalizedEmail) as { id: string } | undefined;
  if (existing) {
    throw new ApiError(409, "EMAIL_ALREADY_EXISTS", "An account with this email already exists.");
  }

  const userId = `USR-${Date.now().toString().slice(-6)}`;
  const passwordHash = hashPassword(password);
  const storeId = input.store_id?.trim() || null;

  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, store_id, warehouse, mfa_enabled, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)
  `).run(userId, normalizedEmail, name, passwordHash, role, storeId, warehouse);

  const user: AuthenticatedUser = hydrateAuthorization({
    id: userId,
    email: normalizedEmail,
    name,
    role,
    roles: [role],
    store_id: storeId,
    warehouse,
    mfa_enabled: false
  });

  // Persist the initial role assignment for the new account.
  db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_code, assigned_by) VALUES (?, ?, ?)").run(
    userId,
    role,
    "self_signup"
  );

  const token = signAccessToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    roles: user.roles,
    store_id: user.store_id,
    warehouse: user.warehouse
  });

  recordAuditEvent({
    actor: user,
    action: "auth.signup",
    entityType: "User",
    entityId: user.id,
    after: { email: user.email, name: user.name, role: user.role, warehouse },
    ipAddress
  });

  return { token, user };
}

export function resetUserPassword(email: string, newPassword: string, actor: AuthenticatedUser): { updated: boolean } {
  if (!newPassword || newPassword.length < 8) {
    throw new ApiError(400, "WEAK_PASSWORD", "Password must be at least 8 characters long.");
  }
  const db = getDb();
  const target = db.prepare("SELECT id, email FROM users WHERE lower(email) = ?").get(email.trim().toLowerCase()) as
    | { id: string; email: string }
    | undefined;
  if (!target) {
    throw new ApiError(404, "USER_NOT_FOUND", "User account not found.");
  }
  if (actor.role !== "super_admin" && actor.role !== "administrator" && actor.email.toLowerCase() !== target.email.toLowerCase()) {
    throw new ApiError(403, "FORBIDDEN", "Only administrators can reset another user's password.");
  }

  const newHash = hashPassword(newPassword);
  db.prepare("UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?").run(newHash, target.id);
  revokeAllUserRefreshTokens(target.id);

  recordAuditEvent({
    actor,
    action: "auth.password_reset",
    entityType: "User",
    entityId: target.id,
    after: { email: target.email, password_hash: "[REDACTED]" }
  });
  return { updated: true };
}

export function listRoleUsers(): AuthenticatedUser[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, email, name, role, store_id, warehouse, mfa_enabled FROM users WHERE active = 1 ORDER BY id ASC")
    .all() as DbUserRow[];

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    role: normalizeRole(r.role),
    roles: [normalizeRole(r.role)],
    store_id: r.store_id ?? null,
    warehouse: r.warehouse || "Milan Cold Hub",
    mfa_enabled: Boolean(r.mfa_enabled)
  }));
}

// ----------------------------------------------------------------------------
// Centralized Audit Logging with Credential Redaction
// ----------------------------------------------------------------------------

function redactSensitive(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redactSensitive);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (/password|secret|token|recovery|totp|card|cvv|iban/i.test(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redactSensitive(v);
    }
  }
  return out;
}

export function recordAuditEvent(params: {
  actor: AuthenticatedUser;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
}): string {
  const db = getDb();
  const id = `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const beforeJson = params.before !== undefined ? JSON.stringify(redactSensitive(params.before)) : null;
  const afterJson = params.after !== undefined ? JSON.stringify(redactSensitive(params.after)) : null;

  db.prepare(`
    INSERT INTO audit_events (
      id, actor_id, actor_email, actor_role, action,
      entity_type, entity_id, before_json, after_json, ip_address, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.actor.id,
    params.actor.email,
    params.actor.role,
    params.action,
    params.entityType,
    params.entityId,
    beforeJson,
    afterJson,
    params.ipAddress ?? "127.0.0.1",
    new Date().toISOString()
  );
  return id;
}

export function listAuditEvents(limit = 50): Array<{
  id: string;
  actor_id?: string;
  actor_email: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before_json?: string | null;
  after_json: string | null;
  ip_address?: string;
  created_at: string;
}> {
  const db = getDb();
  return db
    .prepare(
      "SELECT id, actor_id, actor_email, actor_role, action, entity_type, entity_id, before_json, after_json, ip_address, created_at FROM audit_events ORDER BY created_at DESC LIMIT ?"
    )
    .all(limit) as Array<{
    id: string;
    actor_id?: string;
    actor_email: string;
    actor_role: string;
    action: string;
    entity_type: string;
    entity_id: string;
    before_json?: string | null;
    after_json: string | null;
    ip_address?: string;
    created_at: string;
  }>;
}
