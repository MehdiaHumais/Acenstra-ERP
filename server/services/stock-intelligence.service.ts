import { getDb, withTransaction } from "@/server/db/connection";
import { ApiError } from "@/server/core/http";
import {
  AuthenticatedUser,
  assertPermission,
  hasPermission,
  recordAuditEvent,
  requireMutationAuthorization,
  requireRecordAccess,
  requireWarehouseAccess
} from "@/server/security/auth";
export type StockStatusType =
  | "Available"
  | "Reserved"
  | "Held"
  | "Quarantined"
  | "Rejected"
  | "Damaged"
  | "Expired"
  | "In Transit";

export interface StockLotRecord {
  id: string;
  organization: string;
  warehouse: string;
  zone: string;
  bin_code: string;
  sku: string;
  product_name: string;
  category: string;
  uom: string;
  supplier_name: string;
  supplier_batch: string;
  internal_lot: string;
  origin_country: string;
  received_date: string;
  expiry_date: string;
  days_remaining: number;
  quality_status: "released" | "on_hold" | "quarantine" | "rejected" | "pending";
  primary_stock_status: StockStatusType;
  status_breakdown: Record<StockStatusType, number>;
  physical_cases: number;
  available_cases: number;
  reserved_cases: number;
  blocked_cases: number;
  held_cases: number;
  quarantined_cases: number;
  rejected_cases: number;
  damaged_cases: number;
  expired_cases: number;
  pending_cases: number;
  in_transit_cases: number;
  unit_weight_kg: number;
  is_catch_weight: boolean;
  physical_weight_kg: number;
  available_weight_kg: number;
  reserved_weight_kg: number;
  blocked_weight_kg: number;
  catch_weight_kg: number;
  unit_cost_cents: number;
  stock_value_cents: number;
  available_value_cents: number;
  reserved_value_cents: number;
  blocked_value_cents: number;
  temp_c: number;
  temp_status: "in_range" | "warning" | "excursion";
  bin_status: string;
  min_shelf_life_days: number;
  shelf_life_days: number;
  shelf_life_alert: "ok" | "warning" | "critical" | "expired";
  fefo_rank: number | null;
  availability_block_reasons: string[];
  bin_placements: Array<{
    bin_code: string;
    zone_code: string;
    warehouse: string;
    quantity_cases: number;
    weight_kg: number;
    quality_status: string;
  }>;
}

