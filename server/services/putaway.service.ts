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
import type {
  BinRecommendationCandidate,
  BinStatus,
  BinStockPlacement,
  PutawayDashboardMetrics,
  PutawayPlacement,
  PutawayScanLog,
  PutawayTask,
  PutawayTaskDetail,
  PutawayTaskStatus,
  WarehouseBinRecord,
  WarehouseZoneRecord
} from "@/lib/putaway";

function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function roundDec(val: number, decimals = 3): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

interface ProductStorageProfile {
  id: string | null;
  sku: string;
  name: string;
  category: string;
  tempZone: string;
  storageType: "chilled" | "frozen" | "ambient";
  minTempC: number;
  maxTempC: number;
  unitWeightKg: number;
  caseWeightKg: number;
  catchWeight: boolean;
  weightTolerancePct: number;
  allergens: string[];
  handling: string[];
}

function getProductStorageProfile(sku: string): ProductStorageProfile {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, sku, name, category, temp_zone, temp_min_c, temp_max_c,
              unit_weight_kg, case_weight_kg, catch_weight, weight_tolerance_pct,
              allergens_json, handling_json
       FROM products WHERE upper(sku) = upper(?)`
    )
    .get(sku) as Record<string, unknown> | undefined;

  if (!row) {
    const isSalmon = /sal|atlant|fish|seafood/i.test(sku);
    return {
      id: null,
      sku,
      name: isSalmon ? "Atlantic Salmon Fillet" : sku,
      category: isSalmon ? "Seafood" : "Chilled",
      tempZone: isSalmon ? "Chilled (0°C to +2°C)" : "Chilled (0°C to +4°C)",
      storageType: "chilled",
      minTempC: 0,
      maxTempC: isSalmon ? 2 : 4,
      unitWeightKg: 5,
      caseWeightKg: 5,
      catchWeight: isSalmon,
      weightTolerancePct: 5,
      allergens: isSalmon ? ["Fish"] : [],
      handling: []
    };
  }

  const tempZone = String(row.temp_zone || "Chilled (0°C to +4°C)");
  const tzLower = tempZone.toLowerCase();
  let storageType: "chilled" | "frozen" | "ambient" = "chilled";
  let defaultMin = 0;
  let defaultMax = 4;

  if (tzLower.includes("frozen") || tzLower.includes("-18") || String(row.category || "").toLowerCase() === "frozen") {
    storageType = "frozen";
    defaultMin = -25;
    defaultMax = -18;
  } else if (tzLower.includes("ambient") || tzLower.includes("+14") || String(row.category || "").toLowerCase() === "ambient") {
    storageType = "ambient";
    defaultMin = 10;
    defaultMax = 22;
  } else if (tzLower.includes("0°c to +2°c")) {
    storageType = "chilled";
    defaultMin = 0;
    defaultMax = 2;
  } else if (tzLower.includes("+2°c to +4°c")) {
    storageType = "chilled";
    defaultMin = 2;
    defaultMax = 4;
  } else if (tzLower.includes("+8°c to +12°c")) {
    storageType = "ambient";
    defaultMin = 8;
    defaultMax = 14;
  }

  const minTempC =
    row.temp_min_c !== null && row.temp_min_c !== undefined ? Number(row.temp_min_c) : defaultMin;
  const maxTempC =
    row.temp_max_c !== null && row.temp_max_c !== undefined ? Number(row.temp_max_c) : defaultMax;

  if (maxTempC <= -10) {
    storageType = "frozen";
  } else if (minTempC >= 8) {
    storageType = "ambient";
  } else {
    storageType = "chilled";
  }

  const unitWeight = Number(row.unit_weight_kg || 5);
  const caseWeight = Number(row.case_weight_kg || unitWeight || 5);

  const parsedAllergens = parseJsonArray<string>(row.allergens_json as string);
  const categoryStr = String(row.category || "Chilled");
  const allergens =
    parsedAllergens.length > 0
      ? parsedAllergens
      : categoryStr.toLowerCase() === "seafood"
        ? ["Fish"]
        : [];

  return {
    id: row.id ? String(row.id) : null,
    sku: String(row.sku),
    name: String(row.name),
    category: categoryStr,
    tempZone,
    storageType,
    minTempC,
    maxTempC,
    unitWeightKg: unitWeight,
    caseWeightKg: caseWeight,
    catchWeight: Number(row.catch_weight || 0) === 1,
    weightTolerancePct: Number(row.weight_tolerance_pct || 5),
    allergens,
    handling: parseJsonArray<string>(row.handling_json as string)
  };
}

function hydrateZone(row: Record<string, unknown>): WarehouseZoneRecord {
  return {
    id: String(row.id),
    code: String(row.code),
    warehouse: String(row.warehouse),
    name: String(row.name),
    zone_type: (row.zone_type as WarehouseZoneRecord["zone_type"]) || "chilled",
    min_temp_c: Number(row.min_temp_c),
    max_temp_c: Number(row.max_temp_c),
    allowed_categories: parseJsonArray<string>(row.allowed_categories_json as string),
    segregation_rules: parseJsonArray<string>(row.segregation_rules_json as string),
    is_active: Number(row.is_active ?? 1),
    created_at: String(row.created_at)
  };
}

function hydrateBinStockPlacement(row: Record<string, unknown>): BinStockPlacement {
  return {
    id: String(row.id),
    bin_id: String(row.bin_id),
    bin_code: String(row.bin_code),
    warehouse: String(row.warehouse),
    zone_code: String(row.zone_code),
    internal_lot: String(row.internal_lot),
    supplier_batch: String(row.supplier_batch),
    sku: String(row.sku),
    product_name: String(row.product_name),
    category: String(row.category || "Chilled"),
    quantity_cases: Number(row.quantity_cases || 0),
    uom: String(row.uom || "case"),
    weight_kg: Number(row.weight_kg || 0),
    packages: Number(row.packages || 0),
    manufacture_date: row.manufacture_date ? String(row.manufacture_date) : null,
    expiry_date: String(row.expiry_date),
    quality_status: (row.quality_status as BinStockPlacement["quality_status"]) || "released",
    temp_at_placement_c:
      row.temp_at_placement_c !== null && row.temp_at_placement_c !== undefined
        ? Number(row.temp_at_placement_c)
        : null,
    placed_by: String(row.placed_by),
    placed_at: String(row.placed_at),
    updated_at: String(row.updated_at)
  };
}

function hydrateBin(row: Record<string, unknown>, lots?: BinStockPlacement[]): WarehouseBinRecord {
  const maxCases = Number(row.max_cases || 100);
  const currentCases = Number(row.current_cases || 0);
  const availableCases = Math.max(0, roundDec(maxCases - currentCases, 3));
  const maxWeight = Number(row.max_weight_kg || 1000);
  const currentWeight = Number(row.current_weight_kg || 0);
  const availableWeight = Math.max(0, roundDec(maxWeight - currentWeight, 3));

  const caseUtil = maxCases > 0 ? (currentCases / maxCases) * 100 : 0;
  const weightUtil = maxWeight > 0 ? (currentWeight / maxWeight) * 100 : 0;
  const utilizationPct = Math.min(100, roundDec(Math.max(caseUtil, weightUtil), 1));

  return {
    id: String(row.id),
    code: String(row.code),
    barcode: String(row.barcode),
    warehouse: String(row.warehouse),
    zone_id: String(row.zone_id),
    zone_code: String(row.zone_code),
    zone_name: String(row.zone_name),
    storage_type: (row.storage_type as WarehouseBinRecord["storage_type"]) || "chilled",
    aisle: String(row.aisle),
    rack: String(row.rack),
    shelf: String(row.shelf),
    position: String(row.position),
    min_temp_c: Number(row.min_temp_c),
    max_temp_c: Number(row.max_temp_c),
    max_cases: maxCases,
    current_cases: currentCases,
    available_cases: availableCases,
    max_weight_kg: maxWeight,
    current_weight_kg: currentWeight,
    available_weight_kg: availableWeight,
    max_volume_m3: Number(row.max_volume_m3 || 4),
    current_volume_m3: Number(row.current_volume_m3 || 0),
    utilization_pct: utilizationPct,
    allowed_categories: parseJsonArray<string>(row.allowed_categories_json as string),
    restricted_allergens: parseJsonArray<string>(row.restricted_allergens_json as string),
    segregation_group: String(row.segregation_group || "general"),
    status: (row.status as BinStatus) || "active",
    notes: row.notes ? String(row.notes) : null,
    lots,
    updated_at: String(row.updated_at)
  };
}

function hydratePutawayTask(row: Record<string, unknown>): PutawayTask {
  return {
    id: String(row.id),
    task_number: String(row.task_number),
    inspection_id: row.inspection_id ? String(row.inspection_id) : null,
    shipment_id: row.shipment_id ? String(row.shipment_id) : null,
    shipment_reference: row.shipment_reference ? String(row.shipment_reference) : null,
    asn_reference: row.asn_reference ? String(row.asn_reference) : null,
    purchase_order_id: row.purchase_order_id ? String(row.purchase_order_id) : null,
    supplier_id: row.supplier_id ? String(row.supplier_id) : null,
    supplier_name: String(row.supplier_name || ""),
    sku: String(row.sku),
    product_name: String(row.product_name),
    category: String(row.category || "Chilled"),
    supplier_batch: String(row.supplier_batch),
    internal_lot: String(row.internal_lot),
    manufacture_date: row.manufacture_date ? String(row.manufacture_date) : null,
    expiry_date: String(row.expiry_date),
    warehouse: String(row.warehouse),
    receiving_location: String(row.receiving_location || "RCV-STAGE-01"),
    uom: String(row.uom || "case"),
    total_eligible_qty: Number(row.total_eligible_qty || 0),
    placed_qty: Number(row.placed_qty || 0),
    remaining_qty: Number(row.remaining_qty || 0),
    expected_weight_kg: Number(row.expected_weight_kg || 0),
    actual_weight_kg:
      row.actual_weight_kg !== null && row.actual_weight_kg !== undefined ? Number(row.actual_weight_kg) : null,
    placed_weight_kg: Number(row.placed_weight_kg || 0),
    packages: Number(row.packages || 0),
    temp_reading_c:
      row.temp_reading_c !== null && row.temp_reading_c !== undefined ? Number(row.temp_reading_c) : null,
    temp_min_c: Number(row.temp_min_c ?? 0),
    temp_max_c: Number(row.temp_max_c ?? 4),
    temp_status: (row.temp_status as PutawayTask["temp_status"]) || "in_range",
    quality_status: (row.quality_status as PutawayTask["quality_status"]) || "released",
    recommended_zone_code: row.recommended_zone_code ? String(row.recommended_zone_code) : null,
    recommended_bin_code: row.recommended_bin_code ? String(row.recommended_bin_code) : null,
    recommendation_reason: row.recommendation_reason ? String(row.recommendation_reason) : null,
    recommendation_score:
      row.recommendation_score !== null && row.recommendation_score !== undefined
        ? Number(row.recommendation_score)
        : null,
    assigned_bin_code: row.assigned_bin_code ? String(row.assigned_bin_code) : null,
    override_reason: row.override_reason ? String(row.override_reason) : null,
    overridden_by: row.overridden_by ? String(row.overridden_by) : null,
    overridden_at: row.overridden_at ? String(row.overridden_at) : null,
    assigned_operator_id: row.assigned_operator_id ? String(row.assigned_operator_id) : null,
    assigned_operator_name: row.assigned_operator_name ? String(row.assigned_operator_name) : null,
    priority: (row.priority as PutawayTask["priority"]) || "high",
    status: (row.status as PutawayTaskStatus) || "Ready for Put-away",
    status_changed_by: row.status_changed_by ? String(row.status_changed_by) : null,
    status_changed_at: row.status_changed_at ? String(row.status_changed_at) : null,
    scan_task_verified: Number(row.scan_task_verified || 0),
    scan_sku_verified: Number(row.scan_sku_verified || 0),
    scan_lot_verified: Number(row.scan_lot_verified || 0),
    scan_bin_verified: Number(row.scan_bin_verified || 0),
    notes: row.notes ? String(row.notes) : null,
    created_at: String(row.created_at),
    completed_at: row.completed_at ? String(row.completed_at) : null,
    updated_at: String(row.updated_at)
  };
}

function hydratePlacement(row: Record<string, unknown>): PutawayPlacement {
  return {
    id: String(row.id),
    placement_number: String(row.placement_number),
    task_id: String(row.task_id),
    task_number: String(row.task_number),
    internal_lot: String(row.internal_lot),
    supplier_batch: String(row.supplier_batch),
    sku: String(row.sku),
    product_name: String(row.product_name),
    warehouse: String(row.warehouse),
    from_location: String(row.from_location),
    to_zone_code: String(row.to_zone_code),
    to_bin_code: String(row.to_bin_code),
    expected_qty: Number(row.expected_qty || 0),
    placed_qty: Number(row.placed_qty || 0),
    remaining_qty_after: Number(row.remaining_qty_after || 0),
    uom: String(row.uom || "case"),
    packages: Number(row.packages || 0),
    expected_weight_kg: Number(row.expected_weight_kg || 0),
    actual_weight_kg: Number(row.actual_weight_kg || 0),
    weight_variance_kg: Number(row.weight_variance_kg || 0),
    weight_variance_pct: Number(row.weight_variance_pct || 0),
    discrepancy_notes: row.discrepancy_notes ? String(row.discrepancy_notes) : null,
    temp_c: row.temp_c !== null && row.temp_c !== undefined ? Number(row.temp_c) : null,
    temp_status: (row.temp_status as PutawayPlacement["temp_status"]) || "in_range",
    scan_method: (row.scan_method as PutawayPlacement["scan_method"]) || "barcode_scan",
    movement_id: row.movement_id ? String(row.movement_id) : null,
    operator_id: String(row.operator_id),
    operator_name: String(row.operator_name),
    placed_at: String(row.placed_at)
  };
}

function hydrateScanLog(row: Record<string, unknown>): PutawayScanLog {
  return {
    id: String(row.id),
    task_id: String(row.task_id),
    scan_step: row.scan_step as PutawayScanLog["scan_step"],
    scanned_value: String(row.scanned_value),
    expected_value: String(row.expected_value),
    scan_mode: (row.scan_mode as PutawayScanLog["scan_mode"]) || "scanner",
    valid: Number(row.valid ?? 1),
    failure_reason: row.failure_reason ? String(row.failure_reason) : null,
    scanned_by: String(row.scanned_by),
    scanned_at: String(row.scanned_at)
  };
}

function buildWarehouseScopeClause(
  actor: AuthenticatedUser,
  requestedWarehouse?: string | null
): { clause: string; params: string[] } {
  const scopedRoles = ["warehouse_manager", "picker", "warehouse_staff", "qa", "qa_inspector", "qa_manager"];
  if (scopedRoles.includes(actor.role) && actor.warehouse && actor.warehouse !== "All") {
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
    return { clause: "lower(warehouse) = lower(?)", params: [actor.warehouse] };
  }
  if (requestedWarehouse && requestedWarehouse !== "ALL") {
    return { clause: "lower(warehouse) = lower(?)", params: [requestedWarehouse] };
  }
  return { clause: "", params: [] };
}

/**
 * Intelligent Storage Location Recommendation Engine
 * Evaluates bins against:
 * 1. Active status (rejects blocked, inactive, restricted, or quarantine bins)
 * 2. Storage type & configured temperature range compatibility
 * 3. Food safety, category compatibility, and allergen / cross-contamination segregation
 * 4. Available bin case & weight capacity
 * 5. FEFO consolidation & SKU affinity
 */
export function computeBinRecommendations(
  warehouse: string,
  sku: string,
  requiredQty: number,
  caseWeightKgOverride?: number | null
): BinRecommendationCandidate[] {
  const db = getDb();
  const profile = getProductStorageProfile(sku);
  const unitWeight = caseWeightKgOverride && caseWeightKgOverride > 0 ? caseWeightKgOverride : profile.caseWeightKg;
  const requiredWeightKg = roundDec(requiredQty * unitWeight, 3);

  const binRows = db
    .prepare(`SELECT * FROM warehouse_bins WHERE lower(warehouse) = lower(?) ORDER BY code ASC`)
    .all(warehouse) as Record<string, unknown>[];

  const allPlacements = db
    .prepare(`SELECT * FROM bin_stock_placements WHERE lower(warehouse) = lower(?) AND quantity_cases > 0`)
    .all(warehouse) as Record<string, unknown>[];

  const placementsByBin = new Map<string, BinStockPlacement[]>();
  for (const p of allPlacements) {
    const hydrated = hydrateBinStockPlacement(p);
    const list = placementsByBin.get(hydrated.bin_code) ?? [];
    list.push(hydrated);
    placementsByBin.set(hydrated.bin_code, list);
  }

  const candidates: BinRecommendationCandidate[] = binRows.map((row) => {
    const binLots = placementsByBin.get(String(row.code)) ?? [];
    const bin = hydrateBin(row, binLots);
    const disqualifyReasons: string[] = [];

    // 1. Check bin operational status & quarantine isolation
    if (bin.status !== "active") {
      disqualifyReasons.push(`Bin status is '${bin.status}' (only 'active' bins can receive put-away stock).`);
    }
    if (bin.storage_type === "quarantine" || bin.segregation_group === "quarantine") {
      disqualifyReasons.push("Quarantine/Hold cage cannot be used for normal available-stock put-away.");
    }

    // 2. Check storage type & temperature compatibility
    if (bin.storage_type !== profile.storageType) {
      disqualifyReasons.push(
        `Storage type mismatch: product requires '${profile.storageType}' (${profile.minTempC}..${profile.maxTempC}°C), bin is '${bin.storage_type}' (${bin.min_temp_c}..${bin.max_temp_c}°C).`
      );
    } else if (bin.min_temp_c > profile.maxTempC || bin.max_temp_c < profile.minTempC) {
      disqualifyReasons.push(
        `Temperature range incompatible: product requires ${profile.minTempC}°C to ${profile.maxTempC}°C, bin is configured for ${bin.min_temp_c}°C to ${bin.max_temp_c}°C.`
      );
    }

    // 3. Check product category & food-safety / allergen segregation
    const catAllowed =
      bin.allowed_categories.length === 0 ||
      bin.allowed_categories.some(
        (c) =>
          c.toLowerCase() === "all" ||
          c.toLowerCase() === profile.category.toLowerCase() ||
          (c.toLowerCase() === "chilled" && profile.storageType === "chilled")
      );
    if (!catAllowed) {
      disqualifyReasons.push(
        `Category incompatibility: product category '${profile.category}' is not permitted in bin allowed categories [${bin.allowed_categories.join(", ")}].`
      );
    }

    const allergenConflict = profile.allergens.filter((alg) =>
      bin.restricted_allergens.some((r) => r.toLowerCase() === alg.toLowerCase())
    );
    if (allergenConflict.length > 0) {
      disqualifyReasons.push(
        `Food-safety allergen restriction: product contains [${allergenConflict.join(", ")}] which is restricted in bin '${bin.code}'.`
      );
    }

    // Raw seafood / raw meat cross-contamination check against existing bin contents
    if (profile.category.toLowerCase() === "seafood" && bin.segregation_group === "dairy_rte") {
      disqualifyReasons.push("Cross-contamination rule: raw seafood cannot be placed in ready-to-eat Dairy bins.");
    }
    if (profile.category.toLowerCase() === "dairy" && bin.segregation_group === "seafood_raw") {
      disqualifyReasons.push("Cross-contamination rule: ready-to-eat Dairy cannot be placed in raw Seafood bins.");
    }
    const conflictingLotInBin = binLots.find(
      (l) =>
        (profile.category.toLowerCase() === "seafood" && l.category.toLowerCase() === "dairy") ||
        (profile.category.toLowerCase() === "dairy" && l.category.toLowerCase() === "seafood")
    );
    if (conflictingLotInBin) {
      disqualifyReasons.push(
        `Cross-contamination risk: bin currently holds incompatible category '${conflictingLotInBin.category}' (lot ${conflictingLotInBin.internal_lot}).`
      );
    }

    // 4. Check available capacity (cases & weight)
    const maxByWeight = unitWeight > 0 ? Math.floor((bin.available_weight_kg + 0.0001) / unitWeight) : bin.available_cases;
    const maxPlaceableCases = Math.max(0, Math.min(bin.available_cases, maxByWeight));

    if (bin.available_cases <= 0 || maxPlaceableCases <= 0) {
      disqualifyReasons.push(
        `Bin is full or has insufficient weight/case capacity (${bin.available_cases} cases / ${bin.available_weight_kg} kg available).`
      );
    }

    const eligible = disqualifyReasons.length === 0;
    const canFitFullBatch = eligible && maxPlaceableCases >= requiredQty && bin.available_weight_kg >= requiredWeightKg - 0.01;

    let score = 0;
    const reasons: string[] = [];
    if (eligible) {
      score += 40;
      reasons.push(`Temperature compatible (${bin.min_temp_c}°C to ${bin.max_temp_c}°C)`);

      if (bin.min_temp_c >= profile.minTempC && bin.max_temp_c <= profile.maxTempC) {
        score += 20;
        reasons.push("Exact cold-chain band match");
      }

      if (bin.allowed_categories.some((c) => c.toLowerCase() === profile.category.toLowerCase())) {
        score += 15;
        reasons.push(`Dedicated ${profile.category} segregation (${bin.segregation_group})`);
      }

      if (canFitFullBatch) {
        score += 20;
        reasons.push(`Full batch fits (${bin.available_cases} cases / ${bin.available_weight_kg} kg free)`);
      } else {
        score += 5;
        reasons.push(`Partial fit up to ${maxPlaceableCases} cases (${bin.available_weight_kg} kg free)`);
      }

      // Prefer empty or same-SKU bins for clean FEFO rotation
      if (bin.current_cases === 0) {
        score += 5;
        reasons.push("Empty bin for clean FEFO lot rotation");
      } else if (binLots.some((l) => l.sku.toUpperCase() === profile.sku.toUpperCase())) {
        score += 4;
        reasons.push("Consolidates with existing same-SKU stock");
      }
    }

    return {
      bin,
      eligible,
      score,
      can_fit_full_batch: canFitFullBatch,
      max_placeable_cases: maxPlaceableCases,
      reason: eligible ? reasons.join(" · ") : disqualifyReasons.join(" "),
      disqualify_reasons: disqualifyReasons
    };
  });

  return candidates.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.can_fit_full_batch !== b.can_fit_full_batch) return a.can_fit_full_batch ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return a.bin.code.localeCompare(b.bin.code);
  });
}

export function listWarehouseZones(actor: AuthenticatedUser, warehouse?: string | null): WarehouseZoneRecord[] {
  assertPermission(actor, "putaway.read");
  const db = getDb();
  const wf = buildWarehouseScopeClause(actor, warehouse);
  const whereSql = wf.clause ? `WHERE ${wf.clause}` : "";
  const rows = db
    .prepare(`SELECT * FROM warehouse_zones ${whereSql} ORDER BY warehouse ASC, code ASC`)
    .all(...wf.params) as Record<string, unknown>[];
  return rows.map(hydrateZone);
}

export function listWarehouseBins(
  actor: AuthenticatedUser,
  filters: {
    warehouse?: string | null;
    zone_code?: string | null;
    storage_type?: string | null;
    status?: string | null;
    sku_for_recommendation?: string | null;
  } = {}
): WarehouseBinRecord[] {
  assertPermission(actor, "putaway.read");
  const db = getDb();
  const conditions: string[] = [];
  const params: string[] = [];

  const wf = buildWarehouseScopeClause(actor, filters.warehouse);
  if (wf.clause) {
    conditions.push(wf.clause);
    params.push(...wf.params);
  }
  if (filters.zone_code && filters.zone_code !== "ALL") {
    conditions.push("upper(zone_code) = upper(?)");
    params.push(filters.zone_code);
  }
  if (filters.storage_type && filters.storage_type !== "ALL") {
    conditions.push("lower(storage_type) = lower(?)");
    params.push(filters.storage_type);
  }
  if (filters.status && filters.status !== "ALL") {
    conditions.push("status = ?");
    params.push(filters.status);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM warehouse_bins ${whereSql} ORDER BY warehouse ASC, code ASC`)
    .all(...params) as Record<string, unknown>[];

  const allPlacements = db
    .prepare(`SELECT * FROM bin_stock_placements WHERE quantity_cases > 0 ORDER BY expiry_date ASC`)
    .all() as Record<string, unknown>[];

  const placementsByBin = new Map<string, BinStockPlacement[]>();
  for (const p of allPlacements) {
    const hydrated = hydrateBinStockPlacement(p);
    const list = placementsByBin.get(hydrated.bin_code) ?? [];
    list.push(hydrated);
    placementsByBin.set(hydrated.bin_code, list);
  }

  return rows.map((r) => hydrateBin(r, placementsByBin.get(String(r.code)) ?? []));
}

