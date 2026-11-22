import { getDb, withTransaction } from "@/server/db/connection";
import { ApiError } from "@/server/core/http";
import {
  AuthenticatedUser,
  assertPermission,
  getEffectiveAuthorization,
  hasPermission,
  recordAuditEvent,
  requireMutationAuthorization,
  requireRecordAccess,
  requireWarehouseAccess
} from "@/server/security/auth";
import {
  evaluateFefoAllocation,
  resolveMinimumShelfLifeRequirement,
  createStockReservation,
  releaseOrCancelReservation
} from "@/server/services/stock-intelligence.service";

/**
 * Customer order workflows authorize with order-level permissions
 * (orders.read / orders.manage) and enforce the customer + warehouse scope
 * themselves. Stock availability and reservation are evaluated with an internal
 * read grant so portal users never need broad raw-inventory visibility, while
 * every mutating stock action still requires orders:write / inventory.reserve.
 */
function withInternalInventoryRead(actor: AuthenticatedUser): AuthenticatedUser {
  const effective = Array.isArray(actor.permissions)
    ? actor.permissions
    : getEffectiveAuthorization({
        id: actor.id,
        role: actor.role,
        roles: actor.roles,
        warehouse: actor.warehouse,
        store_id: actor.store_id
      }).permissions;

  if (
    effective.includes("*") ||
    effective.includes("inventory.read") ||
    effective.includes("inventory:read")
  ) {
    return actor;
  }

  return { ...actor, permissions: [...effective, "inventory.read"] };
}

/**
 * Store/vendor portal accounts are customer-facing users, not Ascentra staff.
 * They can see their own commercial data (orders, invoices, payments, store
 * info) but never Ascentra's internal credit model, exposure levels or margins.
 * Staff roles see everything.
 */
const STORE_PORTAL_ROLES = new Set(["store_vendor", "store_user"]);
function isStorePortalActor(actor: AuthenticatedUser | null | undefined): boolean {
  return !!actor && STORE_PORTAL_ROLES.has(actor.role);
}

function sanitizeCreditEvaluationForActor<T extends Record<string, any>>(
  actor: AuthenticatedUser,
  credit: T
): T {
  if (!isStorePortalActor(actor)) return credit;
  return {
    ...credit,
    credit_limit_cents: 0,
    current_exposure_cents: 0,
    projected_exposure_cents: 0,
    remaining_credit_cents: 0,
    unpaid_invoices_cents: 0,
    active_orders_cents: 0,
    reason: credit?.is_allowed ? null : "Awaiting review by Ascentra finance."
  };
}

/**
 * Remove internal commercial fields (margins) from order records sent to
 * non-staff portal accounts.
 */
function sanitizeOrderRecordForActor<T extends { margin_pct: number | null }>(
  actor: AuthenticatedUser,
  record: T
): T {
  if (!isStorePortalActor(actor)) return record;
  return { ...record, margin_pct: null };
}

export type OrderWorkflowStatus =
  | "draft"
  | "submitted"
  | "pending_approval"
  | "confirmed"
  | "partially_confirmed"
  | "backordered"
  | "processing"
  | "completed"
  | "cancelled";

export type PricingSourceType =
  | "promotion"
  | "contract_tier"
  | "contract_base"
  | "segment"
  | "standard";

export interface CustomerContractItem {
  id: string;
  contract_id: string;
  sku: string;
  unit_price_cents: number;
  uom: string;
  min_quantity: number;
  discount_pct: number;
  promotional_price_cents: number | null;
  promo_start: string | null;
  promo_end: string | null;
  customer_sku: string | null;
  is_exclusive: boolean;
  notes: string | null;
  product_name?: string;
  category?: string;
}

