import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextRequest } from "next/server";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ascentra-rbac-test-"));
process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-rbac.sqlite");
process.env.SEED_DEMO_DATA = "true";

import { getDb } from "@/server/db/connection";
import {
  SYSTEM_ROLE_DEFINITIONS,
  ROLE_PERMISSIONS,
  assertDriverScope,
  assertStoreVendorScope,
  assertWarehouseScope,
  approvalRequired,
  ensureRbacConfig,
  getEffectiveAuthorization,
  getSessionUser,
  hasPermission,
  hydrateAuthorization,
  normalizeRole,
  requireApprovalAuthority,
  requireRecordAccess,
  requirePermission,
  AuthenticatedUser
} from "@/server/security/auth";
import {
  createRefreshToken,
  rotateRefreshToken,
  signAccessToken
} from "@/server/security/crypto";
import {
  createAccessRole,
  createAccessUser,
  deleteAccessUser,
  duplicateAccessRole,
  getAccessUser,
  listAccessRoles,
  listAccessUsers,
  updateAccessRole,
  updateAccessUser
} from "@/server/services/access-control.service";
import {
  getCustomerOrder,
  submitCustomerOrder
} from "@/server/services/customer-order.service";

import { GET as getAdminUsers, POST as postAdminUser } from "@/app/api/v1/admin/users/route";
import { GET as getAdminPermissions } from "@/app/api/v1/admin/permissions/route";
import { GET as getBiExport } from "@/app/api/v1/management/bi/export/route";
import { GET as getConsolidatedExport } from "@/app/api/v1/stores/consolidated/export/route";
import { POST as postReconciliationImport } from "@/app/api/v1/finance/reconciliation/import/route";
import { POST as postAuth } from "@/app/api/v1/auth/route";

function makeReq(
  urlPath: string,
  options: { method?: string; token?: string; body?: unknown } = {}
): NextRequest {
  const headers = new Headers();
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`http://127.0.0.1:3000${urlPath}`, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
}

function actor(role: string, overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  const normalized = normalizeRole(role);
  return {
    id: overrides.id ?? `USR-TEST-${normalized.toUpperCase()}`,
    email: overrides.email ?? `${normalized}@test.local`,
    name: overrides.name ?? `Test ${normalized}`,
    role: normalized,
    roles: overrides.roles ?? [normalized],
    store_id: overrides.store_id ?? null,
    warehouse: overrides.warehouse ?? "Milan Cold Hub",
    mfa_enabled: false,
    ...overrides
  };
}