export function updateWarehouseBin(
  actor: AuthenticatedUser,
  binCodeOrId: string,
  input: {
    status?: BinStatus;
    max_cases?: number;
    max_weight_kg?: number;
    notes?: string | null;
  }
): WarehouseBinRecord {
  assertPermission(actor, "putaway.manage");
  requireMutationAuthorization(actor, "update warehouse bin configuration");

  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM warehouse_bins WHERE upper(code) = upper(?) OR id = ?`)
    .get(binCodeOrId, binCodeOrId) as Record<string, unknown> | undefined;

  if (!row) {
    throw new ApiError(404, "BIN_NOT_FOUND", `Warehouse bin '${binCodeOrId}' was not found.`);
  }

  const existing = hydrateBin(row);
  requireWarehouseAccess(actor, existing.warehouse);

  const nextStatus = input.status ?? existing.status;
  const nextMaxCases = input.max_cases !== undefined ? Number(input.max_cases) : existing.max_cases;
  const nextMaxWeight = input.max_weight_kg !== undefined ? Number(input.max_weight_kg) : existing.max_weight_kg;

  if (nextMaxCases < existing.current_cases || nextMaxWeight < existing.current_weight_kg) {
    throw new ApiError(
      400,
      "CAPACITY_BELOW_OCCUPANCY",
      `Cannot reduce bin capacity (${nextMaxCases} cases / ${nextMaxWeight} kg) below current occupancy (${existing.current_cases} cases / ${existing.current_weight_kg} kg).`
    );
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE warehouse_bins
     SET status = ?,
         max_cases = ?,
         max_weight_kg = ?,
         notes = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(nextStatus, nextMaxCases, nextMaxWeight, input.notes !== undefined ? input.notes : existing.notes, now, existing.id);

  recordAuditEvent({
    actor,
    action: "putaway.bin_updated",
    entityType: "WarehouseBin",
    entityId: existing.code,
    before: { status: existing.status, max_cases: existing.max_cases, max_weight_kg: existing.max_weight_kg },
    after: { status: nextStatus, max_cases: nextMaxCases, max_weight_kg: nextMaxWeight }
  });

  return listWarehouseBins(actor, { warehouse: existing.warehouse }).find((b) => b.id === existing.id)!;
}

export function getPutawayDashboardMetrics(
  actor: AuthenticatedUser,
  warehouse?: string | null
): PutawayDashboardMetrics {
  assertPermission(actor, "putaway.read");
  const db = getDb();
  const wf = buildWarehouseScopeClause(actor, warehouse);
  const whereSql = wf.clause ? `WHERE ${wf.clause}` : "";
  const andSql = wf.clause ? `AND ${wf.clause}` : "";

  const pendingRow = db
    .prepare(
      `SELECT COUNT(*) as c FROM putaway_tasks
       WHERE status IN ('Pending Recommendation', 'Ready for Put-away', 'Assigned') ${andSql}`
    )
    .get(...wf.params) as { c: number };

  const inProgressRow = db
    .prepare(`SELECT COUNT(*) as c FROM putaway_tasks WHERE status = 'In Progress' ${andSql}`)
    .get(...wf.params) as { c: number };

  const completedRow = db
    .prepare(`SELECT COUNT(*) as c FROM putaway_tasks WHERE status = 'Completed' ${andSql}`)
    .get(...wf.params) as { c: number };

  const partialRow = db
    .prepare(`SELECT COUNT(*) as c FROM putaway_tasks WHERE status = 'Partially Completed' ${andSql}`)
    .get(...wf.params) as { c: number };

  const blockedRow = db
    .prepare(`SELECT COUNT(*) as c FROM putaway_tasks WHERE status = 'Blocked' ${andSql}`)
    .get(...wf.params) as { c: number };

  const awaitingQtyRow = db
    .prepare(
      `SELECT COALESCE(SUM(remaining_qty), 0) as q FROM putaway_tasks
       WHERE status NOT IN ('Completed', 'Cancelled') ${andSql}`
    )
    .get(...wf.params) as { q: number };

  const binsAgg = db
    .prepare(
      `SELECT
        COUNT(*) as total_bins,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_bins,
        COALESCE(SUM(CASE WHEN status = 'active' THEN current_cases ELSE 0 END), 0) as used_cases,
        COALESCE(SUM(CASE WHEN status = 'active' THEN max_cases ELSE 0 END), 0) as max_cases
       FROM warehouse_bins ${whereSql}`
    )
    .get(...wf.params) as {
    total_bins: number;
    active_bins: number;
    used_cases: number;
    max_cases: number;
  };

  const utilPct =
    Number(binsAgg?.max_cases || 0) > 0
      ? roundDec((Number(binsAgg.used_cases) / Number(binsAgg.max_cases)) * 100, 1)
      : 0;

  return {
    pending_putaway_tasks: Number(pendingRow?.c || 0),
    tasks_in_progress: Number(inProgressRow?.c || 0),
    completed_tasks: Number(completedRow?.c || 0),
    partially_completed_tasks: Number(partialRow?.c || 0),
    blocked_tasks: Number(blockedRow?.c || 0),
    total_quantities_awaiting_placement: roundDec(Number(awaitingQtyRow?.q || 0), 3),
    warehouse_bin_utilization_pct: utilPct,
    active_bins_count: Number(binsAgg?.active_bins || 0),
    total_bins_count: Number(binsAgg?.total_bins || 0)
  };
}

export function listPutawayTasks(
  actor: AuthenticatedUser,
  filters: {
    warehouse?: string | null;
    status?: string | null;
    search?: string | null;
    sku?: string | null;
    lot?: string | null;
    page?: number;
    page_size?: number;
  } = {}
): {
  items: PutawayTask[];
  total: number;
  page: number;
  page_size: number;
  metrics: PutawayDashboardMetrics;
} {
  assertPermission(actor, "putaway.read");
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  const wf = buildWarehouseScopeClause(actor, filters.warehouse);
  if (wf.clause) {
    conditions.push(wf.clause);
    params.push(...wf.params);
  }
  if (filters.status && filters.status !== "ALL") {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters.sku && filters.sku !== "ALL") {
    conditions.push("upper(sku) = upper(?)");
    params.push(filters.sku);
  }
  if (filters.lot) {
    conditions.push("(upper(internal_lot) = upper(?) OR upper(supplier_batch) = upper(?))");
    params.push(filters.lot, filters.lot);
  }
  if (filters.search && filters.search.trim()) {
    const q = `%${filters.search.trim().toLowerCase()}%`;
    conditions.push(
      `(lower(task_number) LIKE ? OR lower(internal_lot) LIKE ? OR lower(supplier_batch) LIKE ? OR lower(sku) LIKE ? OR lower(product_name) LIKE ? OR lower(supplier_name) LIKE ? OR lower(COALESCE(recommended_bin_code, '')) LIKE ? OR lower(COALESCE(assigned_bin_code, '')) LIKE ?)`
    );
    params.push(q, q, q, q, q, q, q, q);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const page = Math.max(1, Number(filters.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(filters.page_size || 25)));
  const offset = (page - 1) * pageSize;

  const totalRow = db
    .prepare(`SELECT COUNT(*) as c FROM putaway_tasks ${whereSql}`)
    .get(...(params as string[])) as { c: number };

  const rows = db
    .prepare(
      `SELECT * FROM putaway_tasks ${whereSql}
       ORDER BY
         CASE WHEN status IN ('Ready for Put-away', 'Assigned', 'In Progress', 'Partially Completed') THEN 0 ELSE 1 END ASC,
         created_at DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...(params as string[]), pageSize, offset) as Record<string, unknown>[];

  return {
    items: rows.map(hydratePutawayTask),
    total: Number(totalRow?.c || 0),
    page,
    page_size: pageSize,
    metrics: getPutawayDashboardMetrics(actor, filters.warehouse)
  };
}