export interface ShelfLifeRuleRecord {
  id: string;
  rule_code: string;
  rule_scope: "product" | "customer" | "customer_product" | "segment";
  sku: string | null;
  product_name: string | null;
  category: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_segment: string | null;
  min_remaining_days: number;
  min_remaining_pct: number | null;
  enforce_at_allocation: boolean;
  enforce_at_pick: boolean;
  allow_manager_override: boolean;
  notes: string | null;
  active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface FefoLotCandidateEvaluation {
  internal_lot: string;
  supplier_batch: string;
  sku: string;
  product_name: string;
  warehouse: string;
  zone: string;
  bin_code: string;
  received_date: string;
  expiry_date: string;
  days_remaining_today: number;
  days_remaining_at_delivery: number;
  min_shelf_life_days_required: number;
  physical_cases: number;
  available_cases: number;
  reserved_cases: number;
  blocked_cases: number;
  unit_weight_kg: number;
  quality_status: string;
  temp_c: number;
  temp_status: string;
  eligible: boolean;
  decision: "selected" | "partial_selected" | "excluded" | "eligible_standby";
  allocated_cases: number;
  allocated_weight_kg: number;
  fefo_rank: number | null;
  reason_code: string;
  reason_detail: string;
  exclusion_reasons: string[];
}

export interface FefoAllocationResult {
  allocation_ref: string;
  status: "allocated" | "partially_allocated";
  sku: string;
  product_name: string;
  warehouse: string | null;
  customer_id: string | null;
  customer_name: string | null;
  delivery_date: string;
  requested_cases: number;
  allocated_cases: number;
  shortfall_cases: number;
  fully_allocated: boolean;
  min_shelf_life_days_required: number;
  applied_shelf_life_rules: string[];
  allocations: Array<{
    internal_lot: string;
    supplier_batch: string;
    warehouse: string;
    zone: string;
    bin_code: string;
    expiry_date: string;
    days_remaining_at_delivery: number;
    allocated_cases: number;
    allocated_weight_kg: number;
    fefo_rank: number;
    selection_reason: string;
  }>;
  selected_allocations: Array<{
    internal_lot: string;
    supplier_batch: string;
    warehouse: string;
    zone: string;
    bin_code: string;
    expiry_date: string;
    days_remaining_at_delivery: number;
    allocated_cases: number;
    allocated_weight_kg: number;
    fefo_rank: number;
    selection_reason: string;
  }>;
  candidates: FefoLotCandidateEvaluation[];
}

export interface StockReservationRecord {
  id: string;
  reservation_number: string;
  order_id: string | null;
  order_number: string | null;
  order_line_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  sku: string;
  product_name: string;
  internal_lot: string;
  supplier_batch: string | null;
  warehouse: string;
  zone: string | null;
  bin_code: string | null;
  requested_cases: number;
  reserved_cases: number;
  reserved_weight_kg: number;
  uom: string;
  delivery_date: string | null;
  min_shelf_life_days_required: number;
  days_remaining_at_delivery: number | null;
  fefo_rank: number | null;
  selection_reason: string | null;
  status: "Active" | "Partially Reserved" | "AllocatedToPick" | "Converted to Pick" | "Released" | "Cancelled" | "Expired";
  pick_task_id: string | null;
  expires_at: string;
  released_reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  events?: Array<{
    id: string;
    event_type: string;
    previous_status: string | null;
    new_status: string;
    quantity_cases: number;
    reason: string | null;
    actor_name: string;
    created_at: string;
  }>;
}

export interface CycleCountRecord {
  id: string;
  count_number: string;
  count_type: "scheduled" | "ad_hoc" | "recount";
  warehouse: string;
  zone: string | null;
  bin_code: string;
  sku: string;
  product_name: string;
  internal_lot: string;
  supplier_batch: string | null;
  is_blind: boolean;
  blind_masked: boolean;
  expected_cases: number | null;
  expected_weight_kg: number | null;
  counted_cases: number | null;
  counted_weight_kg: number | null;
  variance_cases: number | null;
  variance_weight_kg: number | null;
  unit_weight_kg: number;
  barcode_scanned: string | null;
  scan_verified: boolean;
  barcode_verified: boolean;
  status:
    | "Assigned"
    | "In Progress"
    | "Submitted"
    | "In Review"
    | "Discrepancy Review"
    | "Recount Requested"
    | "Approved"
    | "Rejected";
  recount_number: number;
  recount_iteration: number;
  assigned_to_id: string | null;
  assigned_to_name: string;
  scheduled_date: string;
  counted_by_id: string | null;
  counted_by_name: string | null;
  counted_at: string | null;
  approved_by_id: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  approval_notes: string | null;
  adjustment_id: string | null;
  discrepancy_reason: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  history?: Array<{
    id: string;
    action: string;
    recount_number: number;
  recount_iteration: number;
    expected_cases: number | null;
    counted_cases: number | null;
    variance_cases: number | null;
    counted_weight_kg: number | null;
    notes: string | null;
    actor_name: string;
    created_at: string;
  }>;
}

export interface StockAdjustmentRecord {
  id: string;
  adjustment_number: string;
  warehouse: string;
  zone: string | null;
  bin_code: string | null;
  target_bin_code: string | null;
  sku: string;
  product_name: string;
  internal_lot: string;
  supplier_batch: string | null;
  adjustment_type:
    | "damaged"
    | "expired"
    | "missing_shrinkage"
    | "mislocated_transfer"
    | "cycle_count_reconciliation"
    | "found_surplus"
    | "quality_writeoff";
  target_status: StockStatusType;
  original_cases: number;
  actual_cases: number;
  difference_cases: number;
  original_weight_kg: number;
  actual_weight_kg: number;
  difference_weight_kg: number;
  unit_cost_cents: number;
  value_impact_cents: number;
  requires_approval: boolean;
  status: "Pending Approval" | "Applied" | "Approved" | "Rejected";
  reason: string;
  evidence: string[];
  cycle_count_id: string | null;
  movement_id: string | null;
  idempotency_key: string | null;
  requested_by_id: string;
  requested_by_name: string;
  requested_at: string;
  approved_by_id: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  approval_notes: string | null;
  updated_at: string;
}

export interface StockMovementRecord {
  id: string;
  batch_id: string;
  sku: string;
  product_name: string;
  warehouse: string;
  zone: string | null;
  source_location: string | null;
  destination_location: string | null;
  movement_type: string;
  quantity_delta: number;
  previous_cases: number;
  new_cases: number;
  weight_delta_kg: number | null;
  reference_type: string | null;
  reference_id: string | null;
  reason: string;
  actor_email: string;
  created_at: string;
}

function roundDec(val: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round((Number(val) || 0) * factor) / factor;
}

function parseJsonArray(raw: unknown): string[] {
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function computeDaysBetweenDates(targetDateStr: string, baseDateStr?: string): number {
  const base = baseDateStr ? new Date(`${baseDateStr.slice(0, 10)}T00:00:00Z`) : new Date();
  if (!baseDateStr) {
    base.setUTCHours(0, 0, 0, 0);
  }
  const target = new Date(`${targetDateStr.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(target.getTime()) || Number.isNaN(base.getTime())) return 0;
  return Math.ceil((target.getTime() - base.getTime()) / 86400000);
}

function isWarehouseScopedRole(role: string): boolean {
  return (
    role === "warehouse_manager" ||
    role === "picker" ||
    role === "warehouse_staff" ||
    role === "qa" ||
    role === "qa_inspector" ||
    role === "qa_manager"
  );
}

function buildWarehouseScopeClause(
  actor?: AuthenticatedUser,
  requestedWarehouse?: string | null,
  columnName = "warehouse"
): { clause: string; params: string[] } {
  if (actor && isWarehouseScopedRole(actor.role) && actor.warehouse && actor.warehouse !== "All") {
    if (
      requestedWarehouse &&
      requestedWarehouse !== "ALL" &&
      requestedWarehouse.toLowerCase() !== actor.warehouse.toLowerCase()
    ) {
      throw new ApiError(
        403,
        "FORBIDDEN_WAREHOUSE_SCOPE",
        `Access denied. User belongs to '${actor.warehouse}', cannot access '${requestedWarehouse}'.`
      );
    }
    return {
      clause: `lower(${columnName}) = lower(?)`,
      params: [actor.warehouse]
    };
  }
  if (requestedWarehouse && requestedWarehouse !== "ALL") {
    return {
      clause: `lower(${columnName}) = lower(?)`,
      params: [requestedWarehouse]
    };
  }
  return { clause: "", params: [] };
}

interface ProductMetaInfo {
  sku: string;
  name: string;
  category: string;
  uom: string;
  shelfLifeDays: number;
  minShelfLifeDays: number;
  unitWeightKg: number;
  isCatchWeight: boolean;
  unitCostCents: number;
  tempMinC: number;
  tempMaxC: number;
}

function getProductMetaMap(): Map<string, ProductMetaInfo> {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM products`).all() as Record<string, unknown>[];
  const map = new Map<string, ProductMetaInfo>();

  for (const r of rows) {
    const sku = String(r.sku || "");
    const unitPriceCents = Number(r.unit_price_cents || 5000);
    const costCents =
      r.cost_price_cents !== null && r.cost_price_cents !== undefined && Number(r.cost_price_cents) > 0
        ? Number(r.cost_price_cents)
        : Math.round(unitPriceCents * 0.72);
    const shelfLifeDays = Number(r.shelf_life_days || 7);
    const minShelfLifeDays =
      r.min_shelf_life_days !== null && r.min_shelf_life_days !== undefined && Number(r.min_shelf_life_days) > 0
        ? Number(r.min_shelf_life_days)
        : Math.max(1, Math.min(5, Math.floor(shelfLifeDays * 0.35)));
    const tempZone = String(r.temp_zone || "").toLowerCase();
    const isFrozen = tempZone.includes("frozen") || tempZone.includes("-18");
    const isAmbient = tempZone.includes("ambient");
    const tempMinC =
      r.temp_min_c !== null && r.temp_min_c !== undefined
        ? Number(r.temp_min_c)
        : isFrozen
          ? -25
          : isAmbient
            ? 10
            : 0;
    const tempMaxC =
      r.temp_max_c !== null && r.temp_max_c !== undefined
        ? Number(r.temp_max_c)
        : isFrozen
          ? -18
          : isAmbient
            ? 22
            : 4;
    const caseWeightKg =
      r.case_weight_kg !== null && r.case_weight_kg !== undefined && Number(r.case_weight_kg) > 0
        ? Number(r.case_weight_kg)
        : r.unit_weight_kg !== null && r.unit_weight_kg !== undefined && Number(r.unit_weight_kg) > 0
          ? Number(r.unit_weight_kg)
          : 5.0;

    map.set(sku.toUpperCase(), {
      sku,
      name: String(r.name || sku),
      category: String(r.category || "Chilled"),
      uom: String(r.uom || "case"),
      shelfLifeDays,
      minShelfLifeDays,
      unitWeightKg: caseWeightKg,
      isCatchWeight: Boolean(r.catch_weight) || ["Seafood", "Meat", "Charcuterie"].includes(String(r.category || "")),
      unitCostCents: costCents,
      tempMinC,
      tempMaxC
    });
  }
  return map;
}

/**
 * Multi-Level Stock Visibility Hydrator
 * Never treats physical stock as automatically available stock.
 */
export function listMultiLevelStockLots(
  actor?: AuthenticatedUser,
  filters: {
    organization?: string | null;
    warehouse?: string | null;
    zone?: string | null;
    bin?: string | null;
    sku?: string | null;
    lot?: string | null;
    supplier_batch?: string | null;
    status?: string | null;
    search?: string | null;
  } = {}
): StockLotRecord[] {
  if (actor) {
    assertPermission(actor, "inventory:read");
  }
  const db = getDb();
  const wf = buildWarehouseScopeClause(actor, filters.warehouse, "warehouse");
  const conditions: string[] = [];
  const params: string[] = [];

  if (wf.clause) {
    conditions.push(wf.clause);
    params.push(...wf.params);
  }
  if (filters.zone && filters.zone !== "ALL") {
    conditions.push("lower(zone) = lower(?)");
    params.push(filters.zone);
  }
  if (filters.bin && filters.bin !== "ALL") {
    conditions.push("lower(location) = lower(?)");
    params.push(filters.bin);
  }
  if (filters.sku && filters.sku !== "ALL") {
    conditions.push("upper(sku) = upper(?)");
    params.push(filters.sku);
  }
  if (filters.lot) {
    conditions.push("upper(batch_id) = upper(?)");
    params.push(filters.lot);
  }
  if (filters.supplier_batch) {
    conditions.push("upper(supplier_lot) = upper(?)");
    params.push(filters.supplier_batch);
  }
  if (filters.search && filters.search.trim()) {
    const q = `%${filters.search.trim().toLowerCase()}%`;
    conditions.push(
      `(lower(batch_id) LIKE ? OR lower(supplier_lot) LIKE ? OR lower(sku) LIKE ? OR lower(product_name) LIKE ? OR lower(location) LIKE ? OR lower(zone) LIKE ? OR lower(warehouse) LIKE ?)`
    );
    params.push(q, q, q, q, q, q, q);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rawLots = db
    .prepare(
      `SELECT * FROM inventory_lots ${whereSql}
       ORDER BY expiry_date ASC, received_date ASC, batch_id ASC`
    )
    .all(...params) as Record<string, unknown>[];

  const productMeta = getProductMetaMap();

  const binRows = db.prepare(`SELECT code, status, zone_code, warehouse FROM warehouse_bins`).all() as Array<{
    code: string;
    status: string;
    zone_code: string;
    warehouse: string;
  }>;
  const binStatusMap = new Map<string, string>();
  for (const b of binRows) {
    binStatusMap.set(b.code.toUpperCase(), b.status);
  }

  const placementRows = db
    .prepare(`SELECT bin_code, zone_code, warehouse, internal_lot, quantity_cases, weight_kg, quality_status FROM bin_stock_placements WHERE quantity_cases > 0`)
    .all() as Array<{
    bin_code: string;
    zone_code: string;
    warehouse: string;
    internal_lot: string;
    quantity_cases: number;
    weight_kg: number;
    quality_status: string;
  }>;
  const placementsByLot = new Map<string, StockLotRecord["bin_placements"]>();
  for (const p of placementRows) {
    const key = p.internal_lot.toUpperCase();
    const list = placementsByLot.get(key) ?? [];
    list.push({
      bin_code: p.bin_code,
      zone_code: p.zone_code,
      warehouse: p.warehouse,
      quantity_cases: Number(p.quantity_cases || 0),
      weight_kg: Number(p.weight_kg || 0),
      quality_status: p.quality_status || "released"
    });
    placementsByLot.set(key, list);
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const fefoRankMap = new Map<string, number>();

  const records: StockLotRecord[] = rawLots.map((row) => {
    const sku = String(row.sku || "");
    const meta = productMeta.get(sku.toUpperCase());
    const internalLot = String(row.batch_id || "");
    const expiryDate = String(row.expiry_date || todayStr);
    const daysRemaining = computeDaysBetweenDates(expiryDate, todayStr);
    const isExpiredByDate = expiryDate <= todayStr || daysRemaining <= 0;

    const rawQual = String(row.quality_status || "released").toLowerCase();
    const qualityStatus: StockLotRecord["quality_status"] =
      rawQual === "quarantine"
        ? "quarantine"
        : rawQual === "rejected"
          ? "rejected"
          : rawQual === "on_hold" || rawQual === "hold"
            ? "on_hold"
            : rawQual === "pending"
              ? "pending"
              : "released";

    const tempC = Number(row.temp_c ?? 2.0);
    const maxAllowedC = meta ? meta.tempMaxC : 4.0;
    const minAllowedC = meta ? meta.tempMinC : 0.0;
    const tempStatus: StockLotRecord["temp_status"] =
      tempC > maxAllowedC + 1.5 || tempC < minAllowedC - 3.0
        ? "excursion"
        : tempC > maxAllowedC || tempC < minAllowedC
          ? "warning"
          : "in_range";

    const binCode = String(row.location || "CH-A01");
    const binStatus = binStatusMap.get(binCode.toUpperCase()) || (binCode.toUpperCase().startsWith("QR") || binCode.toUpperCase().startsWith("QUAR") ? "restricted" : "active");

    const quantityCases = Math.max(0, Number(row.quantity_cases || 0));
    const reservedCases = Math.max(0, Math.min(quantityCases, Number(row.allocated_cases || 0)));
    let heldCases = Math.max(0, Number(row.held_cases || 0));
    let quarantinedCases = Math.max(0, Number(row.quarantined_cases || 0));
    let rejectedCases = Math.max(0, Number(row.rejected_cases || 0));
    const damagedCases = Math.max(0, Number(row.damaged_cases || 0));
    let expiredCases = Math.max(0, Number(row.expired_cases || 0));
    let pendingCases = Math.max(0, Number(row.pending_cases || 0));
    const inTransitCases = Math.max(0, Number(row.in_transit_cases || 0));

    const blockReasons: string[] = [];
    if (qualityStatus !== "released") {
      blockReasons.push(`Quality status is '${qualityStatus}' (QA release required)`);
    }
    if (isExpiredByDate) {
      blockReasons.push(`Lot expired on ${expiryDate}`);
    }
    if (tempStatus === "excursion") {
      blockReasons.push(`Active temperature excursion (${tempC}°C outside [${minAllowedC}°C..${maxAllowedC}°C])`);
    }
    if (binStatus !== "active") {
      blockReasons.push(`Storage bin '${binCode}' is '${binStatus}'`);
    }

    // Reconcile status buckets so physical === available + reserved + blocked + in_transit
    let availableCases = 0;
    if (qualityStatus === "released") {
      const unreservedPool = Math.max(0, quantityCases - reservedCases - damagedCases - inTransitCases);
      if (isExpiredByDate) {
        expiredCases += unreservedPool;
        availableCases = 0;
      } else if (tempStatus === "excursion" || binStatus !== "active") {
        heldCases += unreservedPool;
        availableCases = 0;
      } else {
        availableCases = unreservedPool;
      }
    } else {
      // Non-released lot: physical stock is never available
      availableCases = 0;
      const unallocated = Math.max(0, quantityCases - reservedCases);
      const explicitSplit = heldCases + quarantinedCases + rejectedCases + pendingCases;
      if (explicitSplit === 0 && unallocated > 0) {
        if (qualityStatus === "quarantine") quarantinedCases = unallocated;
        else if (qualityStatus === "rejected") rejectedCases = unallocated;
        else if (qualityStatus === "on_hold") heldCases = unallocated;
        else pendingCases = unallocated;
      }
    }

    const blockedCases = roundDec(
      heldCases + quarantinedCases + rejectedCases + damagedCases + expiredCases + pendingCases,
      3
    );
    const physicalCases = roundDec(availableCases + reservedCases + blockedCases + inTransitCases, 3);

    const unitWeightKg = Number(row.unit_weight_kg || meta?.unitWeightKg || 5.0);
    const physicalWeightKg = roundDec(physicalCases * unitWeightKg, 2);
    const availableWeightKg = roundDec(availableCases * unitWeightKg, 2);
    const reservedWeightKg = roundDec(reservedCases * unitWeightKg, 2);
    const blockedWeightKg = roundDec(blockedCases * unitWeightKg, 2);
    const catchWeightKg =
      row.catch_weight_kg !== null && row.catch_weight_kg !== undefined && Number(row.catch_weight_kg) > 0
        ? roundDec(Number(row.catch_weight_kg), 2)
        : physicalWeightKg;

    const unitCostCents =
      row.unit_cost_cents !== null && row.unit_cost_cents !== undefined && Number(row.unit_cost_cents) > 0
        ? Number(row.unit_cost_cents)
        : meta?.unitCostCents ?? 3500;

    const stockValueCents = Math.round(physicalCases * unitCostCents);
    const availableValueCents = Math.round(availableCases * unitCostCents);
    const reservedValueCents = Math.round(reservedCases * unitCostCents);
    const blockedValueCents = Math.round(blockedCases * unitCostCents);

    let fefoRank: number | null = null;
    if (availableCases > 0) {
      const nextRank = (fefoRankMap.get(sku.toUpperCase()) ?? 0) + 1;
      fefoRankMap.set(sku.toUpperCase(), nextRank);
      fefoRank = nextRank;
    }

    const statusBreakdown: Record<StockStatusType, number> = {
      Available: availableCases,
      Reserved: reservedCases,
      Held: roundDec(heldCases + pendingCases, 3),
      Quarantined: quarantinedCases,
      Rejected: rejectedCases,
      Damaged: damagedCases,
      Expired: expiredCases,
      "In Transit": inTransitCases
    };

    let primaryStatus: StockStatusType = "Available";
    if (expiredCases > 0 && availableCases === 0) primaryStatus = "Expired";
    else if (rejectedCases > 0 && availableCases === 0) primaryStatus = "Rejected";
    else if (quarantinedCases > 0 && availableCases === 0) primaryStatus = "Quarantined";
    else if (damagedCases > 0 && availableCases === 0) primaryStatus = "Damaged";
    else if ((heldCases > 0 || pendingCases > 0) && availableCases === 0) primaryStatus = "Held";
    else if (inTransitCases > 0 && availableCases === 0) primaryStatus = "In Transit";
    else if (reservedCases > 0 && availableCases === 0) primaryStatus = "Reserved";

    const minShelfLifeDays = meta?.minShelfLifeDays ?? 3;
    const shelfLifeDays = meta?.shelfLifeDays ?? 7;
    const shelfLifeAlert: StockLotRecord["shelf_life_alert"] =
      daysRemaining <= 0
        ? "expired"
        : daysRemaining < minShelfLifeDays
          ? "critical"
          : daysRemaining <= minShelfLifeDays + 2
            ? "warning"
            : "ok";

    const lotPlacements = placementsByLot.get(internalLot.toUpperCase()) ?? [
      {
        bin_code: binCode,
        zone_code: String(row.zone || "Chilled A"),
        warehouse: String(row.warehouse || "Milan Cold Hub"),
        quantity_cases: physicalCases,
        weight_kg: physicalWeightKg,
        quality_status: qualityStatus
      }
    ];

    return {
      id: String(row.id),
      organization: String(row.organization || "Ascentra Global Ltd"),
      warehouse: String(row.warehouse || "Milan Cold Hub"),
      zone: String(row.zone || "Chilled A"),
      bin_code: binCode,
      sku,
      product_name: String(row.product_name || meta?.name || sku),
      category: String(row.category || meta?.category || "Chilled"),
      uom: meta?.uom || "case",
      supplier_name: String(row.supplier || "Approved Supplier"),
      supplier_batch: String(row.supplier_lot || internalLot),
      internal_lot: internalLot,
      origin_country: String(row.origin_country || "Italy"),
      received_date: String(row.received_date || todayStr),
      expiry_date: expiryDate,
      days_remaining: Math.max(0, daysRemaining),
      quality_status: qualityStatus,
      primary_stock_status: primaryStatus,
      status_breakdown: statusBreakdown,
      physical_cases: physicalCases,
      available_cases: availableCases,
      reserved_cases: reservedCases,
      blocked_cases: blockedCases,
      held_cases: roundDec(heldCases + pendingCases, 3),
      quarantined_cases: quarantinedCases,
      rejected_cases: rejectedCases,
      damaged_cases: damagedCases,
      expired_cases: expiredCases,
      pending_cases: pendingCases,
      in_transit_cases: inTransitCases,
      unit_weight_kg: unitWeightKg,
      is_catch_weight: meta?.isCatchWeight ?? true,
      physical_weight_kg: physicalWeightKg,
      available_weight_kg: availableWeightKg,
      reserved_weight_kg: reservedWeightKg,
      blocked_weight_kg: blockedWeightKg,
      catch_weight_kg: catchWeightKg,
      unit_cost_cents: unitCostCents,
      stock_value_cents: stockValueCents,
      available_value_cents: availableValueCents,
      reserved_value_cents: reservedValueCents,
      blocked_value_cents: blockedValueCents,
      temp_c: tempC,
      temp_status: tempStatus,
      bin_status: binStatus,
      min_shelf_life_days: minShelfLifeDays,
      shelf_life_days: shelfLifeDays,
      shelf_life_alert: shelfLifeAlert,
      fefo_rank: fefoRank,
      availability_block_reasons: blockReasons,
      bin_placements: lotPlacements
    };
  });

  if (filters.status && filters.status !== "ALL") {
    const target = filters.status as StockStatusType;
    return records.filter(
      (r) =>
        r.primary_stock_status.toLowerCase() === target.toLowerCase() ||
        (r.status_breakdown[target] ?? 0) > 0
    );
  }

  return records;
}

export function getStockIntelligenceDashboard(
  actor: AuthenticatedUser,
  warehouse?: string | null,
  skuFilter?: string | null
) {
  assertPermission(actor, "inventory:read");
  const db = getDb();
  const lots = listMultiLevelStockLots(actor, { warehouse, sku: skuFilter });
  const wf = buildWarehouseScopeClause(actor, warehouse, "warehouse");
  const andWh = wf.clause ? `AND ${wf.clause}` : "";

  // Also include Inbound In-Transit POs/Shipments for In-Transit visibility
  const inTransitPos = db
    .prepare(`SELECT COALESCE(SUM(ordered_cases - received_cases), 0) as c FROM purchase_orders WHERE status = 'in_transit'`)
    .get() as { c: number };

  const statusTotals: Record<StockStatusType, { cases: number; weight_kg: number; value_cents: number }> = {
    Available: { cases: 0, weight_kg: 0, value_cents: 0 },
    Reserved: { cases: 0, weight_kg: 0, value_cents: 0 },
    Held: { cases: 0, weight_kg: 0, value_cents: 0 },
    Quarantined: { cases: 0, weight_kg: 0, value_cents: 0 },
    Rejected: { cases: 0, weight_kg: 0, value_cents: 0 },
    Damaged: { cases: 0, weight_kg: 0, value_cents: 0 },
    Expired: { cases: 0, weight_kg: 0, value_cents: 0 },
    "In Transit": { cases: Number(inTransitPos?.c || 0), weight_kg: Number(inTransitPos?.c || 0) * 5, value_cents: Number(inTransitPos?.c || 0) * 7200 }
  };

  const byWarehouseMap = new Map<
    string,
    {
      warehouse: string;
      physical_cases: number;
      available_cases: number;
      reserved_cases: number;
      blocked_cases: number;
      in_transit_cases: number;
      physical_weight_kg: number;
      catch_weight_kg: number;
      stock_value_cents: number;
      lots_count: number;
    }
  >();

  const byZoneMap = new Map<
    string,
    {
      warehouse: string;
      zone: string;
      physical_cases: number;
      available_cases: number;
      reserved_cases: number;
      blocked_cases: number;
      stock_value_cents: number;
      lots_count: number;
    }
  >();

  const byBinMap = new Map<
    string,
    {
      warehouse: string;
      zone: string;
      bin_code: string;
      physical_cases: number;
      available_cases: number;
      reserved_cases: number;
      blocked_cases: number;
      lots_count: number;
    }
  >();

  const bySkuMap = new Map<
    string,
    {
      sku: string;
      product_name: string;
      category: string;
      physical_cases: number;
      available_cases: number;
      reserved_cases: number;
      blocked_cases: number;
      lots_count: number;
    }
  >();

  let totalPhysicalCases = 0;
  let totalAvailableCases = 0;
  let totalReservedCases = 0;
  let totalBlockedCases = 0;
  let totalLotInTransitCases = 0;
  const pipelineInTransitCases = Number(inTransitPos?.c || 0);
  let totalPhysicalWeightKg = 0;
  let totalAvailableWeightKg = 0;
  let totalReservedWeightKg = 0;
  let totalBlockedWeightKg = 0;
  let totalCatchWeightKg = 0;
  let totalStockValueCents = 0;
  let totalAvailableValueCents = 0;
  let totalReservedValueCents = 0;
  let totalBlockedValueCents = 0;

  for (const lot of lots) {
    totalPhysicalCases += lot.physical_cases;
    totalAvailableCases += lot.available_cases;
    totalReservedCases += lot.reserved_cases;
    totalBlockedCases += lot.blocked_cases;
    totalLotInTransitCases += lot.in_transit_cases;
    totalPhysicalWeightKg += lot.physical_weight_kg;
    totalAvailableWeightKg += lot.available_weight_kg;
    totalReservedWeightKg += lot.reserved_weight_kg;
    totalBlockedWeightKg += lot.blocked_weight_kg;
    totalCatchWeightKg += lot.catch_weight_kg;
    totalStockValueCents += lot.stock_value_cents;
    totalAvailableValueCents += lot.available_value_cents;
    totalReservedValueCents += lot.reserved_value_cents;
    totalBlockedValueCents += lot.blocked_value_cents;

    for (const st of Object.keys(lot.status_breakdown) as StockStatusType[]) {
      const c = lot.status_breakdown[st] || 0;
      if (c > 0) {
        statusTotals[st].cases = roundDec(statusTotals[st].cases + c, 3);
        statusTotals[st].weight_kg = roundDec(statusTotals[st].weight_kg + c * lot.unit_weight_kg, 2);
        statusTotals[st].value_cents += Math.round(c * lot.unit_cost_cents);
      }
    }

    const whEntry = byWarehouseMap.get(lot.warehouse) ?? {
      warehouse: lot.warehouse,
      physical_cases: 0,
      available_cases: 0,
      reserved_cases: 0,
      blocked_cases: 0,
      in_transit_cases: 0,
      physical_weight_kg: 0,
      catch_weight_kg: 0,
      stock_value_cents: 0,
      lots_count: 0
    };
    whEntry.physical_cases = roundDec(whEntry.physical_cases + lot.physical_cases, 3);
    whEntry.available_cases = roundDec(whEntry.available_cases + lot.available_cases, 3);
    whEntry.reserved_cases = roundDec(whEntry.reserved_cases + lot.reserved_cases, 3);
    whEntry.blocked_cases = roundDec(whEntry.blocked_cases + lot.blocked_cases, 3);
    whEntry.in_transit_cases = roundDec(whEntry.in_transit_cases + lot.in_transit_cases, 3);
    whEntry.physical_weight_kg = roundDec(whEntry.physical_weight_kg + lot.physical_weight_kg, 2);
    whEntry.catch_weight_kg = roundDec(whEntry.catch_weight_kg + lot.catch_weight_kg, 2);
    whEntry.stock_value_cents += lot.stock_value_cents;
    whEntry.lots_count += 1;
    byWarehouseMap.set(lot.warehouse, whEntry);

    const zoneKey = `${lot.warehouse}::${lot.zone}`;
    const zEntry = byZoneMap.get(zoneKey) ?? {
      warehouse: lot.warehouse,
      zone: lot.zone,
      physical_cases: 0,
      available_cases: 0,
      reserved_cases: 0,
      blocked_cases: 0,
      stock_value_cents: 0,
      lots_count: 0
    };
    zEntry.physical_cases = roundDec(zEntry.physical_cases + lot.physical_cases, 3);
    zEntry.available_cases = roundDec(zEntry.available_cases + lot.available_cases, 3);
    zEntry.reserved_cases = roundDec(zEntry.reserved_cases + lot.reserved_cases, 3);
    zEntry.blocked_cases = roundDec(zEntry.blocked_cases + lot.blocked_cases, 3);
    zEntry.stock_value_cents += lot.stock_value_cents;
    zEntry.lots_count += 1;
    byZoneMap.set(zoneKey, zEntry);

    const binKey = `${lot.warehouse}::${lot.zone}::${lot.bin_code}`;
    const bEntry = byBinMap.get(binKey) ?? {
      warehouse: lot.warehouse,
      zone: lot.zone,
      bin_code: lot.bin_code,
      physical_cases: 0,
      available_cases: 0,
      reserved_cases: 0,
      blocked_cases: 0,
      lots_count: 0
    };
    bEntry.physical_cases = roundDec(bEntry.physical_cases + lot.physical_cases, 3);
    bEntry.available_cases = roundDec(bEntry.available_cases + lot.available_cases, 3);
    bEntry.reserved_cases = roundDec(bEntry.reserved_cases + lot.reserved_cases, 3);
    bEntry.blocked_cases = roundDec(bEntry.blocked_cases + lot.blocked_cases, 3);
    bEntry.lots_count += 1;
    byBinMap.set(binKey, bEntry);

    const skuKey = lot.sku.toUpperCase();
    const skuEntry = bySkuMap.get(skuKey) ?? {
      sku: lot.sku,
      product_name: lot.product_name,
      category: lot.category,
      physical_cases: 0,
      available_cases: 0,
      reserved_cases: 0,
      blocked_cases: 0,
      lots_count: 0
    };
    skuEntry.physical_cases = roundDec(skuEntry.physical_cases + lot.physical_cases, 3);
    skuEntry.available_cases = roundDec(skuEntry.available_cases + lot.available_cases, 3);
    skuEntry.reserved_cases = roundDec(skuEntry.reserved_cases + lot.reserved_cases, 3);
    skuEntry.blocked_cases = roundDec(skuEntry.blocked_cases + lot.blocked_cases, 3);
    skuEntry.lots_count += 1;
    bySkuMap.set(skuKey, skuEntry);
  }

  // Cycle count metrics
  const ccStats = db
    .prepare(
      `SELECT
        COUNT(*) as total_counts,
        SUM(CASE WHEN status IN ('Submitted', 'Discrepancy Review') THEN 1 ELSE 0 END) as pending_approval,
        SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END) as approved_counts,
        SUM(CASE WHEN status = 'Approved' AND COALESCE(variance_cases, 0) = 0 THEN 1 ELSE 0 END) as exact_counts
       FROM cycle_counts WHERE 1=1 ${andWh}`
    )
    .get(...wf.params) as {
    total_counts: number;
    pending_approval: number;
    approved_counts: number;
    exact_counts: number;
  };

  const approvedCounts = Number(ccStats?.approved_counts || 0);
  const exactCounts = Number(ccStats?.exact_counts || 0);
  const cycleCountAccuracyPct =
    approvedCounts > 0 ? roundDec((exactCounts / approvedCounts) * 100, 1) : 100.0;

  // Pending adjustments
  const adjPending = db
    .prepare(`SELECT COUNT(*) as c FROM stock_adjustments WHERE status = 'Pending Approval' ${andWh}`)
    .get(...wf.params) as { c: number };

  // Active reservations
  const activeRes = db
    .prepare(
      `SELECT COUNT(*) as c, COALESCE(SUM(reserved_cases), 0) as q
       FROM stock_reservations
       WHERE status IN ('Active', 'Partially Reserved') ${andWh}`
    )
    .get(...wf.params) as { c: number; q: number };

  const shelfLifeAlerts = lots.filter((l) => l.shelf_life_alert !== "ok" && l.physical_cases > 0);

  return {
    organization: "Ascentra Global Ltd",
    summary: {
      physical_cases: roundDec(totalPhysicalCases, 3),
      available_cases: roundDec(totalAvailableCases, 3),
      reserved_cases: roundDec(totalReservedCases, 3),
      blocked_cases: roundDec(totalBlockedCases, 3),
      in_transit_cases: roundDec(totalLotInTransitCases, 3),
      pipeline_in_transit_cases: roundDec(pipelineInTransitCases, 3),
      total_in_transit_cases: roundDec(totalLotInTransitCases + pipelineInTransitCases, 3),
      physical_weight_kg: roundDec(totalPhysicalWeightKg, 2),
      available_weight_kg: roundDec(totalAvailableWeightKg, 2),
      reserved_weight_kg: roundDec(totalReservedWeightKg, 2),
      blocked_weight_kg: roundDec(totalBlockedWeightKg, 2),
      catch_weight_kg: roundDec(totalCatchWeightKg, 2),
      stock_value_cents: totalStockValueCents,
      available_value_cents: totalAvailableValueCents,
      reserved_value_cents: totalReservedValueCents,
      blocked_value_cents: totalBlockedValueCents,
      active_lots_count: lots.length,
      shelf_life_alerts_count: shelfLifeAlerts.length,
      cycle_count_accuracy_pct: cycleCountAccuracyPct,
      total_cycle_counts: Number(ccStats?.total_counts || 0),
      pending_cycle_count_approvals: Number(ccStats?.pending_approval || 0),
      pending_adjustment_approvals: Number(adjPending?.c || 0),
      active_reservations_count: Number(activeRes?.c || 0),
      reconciled:
        Math.abs(
          totalPhysicalCases -
            (totalAvailableCases + totalReservedCases + totalBlockedCases + totalLotInTransitCases)
        ) < 0.001
    },
    status_breakdown: statusTotals,
    by_warehouse: Array.from(byWarehouseMap.values()),
    by_zone: Array.from(byZoneMap.values()),
    by_bin: Array.from(byBinMap.values()),
    by_sku: Array.from(bySkuMap.values()),
    shelf_life_alerts: shelfLifeAlerts
  };
}

export function getLotBatchDetail(actor: AuthenticatedUser, lotIdOrBatch: string) {
  assertPermission(actor, "inventory:read");
  const lots = listMultiLevelStockLots(actor);
  const target = lots.find(
    (l) =>
      l.id.toLowerCase() === lotIdOrBatch.toLowerCase() ||
      l.internal_lot.toLowerCase() === lotIdOrBatch.toLowerCase() ||
      l.supplier_batch.toLowerCase() === lotIdOrBatch.toLowerCase()
  );

  if (!target) {
    throw new ApiError(404, "LOT_NOT_FOUND", `Inventory lot '${lotIdOrBatch}' was not found.`);
  }

  requireWarehouseAccess(actor, target.warehouse);

  const db = getDb();
  const reservations = db
    .prepare(`SELECT * FROM stock_reservations WHERE upper(internal_lot) = upper(?) ORDER BY created_at DESC`)
    .all(target.internal_lot) as Record<string, unknown>[];

  const movements = db
    .prepare(`SELECT * FROM stock_movements WHERE upper(batch_id) = upper(?) ORDER BY created_at DESC LIMIT 50`)
    .all(target.internal_lot) as Record<string, unknown>[];

  const cycleCounts = db
    .prepare(`SELECT * FROM cycle_counts WHERE upper(internal_lot) = upper(?) ORDER BY created_at DESC`)
    .all(target.internal_lot) as Record<string, unknown>[];

  const adjustments = db
    .prepare(`SELECT * FROM stock_adjustments WHERE upper(internal_lot) = upper(?) ORDER BY requested_at DESC`)
    .all(target.internal_lot) as Record<string, unknown>[];

  const fefoLogs = db
    .prepare(`SELECT * FROM fefo_allocation_logs WHERE upper(internal_lot) = upper(?) ORDER BY created_at DESC LIMIT 30`)
    .all(target.internal_lot) as Record<string, unknown>[];

  return {
    lot: target,
    reservations: reservations.map((r) => hydrateReservation(r)),
    movements: movements.map((m) => hydrateMovement(m)),
    cycle_counts: cycleCounts.map((c) => hydrateCycleCount(c, actor)),
    adjustments: adjustments.map((a) => hydrateAdjustment(a)),
    fefo_logs: fefoLogs
  };
}

// ----------------------------------------------------------------------------
// 3. Minimum Remaining Shelf Life Rules & Evaluation
// ----------------------------------------------------------------------------

function hydrateShelfLifeRule(row: Record<string, unknown>): ShelfLifeRuleRecord {
  return {
    id: String(row.id),
    rule_code: String(row.rule_code),
    rule_scope: (row.rule_scope as ShelfLifeRuleRecord["rule_scope"]) || "product",
    sku: row.sku ? String(row.sku) : null,
    product_name: row.product_name ? String(row.product_name) : null,
    category: row.category ? String(row.category) : null,
    customer_id: row.customer_id ? String(row.customer_id) : null,
    customer_name: row.customer_name ? String(row.customer_name) : null,
    customer_segment: row.customer_segment ? String(row.customer_segment) : null,
    min_remaining_days: Number(row.min_remaining_days || 0),
    min_remaining_pct: row.min_remaining_pct !== null && row.min_remaining_pct !== undefined ? Number(row.min_remaining_pct) : null,
    enforce_at_allocation: Boolean(row.enforce_at_allocation),
    enforce_at_pick: Boolean(row.enforce_at_pick),
    allow_manager_override: Boolean(row.allow_manager_override),
    notes: row.notes ? String(row.notes) : null,
    active: Boolean(row.active),
    created_by: String(row.created_by || "system"),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || "")
  };
}

export function listShelfLifeRules(actor?: AuthenticatedUser): ShelfLifeRuleRecord[] {
  if (actor) assertPermission(actor, "inventory:read");
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM shelf_life_rules ORDER BY active DESC, min_remaining_days DESC, rule_code ASC`).all() as Record<
    string,
    unknown
  >[];
  return rows.map(hydrateShelfLifeRule);
}

export function upsertShelfLifeRule(
  actor: AuthenticatedUser,
  input: {
    id?: string;
    rule_code?: string;
    rule_scope: "product" | "customer" | "customer_product" | "segment";
    sku?: string | null;
    product_name?: string | null;
    category?: string | null;
    customer_id?: string | null;
    customer_name?: string | null;
    customer_segment?: string | null;
    min_remaining_days: number;
    min_remaining_pct?: number | null;
    enforce_at_allocation?: boolean;
    enforce_at_pick?: boolean;
    allow_manager_override?: boolean;
    notes?: string | null;
    active?: boolean;
  }
): ShelfLifeRuleRecord {
  assertPermission(actor, "inventory:adjust");
  requireMutationAuthorization(actor, "configure minimum remaining shelf-life rule");

  const minDays = Number(input.min_remaining_days);
  if (!Number.isFinite(minDays) || minDays < 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "min_remaining_days must be a non-negative integer.");
  }

  const db = getDb();
  const now = new Date().toISOString();
  const id = input.id?.trim() || `SLR-${Date.now().toString().slice(-6)}`;
  const ruleCode =
    input.rule_code?.trim().toUpperCase() ||
    `SLR-${input.rule_scope.toUpperCase()}-${Date.now().toString().slice(-4)}`;

  const existing = db
    .prepare(`SELECT * FROM shelf_life_rules WHERE id = ? OR upper(rule_code) = upper(?)`)
    .get(id, ruleCode) as Record<string, unknown> | undefined;

  if (existing) {
    db.prepare(
      `UPDATE shelf_life_rules
       SET rule_scope = ?, sku = ?, product_name = ?, category = ?,
           customer_id = ?, customer_name = ?, customer_segment = ?,
           min_remaining_days = ?, min_remaining_pct = ?,
           enforce_at_allocation = ?, enforce_at_pick = ?, allow_manager_override = ?,
           notes = ?, active = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      input.rule_scope,
      input.sku ?? null,
      input.product_name ?? null,
      input.category ?? null,
      input.customer_id ?? null,
      input.customer_name ?? null,
      input.customer_segment ?? null,
      Math.round(minDays),
      input.min_remaining_pct ?? null,
      input.enforce_at_allocation === false ? 0 : 1,
      input.enforce_at_pick === false ? 0 : 1,
      input.allow_manager_override === false ? 0 : 1,
      input.notes ?? null,
      input.active === false ? 0 : 1,
      now,
      String(existing.id)
    );

    recordAuditEvent({
      actor,
      action: "inventory.shelf_life_rule_updated",
      entityType: "ShelfLifeRule",
      entityId: String(existing.id),
      after: { rule_code: existing.rule_code, min_remaining_days: minDays }
    });

    const row = db.prepare(`SELECT * FROM shelf_life_rules WHERE id = ?`).get(String(existing.id)) as Record<string, unknown>;
    return hydrateShelfLifeRule(row);
  }

  db.prepare(
    `INSERT INTO shelf_life_rules (
      id, rule_code, rule_scope, sku, product_name, category,
      customer_id, customer_name, customer_segment,
      min_remaining_days, min_remaining_pct,
      enforce_at_allocation, enforce_at_pick, allow_manager_override,
      notes, active, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    ruleCode,
    input.rule_scope,
    input.sku ?? null,
    input.product_name ?? null,
    input.category ?? null,
    input.customer_id ?? null,
    input.customer_name ?? null,
    input.customer_segment ?? null,
    Math.round(minDays),
    input.min_remaining_pct ?? null,
    input.enforce_at_allocation === false ? 0 : 1,
    input.enforce_at_pick === false ? 0 : 1,
    input.allow_manager_override === false ? 0 : 1,
    input.notes ?? null,
    input.active === false ? 0 : 1,
    actor.email,
    now,
    now
  );

  recordAuditEvent({
    actor,
    action: "inventory.shelf_life_rule_created",
    entityType: "ShelfLifeRule",
    entityId: id,
    after: { rule_code: ruleCode, rule_scope: input.rule_scope, min_remaining_days: minDays }
  });

  const created = db.prepare(`SELECT * FROM shelf_life_rules WHERE id = ?`).get(id) as Record<string, unknown>;
  return hydrateShelfLifeRule(created);
}

export function resolveMinimumShelfLifeRequirement(params: {
  sku: string;
  customer_id?: string | null;
  customer_name?: string | null;
  customer_segment?: string | null;
  order_min_remaining_days?: number | null;
}): {
  min_remaining_days: number;
  applied_rules: string[];
} {
  const db = getDb();
  const skuUpper = (params.sku || "").trim().toUpperCase();
  const productMeta = getProductMetaMap().get(skuUpper);

  let requiredDays = productMeta?.minShelfLifeDays ?? 1;
  const appliedRules: string[] = [];

  if (productMeta && productMeta.minShelfLifeDays > 0) {
    appliedRules.push(`Product master baseline (${productMeta.sku}): >= ${productMeta.minShelfLifeDays}d`);
  }

  let customerId = params.customer_id?.trim() || null;
  let customerName = params.customer_name?.trim() || null;
  let customerSegment = params.customer_segment?.trim() || null;

  if ((customerId || customerName) && !customerSegment) {
    const custRow = db
      .prepare(`SELECT id, name, segment FROM customers WHERE id = ? OR lower(name) = lower(?) LIMIT 1`)
      .get(customerId || "", customerName || "") as { id: string; name: string; segment: string } | undefined;
    if (custRow) {
      customerId = custRow.id;
      customerName = custRow.name;
      customerSegment = custRow.segment;
    }
  }

  const activeRules = listShelfLifeRules().filter((r) => r.active && r.enforce_at_allocation);

  for (const rule of activeRules) {
    let matches = false;
    if (rule.rule_scope === "product" && rule.sku && rule.sku.toUpperCase() === skuUpper) {
      matches = true;
    } else if (
      rule.rule_scope === "customer" &&
      ((customerId && rule.customer_id && rule.customer_id.toLowerCase() === customerId.toLowerCase()) ||
        (customerName && rule.customer_name && rule.customer_name.toLowerCase() === customerName.toLowerCase()))
    ) {
      matches = true;
    } else if (
      rule.rule_scope === "customer_product" &&
      rule.sku &&
      rule.sku.toUpperCase() === skuUpper &&
      ((customerId && rule.customer_id && rule.customer_id.toLowerCase() === customerId.toLowerCase()) ||
        (customerName && rule.customer_name && rule.customer_name.toLowerCase() === customerName.toLowerCase()))
    ) {
      matches = true;
    } else if (
      rule.rule_scope === "segment" &&
      customerSegment &&
      rule.customer_segment &&
      customerSegment.toLowerCase().includes(rule.customer_segment.toLowerCase())
    ) {
      matches = true;
    }

    if (matches) {
      let ruleDays = rule.min_remaining_days;
      if (rule.min_remaining_pct && productMeta) {
        const pctDays = Math.ceil((productMeta.shelfLifeDays * rule.min_remaining_pct) / 100);
        ruleDays = Math.max(ruleDays, pctDays);
      }
      if (ruleDays >= requiredDays) {
        requiredDays = ruleDays;
      }
      appliedRules.push(`${rule.rule_code} (${rule.rule_scope}): >= ${ruleDays}d`);
    }
  }

  if (
    params.order_min_remaining_days !== undefined &&
    params.order_min_remaining_days !== null &&
    Number(params.order_min_remaining_days) > 0
  ) {
    const orderDays = Math.round(Number(params.order_min_remaining_days));
    if (orderDays >= requiredDays) {
      requiredDays = orderDays;
    }
    appliedRules.push(`Order-specific requirement: >= ${orderDays}d`);
  }

  return {
    min_remaining_days: requiredDays,
    applied_rules: appliedRules
  };
}

// ----------------------------------------------------------------------------
// 4. FEFO Inventory Allocation Engine
// ----------------------------------------------------------------------------

export function evaluateFefoAllocation(
  actor: AuthenticatedUser,
  input: {
    sku: string;
    requested_cases: number;
    warehouse?: string | null;
    internal_lot?: string | null;
    customer_id?: string | null;
    customer_name?: string | null;
    customer_segment?: string | null;
    delivery_date?: string | null;
    order_min_remaining_days?: number | null;
    order_number?: string | null;
    allow_partial?: boolean;
    persist_log?: boolean;
  }
): FefoAllocationResult {
  assertPermission(actor, "inventory:read");

  const sku = (input.sku || "").trim();
  const requestedCases = roundDec(Number(input.requested_cases || 0), 3);
  if (!sku || requestedCases <= 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Valid sku and positive requested_cases are required for FEFO allocation.");
  }

  if (input.warehouse && input.warehouse !== "ALL") {
    requireWarehouseAccess(actor, input.warehouse);
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const deliveryDate = (input.delivery_date || "").trim().slice(0, 10) || todayStr;

  const shelfLifeReq = resolveMinimumShelfLifeRequirement({
    sku,
    customer_id: input.customer_id,
    customer_name: input.customer_name,
    customer_segment: input.customer_segment,
    order_min_remaining_days: input.order_min_remaining_days
  });

  // Query all lots for this SKU across warehouses (so we can record why cross-warehouse or blocked lots were excluded)
  const allSkuLots = listMultiLevelStockLots(actor, { sku });

  const candidates: FefoLotCandidateEvaluation[] = [];
  const selectedAllocations: FefoAllocationResult["selected_allocations"] = [];
  let remainingToAllocate = requestedCases;
  let fefoCounter = 0;

  // Lots are already sorted by expiry_date ASC, received_date ASC, batch_id ASC
  for (const lot of allSkuLots) {
    const daysAtDelivery = computeDaysBetweenDates(lot.expiry_date, deliveryDate);
    const daysToday = lot.days_remaining;

    let eligible = true;
    let reasonCode = "ELIGIBLE_FEFO";
    let reasonDetail = "";

    if (
      input.internal_lot &&
      lot.internal_lot.toUpperCase() !== input.internal_lot.toUpperCase()
    ) {
      eligible = false;
      reasonCode = "LOT_NOT_REQUESTED";
      reasonDetail = `Excluded: Specific lot '${input.internal_lot}' requested, this lot is '${lot.internal_lot}'.`;
    } else if (
      input.warehouse &&
      input.warehouse !== "ALL" &&
      lot.warehouse.toLowerCase() !== input.warehouse.toLowerCase()
    ) {
      eligible = false;
      reasonCode = "WAREHOUSE_MISMATCH";
      reasonDetail = `Excluded: Lot is in '${lot.warehouse}', requested warehouse is '${input.warehouse}'.`;
    } else if (lot.quality_status !== "released") {
      eligible = false;
      reasonCode = `QUALITY_${lot.quality_status.toUpperCase()}`;
      reasonDetail = `Excluded: Lot quality status is '${lot.quality_status}' (${lot.blocked_cases} cases blocked). Only QA-released stock can be allocated.`;
    } else if (lot.expiry_date <= todayStr || daysToday <= 0) {
      eligible = false;
      reasonCode = "LOT_EXPIRED";
      reasonDetail = `Excluded: Lot expired on ${lot.expiry_date}.`;
    } else if (daysAtDelivery <= 0) {
      eligible = false;
      reasonCode = "EXPIRED_BY_DELIVERY_DATE";
      reasonDetail = `Excluded: Lot expires on ${lot.expiry_date}, on or before expected delivery date ${deliveryDate} (${daysAtDelivery}d remaining at delivery).`;
    } else if (daysAtDelivery < shelfLifeReq.min_remaining_days) {
      eligible = false;
      reasonCode = "BELOW_MIN_SHELF_LIFE";
      reasonDetail = `Excluded: Remaining shelf life at delivery (${daysAtDelivery}d) on delivery date (${deliveryDate}) is below required minimum ${shelfLifeReq.min_remaining_days}d (${shelfLifeReq.applied_rules.join("; ")}).`;
    } else if (lot.temp_status === "excursion") {
      eligible = false;
      reasonCode = "TEMPERATURE_EXCURSION";
      reasonDetail = `Excluded: Lot has an active temperature excursion (${lot.temp_c}°C).`;
    } else if (lot.bin_status !== "active") {
      eligible = false;
      reasonCode = "BIN_RESTRICTED_OR_BLOCKED";
      reasonDetail = `Excluded: Bin '${lot.bin_code}' is '${lot.bin_status}'.`;
    } else if (lot.available_cases <= 0) {
      eligible = false;
      reasonCode = "ZERO_AVAILABLE_STOCK";
      reasonDetail = `Excluded: 0 available cases (Physical: ${lot.physical_cases}, Reserved: ${lot.reserved_cases}, Blocked: ${lot.blocked_cases}).`;
    }

    let decision: FefoLotCandidateEvaluation["decision"] = "excluded";
    let lotAllocated = 0;
    let rank: number | null = null;

    if (eligible) {
      fefoCounter += 1;
      rank = fefoCounter;
      if (remainingToAllocate > 0) {
        lotAllocated = roundDec(Math.min(lot.available_cases, remainingToAllocate), 3);
        remainingToAllocate = roundDec(remainingToAllocate - lotAllocated, 3);
        decision = lotAllocated < requestedCases && lotAllocated === lot.available_cases ? "partial_selected" : "selected";
        reasonCode = decision === "partial_selected" ? "SELECTED_FEFO_PARTIAL_LOT" : "SELECTED_FEFO_EARLIEST_EXPIRY";
        reasonDetail = `Selected as FEFO Rank #${rank}: earliest eligible expiry (${lot.expiry_date}, ${daysAtDelivery}d remaining at delivery >= ${shelfLifeReq.min_remaining_days}d required), QA-released, temp ${lot.temp_c}°C in range, allocated ${lotAllocated}/${lot.available_cases} available cases.`;

        selectedAllocations.push({
          internal_lot: lot.internal_lot,
          supplier_batch: lot.supplier_batch,
          warehouse: lot.warehouse,
          zone: lot.zone,
          bin_code: lot.bin_code,
          expiry_date: lot.expiry_date,
          days_remaining_at_delivery: daysAtDelivery,
          allocated_cases: lotAllocated,
          allocated_weight_kg: roundDec(lotAllocated * lot.unit_weight_kg, 2),
          fefo_rank: rank,
          selection_reason: reasonDetail
        });
      } else {
        decision = "eligible_standby";
        reasonCode = "STANDBY_LATER_EXPIRY";
        reasonDetail = `Eligible (FEFO Rank #${rank}, expires ${lot.expiry_date}, ${daysAtDelivery}d at delivery), not needed because earlier-expiring lots satisfied the ${requestedCases} case request.`;
      }
    }