function addDaysIso(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function tokenFor(identity: AuthenticatedUser): string {
  return signAccessToken({
    sub: identity.id,
    email: identity.email,
    name: identity.name,
    role: identity.role,
    store_id: identity.store_id ?? null,
    warehouse: identity.warehouse ?? null
  });
}

describe("RBAC — roles, scopes, approval authority, access control and security", () => {
  const adminActor = actor("super_admin", {
    id: "USR-ADMIN",
    email: "elena.conti@ascentra.it",
    name: "Elena Conti"
  });
  const companyAdminActor = actor("company_admin", {
    id: "USR-TEST-COMPANY-ADMIN",
    email: "company.admin@test.local",
    name: "Company Admin"
  });
  const ceoActor = actor("ceo", { id: "USR-TEST-CEO" });
  const salesActor = actor("sales", { id: "USR-TEST-SALES" });
  const pickerActor = actor("picker", { id: "USR-TEST-PICKER" });
  const driverActor = actor("driver", { id: "USR-TEST-DRIVER" });
  const qaActor = actor("qa", { id: "USR-TEST-QA" });
  const financeActor = actor("finance", { id: "USR-TEST-FINANCE" });

  before(() => {
    getDb();
    ensureRbacConfig();
    // Sessions are validated against the users table (a valid JWT alone must
    // not keep a deleted account signed in). Persist the two API-test actors
    // so their tokens represent real accounts with the intended roles.
    for (const testUser of [
      { name: "Test picker", email: pickerActor.email, role: "picker" },
      { name: "Company Admin", email: companyAdminActor.email, role: "company_admin" }
    ]) {
      const exists = getDb()
        .prepare("SELECT 1 FROM users WHERE lower(email) = lower(?)")
        .get(testUser.email);
      if (!exists) {
        createAccessUser(adminActor, { ...testUser, password: "Ascentra!2026", warehouse: "Milan Cold Hub" });
      }
    }
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures on Windows
    }
  });

  // -------------------------------------------------------------------------
  // 1. Every-role access
  // -------------------------------------------------------------------------
  it("1. exposes exactly the 11 required roles and effective permissions for each", () => {
    const codes = SYSTEM_ROLE_DEFINITIONS.map((role) => role.code);
    assert.deepEqual(
      codes.sort(),
      [
        "ceo",
        "company_admin",
        "driver",
        "finance",
        "picker",
        "procurement",
        "qa",
        "sales",
        "store_vendor",
        "super_admin",
        "warehouse_manager"
      ].sort()
    );

    const dbRoles = listAccessRoles(adminActor).filter((role) => role.is_system);
    assert.ok(dbRoles.length >= 11);
    for (const role of SYSTEM_ROLE_DEFINITIONS) {
      const persisted = dbRoles.find((entry) => entry.code === role.code);
      assert.ok(persisted, `Role ${role.code} must be persisted`);
      assert.ok(persisted!.permissions.length > 0, `Role ${role.code} must have permissions`);
    }

    // Super Admin: full access via wildcard semantics
    for (const permission of [
      "users.manage",
      "roles.manage",
      "settings.manage",
      "inventory.adjust",
      "finance.refund.approve",
      "integrations.manage",
      "any.future.permission"
    ]) {
      assert.equal(hasPermission(adminActor, permission), true, `Super Admin must hold ${permission}`);
    }
    assert.equal(getEffectiveAuthorization(adminActor).is_super_admin, true);

    // Company Admin: company operations and user/role administration
    for (const permission of ["users.read", "users.manage", "roles.manage", "settings.manage", "module.settings"]) {
      assert.equal(hasPermission(companyAdminActor, permission), true, `Company Admin must hold ${permission}`);
    }

    // CEO: read-only, no stock adjustment or payment recording
    assert.equal(hasPermission(ceoActor, "reports.executive.read"), true);
    assert.equal(hasPermission(ceoActor, "inventory.read"), true);
    assert.equal(hasPermission(ceoActor, "inventory.adjust"), false);
    assert.equal(hasPermission(ceoActor, "payments.record"), false);

    // Warehouse Manager vs Picker
    assert.equal(hasPermission(actor("warehouse_manager"), "inventory.adjust"), true);
    assert.equal(hasPermission(pickerActor, "inventory.pick"), true);
    assert.equal(hasPermission(pickerActor, "inventory.adjust"), false);
    assert.equal(hasPermission(pickerActor, "orders.manage"), false);

    // Driver: assigned deliveries only, no financial management
    assert.equal(hasPermission(driverActor, "deliveries.update_assigned"), true);
    assert.equal(hasPermission(driverActor, "invoices.manage"), false);
    assert.equal(hasPermission(driverActor, "inventory.adjust"), false);

    // QA and Finance approval authority
    assert.equal(hasPermission(qaActor, "quality.release.approve"), true);
    assert.equal(hasPermission(qaActor, "payments.record"), false);
    assert.equal(hasPermission(financeActor, "finance.credit_limit.approve"), true);
    assert.equal(hasPermission(financeActor, "inventory.adjust"), false);

    // Sales and Procurement
    assert.equal(hasPermission(salesActor, "orders.manage"), true);
    assert.equal(hasPermission(salesActor, "settings.manage"), false);
    assert.equal(hasPermission(actor("procurement"), "procurement.po.approve"), true);

    // Store / Vendor: own orders only, no platform administration or audit access
    const vendor = actor("store_vendor", { store_id: "CUST-B2B-01" });
    assert.equal(hasPermission(vendor, "orders.manage"), true);
    assert.equal(hasPermission(vendor, "users.manage"), false);
    assert.equal(hasPermission(vendor, "audit.read"), false);
    assert.equal(hasPermission(vendor, "inventory.adjust"), false);
    assert.equal(hasPermission(vendor, "stores.export"), false);
  });

  it("2. normalizes aliases and never escalates unknown or empty roles", () => {
    assert.equal(normalizeRole("procurement_officer"), "procurement");
    assert.equal(normalizeRole("sales_manager"), "sales");
    assert.equal(normalizeRole("warehouse_operator"), "picker");
    assert.equal(normalizeRole("accountant"), "finance");
    assert.equal(normalizeRole(""), "picker");
    assert.equal(normalizeRole("regional_supervisor"), "regional_supervisor");
    assert.notEqual(normalizeRole("regional_supervisor"), "super_admin");

    const unknown = actor("regional_supervisor");
    assert.equal(hasPermission(unknown, "users.manage"), false);
    assert.equal(hasPermission(unknown, "*"), false);
  });

  // -------------------------------------------------------------------------
  // 2. Company Admin restrictions & privilege escalation
  // -------------------------------------------------------------------------
  it("3. Company Admin cannot modify protected Super Admin accounts", () => {
    assert.throws(
      () => updateAccessUser(companyAdminActor, "USR-ADMIN", { name: "Hijacked" }),
      (err: any) => err.statusCode === 403 && err.code === "PROTECTED_SUPER_ADMIN"
    );
    assert.throws(
      () => deleteAccessUser(companyAdminActor, "USR-ADMIN"),
      (err: any) => err.statusCode === 403 && err.code === "PROTECTED_SUPER_ADMIN"
    );
  });

  it("4. prevents privilege escalation when creating users or roles", () => {
    assert.throws(
      () =>
        createAccessUser(companyAdminActor, {
          name: "Escalated User",
          email: `escalated-${Date.now()}@test.local`,
          password: "Ascentra!2026",
          roles: ["super_admin"]
        }),
      (err: any) => err.code === "PRIVILEGE_ESCALATION"
    );

    assert.throws(
      () =>
        createAccessRole(companyAdminActor, {
          name: `Wildcard ${Date.now()}`,
          permissions: ["*"]
        }),
      (err: any) => err.code === "PRIVILEGE_ESCALATION"
    );

    assert.throws(
      () =>
        createAccessRole(companyAdminActor, {
          name: `Integrations ${Date.now()}`,
          permissions: ["integrations.manage"]
        }),
      (err: any) => err.code === "PRIVILEGE_ESCALATION"
    );

    // The Company Admin cannot edit predefined system roles.
    assert.throws(
      () => updateAccessRole(companyAdminActor, "ceo", { name: "CEO Hijacked" }),
      (err: any) => err.statusCode === 403 && err.code === "PROTECTED_ROLE"
    );
  });

  it("5. Company Admin can create and manage ordinary company users", () => {
    const created = createAccessUser(companyAdminActor, {
      name: "Ordinary Picker",
      email: `picker-${Date.now()}@test.local`,
      password: "Ascentra!2026",
      roles: ["picker"],
      warehouse: "Milan Cold Hub",
      scopes: { warehouse: ["Milan Cold Hub"] }
    });
    assert.ok(created.id);
    assert.deepEqual(created.roles, ["picker"]);
    assert.ok(created.scopes.warehouse.includes("Milan Cold Hub"));
    assert.equal(created.permissions.includes("inventory.adjust"), false);

    const updated = updateAccessUser(companyAdminActor, created.id, { roles: ["warehouse_manager"] });
    assert.ok(updated.roles.includes("warehouse_manager"));
    assert.ok(updated.permissions.includes("inventory.adjust"));
  });

  it("6. prevents removing the last active Super Admin", () => {
    const secondAdmin = actor("super_admin", {
      id: "USR-TEST-SUPER-2",
      email: "second.admin@test.local"
    });
    assert.throws(
      () => updateAccessUser(secondAdmin, "USR-ADMIN", { active: false }),
      (err: any) => err.statusCode === 409 && err.code === "LAST_ADMIN_PROTECTED"
    );
  });

  // -------------------------------------------------------------------------
  // 3. Data-scope isolation
  // -------------------------------------------------------------------------
  it("7. enforces warehouse A/B isolation for warehouse, picker and QA roles", () => {
    const milan = actor("warehouse_manager", { warehouse: "Milan Cold Hub" });
    assert.doesNotThrow(() => assertWarehouseScope(milan, "Milan Cold Hub"));
    assert.throws(
      () => assertWarehouseScope(milan, "Rome Cold Hub"),
      (err: any) => err.code === "FORBIDDEN_WAREHOUSE_SCOPE"
    );
    assert.throws(
      () => requireRecordAccess(milan, { warehouse: "Rome Cold Hub" }),
      (err: any) => err.code === "FORBIDDEN_RECORD_ACCESS"
    );

    const romePicker = hydrateAuthorization(
      actor("picker", { warehouse: null, id: "USR-RBW-PICKER", email: "rome.picker@test.local" })
    );
    romePicker.scopes = { ...romePicker.scopes!, warehouse: ["Rome Cold Hub"] };
    assert.throws(
      () => assertWarehouseScope(romePicker, "Milan Cold Hub"),
      (err: any) => err.code === "FORBIDDEN_WAREHOUSE_SCOPE"
    );
  });

  it("8. enforces store/customer A/B isolation for store vendors", () => {
    const vendorA = actor("store_vendor", { store_id: "CUST-B2B-01" });
    const vendorB = actor("store_vendor", { store_id: "CUST-B2B-02" });
    assert.doesNotThrow(() => assertStoreVendorScope(vendorA, "CUST-B2B-01"));
    assert.throws(
      () => assertStoreVendorScope(vendorA, "CUST-B2B-02"),
      (err: any) => err.code === "FORBIDDEN_VENDOR_SCOPE"
    );
    assert.throws(
      () => requireRecordAccess(vendorA, { customer_id: "CUST-B2B-02" }),
      (err: any) => err.code === "FORBIDDEN_RECORD_ACCESS"
    );
    assert.doesNotThrow(() => requireRecordAccess(vendorA, { customer_id: "CUST-B2B-01" }));
    assert.throws(
      () => requireRecordAccess(vendorB, { customer_id: "CUST-B2B-01" }),
      (err: any) => err.code === "FORBIDDEN_RECORD_ACCESS"
    );
  });

  it("9. restricts drivers to their assigned deliveries and tasks", () => {
    const driver = actor("driver", { id: "USR-DRV", name: "Davide Galli", email: "davide.galli@ascentra.it" });
    assert.doesNotThrow(() => assertDriverScope(driver, "Davide Galli"));
    assert.doesNotThrow(() => assertDriverScope(driver, "davide.galli@ascentra.it"));
    assert.throws(
      () => assertDriverScope(driver, "Other Driver"),
      (err: any) => err.code === "FORBIDDEN_DRIVER_SCOPE"
    );
    assert.throws(
      () => requireRecordAccess(driver, { driver: "Other Driver" }),
      (err: any) => err.code === "FORBIDDEN_RECORD_ACCESS"
    );
  });

  it("10. blocks a store vendor from reading another store's customer order (IDOR/BOLA)", () => {
    const order = submitCustomerOrder(adminActor, {
      customer_id: "CUST-B2B-01",
      delivery_date: addDaysIso(3),
      lines: [{ sku: "SKU-SAL-001", cases: 1 }]
    });

    const vendorOtherStore = actor("store_vendor", {
      id: "USR-CUST-SAVOIA",
      email: "fnb@hotelprincipedisavoia.it",
      store_id: "CUST-B2B-02"
    });

    assert.throws(
      () => getCustomerOrder(vendorOtherStore, order.id),
      (err: any) => err.code === "FORBIDDEN_RECORD_ACCESS"
    );

    assert.doesNotThrow(() => getCustomerOrder(adminActor, order.id));
  });

  // -------------------------------------------------------------------------
  // 4. Approval authority
  // -------------------------------------------------------------------------
  it("11. enforces configurable approval thresholds and maker-checker", () => {
    assert.equal(approvalRequired("purchase_order.approve", 600_000), true);
    assert.equal(approvalRequired("purchase_order.approve", 100_000), false);
    assert.equal(approvalRequired("quality.release.approve", null), true);

    assert.doesNotThrow(() => requireApprovalAuthority(qaActor, "quality.release.approve"));
    assert.doesNotThrow(() =>
      requireApprovalAuthority(financeActor, "credit_limit.change")
    );
    assert.throws(
      () => requireApprovalAuthority(pickerActor, "quality.release.approve"),
      (err: any) => err.statusCode === 403
    );
    assert.throws(
      () => requireApprovalAuthority(salesActor, "recall.activate"),
      (err: any) => err.statusCode === 403
    );

    // Maker-checker: the requester cannot approve their own operation.
    assert.throws(
      () =>
        requireApprovalAuthority(qaActor, "quality.release.approve", {
          requestedBy: qaActor.id
        }),
      (err: any) => err.code === "SEGREGATION_OF_DUTIES"
    );
  });

  // -------------------------------------------------------------------------
  // 5. Custom roles
  // -------------------------------------------------------------------------
  it("12. supports custom role lifecycle, assignment and revocation", () => {
    const unique = Date.now();
    const role = createAccessRole(adminActor, {
      code: `regional_ops_${unique}`,
      name: `Regional Ops ${unique}`,
      description: "Custom role limited to order reading",
      permissions: ["orders.read", "module.commercial"]
    });
    assert.equal(role.is_system, false);
    assert.deepEqual(role.permissions.sort(), ["module.commercial", "orders.read"].sort());

    const user = createAccessUser(adminActor, {
      name: "Custom Role User",
      email: `custom-${unique}@test.local`,
      password: "Ascentra!2026",
      roles: [role.code],
      warehouse: "Milan Cold Hub"
    });

    const before = getEffectiveAuthorization({ id: user.id, role: role.code });
    assert.ok(before.roles.includes(role.code));
    assert.ok(before.permissions.includes("orders.read"));
    assert.equal(before.permissions.includes("inventory.adjust"), false);

    // Role is in use: deactivation must be blocked.
    assert.throws(
      () => updateAccessRole(adminActor, role.code, { active: false }),
      (err: any) => err.statusCode === 409 && err.code === "ROLE_IN_USE"
    );

    // Grant an additional permission and confirm effective access changes.
    updateAccessRole(adminActor, role.code, {
      permissions: ["orders.read", "module.commercial", "orders.amend"]
    });
    const afterGrant = getEffectiveAuthorization({ id: user.id, role: role.code });
    assert.ok(afterGrant.permissions.includes("orders.amend"));

    // Reassign to a system role, then deactivate the custom role.
    updateAccessUser(adminActor, user.id, { roles: ["picker"] });
    updateAccessRole(adminActor, role.code, { active: false });
    const afterReassign = getEffectiveAuthorization({ id: user.id, role: "picker" });
    assert.equal(afterReassign.roles.includes(role.code), false);
  });

  it("13. duplicates a role with its permission set", () => {
    const unique = Date.now();
    const copy = duplicateAccessRole(adminActor, "sales", {
      code: `sales_copy_${unique}`,
      name: `Sales Copy ${unique}`
    });
    assert.equal(copy.base_role, "sales");
    assert.deepEqual(
      Array.from(new Set(copy.permissions)).sort(),
      Array.from(new Set(ROLE_PERMISSIONS.sales)).sort()
    );
  });

  // -------------------------------------------------------------------------
  // 6. Revocation and session refresh
  // -------------------------------------------------------------------------
  it("14. revokes refresh tokens and revalidates access after a role change", () => {
    const unique = Date.now();
    const user = createAccessUser(adminActor, {
      name: "Revocation Target",
      email: `revoke-${unique}@test.local`,
      password: "Ascentra!2026",
      roles: ["picker"],
      warehouse: "Milan Cold Hub"
    });

    const oldToken = tokenFor({
      id: user.id,
      email: user.email,
      name: user.name,
      role: "picker",
      warehouse: "Milan Cold Hub"
    });
    const refresh = createRefreshToken(user.id);
    assert.equal(getSessionUser(makeReq("/api/v1/auth/me", { token: oldToken }))?.role, "picker");

    updateAccessUser(adminActor, user.id, { roles: ["driver"] });

    // Refresh token family is revoked immediately.
    assert.throws(
      () => rotateRefreshToken(refresh.rawToken),
      /Invalid refresh token|revoked|reuse/i
    );

    // The next request resolves the persisted role, not the stale token claim.
    assert.equal(getSessionUser(makeReq("/api/v1/auth/me", { token: oldToken }))?.role, "driver");
  });

  it("15. suspends access and blocks the suspended account on the next request", () => {
    const unique = Date.now();
    const user = createAccessUser(adminActor, {
      name: "Suspension Target",
      email: `suspend-${unique}@test.local`,
      password: "Ascentra!2026",
      roles: ["sales"],
      warehouse: "Milan Cold Hub"
    });
    updateAccessUser(adminActor, user.id, { active: false });
    const suspended = getAccessUser(adminActor, user.id);
    assert.equal(suspended.active, false);
    assert.equal(getSessionUser(makeReq("/api/v1/auth/me", { token: tokenFor(user as any) })), null);
  });

  // -------------------------------------------------------------------------
  // 7. Direct API, deny-by-default, export/bulk and auth boundaries
  // -------------------------------------------------------------------------
  it("16. denies non-admins access to user and permission administration APIs", async () => {
    const pickerToken = tokenFor(pickerActor);
    const companyAdminToken = tokenFor(companyAdminActor);

    const denied = await getAdminUsers(makeReq("/api/v1/admin/users", { token: pickerToken }));
    assert.equal(denied.status, 403);

    const deniedPermissions = await getAdminPermissions(
      makeReq("/api/v1/admin/permissions", { token: pickerToken })
    );
    assert.equal(deniedPermissions.status, 403);

    const allowed = await getAdminUsers(
      makeReq("/api/v1/admin/users", { token: companyAdminToken })
    );
    assert.equal(allowed.status, 200);
  });

  it("17. denies non-finance roles access to reconciliation bulk import", async () => {
    const response = await postReconciliationImport(
      makeReq("/api/v1/finance/reconciliation/import", {
        token: tokenFor(pickerActor),
        body: { rows: [] }
      })
    );
    assert.equal(response.status, 403);
  });

  it("18. protects export endpoints with explicit permissions", async () => {
    const biExport = await getBiExport(
      makeReq("/api/v1/management/bi/export?format=csv", { token: tokenFor(pickerActor) })
    );
    assert.equal(biExport.status, 403);

    const consolidated = await getConsolidatedExport(
      makeReq("/api/v1/stores/consolidated/export", { token: tokenFor(pickerActor) })
    );
    assert.equal(consolidated.status, 403);
  });

  it("19. retires public self-service signup — accounts are created only via admins or reviewed requests", async () => {
    const email = `signup-${Date.now()}@test.local`;
    const signup = await postAuth(
      makeReq("/api/v1/auth", {
        body: {
          action: "signup",
          name: "Self Service",
          email,
          password: "Ascentra!2026",
          role: "super_admin"
        }
      })
    );
    assert.equal(signup.status, 410);
    const body = await signup.json();
    assert.equal(body?.error?.code, "PUBLIC_SIGNUP_RETIRED");
    const row = getDb().prepare("SELECT id FROM users WHERE lower(email) = ?").get(email);
    assert.equal(row, undefined, "no account may be created by the public signup endpoint");

    const switchAttempt = await postAuth(
      makeReq("/api/v1/auth", {
        token: tokenFor(pickerActor),
        body: { action: "switch_role", role: "super_admin" }
      })
    );
    assert.equal(switchAttempt.status, 403);
  });

  it("20. requires an authenticated identity for every protected endpoint", async () => {
    assert.throws(
      () => requirePermission(makeReq("/api/v1/admin/users"), "users.read"),
      (err: any) => err.statusCode === 401
    );
    const anon = await getAdminUsers(makeReq("/api/v1/admin/users"));
    assert.equal(anon.status, 401);
  });

  it("21. lists users only with their scopes and denies cross-tenant filtering", () => {
    const list = listAccessUsers(companyAdminActor, { limit: 100 });
    assert.ok(list.total >= 1);
    for (const user of list.users) {
      assert.ok(Array.isArray(user.roles));
      assert.ok(user.roles.length > 0, "Every active managed account must have at least one role");
    }

    assert.throws(
      () =>
        updateAccessUser(companyAdminActor, "USR-ADMIN", {
          roles: ["super_admin"]
        }),
      (err: any) => err.statusCode === 403
    );
  });

  it("22. refuses unknown permission grants and invalid role codes", () => {
    assert.throws(
      () =>
        createAccessRole(adminActor, {
          name: `Unknown permission ${Date.now()}`,
          permissions: ["does.not.exist"]
        }),
      (err: any) => err.code === "UNKNOWN_PERMISSION"
    );
    assert.throws(
      () =>
        createAccessUser(adminActor, {
          name: "Unknown Role",
          email: `unknown-role-${Date.now()}@test.local`,
          password: "Ascentra!2026",
          roles: ["not_a_role"]
        }),
      (err: any) => err.code === "ROLE_NOT_FOUND"
    );
  });
});