export function getPutawayTaskDetail(actor: AuthenticatedUser, idOrNumber: string): PutawayTaskDetail {
  assertPermission(actor, "putaway.read");
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM putaway_tasks WHERE id = ? OR upper(task_number) = upper(?)`)
    .get(idOrNumber, idOrNumber) as Record<string, unknown> | undefined;

  if (!row) {
    throw new ApiError(404, "PUTAWAY_TASK_NOT_FOUND", `Put-away task '${idOrNumber}' was not found.`);
  }

  const task = hydratePutawayTask(row);
  requireRecordAccess(actor, { warehouse: task.warehouse, supplier_id: task.supplier_id });

  const singleCaseWeight =
    task.total_eligible_qty > 0 ? task.expected_weight_kg / task.total_eligible_qty : undefined;
  const recommendations = computeBinRecommendations(
    task.warehouse,
    task.sku,
    Math.max(1, task.remaining_qty),
    singleCaseWeight
  );

  const placementRows = db
    .prepare(`SELECT * FROM putaway_placements WHERE task_id = ? ORDER BY placed_at DESC, id DESC`)
    .all(task.id) as Record<string, unknown>[];

  const scanRows = db
    .prepare(`SELECT * FROM putaway_scan_logs WHERE task_id = ? ORDER BY scanned_at DESC, id DESC`)
    .all(task.id) as Record<string, unknown>[];

  const lotPlacementRows = db
    .prepare(`SELECT * FROM bin_stock_placements WHERE upper(internal_lot) = upper(?) ORDER BY bin_code ASC`)
    .all(task.internal_lot) as Record<string, unknown>[];

  return {
    ...task,
    recommendations,
    placements: placementRows.map(hydratePlacement),
    scan_logs: scanRows.map(hydrateScanLog),
    lot_placements: lotPlacementRows.map(hydrateBinStockPlacement)
  };
}

export function createPutawayTask(
  actor: AuthenticatedUser,
  input: {
    inspection_id?: string | null;
    shipment_id?: string | null;
    shipment_reference?: string | null;
    asn_reference?: string | null;
    purchase_order_id?: string | null;
    supplier_id?: string | null;
    supplier_name?: string;
    sku?: string;
    product_name?: string;
    supplier_batch?: string;
    internal_lot: string;
    manufacture_date?: string | null;
    expiry_date?: string;
    warehouse?: string;
    receiving_location?: string;
    uom?: string;
    eligible_qty?: number;
    actual_weight_kg?: number | null;
    packages?: number;
    temp_reading_c?: number | null;
    assigned_operator_id?: string | null;
    assigned_operator_name?: string | null;
    priority?: "urgent" | "high" | "normal" | "low";
    notes?: string | null;
  }
): PutawayTaskDetail {
  if (!hasPermission(actor, "putaway.manage") && !hasPermission(actor, "putaway.execute") && !hasPermission(actor, "quality.decide")) {
    throw new ApiError(403, "FORBIDDEN_INSUFFICIENT_ROLE", `Role '${actor.role}' is not authorized to create put-away tasks.`);
  }
  requireMutationAuthorization(actor, "create put-away task");

  const db = getDb();
  const internalLot = (input.internal_lot || "").trim();
  if (!internalLot) {
    throw new ApiError(400, "VALIDATION_ERROR", "internal_lot is required to generate a put-away task.");
  }

  // Look up inspection and inventory_lots to verify quality-release eligibility
  const inspectionRow = input.inspection_id
    ? (db.prepare(`SELECT * FROM quality_inspections WHERE id = ? OR inspection_number = ?`).get(input.inspection_id, input.inspection_id) as
        | Record<string, unknown>
        | undefined)
    : (db
        .prepare(`SELECT * FROM quality_inspections WHERE upper(internal_lot) = upper(?) ORDER BY updated_at DESC LIMIT 1`)
        .get(internalLot) as Record<string, unknown> | undefined);

  const lotRow = db
    .prepare(`SELECT * FROM inventory_lots WHERE upper(batch_id) = upper(?)`)
    .get(internalLot) as Record<string, unknown> | undefined;

  if (inspectionRow) {
    const inspStatus = String(inspectionRow.status || "pending");
    const acceptedQty = Number(inspectionRow.accepted_qty || 0);
    if ((inspStatus !== "released" && inspStatus !== "partially_released") || acceptedQty <= 0) {
      throw new ApiError(
        409,
        "QUALITY_NOT_RELEASED",
        `Cannot generate normal put-away task for lot '${internalLot}': inspection status is '${inspStatus}' with ${acceptedQty} accepted units. Held, quarantined, and rejected goods cannot enter available storage.`
      );
    }
  }

  if (lotRow) {
    const lotStatus = String(lotRow.quality_status || "pending");
    const releasedCases = Number(lotRow.quantity_cases || 0);
    if (lotStatus !== "released" || releasedCases <= 0) {
      throw new ApiError(
        409,
        "QUALITY_NOT_RELEASED",
        `Cannot generate normal put-away task for lot '${internalLot}': lot quality_status is '${lotStatus}' (${releasedCases} released cases). Only QA-released goods can be placed into normal storage.`
      );
    }
  }

  if (!inspectionRow && !lotRow) {
    throw new ApiError(
      404,
      "LOT_NOT_FOUND",
      `Lot '${internalLot}' was not found in released inventory or quality inspections.`
    );
  }

  const sku = String(input.sku || inspectionRow?.sku || lotRow?.sku || "").trim();
  const warehouse = String(input.warehouse || inspectionRow?.warehouse || lotRow?.warehouse || actor.warehouse || "Milan Cold Hub").trim();
  requireWarehouseAccess(actor, warehouse);

  // Check if an active put-away task already exists for this lot
  const existingTask = db
    .prepare(
      `SELECT id FROM putaway_tasks
       WHERE upper(internal_lot) = upper(?) AND status NOT IN ('Cancelled')
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(internalLot) as { id: string } | undefined;

  if (existingTask) {
    return getPutawayTaskDetail(actor, existingTask.id);
  }

  const profile = getProductStorageProfile(sku);
  const eligibleQty = roundDec(
    Number(
      input.eligible_qty !== undefined
        ? input.eligible_qty
        : inspectionRow
          ? inspectionRow.accepted_qty
          : lotRow?.quantity_cases || 0
    ),
    3
  );

  if (eligibleQty <= 0) {
    throw new ApiError(400, "INVALID_ELIGIBLE_QTY", "Eligible released quantity must be greater than zero.");
  }

  const supplierBatch = String(input.supplier_batch || inspectionRow?.supplier_batch || lotRow?.supplier_lot || internalLot);
  const expiryDate = String(input.expiry_date || inspectionRow?.expiry_date || lotRow?.expiry_date || "");
  const manufactureDate =
    input.manufacture_date ?? (inspectionRow?.manufacture_date ? String(inspectionRow.manufacture_date) : null);
  const supplierName = String(input.supplier_name || inspectionRow?.supplier_name || lotRow?.supplier || "Approved Supplier");
  const receivingLocation = String(input.receiving_location || inspectionRow?.receiving_location || lotRow?.location || "RCV-STAGE-01");
  const expectedWeightKg = roundDec(eligibleQty * profile.caseWeightKg, 3);
  const actualWeightKg =
    input.actual_weight_kg !== undefined && input.actual_weight_kg !== null
      ? roundDec(Number(input.actual_weight_kg), 3)
      : inspectionRow?.actual_weight_kg !== null && inspectionRow?.actual_weight_kg !== undefined
        ? roundDec(Number(inspectionRow.actual_weight_kg), 3)
        : expectedWeightKg;

  const tempReadingC =
    input.temp_reading_c !== undefined && input.temp_reading_c !== null
      ? Number(input.temp_reading_c)
      : inspectionRow?.temp_reading_c !== null && inspectionRow?.temp_reading_c !== undefined
        ? Number(inspectionRow.temp_reading_c)
        : lotRow?.temp_c !== undefined
          ? Number(lotRow.temp_c)
          : profile.minTempC;

  const tempStatus: PutawayTask["temp_status"] =
    tempReadingC !== null && (tempReadingC < profile.minTempC || tempReadingC > profile.maxTempC)
      ? "excursion"
      : "in_range";

  // Run intelligent storage recommendation engine
  const candidates = computeBinRecommendations(warehouse, sku, eligibleQty, profile.caseWeightKg);
  const bestCandidate = candidates.find((c) => c.eligible) ?? null;

  const initialStatus: PutawayTaskStatus = bestCandidate
    ? input.assigned_operator_name
      ? "Assigned"
      : "Ready for Put-away"
    : "Pending Recommendation";

  const id = `PUT-ID-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;
  const taskNumber = `PUT-2026-${Math.floor(1000 + Math.random() * 8999)}`;
  const now = new Date().toISOString();

  withTransaction(() => {
    db.prepare(
      `INSERT INTO putaway_tasks (
        id, task_number, inspection_id, shipment_id, shipment_reference, asn_reference,
        purchase_order_id, supplier_id, supplier_name, sku, product_name, category,
        supplier_batch, internal_lot, manufacture_date, expiry_date,
        warehouse, receiving_location, uom,
        total_eligible_qty, placed_qty, remaining_qty,
        expected_weight_kg, actual_weight_kg, placed_weight_kg, packages,
        temp_reading_c, temp_min_c, temp_max_c, temp_status, quality_status,
        recommended_zone_code, recommended_bin_code, recommendation_reason, recommendation_score,
        assigned_bin_code, assigned_operator_id, assigned_operator_name,
        priority, status, status_changed_by, status_changed_at, notes, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, 0, ?,
        ?, ?, 0, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?
      )`
    ).run(
      id,
      taskNumber,
      inspectionRow?.id ? String(inspectionRow.id) : input.inspection_id ?? null,
      inspectionRow?.shipment_id ? String(inspectionRow.shipment_id) : input.shipment_id ?? null,
      inspectionRow?.shipment_reference ? String(inspectionRow.shipment_reference) : input.shipment_reference ?? null,
      inspectionRow?.asn_reference ? String(inspectionRow.asn_reference) : input.asn_reference ?? null,
      inspectionRow?.purchase_order_id ? String(inspectionRow.purchase_order_id) : input.purchase_order_id ?? null,
      inspectionRow?.supplier_id ? String(inspectionRow.supplier_id) : input.supplier_id ?? null,
      supplierName,
      profile.sku,
      input.product_name || profile.name,
      profile.category,
      supplierBatch,
      internalLot,
      manufactureDate,
      expiryDate,
      warehouse,
      receivingLocation,
      input.uom || "case",
      eligibleQty,
      eligibleQty,
      expectedWeightKg,
      actualWeightKg,
      input.packages ?? Math.ceil(eligibleQty),
      tempReadingC,
      profile.minTempC,
      profile.maxTempC,
      tempStatus,
      inspectionRow?.status === "partially_released" ? "partially_released" : "released",
      bestCandidate?.bin.zone_code ?? null,
      bestCandidate?.bin.code ?? null,
      bestCandidate?.reason ?? "No eligible active bin with sufficient capacity found; awaiting manager bin assignment.",
      bestCandidate?.score ?? 0,
      bestCandidate?.bin.code ?? null,
      input.assigned_operator_id ?? null,
      input.assigned_operator_name ?? "Pietro Rossi",
      input.priority || (profile.storageType === "frozen" || profile.storageType === "chilled" ? "high" : "normal"),
      initialStatus,
      actor.name,
      now,
      input.notes ?? null,
      now,
      now
    );

    recordAuditEvent({
      actor,
      action: "putaway.task_created",
      entityType: "PutawayTask",
      entityId: id,
      after: {
        task_number: taskNumber,
        internal_lot: internalLot,
        sku: profile.sku,
        total_eligible_qty: eligibleQty,
        recommended_bin_code: bestCandidate?.bin.code ?? null,
        recommendation_reason: bestCandidate?.reason ?? null,
        status: initialStatus
      }
    });
  });

  return getPutawayTaskDetail(actor, id);
}

export function assignOrUpdatePutawayTask(
  actor: AuthenticatedUser,
  idOrNumber: string,
  input: {
    status?: PutawayTaskStatus;
    assigned_operator_id?: string | null;
    assigned_operator_name?: string | null;
    priority?: "urgent" | "high" | "normal" | "low";
    notes?: string | null;
    reason?: string | null;
  }
): PutawayTaskDetail {
  if (!hasPermission(actor, "putaway.execute") && !hasPermission(actor, "putaway.manage")) {
    throw new ApiError(403, "FORBIDDEN_INSUFFICIENT_ROLE", `Role '${actor.role}' is not authorized to update put-away tasks.`);
  }
  requireMutationAuthorization(actor, "update put-away task");

  const existing = getPutawayTaskDetail(actor, idOrNumber);
  if (existing.status === "Completed" && input.status && input.status !== "Completed") {
    throw new ApiError(409, "TASK_ALREADY_COMPLETED", "Completed put-away tasks cannot be reopened or modified.");
  }

  // Reassigning operator or cancelling requires manager permission
  if (
    (input.status === "Cancelled" ||
      (input.assigned_operator_name && input.assigned_operator_name !== existing.assigned_operator_name && actor.role === "picker")) &&
    !hasPermission(actor, "putaway.manage")
  ) {
    throw new ApiError(403, "FORBIDDEN_PUTAWAY_MANAGE", "Only warehouse managers can reassign or cancel put-away tasks.");
  }

  const nextStatus = input.status ?? existing.status;
  const nextOperator =
    input.assigned_operator_name !== undefined ? input.assigned_operator_name : existing.assigned_operator_name;
  const nextPriority = input.priority ?? existing.priority;
  const now = new Date().toISOString();

  const db = getDb();
  db.prepare(
    `UPDATE putaway_tasks
     SET status = ?,
         assigned_operator_id = ?,
         assigned_operator_name = ?,
         priority = ?,
         notes = ?,
         status_changed_by = ?,
         status_changed_at = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(
    nextStatus,
    input.assigned_operator_id !== undefined ? input.assigned_operator_id : existing.assigned_operator_id,
    nextOperator,
    nextPriority,
    input.notes !== undefined ? input.notes : existing.notes,
    actor.name,
    now,
    now,
    existing.id
  );

  recordAuditEvent({
    actor,
    action: `putaway.task_${nextStatus.toLowerCase().replace(/\s+/g, "_")}`,
    entityType: "PutawayTask",
    entityId: existing.id,
    before: { status: existing.status, assigned_operator_name: existing.assigned_operator_name },
    after: {
      status: nextStatus,
      assigned_operator_name: nextOperator,
      reason: input.reason ?? null
    }
  });

  return getPutawayTaskDetail(actor, existing.id);
}