    candidates.push({
      internal_lot: lot.internal_lot,
      supplier_batch: lot.supplier_batch,
      sku: lot.sku,
      product_name: lot.product_name,
      warehouse: lot.warehouse,
      zone: lot.zone,
      bin_code: lot.bin_code,
      received_date: lot.received_date,
      expiry_date: lot.expiry_date,
      days_remaining_today: daysToday,
      days_remaining_at_delivery: daysAtDelivery,
      min_shelf_life_days_required: shelfLifeReq.min_remaining_days,
      physical_cases: lot.physical_cases,
      available_cases: lot.available_cases,
      reserved_cases: lot.reserved_cases,
      blocked_cases: lot.blocked_cases,
      unit_weight_kg: lot.unit_weight_kg,
      quality_status: lot.quality_status,
      temp_c: lot.temp_c,
      temp_status: lot.temp_status,
      eligible,
      decision,
      allocated_cases: lotAllocated,
      allocated_weight_kg: roundDec(lotAllocated * lot.unit_weight_kg, 2),
      fefo_rank: rank,
      reason_code: reasonCode,
      reason_detail: reasonDetail,
      exclusion_reasons: eligible ? [] : [reasonDetail, reasonCode]
    });
  }

  const totalAllocated = roundDec(requestedCases - remainingToAllocate, 3);
  const allocationRef = `FEFO-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;

  if (input.persist_log !== false && candidates.length > 0) {
    const db = getDb();
    const now = new Date().toISOString();
    const insertLog = db.prepare(`
      INSERT INTO fefo_allocation_logs (
        id, allocation_ref, order_number, customer_id, customer_name, sku, warehouse,
        delivery_date, requested_cases, allocated_cases, min_shelf_life_days,
        internal_lot, expiry_date, days_at_delivery, decision, lot_allocated_cases,
        reason_code, reason_detail, actor_email, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      insertLog.run(
        `FLG-${Date.now()}-${i}-${Math.floor(Math.random() * 999)}`,
        allocationRef,
        input.order_number ?? null,
        input.customer_id ?? null,
        input.customer_name ?? null,
        sku,
        input.warehouse ?? null,
        deliveryDate,
        requestedCases,
        totalAllocated,
        shelfLifeReq.min_remaining_days,
        c.internal_lot,
        c.expiry_date,
        c.days_remaining_at_delivery,
        c.decision,
        c.allocated_cases,
        c.reason_code,
        c.reason_detail,
        actor.email,
        now
      );
    }
  }

  if (totalAllocated <= 0 || (remainingToAllocate > 0 && input.allow_partial === false)) {
    const exclusionSummary =
      candidates.length > 0
        ? candidates.map((c) => `${c.internal_lot}: ${c.reason_detail}`).join(" | ")
        : `No inventory lots exist for SKU '${sku}'.`;

    throw new ApiError(
      409,
      "INSUFFICIENT_ELIGIBLE_STOCK",
      `FEFO allocation failed for ${requestedCases} cases of '${sku}' (delivery ${deliveryDate}, min shelf life ${shelfLifeReq.min_remaining_days}d): only ${totalAllocated} eligible cases available. Lot evaluations: ${exclusionSummary}`
    );
  }

  const productMeta = getProductMetaMap().get(sku.toUpperCase());

  return {
    allocation_ref: allocationRef,
    status: remainingToAllocate === 0 ? "allocated" : "partially_allocated",
    sku,
    product_name: allSkuLots[0]?.product_name || productMeta?.name || sku,
    warehouse: input.warehouse ?? null,
    customer_id: input.customer_id ?? null,
    customer_name: input.customer_name ?? null,
    delivery_date: deliveryDate,
    requested_cases: requestedCases,
    allocated_cases: totalAllocated,
    shortfall_cases: remainingToAllocate,
    fully_allocated: remainingToAllocate === 0,
    min_shelf_life_days_required: shelfLifeReq.min_remaining_days,
    applied_shelf_life_rules: shelfLifeReq.applied_rules,
    allocations: selectedAllocations,
    selected_allocations: selectedAllocations,
    candidates
  };
}