export interface CustomerContract {
  id: string;
  contract_number: string;
  customer_id: string;
  customer_name?: string;
  title: string;
  start_date: string;
  end_date: string;
  currency: string;
  payment_terms: string;
  credit_limit_cents: number | null;
  discount_pct: number;
  status: "active" | "expired" | "suspended" | "draft";
  notes: string | null;
  items: CustomerContractItem[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PricingResolution {
  sku: string;
  product_name: string;
  requested_quantity: number;
  unit_price_cents: number;
  original_list_price_cents: number;
  discount_cents: number;
  discount_pct: number;
  pricing_source: PricingSourceType;
  contract_id: string | null;
  contract_number: string | null;
  currency: string;
  vat_rate_pct: number;
  line_subtotal_cents: number;
  line_tax_cents: number;
  line_total_cents: number;
  uom: string;
}

export interface CreditEvaluationResult {
  customer_id: string;
  customer_name: string;
  credit_limit_cents: number;
  unpaid_invoices_cents: number;
  active_orders_cents: number;
  current_exposure_cents: number;
  order_total_cents: number;
  projected_exposure_cents: number;
  remaining_credit_cents: number;
  credit_status: "clear" | "warning" | "exceeded" | "blocked";
  is_allowed: boolean;
  account_status: string;
  payment_terms: string;
  reason: string | null;
}

export interface LineFulfillmentEvaluation {
  sku: string;
  product_name: string;
  requested_cases: number;
  allocated_cases: number;
  shortfall_cases: number;
  is_fully_available: boolean;
  is_partially_available: boolean;
  pricing: PricingResolution;
  min_shelf_life_days_required: number;
  shelf_life_rules_applied: string[];
  allocations: Array<{
    internal_lot: string;
    supplier_batch: string;
    warehouse: string;
    bin_code: string;
    expiry_date: string;
    days_remaining_at_delivery: number;
    allocated_cases: number;
    fefo_rank: number;
  }>;
  exclusion_reasons: string[];
}

export interface OrderPrevalidationResult {
  valid: boolean;
  customer_id: string;
  customer_name: string;
  can_confirm_immediately: boolean;
  requires_credit_approval: boolean;
  requires_stock_backorder: boolean;
  summary: {
    total_lines: number;
    total_requested_cases: number;
    total_allocated_cases: number;
    total_shortfall_cases: number;
    subtotal_cents: number;
    tax_cents: number;
    total_cents: number;
  };
  credit_evaluation: CreditEvaluationResult;
  lines: LineFulfillmentEvaluation[];
  errors: string[];
  warnings: string[];
}

export interface CustomerOrderLineRecord {
  id: string;
  order_id: string;
  sku: string;
  product_name: string;
  cases_ordered: number;
  cases_allocated: number;
  cases_backordered: number;
  uom: string;
  unit_price_cents: number;
  original_list_price_cents: number;
  discount_cents: number;
  pricing_source: PricingSourceType;
  contract_id: string | null;
  vat_rate_pct: number;
  tax_cents: number;
  line_total_cents: number;
  line_status: string;
  batch_id: string | null;
  weight_kg: number;
  shelf_life_min_days: number;
  shelf_life_verified: boolean;
  notes: string | null;
  allocations?: Array<{
    internal_lot: string;
    supplier_batch: string | null;
    warehouse: string;
    bin_code: string | null;
    expiry_date: string;
    allocated_cases: number;
    fefo_rank: number | null;
  }>;
}

export interface CustomerOrderEventRecord {
  id: string;
  order_id: string;
  order_number: string;
  customer_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface CustomerNotificationRecord {
  id: string;
  customer_id: string;
  order_id: string | null;
  order_number: string | null;
  channel: string;
  category: string;
  title: string;
  body: string;
  status: string;
  read_at: string | null;
  sent_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface CustomerOrderRecord {
  id: string;
  order_number: string;
  customer_id: string;
  customer: string;
  customer_name: string;
  segment: string;
  channel: string;
  status: OrderWorkflowStatus;
  po_reference: string | null;
  delivery_date: string;
  delivery_address: string;
  delivery_notes: string | null;
  warehouse: string;
  payment_terms: string;
  items_count: number;
  cases_total: number;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  margin_pct: number | null;
  fefo_allocated: boolean;
  credit_hold: boolean;
  credit_hold_reason: string | null;
  approval_status: "none" | "pending" | "approved" | "rejected";
  approval_notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  cancellation_reason: string | null;
  is_backorder: boolean;
  created_by: string;
  submitted_at: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  lines: CustomerOrderLineRecord[];
  deliveries?: Array<{
    id: string;
    route_code: string;
    driver: string;
    vehicle: string;
    eta: string;
    status: string;
    pod_signed: boolean;
    temp_c: number;
  }>;
  invoices?: Array<{
    id: string;
    invoice_number: string;
    amount_cents: number;
    paid_cents: number;
    status: string;
    sdi_status: string;
    due_date: string;
  }>;
  events?: CustomerOrderEventRecord[];
  notifications?: CustomerNotificationRecord[];
}

export interface CatalogProductItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  origin: string;
  uom: string;
  temp_zone: string;
  shelf_life_days: number;
  min_shelf_life_days_required: number;
  stock_cases_available: number;
  stock_cases_physical: number;
  stock_cases_reserved: number;
  is_in_stock: boolean;
  pricing: PricingResolution;
  has_contract: boolean;
  has_promo: boolean;
  has_volume_discount: boolean;
  allergens: string[];
  vat_rate_pct: number;
  status: string;
}

// ----------------------------------------------------------------------------
// Helper: Resolve customer identity & enforce scope
// ----------------------------------------------------------------------------
function resolveCustomerScope(
  actor: AuthenticatedUser,
  requestedCustomerId?: string | null
): { id: string; name: string; segment: string; status: string; credit_limit_cents: number; delivery_address: string; payment_terms: string } {
  const db = getDb();

  // If actor is a customer / store vendor, enforce they can ONLY operate on their own store
  if (actor.role === "store_vendor" || actor.role === "store_user") {
    if (!actor.store_id) {
      throw new ApiError(403, "FORBIDDEN_STORE_SCOPE", "Customer user has no associated customer or store ID.");
    }
    if (requestedCustomerId && requestedCustomerId !== actor.store_id) {
      throw new ApiError(
        403,
        "FORBIDDEN_CUSTOMER_ACCESS",
        `Access denied. Customer account is restricted to customer '${actor.store_id}'. Cannot access '${requestedCustomerId}'.`
      );
    }
    requestedCustomerId = actor.store_id;
  }

  // If no customer requested and actor is staff, return error if customer is required
  const targetId = requestedCustomerId?.trim() || actor.store_id;
  if (!targetId) {
    throw new ApiError(400, "CUSTOMER_REQUIRED", "Customer ID must be specified.");
  }

  const row = db.prepare(`
    SELECT id, name, segment, customer_type, status, credit_limit_cents, current_exposure_cents,
           delivery_address, payment_terms, min_shelf_life_days
    FROM customers
    WHERE id = ? OR lower(name) = lower(?)
    LIMIT 1
  `).get(targetId, targetId) as any;

  if (!row) {
    throw new ApiError(404, "CUSTOMER_NOT_FOUND", `Customer '${targetId}' was not found in the system.`);
  }

  return {
    id: row.id,
    name: row.name,
    segment: row.segment || "Fine Dining",
    status: row.status || "active",
    credit_limit_cents: Number(row.credit_limit_cents) || 1500000,
    delivery_address: row.delivery_address || `${row.name}, Milan`,
    payment_terms: row.payment_terms || "Net 30"
  };
}

// ----------------------------------------------------------------------------
// 1. Contract Pricing Engine: Pricing Precedence System
// Precedence:
//   1. Active Promotion on SKU (within promo_start and promo_end)
//   2. Customer Contract Volume Tier (min_quantity <= requested quantity)
//   3. Customer Contract Base Price (min_quantity = 1 or default contract price)
//   4. Customer Segment Price (from product_prices matching customer.segment)
//   5. Standard Catalog Base Price (from products.unit_price_cents)
// ----------------------------------------------------------------------------
export function resolveProductPricing(
  actor: AuthenticatedUser,
  params: {
    customer_id: string;
    sku: string;
    quantity: number;
    target_date?: string;
  }
): PricingResolution {
  const db = getDb();
  const quantity = Math.max(1, Math.round(Number(params.quantity) || 1));
  const targetDate = params.target_date?.trim().slice(0, 10) || new Date().toISOString().slice(0, 10);

  // Validate customer existence and scope
  const customer = resolveCustomerScope(actor, params.customer_id);

  // 1. Fetch Product
  const product = db.prepare(`
    SELECT id, sku, name, unit_price_cents, vat_rate_pct, uom, status
    FROM products
    WHERE sku = ?
    LIMIT 1
  `).get(params.sku) as any;

  if (!product) {
    throw new ApiError(404, "PRODUCT_NOT_FOUND", `Product SKU '${params.sku}' not found.`);
  }

  const originalListPriceCents = Number(product.unit_price_cents) || 0;
  const vatRatePct = Number(product.vat_rate_pct) || 4.0;
  const uom = product.uom || "case";

  // 2. Query active contracts for this customer
  const contracts = db.prepare(`
    SELECT c.id as contract_id, c.contract_number, c.currency,
           i.id as item_id, i.unit_price_cents, i.min_quantity, i.discount_pct,
           i.promotional_price_cents, i.promo_start, i.promo_end, i.customer_sku, i.notes
    FROM customer_contracts c
    JOIN customer_contract_items i ON i.contract_id = c.id
    WHERE c.customer_id = ?
      AND c.status = 'active'
      AND c.start_date <= ?
      AND c.end_date >= ?
      AND i.sku = ?
    ORDER BY i.min_quantity DESC, i.unit_price_cents ASC
  `).all(customer.id, targetDate, targetDate, params.sku) as any[];

  // Step 1: Check Active Promotion
  for (const c of contracts) {
    if (
      c.promotional_price_cents &&
      c.promotional_price_cents > 0 &&
      c.promo_start &&
      c.promo_end &&
      targetDate >= c.promo_start.slice(0, 10) &&
      targetDate <= c.promo_end.slice(0, 10)
    ) {
      const unitPriceCents = Number(c.promotional_price_cents);
      const discountCents = Math.max(0, originalListPriceCents - unitPriceCents);
      const discountPct = originalListPriceCents > 0
        ? Math.round((discountCents / originalListPriceCents) * 1000) / 10
        : 0;
      const lineSubtotal = unitPriceCents * quantity;
      const lineTax = Math.round(lineSubtotal * (vatRatePct / 100));

      return {
        sku: product.sku,
        product_name: product.name,
        requested_quantity: quantity,
        unit_price_cents: unitPriceCents,
        original_list_price_cents: originalListPriceCents,
        discount_cents: discountCents,
        discount_pct: discountPct,
        pricing_source: "promotion",
        contract_id: c.contract_id,
        contract_number: c.contract_number,
        currency: c.currency || "EUR",
        vat_rate_pct: vatRatePct,
        line_subtotal_cents: lineSubtotal,
        line_tax_cents: lineTax,
        line_total_cents: lineSubtotal + lineTax,
        uom
      };
    }
  }

  // Step 2: Check Volume Tier (quantity >= min_quantity and min_quantity > 1)
  const volumeTier = contracts.find((c) => c.min_quantity > 1 && quantity >= c.min_quantity);
  if (volumeTier) {
    const unitPriceCents = Number(volumeTier.unit_price_cents);
    const discountCents = Math.max(0, originalListPriceCents - unitPriceCents);
    const discountPct = originalListPriceCents > 0
      ? Math.round((discountCents / originalListPriceCents) * 1000) / 10
      : Number(volumeTier.discount_pct) || 0;
    const lineSubtotal = unitPriceCents * quantity;
    const lineTax = Math.round(lineSubtotal * (vatRatePct / 100));

    return {
      sku: product.sku,
      product_name: product.name,
      requested_quantity: quantity,
      unit_price_cents: unitPriceCents,
      original_list_price_cents: originalListPriceCents,
      discount_cents: discountCents,
      discount_pct: discountPct,
      pricing_source: "contract_tier",
      contract_id: volumeTier.contract_id,
      contract_number: volumeTier.contract_number,
      currency: volumeTier.currency || "EUR",
      vat_rate_pct: vatRatePct,
      line_subtotal_cents: lineSubtotal,
      line_tax_cents: lineTax,
      line_total_cents: lineSubtotal + lineTax,
      uom
    };
  }

  // Step 3: Check Customer Contract Base Price (min_quantity <= 1)
  const baseContract = contracts.find((c) => c.min_quantity <= 1) || contracts[0];
  if (baseContract) {
    const unitPriceCents = Number(baseContract.unit_price_cents);
    const discountCents = Math.max(0, originalListPriceCents - unitPriceCents);
    const discountPct = originalListPriceCents > 0
      ? Math.round((discountCents / originalListPriceCents) * 1000) / 10
      : Number(baseContract.discount_pct) || 0;
    const lineSubtotal = unitPriceCents * quantity;
    const lineTax = Math.round(lineSubtotal * (vatRatePct / 100));

    return {
      sku: product.sku,
      product_name: product.name,
      requested_quantity: quantity,
      unit_price_cents: unitPriceCents,
      original_list_price_cents: originalListPriceCents,
      discount_cents: discountCents,
      discount_pct: discountPct,
      pricing_source: "contract_base",
      contract_id: baseContract.contract_id,
      contract_number: baseContract.contract_number,
      currency: baseContract.currency || "EUR",
      vat_rate_pct: vatRatePct,
      line_subtotal_cents: lineSubtotal,
      line_tax_cents: lineTax,
      line_total_cents: lineSubtotal + lineTax,
      uom
    };
  }

  // Step 4: Check Customer Segment Price from `product_prices`
  const segmentPriceRow = db.prepare(`
    SELECT amount_cents, currency
    FROM product_prices
    WHERE sku = ?
      AND (lower(customer_segment) = lower(?) OR lower(customer_segment) = lower(?))
      AND status = 'active'
      AND effective_from <= ?
      AND (effective_to IS NULL OR effective_to >= ?)
    ORDER BY effective_from DESC
    LIMIT 1
  `).get(params.sku, customer.segment, customer.segment.replace(/\s+/g, "_"), targetDate, targetDate) as any;

  if (segmentPriceRow) {
    const unitPriceCents = Number(segmentPriceRow.amount_cents);
    const discountCents = Math.max(0, originalListPriceCents - unitPriceCents);
    const discountPct = originalListPriceCents > 0
      ? Math.round((discountCents / originalListPriceCents) * 1000) / 10
      : 0;
    const lineSubtotal = unitPriceCents * quantity;
    const lineTax = Math.round(lineSubtotal * (vatRatePct / 100));

    return {
      sku: product.sku,
      product_name: product.name,
      requested_quantity: quantity,
      unit_price_cents: unitPriceCents,
      original_list_price_cents: originalListPriceCents,
      discount_cents: discountCents,
      discount_pct: discountPct,
      pricing_source: "segment",
      contract_id: null,
      contract_number: null,
      currency: segmentPriceRow.currency || "EUR",
      vat_rate_pct: vatRatePct,
      line_subtotal_cents: lineSubtotal,
      line_tax_cents: lineTax,
      line_total_cents: lineSubtotal + lineTax,
      uom
    };
  }

  // Step 5: Fall back to Standard Catalog Price
  const lineSubtotal = originalListPriceCents * quantity;
  const lineTax = Math.round(lineSubtotal * (vatRatePct / 100));

  return {
    sku: product.sku,
    product_name: product.name,
    requested_quantity: quantity,
    unit_price_cents: originalListPriceCents,
    original_list_price_cents: originalListPriceCents,
    discount_cents: 0,
    discount_pct: 0,
    pricing_source: "standard",
    contract_id: null,
    contract_number: null,
    currency: "EUR",
    vat_rate_pct: vatRatePct,
    line_subtotal_cents: lineSubtotal,
    line_tax_cents: lineTax,
    line_total_cents: lineSubtotal + lineTax,
    uom
  };
}

// ----------------------------------------------------------------------------
// 2. Credit Limit & Payment Terms Engine
// Server-side validation of customer credit limit, current unpaid invoices,
// active orders exposure, account status, and maker-checker requirements.
// ----------------------------------------------------------------------------
export function validateCustomerCredit(
  actor: AuthenticatedUser,
  params: {
    customer_id: string;
    new_order_cents: number;
    exclude_order_id?: string;
  }
): CreditEvaluationResult {
  const db = getDb();
  const customer = resolveCustomerScope(actor, params.customer_id);
  const newOrderCents = Math.max(0, Math.round(Number(params.new_order_cents) || 0));

  // 1. Unpaid invoices exposure: sum of (amount_cents - paid_cents) for unpaid/partially paid
  const unpaidInvoicesRow = db.prepare(`
    SELECT coalesce(SUM(amount_cents - paid_cents), 0) as total_unpaid
    FROM invoices
    WHERE customer_id = ? AND status != 'paid'
  `).get(customer.id) as { total_unpaid: number };
  const unpaidInvoicesCents = Number(unpaidInvoicesRow?.total_unpaid) || 0;

  // 2. Active orders exposure: sum of open confirmed/picking/processing orders not yet invoiced
  const excludeClause = params.exclude_order_id ? "AND id != ?" : "";
  const queryParams = params.exclude_order_id
    ? [customer.id, params.exclude_order_id]
    : [customer.id];

  const activeOrdersRow = db.prepare(`
    SELECT coalesce(SUM(total_cents), 0) as total_active
    FROM sales_orders
    WHERE customer_id = ?
      AND status IN ('confirmed', 'picking', 'dispatched', 'partially_confirmed', 'processing')
      ${excludeClause}
  `).get(...queryParams) as { total_active: number };
  const activeOrdersCents = Number(activeOrdersRow?.total_active) || 0;

  const currentExposureCents = unpaidInvoicesCents + activeOrdersCents;
  const projectedExposureCents = currentExposureCents + newOrderCents;
  const creditLimitCents = customer.credit_limit_cents;
  const remainingCreditCents = creditLimitCents - projectedExposureCents;

  // 3. Evaluate Account Status & Credit Limits
  const accountStatus = (customer.status || "active").toLowerCase();

  // If customer is explicitly blocked, suspended, or on credit hold
  if (accountStatus === "credit_hold" || accountStatus === "suspended" || accountStatus === "blocked") {
    return {
      customer_id: customer.id,
      customer_name: customer.name,
      credit_limit_cents: creditLimitCents,
      unpaid_invoices_cents: unpaidInvoicesCents,
      active_orders_cents: activeOrdersCents,
      current_exposure_cents: currentExposureCents,
      order_total_cents: newOrderCents,
      projected_exposure_cents: projectedExposureCents,
      remaining_credit_cents: remainingCreditCents,
      credit_status: "blocked",
      is_allowed: false,
      account_status: customer.status,
      payment_terms: customer.payment_terms,
      reason: `Customer account is '${customer.status.toUpperCase()}'. New orders are blocked from automatic confirmation.`
    };
  }

  // If projected exposure exceeds credit limit
  if (projectedExposureCents > creditLimitCents) {
    const excessCents = projectedExposureCents - creditLimitCents;
    return {
      customer_id: customer.id,
      customer_name: customer.name,
      credit_limit_cents: creditLimitCents,
      unpaid_invoices_cents: unpaidInvoicesCents,
      active_orders_cents: activeOrdersCents,
      current_exposure_cents: currentExposureCents,
      order_total_cents: newOrderCents,
      projected_exposure_cents: projectedExposureCents,
      remaining_credit_cents: remainingCreditCents,
      credit_status: "exceeded",
      is_allowed: false,
      account_status: customer.status,
      payment_terms: customer.payment_terms,
      reason: `Projected exposure €${(projectedExposureCents / 100).toFixed(2)} exceeds approved credit limit of €${(
        creditLimitCents / 100
      ).toFixed(2)} by €${(excessCents / 100).toFixed(2)}.`
    };
  }

  // If within 90% threshold (Warning)
  if (projectedExposureCents > creditLimitCents * 0.9) {
    return {
      customer_id: customer.id,
      customer_name: customer.name,
      credit_limit_cents: creditLimitCents,
      unpaid_invoices_cents: unpaidInvoicesCents,
      active_orders_cents: activeOrdersCents,
      current_exposure_cents: currentExposureCents,
      order_total_cents: newOrderCents,
      projected_exposure_cents: projectedExposureCents,
      remaining_credit_cents: remainingCreditCents,
      credit_status: "warning",
      is_allowed: true,
      account_status: customer.status,
      payment_terms: customer.payment_terms,
      reason: `Order utilizes ${(projectedExposureCents / creditLimitCents * 100).toFixed(1)}% of total credit limit (€${(remainingCreditCents / 100).toFixed(2)} remaining).`
    };
  }

  // Clear
  return {
    customer_id: customer.id,
    customer_name: customer.name,
    credit_limit_cents: creditLimitCents,
    unpaid_invoices_cents: unpaidInvoicesCents,
    active_orders_cents: activeOrdersCents,
    current_exposure_cents: currentExposureCents,
    order_total_cents: newOrderCents,
    projected_exposure_cents: projectedExposureCents,
    remaining_credit_cents: remainingCreditCents,
    credit_status: "clear",
    is_allowed: true,
    account_status: customer.status,
    payment_terms: customer.payment_terms,
    reason: null
  };
}

// ----------------------------------------------------------------------------
// 3. Real-Time Stock Availability & Shelf-Life Check (Integrated with Module 06)
// ----------------------------------------------------------------------------
export function evaluateOrderLineStock(
  actor: AuthenticatedUser,
  params: {
    customer_id: string;
    sku: string;
    cases: number;
    delivery_date: string;
    warehouse?: string;
  }
): LineFulfillmentEvaluation {
  const customer = resolveCustomerScope(actor, params.customer_id);
  const warehouse = params.warehouse || "Milan Cold Hub";
  const deliveryDate = params.delivery_date.slice(0, 10);
  const requestedCases = Math.max(1, Math.round(Number(params.cases) || 1));

  // 1. Resolve pricing snapshot
  const pricing = resolveProductPricing(actor, {
    customer_id: customer.id,
    sku: params.sku,
    quantity: requestedCases,
    target_date: deliveryDate
  });

  // 2. Query Module 06 stock intelligence FEFO evaluation
  // This automatically respects shelf-life rules and skips quarantined/held/damaged/expired lots
  let fefoEval: any = null;
  const exclusionReasons: string[] = [];
  let minShelfLifeRequired = 3;
  let appliedShelfLifeRules: string[] = [];

  try {
    const shelfReq = resolveMinimumShelfLifeRequirement({
      sku: params.sku,
      customer_id: customer.id
    });
    minShelfLifeRequired = shelfReq.min_remaining_days;
    appliedShelfLifeRules = shelfReq.applied_rules;

    fefoEval = evaluateFefoAllocation(withInternalInventoryRead(actor), {
      sku: params.sku,
      requested_cases: requestedCases,
      delivery_date: deliveryDate,
      customer_id: customer.id,
      warehouse,
      allow_partial: true,
      persist_log: false
    });
  } catch (err: any) {
    if (err?.code === "INSUFFICIENT_ELIGIBLE_STOCK" || err?.statusCode === 409) {
      exclusionReasons.push(err.message || "Insufficient eligible stock for delivery date.");
    } else {
      throw err;
    }
  }

  const allocatedCases = fefoEval ? fefoEval.allocated_cases : 0;
  const shortfallCases = requestedCases - allocatedCases;
  const isFullyAvailable = fefoEval ? fefoEval.fully_allocated : false;
  const isPartiallyAvailable = allocatedCases > 0 && allocatedCases < requestedCases;

  const allocations = fefoEval
    ? fefoEval.allocations.map((a: any) => ({
        internal_lot: a.internal_lot,
        supplier_batch: a.supplier_batch,
        warehouse: a.warehouse,
        bin_code: a.bin_code,
        expiry_date: a.expiry_date,
        days_remaining_at_delivery: a.days_remaining_at_delivery,
        allocated_cases: a.allocated_cases,
        fefo_rank: a.fefo_rank
      }))
    : [];

  if (fefoEval?.candidates) {
    fefoEval.candidates.forEach((c: any) => {
      if (!c.eligible && c.exclusion_reasons && c.exclusion_reasons.length > 0) {
        exclusionReasons.push(...c.exclusion_reasons);
      }
    });
  }

  return {
    sku: pricing.sku,
    product_name: pricing.product_name,
    requested_cases: requestedCases,
    allocated_cases: allocatedCases,
    shortfall_cases: shortfallCases,
    is_fully_available: isFullyAvailable,
    is_partially_available: isPartiallyAvailable,
    pricing,
    min_shelf_life_days_required: fefoEval ? fefoEval.min_shelf_life_days_required : minShelfLifeRequired,
    shelf_life_rules_applied: fefoEval ? fefoEval.applied_shelf_life_rules : appliedShelfLifeRules,
    allocations,
    exclusion_reasons: Array.from(new Set(exclusionReasons))
  };
}

// ----------------------------------------------------------------------------
// 4. Pre-Validation: Full Order Pre-flight Inspection
// ----------------------------------------------------------------------------
export function validateCustomerOrder(
  actor: AuthenticatedUser,
  input: {
    customer_id?: string;
    delivery_date: string;
    warehouse?: string;
    lines: Array<{ sku: string; cases: number; uom?: string }>;
    exclude_order_id?: string;
  }
): OrderPrevalidationResult {
  const customer = resolveCustomerScope(actor, input.customer_id);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.lines || input.lines.length === 0) {
    errors.push("Order must contain at least one line item.");
  }

  const deliveryDate = input.delivery_date?.trim().slice(0, 10);
  if (!deliveryDate) {
    errors.push("Requested delivery date is required.");
  } else {
    const today = new Date().toISOString().slice(0, 10);
    if (deliveryDate < today) {
      errors.push(`Requested delivery date '${deliveryDate}' cannot be in the past.`);
    }
  }

  const evaluatedLines: LineFulfillmentEvaluation[] = [];
  let totalSubtotalCents = 0;
  let totalTaxCents = 0;
  let totalRequestedCases = 0;
  let totalAllocatedCases = 0;
  let totalShortfallCases = 0;

  for (const line of input.lines || []) {
    const lineEval = evaluateOrderLineStock(actor, {
      customer_id: customer.id,
      sku: line.sku,
      cases: line.cases,
      delivery_date: deliveryDate || new Date().toISOString().slice(0, 10),
      warehouse: input.warehouse
    });

    evaluatedLines.push(lineEval);
    totalRequestedCases += lineEval.requested_cases;
    totalAllocatedCases += lineEval.allocated_cases;
    totalShortfallCases += lineEval.shortfall_cases;
    totalSubtotalCents += lineEval.pricing.line_subtotal_cents;
    totalTaxCents += lineEval.pricing.line_tax_cents;

    if (!lineEval.is_fully_available) {
      if (lineEval.allocated_cases === 0) {
        warnings.push(
          `Line ${lineEval.sku} (${lineEval.product_name}): 0 of ${lineEval.requested_cases} cases eligible for delivery by ${deliveryDate}. Stock is backordered or does not satisfy minimum ${lineEval.min_shelf_life_days_required}-day shelf life.`
        );
      } else {
        warnings.push(
          `Line ${lineEval.sku} (${lineEval.product_name}): Partial stock. Only ${lineEval.allocated_cases} of ${lineEval.requested_cases} cases available (${lineEval.shortfall_cases} cases backordered).`
        );
      }
    }
  }

  const totalCents = totalSubtotalCents + totalTaxCents;

  // Credit check
  const creditEval = validateCustomerCredit(actor, {
    customer_id: customer.id,
    new_order_cents: totalCents,
    exclude_order_id: input.exclude_order_id
  });

  if (!creditEval.is_allowed) {
    warnings.push(`Credit exception: ${creditEval.reason}`);
  }

  const valid = errors.length === 0;
  const canConfirmImmediately = valid && creditEval.is_allowed && totalShortfallCases === 0;
  const requiresCreditApproval = !creditEval.is_allowed;
  const requiresStockBackorder = totalShortfallCases > 0;

  return {
    valid,
    customer_id: customer.id,
    customer_name: customer.name,
    can_confirm_immediately: canConfirmImmediately,
    requires_credit_approval: requiresCreditApproval,
    requires_stock_backorder: requiresStockBackorder,
    summary: {
      total_lines: evaluatedLines.length,
      total_requested_cases: totalRequestedCases,
      total_allocated_cases: totalAllocatedCases,
      total_shortfall_cases: totalShortfallCases,
      subtotal_cents: totalSubtotalCents,
      tax_cents: totalTaxCents,
      total_cents: totalCents
    },
    credit_evaluation: sanitizeCreditEvaluationForActor(actor, creditEval),
    lines: evaluatedLines,
    errors,
    warnings
  };
}

// ----------------------------------------------------------------------------
// 5. Submit Customer Order Workflow
// Supports multiple lines, atomic stock reservation creation, backorders,
// and maker-checker credit hold workflow.
// ----------------------------------------------------------------------------
export function submitCustomerOrder(
  actor: AuthenticatedUser,
  input: {
    customer_id?: string;
    channel?: "b2b_portal" | "sales_rep" | "edi" | "phone";
    po_reference?: string;
    delivery_date: string;
    delivery_address?: string;
    delivery_notes?: string;
    warehouse?: string;
    allow_backorders?: boolean;
    lines: Array<{ sku: string; cases: number; uom?: string; notes?: string }>;
  }
): CustomerOrderRecord {
  assertPermission(actor, "orders.manage");
  requireMutationAuthorization(actor, "submit customer order");

  const customer = resolveCustomerScope(actor, input.customer_id);
  const warehouse = input.warehouse || "Milan Cold Hub";
  requireWarehouseAccess(actor, warehouse);

  // Run comprehensive pre-validation
  const validation = validateCustomerOrder(actor, {
    customer_id: customer.id,
    delivery_date: input.delivery_date,
    warehouse,
    lines: input.lines
  });

  if (!validation.valid) {
    throw new ApiError(400, "VALIDATION_FAILED", validation.errors.join("; "));
  }

  const allowBackorders = input.allow_backorders !== false;
  if (!allowBackorders && validation.requires_stock_backorder) {
    throw new ApiError(
      400,
      "BACKORDER_NOT_PERMITTED",
      `Customer or order specifies no backorders permitted, but ${validation.summary.total_shortfall_cases} cases cannot be immediately fulfilled.`
    );
  }

  const db = getDb();

  // Generate order number SO-2026-XXXX
  const existingNums = db
    .prepare(`SELECT order_number FROM sales_orders WHERE order_number LIKE 'SO-2026-%'`)
    .all() as Array<{ order_number: string }>;
  const maxSuffix = existingNums.reduce((max, r) => {
    const num = Number(r.order_number.replace("SO-2026-", ""));
    return Number.isFinite(num) && num > max ? num : max;
  }, 9847);
  const orderNumber = `SO-2026-${maxSuffix + 1}`;
  const orderId = orderNumber; // using order number as primary ID for consistency

  const isCreditBlocked = !validation.credit_evaluation.is_allowed;
  const isPartial = validation.requires_stock_backorder;

  // Determine initial workflow status
  let initialStatus: OrderWorkflowStatus;
  let approvalStatus: "none" | "pending" | "approved" = "none";
  let creditHold = 0;
  let creditHoldReason: string | null = null;

  if (isCreditBlocked) {
    initialStatus = "pending_approval";
    approvalStatus = "pending";
    creditHold = 1;
    creditHoldReason = validation.credit_evaluation.reason;
  } else if (isPartial) {
    initialStatus = "partially_confirmed";
  } else {
    initialStatus = "confirmed";
  }

  const nowIso = new Date().toISOString();
  const deliveryDate = input.delivery_date.slice(0, 10);
  const deliveryAddress = input.delivery_address?.trim() || customer.delivery_address;
  const channel = input.channel || "b2b_portal";

  // Execute in ACID Transaction
  return withTransaction(() => {
    // 1. Insert Sales Order Header
    db.prepare(`
      INSERT INTO sales_orders (
        id, order_number, customer_id, customer, segment, channel, status,
        credit_hold, credit_hold_reason, items_count, cases_total,
        subtotal_cents, tax_cents, total_cents, margin_pct,
        delivery_date, delivery_address, delivery_notes, po_reference,
        warehouse, fefo_allocated, payment_terms, approval_status,
        submitted_at, confirmed_at, is_backorder, created_by, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      )
    `).run(
      orderId,
      orderNumber,
      customer.id,
      customer.name,
      customer.segment,
      channel,
      initialStatus,
      creditHold,
      creditHoldReason,
      validation.lines.length,
      validation.summary.total_requested_cases,
      validation.summary.subtotal_cents,
      validation.summary.tax_cents,
      validation.summary.total_cents,
      28.5, // margin %
      deliveryDate,
      deliveryAddress,
      input.delivery_notes || null,
      input.po_reference || null,
      warehouse,
      initialStatus === "confirmed" || initialStatus === "partially_confirmed" ? 1 : 0,
      customer.payment_terms,
      approvalStatus,
      nowIso,
      initialStatus === "confirmed" || initialStatus === "partially_confirmed" ? nowIso : null,
      isPartial ? 1 : 0,
      actor.email || actor.name,
      nowIso,
      nowIso
    );

    // 2. Insert Sales Order Lines & Create Stock Reservations atomically if confirmed
    const insertedLines: CustomerOrderLineRecord[] = [];

    for (let i = 0; i < validation.lines.length; i++) {
      const line = validation.lines[i];
      const lineId = `SOL-${orderNumber.replace("SO-2026-", "")}-${i + 1}`;
      const lineStatus =
        initialStatus === "pending_approval"
          ? "pending_approval"
          : line.shortfall_cases > 0 && line.allocated_cases > 0
            ? "partially_allocated"
            : line.allocated_cases === 0
              ? "backordered"
              : "confirmed";

      const primaryBatchId = line.allocations[0]?.internal_lot || null;

      db.prepare(`
        INSERT INTO sales_order_lines (
          id, order_id, sku, product_name, cases_ordered, cases_allocated, cases_backordered,
          uom, unit_price_cents, original_list_price_cents, discount_cents, pricing_source,
          contract_id, vat_rate_pct, tax_cents, line_total_cents, line_status,
          batch_id, weight_kg, shelf_life_min_days, shelf_life_verified, notes
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, 1, ?
        )
      `).run(
        lineId,
        orderId,
        line.sku,
        line.product_name,
        line.requested_cases,
        initialStatus === "pending_approval" ? 0 : line.allocated_cases,
        line.shortfall_cases,
        line.pricing.uom,
        line.pricing.unit_price_cents,
        line.pricing.original_list_price_cents,
        line.pricing.discount_cents,
        line.pricing.pricing_source,
        line.pricing.contract_id,
        line.pricing.vat_rate_pct,
        line.pricing.line_tax_cents,
        line.pricing.line_total_cents,
        lineStatus,
        primaryBatchId,
        line.requested_cases * 5.0, // estimated weight
        line.min_shelf_life_days_required,
        null
      );

      // If order is confirmed or partially confirmed, lock in stock reservations via Module 06
      if (initialStatus === "confirmed" || initialStatus === "partially_confirmed") {
        for (const alloc of line.allocations) {
          if (alloc.allocated_cases > 0) {
            createStockReservation(withInternalInventoryRead(actor), {
              order_id: orderId,
              order_number: orderNumber,
              order_line_id: lineId,
              customer_id: customer.id,
              customer_name: customer.name,
              sku: line.sku,
              internal_lot: alloc.internal_lot,
              warehouse: alloc.warehouse,
              requested_cases: alloc.allocated_cases,
              delivery_date: deliveryDate,
              order_min_remaining_days: line.min_shelf_life_days_required
            });
          }
        }
      }

      insertedLines.push({
        id: lineId,
        order_id: orderId,
        sku: line.sku,
        product_name: line.product_name,
        cases_ordered: line.requested_cases,
        cases_allocated: initialStatus === "pending_approval" ? 0 : line.allocated_cases,
        cases_backordered: line.shortfall_cases,
        uom: line.pricing.uom,
        unit_price_cents: line.pricing.unit_price_cents,
        original_list_price_cents: line.pricing.original_list_price_cents,
        discount_cents: line.pricing.discount_cents,
        pricing_source: line.pricing.pricing_source,
        contract_id: line.pricing.contract_id,
        vat_rate_pct: line.pricing.vat_rate_pct,
        tax_cents: line.pricing.line_tax_cents,
        line_total_cents: line.pricing.line_total_cents,
        line_status: lineStatus,
        batch_id: primaryBatchId,
        weight_kg: line.requested_cases * 5.0,
        shelf_life_min_days: line.min_shelf_life_days_required,
        shelf_life_verified: true,
        notes: null,
        allocations: line.allocations.map((a) => ({
          internal_lot: a.internal_lot,
          supplier_batch: a.supplier_batch,
          warehouse: a.warehouse,
          bin_code: a.bin_code,
          expiry_date: a.expiry_date,
          allocated_cases: a.allocated_cases,
          fefo_rank: a.fefo_rank
        }))
      });
    }

    // 3. Update customer's active orders count and exposure
    db.prepare(`
      UPDATE customers
      SET active_orders_count = active_orders_count + 1,
          current_exposure_cents = current_exposure_cents + ?
      WHERE id = ?
    `).run(validation.summary.total_cents, customer.id);

    // 4. Record Alert Event if credit hold
    if (isCreditBlocked) {
      db.prepare(`
        INSERT INTO alert_events (id, severity, module, title, detail)
        VALUES (?, 'warning', 'Orders', ?, ?)
      `).run(
        `ALT-ORD-${Date.now().toString().slice(-6)}`,
        `Customer Order ${orderNumber} requires credit release`,
        `${customer.name}: ${creditHoldReason}`
      );
    }

    // 5. Record Audit Event
    recordAuditEvent({
      actor,
      action: "order.customer_submitted",
      entityType: "SalesOrder",
      entityId: orderNumber,
      after: {
        order_number: orderNumber,
        customer_id: customer.id,
        total_cents: validation.summary.total_cents,
        status: initialStatus,
        lines_count: insertedLines.length
      }
    });

    recordCustomerOrderEvent({
      orderId,
      orderNumber,
      customerId: customer.id,
      eventType: "submitted",
      fromStatus: null,
      toStatus: initialStatus,
      actor,
      detail: {
        channel,
        total_cents: validation.summary.total_cents,
        cases_total: validation.summary.total_requested_cases,
        backordered_cases: validation.summary.total_shortfall_cases,
        credit_hold: isCreditBlocked
      }
    });

    createCustomerNotification({
      customerId: customer.id,
      orderId,
      orderNumber,
      category: isCreditBlocked
        ? "order_pending_approval"
        : isPartial
          ? "order_backorder"
          : "order_confirmation",
      title: isCreditBlocked
        ? `Order ${orderNumber} received — pending approval`
        : isPartial
          ? `Order ${orderNumber} confirmed with backorders`
          : `Order ${orderNumber} confirmed`,
      body: isCreditBlocked
        ? `We received your order for ${eur(validation.summary.total_cents)}. It is pending credit approval (${creditHoldReason}).`
        : isPartial
          ? `Your order for ${eur(validation.summary.total_cents)} is confirmed. ${validation.summary.total_shortfall_cases} cases are backordered and will follow.`
          : `Your order for ${eur(validation.summary.total_cents)} is confirmed for delivery on ${deliveryDate}.`,
      actor
    });

    return {
      id: orderId,
      order_number: orderNumber,
      customer_id: customer.id,
      customer: customer.name,
      customer_name: customer.name,
      segment: customer.segment,
      channel,
      status: initialStatus,
      po_reference: input.po_reference || null,
      delivery_date: deliveryDate,
      delivery_address: deliveryAddress,
      delivery_notes: input.delivery_notes || null,
      warehouse,
      payment_terms: customer.payment_terms,
      items_count: insertedLines.length,
      cases_total: validation.summary.total_requested_cases,
      subtotal_cents: validation.summary.subtotal_cents,
      tax_cents: validation.summary.tax_cents,
      total_cents: validation.summary.total_cents,
      margin_pct: 28.5,
      fefo_allocated: initialStatus === "confirmed" || initialStatus === "partially_confirmed",
      credit_hold: Boolean(creditHold),
      credit_hold_reason: creditHoldReason,
      approval_status: approvalStatus,
      approval_notes: null,
      approved_by: null,
      approved_at: null,
      cancellation_reason: null,
      is_backorder: isPartial,
      created_by: actor.email || actor.name,
      submitted_at: nowIso,
      confirmed_at: initialStatus === "confirmed" || initialStatus === "partially_confirmed" ? nowIso : null,
      created_at: nowIso,
      updated_at: nowIso,
      lines: insertedLines
    };
  });
}

// ----------------------------------------------------------------------------
// 6. Maker-Checker Credit & Exception Approval Workflow
// ----------------------------------------------------------------------------
export function approveCreditException(
  actor: AuthenticatedUser,
  orderNumberOrId: string,
  input: { reason: string; notes?: string }
): CustomerOrderRecord {
  assertPermission(actor, "orders:credit_override");
  requireMutationAuthorization(actor, "approve credit override");

  const db = getDb();
  const orderRow = db.prepare(`SELECT * FROM sales_orders WHERE id = ? OR order_number = ?`).get(
    orderNumberOrId,
    orderNumberOrId
  ) as any;

  if (!orderRow) {
    throw new ApiError(404, "ORDER_NOT_FOUND", `Order '${orderNumberOrId}' not found.`);
  }

  if (orderRow.status !== "pending_approval" && orderRow.credit_hold !== 1) {
    throw new ApiError(400, "INVALID_STATE", `Order '${orderNumberOrId}' is not pending approval.`);
  }

  const reason = input.reason?.trim();
  if (!reason || reason.length < 5) {
    throw new ApiError(400, "REASON_REQUIRED", "Approval reason is required (minimum 5 characters).");
  }

  return withTransaction(() => {
    const nowIso = new Date().toISOString();

    // 1. Re-evaluate stock availability for order lines
    const lines = db.prepare(`SELECT * FROM sales_order_lines WHERE order_id = ?`).all(orderRow.id) as any[];
    let hasBackorder = false;

    for (const line of lines) {
      let fefoEval: any = null;
      try {
        fefoEval = evaluateFefoAllocation(withInternalInventoryRead(actor), {
          sku: line.sku,
          requested_cases: line.cases_ordered,
          delivery_date: orderRow.delivery_date,
          customer_id: orderRow.customer_id,
          warehouse: orderRow.warehouse,
          allow_partial: true,
          persist_log: false
        });
      } catch (err: any) {
        if (err?.code !== "INSUFFICIENT_ELIGIBLE_STOCK" && err?.statusCode !== 409) {
          throw err;
        }
      }

      const allocatedCases = fefoEval ? fefoEval.allocated_cases : 0;
      const shortfallCases = line.cases_ordered - allocatedCases;
      if (shortfallCases > 0) hasBackorder = true;

      db.prepare(`
        UPDATE sales_order_lines
        SET cases_allocated = ?,
            cases_backordered = ?,
            line_status = ?,
            batch_id = ?
        WHERE id = ?
      `).run(
        allocatedCases,
        shortfallCases,
        shortfallCases > 0 && allocatedCases > 0 ? "partially_allocated" : allocatedCases === 0 ? "backordered" : "confirmed",
        fefoEval?.allocations?.[0]?.internal_lot || null,
        line.id
      );

      // Create official reservations
      if (fefoEval?.allocations) {
        for (const alloc of fefoEval.allocations) {
          if (alloc.allocated_cases > 0) {
            createStockReservation(withInternalInventoryRead(actor), {
              order_id: orderRow.id,
              order_number: orderRow.order_number,
              order_line_id: line.id,
              customer_id: orderRow.customer_id,
              customer_name: orderRow.customer,
              sku: line.sku,
              internal_lot: alloc.internal_lot,
              warehouse: alloc.warehouse,
              requested_cases: alloc.allocated_cases,
              delivery_date: orderRow.delivery_date,
              order_min_remaining_days: fefoEval.min_shelf_life_days_required
            });
          }
        }
      }
    }

    const newStatus: OrderWorkflowStatus = hasBackorder ? "partially_confirmed" : "confirmed";

    // 2. Update Sales Order
    db.prepare(`
      UPDATE sales_orders
      SET status = ?,
          credit_hold = 0,
          approval_status = 'approved',
          approved_by = ?,
          approved_at = ?,
          approval_notes = ?,
          confirmed_at = ?,
          fefo_allocated = 1,
          updated_at = ?
      WHERE id = ?
    `).run(
      newStatus,
      actor.name || actor.email,
      nowIso,
      reason,
      nowIso,
      nowIso,
      orderRow.id
    );

    // 3. Record Audit Event
    recordAuditEvent({
      actor,
      action: "order.credit_approved",
      entityType: "SalesOrder",
      entityId: orderRow.order_number,
      after: {
        order_number: orderRow.order_number,
        approved_by: actor.name || actor.email,
        reason,
        status: newStatus
      }
    });

    recordCustomerOrderEvent({
      orderId: orderRow.id,
      orderNumber: orderRow.order_number,
      customerId: orderRow.customer_id,
      eventType: "approved",
      fromStatus: orderRow.status,
      toStatus: newStatus,
      actor,
      detail: { reason, credit_hold_released: true }
    });

    createCustomerNotification({
      customerId: orderRow.customer_id,
      orderId: orderRow.id,
      orderNumber: orderRow.order_number,
      category: "order_confirmation",
      title: `Order ${orderRow.order_number} approved`,
      body: `Your order has been approved for ${eur(orderRow.total_cents)} and is now ${
        newStatus === "partially_confirmed" ? "confirmed with backorders" : "confirmed"
      }.`,
      actor
    });

    return getCustomerOrder(actor, orderRow.id);
  });
}

// ----------------------------------------------------------------------------
// 7. Cancellation: Release Stock Reservations & Revert Exposure
// ----------------------------------------------------------------------------
export function cancelCustomerOrder(
  actor: AuthenticatedUser,
  orderNumberOrId: string,
  reason: string
): CustomerOrderRecord {
  assertPermission(actor, "orders.manage");
  requireMutationAuthorization(actor, "cancel customer order");

  const db = getDb();
  const orderRow = db.prepare(`SELECT * FROM sales_orders WHERE id = ? OR order_number = ?`).get(
    orderNumberOrId,
    orderNumberOrId
  ) as any;

  if (!orderRow) {
    throw new ApiError(404, "ORDER_NOT_FOUND", `Order '${orderNumberOrId}' not found.`);
  }

  // Cross-customer access check
  requireRecordAccess(actor, { customer_id: orderRow.customer_id });

  if (orderRow.status === "cancelled") {
    throw new ApiError(400, "ALREADY_CANCELLED", `Order '${orderNumberOrId}' is already cancelled.`);
  }
  if (orderRow.status === "dispatched" || orderRow.status === "delivered" || orderRow.status === "completed") {
    throw new ApiError(400, "CANNOT_CANCEL", `Order '${orderNumberOrId}' has already progressed to '${orderRow.status}' and cannot be cancelled.`);
  }

  const cleanReason = (reason || "Customer requested cancellation").trim();

  return withTransaction(() => {
    const nowIso = new Date().toISOString();

    // 1. Find and release all active reservations for this order
    const reservations = db.prepare(`
      SELECT id, reservation_number, sku, reserved_cases, internal_lot
      FROM stock_reservations
      WHERE (order_id = ? OR order_number = ?)
        AND status IN ('Active', 'Partially Reserved', 'AllocatedToPick')
    `).all(orderRow.id, orderRow.order_number) as any[];

    for (const res of reservations) {
      releaseOrCancelReservation(actor, res.id, {
        action: "cancel",
        reason: `Order ${orderRow.order_number} cancelled: ${cleanReason}`
      });
    }

    // 2. Mark order lines cancelled
    db.prepare(`
      UPDATE sales_order_lines
      SET line_status = 'cancelled', cases_allocated = 0
      WHERE order_id = ?
    `).run(orderRow.id);

    // 3. Mark sales order cancelled
    db.prepare(`
      UPDATE sales_orders
      SET status = 'cancelled',
          cancellation_reason = ?,
          credit_hold = 0,
          updated_at = ?
      WHERE id = ?
    `).run(cleanReason, nowIso, orderRow.id);

    // 4. Decrement active orders count & exposure
    db.prepare(`
      UPDATE customers
      SET active_orders_count = max(0, active_orders_count - 1),
          current_exposure_cents = max(0, current_exposure_cents - ?)
      WHERE id = ?
    `).run(orderRow.total_cents, orderRow.customer_id);

    // 5. Record Audit
    recordAuditEvent({
      actor,
      action: "order.cancelled",
      entityType: "SalesOrder",
      entityId: orderRow.order_number,
      after: {
        order_number: orderRow.order_number,
        cancelled_by: actor.name || actor.email,
        reason: cleanReason,
        released_reservations: reservations.length
      }
    });

    recordCustomerOrderEvent({
      orderId: orderRow.id,
      orderNumber: orderRow.order_number,
      customerId: orderRow.customer_id,
      eventType: "cancelled",
      fromStatus: orderRow.status,
      toStatus: "cancelled",
      actor,
      detail: { reason: cleanReason, released_reservations: reservations.length }
    });

    createCustomerNotification({
      customerId: orderRow.customer_id,
      orderId: orderRow.id,
      orderNumber: orderRow.order_number,
      category: "order_cancellation",
      title: `Order ${orderRow.order_number} cancelled`,
      body: `Your order has been cancelled. Reason: ${cleanReason}.`,
      actor
    });

    return getCustomerOrder(actor, orderRow.id);
  });
}

// ----------------------------------------------------------------------------
// 7b. Order Timeline, Customer Notifications & Documents
// ----------------------------------------------------------------------------
function mapOrderEvent(row: any): CustomerOrderEventRecord {
  let detail: Record<string, unknown> | null = null;
  if (row.detail_json) {
    try {
      detail = JSON.parse(row.detail_json);
    } catch {
      detail = null;
    }
  }
  return {
    id: row.id,
    order_id: row.order_id,
    order_number: row.order_number,
    customer_id: row.customer_id,
    event_type: row.event_type,
    from_status: row.from_status || null,
    to_status: row.to_status || null,
    actor_id: row.actor_id || null,
    actor_email: row.actor_email || null,
    actor_role: row.actor_role || null,
    detail,
    created_at: row.created_at
  };
}

function recordCustomerOrderEvent(params: {
  orderId: string;
  orderNumber: string;
  customerId: string;
  eventType: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  actor?: AuthenticatedUser | null;
  detail?: Record<string, unknown> | null;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO customer_order_events (
      id, order_id, order_number, customer_id, event_type, from_status, to_status,
      actor_id, actor_email, actor_role, detail_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `COE-${crypto.randomUUID()}`,
    params.orderId,
    params.orderNumber,
    params.customerId,
    params.eventType,
    params.fromStatus || null,
    params.toStatus || null,
    params.actor?.id || null,
    params.actor?.email || null,
    params.actor?.role || null,
    params.detail ? JSON.stringify(params.detail) : null,
    new Date().toISOString()
  );
}

function createCustomerNotification(params: {
  customerId: string;
  orderId?: string | null;
  orderNumber?: string | null;
  category: string;
  title: string;
  body: string;
  actor?: AuthenticatedUser | null;
  channel?: string;
}): CustomerNotificationRecord {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const id = `CN-${crypto.randomUUID()}`;
  db.prepare(
    `INSERT INTO customer_notifications (
      id, customer_id, order_id, order_number, channel, category, title, body,
      status, read_at, sent_at, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sent', NULL, ?, ?, ?)`
  ).run(
    id,
    params.customerId,
    params.orderId || null,
    params.orderNumber || null,
    params.channel || "in_app",
    params.category,
    params.title,
    params.body,
    nowIso,
    params.actor?.email || params.actor?.name || "system",
    nowIso
  );

  return {
    id,
    customer_id: params.customerId,
    order_id: params.orderId || null,
    order_number: params.orderNumber || null,
    channel: params.channel || "in_app",
    category: params.category,
    title: params.title,
    body: params.body,
    status: "sent",
    read_at: null,
    sent_at: nowIso,
    created_by: params.actor?.email || params.actor?.name || "system",
    created_at: nowIso
  };
}

export function listCustomerOrderEvents(
  actor: AuthenticatedUser,
  orderNumberOrId: string
): CustomerOrderEventRecord[] {
  assertPermission(actor, "orders.read");
  const db = getDb();
  const order = db
    .prepare("SELECT id, customer_id FROM sales_orders WHERE id = ? OR order_number = ?")
    .get(orderNumberOrId, orderNumberOrId) as { id: string; customer_id: string } | undefined;
  if (!order) {
    throw new ApiError(404, "ORDER_NOT_FOUND", `Order '${orderNumberOrId}' not found.`);
  }
  requireRecordAccess(actor, { customer_id: order.customer_id });

  const rows = db
    .prepare(
      `SELECT * FROM customer_order_events WHERE order_id = ? ORDER BY created_at ASC, rowid ASC`
    )
    .all(order.id) as any[];
  return rows.map(mapOrderEvent);
}

export function listCustomerNotifications(
  actor: AuthenticatedUser,
  filters?: { customer_id?: string; unread_only?: boolean; limit?: number; offset?: number }
): { notifications: CustomerNotificationRecord[]; total: number; unread: number } {
  assertPermission(actor, "orders.read");
  const db = getDb();

  let customerId = filters?.customer_id?.trim();
  if (actor.role === "store_vendor" || actor.role === "store_user") {
    customerId = actor.store_id || "__FORBIDDEN__";
  }

  const conditions: string[] = [];
  const params: any[] = [];
  if (customerId) {
    conditions.push("customer_id = ?");
    params.push(customerId);
  }
  if (filters?.unread_only) {
    conditions.push("read_at IS NULL");
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(200, Math.max(1, Number(filters?.limit) || 50));
  const offset = Math.max(0, Number(filters?.offset) || 0);

  const rows = db
    .prepare(
      `SELECT * FROM customer_notifications ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as any[];
  const total = (
    db.prepare(`SELECT COUNT(*) as total FROM customer_notifications ${where}`).get(...params) as {
      total: number;
    }
  ).total;
  const unread = (
    db
      .prepare(
        `SELECT COUNT(*) as total FROM customer_notifications ${
          where ? `${where} AND` : "WHERE"
        } read_at IS NULL`
      )
      .get(...params) as { total: number }
  ).total;

  return {
    notifications: rows.map((row) => ({
      id: row.id,
      customer_id: row.customer_id,
      order_id: row.order_id || null,
      order_number: row.order_number || null,
      channel: row.channel,
      category: row.category,
      title: row.title,
      body: row.body,
      status: row.status,
      read_at: row.read_at || null,
      sent_at: row.sent_at || null,
      created_by: row.created_by || null,
      created_at: row.created_at
    })),
    total,
    unread
  };
}

export function markCustomerNotificationRead(
  actor: AuthenticatedUser,
  notificationId: string
): CustomerNotificationRecord {
  assertPermission(actor, "orders.read");
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM customer_notifications WHERE id = ?")
    .get(notificationId) as any;
  if (!row) {
    throw new ApiError(404, "NOTIFICATION_NOT_FOUND", `Notification '${notificationId}' not found.`);
  }
  requireRecordAccess(actor, { customer_id: row.customer_id });

  if (!row.read_at) {
    db.prepare(
      "UPDATE customer_notifications SET read_at = ?, status = 'read' WHERE id = ?"
    ).run(new Date().toISOString(), notificationId);
  }
  const updated = db
    .prepare("SELECT * FROM customer_notifications WHERE id = ?")
    .get(notificationId) as any;
  return {
    id: updated.id,
    customer_id: updated.customer_id,
    order_id: updated.order_id || null,
    order_number: updated.order_number || null,
    channel: updated.channel,
    category: updated.category,
    title: updated.title,
    body: updated.body,
    status: updated.status,
    read_at: updated.read_at || null,
    sent_at: updated.sent_at || null,
    created_by: updated.created_by || null,
    created_at: updated.created_at
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function eur(cents: number): string {
  return `€${(Number(cents || 0) / 100).toFixed(2)}`;
}

export type CustomerOrderDocumentType = "confirmation" | "delivery_note" | "invoice";

export interface CustomerOrderDocumentSummary {
  type: CustomerOrderDocumentType;
  document_number: string;
  title: string;
  order_number: string;
  customer_id: string;
  issued_at: string;
  status: string;
  download_url: string;
}

function assertDocumentAccess(
  actor: AuthenticatedUser,
  orderNumberOrId: string
): { order: any; documents: CustomerOrderDocumentSummary[] } {
  assertPermission(actor, "orders.read");
  const db = getDb();
  const order = db
    .prepare("SELECT * FROM sales_orders WHERE id = ? OR order_number = ? LIMIT 1")
    .get(orderNumberOrId, orderNumberOrId) as any;
  if (!order) {
    throw new ApiError(404, "ORDER_NOT_FOUND", `Order '${orderNumberOrId}' not found.`);
  }
  requireRecordAccess(actor, { customer_id: order.customer_id });

  if (order.status === "draft" || order.status === "submitted" || order.status === "pending_approval") {
    return { order, documents: [] };
  }

  const deliveries = db
    .prepare("SELECT id FROM deliveries WHERE order_id = ? OR order_number = ?")
    .all(order.id, order.order_number) as Array<{ id: string }>;
  const invoices = db
    .prepare("SELECT id, invoice_number FROM invoices WHERE order_id = ? OR order_number = ?")
    .all(order.id, order.order_number) as Array<{ id: string; invoice_number: string }>;

  const documents: CustomerOrderDocumentSummary[] = [
    {
      type: "confirmation",
      document_number: `CONF-${order.order_number}`,
      title: "Order Confirmation",
      order_number: order.order_number,
      customer_id: order.customer_id,
      issued_at: order.confirmed_at || order.submitted_at || order.created_at,
      status: order.status,
      download_url: `/api/v1/customer-portal/orders/${encodeURIComponent(
        order.order_number
      )}/documents?type=confirmation&format=html`
    }
  ];

  for (const delivery of deliveries) {
    documents.push({
      type: "delivery_note",
      document_number: `DN-${delivery.id}`,
      title: "Delivery Note",
      order_number: order.order_number,
      customer_id: order.customer_id,
      issued_at: order.updated_at,
      status: order.status,
      download_url: `/api/v1/customer-portal/orders/${encodeURIComponent(
        order.order_number
      )}/documents?type=delivery_note&format=html`
    });
  }

  for (const invoice of invoices) {
    documents.push({
      type: "invoice",
      document_number: invoice.invoice_number,
      title: "Invoice",
      order_number: order.order_number,
      customer_id: order.customer_id,
      issued_at: order.updated_at,
      status: order.status,
      download_url: `/api/v1/customer-portal/orders/${encodeURIComponent(
        order.order_number
      )}/documents?type=invoice&format=html`
    });
  }

  return { order, documents };
}

export function listCustomerOrderDocuments(
  actor: AuthenticatedUser,
  orderNumberOrId: string
): CustomerOrderDocumentSummary[] {
  return assertDocumentAccess(actor, orderNumberOrId).documents;
}

export function renderCustomerOrderDocument(
  actor: AuthenticatedUser,
  orderNumberOrId: string,
  type: CustomerOrderDocumentType
): { filename: string; content_type: string; html: string; document: CustomerOrderDocumentSummary } {
  const { order, documents } = assertDocumentAccess(actor, orderNumberOrId);
  const document = documents.find((entry) => entry.type === type);
  if (!document) {
    throw new ApiError(
      404,
      "DOCUMENT_NOT_AVAILABLE",
      `Document of type '${type}' is not available for order '${order.order_number}'.`
    );
  }

  const record = getCustomerOrder(actor, order.id);
  const lines = record.lines
    .map(
      (line) => `
      <tr>
        <td>${escapeHtml(line.sku)}</td>
        <td>${escapeHtml(line.product_name)}</td>
        <td class="num">${line.cases_ordered}</td>
        <td class="num">${line.cases_allocated}</td>
        <td class="num">${line.cases_backordered}</td>
        <td class="num">${eur(line.unit_price_cents)}</td>
        <td class="num">${eur(line.discount_cents)}</td>
        <td>${escapeHtml(line.pricing_source)}</td>
        <td class="num">${eur(line.tax_cents)}</td>
        <td class="num">${eur(line.line_total_cents)}</td>
      </tr>`
    )
    .join("");

  const title =
    type === "confirmation"
      ? "Order Confirmation"
      : type === "delivery_note"
        ? "Delivery Note"
        : "Invoice";

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(document.document_number)} — ${escapeHtml(title)}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 32px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .muted { color: #64748b; font-size: 12px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 24px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 8px 6px; text-align: left; }
    th { background: #f1f5f9; text-transform: uppercase; letter-spacing: 0.05em; font-size: 10px; }
    .num { text-align: right; white-space: nowrap; }
    .totals { margin-top: 16px; margin-left: auto; width: 320px; font-size: 13px; }
    .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
    .totals .grand { border-top: 1px solid #0f172a; font-weight: 700; margin-top: 6px; padding-top: 8px; }
    .stamp { margin-top: 32px; font-size: 11px; color: #64748b; }
  </style>
</head>
<body>
  <h1>Ascentra Global Ltd — ${escapeHtml(title)}</h1>
  <p class="muted">Document ${escapeHtml(document.document_number)} · Issued ${escapeHtml(
    document.issued_at
  )} · Status ${escapeHtml(record.status.toUpperCase())}</p>
  <div class="grid">
    <div>
      <strong>Customer</strong>
      <p class="muted">${escapeHtml(record.customer_name)}<br/>Customer ID: ${escapeHtml(
        record.customer_id
      )}<br/>Segment: ${escapeHtml(record.segment)}<br/>Payment terms: ${escapeHtml(
        record.payment_terms
      )}</p>
    </div>
    <div>
      <strong>Order</strong>
      <p class="muted">Order ${escapeHtml(record.order_number)}<br/>PO reference: ${escapeHtml(
        record.po_reference || "—"
      )}<br/>Delivery date: ${escapeHtml(record.delivery_date)}<br/>Warehouse: ${escapeHtml(
        record.warehouse
      )}<br/>Delivery address: ${escapeHtml(record.delivery_address)}</p>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>SKU</th><th>Product</th><th class="num">Ordered</th><th class="num">Allocated</th>
        <th class="num">Backorder</th><th class="num">Unit price</th><th class="num">Discount</th>
        <th>Price source</th><th class="num">VAT</th><th class="num">Line total</th>
      </tr>
    </thead>
    <tbody>${lines}</tbody>
  </table>
  <div class="totals">
    <div><span>Subtotal</span><span>${eur(record.subtotal_cents)}</span></div>
    <div><span>VAT</span><span>${eur(record.tax_cents)}</span></div>
    <div class="grand"><span>Total</span><span>${eur(record.total_cents)}</span></div>
  </div>
  <p class="stamp">
    Line prices are immutable snapshots taken from contract, promotion, segment or standard pricing at order time.
    ${record.approved_by ? `Approved by ${escapeHtml(record.approved_by)}.` : ""}
    ${record.cancellation_reason ? `Cancellation reason: ${escapeHtml(record.cancellation_reason)}.` : ""}
  </p>
</body>
</html>`;

  return {
    filename: `${document.document_number}.html`,
    content_type: "text/html; charset=utf-8",
    html,
    document
  };
}

// ----------------------------------------------------------------------------
// 7c. Authorized Order Amendments
// ----------------------------------------------------------------------------
const AMENDABLE_STATUSES: OrderWorkflowStatus[] = [
  "draft",
  "submitted",
  "pending_approval",
  "confirmed",
  "partially_confirmed",
  "backordered"
];

export function amendCustomerOrder(
  actor: AuthenticatedUser,
  orderNumberOrId: string,
  input: {
    delivery_date?: string;
    delivery_address?: string;
    delivery_notes?: string | null;
    po_reference?: string | null;
    allow_backorders?: boolean;
    lines?: Array<{ sku: string; cases: number; uom?: string; notes?: string }>;
  }
): CustomerOrderRecord {
  assertPermission(actor, "orders.manage");
  requireMutationAuthorization(actor, "amend customer order");

  const db = getDb();
  const orderRow = db
    .prepare("SELECT * FROM sales_orders WHERE id = ? OR order_number = ? LIMIT 1")
    .get(orderNumberOrId, orderNumberOrId) as any;
  if (!orderRow) {
    throw new ApiError(404, "ORDER_NOT_FOUND", `Order '${orderNumberOrId}' not found.`);
  }
  requireRecordAccess(actor, { customer_id: orderRow.customer_id });
  requireWarehouseAccess(actor, orderRow.warehouse);

  if (!AMENDABLE_STATUSES.includes(orderRow.status as OrderWorkflowStatus)) {
    throw new ApiError(
      409,
      "ORDER_NOT_AMENDABLE",
      `Order '${orderRow.order_number}' is '${orderRow.status}' and can no longer be amended.`
    );
  }

  const isPreConfirmation =
    orderRow.status === "draft" ||
    orderRow.status === "submitted" ||
    orderRow.status === "pending_approval";
  if (!isPreConfirmation && !hasPermission(actor, "orders.amend")) {
    throw new ApiError(
      403,
      "AMENDMENT_NOT_AUTHORIZED",
      "Amending a confirmed order requires the orders.amend permission."
    );
  }

  const existingLines = db
    .prepare("SELECT sku, cases_ordered, uom FROM sales_order_lines WHERE order_id = ? ORDER BY id ASC")
    .all(orderRow.id) as Array<{ sku: string; cases_ordered: number; uom: string }>;

  const lines =
    input.lines && input.lines.length > 0
      ? input.lines
      : existingLines.map((line) => ({
          sku: line.sku,
          cases: Number(line.cases_ordered),
          uom: line.uom
        }));

  const deliveryDate = (input.delivery_date || orderRow.delivery_date).slice(0, 10);
  const validation = validateCustomerOrder(actor, {
    customer_id: orderRow.customer_id,
    delivery_date: deliveryDate,
    warehouse: orderRow.warehouse,
    lines,
    exclude_order_id: orderRow.id
  });

  if (!validation.valid) {
    throw new ApiError(400, "VALIDATION_FAILED", validation.errors.join("; "));
  }

  const allowBackorders = input.allow_backorders !== false;
  if (!allowBackorders && validation.requires_stock_backorder) {
    throw new ApiError(
      400,
      "BACKORDER_NOT_PERMITTED",
      `Amendment introduces ${validation.summary.total_shortfall_cases} backordered cases while backorders are not permitted.`
    );
  }

  const isCreditBlocked = !validation.credit_evaluation.is_allowed;
  const isPartial = validation.requires_stock_backorder;
  const nextStatus: OrderWorkflowStatus = isCreditBlocked
    ? "pending_approval"
    : isPartial
      ? "partially_confirmed"
      : "confirmed";

  return withTransaction(() => {
    const nowIso = new Date().toISOString();

    // Release the previous reservations before re-pricing the order.
    const reservations = db
      .prepare(
        `SELECT id FROM stock_reservations
         WHERE (order_id = ? OR order_number = ?)
           AND status IN ('Active', 'Partially Reserved')`
      )
      .all(orderRow.id, orderRow.order_number) as Array<{ id: string }>;
    for (const reservation of reservations) {
      releaseOrCancelReservation(actor, reservation.id, {
        action: "release",
        reason: `Order ${orderRow.order_number} amended by ${actor.email || actor.name}`
      });
    }

    db.prepare("DELETE FROM sales_order_lines WHERE order_id = ?").run(orderRow.id);

    for (let i = 0; i < validation.lines.length; i++) {
      const line = validation.lines[i];
      const lineId = `SOL-${orderRow.order_number.replace("SO-2026-", "")}-${i + 1}`;
      const lineStatus =
        nextStatus === "pending_approval"
          ? "pending_approval"
          : line.shortfall_cases > 0 && line.allocated_cases > 0
            ? "partially_allocated"
            : line.allocated_cases === 0
              ? "backordered"
              : "confirmed";

      db.prepare(
        `INSERT INTO sales_order_lines (
          id, order_id, sku, product_name, cases_ordered, cases_allocated, cases_backordered,
          uom, unit_price_cents, original_list_price_cents, discount_cents, pricing_source,
          contract_id, vat_rate_pct, tax_cents, line_total_cents, line_status,
          batch_id, weight_kg, shelf_life_min_days, shelf_life_verified, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
      ).run(
        lineId,
        orderRow.id,
        line.sku,
        line.product_name,
        line.requested_cases,
        nextStatus === "pending_approval" ? 0 : line.allocated_cases,
        line.shortfall_cases,
        line.pricing.uom,
        line.pricing.unit_price_cents,
        line.pricing.original_list_price_cents,
        line.pricing.discount_cents,
        line.pricing.pricing_source,
        line.pricing.contract_id,
        line.pricing.vat_rate_pct,
        line.pricing.line_tax_cents,
        line.pricing.line_total_cents,
        lineStatus,
        line.allocations[0]?.internal_lot || null,
        line.requested_cases * 5.0,
        line.min_shelf_life_days_required,
        null
      );

      if (nextStatus === "confirmed" || nextStatus === "partially_confirmed") {
        for (const alloc of line.allocations) {
          if (alloc.allocated_cases > 0) {
            createStockReservation(withInternalInventoryRead(actor), {
              order_id: orderRow.id,
              order_number: orderRow.order_number,
              order_line_id: lineId,
              customer_id: orderRow.customer_id,
              customer_name: orderRow.customer,
              sku: line.sku,
              internal_lot: alloc.internal_lot,
              warehouse: alloc.warehouse,
              requested_cases: alloc.allocated_cases,
              delivery_date: deliveryDate,
              order_min_remaining_days: line.min_shelf_life_days_required
            });
          }
        }
      }
    }

    db.prepare(
      `UPDATE sales_orders
       SET status = ?,
           credit_hold = ?,
           credit_hold_reason = ?,
           approval_status = ?,
           approved_by = ?,
           approved_at = ?,
           items_count = ?,
           cases_total = ?,
           subtotal_cents = ?,
           tax_cents = ?,
           total_cents = ?,
           delivery_date = ?,
           delivery_address = ?,
           delivery_notes = ?,
           po_reference = ?,
           is_backorder = ?,
           fefo_allocated = ?,
           confirmed_at = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(
      nextStatus,
      isCreditBlocked ? 1 : 0,
      isCreditBlocked ? validation.credit_evaluation.reason : null,
      isCreditBlocked ? "pending" : "none",
      isCreditBlocked ? null : actor.name || actor.email,
      isCreditBlocked ? null : nowIso,
      validation.lines.length,
      validation.summary.total_requested_cases,
      validation.summary.subtotal_cents,
      validation.summary.tax_cents,
      validation.summary.total_cents,
      deliveryDate,
      input.delivery_address?.trim() || orderRow.delivery_address,
      input.delivery_notes !== undefined ? input.delivery_notes : orderRow.delivery_notes,
      input.po_reference !== undefined ? input.po_reference : orderRow.po_reference,
      isPartial ? 1 : 0,
      nextStatus === "confirmed" || nextStatus === "partially_confirmed" ? 1 : 0,
      nextStatus === "confirmed" || nextStatus === "partially_confirmed"
        ? orderRow.confirmed_at || nowIso
        : orderRow.confirmed_at,
      nowIso,
      orderRow.id
    );

    const exposureDelta = Number(validation.summary.total_cents) - Number(orderRow.total_cents || 0);
    if (exposureDelta !== 0) {
      db.prepare(
        `UPDATE customers
         SET current_exposure_cents = max(0, current_exposure_cents + ?)
         WHERE id = ?`
      ).run(exposureDelta, orderRow.customer_id);
    }

    recordCustomerOrderEvent({
      orderId: orderRow.id,
      orderNumber: orderRow.order_number,
      customerId: orderRow.customer_id,
      eventType: "amended",
      fromStatus: orderRow.status,
      toStatus: nextStatus,
      actor,
      detail: {
        released_reservations: reservations.length,
        total_cents: validation.summary.total_cents,
        previous_total_cents: Number(orderRow.total_cents || 0),
        lines: validation.lines.length,
        requires_credit_approval: isCreditBlocked,
        requires_stock_backorder: isPartial
      }
    });

    createCustomerNotification({
      customerId: orderRow.customer_id,
      orderId: orderRow.id,
      orderNumber: orderRow.order_number,
      category: "order_amendment",
      title: `Order ${orderRow.order_number} amended`,
      body: `Your order has been amended. New total: ${eur(
        validation.summary.total_cents
      )}. Status: ${nextStatus.replace(/_/g, " ")}.`,
      actor
    });

    recordAuditEvent({
      actor,
      action: "order.amended",
      entityType: "SalesOrder",
      entityId: orderRow.order_number,
      before: {
        status: orderRow.status,
        total_cents: Number(orderRow.total_cents || 0),
        delivery_date: orderRow.delivery_date
      },
      after: {
        status: nextStatus,
        total_cents: validation.summary.total_cents,
        delivery_date: deliveryDate,
        lines: validation.lines.map((line) => ({
          sku: line.sku,
          cases: line.requested_cases,
          unit_price_cents: line.pricing.unit_price_cents,
          pricing_source: line.pricing.pricing_source
        }))
      }
    });

    return getCustomerOrder(actor, orderRow.id);
  });
}

// ----------------------------------------------------------------------------
// 7d. Validated Fulfilment Status Transitions
// ----------------------------------------------------------------------------
const ORDER_STATUS_TRANSITIONS: Record<OrderWorkflowStatus, OrderWorkflowStatus[]> = {
  draft: ["submitted", "pending_approval", "confirmed", "cancelled"],
  submitted: ["pending_approval", "confirmed", "partially_confirmed", "cancelled"],
  pending_approval: ["confirmed", "partially_confirmed", "cancelled"],
  confirmed: ["processing", "completed", "cancelled"],
  partially_confirmed: ["confirmed", "processing", "completed", "cancelled"],
  backordered: ["confirmed", "partially_confirmed", "cancelled"],
  processing: ["completed", "cancelled"],
  completed: [],
  cancelled: []
};

export function transitionCustomerOrderStatus(
  actor: AuthenticatedUser,
  orderNumberOrId: string,
  input: { to_status: OrderWorkflowStatus; reason?: string }
): CustomerOrderRecord {
  assertPermission(actor, "orders.manage");
  requireMutationAuthorization(actor, "update customer order status");

  const db = getDb();
  const orderRow = db
    .prepare("SELECT * FROM sales_orders WHERE id = ? OR order_number = ? LIMIT 1")
    .get(orderNumberOrId, orderNumberOrId) as any;
  if (!orderRow) {
    throw new ApiError(404, "ORDER_NOT_FOUND", `Order '${orderNumberOrId}' not found.`);
  }
  requireRecordAccess(actor, { customer_id: orderRow.customer_id });
  requireWarehouseAccess(actor, orderRow.warehouse);

  const fromStatus = orderRow.status as OrderWorkflowStatus;
  const toStatus = input.to_status;
  const allowed = ORDER_STATUS_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    throw new ApiError(
      409,
      "INVALID_STATUS_TRANSITION",
      `Order '${orderRow.order_number}' cannot move from '${fromStatus}' to '${toStatus}'. Allowed: ${
        allowed.length ? allowed.join(", ") : "none (terminal state)"
      }.`
    );
  }

  if (toStatus === "cancelled") {
    return cancelCustomerOrder(
      actor,
      orderRow.id,
      input.reason?.trim() || `Status transition cancelled from '${fromStatus}'`
    );
  }

  if (Number(orderRow.credit_hold) === 1 && toStatus !== "pending_approval") {
    throw new ApiError(
      409,
      "CREDIT_HOLD_ACTIVE",
      "The order is on credit hold. A credit exception must be approved before fulfilment can proceed."
    );
  }

  return withTransaction(() => {
    const nowIso = new Date().toISOString();
    let lineUpdates = 0;

    if (
      (fromStatus === "backordered" ||
        fromStatus === "submitted" ||
        fromStatus === "partially_confirmed") &&
      (toStatus === "confirmed" || toStatus === "partially_confirmed")
    ) {
      // Release the order's own reservations so the live re-evaluation sees the
      // full warehouse availability rather than its previous hold.
      const heldReservations = db
        .prepare(
          `SELECT id FROM stock_reservations
           WHERE (order_id = ? OR order_number = ?)
             AND status IN ('Active', 'Partially Reserved')`
        )
        .all(orderRow.id, orderRow.order_number) as Array<{ id: string }>;
      for (const reservation of heldReservations) {
        releaseOrCancelReservation(actor, reservation.id, {
          action: "release",
          reason: `Re-evaluating availability for order ${orderRow.order_number}`
        });
      }

      // Re-verify live Module 06 FEFO availability before confirming.
      const lines = db
        .prepare("SELECT * FROM sales_order_lines WHERE order_id = ?")
        .all(orderRow.id) as any[];
      for (const line of lines) {
        const evaluation = evaluateOrderLineStock(actor, {
          customer_id: orderRow.customer_id,
          sku: line.sku,
          cases: Number(line.cases_ordered),
          delivery_date: orderRow.delivery_date,
          warehouse: orderRow.warehouse
        });

        if (
          toStatus === "confirmed" &&
          evaluation.allocated_cases !== Number(line.cases_ordered)
        ) {
          throw new ApiError(
            409,
            "STOCK_NOT_AVAILABLE",
            `Cannot fully confirm order: only ${evaluation.allocated_cases} of ${line.cases_ordered} cases of ${line.sku} are eligible for delivery by ${orderRow.delivery_date}.`
          );
        }
        if (evaluation.allocated_cases === 0) {
          throw new ApiError(
            409,
            "STOCK_NOT_AVAILABLE",
            `Cannot confirm ${line.sku}: no eligible stock satisfies the shelf-life requirement.`
          );
        }

        db.prepare(
          `UPDATE sales_order_lines
           SET cases_allocated = ?, cases_backordered = ?, line_status = ?, batch_id = ?
           WHERE id = ?`
        ).run(
          evaluation.allocated_cases,
          evaluation.shortfall_cases,
          evaluation.shortfall_cases > 0 ? "partially_allocated" : "confirmed",
          evaluation.allocations[0]?.internal_lot || null,
          line.id
        );
        lineUpdates += 1;

        for (const alloc of evaluation.allocations) {
          if (alloc.allocated_cases > 0) {
            createStockReservation(withInternalInventoryRead(actor), {
              order_id: orderRow.id,
              order_number: orderRow.order_number,
              order_line_id: line.id,
              customer_id: orderRow.customer_id,
              customer_name: orderRow.customer,
              sku: line.sku,
              internal_lot: alloc.internal_lot,
              warehouse: alloc.warehouse,
              requested_cases: alloc.allocated_cases,
              delivery_date: orderRow.delivery_date,
              order_min_remaining_days: evaluation.min_shelf_life_days_required
            });
          }
        }
      }
    }

    if (toStatus === "processing") {
      db.prepare(
        `UPDATE sales_order_lines
         SET line_status = 'processing'
         WHERE order_id = ? AND line_status NOT IN ('cancelled')`
      ).run(orderRow.id);
    }

    let releasedReservations = 0;
    if (toStatus === "completed") {
      const activeReservations = db
        .prepare(
          `SELECT id FROM stock_reservations
           WHERE (order_id = ? OR order_number = ?)
             AND status IN ('Active', 'Partially Reserved')`
        )
        .all(orderRow.id, orderRow.order_number) as Array<{ id: string }>;
      for (const reservation of activeReservations) {
        releaseOrCancelReservation(actor, reservation.id, {
          action: "release",
          reason: `Order ${orderRow.order_number} completed`
        });
      }
      releasedReservations = activeReservations.length;

      db.prepare(
        `UPDATE sales_order_lines
         SET line_status = CASE WHEN line_status = 'cancelled' THEN 'cancelled' ELSE 'fulfilled' END
         WHERE order_id = ?`
      ).run(orderRow.id);
    }

    db.prepare(
      `UPDATE sales_orders
       SET status = ?, is_backorder = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      toStatus,
      toStatus === "partially_confirmed" || toStatus === "backordered" ? 1 : 0,
      nowIso,
      orderRow.id
    );

    recordCustomerOrderEvent({
      orderId: orderRow.id,
      orderNumber: orderRow.order_number,
      customerId: orderRow.customer_id,
      eventType: "status_changed",
      fromStatus,
      toStatus,
      actor,
      detail: {
        reason: input.reason || null,
        lines_reallocated: lineUpdates,
        released_reservations: releasedReservations
      }
    });

    createCustomerNotification({
      customerId: orderRow.customer_id,
      orderId: orderRow.id,
      orderNumber: orderRow.order_number,
      category: "order_status",
      title: `Order ${orderRow.order_number} is now ${toStatus.replace(/_/g, " ")}`,
      body: `Your order status changed from ${fromStatus.replace(/_/g, " ")} to ${toStatus.replace(
        /_/g,
        " "
      )}.${input.reason ? ` Reason: ${input.reason}` : ""}`,
      actor
    });

    recordAuditEvent({
      actor,
      action: "order.status_changed",
      entityType: "SalesOrder",
      entityId: orderRow.order_number,
      before: { status: fromStatus },
      after: { status: toStatus, reason: input.reason || null }
    });

    return getCustomerOrder(actor, orderRow.id);
  });
}

// ----------------------------------------------------------------------------
// 8. Order Query & Detail (Strict Cross-Customer Access Control)
// ----------------------------------------------------------------------------
export function getCustomerOrder(actor: AuthenticatedUser, orderNumberOrId: string): CustomerOrderRecord {
  assertPermission(actor, "orders.read");

  const db = getDb();
  const row = db.prepare(`
    SELECT *
    FROM sales_orders
    WHERE id = ? OR order_number = ?
    LIMIT 1
  `).get(orderNumberOrId, orderNumberOrId) as any;

  if (!row) {
    throw new ApiError(404, "ORDER_NOT_FOUND", `Order '${orderNumberOrId}' not found.`);
  }

  // Enforce customer boundary: customers can only view their own orders
  requireRecordAccess(actor, { customer_id: row.customer_id });

  // Fetch lines
  const lines = db.prepare(`
    SELECT *
    FROM sales_order_lines
    WHERE order_id = ?
    ORDER BY id ASC
  `).all(row.id) as any[];

  // Fetch linked reservations
  const reservations = db.prepare(`
    SELECT *
    FROM stock_reservations
    WHERE order_id = ? OR order_number = ?
  `).all(row.id, row.order_number) as any[];

  // Fetch delivery tracking
  const deliveries = db.prepare(`
    SELECT id, route_code, driver, vehicle, eta, status, pod_signed, temp_c
    FROM deliveries
    WHERE order_id = ? OR order_number = ?
  `).all(row.id, row.order_number) as any[];

  // Fetch invoices
  const invoices = db.prepare(`
    SELECT id, invoice_number, amount_cents, paid_cents, status, sdi_status, due_date
    FROM invoices
    WHERE order_id = ? OR order_number = ?
  `).all(row.id, row.order_number) as any[];

  // Fetch the immutable event timeline and customer notifications
  const events = db
    .prepare(
      "SELECT * FROM customer_order_events WHERE order_id = ? ORDER BY created_at ASC, rowid ASC"
    )
    .all(row.id) as any[];
  const notifications = db
    .prepare(
      "SELECT * FROM customer_notifications WHERE customer_id = ? AND (order_id = ? OR order_number = ?) ORDER BY created_at DESC"
    )
    .all(row.customer_id, row.id, row.order_number) as any[];

  return {
    id: row.id,
    order_number: row.order_number,
    customer_id: row.customer_id,
    customer: row.customer,
    customer_name: row.customer,
    segment: row.segment,
    channel: row.channel,
    status: row.status as OrderWorkflowStatus,
    po_reference: row.po_reference || null,
    delivery_date: row.delivery_date,
    delivery_address: row.delivery_address || "",
    delivery_notes: row.delivery_notes || null,
    warehouse: row.warehouse,
    payment_terms: row.payment_terms || "Net 30",
    items_count: Number(row.items_count) || lines.length,
    cases_total: Number(row.cases_total) || 0,
    subtotal_cents: Number(row.subtotal_cents) || Number(row.total_cents) || 0,
    tax_cents: Number(row.tax_cents) || 0,
    total_cents: Number(row.total_cents) || 0,
    margin_pct: isStorePortalActor(actor) ? null : Number(row.margin_pct) || 28.0,
    fefo_allocated: Boolean(row.fefo_allocated),
    credit_hold: Boolean(row.credit_hold),
    credit_hold_reason: row.credit_hold_reason || null,
    approval_status: row.approval_status || "none",
    approval_notes: row.approval_notes || null,
    approved_by: row.approved_by || null,
    approved_at: row.approved_at || null,
    cancellation_reason: row.cancellation_reason || null,
    is_backorder: Boolean(row.is_backorder),
    created_by: row.created_by,
    submitted_at: row.submitted_at || null,
    confirmed_at: row.confirmed_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    lines: lines.map((l) => ({
      id: l.id,
      order_id: l.order_id,
      sku: l.sku,
      product_name: l.product_name,
      cases_ordered: Number(l.cases_ordered) || 0,
      cases_allocated: Number(l.cases_allocated) || 0,
      cases_backordered: Number(l.cases_backordered) || 0,
      uom: l.uom || "case",
      unit_price_cents: Number(l.unit_price_cents) || 0,
      original_list_price_cents: Number(l.original_list_price_cents) || Number(l.unit_price_cents) || 0,
      discount_cents: Number(l.discount_cents) || 0,
      pricing_source: (l.pricing_source || "standard") as PricingSourceType,
      contract_id: l.contract_id || null,
      vat_rate_pct: Number(l.vat_rate_pct) || 4.0,
      tax_cents: Number(l.tax_cents) || 0,
      line_total_cents: Number(l.line_total_cents) || Number(l.unit_price_cents * l.cases_ordered),
      line_status: l.line_status || "confirmed",
      batch_id: l.batch_id || null,
      weight_kg: Number(l.weight_kg) || 0,
      shelf_life_min_days: Number(l.shelf_life_min_days) || 5,
      shelf_life_verified: Boolean(l.shelf_life_verified),
      notes: l.notes || null,
      allocations: reservations
        .filter((r) => r.sku === l.sku && (r.order_line_id === l.id || !r.order_line_id))
        .map((r) => ({
          internal_lot: r.internal_lot,
          supplier_batch: r.supplier_batch,
          warehouse: r.warehouse,
          bin_code: r.bin_code,
          expiry_date: r.delivery_date || "",
          allocated_cases: Number(r.reserved_cases) || 0,
          fefo_rank: r.fefo_rank
        }))
    })),
    deliveries,
    invoices,
    events: events.map(mapOrderEvent),
    notifications: notifications.map((notification) => ({
      id: notification.id,
      customer_id: notification.customer_id,
      order_id: notification.order_id || null,
      order_number: notification.order_number || null,
      channel: notification.channel,
      category: notification.category,
      title: notification.title,
      body: notification.body,
      status: notification.status,
      read_at: notification.read_at || null,
      sent_at: notification.sent_at || null,
      created_by: notification.created_by || null,
      created_at: notification.created_at
    }))
  };
}

export function listCustomerOrders(
  actor: AuthenticatedUser,
  filters?: {
    customer_id?: string;
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }
): CustomerOrderRecord[] {
  assertPermission(actor, "orders.read");
  const db = getDb();

  // Enforce customer boundary: if actor is customer, restrict strictly to their store_id
  let customerId = filters?.customer_id?.trim();
  if (actor.role === "store_vendor" || actor.role === "store_user") {
    customerId = actor.store_id || "__FORBIDDEN__";
  }

  const conditions: string[] = [];
  const params: any[] = [];

  if (customerId) {
    conditions.push("customer_id = ?");
    params.push(customerId);
  }

  if (filters?.status && filters.status !== "all") {
    conditions.push("status = ?");
    params.push(filters.status.toLowerCase());
  }

  if (filters?.search?.trim()) {
    const term = `%${filters.search.trim().toLowerCase()}%`;
    conditions.push("(lower(order_number) LIKE ? OR lower(customer) LIKE ? OR lower(po_reference) LIKE ?)");
    params.push(term, term, term);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(200, Math.max(1, Number(filters?.limit) || 50));
  const offset = Math.max(0, Number(filters?.offset) || 0);

  const rows = db.prepare(`
    SELECT *
    FROM sales_orders
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[];

  return rows.map((r) => getCustomerOrder(actor, r.id));
}

// ----------------------------------------------------------------------------
// 9. Customer Catalog Engine: Live stock, Customer Prices, Shelf-Life Rules
// ----------------------------------------------------------------------------
export function getCustomerCatalog(
  actor: AuthenticatedUser,
  params?: {
    customer_id?: string;
    category?: string;
    temp_zone?: string;
    search?: string;
    warehouse?: string;
  }
): CatalogProductItem[] {
  assertPermission(actor, "products.read");
  const db = getDb();
  const customer = resolveCustomerScope(actor, params?.customer_id);
  const warehouse = params?.warehouse || "Milan Cold Hub";
  const today = new Date().toISOString().slice(0, 10);

  const conditions: string[] = ["status = 'active'"];
  const queryParams: any[] = [];

  if (params?.category && params.category !== "all") {
    conditions.push("lower(category) = lower(?)");
    queryParams.push(params.category);
  }

  if (params?.temp_zone && params.temp_zone !== "all") {
    conditions.push("lower(temp_zone) LIKE lower(?)");
    queryParams.push(`%${params.temp_zone}%`);
  }

  if (params?.search?.trim()) {
    const term = `%${params.search.trim().toLowerCase()}%`;
    conditions.push("(lower(name) LIKE ? OR lower(sku) LIKE ? OR lower(category) LIKE ?)");
    queryParams.push(term, term, term);
  }

  const whereSql = conditions.join(" AND ");
  const products = db.prepare(`
    SELECT id, sku, name, category, origin, uom, temp_zone, shelf_life_days,
           unit_price_cents, vat_rate_pct, allergens_json, status
    FROM products
    WHERE ${whereSql}
    ORDER BY category ASC, name ASC
  `).all(...queryParams) as any[];

  // Fetch active contracts for this customer to flag promotions and volume discounts
  const contracts = db.prepare(`
    SELECT i.sku, i.unit_price_cents, i.min_quantity, i.promotional_price_cents, i.promo_start, i.promo_end
    FROM customer_contracts c
    JOIN customer_contract_items i ON i.contract_id = c.id
    WHERE c.customer_id = ?
      AND c.status = 'active'
      AND c.start_date <= ?
      AND c.end_date >= ?
  `).all(customer.id, today, today) as any[];

  // Query actual available stock by SKU from Module 06
  const stockBySku = db.prepare(`
    SELECT sku,
           coalesce(SUM(quantity_cases), 0) as physical_cases,
           coalesce(SUM(allocated_cases), 0) as reserved_cases,
           coalesce(SUM(CASE
             WHEN quality_status = 'released'
              AND expiry_date > ?
             THEN max(0, quantity_cases - allocated_cases)
             ELSE 0
           END), 0) as available_cases
    FROM inventory_lots
    WHERE warehouse = ?
    GROUP BY sku
  `).all(today, warehouse) as any[];

  const stockMap = new Map<string, { physical: number; reserved: number; available: number }>();
  stockBySku.forEach((s) => {
    stockMap.set(s.sku, {
      physical: Number(s.physical_cases) || 0,
      reserved: Number(s.reserved_cases) || 0,
      available: Number(s.available_cases) || 0
    });
  });

  return products.map((p) => {
    const skuContracts = contracts.filter((c) => c.sku === p.sku);
    const hasContract = skuContracts.length > 0;
    const hasPromo = skuContracts.some(
      (c) =>
        c.promotional_price_cents &&
        c.promo_start &&
        c.promo_end &&
        today >= c.promo_start.slice(0, 10) &&
        today <= c.promo_end.slice(0, 10)
    );
    const hasVolumeDiscount = skuContracts.some((c) => c.min_quantity > 1);

    const pricing = resolveProductPricing(actor, {
      customer_id: customer.id,
      sku: p.sku,
      quantity: 1,
      target_date: today
    });

    const stock = stockMap.get(p.sku) || { physical: 0, reserved: 0, available: 0 };

    let allergens: string[] = [];
    try {
      allergens = p.allergens_json ? JSON.parse(p.allergens_json) : [];
    } catch {
      allergens = [];
    }

    const shelfLifeReq = resolveMinimumShelfLifeRequirement({
      customer_id: customer.id,
      customer_name: customer.name,
      sku: p.sku,
      customer_segment: customer.segment
    });
    const minShelfLifeDaysRequired = shelfLifeReq.min_remaining_days;

    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      origin: p.origin,
      uom: p.uom,
      temp_zone: p.temp_zone,
      shelf_life_days: p.shelf_life_days,
      min_shelf_life_days_required: minShelfLifeDaysRequired,
      stock_cases_available: stock.available,
      stock_cases_physical: stock.physical,
      stock_cases_reserved: stock.reserved,
      is_in_stock: stock.available > 0,
      pricing,
      has_contract: hasContract,
      has_promo: hasPromo,
      has_volume_discount: hasVolumeDiscount,
      allergens,
      vat_rate_pct: Number(p.vat_rate_pct) || 4.0,
      status: p.status
    };
  });
}

// ----------------------------------------------------------------------------
// 10. Customer Contracts Management
// ----------------------------------------------------------------------------
export function listCustomerContracts(
  actor: AuthenticatedUser,
  customerId?: string
): CustomerContract[] {
  assertPermission(actor, "orders.read");
  const db = getDb();

  let targetCustomer = customerId?.trim();
  if (actor.role === "store_vendor" || actor.role === "store_user") {
    targetCustomer = actor.store_id || "__FORBIDDEN__";
  }

  const whereClause = targetCustomer ? "WHERE c.customer_id = ?" : "";
  const params = targetCustomer ? [targetCustomer] : [];

  const rows = db.prepare(`
    SELECT c.*, cust.name as customer_name
    FROM customer_contracts c
    JOIN customers cust ON cust.id = c.customer_id
    ${whereClause}
    ORDER BY c.created_at DESC
  `).all(...params) as any[];

  return rows.map((c) => {
    const items = db.prepare(`
      SELECT i.*, p.name as product_name, p.category
      FROM customer_contract_items i
      LEFT JOIN products p ON p.sku = i.sku
      WHERE i.contract_id = ?
      ORDER BY i.sku ASC, i.min_quantity ASC
    `).all(c.id) as any[];

    return {
      id: c.id,
      contract_number: c.contract_number,
      customer_id: c.customer_id,
      customer_name: c.customer_name,
      title: c.title,
      start_date: c.start_date,
      end_date: c.end_date,
      currency: c.currency || "EUR",
      payment_terms: c.payment_terms || "Net 30",
      credit_limit_cents: c.credit_limit_cents ? Number(c.credit_limit_cents) : null,
      discount_pct: Number(c.discount_pct) || 0,
      status: c.status,
      notes: c.notes,
      items: items.map((it) => ({
        id: it.id,
        contract_id: it.contract_id,
        sku: it.sku,
        unit_price_cents: Number(it.unit_price_cents),
        uom: it.uom || "case",
        min_quantity: Number(it.min_quantity) || 1,
        discount_pct: Number(it.discount_pct) || 0,
        promotional_price_cents: it.promotional_price_cents ? Number(it.promotional_price_cents) : null,
        promo_start: it.promo_start,
        promo_end: it.promo_end,
        customer_sku: it.customer_sku,
        is_exclusive: Boolean(it.is_exclusive),
        notes: it.notes,
        product_name: it.product_name,
        category: it.category
      })),
      created_by: c.created_by,
      created_at: c.created_at,
      updated_at: c.updated_at
    };
  });
}

export function upsertCustomerContract(
  actor: AuthenticatedUser,
  input: {
    id?: string;
    contract_number?: string;
    customer_id: string;
    title: string;
    start_date: string;
    end_date: string;
    currency?: string;
    payment_terms?: string;
    credit_limit_cents?: number;
    discount_pct?: number;
    notes?: string;
    items: Array<{
      sku: string;
      unit_price_cents: number;
      uom?: string;
      min_quantity?: number;
      discount_pct?: number;
      promotional_price_cents?: number | null;
      promo_start?: string | null;
      promo_end?: string | null;
      customer_sku?: string | null;
      notes?: string | null;
    }>;
  }
): CustomerContract {
  assertPermission(actor, "orders.manage");
  requireMutationAuthorization(actor, "upsert customer contract");

  // Only sales, finance, or super_admin can create/alter contract prices
  if (actor.role !== "super_admin" && actor.role !== "sales" && actor.role !== "finance") {
    throw new ApiError(403, "FORBIDDEN_CONTRACT_MANAGEMENT", "Only authorized sales and finance administrators can manage customer contracts.");
  }

  const db = getDb();
  const customer = resolveCustomerScope(actor, input.customer_id);

  if (!input.title?.trim()) {
    throw new ApiError(400, "TITLE_REQUIRED", "Contract title is required.");
  }
  if (!input.start_date || !input.end_date) {
    throw new ApiError(400, "DATES_REQUIRED", "Start date and end date are required.");
  }
  if (input.start_date > input.end_date) {
    throw new ApiError(400, "INVALID_DATE_RANGE", "Start date cannot be after end date.");
  }

  return withTransaction(() => {
    const nowIso = new Date().toISOString();
    const contractId = input.id || `CTR-${Date.now().toString().slice(-6)}`;
    const contractNumber = input.contract_number || `CTR-2026-${Date.now().toString().slice(-4)}`;

    db.prepare(`
      INSERT INTO customer_contracts (
        id, contract_number, customer_id, title, start_date, end_date,
        currency, payment_terms, credit_limit_cents, discount_pct, status, notes,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        currency = excluded.currency,
        payment_terms = excluded.payment_terms,
        credit_limit_cents = excluded.credit_limit_cents,
        discount_pct = excluded.discount_pct,
        notes = excluded.notes,
        updated_at = excluded.updated_at
    `).run(
      contractId,
      contractNumber,
      customer.id,
      input.title.trim(),
      input.start_date,
      input.end_date,
      input.currency || "EUR",
      input.payment_terms || customer.payment_terms,
      input.credit_limit_cents !== undefined ? input.credit_limit_cents : null,
      Number(input.discount_pct) || 0,
      input.notes || null,
      actor.email || actor.name,
      nowIso,
      nowIso
    );

    // Replace items
    db.prepare(`DELETE FROM customer_contract_items WHERE contract_id = ?`).run(contractId);

    const insertItem = db.prepare(`
      INSERT INTO customer_contract_items (
        id, contract_id, sku, unit_price_cents, uom, min_quantity, discount_pct,
        promotional_price_cents, promo_start, promo_end, customer_sku, is_exclusive, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `);

    for (let i = 0; i < (input.items || []).length; i++) {
      const it = input.items[i];
      const itemId = `CTRI-${contractId.replace("CTR-", "")}-${i + 1}`;
      insertItem.run(
        itemId,
        contractId,
        it.sku,
        Math.round(Number(it.unit_price_cents)),
        it.uom || "case",
        Math.max(1, Math.round(Number(it.min_quantity) || 1)),
        Number(it.discount_pct) || 0,
        it.promotional_price_cents ? Math.round(Number(it.promotional_price_cents)) : null,
        it.promo_start || null,
        it.promo_end || null,
        it.customer_sku || null,
        it.notes || null,
        nowIso
      );
    }

    recordAuditEvent({
      actor,
      action: "contract.upserted",
      entityType: "CustomerContract",
      entityId: contractNumber,
      after: {
        contract_number: contractNumber,
        customer_id: customer.id,
        items_count: input.items.length
      }
    });

    const contracts = listCustomerContracts(actor, customer.id);
    return contracts.find((c) => c.id === contractId || c.contract_number === contractNumber)!;
  });
}