export function overrideStorageRecommendation(
  actor: AuthenticatedUser,
  idOrNumber: string,
  input: {
    target_bin_code: string;
    override_reason: string;
  }
): PutawayTaskDetail {
  if (!hasPermission(actor, "putaway.override")) {
    throw new ApiError(
      403,
      "FORBIDDEN_PUTAWAY_OVERRIDE",
      `Role '${actor.role}' (${actor.email}) is not authorized to override storage recommendations. Warehouse Manager permission ('putaway.override') is required.`
    );
  }
  requireMutationAuthorization(actor, "override put-away storage recommendation");

  const reason = (input.override_reason || "").trim();
  if (!reason || reason.length < 3) {
    throw new ApiError(
      400,
      "OVERRIDE_REASON_REQUIRED",
      "A documented override_reason is mandatory when overriding a storage recommendation."
    );
  }

  const task = getPutawayTaskDetail(actor, idOrNumber);
  const targetBinCode = (input.target_bin_code || "").trim().toUpperCase();
  if (!targetBinCode) {
    throw new ApiError(400, "VALIDATION_ERROR", "target_bin_code is required.");
  }

  const candidate = task.recommendations.find((c) => c.bin.code.toUpperCase() === targetBinCode);
  if (!candidate) {
    throw new ApiError(
      404,
      "BIN_NOT_FOUND_IN_WAREHOUSE",
      `Bin '${targetBinCode}' does not exist in warehouse '${task.warehouse}'.`
    );
  }

  // Even on manager override, never allow placing into temperature-incompatible, blocked, full, or cross-contaminated bins!
  if (!candidate.eligible) {
    throw new ApiError(
      409,
      "INCOMPATIBLE_STORAGE_BIN",
      `Cannot assign bin '${targetBinCode}': ${candidate.disqualify_reasons.join(" ")}`
    );
  }

  const now = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `UPDATE putaway_tasks
     SET assigned_bin_code = ?,
         override_reason = ?,
         overridden_by = ?,
         overridden_at = ?,
         scan_bin_verified = 0,
         updated_at = ?
     WHERE id = ?`
  ).run(candidate.bin.code, reason, actor.name, now, now, task.id);

  recordAuditEvent({
    actor,
    action: "putaway.recommendation_overridden",
    entityType: "PutawayTask",
    entityId: task.id,
    before: {
      recommended_bin_code: task.recommended_bin_code,
      assigned_bin_code: task.assigned_bin_code
    },
    after: {
      assigned_bin_code: candidate.bin.code,
      override_reason: reason,
      overridden_by: actor.name
    }
  });

  return getPutawayTaskDetail(actor, task.id);
}