// ----------------------------------------------------------------------------
// 5. Stock Reservations Management (with Concurrency Protection)
// ----------------------------------------------------------------------------

function hydrateReservation(row: Record<string, unknown>, includeEvents = false): StockReservationRecord {
  const db = getDb();
  const id = String(row.id);
  const events = includeEvents
    ? (db
        .prepare(`SELECT * FROM stock_reservation_events WHERE reservation_id = ? ORDER BY created_at DESC, id DESC`)
        .all(id) as Record<string, unknown>[]).map((e) => ({
        id: String(e.id),
        event_type: String(e.event_type),
        previous_status: e.previous_status ? String(e.previous_status) : null,
        new_status: String(e.new_status),
        quantity_cases: Number(e.quantity_cases || 0),
        reason: e.reason ? String(e.reason) : null,
        actor_name: String(e.actor_name || ""),
        created_at: String(e.created_at || "")
      }))
    : undefined;

  return {
    id,
    reservation_number: String(row.reservation_number),
    order_id: row.order_id ? String(row.order_id) : null,
    order_number: row.order_number ? String(row.order_number) : null,
    order_line_id: row.order_line_id ? String(row.order_line_id) : null,
    customer_id: row.customer_id ? String(row.customer_id) : null,
    customer_name: row.customer_name ? String(row.customer_name) : null,
    sku: String(row.sku),
    product_name: String(row.product_name),
    internal_lot: String(row.internal_lot),
    supplier_batch: row.supplier_batch ? String(row.supplier_batch) : null,
    warehouse: String(row.warehouse),
    zone: row.zone ? String(row.zone) : null,
    bin_code: row.bin_code ? String(row.bin_code) : null,
    requested_cases: Number(row.requested_cases || 0),
    reserved_cases: Number(row.reserved_cases || 0),
    reserved_weight_kg: Number(row.reserved_weight_kg || 0),
    uom: String(row.uom || "case"),
    delivery_date: row.delivery_date ? String(row.delivery_date) : null,
    min_shelf_life_days_required: Number(row.min_shelf_life_days_required || 0),
    days_remaining_at_delivery:
      row.days_remaining_at_delivery !== null && row.days_remaining_at_delivery !== undefined
        ? Number(row.days_remaining_at_delivery)
        : null,
    fefo_rank: row.fefo_rank !== null && row.fefo_rank !== undefined ? Number(row.fefo_rank) : null,
    selection_reason: row.selection_reason ? String(row.selection_reason) : null,
    status: (row.status as StockReservationRecord["status"]) || "Active",
    pick_task_id: row.pick_task_id ? String(row.pick_task_id) : null,
    expires_at: String(row.expires_at),
    released_reason: row.released_reason ? String(row.released_reason) : null,
    created_by: String(row.created_by),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    events
  };
}