export function verifyPutawayScan(
  actor: AuthenticatedUser,
  idOrNumber: string,
  input: {
    scan_step: "task" | "sku" | "lot" | "bin";
    scanned_value: string;
    scan_mode?: "scanner" | "manual";
  }
): {
  valid: boolean;
  scan_step: "task" | "sku" | "lot" | "bin";
  scanned_value: string;
  expected_value: string;
  message: string;
  task: PutawayTaskDetail;
} {
  assertPermission(actor, "putaway.execute");
  requireMutationAuthorization(actor, "verify put-away barcode scan");

  const task = getPutawayTaskDetail(actor, idOrNumber);
  const rawScan = (input.scanned_value || "").trim();
  const scanMode = input.scan_mode || "scanner";

  if (!rawScan) {
    throw new ApiError(400, "EMPTY_SCAN_VALUE", "Scanned barcode or manual identifier cannot be empty.");
  }

  const db = getDb();
  const norm = rawScan.toUpperCase();
  let valid = false;
  let expectedValue = "";
  let failureReason: string | null = null;

  // Verify lot quality status first
  const lotRow = db
    .prepare(`SELECT quality_status FROM inventory_lots WHERE upper(batch_id) = upper(?)`)
    .get(task.internal_lot) as { quality_status: string } | undefined;

  if (lotRow && lotRow.quality_status !== "released") {
    failureReason = `Lot '${task.internal_lot}' quality status is '${lotRow.quality_status}' (not QA-released).`;
  } else if (input.scan_step === "task") {
    expectedValue = task.task_number;
    valid = norm === task.task_number.toUpperCase() || norm === task.id.toUpperCase() || norm.includes(task.task_number.toUpperCase());
    if (!valid) {
      failureReason = `Scanned task code '${rawScan}' does not match assigned task '${task.task_number}'.`;
    }
  } else if (input.scan_step === "sku") {
    expectedValue = task.sku;
    valid = norm === task.sku.toUpperCase() || norm.includes(task.sku.toUpperCase());
    if (!valid) {
      failureReason = `Scanned product/SKU '${rawScan}' does not match expected SKU '${task.sku}' (${task.product_name}).`;
    }
  } else if (input.scan_step === "lot") {
    expectedValue = `${task.internal_lot} / ${task.supplier_batch}`;
    valid =
      norm === task.internal_lot.toUpperCase() ||
      norm === task.supplier_batch.toUpperCase() ||
      norm.includes(task.internal_lot.toUpperCase());
    if (!valid) {
      failureReason = `Scanned batch/lot '${rawScan}' does not match internal lot '${task.internal_lot}' or supplier batch '${task.supplier_batch}'.`;
    }
  } else if (input.scan_step === "bin") {
    const cleanBin = norm.replace(/^BIN:/i, "");
    const targetBin = (task.assigned_bin_code || task.recommended_bin_code || "").toUpperCase();
    expectedValue = targetBin || "Eligible active bin";

    const candidate = task.recommendations.find(
      (c) => c.bin.code.toUpperCase() === cleanBin || c.bin.barcode.toUpperCase() === norm
    );

    if (!candidate) {
      valid = false;
      failureReason = `Scanned bin '${rawScan}' does not belong to warehouse '${task.warehouse}'.`;
    } else if (!candidate.eligible) {
      valid = false;
      failureReason = `Scanned bin '${candidate.bin.code}' is incompatible or unavailable: ${candidate.disqualify_reasons.join(" ")}`;
    } else if (targetBin && candidate.bin.code.toUpperCase() !== targetBin) {
      // If scanning a different eligible bin during multi-bin split, allow it if compatible
      valid = true;
    } else {
      valid = true;
    }
  }

  const now = new Date().toISOString();
  const scanId = `PSL-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;

  withTransaction(() => {
    db.prepare(
      `INSERT INTO putaway_scan_logs (
        id, task_id, scan_step, scanned_value, expected_value, scan_mode, valid, failure_reason, scanned_by, scanned_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      scanId,
      task.id,
      input.scan_step,
      rawScan,
      expectedValue,
      scanMode,
      valid ? 1 : 0,
      failureReason,
      actor.name,
      now
    );

    if (valid) {
      const col =
        input.scan_step === "task"
          ? "scan_task_verified"
          : input.scan_step === "sku"
            ? "scan_sku_verified"
            : input.scan_step === "lot"
              ? "scan_lot_verified"
              : "scan_bin_verified";

      db.prepare(
        `UPDATE putaway_tasks
         SET ${col} = 1,
             status = CASE WHEN status IN ('Ready for Put-away', 'Assigned') THEN 'In Progress' ELSE status END,
             updated_at = ?
         WHERE id = ?`
      ).run(now, task.id);
    }

    recordAuditEvent({
      actor,
      action: valid ? `putaway.scan_${input.scan_step}_verified` : `putaway.scan_${input.scan_step}_failed`,
      entityType: "PutawayTask",
      entityId: task.id,
      after: {
        scan_step: input.scan_step,
        scanned_value: rawScan,
        expected_value: expectedValue,
        scan_mode: scanMode,
        valid,
        failure_reason: failureReason
      }
    });
  });

  if (!valid) {
    throw new ApiError(400, "BARCODE_SCAN_MISMATCH", failureReason || "Barcode verification failed.");
  }

  return {
    valid: true,
    scan_step: input.scan_step,
    scanned_value: rawScan,
    expected_value: expectedValue,
    message: `Verified ${input.scan_step.toUpperCase()} scan (${rawScan}) for task ${task.task_number}.`,
    task: getPutawayTaskDetail(actor, task.id)
  };
}