export function expireStaleReservations(actor?: AuthenticatedUser): number {
  const db = getDb();
  const now = new Date().toISOString();
  const expiredRows = db
    .prepare(
      `SELECT * FROM stock_reservations
       WHERE status IN ('Active', 'Partially Reserved')
         AND expires_at < ?`
    )
    .all(now) as Record<string, unknown>[];

  if (expiredRows.length === 0) return 0;

  withTransaction(() => {
    for (const row of expiredRows) {
      const resId = String(row.id);
      const resNumber = String(row.reservation_number);
      const lotCode = String(row.internal_lot);
      const reservedQty = Number(row.reserved_cases || 0);
      const prevStatus = String(row.status);

      db.prepare(
        `UPDATE stock_reservations
         SET status = 'Expired', released_reason = 'Reservation TTL expired automatically', updated_at = ?
         WHERE id = ?`
      ).run(now, resId);

      db.prepare(
        `UPDATE inventory_lots
         SET allocated_cases = MAX(0, allocated_cases - ?), updated_at = ?
         WHERE upper(batch_id) = upper(?)`
      ).run(reservedQty, now, lotCode);

      db.prepare(
        `INSERT INTO stock_reservation_events (
          id, reservation_id, reservation_number, event_type, previous_status, new_status,
          quantity_cases, reason, actor_id, actor_name, created_at
        ) VALUES (?, ?, ?, 'expired', ?, 'Expired', ?, 'Reservation TTL expired', ?, ?, ?)`
      ).run(
        `SRE-${Date.now()}-${Math.floor(Math.random() * 999)}`,
        resId,
        resNumber,
        prevStatus,
        reservedQty,
        actor?.id || "SYSTEM",
        actor?.name || "System Scheduler",
        now
      );
    }
  });

  return expiredRows.length;
}

export function listStockReservations(
  actor: AuthenticatedUser,
  filters: {
    warehouse?: string | null;
    status?: string | null;
    order_number?: string | null;
    sku?: string | null;
    lot?: string | null;
  } = {}
): StockReservationRecord[] {
  assertPermission(actor, "inventory:read");
  expireStaleReservations(actor);

  const db = getDb();
  const wf = buildWarehouseScopeClause(actor, filters.warehouse, "warehouse");
  const conditions: string[] = [];
  const params: string[] = [];

  if (wf.clause) {
    conditions.push(wf.clause);
    params.push(...wf.params);
  }
  if (filters.status && filters.status !== "ALL") {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters.order_number) {
    conditions.push("upper(order_number) = upper(?)");
    params.push(filters.order_number);
  }
  if (filters.sku && filters.sku !== "ALL") {
    conditions.push("upper(sku) = upper(?)");
    params.push(filters.sku);
  }
  if (filters.lot) {
    conditions.push("upper(internal_lot) = upper(?)");
    params.push(filters.lot);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM stock_reservations ${whereSql} ORDER BY created_at DESC, id DESC`)
    .all(...params) as Record<string, unknown>[];

  return rows.map((r) => hydrateReservation(r, true));
}

export function createStockReservation(
  actor: AuthenticatedUser,
  input: {
    order_id?: string | null;
    order_number?: string | null;
    order_line_id?: string | null;
    customer_id?: string | null;
    customer_name?: string | null;
    customer_segment?: string | null;
    sku: string;
    internal_lot?: string | null;
    requested_cases: number;
    warehouse?: string | null;
    delivery_date?: string | null;
    order_min_remaining_days?: number | null;
    allow_partial?: boolean;
    ttl_hours?: number;
  }
): {
  reservations: StockReservationRecord[];
  allocation: FefoAllocationResult;
} {
  if (
    !hasPermission(actor, "inventory.reserve") &&
    !hasPermission(actor, "inventory:adjust") &&
    !hasPermission(actor, "orders:write") &&
    !hasPermission(actor, "orders:credit_override")
  ) {
    throw new ApiError(403, "FORBIDDEN_INSUFFICIENT_ROLE", `Role '${actor.role}' is not authorized to reserve stock.`);
  }
  requireMutationAuthorization(actor, "create stock reservation");

  expireStaleReservations(actor);

  const requestedCases = roundDec(Number(input.requested_cases || 0), 3);
  if (!input.sku || requestedCases <= 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Valid sku and positive requested_cases are required.");
  }

  const allowPartial = input.allow_partial !== false;
  const ttlHours = Math.max(0.1, Number(input.ttl_hours ?? 24));
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();

  // Execute inside an IMMEDIATE transaction for strict concurrency protection against double reservation
  return withTransaction((db) => {
    const allocation = evaluateFefoAllocation(actor, {
      sku: input.sku,
      internal_lot: input.internal_lot,
      requested_cases: requestedCases,
      warehouse: input.warehouse,
      customer_id: input.customer_id,
      customer_name: input.customer_name,
      customer_segment: input.customer_segment,
      delivery_date: input.delivery_date,
      order_min_remaining_days: input.order_min_remaining_days,
      order_number: input.order_number,
      allow_partial: allowPartial,
      persist_log: true
    });

    const createdIds: string[] = [];
    const now = new Date().toISOString();
    const isPartialOverall = allocation.allocated_cases < requestedCases;

    for (const sel of allocation.selected_allocations) {
      // Atomic concurrency guard: verify available_cases is still >= sel.allocated_cases at the exact moment of update
      const updateResult = db
        .prepare(
          `UPDATE inventory_lots
           SET allocated_cases = allocated_cases + ?,
               updated_at = ?
           WHERE upper(batch_id) = upper(?)
             AND quality_status = 'released'
             AND (quantity_cases - allocated_cases - COALESCE(damaged_cases, 0) - COALESCE(in_transit_cases, 0)) >= ?`
        )
        .run(sel.allocated_cases, now, sel.internal_lot, sel.allocated_cases);

      if (updateResult.changes !== 1) {
        throw new ApiError(
          409,
          "CONCURRENT_RESERVATION_CONFLICT",
          `Concurrent stock reservation conflict on lot '${sel.internal_lot}': available quantity was modified by another transaction.`
        );
      }

      const id = `RES-ID-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;
      const resNumber = `RES-2026-${Math.floor(1000 + Math.random() * 8999)}`;
      const status: StockReservationRecord["status"] = isPartialOverall ? "Partially Reserved" : "Active";

      db.prepare(
        `INSERT INTO stock_reservations (
          id, reservation_number, order_id, order_number, order_line_id,
          customer_id, customer_name, sku, product_name, internal_lot, supplier_batch,
          warehouse, zone, bin_code, requested_cases, reserved_cases, reserved_weight_kg,
          uom, delivery_date, min_shelf_life_days_required, days_remaining_at_delivery,
          fefo_rank, selection_reason, status, expires_at, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'case', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        resNumber,
        input.order_id ?? input.order_number ?? null,
        input.order_number ?? null,
        input.order_line_id ?? null,
        input.customer_id ?? null,
        input.customer_name ?? null,
        allocation.sku,
        allocation.product_name,
        sel.internal_lot,
        sel.supplier_batch,
        sel.warehouse,
        sel.zone,
        sel.bin_code,
        requestedCases,
        sel.allocated_cases,
        sel.allocated_weight_kg,
        allocation.delivery_date,
        allocation.min_shelf_life_days_required,
        sel.days_remaining_at_delivery,
        sel.fefo_rank,
        sel.selection_reason,
        status,
        expiresAt,
        actor.email,
        now,
        now
      );

      db.prepare(
        `INSERT INTO stock_reservation_events (
          id, reservation_id, reservation_number, event_type, previous_status, new_status,
          quantity_cases, reason, actor_id, actor_name, created_at
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
      ).run(
        `SRE-${Date.now()}-${Math.floor(Math.random() * 999)}`,
        id,
        resNumber,
        isPartialOverall ? "partial_allocated" : "created",
        status,
        sel.allocated_cases,
        sel.selection_reason,
        actor.id,
        actor.name,
        now
      );

      createdIds.push(id);
    }

    recordAuditEvent({
      actor,
      action: "inventory.reservation_created",
      entityType: "StockReservation",
      entityId: createdIds.join(","),
      after: {
        sku: allocation.sku,
        order_number: input.order_number ?? null,
        requested_cases: requestedCases,
        reserved_cases: allocation.allocated_cases,
        lots: allocation.selected_allocations.map((s) => ({
          lot: s.internal_lot,
          cases: s.allocated_cases
        }))
      }
    });

    const createdReservations = createdIds.map((id) => {
      const row = db.prepare(`SELECT * FROM stock_reservations WHERE id = ?`).get(id) as Record<string, unknown>;
      return hydrateReservation(row, true);
    });

    return {
      reservations: createdReservations,
      allocation
    };
  });
}

export function releaseOrCancelReservation(
  actor: AuthenticatedUser,
  reservationIdOrNumber: string,
  input: {
    action: "release" | "cancel" | "convert_to_pick";
    reason?: string;
    assignee?: string;
  }
): StockReservationRecord {
  if (!hasPermission(actor, "inventory.reserve") && !hasPermission(actor, "inventory:adjust") && !hasPermission(actor, "orders:write") && !hasPermission(actor, "warehouse:update")) {
    throw new ApiError(403, "FORBIDDEN_INSUFFICIENT_ROLE", `Role '${actor.role}' is not authorized to modify stock reservations.`);
  }
  requireMutationAuthorization(actor, `${input.action} stock reservation`);

  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM stock_reservations WHERE id = ? OR upper(reservation_number) = upper(?)`)
    .get(reservationIdOrNumber, reservationIdOrNumber) as Record<string, unknown> | undefined;

  if (!row) {
    throw new ApiError(404, "RESERVATION_NOT_FOUND", `Reservation '${reservationIdOrNumber}' was not found.`);
  }

  const existing = hydrateReservation(row);
  requireWarehouseAccess(actor, existing.warehouse);

  if (existing.status !== "Active" && existing.status !== "Partially Reserved") {
    throw new ApiError(
      409,
      "INVALID_RESERVATION_STATE",
      `Reservation '${existing.reservation_number}' is already '${existing.status}' and cannot be modified.`
    );
  }

  const now = new Date().toISOString();

  return withTransaction(() => {
    if (input.action === "convert_to_pick") {
      // Re-verify lot quality and shelf life at pick conversion
      const lotRow = db
        .prepare(`SELECT * FROM inventory_lots WHERE upper(batch_id) = upper(?)`)
        .get(existing.internal_lot) as Record<string, unknown> | undefined;

      if (!lotRow || String(lotRow.quality_status) !== "released") {
        throw new ApiError(
          409,
          "LOT_NOT_ELIGIBLE_FOR_PICK",
          `Cannot convert reservation to picking: lot '${existing.internal_lot}' quality status is '${lotRow?.quality_status || "unknown"}'.`
        );
      }

      const taskId = `TSK-PICK-${Date.now().toString().slice(-5)}`;
      db.prepare(
        `INSERT INTO warehouse_tasks (
          id, task_type, priority, status, sku, product_name, batch_id,
          from_bin, to_bin, cases, assignee, order_number, updated_at
        ) VALUES (?, 'pick', 'high', 'queued', ?, ?, ?, ?, 'STAGE-D1', ?, ?, ?, ?)`
      ).run(
        taskId,
        existing.sku,
        existing.product_name,
        existing.internal_lot,
        existing.bin_code || String(lotRow.location || "CH-A01"),
        Math.ceil(existing.reserved_cases),
        input.assignee || "Marco Bellini",
        existing.order_number || null,
        now
      );

      if (existing.order_number) {
        db.prepare(
          `UPDATE sales_orders
           SET status = CASE WHEN status IN ('draft', 'confirmed') THEN 'picking' ELSE status END,
               fefo_allocated = 1,
               updated_at = ?
           WHERE order_number = ?`
        ).run(now, existing.order_number);
      }

      db.prepare(
        `UPDATE stock_reservations
         SET status = 'AllocatedToPick',
             pick_task_id = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(taskId, now, existing.id);

      db.prepare(
        `INSERT INTO stock_reservation_events (
          id, reservation_id, reservation_number, event_type, previous_status, new_status,
          quantity_cases, reason, actor_id, actor_name, created_at
        ) VALUES (?, ?, ?, 'converted_to_pick', ?, 'AllocatedToPick', ?, ?, ?, ?, ?)`
      ).run(
        `SRE-${Date.now()}-${Math.floor(Math.random() * 999)}`,
        existing.id,
        existing.reservation_number,
        existing.status,
        existing.reserved_cases,
        input.reason || `Converted to warehouse pick task ${taskId}`,
        actor.id,
        actor.name,
        now
      );

      recordAuditEvent({
        actor,
        action: "inventory.reservation_converted_to_pick",
        entityType: "StockReservation",
        entityId: existing.reservation_number,
        before: { status: existing.status },
        after: { status: "Converted to Pick", pick_task_id: taskId }
      });
    } else {
      const nextStatus: StockReservationRecord["status"] =
        input.action === "cancel" ? "Cancelled" : "Released";
      const reason = input.reason?.trim() || `Reservation ${nextStatus.toLowerCase()} by ${actor.name}`;

      db.prepare(
        `UPDATE stock_reservations
         SET status = ?,
             released_reason = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(nextStatus, reason, now, existing.id);

      // Return reserved cases back to available pool
      db.prepare(
        `UPDATE inventory_lots
         SET allocated_cases = MAX(0, allocated_cases - ?),
             updated_at = ?
         WHERE upper(batch_id) = upper(?)`
      ).run(existing.reserved_cases, now, existing.internal_lot);

      db.prepare(
        `INSERT INTO stock_reservation_events (
          id, reservation_id, reservation_number, event_type, previous_status, new_status,
          quantity_cases, reason, actor_id, actor_name, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        `SRE-${Date.now()}-${Math.floor(Math.random() * 999)}`,
        existing.id,
        existing.reservation_number,
        input.action === "cancel" ? "cancelled" : "released",
        existing.status,
        nextStatus,
        existing.reserved_cases,
        reason,
        actor.id,
        actor.name,
        now
      );

      recordAuditEvent({
        actor,
        action: `inventory.reservation_${nextStatus.toLowerCase()}`,
        entityType: "StockReservation",
        entityId: existing.reservation_number,
        before: { status: existing.status, reserved_cases: existing.reserved_cases },
        after: { status: nextStatus, reason }
      });
    }

    const updated = db.prepare(`SELECT * FROM stock_reservations WHERE id = ?`).get(existing.id) as Record<string, unknown>;
    return hydrateReservation(updated, true);
  });
}

// ----------------------------------------------------------------------------
// 6. Cycle Counting (Blind Counting, Scan Verification, Recount & Approval)
// ----------------------------------------------------------------------------

function hydrateCycleCount(row: Record<string, unknown>, actor?: AuthenticatedUser): CycleCountRecord {
  const db = getDb();
  const id = String(row.id);
  const status = (row.status as CycleCountRecord["status"]) || "Assigned";
  const isBlind = Boolean(row.is_blind);
  const isManager =
    !actor ||
    actor.role === "super_admin" ||
    actor.role === "administrator" ||
    actor.role === "warehouse_manager" ||
    actor.role === "finance" ||
    actor.role === "qa" ||
    actor.role === "qa_manager";

  // Blind counting rule: if is_blind is true and the count has not yet been submitted, hide expected quantities from non-managers (or in blind entry mode)
  const blindMasked = isBlind && (status === "Assigned" || status === "In Progress" || status === "Recount Requested") && !isManager;

  const historyRows = db
    .prepare(`SELECT * FROM cycle_count_history WHERE cycle_count_id = ? ORDER BY created_at DESC, id DESC`)
    .all(id) as Record<string, unknown>[];

  return {
    id,
    count_number: String(row.count_number),
    count_type: (row.count_type as CycleCountRecord["count_type"]) || "scheduled",
    warehouse: String(row.warehouse),
    zone: row.zone ? String(row.zone) : null,
    bin_code: String(row.bin_code),
    sku: String(row.sku),
    product_name: String(row.product_name),
    internal_lot: String(row.internal_lot),
    supplier_batch: row.supplier_batch ? String(row.supplier_batch) : null,
    is_blind: isBlind,
    blind_masked: blindMasked,
    expected_cases: blindMasked ? null : Number(row.expected_cases ?? 0),
    expected_weight_kg: blindMasked ? null : Number(row.expected_weight_kg ?? 0),
    counted_cases:
      row.counted_cases !== null && row.counted_cases !== undefined ? Number(row.counted_cases) : null,
    counted_weight_kg:
      row.counted_weight_kg !== null && row.counted_weight_kg !== undefined ? Number(row.counted_weight_kg) : null,
    variance_cases:
      row.variance_cases !== null && row.variance_cases !== undefined ? Number(row.variance_cases) : null,
    variance_weight_kg:
      row.variance_weight_kg !== null && row.variance_weight_kg !== undefined ? Number(row.variance_weight_kg) : null,
    unit_weight_kg: Number(row.unit_weight_kg || 5.0),
    barcode_scanned: row.barcode_scanned ? String(row.barcode_scanned) : null,
    scan_verified: Boolean(row.scan_verified),
    barcode_verified: Boolean(row.scan_verified),
    status,
    recount_number: Number(row.recount_number || 0),
    recount_iteration: Number(row.recount_number || 0),
    assigned_to_id: row.assigned_to_id ? String(row.assigned_to_id) : null,
    assigned_to_name: String(row.assigned_to_name || "Marco Bellini"),
    scheduled_date: String(row.scheduled_date),
    counted_by_id: row.counted_by_id ? String(row.counted_by_id) : null,
    counted_by_name: row.counted_by_name ? String(row.counted_by_name) : null,
    counted_at: row.counted_at ? String(row.counted_at) : null,
    approved_by_id: row.approved_by_id ? String(row.approved_by_id) : null,
    approved_by_name: row.approved_by_name ? String(row.approved_by_name) : null,
    approved_at: row.approved_at ? String(row.approved_at) : null,
    approval_notes: row.approval_notes ? String(row.approval_notes) : null,
    adjustment_id: row.adjustment_id ? String(row.adjustment_id) : null,
    discrepancy_reason: row.discrepancy_reason ? String(row.discrepancy_reason) : null,
    notes: row.notes ? String(row.notes) : null,
    created_by: String(row.created_by),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    history: historyRows.map((h) => ({
      id: String(h.id),
      action: String(h.action),
      recount_number: Number(h.recount_number || 0),
      recount_iteration: Number(h.recount_number || 0),
      expected_cases:
        blindMasked
          ? null
          : h.expected_cases !== null && h.expected_cases !== undefined
            ? Number(h.expected_cases)
            : null,
      counted_cases:
        h.counted_cases !== null && h.counted_cases !== undefined ? Number(h.counted_cases) : null,
      variance_cases:
        h.variance_cases !== null && h.variance_cases !== undefined ? Number(h.variance_cases) : null,
      counted_weight_kg:
        h.counted_weight_kg !== null && h.counted_weight_kg !== undefined ? Number(h.counted_weight_kg) : null,
      notes: h.notes ? String(h.notes) : null,
      actor_name: String(h.actor_name || ""),
      created_at: String(h.created_at || "")
    }))
  };
}