export function confirmPutawayPlacement(
  actor: AuthenticatedUser,
  idOrNumber: string,
  input: {
    to_bin_code: string;
    placed_qty: number;
    actual_weight_kg?: number | null;
    packages?: number;
    temp_c?: number | null;
    scan_method?: "barcode_scan" | "manual_fallback";
    discrepancy_notes?: string | null;
  }
): {
  placement: PutawayPlacement;
  task: PutawayTaskDetail;
} {
  assertPermission(actor, "putaway.execute");
  requireMutationAuthorization(actor, "confirm put-away stock placement");

  const db = getDb();
  const task = getPutawayTaskDetail(actor, idOrNumber);
  requireWarehouseAccess(actor, task.warehouse);

  if (task.status === "Completed") {
    throw new ApiError(409, "TASK_ALREADY_COMPLETED", `Put-away task '${task.task_number}' is already completed.`);
  }
  if (task.status === "Cancelled" || task.status === "Blocked") {
    throw new ApiError(
      409,
      "TASK_NOT_EXECUTABLE",
      `Cannot place stock for put-away task '${task.task_number}' while its status is '${task.status}'.`
    );
  }

  const placedQty = roundDec(Number(input.placed_qty), 3);
  if (!Number.isFinite(placedQty) || placedQty <= 0) {
    throw new ApiError(400, "INVALID_PLACED_QTY", "placed_qty must be a positive number.");
  }

  if (placedQty > task.remaining_qty + 0.0001) {
    throw new ApiError(
      400,
      "PLACED_QTY_EXCEEDS_REMAINING",
      `Placed quantity (${placedQty}) cannot exceed remaining task quantity (${task.remaining_qty}).`
    );
  }

  const cleanBinCode = (input.to_bin_code || "").trim().replace(/^BIN:/i, "").toUpperCase();
  if (!cleanBinCode) {
    throw new ApiError(400, "VALIDATION_ERROR", "to_bin_code is required.");
  }

  const profile = getProductStorageProfile(task.sku);
  const expectedWeightForPlacement = roundDec(placedQty * profile.caseWeightKg, 3);
  const actualWeightKg =
    input.actual_weight_kg !== undefined && input.actual_weight_kg !== null && input.actual_weight_kg !== ("" as unknown as number)
      ? roundDec(Number(input.actual_weight_kg), 3)
      : expectedWeightForPlacement;

  if (actualWeightKg <= 0) {
    throw new ApiError(400, "INVALID_WEIGHT", "actual_weight_kg must be greater than zero.");
  }

  const weightVarianceKg = roundDec(actualWeightKg - expectedWeightForPlacement, 3);
  const weightVariancePct =
    expectedWeightForPlacement > 0
      ? roundDec(((actualWeightKg - expectedWeightForPlacement) / expectedWeightForPlacement) * 100, 2)
      : 0;

  const tempC =
    input.temp_c !== undefined && input.temp_c !== null && input.temp_c !== ("" as unknown as number)
      ? Number(input.temp_c)
      : task.temp_reading_c;

  const now = new Date().toISOString();

  // Check temperature excursion at put-away BEFORE allowing placement
  if (tempC !== null && Number.isFinite(tempC) && (tempC < profile.minTempC || tempC > profile.maxTempC)) {
    const excId = `QEX-PUT-${Date.now()}`;
    const excNum = `EXC-2026-${Math.floor(1000 + Math.random() * 8999)}`;

    withTransaction(() => {
      // 1. Block the put-away task
      db.prepare(
        `UPDATE putaway_tasks
         SET status = 'Blocked',
             temp_reading_c = ?,
             temp_status = 'excursion',
             status_changed_by = ?,
             status_changed_at = ?,
             notes = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(
        tempC,
        actor.name,
        now,
        `Blocked at put-away due to temperature excursion (${tempC}°C vs allowed ${profile.minTempC}..${profile.maxTempC}°C).`,
        now,
        task.id
      );

      // 2. Place the lot on QA Hold in inventory_lots so it cannot be allocated or picked
      db.prepare(
        `UPDATE inventory_lots
         SET quality_status = 'on_hold',
             held_cases = quantity_cases,
             quantity_cases = 0,
             temp_c = ?,
             quality_decision_reason = ?,
             updated_at = ?
         WHERE upper(batch_id) = upper(?)`
      ).run(
        tempC,
        `Blocked on QA Hold due to put-away temperature excursion (${tempC}°C).`,
        now,
        task.internal_lot
      );

      // 3. Create linked Quality Exception in Module 04
      db.prepare(
        `INSERT INTO quality_exceptions (
          id, exception_number, inspection_id, shipment_id, shipment_reference,
          supplier_id, supplier_name, sku, product_name, internal_lot,
          warehouse, location, exception_type, severity,
          expected_limits, actual_reading, food_safety_impact, responsible_person,
          evidence_json, status, detected_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'temperature_excursion', 'critical', ?, ?, ?, ?, '[]', 'open', ?, ?, ?)`
      ).run(
        excId,
        excNum,
        task.inspection_id,
        task.shipment_id,
        task.shipment_reference,
        task.supplier_id,
        task.supplier_name,
        task.sku,
        task.product_name,
        task.internal_lot,
        task.warehouse,
        task.receiving_location,
        `${profile.minTempC}°C to ${profile.maxTempC}°C`,
        `${tempC}°C`,
        `Put-away temperature excursion (${tempC}°C) detected before bin placement. Task ${task.task_number} blocked and lot ${task.internal_lot} placed on QA Hold.`,
        actor.name,
        now,
        now,
        now
      );

      recordAuditEvent({
        actor,
        action: "putaway.temperature_excursion_blocked",
        entityType: "PutawayTask",
        entityId: task.id,
        after: {
          temp_c: tempC,
          expected_range: `${profile.minTempC}..${profile.maxTempC}°C`,
          exception_number: excNum,
          internal_lot: task.internal_lot
        }
      });
    });

    throw new ApiError(
      409,
      "PUTAWAY_TEMPERATURE_EXCURSION",
      `Temperature excursion detected at put-away (${tempC}°C exceeds product range ${profile.minTempC}°C to ${profile.maxTempC}°C). Placement blocked, lot '${task.internal_lot}' placed on QA Hold, and Quality Exception ${excNum} created.`
    );
  }

  let placementId = "";

  // Execute bin validation, capacity check, and stock movement atomically inside an immediate transaction
  withTransaction(() => {
    // 1. Re-verify lot quality status inside transaction (never turn held/rejected/quarantined stock into available stock)
    const lotRow = db
      .prepare(`SELECT * FROM inventory_lots WHERE upper(batch_id) = upper(?)`)
      .get(task.internal_lot) as
      | {
          id: string;
          batch_id: string;
          quality_status: string;
          quantity_cases: number;
          warehouse: string;
          location: string;
        }
      | undefined;

    if (!lotRow || lotRow.quality_status !== "released") {
      throw new ApiError(
        409,
        "LOT_QUALITY_BLOCKED",
        `Cannot place lot '${task.internal_lot}' into available storage because its quality status is '${lotRow?.quality_status || "missing"}' (not QA-released).`
      );
    }

    // 2. Re-read bin inside transaction to prevent concurrent overfilling
    const binRow = db
      .prepare(`SELECT * FROM warehouse_bins WHERE upper(code) = ? AND lower(warehouse) = lower(?)`)
      .get(cleanBinCode, task.warehouse) as Record<string, unknown> | undefined;

    if (!binRow) {
      throw new ApiError(
        404,
        "BIN_NOT_FOUND",
        `Destination bin '${cleanBinCode}' was not found in warehouse '${task.warehouse}'.`
      );
    }

    const bin = hydrateBin(binRow);
    if (bin.status !== "active" || bin.storage_type === "quarantine") {
      throw new ApiError(
        409,
        "BIN_NOT_ACTIVE",
        `Destination bin '${bin.code}' has status '${bin.status}' (${bin.storage_type}) and cannot receive available stock.`
      );
    }

    // 3. Validate temperature & category/segregation compatibility
    if (bin.storage_type !== profile.storageType || bin.min_temp_c > profile.maxTempC || bin.max_temp_c < profile.minTempC) {
      throw new ApiError(
        409,
        "TEMPERATURE_INCOMPATIBLE_BIN",
        `Bin '${bin.code}' (${bin.storage_type}, ${bin.min_temp_c}..${bin.max_temp_c}°C) is incompatible with product '${task.sku}' (${profile.storageType}, ${profile.minTempC}..${profile.maxTempC}°C).`
      );
    }

    const catAllowed =
      bin.allowed_categories.length === 0 ||
      bin.allowed_categories.some(
        (c) =>
          c.toLowerCase() === "all" ||
          c.toLowerCase() === profile.category.toLowerCase() ||
          (c.toLowerCase() === "chilled" && profile.storageType === "chilled")
      );
    if (!catAllowed) {
      throw new ApiError(
        409,
        "INCOMPATIBLE_PRODUCT_CATEGORY",
        `Bin '${bin.code}' only allows categories [${bin.allowed_categories.join(", ")}], rejecting '${profile.category}'.`
      );
    }

    const allergenConflict = profile.allergens.filter((alg) =>
      bin.restricted_allergens.some((r) => r.toLowerCase() === alg.toLowerCase())
    );
    if (allergenConflict.length > 0) {
      throw new ApiError(
        409,
        "ALLERGEN_SEGREGATION_VIOLATION",
        `Bin '${bin.code}' restricts allergen(s) [${allergenConflict.join(", ")}] present in '${task.sku}'.`
      );
    }

    // 4. Validate available case & weight capacity inside transaction
    if (placedQty > bin.available_cases + 0.0001) {
      throw new ApiError(
        409,
        "BIN_CAPACITY_EXCEEDED",
        `Bin '${bin.code}' only has ${bin.available_cases} cases of available capacity (attempted to place ${placedQty} cases).`
      );
    }
    if (actualWeightKg > bin.available_weight_kg + 0.01) {
      throw new ApiError(
        409,
        "BIN_WEIGHT_CAPACITY_EXCEEDED",
        `Bin '${bin.code}' only has ${bin.available_weight_kg} kg of available weight capacity (attempted to place ${actualWeightKg} kg).`
      );
    }

    // 5. Update warehouse_bins occupancy
    const newBinCases = roundDec(bin.current_cases + placedQty, 3);
    const newBinWeight = roundDec(bin.current_weight_kg + actualWeightKg, 3);
    db.prepare(
      `UPDATE warehouse_bins
       SET current_cases = ?,
           current_weight_kg = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(newBinCases, newBinWeight, now, bin.id);

    // 6. Upsert bin_stock_placements (supports splitting one lot across multiple bins)
    const existingBinLot = db
      .prepare(`SELECT * FROM bin_stock_placements WHERE upper(bin_code) = ? AND upper(internal_lot) = upper(?)`)
      .get(bin.code, task.internal_lot) as Record<string, unknown> | undefined;

    const packagesCount = input.packages !== undefined ? Number(input.packages) : Math.ceil(placedQty);

    if (existingBinLot) {
      db.prepare(
        `UPDATE bin_stock_placements
         SET quantity_cases = ?,
             weight_kg = ?,
             packages = ?,
             temp_at_placement_c = COALESCE(?, temp_at_placement_c),
             placed_by = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(
        roundDec(Number(existingBinLot.quantity_cases) + placedQty, 3),
        roundDec(Number(existingBinLot.weight_kg) + actualWeightKg, 3),
        Number(existingBinLot.packages || 0) + packagesCount,
        tempC,
        actor.name,
        now,
        String(existingBinLot.id)
      );
    } else {
      db.prepare(
        `INSERT INTO bin_stock_placements (
          id, bin_id, bin_code, warehouse, zone_code, internal_lot, supplier_batch,
          sku, product_name, category, quantity_cases, uom, weight_kg, packages,
          manufacture_date, expiry_date, quality_status, temp_at_placement_c,
          placed_by, placed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'released', ?, ?, ?, ?)`
      ).run(
        `BSP-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`,
        bin.id,
        bin.code,
        task.warehouse,
        bin.zone_code,
        task.internal_lot,
        task.supplier_batch,
        task.sku,
        task.product_name,
        task.category,
        placedQty,
        task.uom,
        actualWeightKg,
        packagesCount,
        task.manufacture_date,
        task.expiry_date,
        tempC,
        actor.name,
        now,
        now
      );
    }

    // 7. Record stock_movements with source and destination locations
    const movementId = `MOV-PUT-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;
    db.prepare(
      `INSERT INTO stock_movements (
        id, batch_id, sku, movement_type, quantity_delta, previous_cases, new_cases,
        reason, actor_email, source_location, destination_location, created_at
      ) VALUES (?, ?, ?, 'putaway', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      movementId,
      task.internal_lot,
      task.sku,
      placedQty,
      lotRow.quantity_cases,
      lotRow.quantity_cases,
      `Put-away ${task.task_number}: ${placedQty} ${task.uom} (${actualWeightKg} kg) moved from ${task.receiving_location} to ${bin.code}`,
      actor.email,
      task.receiving_location,
      bin.code,
      now
    );

    // 8. Update inventory_lots location to reflect placed bin(s) while preserving released quality_status
    const allLotBins = db
      .prepare(`SELECT bin_code FROM bin_stock_placements WHERE upper(internal_lot) = upper(?) AND quantity_cases > 0 ORDER BY bin_code ASC`)
      .all(task.internal_lot) as Array<{ bin_code: string }>;
    const combinedLocations = allLotBins.map((b) => b.bin_code).join(", ") || bin.code;

    db.prepare(
      `UPDATE inventory_lots
       SET location = ?,
           zone = ?,
           temp_c = COALESCE(?, temp_c),
           updated_at = ?
       WHERE id = ?`
    ).run(combinedLocations, bin.zone_name, tempC, now, lotRow.id);

    // 9. Update putaway_tasks quantities and status
    const newPlacedQty = roundDec(task.placed_qty + placedQty, 3);
    const newRemainingQty = Math.max(0, roundDec(task.total_eligible_qty - newPlacedQty, 3));
    const newPlacedWeight = roundDec(task.placed_weight_kg + actualWeightKg, 3);
    const nextTaskStatus: PutawayTaskStatus =
      newRemainingQty <= 0.0001 ? "Completed" : "Partially Completed";

    db.prepare(
      `UPDATE putaway_tasks
       SET placed_qty = ?,
           remaining_qty = ?,
           placed_weight_kg = ?,
           assigned_bin_code = ?,
           status = ?,
           status_changed_by = ?,
           status_changed_at = ?,
           completed_at = CASE WHEN ? = 'Completed' THEN ? ELSE completed_at END,
           updated_at = ?
       WHERE id = ?`
    ).run(
      newPlacedQty,
      newRemainingQty,
      newPlacedWeight,
      bin.code,
      nextTaskStatus,
      actor.name,
      now,
      nextTaskStatus,
      now,
      now,
      task.id
    );

    // 10. Insert putaway_placements record
    placementId = `PLC-ID-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;
    const placementNumber = `PLC-2026-${Math.floor(1000 + Math.random() * 8999)}`;
    const scanMethod =
      input.scan_method ||
      (task.scan_task_verified && task.scan_sku_verified && task.scan_lot_verified && task.scan_bin_verified
        ? "barcode_scan"
        : "manual_fallback");

    db.prepare(
      `INSERT INTO putaway_placements (
        id, placement_number, task_id, task_number, internal_lot, supplier_batch,
        sku, product_name, warehouse, from_location, to_zone_code, to_bin_code,
        expected_qty, placed_qty, remaining_qty_after, uom, packages,
        expected_weight_kg, actual_weight_kg, weight_variance_kg, weight_variance_pct,
        discrepancy_notes, temp_c, temp_status, scan_method, movement_id,
        operator_id, operator_name, placed_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, 'in_range', ?, ?,
        ?, ?, ?
      )`
    ).run(
      placementId,
      placementNumber,
      task.id,
      task.task_number,
      task.internal_lot,
      task.supplier_batch,
      task.sku,
      task.product_name,
      task.warehouse,
      task.receiving_location,
      bin.zone_code,
      bin.code,
      task.remaining_qty,
      placedQty,
      newRemainingQty,
      task.uom,
      packagesCount,
      expectedWeightForPlacement,
      actualWeightKg,
      weightVarianceKg,
      weightVariancePct,
      input.discrepancy_notes ??
        (Math.abs(weightVariancePct) > 0.01
          ? `Weight variance ${weightVarianceKg} kg (${weightVariancePct}%) recorded at put-away.`
          : null),
      tempC,
      scanMethod,
      movementId,
      actor.id,
      actor.name,
      now
    );

    recordAuditEvent({
      actor,
      action: nextTaskStatus === "Completed" ? "putaway.placement_completed" : "putaway.placement_partial",
      entityType: "PutawayTask",
      entityId: task.id,
      before: {
        status: task.status,
        placed_qty: task.placed_qty,
        remaining_qty: task.remaining_qty
      },
      after: {
        placement_number: placementNumber,
        to_bin_code: bin.code,
        placed_qty: placedQty,
        remaining_qty_after: newRemainingQty,
        actual_weight_kg: actualWeightKg,
        weight_variance_kg: weightVarianceKg,
        temp_c: tempC,
        status: nextTaskStatus,
        movement_id: movementId
      }
    });
  });

  const placementRow = db
    .prepare(`SELECT * FROM putaway_placements WHERE id = ?`)
    .get(placementId) as Record<string, unknown>;

  return {
    placement: hydratePlacement(placementRow),
    task: getPutawayTaskDetail(actor, task.id)
  };
}

export function listPutawayHistory(
  actor: AuthenticatedUser,
  filters: {
    warehouse?: string | null;
    lot?: string | null;
    sku?: string | null;
    bin_code?: string | null;
  } = {}
): {
  placements: PutawayPlacement[];
  stock_movements: Array<{
    id: string;
    batch_id: string;
    sku: string;
    movement_type: string;
    quantity_delta: number;
    previous_cases: number;
    new_cases: number;
    source_location: string | null;
    destination_location: string | null;
    reason: string;
    actor_email: string;
    created_at: string;
  }>;
} {
  assertPermission(actor, "putaway.read");
  const db = getDb();
  const conditions: string[] = [];
  const params: string[] = [];

  const wf = buildWarehouseScopeClause(actor, filters.warehouse);
  if (wf.clause) {
    conditions.push(wf.clause);
    params.push(...wf.params);
  }
  if (filters.lot) {
    conditions.push("upper(internal_lot) = upper(?)");
    params.push(filters.lot);
  }
  if (filters.sku) {
    conditions.push("upper(sku) = upper(?)");
    params.push(filters.sku);
  }
  if (filters.bin_code) {
    conditions.push("upper(to_bin_code) = upper(?)");
    params.push(filters.bin_code);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const placementRows = db
    .prepare(`SELECT * FROM putaway_placements ${whereSql} ORDER BY placed_at DESC, id DESC LIMIT 100`)
    .all(...params) as Record<string, unknown>[];

  const movRows = db
    .prepare(
      `SELECT id, batch_id, sku, movement_type, quantity_delta, previous_cases, new_cases,
              source_location, destination_location, reason, actor_email, created_at
       FROM stock_movements
       WHERE movement_type = 'putaway'
       ORDER BY created_at DESC LIMIT 100`
    )
    .all() as Array<{
    id: string;
    batch_id: string;
    sku: string;
    movement_type: string;
    quantity_delta: number;
    previous_cases: number;
    new_cases: number;
    source_location: string | null;
    destination_location: string | null;
    reason: string;
    actor_email: string;
    created_at: string;
  }>;

  return {
    placements: placementRows.map(hydratePlacement),
    stock_movements: movRows
  };
}