export function listCycleCounts(
  actor: AuthenticatedUser,
  filters: {
    warehouse?: string | null;
    status?: string | null;
    lot?: string | null;
    sku?: string | null;
  } = {}
): CycleCountRecord[] {
  assertPermission(actor, "inventory:read");
  const db = getDb();
  const wf = buildWarehouseScopeClause(actor, filters.warehouse, "warehouse");
  const conditions: string[] = [];
  const params: string[] = [];

  if (wf.clause) {
    conditions.push(wf.clause);
    params.push(...wf.params);
  }
  if (filters.status && filters.status !== "ALL") {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters.lot) {
    conditions.push("upper(internal_lot) = upper(?)");
    params.push(filters.lot);
  }
  if (filters.sku && filters.sku !== "ALL") {
    conditions.push("upper(sku) = upper(?)");
    params.push(filters.sku);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM cycle_counts ${whereSql} ORDER BY created_at DESC, id DESC`)
    .all(...params) as Record<string, unknown>[];

  return rows.map((r) => hydrateCycleCount(r, actor));
}

export function createCycleCount(
  actor: AuthenticatedUser,
  input: {
    count_type?: "scheduled" | "ad_hoc";
    internal_lot: string;
    warehouse?: string;
    zone?: string;
    bin_code?: string;
    is_blind?: boolean;
    assigned_to_id?: string | null;
    assigned_to_name?: string;
    scheduled_date?: string;
    notes?: string | null;
  }
): CycleCountRecord {
  if (!hasPermission(actor, "inventory.count") && !hasPermission(actor, "inventory:adjust")) {
    throw new ApiError(403, "FORBIDDEN_INSUFFICIENT_ROLE", `Role '${actor.role}' is not authorized to create cycle counts.`);
  }
  requireMutationAuthorization(actor, "create cycle count session");

  const internalLot = (input.internal_lot || "").trim();
  if (!internalLot) {
    throw new ApiError(400, "VALIDATION_ERROR", "internal_lot is required to schedule or start a cycle count.");
  }

  const db = getDb();
  const lotRow = db
    .prepare(`SELECT * FROM inventory_lots WHERE upper(batch_id) = upper(?) OR id = ?`)
    .get(internalLot, internalLot) as Record<string, unknown> | undefined;

  if (!lotRow) {
    throw new ApiError(404, "LOT_NOT_FOUND", `Inventory lot '${internalLot}' was not found.`);
  }

  const warehouse = String(input.warehouse || lotRow.warehouse || "Milan Cold Hub");
  requireWarehouseAccess(actor, warehouse);

  const expectedCases = Number(lotRow.quantity_cases || 0);
  const unitWeightKg = Number(lotRow.unit_weight_kg || 5.0);
  const expectedWeightKg =
    lotRow.catch_weight_kg !== null && lotRow.catch_weight_kg !== undefined && Number(lotRow.catch_weight_kg) > 0
      ? Number(lotRow.catch_weight_kg)
      : roundDec(expectedCases * unitWeightKg, 2);

  const id = `CC-ID-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;
  const countNumber = `CC-2026-${Math.floor(1000 + Math.random() * 8999)}`;
  const now = new Date().toISOString();
  const scheduledDate = input.scheduled_date?.trim() || now.slice(0, 10);
  const assignedToName = input.assigned_to_name?.trim() || actor.name || "Pietro Rossi";

  withTransaction(() => {
    db.prepare(
      `INSERT INTO cycle_counts (
        id, count_number, count_type, warehouse, zone, bin_code,
        sku, product_name, internal_lot, supplier_batch,
        is_blind, expected_cases, expected_weight_kg, unit_weight_kg,
        status, recount_number, assigned_to_id, assigned_to_name, scheduled_date,
        notes, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Assigned', 0, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      countNumber,
      input.count_type || "scheduled",
      warehouse,
      input.zone || String(lotRow.zone || "Chilled A"),
      input.bin_code || String(lotRow.location || "CH-A01"),
      String(lotRow.sku),
      String(lotRow.product_name),
      String(lotRow.batch_id),
      String(lotRow.supplier_lot || lotRow.batch_id),
      input.is_blind === false ? 0 : 1,
      expectedCases,
      expectedWeightKg,
      unitWeightKg,
      input.assigned_to_id ?? null,
      assignedToName,
      scheduledDate,
      input.notes ?? null,
      actor.email,
      now,
      now
    );

    db.prepare(
      `INSERT INTO cycle_count_history (
        id, cycle_count_id, count_number, action, recount_number,
        expected_cases, counted_cases, variance_cases, counted_weight_kg,
        notes, actor_id, actor_name, created_at
      ) VALUES (?, ?, ?, 'created', 0, ?, NULL, NULL, NULL, ?, ?, ?, ?)`
    ).run(
      `CCH-${Date.now()}-${Math.floor(Math.random() * 999)}`,
      id,
      countNumber,
      expectedCases,
      input.notes || `Cycle count (${input.is_blind === false ? "guided" : "blind"}) assigned to ${assignedToName}`,
      actor.id,
      actor.name,
      now
    );

    recordAuditEvent({
      actor,
      action: "inventory.cycle_count_created",
      entityType: "CycleCount",
      entityId: countNumber,
      after: {
        count_number: countNumber,
        internal_lot: lotRow.batch_id,
        bin_code: input.bin_code || lotRow.location,
        is_blind: input.is_blind !== false,
        assigned_to_name: assignedToName
      }
    });
  });

  const created = db.prepare(`SELECT * FROM cycle_counts WHERE id = ?`).get(id) as Record<string, unknown>;
  return hydrateCycleCount(created, actor);
}

/**
 * Submit a physical cycle count (with optional barcode verification and weight verification).
 * CRITICAL RULE: Submitting a count NEVER automatically modifies stock!
 */
export function submitCycleCount(
  actor: AuthenticatedUser,
  countIdOrNumber: string,
  input: {
    counted_cases: number;
    counted_weight_kg?: number | null;
    barcode_scanned?: string | null;
    discrepancy_reason?: string | null;
    notes?: string | null;
  }
): CycleCountRecord {
  if (!hasPermission(actor, "inventory.count") && !hasPermission(actor, "inventory:adjust")) {
    throw new ApiError(403, "FORBIDDEN_INSUFFICIENT_ROLE", `Role '${actor.role}' is not authorized to submit cycle counts.`);
  }
  requireMutationAuthorization(actor, "submit cycle count");

  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM cycle_counts WHERE id = ? OR upper(count_number) = upper(?)`)
    .get(countIdOrNumber, countIdOrNumber) as Record<string, unknown> | undefined;

  if (!row) {
    throw new ApiError(404, "CYCLE_COUNT_NOT_FOUND", `Cycle count '${countIdOrNumber}' was not found.`);
  }

  requireWarehouseAccess(actor, String(row.warehouse));

  const currentStatus = String(row.status);
  if (currentStatus === "Approved") {
    throw new ApiError(409, "COUNT_ALREADY_APPROVED", `Cycle count '${row.count_number}' is already approved and locked.`);
  }

  const countedCases = roundDec(Number(input.counted_cases), 3);
  if (!Number.isFinite(countedCases) || countedCases < 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "counted_cases must be a non-negative number.");
  }

  const expectedCases = Number(row.expected_cases || 0);
  const expectedWeightKg = Number(row.expected_weight_kg || 0);
  const unitWeightKg = Number(row.unit_weight_kg || 5.0);
  const countedWeightKg =
    input.counted_weight_kg !== undefined && input.counted_weight_kg !== null
      ? roundDec(Number(input.counted_weight_kg), 2)
      : roundDec(countedCases * unitWeightKg, 2);

  const varianceCases = roundDec(countedCases - expectedCases, 3);
  const varianceWeightKg = roundDec(countedWeightKg - expectedWeightKg, 2);

  // Verify barcode if scanned
  let scanVerified = Number(row.scan_verified || 0);
  const scannedBarcode = input.barcode_scanned?.trim() || (row.barcode_scanned ? String(row.barcode_scanned) : null);
  if (scannedBarcode) {
    const clean = scannedBarcode.toUpperCase().replace(/^BIN:/i, "");
    const lotCode = String(row.internal_lot).toUpperCase();
    const binCode = String(row.bin_code).toUpperCase();
    const skuCode = String(row.sku).toUpperCase();
    if (clean === lotCode || clean === binCode || clean === skuCode || clean.includes(lotCode)) {
      scanVerified = 1;
    } else {
      throw new ApiError(
        400,
        "BARCODE_MISMATCH",
        `Scanned barcode '${scannedBarcode}' does not match expected bin '${binCode}', SKU '${skuCode}', or lot '${lotCode}'.`
      );
    }
  }

  const hasDiscrepancy = Math.abs(varianceCases) > 0.001 || Math.abs(varianceWeightKg) > 0.25;
  const nextStatus: CycleCountRecord["status"] = hasDiscrepancy ? "In Review" : "Submitted";
  const now = new Date().toISOString();

  withTransaction(() => {
    // IMPORTANT: Do NOT modify inventory_lots or bin_stock_placements on submission!
    db.prepare(
      `UPDATE cycle_counts
       SET counted_cases = ?,
           counted_weight_kg = ?,
           variance_cases = ?,
           variance_weight_kg = ?,
           barcode_scanned = ?,
           scan_verified = ?,
           status = ?,
           counted_by_id = ?,
           counted_by_name = ?,
           counted_at = ?,
           discrepancy_reason = COALESCE(?, discrepancy_reason),
           notes = COALESCE(?, notes),
           updated_at = ?
       WHERE id = ?`
    ).run(
      countedCases,
      countedWeightKg,
      varianceCases,
      varianceWeightKg,
      scannedBarcode,
      scanVerified,
      nextStatus,
      actor.id,
      actor.name,
      now,
      input.discrepancy_reason ?? null,
      input.notes ?? null,
      now,
      String(row.id)
    );

    db.prepare(
      `INSERT INTO cycle_count_history (
        id, cycle_count_id, count_number, action, recount_number,
        expected_cases, counted_cases, variance_cases, counted_weight_kg,
        notes, actor_id, actor_name, created_at
      ) VALUES (?, ?, ?, 'submitted', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `CCH-${Date.now()}-${Math.floor(Math.random() * 999)}`,
      String(row.id),
      String(row.count_number),
      Number(row.recount_number || 0),
      expectedCases,
      countedCases,
      varianceCases,
      countedWeightKg,
      input.discrepancy_reason || input.notes || `Submitted count: ${countedCases} cases (${countedWeightKg} kg), variance: ${varianceCases} cases. Stock unchanged pending manager approval.`,
      actor.id,
      actor.name,
      now
    );

    recordAuditEvent({
      actor,
      action: "inventory.cycle_count_submitted",
      entityType: "CycleCount",
      entityId: String(row.count_number),
      after: {
        internal_lot: row.internal_lot,
        expected_cases: expectedCases,
        counted_cases: countedCases,
        variance_cases: varianceCases,
        status: nextStatus,
        stock_modified: false
      }
    });
  });

  const updated = db.prepare(`SELECT * FROM cycle_counts WHERE id = ?`).get(String(row.id)) as Record<string, unknown>;
  return hydrateCycleCount(updated, actor);
}

export function reviewOrApproveCycleCount(
  actor: AuthenticatedUser,
  countIdOrNumber: string,
  input: {
    action: "approve" | "request_recount" | "reject";
    notes?: string | null;
    assigned_to_name?: string | null;
  }
): {
  cycle_count: CycleCountRecord;
  count: CycleCountRecord;
  adjustment: StockAdjustmentRecord | null;
} {
  if (!hasPermission(actor, "inventory.approve_adjustment") && actor.role !== "warehouse_manager" && actor.role !== "super_admin" && actor.role !== "administrator") {
    throw new ApiError(
      403,
      "FORBIDDEN_APPROVAL_ROLE",
      `Role '${actor.role}' is not authorized to approve or request recounts on cycle counts. Warehouse Manager or Approver permission required.`
    );
  }
  requireMutationAuthorization(actor, `${input.action} cycle count`);

  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM cycle_counts WHERE id = ? OR upper(count_number) = upper(?)`)
    .get(countIdOrNumber, countIdOrNumber) as Record<string, unknown> | undefined;

  if (!row) {
    throw new ApiError(404, "CYCLE_COUNT_NOT_FOUND", `Cycle count '${countIdOrNumber}' was not found.`);
  }

  requireWarehouseAccess(actor, String(row.warehouse));

  if (String(row.status) === "Approved") {
    throw new ApiError(409, "COUNT_ALREADY_APPROVED", `Cycle count '${row.count_number}' has already been approved.`);
  }

  const now = new Date().toISOString();

  if (input.action === "request_recount") {
    const nextRecount = Number(row.recount_number || 0) + 1;
    withTransaction(() => {
      db.prepare(
        `UPDATE cycle_counts
         SET status = 'Recount Requested',
             recount_number = ?,
             counted_cases = NULL,
             counted_weight_kg = NULL,
             variance_cases = NULL,
             variance_weight_kg = NULL,
             assigned_to_name = COALESCE(?, assigned_to_name),
             approval_notes = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(nextRecount, input.assigned_to_name ?? null, input.notes ?? "Discrepancy recount requested by manager", now, String(row.id));

      db.prepare(
        `INSERT INTO cycle_count_history (
          id, cycle_count_id, count_number, action, recount_number,
          expected_cases, counted_cases, variance_cases, counted_weight_kg,
          notes, actor_id, actor_name, created_at
        ) VALUES (?, ?, ?, 'recount_requested', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        `CCH-${Date.now()}-${Math.floor(Math.random() * 999)}`,
        String(row.id),
        String(row.count_number),
        nextRecount,
        Number(row.expected_cases || 0),
        row.counted_cases !== null ? Number(row.counted_cases) : null,
        row.variance_cases !== null ? Number(row.variance_cases) : null,
        row.counted_weight_kg !== null ? Number(row.counted_weight_kg) : null,
        input.notes || `Recount #${nextRecount} ordered by ${actor.name}`,
        actor.id,
        actor.name,
        now
      );

      recordAuditEvent({
        actor,
        action: "inventory.cycle_count_recount_requested",
        entityType: "CycleCount",
        entityId: String(row.count_number),
        after: { recount_number: nextRecount, notes: input.notes ?? null }
      });
    });

    const updated = db.prepare(`SELECT * FROM cycle_counts WHERE id = ?`).get(String(row.id)) as Record<string, unknown>;
    const hydrated = hydrateCycleCount(updated, actor);
    return { cycle_count: hydrated, count: hydrated, adjustment: null };
  }

  if (input.action === "reject") {
    withTransaction(() => {
      db.prepare(
        `UPDATE cycle_counts
         SET status = 'Rejected',
             approved_by_id = ?,
             approved_by_name = ?,
             approved_at = ?,
             approval_notes = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(actor.id, actor.name, now, input.notes || "Count rejected without stock adjustment", now, String(row.id));

      db.prepare(
        `INSERT INTO cycle_count_history (
          id, cycle_count_id, count_number, action, recount_number,
          expected_cases, counted_cases, variance_cases, counted_weight_kg,
          notes, actor_id, actor_name, created_at
        ) VALUES (?, ?, ?, 'rejected', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        `CCH-${Date.now()}-${Math.floor(Math.random() * 999)}`,
        String(row.id),
        String(row.count_number),
        Number(row.recount_number || 0),
        Number(row.expected_cases || 0),
        row.counted_cases !== null ? Number(row.counted_cases) : null,
        row.variance_cases !== null ? Number(row.variance_cases) : null,
        row.counted_weight_kg !== null ? Number(row.counted_weight_kg) : null,
        input.notes || "Rejected by manager",
        actor.id,
        actor.name,
        now
      );
    });

    const updated = db.prepare(`SELECT * FROM cycle_counts WHERE id = ?`).get(String(row.id)) as Record<string, unknown>;
    const hydrated = hydrateCycleCount(updated, actor);
    return { cycle_count: hydrated, count: hydrated, adjustment: null };
  }

  // Action === 'approve'
  if (row.counted_cases === null || row.counted_cases === undefined) {
    throw new ApiError(400, "COUNT_NOT_SUBMITTED", "Cannot approve a cycle count before counted quantities have been submitted.");
  }

  const countedCases = Number(row.counted_cases);
  const countedWeightKg = Number(row.counted_weight_kg ?? countedCases * Number(row.unit_weight_kg || 5));
  const varianceCases = Number(row.variance_cases ?? 0);
  const varianceWeightKg = Number(row.variance_weight_kg ?? 0);

  let createdAdjustment: StockAdjustmentRecord | null = null;

  if (Math.abs(varianceCases) > 0.001 || Math.abs(varianceWeightKg) > 0.1) {
    // Create and immediately execute a reconciled stock adjustment linked to this cycle count
    createdAdjustment = createStockAdjustment(actor, {
      internal_lot: String(row.internal_lot),
      adjustment_type: "cycle_count_reconciliation",
      actual_cases: countedCases,
      actual_weight_kg: countedWeightKg,
      reason:
        input.notes?.trim() ||
        String(row.discrepancy_reason || "") ||
        `Approved cycle count ${row.count_number} reconciliation (variance ${varianceCases > 0 ? "+" : ""}${varianceCases} cases)`,
      cycle_count_id: String(row.id),
      auto_approve: true,
      idempotency_key: `cc-approve-${row.id}-${row.recount_number || 0}`
    });
  }

  withTransaction(() => {
    db.prepare(
      `UPDATE cycle_counts
       SET status = 'Approved',
           approved_by_id = ?,
           approved_by_name = ?,
           approved_at = ?,
           approval_notes = ?,
           adjustment_id = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(
      actor.id,
      actor.name,
      now,
      input.notes || "Approved by manager",
      createdAdjustment?.id ?? null,
      now,
      String(row.id)
    );

    db.prepare(
      `INSERT INTO cycle_count_history (
        id, cycle_count_id, count_number, action, recount_number,
        expected_cases, counted_cases, variance_cases, counted_weight_kg,
        notes, actor_id, actor_name, created_at
      ) VALUES (?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `CCH-${Date.now()}-${Math.floor(Math.random() * 999)}`,
      String(row.id),
      String(row.count_number),
      Number(row.recount_number || 0),
      Number(row.expected_cases || 0),
      countedCases,
      varianceCases,
      countedWeightKg,
      input.notes || (createdAdjustment ? `Approved and reconciled via ${createdAdjustment.adjustment_number}` : "Approved (zero variance)"),
      actor.id,
      actor.name,
      now
    );

    recordAuditEvent({
      actor,
      action: "inventory.cycle_count_approved",
      entityType: "CycleCount",
      entityId: String(row.count_number),
      after: {
        counted_cases: countedCases,
        variance_cases: varianceCases,
        adjustment_number: createdAdjustment?.adjustment_number ?? null
      }
    });
  });

  const updated = db.prepare(`SELECT * FROM cycle_counts WHERE id = ?`).get(String(row.id)) as Record<string, unknown>;
  const hydrated = hydrateCycleCount(updated, actor);
  return {
    cycle_count: hydrated,
    count: hydrated,
    adjustment: createdAdjustment
  };
}

// ----------------------------------------------------------------------------
// 7. Reconciled Stock Adjustments & Immutable Stock Movements
// ----------------------------------------------------------------------------

function hydrateAdjustment(row: Record<string, unknown>): StockAdjustmentRecord {
  return {
    id: String(row.id),
    adjustment_number: String(row.adjustment_number),
    warehouse: String(row.warehouse),
    zone: row.zone ? String(row.zone) : null,
    bin_code: row.bin_code ? String(row.bin_code) : null,
    target_bin_code: row.target_bin_code ? String(row.target_bin_code) : null,
    sku: String(row.sku),
    product_name: String(row.product_name),
    internal_lot: String(row.internal_lot),
    supplier_batch: row.supplier_batch ? String(row.supplier_batch) : null,
    adjustment_type: row.adjustment_type as StockAdjustmentRecord["adjustment_type"],
    target_status: (row.target_status as StockStatusType) || "Available",
    original_cases: Number(row.original_cases || 0),
    actual_cases: Number(row.actual_cases || 0),
    difference_cases: Number(row.difference_cases || 0),
    original_weight_kg: Number(row.original_weight_kg || 0),
    actual_weight_kg: Number(row.actual_weight_kg || 0),
    difference_weight_kg: Number(row.difference_weight_kg || 0),
    unit_cost_cents: Number(row.unit_cost_cents || 0),
    value_impact_cents: Number(row.value_impact_cents || 0),
    requires_approval: Boolean(row.requires_approval),
    status: (row.status as StockAdjustmentRecord["status"]) || "Pending Approval",
    reason: String(row.reason),
    evidence: parseJsonArray(row.evidence_json),
    cycle_count_id: row.cycle_count_id ? String(row.cycle_count_id) : null,
    movement_id: row.movement_id ? String(row.movement_id) : null,
    idempotency_key: row.idempotency_key ? String(row.idempotency_key) : null,
    requested_by_id: String(row.requested_by_id),
    requested_by_name: String(row.requested_by_name),
    requested_at: String(row.requested_at),
    approved_by_id: row.approved_by_id ? String(row.approved_by_id) : null,
    approved_by_name: row.approved_by_name ? String(row.approved_by_name) : null,
    approved_at: row.approved_at ? String(row.approved_at) : null,
    approval_notes: row.approval_notes ? String(row.approval_notes) : null,
    updated_at: String(row.updated_at)
  };
}

function hydrateMovement(row: Record<string, unknown>): StockMovementRecord {
  return {
    id: String(row.id),
    batch_id: String(row.batch_id),
    sku: String(row.sku),
    product_name: String(row.product_name || row.sku),
    warehouse: String(row.warehouse || "Milan Cold Hub"),
    zone: row.zone ? String(row.zone) : null,
    source_location: row.source_location ? String(row.source_location) : null,
    destination_location: row.destination_location ? String(row.destination_location) : null,
    movement_type: String(row.movement_type),
    quantity_delta: Number(row.quantity_delta || 0),
    previous_cases: Number(row.previous_cases || 0),
    new_cases: Number(row.new_cases || 0),
    weight_delta_kg:
      row.weight_delta_kg !== null && row.weight_delta_kg !== undefined ? Number(row.weight_delta_kg) : null,
    reference_type: row.reference_type ? String(row.reference_type) : null,
    reference_id: row.reference_id ? String(row.reference_id) : null,
    reason: String(row.reason || ""),
    actor_email: String(row.actor_email || ""),
    created_at: String(row.created_at || "")
  };
}

export function listStockAdjustments(
  actor: AuthenticatedUser,
  filters: {
    warehouse?: string | null;
    status?: string | null;
    lot?: string | null;
    sku?: string | null;
  } = {}
): StockAdjustmentRecord[] {
  assertPermission(actor, "inventory:read");
  const db = getDb();
  const wf = buildWarehouseScopeClause(actor, filters.warehouse, "warehouse");
  const conditions: string[] = [];
  const params: string[] = [];

  if (wf.clause) {
    conditions.push(wf.clause);
    params.push(...wf.params);
  }
  if (filters.status && filters.status !== "ALL") {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters.lot) {
    conditions.push("upper(internal_lot) = upper(?)");
    params.push(filters.lot);
  }
  if (filters.sku && filters.sku !== "ALL") {
    conditions.push("upper(sku) = upper(?)");
    params.push(filters.sku);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM stock_adjustments ${whereSql} ORDER BY requested_at DESC, id DESC`)
    .all(...params) as Record<string, unknown>[];

  return rows.map(hydrateAdjustment);
}

function applyApprovedAdjustmentToLedger(
  db: ReturnType<typeof getDb>,
  adjRow: Record<string, unknown>,
  approver: AuthenticatedUser
): string {
  const adjId = String(adjRow.id);
  const adjNumber = String(adjRow.adjustment_number);
  const internalLot = String(adjRow.internal_lot);
  const adjType = String(adjRow.adjustment_type);
  const actualCases = Math.max(0, Math.round(Number(adjRow.actual_cases || 0)));
  const actualWeightKg = roundDec(Number(adjRow.actual_weight_kg || 0), 2);
  const diffCases = Math.round(Number(adjRow.difference_cases || 0));
  const diffWeightKg = roundDec(Number(adjRow.difference_weight_kg || 0), 2);
  const targetBinCode = adjRow.target_bin_code ? String(adjRow.target_bin_code).trim() : null;
  const idempKey = adjRow.idempotency_key ? String(adjRow.idempotency_key) : `adj-mov-${adjId}`;

  // Duplicate stock movement prevention check
  const existingMov = db
    .prepare(`SELECT id FROM stock_movements WHERE idempotency_key = ?`)
    .get(idempKey) as { id: string } | undefined;
  if (existingMov) {
    throw new ApiError(
      409,
      "DUPLICATE_STOCK_MOVEMENT",
      `Duplicate stock movement prevented: adjustment '${adjNumber}' (key '${idempKey}') has already been posted to the stock ledger.`
    );
  }

  const lotRow = db
    .prepare(`SELECT * FROM inventory_lots WHERE upper(batch_id) = upper(?)`)
    .get(internalLot) as Record<string, unknown> | undefined;

  if (!lotRow) {
    throw new ApiError(404, "LOT_NOT_FOUND", `Inventory lot '${internalLot}' not found while applying adjustment.`);
  }

  const prevCases = Number(lotRow.quantity_cases || 0);
  const now = new Date().toISOString();

  if (adjType === "damaged") {
    const damagedDelta = Math.max(0, prevCases - actualCases);
    db.prepare(
      `UPDATE inventory_lots
       SET quantity_cases = ?,
           allocated_cases = MIN(allocated_cases, ?),
           damaged_cases = COALESCE(damaged_cases, 0) + ?,
           catch_weight_kg = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(actualCases, actualCases, damagedDelta, actualWeightKg, now, String(lotRow.id));
  } else if (adjType === "expired") {
    const expiredDelta = Math.max(0, prevCases - actualCases);
    db.prepare(
      `UPDATE inventory_lots
       SET quantity_cases = ?,
           allocated_cases = MIN(allocated_cases, ?),
           expired_cases = COALESCE(expired_cases, 0) + ?,
           catch_weight_kg = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(actualCases, actualCases, expiredDelta, actualWeightKg, now, String(lotRow.id));
  } else if (adjType === "mislocated_transfer" && targetBinCode) {
    db.prepare(
      `UPDATE inventory_lots
       SET location = ?,
           quantity_cases = ?,
           catch_weight_kg = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(targetBinCode, actualCases, actualWeightKg, now, String(lotRow.id));
  } else {
    db.prepare(
      `UPDATE inventory_lots
       SET quantity_cases = ?,
           allocated_cases = MIN(allocated_cases, ?),
           catch_weight_kg = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(actualCases, actualCases, actualWeightKg, now, String(lotRow.id));
  }

  // Keep bin_stock_placements synchronized if a bin placement exists for this lot
  const binCode = String(adjRow.bin_code || lotRow.location || "");
  if (binCode) {
    db.prepare(
      `UPDATE bin_stock_placements
       SET quantity_cases = ?,
           weight_kg = ?,
           bin_code = COALESCE(?, bin_code),
           updated_at = ?
       WHERE upper(internal_lot) = upper(?) AND upper(bin_code) = upper(?)`
    ).run(actualCases, actualWeightKg, targetBinCode, now, internalLot, binCode);
  }

  const movementId = `MOV-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;
  db.prepare(
    `INSERT INTO stock_movements (
      id, batch_id, sku, warehouse, zone, source_location, destination_location,
      movement_type, quantity_delta, previous_cases, new_cases, weight_delta_kg,
      reference_type, reference_id, reason, actor_email, idempotency_key, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'adjustment', ?, ?, ?, ?, ?)`
  ).run(
    movementId,
    internalLot,
    String(lotRow.sku),
    String(lotRow.warehouse),
    String(lotRow.zone),
    binCode,
    targetBinCode || binCode,
    `adjustment_${adjType}`,
    diffCases,
    prevCases,
    actualCases,
    diffWeightKg,
    adjNumber,
    `${adjNumber} (${adjType}): ${adjRow.reason}`,
    approver.email,
    idempKey,
    now
  );

  return movementId;
}

export function createStockAdjustment(
  actor: AuthenticatedUser,
  input: {
    internal_lot: string;
    adjustment_type: StockAdjustmentRecord["adjustment_type"];
    actual_cases?: number;
    difference_cases?: number;
    actual_weight_kg?: number | null;
    target_bin_code?: string | null;
    reason?: string;
    reason_code?: string;
    reason_notes?: string;
    evidence?: string[];
    evidence_ref?: string;
    cycle_count_id?: string | null;
    auto_approve?: boolean;
    idempotency_key?: string | null;
  }
): StockAdjustmentRecord {
  assertPermission(actor, "inventory:adjust");
  requireMutationAuthorization(actor, "request stock adjustment");

  const internalLot = (input.internal_lot || "").trim();
  if (!internalLot) {
    throw new ApiError(400, "VALIDATION_ERROR", "internal_lot is required.");
  }

  const db = getDb();
  const lotRow = db
    .prepare(`SELECT * FROM inventory_lots WHERE upper(batch_id) = upper(?) OR id = ?`)
    .get(internalLot, internalLot) as Record<string, unknown> | undefined;

  if (!lotRow) {
    throw new ApiError(404, "LOT_NOT_FOUND", `Inventory lot '${internalLot}' was not found.`);
  }

  const warehouse = String(lotRow.warehouse || "Milan Cold Hub");
  requireWarehouseAccess(actor, warehouse);

  const reason = (
    input.reason ||
    input.reason_notes ||
    input.reason_code ||
    ""
  ).trim();
  if (!reason || reason.length < 3) {
    throw new ApiError(400, "REASON_REQUIRED", "A clear adjustment reason is mandatory for all inventory adjustments.");
  }

  if (input.idempotency_key) {
    const dup = db
      .prepare(`SELECT * FROM stock_adjustments WHERE idempotency_key = ?`)
      .get(input.idempotency_key) as Record<string, unknown> | undefined;
    if (dup) {
      throw new ApiError(
        409,
        "DUPLICATE_ADJUSTMENT",
        `Duplicate adjustment prevented: idempotency_key '${input.idempotency_key}' has already been processed as '${dup.adjustment_number}'.`
      );
    }
  }

  const originalCases = Number(lotRow.quantity_cases || 0);
  const unitWeightKg = Number(lotRow.unit_weight_kg || 5.0);
  const originalWeightKg =
    lotRow.catch_weight_kg !== null && lotRow.catch_weight_kg !== undefined && Number(lotRow.catch_weight_kg) > 0
      ? Number(lotRow.catch_weight_kg)
      : roundDec(originalCases * unitWeightKg, 2);

  let actualCases: number;
  if (input.actual_cases !== undefined && input.actual_cases !== null) {
    actualCases = Math.round(Number(input.actual_cases));
  } else if (input.difference_cases !== undefined && input.difference_cases !== null) {
    actualCases = Math.round(originalCases + Number(input.difference_cases));
  } else {
    throw new ApiError(400, "VALIDATION_ERROR", "Either actual_cases or difference_cases must be provided.");
  }

  if (actualCases < 0) {
    throw new ApiError(400, "NEGATIVE_STOCK_FORBIDDEN", "Adjusted actual_cases cannot be negative.");
  }

  const differenceCases = actualCases - originalCases;
  const actualWeightKg =
    input.actual_weight_kg !== undefined && input.actual_weight_kg !== null
      ? roundDec(Number(input.actual_weight_kg), 2)
      : roundDec(actualCases * unitWeightKg, 2);
  const differenceWeightKg = roundDec(actualWeightKg - originalWeightKg, 2);

  const meta = getProductMetaMap().get(String(lotRow.sku || "").toUpperCase());
  const unitCostCents =
    lotRow.unit_cost_cents !== null && lotRow.unit_cost_cents !== undefined && Number(lotRow.unit_cost_cents) > 0
      ? Number(lotRow.unit_cost_cents)
      : meta?.unitCostCents ?? 3500;
  const valueImpactCents = Math.round(differenceCases * unitCostCents);

  // Significant adjustments (>= 5 cases or >= €500 value impact or requested by non-approver) require approval
  const isSignificant = Math.abs(differenceCases) >= 5 || Math.abs(valueImpactCents) >= 50000;
  const canApprove = hasPermission(actor, "inventory.approve_adjustment");
  const requiresApproval = isSignificant || !canApprove || input.auto_approve === false;
  const executeImmediately = !requiresApproval || (input.auto_approve === true && canApprove);

  const targetStatus: StockStatusType =
    input.adjustment_type === "damaged"
      ? "Damaged"
      : input.adjustment_type === "expired"
        ? "Expired"
        : input.adjustment_type === "quality_writeoff"
          ? "Rejected"
          : "Available";

  const id = `ADJ-ID-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;
  const adjNumber = `ADJ-2026-${Math.floor(1000 + Math.random() * 8999)}`;
  const now = new Date().toISOString();
  const status: StockAdjustmentRecord["status"] = executeImmediately ? "Applied" : "Pending Approval";

  withTransaction(() => {
    db.prepare(
      `INSERT INTO stock_adjustments (
        id, adjustment_number, warehouse, zone, bin_code, target_bin_code,
        sku, product_name, internal_lot, supplier_batch,
        adjustment_type, target_status,
        original_cases, actual_cases, difference_cases,
        original_weight_kg, actual_weight_kg, difference_weight_kg,
        unit_cost_cents, value_impact_cents,
        requires_approval, status, reason, evidence_json,
        cycle_count_id, idempotency_key,
        requested_by_id, requested_by_name, requested_at,
        approved_by_id, approved_by_name, approved_at, approval_notes, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?
      )`
    ).run(
      id,
      adjNumber,
      warehouse,
      String(lotRow.zone || "Chilled A"),
      String(lotRow.location || "CH-A01"),
      input.target_bin_code ?? null,
      String(lotRow.sku),
      String(lotRow.product_name),
      String(lotRow.batch_id),
      String(lotRow.supplier_lot || lotRow.batch_id),
      input.adjustment_type,
      targetStatus,
      originalCases,
      actualCases,
      differenceCases,
      originalWeightKg,
      actualWeightKg,
      differenceWeightKg,
      unitCostCents,
      valueImpactCents,
      requiresApproval ? 1 : 0,
      status,
      reason,
      JSON.stringify(input.evidence ?? (input.evidence_ref ? [input.evidence_ref] : [])),
      input.cycle_count_id ?? null,
      input.idempotency_key ?? null,
      actor.id,
      actor.name,
      now,
      executeImmediately ? actor.id : null,
      executeImmediately ? actor.name : null,
      executeImmediately ? now : null,
      executeImmediately ? "Authorized & applied immediately" : null,
      now
    );

    if (executeImmediately) {
      const inserted = db.prepare(`SELECT * FROM stock_adjustments WHERE id = ?`).get(id) as Record<string, unknown>;
      const movementId = applyApprovedAdjustmentToLedger(db, inserted, actor);
      db.prepare(`UPDATE stock_adjustments SET movement_id = ? WHERE id = ?`).run(movementId, id);
    }

    recordAuditEvent({
      actor,
      action: executeImmediately ? "inventory.adjustment_approved_and_posted" : "inventory.adjustment_requested",
      entityType: "StockAdjustment",
      entityId: adjNumber,
      before: { quantity_cases: originalCases, weight_kg: originalWeightKg },
      after: {
        adjustment_number: adjNumber,
        adjustment_type: input.adjustment_type,
        actual_cases: actualCases,
        difference_cases: differenceCases,
        value_impact_cents: valueImpactCents,
        status,
        reason
      }
    });
  });

  const created = db.prepare(`SELECT * FROM stock_adjustments WHERE id = ?`).get(id) as Record<string, unknown>;
  return hydrateAdjustment(created);
}

export function decideStockAdjustment(
  actor: AuthenticatedUser,
  adjustmentIdOrNumber: string,
  input: {
    decision: "approve" | "reject";
    approval_notes?: string | null;
  }
): StockAdjustmentRecord {
  if (!hasPermission(actor, "inventory.approve_adjustment")) {
    throw new ApiError(
      403,
      "FORBIDDEN_ADJUSTMENT_APPROVAL",
      `Role '${actor.role}' is not authorized to approve or reject significant inventory adjustments.`
    );
  }
  requireMutationAuthorization(actor, `${input.decision} stock adjustment`);

  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM stock_adjustments WHERE id = ? OR upper(adjustment_number) = upper(?)`)
    .get(adjustmentIdOrNumber, adjustmentIdOrNumber) as Record<string, unknown> | undefined;

  if (!row) {
    throw new ApiError(404, "ADJUSTMENT_NOT_FOUND", `Stock adjustment '${adjustmentIdOrNumber}' was not found.`);
  }

  requireWarehouseAccess(actor, String(row.warehouse));

  if (String(row.status) !== "Pending Approval") {
    throw new ApiError(
      409,
      "ADJUSTMENT_ALREADY_DECIDED",
      `Stock adjustment '${row.adjustment_number}' has already been '${row.status}'.`
    );
  }

  const now = new Date().toISOString();

  withTransaction(() => {
    if (input.decision === "reject") {
      db.prepare(
        `UPDATE stock_adjustments
         SET status = 'Rejected',
             approved_by_id = ?,
             approved_by_name = ?,
             approved_at = ?,
             approval_notes = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(actor.id, actor.name, now, input.approval_notes || "Rejected by approver", now, String(row.id));

      recordAuditEvent({
        actor,
        action: "inventory.adjustment_rejected",
        entityType: "StockAdjustment",
        entityId: String(row.adjustment_number),
        after: { status: "Rejected", approval_notes: input.approval_notes ?? null }
      });
    } else {
      const movementId = applyApprovedAdjustmentToLedger(db, row, actor);
      db.prepare(
        `UPDATE stock_adjustments
         SET status = 'Applied',
             movement_id = ?,
             approved_by_id = ?,
             approved_by_name = ?,
             approved_at = ?,
             approval_notes = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(movementId, actor.id, actor.name, now, input.approval_notes || "Approved and posted to stock ledger", now, String(row.id));

      recordAuditEvent({
        actor,
        action: "inventory.adjustment_approved",
        entityType: "StockAdjustment",
        entityId: String(row.adjustment_number),
        after: {
          status: "Applied",
          movement_id: movementId,
          difference_cases: row.difference_cases,
          approval_notes: input.approval_notes ?? null
        }
      });
    }
  });

  const updated = db.prepare(`SELECT * FROM stock_adjustments WHERE id = ?`).get(String(row.id)) as Record<string, unknown>;
  return hydrateAdjustment(updated);
}

export function listStockMovements(
  actor: AuthenticatedUser,
  filters: {
    warehouse?: string | null;
    sku?: string | null;
    lot?: string | null;
    movement_type?: string | null;
    search?: string | null;
    page?: number;
    page_size?: number;
  } = {}
): {
  items: StockMovementRecord[];
  total: number;
  page: number;
  page_size: number;
} {
  assertPermission(actor, "inventory:read");
  const db = getDb();
  const conditions: string[] = [];
  const params: string[] = [];

  if (actor && isWarehouseScopedRole(actor.role) && actor.warehouse && actor.warehouse !== "All") {
    conditions.push(
      `(lower(COALESCE(m.warehouse, l.warehouse, 'Milan Cold Hub')) = lower(?))`
    );
    params.push(actor.warehouse);
  } else if (filters.warehouse && filters.warehouse !== "ALL") {
    conditions.push(
      `(lower(COALESCE(m.warehouse, l.warehouse, 'Milan Cold Hub')) = lower(?))`
    );
    params.push(filters.warehouse);
  }

  if (filters.sku && filters.sku !== "ALL") {
    conditions.push("upper(m.sku) = upper(?)");
    params.push(filters.sku);
  }
  if (filters.lot) {
    conditions.push("upper(m.batch_id) = upper(?)");
    params.push(filters.lot);
  }
  if (filters.movement_type && filters.movement_type !== "ALL") {
    conditions.push("lower(m.movement_type) LIKE lower(?)");
    params.push(`%${filters.movement_type}%`);
  }
  if (filters.search && filters.search.trim()) {
    const q = `%${filters.search.trim().toLowerCase()}%`;
    conditions.push(
      `(lower(m.batch_id) LIKE ? OR lower(m.sku) LIKE ? OR lower(m.reason) LIKE ? OR lower(m.actor_email) LIKE ? OR lower(COALESCE(m.reference_id, '')) LIKE ?)`
    );
    params.push(q, q, q, q, q);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const page = Math.max(1, Number(filters.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(filters.page_size || 25)));
  const offset = (page - 1) * pageSize;

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) as c
       FROM stock_movements m
       LEFT JOIN inventory_lots l ON upper(m.batch_id) = upper(l.batch_id)
       ${whereSql}`
    )
    .get(...params) as { c: number };

  const rows = db
    .prepare(
      `SELECT
        m.*,
        COALESCE(l.product_name, m.sku) as product_name,
        COALESCE(m.warehouse, l.warehouse, 'Milan Cold Hub') as warehouse,
        COALESCE(m.zone, l.zone) as zone
       FROM stock_movements m
       LEFT JOIN inventory_lots l ON upper(m.batch_id) = upper(l.batch_id)
       ${whereSql}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset) as Record<string, unknown>[];

  return {
    items: rows.map(hydrateMovement),
    total: Number(totalRow?.c || 0),
    page,
    page_size: pageSize
  };
}
