import { getDb, withTransaction } from "@/server/db/connection";
import { ApiError } from "@/server/core/http";
import { createPutawayTask } from "@/server/services/putaway.service";
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
  CapaStatus,
  CheckResultStatus,
  EvidenceItem,
  HaccpCheckpointReading,
  HaccpCheckpointTemplate,
  InspectionStatus,
  QualityCapa,
  QualityDashboardMetrics,
  QualityException,
  QualityHistorySummary,
  QualityInspection,
  QualityInspectionDetail
} from "@/lib/quality-gate";

function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hydrateInspection(row: Record<string, unknown>): QualityInspection {
  return {
    id: String(row.id),
    inspection_number: String(row.inspection_number),
    shipment_id: row.shipment_id ? String(row.shipment_id) : null,
    shipment_reference: row.shipment_reference ? String(row.shipment_reference) : null,
    asn_reference: row.asn_reference ? String(row.asn_reference) : null,
    purchase_order_id: row.purchase_order_id ? String(row.purchase_order_id) : null,
    supplier_id: row.supplier_id ? String(row.supplier_id) : null,
    supplier_name: String(row.supplier_name || ""),
    product_id: row.product_id ? String(row.product_id) : null,
    sku: String(row.sku),
    product_name: String(row.product_name),
    supplier_batch: String(row.supplier_batch),
    internal_lot: String(row.internal_lot),
    warehouse: String(row.warehouse),
    receiving_location: String(row.receiving_location || "RCV-STAGE-01"),
    uom: String(row.uom || "case"),
    received_qty: Number(row.received_qty || 0),
    accepted_qty: Number(row.accepted_qty || 0),
    held_qty: Number(row.held_qty || 0),
    rejected_qty: Number(row.rejected_qty || 0),
    quarantined_qty: Number(row.quarantined_qty || 0),
    expected_weight_kg: row.expected_weight_kg !== null && row.expected_weight_kg !== undefined ? Number(row.expected_weight_kg) : null,
    actual_weight_kg: row.actual_weight_kg !== null && row.actual_weight_kg !== undefined ? Number(row.actual_weight_kg) : null,
    weight_verified: Number(row.weight_verified || 0),
    quantity_verified: Number(row.quantity_verified || 0),
    manufacture_date: row.manufacture_date ? String(row.manufacture_date) : null,
    expiry_date: String(row.expiry_date),
    visual_inspection: (row.visual_inspection as CheckResultStatus) || "pending",
    packaging_condition: (row.packaging_condition as CheckResultStatus) || "pending",
    product_condition: (row.product_condition as CheckResultStatus) || "pending",
    freshness_status: (row.freshness_status as CheckResultStatus) || "pending",
    labelling_status: (row.labelling_status as CheckResultStatus) || "pending",
    traceability_verified: Number(row.traceability_verified || 0),
    temp_reading_c: row.temp_reading_c !== null && row.temp_reading_c !== undefined ? Number(row.temp_reading_c) : null,
    temp_min_c: row.temp_min_c !== null && row.temp_min_c !== undefined ? Number(row.temp_min_c) : null,
    temp_max_c: row.temp_max_c !== null && row.temp_max_c !== undefined ? Number(row.temp_max_c) : null,
    temp_status: (row.temp_status as CheckResultStatus) || "pending",
    certificates_verified: Number(row.certificates_verified || 0),
    required_certificates: parseJsonArray<string>(row.required_certificates_json as string),
    evidence: parseJsonArray<EvidenceItem>(row.evidence_json as string),
    notes: row.notes ? String(row.notes) : null,
    status: (row.status as InspectionStatus) || "pending",
    decision_reason: row.decision_reason ? String(row.decision_reason) : null,
    inspector_id: row.inspector_id ? String(row.inspector_id) : null,
    inspector_name: row.inspector_name ? String(row.inspector_name) : null,
    inspected_at: row.inspected_at ? String(row.inspected_at) : null,
    decided_by_id: row.decided_by_id ? String(row.decided_by_id) : null,
    decided_by_name: row.decided_by_name ? String(row.decided_by_name) : null,
    decided_at: row.decided_at ? String(row.decided_at) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

function hydrateHaccpReading(row: Record<string, unknown>): HaccpCheckpointReading {
  return {
    id: String(row.id),
    inspection_id: String(row.inspection_id),
    shipment_id: row.shipment_id ? String(row.shipment_id) : null,
    template_id: row.template_id ? String(row.template_id) : null,
    checkpoint_code: String(row.checkpoint_code),
    checkpoint_name: String(row.checkpoint_name),
    description: row.description ? String(row.description) : null,
    ccp_classification: String(row.ccp_classification),
    is_ccp: Number(row.is_ccp ?? 1),
    sku: String(row.sku),
    internal_lot: String(row.internal_lot),
    min_limit: row.min_limit !== null && row.min_limit !== undefined ? Number(row.min_limit) : null,
    max_limit: row.max_limit !== null && row.max_limit !== undefined ? Number(row.max_limit) : null,
    unit: row.unit ? String(row.unit) : null,
    expected_text: row.expected_text ? String(row.expected_text) : null,
    actual_numeric: row.actual_numeric !== null && row.actual_numeric !== undefined ? Number(row.actual_numeric) : null,
    actual_text: row.actual_text ? String(row.actual_text) : null,
    status: (row.status as "pass" | "fail") || "pass",
    critical_violation: Number(row.critical_violation || 0),
    evidence: parseJsonArray<EvidenceItem>(row.evidence_json as string),
    notes: row.notes ? String(row.notes) : null,
    inspector_id: String(row.inspector_id),
    inspector_name: String(row.inspector_name),
    recorded_at: String(row.recorded_at)
  };
}

function hydrateException(row: Record<string, unknown>): QualityException {
  return {
    id: String(row.id),
    exception_number: String(row.exception_number),
    inspection_id: row.inspection_id ? String(row.inspection_id) : null,
    shipment_id: row.shipment_id ? String(row.shipment_id) : null,
    shipment_reference: row.shipment_reference ? String(row.shipment_reference) : null,
    haccp_reading_id: row.haccp_reading_id ? String(row.haccp_reading_id) : null,
    supplier_id: row.supplier_id ? String(row.supplier_id) : null,
    supplier_name: row.supplier_name ? String(row.supplier_name) : null,
    sku: String(row.sku),
    product_name: String(row.product_name),
    internal_lot: String(row.internal_lot),
    warehouse: String(row.warehouse),
    location: String(row.location),
    exception_type: row.exception_type as QualityException["exception_type"],
    severity: row.severity as QualityException["severity"],
    expected_limits: String(row.expected_limits),
    actual_reading: String(row.actual_reading),
    food_safety_impact: String(row.food_safety_impact),
    responsible_person: String(row.responsible_person),
    evidence: parseJsonArray<EvidenceItem>(row.evidence_json as string),
    investigation_notes: row.investigation_notes ? String(row.investigation_notes) : null,
    resolution: row.resolution ? String(row.resolution) : null,
    status: row.status as QualityException["status"],
    detected_at: String(row.detected_at),
    resolved_by: row.resolved_by ? String(row.resolved_by) : null,
    resolved_at: row.resolved_at ? String(row.resolved_at) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

function hydrateCapa(row: Record<string, unknown>): QualityCapa {
  const today = new Date().toISOString().slice(0, 10);
  const status = (row.status as CapaStatus) || "Open";
  const targetDate = String(row.target_completion_date || "");
  const isOverdue = Boolean(targetDate && targetDate < today && status !== "Closed" && status !== "Rejected");

  return {
    id: String(row.id),
    capa_number: String(row.capa_number),
    exception_id: row.exception_id ? String(row.exception_id) : null,
    inspection_id: row.inspection_id ? String(row.inspection_id) : null,
    shipment_id: row.shipment_id ? String(row.shipment_id) : null,
    supplier_id: row.supplier_id ? String(row.supplier_id) : null,
    supplier_name: row.supplier_name ? String(row.supplier_name) : null,
    sku: row.sku ? String(row.sku) : null,
    product_name: row.product_name ? String(row.product_name) : null,
    internal_lot: row.internal_lot ? String(row.internal_lot) : null,
    warehouse: String(row.warehouse),
    problem_description: String(row.problem_description),
    root_cause: row.root_cause ? String(row.root_cause) : null,
    containment_action: row.containment_action ? String(row.containment_action) : null,
    corrective_action: row.corrective_action ? String(row.corrective_action) : null,
    preventive_action: row.preventive_action ? String(row.preventive_action) : null,
    assigned_to_id: row.assigned_to_id ? String(row.assigned_to_id) : null,
    assigned_to_name: String(row.assigned_to_name),
    target_completion_date: targetDate,
    evidence: parseJsonArray<EvidenceItem>(row.evidence_json as string),
    verification_notes: row.verification_notes ? String(row.verification_notes) : null,
    effectiveness_review: row.effectiveness_review ? String(row.effectiveness_review) : null,
    verified_by_id: row.verified_by_id ? String(row.verified_by_id) : null,
    verified_by_name: row.verified_by_name ? String(row.verified_by_name) : null,
    verified_at: row.verified_at ? String(row.verified_at) : null,
    status,
    is_overdue: isOverdue,
    closed_at: row.closed_at ? String(row.closed_at) : null,
    created_by: String(row.created_by),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

function resolveProductTempLimits(sku: string): {
  productId: string | null;
  productName: string;
  category: string;
  tempZone: string;
  minC: number;
  maxC: number;
  unitWeightKg: number;
  origin: string;
} {
  const db = getDb();
  const prod = db
    .prepare(
      `SELECT id, name, category, origin, temp_zone, temp_min_c, temp_max_c, unit_weight_kg FROM products WHERE sku = ?`
    )
    .get(sku) as
    | {
        id: string;
        name: string;
        category: string;
        origin: string;
        temp_zone: string;
        temp_min_c?: number | null;
        temp_max_c?: number | null;
        unit_weight_kg?: number | null;
      }
    | undefined;

  if (!prod) {
    return {
      productId: null,
      productName: sku,
      category: "Chilled",
      tempZone: "Chilled (0°C to +4°C)",
      minC: 0,
      maxC: 4,
      unitWeightKg: 5,
      origin: "EU"
    };
  }

  let minC = prod.temp_min_c !== null && prod.temp_min_c !== undefined ? Number(prod.temp_min_c) : null;
  let maxC = prod.temp_max_c !== null && prod.temp_max_c !== undefined ? Number(prod.temp_max_c) : null;

  if (minC === null || maxC === null) {
    const zone = (prod.temp_zone || "").toLowerCase();
    if (zone.includes("frozen") || zone.includes("-18")) {
      minC = -25;
      maxC = -18;
    } else if (zone.includes("0°c to +2°c")) {
      minC = 0;
      maxC = 2;
    } else if (zone.includes("+2°c to +4°c")) {
      minC = 2;
      maxC = 4;
    } else if (zone.includes("+8°c to +12°c")) {
      minC = 8;
      maxC = 12;
    } else if (zone.includes("ambient") || zone.includes("+14°c")) {
      minC = 10;
      maxC = 20;
    } else {
      minC = 0;
      maxC = 4;
    }
  }

  return {
    productId: prod.id,
    productName: prod.name,
    category: prod.category || "Chilled",
    tempZone: prod.temp_zone || "Chilled (0°C to +4°C)",
    minC,
    maxC,
    unitWeightKg: Number(prod.unit_weight_kg || 5),
    origin: prod.origin || "Italy"
  };
}

function buildWarehouseFilter(actor: AuthenticatedUser, requestedWarehouse?: string | null): { clause: string; params: string[] } {
  const scopedRoles = ["warehouse_manager", "picker", "warehouse_staff", "qa", "qa_inspector", "qa_manager"];
  if (scopedRoles.includes(actor.role) && actor.warehouse && actor.warehouse !== "All") {
    if (requestedWarehouse && requestedWarehouse !== "ALL" && requestedWarehouse.toLowerCase() !== actor.warehouse.toLowerCase()) {
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

export function getQualityDashboardMetrics(actor: AuthenticatedUser, warehouse?: string | null): QualityDashboardMetrics {
  assertPermission(actor, "quality.read");
  const db = getDb();
  const wf = buildWarehouseFilter(actor, warehouse);
  const wherePrefix = wf.clause ? `WHERE ${wf.clause}` : "";
  const andPrefix = wf.clause ? `AND ${wf.clause}` : "";

  const pendingRow = db
    .prepare(`SELECT COUNT(*) as c FROM quality_inspections WHERE status = 'pending' ${andPrefix}`)
    .get(...wf.params) as { c: number };

  const lotsAgg = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN quality_status IN ('on_hold', 'hold') THEN MAX(COALESCE(held_cases, 0), quantity_cases, received_cases - quantity_cases) ELSE COALESCE(held_cases, 0) END), 0) as held_cases,
        COALESCE(SUM(CASE WHEN quality_status = 'released' THEN quantity_cases ELSE 0 END), 0) as released_cases,
        COALESCE(SUM(COALESCE(rejected_cases, 0)), 0) as rejected_cases,
        COALESCE(SUM(CASE WHEN quality_status = 'quarantine' THEN MAX(COALESCE(quarantined_cases, 0), quantity_cases) ELSE COALESCE(quarantined_cases, 0) END), 0) as quarantined_cases
      FROM inventory_lots ${wherePrefix}`
    )
    .get(...wf.params) as {
    held_cases: number;
    released_cases: number;
    rejected_cases: number;
    quarantined_cases: number;
  };

  const inspHoldRej = db
    .prepare(
      `SELECT
        COALESCE(SUM(held_qty), 0) as held_qty,
        COALESCE(SUM(accepted_qty), 0) as accepted_qty,
        COALESCE(SUM(rejected_qty), 0) as rejected_qty,
        COALESCE(SUM(quarantined_qty), 0) as quarantined_qty
      FROM quality_inspections ${wherePrefix}`
    )
    .get(...wf.params) as {
    held_qty: number;
    accepted_qty: number;
    rejected_qty: number;
    quarantined_qty: number;
  };

  const failedHaccpRow = wf.clause
    ? (db
        .prepare(
          `SELECT COUNT(*) as c FROM haccp_checkpoint_readings r
           JOIN quality_inspections i ON i.id = r.inspection_id
           WHERE r.status = 'fail' AND lower(i.warehouse) = lower(?)`
        )
        .get(...wf.params) as { c: number })
    : (db.prepare(`SELECT COUNT(*) as c FROM haccp_checkpoint_readings WHERE status = 'fail'`).get() as { c: number });

  const openExceptionsRow = db
    .prepare(`SELECT COUNT(*) as c FROM quality_exceptions WHERE status IN ('open', 'investigating', 'capa_assigned') ${andPrefix}`)
    .get(...wf.params) as { c: number };

  const today = new Date().toISOString().slice(0, 10);
  const overdueCapasRow = db
    .prepare(
      `SELECT COUNT(*) as c FROM quality_capas WHERE status NOT IN ('Closed', 'Rejected') AND target_completion_date < ? ${andPrefix}`
    )
    .get(today, ...wf.params) as { c: number };

  const openCapasRow = db
    .prepare(`SELECT COUNT(*) as c FROM quality_capas WHERE status NOT IN ('Closed', 'Rejected') ${andPrefix}`)
    .get(...wf.params) as { c: number };

  return {
    pending_inspections: Number(pendingRow?.c || 0),
    goods_on_hold_cases: Math.max(Number(lotsAgg?.held_cases || 0), Number(inspHoldRej?.held_qty || 0)),
    released_cases: Math.max(Number(lotsAgg?.released_cases || 0), Number(inspHoldRej?.accepted_qty || 0)),
    rejected_cases: Math.max(Number(lotsAgg?.rejected_cases || 0), Number(inspHoldRej?.rejected_qty || 0)),
    quarantined_cases: Math.max(Number(lotsAgg?.quarantined_cases || 0), Number(inspHoldRej?.quarantined_qty || 0)),
    failed_haccp_checkpoints: Number(failedHaccpRow?.c || 0),
    open_quality_exceptions: Number(openExceptionsRow?.c || 0),
    overdue_capas: Number(overdueCapasRow?.c || 0),
    total_capas_open: Number(openCapasRow?.c || 0)
  };
}

export function listInspections(
  actor: AuthenticatedUser,
  filters: {
    search?: string | null;
    status?: string | null;
    warehouse?: string | null;
    supplier_id?: string | null;
    sku?: string | null;
    lot?: string | null;
    page?: number;
    page_size?: number;
  } = {}
): {
  items: QualityInspection[];
  total: number;
  page: number;
  page_size: number;
  metrics: QualityDashboardMetrics;
} {
  assertPermission(actor, "quality.read");
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  const wf = buildWarehouseFilter(actor, filters.warehouse);
  if (wf.clause) {
    conditions.push(wf.clause);
    params.push(...wf.params);
  }

  if (filters.status && filters.status !== "ALL") {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters.supplier_id && filters.supplier_id !== "ALL") {
    conditions.push("(supplier_id = ? OR lower(supplier_name) LIKE ?)");
    params.push(filters.supplier_id, `%${filters.supplier_id.toLowerCase()}%`);
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
      `(lower(inspection_number) LIKE ? OR lower(internal_lot) LIKE ? OR lower(supplier_batch) LIKE ? OR lower(sku) LIKE ? OR lower(product_name) LIKE ? OR lower(supplier_name) LIKE ? OR lower(COALESCE(shipment_reference, '')) LIKE ? OR lower(COALESCE(purchase_order_id, '')) LIKE ?)`
    );
    params.push(q, q, q, q, q, q, q, q);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const page = Math.max(1, Number(filters.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(filters.page_size || 25)));
  const offset = (page - 1) * pageSize;

  const totalRow = db
    .prepare(`SELECT COUNT(*) as c FROM quality_inspections ${whereSql}`)
    .get(...(params as string[])) as { c: number };

  const rows = db
    .prepare(`SELECT * FROM quality_inspections ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...(params as string[]), pageSize, offset) as Record<string, unknown>[];

  return {
    items: rows.map(hydrateInspection),
    total: Number(totalRow?.c || 0),
    page,
    page_size: pageSize,
    metrics: getQualityDashboardMetrics(actor, filters.warehouse)
  };
}

export function getInspectionDetail(actor: AuthenticatedUser, idOrNumber: string): QualityInspectionDetail {
  assertPermission(actor, "quality.read");
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM quality_inspections WHERE id = ? OR inspection_number = ?`)
    .get(idOrNumber, idOrNumber) as Record<string, unknown> | undefined;

  if (!row) {
    throw new ApiError(404, "INSPECTION_NOT_FOUND", `Quality inspection '${idOrNumber}' was not found.`);
  }

  const inspection = hydrateInspection(row);
  requireRecordAccess(actor, { warehouse: inspection.warehouse, supplier_id: inspection.supplier_id });

  const haccpRows = db
    .prepare(`SELECT * FROM haccp_checkpoint_readings WHERE inspection_id = ? ORDER BY recorded_at ASC`)
    .all(inspection.id) as Record<string, unknown>[];

  const exceptionRows = db
    .prepare(`SELECT * FROM quality_exceptions WHERE inspection_id = ? OR internal_lot = ? ORDER BY detected_at DESC`)
    .all(inspection.id, inspection.internal_lot) as Record<string, unknown>[];

  const capaRows = db
    .prepare(`SELECT * FROM quality_capas WHERE inspection_id = ? OR internal_lot = ? ORDER BY created_at DESC`)
    .all(inspection.id, inspection.internal_lot) as Record<string, unknown>[];

  const lotRecord =
    (db.prepare(`SELECT * FROM inventory_lots WHERE batch_id = ?`).get(inspection.internal_lot) as
      | Record<string, unknown>
      | undefined) ?? null;

  const auditEvents = db
    .prepare(
      `SELECT id, action, actor_email, actor_role, before_json, after_json, created_at
       FROM audit_events
       WHERE (entity_type IN ('QualityInspection', 'InventoryLot', 'QualityException', 'QualityCapa') AND entity_id IN (?, ?))
       ORDER BY created_at DESC LIMIT 40`
    )
    .all(inspection.id, inspection.internal_lot) as QualityInspectionDetail["audit_events"];

  return {
    ...inspection,
    haccp_readings: haccpRows.map(hydrateHaccpReading),
    exceptions: exceptionRows.map(hydrateException),
    capas: capaRows.map(hydrateCapa),
    lot_record: lotRecord,
    audit_events: auditEvents
  };
}

export function createInspection(
  actor: AuthenticatedUser,
  input: {
    shipment_id?: string | null;
    shipment_reference?: string | null;
    asn_reference?: string | null;
    purchase_order_id?: string | null;
    supplier_id?: string | null;
    supplier_name?: string;
    sku: string;
    product_name?: string;
    supplier_batch: string;
    internal_lot: string;
    warehouse?: string;
    receiving_location?: string;
    uom?: string;
    received_qty: number;
    expected_weight_kg?: number | null;
    actual_weight_kg?: number | null;
    weight_verified?: boolean | number;
    quantity_verified?: boolean | number;
    manufacture_date?: string | null;
    expiry_date: string;
    visual_inspection?: CheckResultStatus;
    packaging_condition?: CheckResultStatus;
    product_condition?: CheckResultStatus;
    freshness_status?: CheckResultStatus;
    labelling_status?: CheckResultStatus;
    traceability_verified?: boolean | number;
    temp_reading_c?: number | null;
    certificates_verified?: boolean | number;
    required_certificates?: string[];
    evidence?: Partial<EvidenceItem>[];
    notes?: string | null;
  }
): QualityInspectionDetail {
  if (!hasPermission(actor, "quality.inspect") && !hasPermission(actor, "quality_checks.manage") && !hasPermission(actor, "inbound.receive")) {
    throw new ApiError(403, "FORBIDDEN_INSUFFICIENT_ROLE", `Role '${actor.role}' is not authorized to create receiving quality inspections.`);
  }
  requireMutationAuthorization(actor, "create receiving quality inspection");

  const sku = (input.sku || "").trim();
  const supplierBatch = (input.supplier_batch || "").trim();
  const internalLot = (input.internal_lot || "").trim();
  const expiryDate = (input.expiry_date || "").trim();
  const receivedQty = Number(input.received_qty);

  if (!sku || !supplierBatch || !internalLot || !expiryDate || !Number.isFinite(receivedQty) || receivedQty <= 0) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "sku, supplier_batch, internal_lot, expiry_date, and positive received_qty are required."
    );
  }

  const warehouse = (input.warehouse || actor.warehouse || "Milan Cold Hub").trim();
  requireWarehouseAccess(actor, warehouse);

  const prodLimits = resolveProductTempLimits(sku);
  const now = new Date().toISOString();
  const id = `QIN-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;
  const inspectionNumber = `QI-2026-${Math.floor(1000 + Math.random() * 8999)}`;

  const tempReading =
    input.temp_reading_c !== null && input.temp_reading_c !== undefined && input.temp_reading_c !== ("" as unknown as number)
      ? Number(input.temp_reading_c)
      : null;

  const isTempExcursion =
    tempReading !== null && Number.isFinite(tempReading) && (tempReading < prodLimits.minC || tempReading > prodLimits.maxC);

  const tempStatus: CheckResultStatus =
    tempReading === null ? "pending" : isTempExcursion ? "fail" : "pass";

  const visual = input.visual_inspection || "pending";
  const packaging = input.packaging_condition || "pending";
  const prodCond = input.product_condition || "pending";
  const freshness = input.freshness_status || "pending";
  const labelling = input.labelling_status || "pending";

  const hasFailedCheck =
    isTempExcursion ||
    visual === "fail" ||
    packaging === "fail" ||
    prodCond === "fail" ||
    freshness === "fail" ||
    labelling === "fail";

  const initialStatus: InspectionStatus = hasFailedCheck ? "on_hold" : "pending";
  const initialHeldQty = hasFailedCheck ? receivedQty : 0;

  const evidenceList: EvidenceItem[] = (input.evidence || []).map((ev, idx) => ({
    id: ev.id || `EV-${Date.now()}-${idx + 1}`,
    title: ev.title || `Receiving Evidence #${idx + 1}`,
    file_type: ev.file_type || "photo",
    file_url: ev.file_url || `/evidence/${internalLot}-${idx + 1}.jpg`,
    uploaded_by: ev.uploaded_by || actor.name,
    uploaded_at: ev.uploaded_at || now,
    notes: ev.notes ?? null
  }));

  withTransaction(() => {
    const db = getDb();
    db.prepare(
      `INSERT INTO quality_inspections (
        id, inspection_number, shipment_id, shipment_reference, asn_reference,
        purchase_order_id, supplier_id, supplier_name, product_id, sku, product_name,
        supplier_batch, internal_lot, warehouse, receiving_location, uom,
        received_qty, accepted_qty, held_qty, rejected_qty, quarantined_qty,
        expected_weight_kg, actual_weight_kg, weight_verified, quantity_verified,
        manufacture_date, expiry_date,
        visual_inspection, packaging_condition, product_condition, freshness_status, labelling_status,
        traceability_verified, temp_reading_c, temp_min_c, temp_max_c, temp_status,
        certificates_verified, required_certificates_json, evidence_json, notes,
        status, decision_reason, inspector_id, inspector_name, inspected_at, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, 0, ?, 0, 0,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?
      )`
    ).run(
      id,
      inspectionNumber,
      input.shipment_id ?? null,
      input.shipment_reference ?? null,
      input.asn_reference ?? null,
      input.purchase_order_id ?? null,
      input.supplier_id ?? null,
      input.supplier_name || "Approved Supplier",
      prodLimits.productId,
      sku,
      input.product_name || prodLimits.productName,
      supplierBatch,
      internalLot,
      warehouse,
      input.receiving_location || "RCV-STAGE-01",
      input.uom || "case",
      receivedQty,
      initialHeldQty,
      input.expected_weight_kg ?? Number((receivedQty * prodLimits.unitWeightKg).toFixed(2)),
      input.actual_weight_kg ?? null,
      input.weight_verified ? 1 : 0,
      input.quantity_verified ? 1 : 0,
      input.manufacture_date ?? null,
      expiryDate,
      visual,
      packaging,
      prodCond,
      freshness,
      labelling,
      input.traceability_verified ? 1 : 0,
      tempReading,
      prodLimits.minC,
      prodLimits.maxC,
      tempStatus,
      input.certificates_verified ? 1 : 0,
      JSON.stringify(input.required_certificates || ["COA", "Health Certificate", "Origin Certificate"]),
      JSON.stringify(evidenceList),
      input.notes ?? null,
      initialStatus,
      hasFailedCheck ? "Automatically placed on hold due to receiving inspection / temperature failure." : null,
      actor.id,
      actor.name,
      now,
      now,
      now
    );

    // Ensure lot exists in inventory_lots with 0 released cases until QA releases it
    const existingLot = db.prepare(`SELECT * FROM inventory_lots WHERE batch_id = ?`).get(internalLot) as
      | { id: string; quality_status: string; quantity_cases: number }
      | undefined;

    if (!existingLot) {
      db.prepare(
        `INSERT INTO inventory_lots (
          id, batch_id, sku, product_name, category, warehouse, location, zone,
          quantity_cases, received_cases, allocated_cases,
          held_cases, quarantined_cases, rejected_cases, pending_cases,
          received_date, expiry_date, supplier, supplier_lot, origin_country,
          quality_status, inspection_id, temp_c, unit_weight_kg, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?,
          0, ?, 0,
          ?, 0, 0, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?
        )`
      ).run(
        `LOT-ID-${Date.now()}-${Math.floor(Math.random() * 999)}`,
        internalLot,
        sku,
        input.product_name || prodLimits.productName,
        prodLimits.category,
        warehouse,
        input.receiving_location || "RCV-STAGE-01",
        prodLimits.tempZone,
        receivedQty,
        hasFailedCheck ? receivedQty : 0,
        hasFailedCheck ? 0 : receivedQty,
        now.slice(0, 10),
        expiryDate,
        input.supplier_name || "Approved Supplier",
        supplierBatch,
        prodLimits.origin,
        hasFailedCheck ? "on_hold" : "pending",
        id,
        tempReading ?? prodLimits.minC,
        prodLimits.unitWeightKg,
        now
      );
    } else if (existingLot.quality_status !== "released") {
      db.prepare(
        `UPDATE inventory_lots
         SET quality_status = ?,
             quantity_cases = 0,
             held_cases = ?,
             pending_cases = ?,
             inspection_id = ?,
             updated_at = ?
         WHERE batch_id = ?`
      ).run(
        hasFailedCheck ? "on_hold" : "pending",
        hasFailedCheck ? receivedQty : 0,
        hasFailedCheck ? 0 : receivedQty,
        id,
        now,
        internalLot
      );
    }

    if (hasFailedCheck) {
      const excId = `QEX-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;
      const excNum = `EXC-2026-${Math.floor(1000 + Math.random() * 8999)}`;
      const excType: QualityException["exception_type"] = isTempExcursion
        ? "temperature_excursion"
        : packaging === "fail"
          ? "packaging_damage"
          : labelling === "fail"
            ? "labelling_error"
            : "haccp_failure";

      db.prepare(
        `INSERT INTO quality_exceptions (
          id, exception_number, inspection_id, shipment_id, shipment_reference,
          supplier_id, supplier_name, sku, product_name, internal_lot,
          warehouse, location, exception_type, severity,
          expected_limits, actual_reading, food_safety_impact, responsible_person,
          evidence_json, status, detected_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`
      ).run(
        excId,
        excNum,
        id,
        input.shipment_id ?? null,
        input.shipment_reference ?? null,
        input.supplier_id ?? null,
        input.supplier_name || "Approved Supplier",
        sku,
        input.product_name || prodLimits.productName,
        internalLot,
        warehouse,
        input.receiving_location || "RCV-STAGE-01",
        excType,
        isTempExcursion ? "critical" : "high",
        isTempExcursion ? `${prodLimits.minC}°C to ${prodLimits.maxC}°C` : "Pass all receiving inspection criteria",
        isTempExcursion ? `${tempReading}°C` : `Failed checks: ${[visual === "fail" && "visual", packaging === "fail" && "packaging", prodCond === "fail" && "product_condition", freshness === "fail" && "freshness", labelling === "fail" && "labelling"].filter(Boolean).join(", ")}`,
        isTempExcursion
          ? `Cold-chain excursion beyond ${prodLimits.maxC}°C threshold risks microbial growth; batch automatically placed on hold.`
          : "Physical/labelling non-conformance detected at receiving; batch isolated on QA hold.",
        actor.name,
        JSON.stringify(evidenceList),
        now,
        now,
        now
      );
    }

    recordAuditEvent({
      actor,
      action: "quality.inspection_created",
      entityType: "QualityInspection",
      entityId: id,
      after: {
        inspection_number: inspectionNumber,
        internal_lot: internalLot,
        sku,
        received_qty: receivedQty,
        status: initialStatus,
        temp_reading_c: tempReading
      }
    });
  });

  return getInspectionDetail(actor, id);
}

export function updateInspection(
  actor: AuthenticatedUser,
  idOrNumber: string,
  input: Partial<{
    receiving_location: string;
    actual_weight_kg: number | null;
    weight_verified: boolean | number;
    quantity_verified: boolean | number;
    manufacture_date: string | null;
    expiry_date: string;
    visual_inspection: CheckResultStatus;
    packaging_condition: CheckResultStatus;
    product_condition: CheckResultStatus;
    freshness_status: CheckResultStatus;
    labelling_status: CheckResultStatus;
    traceability_verified: boolean | number;
    temp_reading_c: number | null;
    certificates_verified: boolean | number;
    required_certificates: string[];
    evidence: Partial<EvidenceItem>[];
    notes: string | null;
  }>
): QualityInspectionDetail {
  if (!hasPermission(actor, "quality.inspect") && !hasPermission(actor, "quality_checks.manage")) {
    throw new ApiError(403, "FORBIDDEN_INSUFFICIENT_ROLE", `Role '${actor.role}' is not authorized to update receiving inspections.`);
  }
  requireMutationAuthorization(actor, "update receiving quality inspection");

  const db = getDb();
  const existingRow = db
    .prepare(`SELECT * FROM quality_inspections WHERE id = ? OR inspection_number = ?`)
    .get(idOrNumber, idOrNumber) as Record<string, unknown> | undefined;

  if (!existingRow) {
    throw new ApiError(404, "INSPECTION_NOT_FOUND", `Quality inspection '${idOrNumber}' was not found.`);
  }

  const existing = hydrateInspection(existingRow);
  requireRecordAccess(actor, { warehouse: existing.warehouse, supplier_id: existing.supplier_id });

  const prodLimits = resolveProductTempLimits(existing.sku);
  const minC = existing.temp_min_c ?? prodLimits.minC;
  const maxC = existing.temp_max_c ?? prodLimits.maxC;

  const tempReading =
    input.temp_reading_c !== undefined
      ? input.temp_reading_c !== null
        ? Number(input.temp_reading_c)
        : null
      : existing.temp_reading_c;

  const isTempExcursion =
    tempReading !== null && Number.isFinite(tempReading) && (tempReading < minC || tempReading > maxC);

  const tempStatus: CheckResultStatus =
    tempReading === null ? "pending" : isTempExcursion ? "fail" : "pass";

  const visual = input.visual_inspection ?? existing.visual_inspection;
  const packaging = input.packaging_condition ?? existing.packaging_condition;
  const prodCond = input.product_condition ?? existing.product_condition;
  const freshness = input.freshness_status ?? existing.freshness_status;
  const labelling = input.labelling_status ?? existing.labelling_status;

  const hasFailure =
    isTempExcursion ||
    visual === "fail" ||
    packaging === "fail" ||
    prodCond === "fail" ||
    freshness === "fail" ||
    labelling === "fail";

  const now = new Date().toISOString();
  const mergedEvidence: EvidenceItem[] = input.evidence
    ? [
        ...existing.evidence,
        ...input.evidence
          .filter((ev) => !existing.evidence.some((e) => e.id === ev.id))
          .map((ev, idx) => ({
            id: ev.id || `EV-${Date.now()}-${idx + 1}`,
            title: ev.title || `Inspection Evidence #${existing.evidence.length + idx + 1}`,
            file_type: ev.file_type || "photo",
            file_url: ev.file_url || `/evidence/${existing.internal_lot}-${idx + 1}.jpg`,
            uploaded_by: ev.uploaded_by || actor.name,
            uploaded_at: ev.uploaded_at || now,
            notes: ev.notes ?? null
          }))
      ]
    : existing.evidence;

  let nextStatus = existing.status;
  let nextHeldQty = existing.held_qty;
  if (hasFailure && existing.status === "pending") {
    nextStatus = "on_hold";
    nextHeldQty = existing.received_qty;
  }

  withTransaction(() => {
    db.prepare(
      `UPDATE quality_inspections
       SET receiving_location = ?,
           actual_weight_kg = ?,
           weight_verified = ?,
           quantity_verified = ?,
           manufacture_date = ?,
           expiry_date = ?,
           visual_inspection = ?,
           packaging_condition = ?,
           product_condition = ?,
           freshness_status = ?,
           labelling_status = ?,
           traceability_verified = ?,
           temp_reading_c = ?,
           temp_min_c = ?,
           temp_max_c = ?,
           temp_status = ?,
           certificates_verified = ?,
           required_certificates_json = ?,
           evidence_json = ?,
           notes = ?,
           status = ?,
           held_qty = ?,
           inspector_id = ?,
           inspector_name = ?,
           inspected_at = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(
      input.receiving_location ?? existing.receiving_location,
      input.actual_weight_kg !== undefined ? input.actual_weight_kg : existing.actual_weight_kg,
      input.weight_verified !== undefined ? (input.weight_verified ? 1 : 0) : existing.weight_verified,
      input.quantity_verified !== undefined ? (input.quantity_verified ? 1 : 0) : existing.quantity_verified,
      input.manufacture_date !== undefined ? input.manufacture_date : existing.manufacture_date,
      input.expiry_date ?? existing.expiry_date,
      visual,
      packaging,
      prodCond,
      freshness,
      labelling,
      input.traceability_verified !== undefined ? (input.traceability_verified ? 1 : 0) : existing.traceability_verified,
      tempReading,
      minC,
      maxC,
      tempStatus,
      input.certificates_verified !== undefined ? (input.certificates_verified ? 1 : 0) : existing.certificates_verified,
      JSON.stringify(input.required_certificates ?? existing.required_certificates),
      JSON.stringify(mergedEvidence),
      input.notes !== undefined ? input.notes : existing.notes,
      nextStatus,
      nextHeldQty,
      actor.id,
      actor.name,
      now,
      now,
      existing.id
    );

    if (hasFailure) {
      db.prepare(
        `UPDATE inventory_lots
         SET quality_status = CASE WHEN quality_status = 'pending' THEN 'on_hold' ELSE quality_status END,
             held_cases = CASE WHEN quality_status = 'pending' THEN received_cases ELSE held_cases END,
             pending_cases = CASE WHEN quality_status = 'pending' THEN 0 ELSE pending_cases END,
             temp_c = COALESCE(?, temp_c),
             updated_at = ?
         WHERE batch_id = ?`
      ).run(tempReading, now, existing.internal_lot);

      // Ensure an exception exists for this excursion/failure
      const existingExc = db
        .prepare(`SELECT id FROM quality_exceptions WHERE inspection_id = ? AND exception_type = ?`)
        .get(existing.id, isTempExcursion ? "temperature_excursion" : "haccp_failure");

      if (!existingExc) {
        const excId = `QEX-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;
        const excNum = `EXC-2026-${Math.floor(1000 + Math.random() * 8999)}`;
        db.prepare(
          `INSERT INTO quality_exceptions (
            id, exception_number, inspection_id, shipment_id, shipment_reference,
            supplier_id, supplier_name, sku, product_name, internal_lot,
            warehouse, location, exception_type, severity,
            expected_limits, actual_reading, food_safety_impact, responsible_person,
            evidence_json, status, detected_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`
        ).run(
          excId,
          excNum,
          existing.id,
          existing.shipment_id,
          existing.shipment_reference,
          existing.supplier_id,
          existing.supplier_name,
          existing.sku,
          existing.product_name,
          existing.internal_lot,
          existing.warehouse,
          existing.receiving_location,
          isTempExcursion ? "temperature_excursion" : "haccp_failure",
          isTempExcursion ? "critical" : "high",
          isTempExcursion ? `${minC}°C to ${maxC}°C` : "Pass all receiving inspection criteria",
          isTempExcursion ? `${tempReading}°C` : "Failed visual/packaging/freshness/labelling inspection",
          isTempExcursion
            ? `Product temperature (${tempReading}°C) exceeded configured range (${minC}°C to ${maxC}°C). Stock automatically blocked.`
            : "Receiving quality criteria failed. Stock automatically blocked on hold.",
          actor.name,
          JSON.stringify(mergedEvidence),
          now,
          now,
          now
        );
      }
    }

    recordAuditEvent({
      actor,
      action: "quality.inspection_updated",
      entityType: "QualityInspection",
      entityId: existing.id,
      before: {
        status: existing.status,
        temp_reading_c: existing.temp_reading_c,
        visual_inspection: existing.visual_inspection,
        packaging_condition: existing.packaging_condition
      },
      after: {
        status: nextStatus,
        temp_reading_c: tempReading,
        visual_inspection: visual,
        packaging_condition: packaging
      }
    });
  });

  return getInspectionDetail(actor, existing.id);
}

export function listHaccpTemplates(
  actor: AuthenticatedUser,
  filters: { sku?: string | null; category?: string | null } = {}
): HaccpCheckpointTemplate[] {
  assertPermission(actor, "quality.read");
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM haccp_checkpoint_templates WHERE active = 1 ORDER BY is_ccp DESC, code ASC`)
    .all() as Record<string, unknown>[];

  const prodLimits = filters.sku ? resolveProductTempLimits(filters.sku) : null;

  return rows.map((row) => {
    let minLimit = row.min_limit !== null && row.min_limit !== undefined ? Number(row.min_limit) : null;
    let maxLimit = row.max_limit !== null && row.max_limit !== undefined ? Number(row.max_limit) : null;

    // Dynamically apply product-specific temperature thresholds rather than a single hardcoded limit
    if (prodLimits && row.measurement_type === "temperature") {
      minLimit = prodLimits.minC;
      maxLimit = prodLimits.maxC;
    }

    return {
      id: String(row.id),
      code: String(row.code),
      checkpoint_name: String(row.checkpoint_name),
      description: String(row.description),
      ccp_classification: String(row.ccp_classification),
      is_ccp: Number(row.is_ccp ?? 1),
      category: row.category ? String(row.category) : null,
      sku: row.sku ? String(row.sku) : null,
      temp_zone: row.temp_zone ? String(row.temp_zone) : null,
      measurement_type: (row.measurement_type as HaccpCheckpointTemplate["measurement_type"]) || "condition",
      min_limit: minLimit,
      max_limit: maxLimit,
      unit: row.unit ? String(row.unit) : null,
      expected_text: row.expected_text ? String(row.expected_text) : null,
      active: Number(row.active ?? 1),
      created_at: String(row.created_at)
    };
  });
}

export function createHaccpTemplate(
  actor: AuthenticatedUser,
  input: {
    code: string;
    checkpoint_name: string;
    description: string;
    ccp_classification: string;
    is_ccp?: boolean | number;
    category?: string | null;
    sku?: string | null;
    temp_zone?: string | null;
    measurement_type: "temperature" | "numeric" | "boolean" | "condition";
    min_limit?: number | null;
    max_limit?: number | null;
    unit?: string | null;
    expected_text?: string | null;
  }
): HaccpCheckpointTemplate {
  if (!hasPermission(actor, "quality.decide") && !hasPermission(actor, "quality.inspect")) {
    throw new ApiError(403, "FORBIDDEN_INSUFFICIENT_ROLE", "Only QA users can configure HACCP checkpoint templates.");
  }
  requireMutationAuthorization(actor, "configure HACCP checkpoint template");

  if (!input.code?.trim() || !input.checkpoint_name?.trim() || !input.ccp_classification?.trim()) {
    throw new ApiError(400, "VALIDATION_ERROR", "code, checkpoint_name, and ccp_classification are required.");
  }

  const db = getDb();
  const id = `HCT-${Date.now()}`;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO haccp_checkpoint_templates (
      id, code, checkpoint_name, description, ccp_classification, is_ccp,
      category, sku, temp_zone, measurement_type, min_limit, max_limit, unit, expected_text, active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  ).run(
    id,
    input.code.trim().toUpperCase(),
    input.checkpoint_name.trim(),
    input.description?.trim() || input.checkpoint_name.trim(),
    input.ccp_classification.trim(),
    input.is_ccp === false || input.is_ccp === 0 ? 0 : 1,
    input.category ?? null,
    input.sku ?? null,
    input.temp_zone ?? null,
    input.measurement_type || "condition",
    input.min_limit ?? null,
    input.max_limit ?? null,
    input.unit ?? null,
    input.expected_text ?? null,
    now
  );

  recordAuditEvent({
    actor,
    action: "quality.haccp_template_created",
    entityType: "HaccpCheckpointTemplate",
    entityId: id,
    after: { code: input.code, checkpoint_name: input.checkpoint_name }
  });

  return listHaccpTemplates(actor).find((t) => t.id === id)!;
}

export function recordHaccpReading(
  actor: AuthenticatedUser,
  inspectionIdOrNumber: string,
  input: {
    template_id?: string | null;
    checkpoint_code?: string;
    checkpoint_name?: string;
    description?: string | null;
    ccp_classification?: string;
    is_ccp?: boolean | number;
    min_limit?: number | null;
    max_limit?: number | null;
    unit?: string | null;
    expected_text?: string | null;
    actual_numeric?: number | null;
    actual_text?: string | null;
    status?: "pass" | "fail";
    evidence?: Partial<EvidenceItem>[];
    notes?: string | null;
  }
): {
  reading: HaccpCheckpointReading;
  exception_created: QualityException | null;
  inspection: QualityInspectionDetail;
} {
  if (!hasPermission(actor, "quality.inspect") && !hasPermission(actor, "quality_checks.manage")) {
    throw new ApiError(403, "FORBIDDEN_INSUFFICIENT_ROLE", `Role '${actor.role}' is not authorized to record HACCP checkpoints.`);
  }
  requireMutationAuthorization(actor, "record HACCP checkpoint reading");

  const db = getDb();
  const inspRow = db
    .prepare(`SELECT * FROM quality_inspections WHERE id = ? OR inspection_number = ?`)
    .get(inspectionIdOrNumber, inspectionIdOrNumber) as Record<string, unknown> | undefined;

  if (!inspRow) {
    throw new ApiError(404, "INSPECTION_NOT_FOUND", `Quality inspection '${inspectionIdOrNumber}' was not found.`);
  }
  const inspection = hydrateInspection(inspRow);
  requireRecordAccess(actor, { warehouse: inspection.warehouse, supplier_id: inspection.supplier_id });

  const templateRow = input.template_id
    ? (db.prepare(`SELECT * FROM haccp_checkpoint_templates WHERE id = ? OR code = ?`).get(input.template_id, input.template_id) as
        | Record<string, unknown>
        | undefined)
    : input.checkpoint_code
      ? (db.prepare(`SELECT * FROM haccp_checkpoint_templates WHERE code = ?`).get(input.checkpoint_code) as
          | Record<string, unknown>
          | undefined)
      : undefined;

  const prodLimits = resolveProductTempLimits(inspection.sku);
  const checkpointCode = String(input.checkpoint_code || templateRow?.code || "CCP-CUSTOM");
  const checkpointName = String(input.checkpoint_name || templateRow?.checkpoint_name || "HACCP Receiving Verification");
  const description = String(input.description || templateRow?.description || checkpointName);
  const ccpClass = String(input.ccp_classification || templateRow?.ccp_classification || "CCP-1");
  const isCcp =
    input.is_ccp !== undefined
      ? input.is_ccp
        ? 1
        : 0
      : templateRow?.is_ccp !== undefined
        ? Number(templateRow.is_ccp)
        : 1;

  const isTempCheck =
    templateRow?.measurement_type === "temperature" ||
    checkpointCode.toUpperCase().includes("TEMP") ||
    (input.unit || templateRow?.unit) === "°C";

  // Use product-specific limits for temperature checks unless explicitly overridden
  const minLimit =
    input.min_limit !== undefined && input.min_limit !== null
      ? Number(input.min_limit)
      : isTempCheck
        ? (inspection.temp_min_c ?? prodLimits.minC)
        : templateRow?.min_limit !== null && templateRow?.min_limit !== undefined
          ? Number(templateRow.min_limit)
          : null;

  const maxLimit =
    input.max_limit !== undefined && input.max_limit !== null
      ? Number(input.max_limit)
      : isTempCheck
        ? (inspection.temp_max_c ?? prodLimits.maxC)
        : templateRow?.max_limit !== null && templateRow?.max_limit !== undefined
          ? Number(templateRow.max_limit)
          : null;

  const unit = input.unit ?? (templateRow?.unit ? String(templateRow.unit) : isTempCheck ? "°C" : null);
  const expectedText = input.expected_text ?? (templateRow?.expected_text ? String(templateRow.expected_text) : null);

  const actualNumeric =
    input.actual_numeric !== undefined && input.actual_numeric !== null && input.actual_numeric !== ("" as unknown as number)
      ? Number(input.actual_numeric)
      : null;

  const actualText = input.actual_text?.trim() || null;

  let evaluatedStatus: "pass" | "fail" = input.status || "pass";
  if (actualNumeric !== null && Number.isFinite(actualNumeric)) {
    if ((minLimit !== null && actualNumeric < minLimit) || (maxLimit !== null && actualNumeric > maxLimit)) {
      evaluatedStatus = "fail";
    }
  }
  if (actualText && /fail|damaged|broken|compromised|contaminated|excursion|expired/i.test(actualText)) {
    evaluatedStatus = "fail";
  }

  const criticalViolation = evaluatedStatus === "fail" && isCcp === 1 ? 1 : 0;
  const now = new Date().toISOString();
  const readingId = `HCR-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;

  const evidenceList: EvidenceItem[] = (input.evidence || []).map((ev, idx) => ({
    id: ev.id || `EV-HACCP-${Date.now()}-${idx + 1}`,
    title: ev.title || `${checkpointCode} Evidence #${idx + 1}`,
    file_type: ev.file_type || "photo",
    file_url: ev.file_url || `/evidence/haccp-${readingId}-${idx + 1}.jpg`,
    uploaded_by: ev.uploaded_by || actor.name,
    uploaded_at: ev.uploaded_at || now,
    notes: ev.notes ?? null
  }));

  let createdExceptionId: string | null = null;

  withTransaction(() => {
    db.prepare(
      `INSERT INTO haccp_checkpoint_readings (
        id, inspection_id, shipment_id, template_id, checkpoint_code, checkpoint_name,
        description, ccp_classification, is_ccp, sku, internal_lot,
        min_limit, max_limit, unit, expected_text, actual_numeric, actual_text,
        status, critical_violation, evidence_json, notes, inspector_id, inspector_name, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      readingId,
      inspection.id,
      inspection.shipment_id,
      templateRow?.id ? String(templateRow.id) : null,
      checkpointCode,
      checkpointName,
      description,
      ccpClass,
      isCcp,
      inspection.sku,
      inspection.internal_lot,
      minLimit,
      maxLimit,
      unit,
      expectedText,
      actualNumeric,
      actualText,
      evaluatedStatus,
      criticalViolation,
      JSON.stringify(evidenceList),
      input.notes ?? null,
      actor.id,
      actor.name,
      now
    );

    if (evaluatedStatus === "fail") {
      // Automatically block stock on hold when a HACCP checkpoint fails
      db.prepare(
        `UPDATE quality_inspections
         SET status = CASE WHEN status IN ('pending', 'released', 'partially_released') THEN 'on_hold' ELSE status END,
             held_qty = CASE WHEN status = 'pending' THEN received_qty ELSE MAX(held_qty, received_qty - rejected_qty - quarantined_qty) END,
             accepted_qty = 0,
             temp_reading_c = COALESCE(?, temp_reading_c),
             temp_status = CASE WHEN ? = 1 THEN 'fail' ELSE temp_status END,
             decision_reason = COALESCE(decision_reason, ?),
             updated_at = ?
         WHERE id = ?`
      ).run(
        isTempCheck ? actualNumeric : null,
        isTempCheck ? 1 : 0,
        `Automatically blocked on hold due to failed HACCP checkpoint ${checkpointCode} (${checkpointName}).`,
        now,
        inspection.id
      );

      db.prepare(
        `UPDATE inventory_lots
         SET quality_status = 'on_hold',
             quantity_cases = 0,
             held_cases = MAX(received_cases - COALESCE(rejected_cases, 0) - COALESCE(quarantined_cases, 0), 0),
             pending_cases = 0,
             quality_decision_reason = ?,
             updated_at = ?
         WHERE batch_id = ?`
      ).run(`Blocked by failed HACCP checkpoint ${checkpointCode}`, now, inspection.internal_lot);

      db.prepare(
        `UPDATE inbound_batches
         SET status = 'on_hold',
             accepted_qty = 0,
             held_qty = quantity - rejected_qty - quarantined_qty
         WHERE internal_lot = ?`
      ).run(inspection.internal_lot);

      // Automatically create Excursion / Quality Exception record
      createdExceptionId = `QEX-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;
      const excNum = `EXC-2026-${Math.floor(1000 + Math.random() * 8999)}`;
      const expectedStr =
        minLimit !== null && maxLimit !== null
          ? `${minLimit}${unit || ""} to ${maxLimit}${unit || ""}`
          : expectedText || "Pass HACCP critical limit";
      const actualStr =
        actualNumeric !== null ? `${actualNumeric}${unit || ""}` : actualText || "Failed HACCP checkpoint";

      db.prepare(
        `INSERT INTO quality_exceptions (
          id, exception_number, inspection_id, shipment_id, shipment_reference,
          haccp_reading_id, supplier_id, supplier_name, sku, product_name, internal_lot,
          warehouse, location, exception_type, severity,
          expected_limits, actual_reading, food_safety_impact, responsible_person,
          evidence_json, status, detected_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`
      ).run(
        createdExceptionId,
        excNum,
        inspection.id,
        inspection.shipment_id,
        inspection.shipment_reference,
        readingId,
        inspection.supplier_id,
        inspection.supplier_name,
        inspection.sku,
        inspection.product_name,
        inspection.internal_lot,
        inspection.warehouse,
        inspection.receiving_location,
        isTempCheck ? "temperature_excursion" : "haccp_failure",
        criticalViolation ? "critical" : "high",
        expectedStr,
        actualStr,
        criticalViolation
          ? `Critical Control Point (${ccpClass}) violation on ${inspection.product_name}. Potential food-safety hazard; lot ${inspection.internal_lot} automatically isolated on QA Hold.`
          : `HACCP prerequisite violation (${checkpointCode}); lot ${inspection.internal_lot} placed on QA Hold pending investigation.`,
        actor.name,
        JSON.stringify(evidenceList),
        now,
        now,
        now
      );
    }

    recordAuditEvent({
      actor,
      action: evaluatedStatus === "fail" ? "quality.haccp_failed" : "quality.haccp_passed",
      entityType: "QualityInspection",
      entityId: inspection.id,
      after: {
        reading_id: readingId,
        checkpoint_code: checkpointCode,
        status: evaluatedStatus,
        actual_numeric: actualNumeric,
        actual_text: actualText,
        critical_violation: criticalViolation,
        exception_id: createdExceptionId
      }
    });
  });

  const readingRow = db.prepare(`SELECT * FROM haccp_checkpoint_readings WHERE id = ?`).get(readingId) as Record<
    string,
    unknown
  >;
  const exceptionRow = createdExceptionId
    ? (db.prepare(`SELECT * FROM quality_exceptions WHERE id = ?`).get(createdExceptionId) as Record<string, unknown>)
    : null;

  return {
    reading: hydrateHaccpReading(readingRow),
    exception_created: exceptionRow ? hydrateException(exceptionRow) : null,
    inspection: getInspectionDetail(actor, inspection.id)
  };
}

export function rejectImmutableHaccpMutation(actor: AuthenticatedUser, readingId: string): never {
  recordAuditEvent({
    actor,
    action: "quality.haccp_tamper_blocked",
    entityType: "HaccpCheckpointReading",
    entityId: readingId,
    after: { blocked: true }
  });
  throw new ApiError(
    403,
    "IMMUTABLE_HACCP_READING",
    "Original HACCP checkpoint readings and excursion evidence are immutable and cannot be overwritten or deleted."
  );
}

export function decideInspection(
  actor: AuthenticatedUser,
  inspectionIdOrNumber: string,
  input: {
    decision: "on_hold" | "released" | "partially_released" | "rejected" | "quarantined";
    accepted_qty?: number;
    held_qty?: number;
    rejected_qty?: number;
    quarantined_qty?: number;
    reason: string;
    target_location?: string;
    override_resolved_haccp?: boolean;
  }
): QualityInspectionDetail {
  // Strict QA Separation of Duties: Only authorized QA / QA Manager / Super Admin can release or reject goods
  if (!hasPermission(actor, "quality.decide")) {
    throw new ApiError(
      403,
      "FORBIDDEN_QUALITY_DECISION",
      `Role '${actor.role}' (${actor.email}) is not authorized to make final Hold/Release/Reject/Quarantine decisions. QA authorization ('quality.decide') is required.`
    );
  }
  requireMutationAuthorization(actor, "record quality gate decision");

  const reason = (input.reason || "").trim();
  if (!reason || reason.length < 3) {
    throw new ApiError(
      400,
      "REASON_REQUIRED",
      "A clear, documented reason is mandatory for every hold, release, rejection, or quarantine decision."
    );
  }

  const db = getDb();
  const inspRow = db
    .prepare(`SELECT * FROM quality_inspections WHERE id = ? OR inspection_number = ?`)
    .get(inspectionIdOrNumber, inspectionIdOrNumber) as Record<string, unknown> | undefined;

  if (!inspRow) {
    throw new ApiError(404, "INSPECTION_NOT_FOUND", `Quality inspection '${inspectionIdOrNumber}' was not found.`);
  }

  const inspection = hydrateInspection(inspRow);
  requireRecordAccess(actor, { warehouse: inspection.warehouse, supplier_id: inspection.supplier_id });

  const receivedQty = inspection.received_qty;
  let acceptedQty = input.accepted_qty !== undefined ? Number(input.accepted_qty) : 0;
  let heldQty = input.held_qty !== undefined ? Number(input.held_qty) : 0;
  let rejectedQty = input.rejected_qty !== undefined ? Number(input.rejected_qty) : 0;
  let quarantinedQty = input.quarantined_qty !== undefined ? Number(input.quarantined_qty) : 0;

  if (
    input.accepted_qty === undefined &&
    input.held_qty === undefined &&
    input.rejected_qty === undefined &&
    input.quarantined_qty === undefined
  ) {
    if (input.decision === "released") {
      acceptedQty = receivedQty;
    } else if (input.decision === "on_hold") {
      heldQty = receivedQty;
    } else if (input.decision === "rejected") {
      rejectedQty = receivedQty;
    } else if (input.decision === "quarantined") {
      quarantinedQty = receivedQty;
    }
  }

  if (acceptedQty < 0 || heldQty < 0 || rejectedQty < 0 || quarantinedQty < 0) {
    throw new ApiError(400, "INVALID_QUANTITIES", "Disposition quantities cannot be negative.");
  }

  const totalDisposition = Number((acceptedQty + heldQty + rejectedQty + quarantinedQty).toFixed(4));
  if (totalDisposition > receivedQty + 0.0001 || acceptedQty > receivedQty + 0.0001) {
    throw new ApiError(
      400,
      "QUANTITY_EXCEEDED",
      `Total disposition quantity (${totalDisposition}) cannot exceed received quantity (${receivedQty}).`
    );
  }

  if (totalDisposition === 0) {
    throw new ApiError(400, "INVALID_QUANTITIES", "At least one disposition quantity must be greater than zero.");
  }

  // Check for unresolved failed HACCP checkpoints or open critical exceptions before allowing full/partial release
  if (acceptedQty > 0) {
    const failedReadings = db
      .prepare(`SELECT COUNT(*) as c FROM haccp_checkpoint_readings WHERE inspection_id = ? AND status = 'fail'`)
      .get(inspection.id) as { c: number };

    const unresolvedExceptions = db
      .prepare(
        `SELECT COUNT(*) as c FROM quality_exceptions
         WHERE inspection_id = ? AND status NOT IN ('resolved', 'closed')`
      )
      .get(inspection.id) as { c: number };

    const isPartialWithNonAccepted = acceptedQty < receivedQty && (rejectedQty > 0 || heldQty > 0 || quarantinedQty > 0);

    if (
      (Number(failedReadings?.c || 0) > 0 || Number(unresolvedExceptions?.c || 0) > 0) &&
      !input.override_resolved_haccp &&
      !isPartialWithNonAccepted
    ) {
      if (Number(unresolvedExceptions?.c || 0) > 0) {
        throw new ApiError(
          409,
          "UNRESOLVED_HACCP_FAILURE",
          "Cannot release full batch while failed HACCP checkpoints or open quality exceptions remain unresolved. Resolve the exception first or perform a partial release of unaffected units."
        );
      }
    }
  }

  let finalInspectionStatus: InspectionStatus = input.decision;
  if (acceptedQty > 0 && (heldQty > 0 || rejectedQty > 0 || quarantinedQty > 0 || acceptedQty < receivedQty)) {
    finalInspectionStatus = "partially_released";
  } else if (acceptedQty === receivedQty) {
    finalInspectionStatus = "released";
  } else if (quarantinedQty > 0 && acceptedQty === 0) {
    finalInspectionStatus = "quarantined";
  } else if (heldQty > 0 && acceptedQty === 0) {
    finalInspectionStatus = "on_hold";
  } else if (rejectedQty > 0 && acceptedQty === 0) {
    finalInspectionStatus = "rejected";
  }

  const lotQualityStatus: "released" | "quarantine" | "on_hold" | "rejected" =
    acceptedQty > 0
      ? "released"
      : quarantinedQty > 0
        ? "quarantine"
        : heldQty > 0
          ? "on_hold"
          : "rejected";

  const targetLocation =
    input.target_location?.trim() ||
    (lotQualityStatus === "released"
      ? inspection.receiving_location.startsWith("RCV")
        ? "CHILL-A1-01"
        : inspection.receiving_location
      : lotQualityStatus === "quarantine"
        ? "QUAR-ZONE-01"
        : lotQualityStatus === "on_hold"
          ? "HOLD-CAGE-01"
          : "REJ-DOCK-01");

  const now = new Date().toISOString();

  withTransaction(() => {
    db.prepare(
      `UPDATE quality_inspections
       SET accepted_qty = ?,
           held_qty = ?,
           rejected_qty = ?,
           quarantined_qty = ?,
           receiving_location = ?,
           status = ?,
           decision_reason = ?,
           decided_by_id = ?,
           decided_by_name = ?,
           decided_at = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(
      acceptedQty,
      heldQty,
      rejectedQty,
      quarantinedQty,
      targetLocation,
      finalInspectionStatus,
      reason,
      actor.id,
      actor.name,
      now,
      now,
      inspection.id
    );

    const existingLot = db
      .prepare(`SELECT * FROM inventory_lots WHERE batch_id = ?`)
      .get(inspection.internal_lot) as
      | { id: string; quantity_cases: number; allocated_cases: number }
      | undefined;

    const prodLimits = resolveProductTempLimits(inspection.sku);
    const pendingCases = Math.max(0, receivedQty - acceptedQty - heldQty - rejectedQty - quarantinedQty);

    if (existingLot) {
      const prevCases = Number(existingLot.quantity_cases || 0);
      db.prepare(
        `UPDATE inventory_lots
         SET quantity_cases = ?,
             allocated_cases = MIN(allocated_cases, ?),
             held_cases = ?,
             quarantined_cases = ?,
             rejected_cases = ?,
             pending_cases = ?,
             location = ?,
             quality_status = ?,
             inspection_id = ?,
             quality_decision_reason = ?,
             quality_decided_by = ?,
             quality_decided_at = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(
        acceptedQty,
        acceptedQty,
        heldQty,
        quarantinedQty,
        rejectedQty,
        pendingCases,
        targetLocation,
        lotQualityStatus,
        inspection.id,
        reason,
        actor.name,
        now,
        now,
        existingLot.id
      );

      db.prepare(
        `INSERT INTO stock_movements (
          id, batch_id, sku, movement_type, quantity_delta, previous_cases, new_cases, reason, actor_email, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        `MOV-QG-${Date.now()}-${Math.floor(Math.random() * 999)}`,
        inspection.internal_lot,
        inspection.sku,
        `quality_${finalInspectionStatus}`,
        acceptedQty - prevCases,
        prevCases,
        acceptedQty,
        `QA Decision (${finalInspectionStatus}): ${reason} [Accepted=${acceptedQty}, Held=${heldQty}, Rejected=${rejectedQty}, Quarantined=${quarantinedQty}]`,
        actor.email,
        now
      );
    } else {
      db.prepare(
        `INSERT INTO inventory_lots (
          id, batch_id, sku, product_name, category, warehouse, location, zone,
          quantity_cases, received_cases, allocated_cases,
          held_cases, quarantined_cases, rejected_cases, pending_cases,
          received_date, expiry_date, supplier, supplier_lot, origin_country,
          quality_status, inspection_id, quality_decision_reason, quality_decided_by, quality_decided_at,
          temp_c, unit_weight_kg, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, 0,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?
        )`
      ).run(
        `LOT-ID-${Date.now()}-${Math.floor(Math.random() * 999)}`,
        inspection.internal_lot,
        inspection.sku,
        inspection.product_name,
        prodLimits.category,
        inspection.warehouse,
        targetLocation,
        prodLimits.tempZone,
        acceptedQty,
        receivedQty,
        heldQty,
        quarantinedQty,
        rejectedQty,
        pendingCases,
        now.slice(0, 10),
        inspection.expiry_date,
        inspection.supplier_name,
        inspection.supplier_batch,
        prodLimits.origin,
        lotQualityStatus,
        inspection.id,
        reason,
        actor.name,
        now,
        inspection.temp_reading_c ?? prodLimits.minC,
        prodLimits.unitWeightKg,
        now
      );
    }

    // Synchronize inbound_batches & inbound_shipment_items if linked
    const inboundBatch = db
      .prepare(`SELECT id, shipment_id, item_id FROM inbound_batches WHERE internal_lot = ?`)
      .get(inspection.internal_lot) as { id: string; shipment_id: string; item_id: string } | undefined;

    if (inboundBatch) {
      const batchStatus =
        acceptedQty > 0
          ? "released"
          : quarantinedQty > 0
            ? "quarantined"
            : heldQty > 0
              ? "on_hold"
              : "rejected";

      db.prepare(
        `UPDATE inbound_batches
         SET accepted_qty = ?,
             held_qty = ?,
             rejected_qty = ?,
             quarantined_qty = ?,
             storage = ?,
             status = ?
         WHERE id = ?`
      ).run(acceptedQty, heldQty, rejectedQty, quarantinedQty, targetLocation, batchStatus, inboundBatch.id);

      if (inboundBatch.item_id) {
        db.prepare(
          `UPDATE inbound_shipment_items
           SET accepted_qty = ?,
               rejected_qty = ?,
               updated_at = ?
           WHERE id = ?`
        ).run(acceptedQty, rejectedQty, now, inboundBatch.item_id);
      }
    }

    recordAuditEvent({
      actor,
      action: `quality.decision_${finalInspectionStatus}`,
      entityType: "QualityInspection",
      entityId: inspection.id,
      before: {
        status: inspection.status,
        accepted_qty: inspection.accepted_qty,
        held_qty: inspection.held_qty,
        rejected_qty: inspection.rejected_qty,
        quarantined_qty: inspection.quarantined_qty
      },
      after: {
        status: finalInspectionStatus,
        accepted_qty: acceptedQty,
        held_qty: heldQty,
        rejected_qty: rejectedQty,
        quarantined_qty: quarantinedQty,
        reason,
        target_location: targetLocation
      }
    });
  });

  // Module 05 Integration: Automatically generate Put-away task for released/partially-released goods,
  // or block any active put-away tasks if the batch was placed on hold, quarantined, or rejected.
  try {
    if (acceptedQty > 0 && (finalInspectionStatus === "released" || finalInspectionStatus === "partially_released")) {
      createPutawayTask(actor, {
        inspection_id: inspection.id,
        internal_lot: inspection.internal_lot,
        eligible_qty: acceptedQty,
        receiving_location: inspection.receiving_location || "RCV-STAGE-01",
        notes: `Auto-generated upon QA ${finalInspectionStatus} decision: ${reason}`
      });
    } else if (acceptedQty === 0) {
      db.prepare(
        `UPDATE putaway_tasks
         SET status = 'Blocked',
             notes = ?,
             updated_at = ?
         WHERE internal_lot = ? AND status NOT IN ('Completed', 'Cancelled')`
      ).run(`Blocked by QA decision (${finalInspectionStatus}): ${reason}`, now, inspection.internal_lot);
    }
  } catch {
    // Non-fatal if put-away auto-hook encounters an already completed task
  }

  return getInspectionDetail(actor, inspection.id);
}

export function listExceptions(
  actor: AuthenticatedUser,
  filters: {
    status?: string | null;
    severity?: string | null;
    warehouse?: string | null;
    search?: string | null;
    lot?: string | null;
  } = {}
): QualityException[] {
  assertPermission(actor, "quality.read");
  const db = getDb();
  const conditions: string[] = [];
  const params: string[] = [];

  const wf = buildWarehouseFilter(actor, filters.warehouse);
  if (wf.clause) {
    conditions.push(wf.clause);
    params.push(...wf.params);
  }
  if (filters.status && filters.status !== "ALL") {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters.severity && filters.severity !== "ALL") {
    conditions.push("severity = ?");
    params.push(filters.severity);
  }
  if (filters.lot) {
    conditions.push("upper(internal_lot) = upper(?)");
    params.push(filters.lot);
  }
  if (filters.search && filters.search.trim()) {
    const q = `%${filters.search.trim().toLowerCase()}%`;
    conditions.push(
      `(lower(exception_number) LIKE ? OR lower(internal_lot) LIKE ? OR lower(sku) LIKE ? OR lower(product_name) LIKE ? OR lower(COALESCE(supplier_name, '')) LIKE ?)`
    );
    params.push(q, q, q, q, q);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM quality_exceptions ${whereSql} ORDER BY detected_at DESC, id DESC`)
    .all(...params) as Record<string, unknown>[];

  return rows.map(hydrateException);
}

export function getExceptionDetail(actor: AuthenticatedUser, idOrNumber: string): QualityException {
  assertPermission(actor, "quality.read");
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM quality_exceptions WHERE id = ? OR exception_number = ?`)
    .get(idOrNumber, idOrNumber) as Record<string, unknown> | undefined;

  if (!row) {
    throw new ApiError(404, "EXCEPTION_NOT_FOUND", `Quality exception '${idOrNumber}' was not found.`);
  }
  const exc = hydrateException(row);
  requireRecordAccess(actor, { warehouse: exc.warehouse, supplier_id: exc.supplier_id });
  return exc;
}

export function createException(
  actor: AuthenticatedUser,
  input: {
    inspection_id?: string | null;
    shipment_id?: string | null;
    shipment_reference?: string | null;
    supplier_id?: string | null;
    supplier_name?: string | null;
    sku: string;
    product_name?: string;
    internal_lot: string;
    warehouse?: string;
    location?: string;
    exception_type: QualityException["exception_type"];
    severity?: QualityException["severity"];
    expected_limits: string;
    actual_reading: string;
    food_safety_impact: string;
    responsible_person?: string;
    evidence?: Partial<EvidenceItem>[];
    investigation_notes?: string | null;
  }
): QualityException {
  if (!hasPermission(actor, "quality.inspect") && !hasPermission(actor, "quality_checks.manage") && !hasPermission(actor, "inbound.temperature")) {
    throw new ApiError(403, "FORBIDDEN_INSUFFICIENT_ROLE", "Not authorized to create quality exceptions.");
  }
  requireMutationAuthorization(actor, "create quality exception");

  const warehouse = (input.warehouse || actor.warehouse || "Milan Cold Hub").trim();
  requireWarehouseAccess(actor, warehouse);

  const prodLimits = resolveProductTempLimits(input.sku);
  const now = new Date().toISOString();
  const id = `QEX-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;
  const excNum = `EXC-2026-${Math.floor(1000 + Math.random() * 8999)}`;

  const evidenceList: EvidenceItem[] = (input.evidence || []).map((ev, idx) => ({
    id: ev.id || `EV-EXC-${Date.now()}-${idx + 1}`,
    title: ev.title || `Excursion Evidence #${idx + 1}`,
    file_type: ev.file_type || "temperature_log",
    file_url: ev.file_url || `/evidence/exc-${id}-${idx + 1}.pdf`,
    uploaded_by: ev.uploaded_by || actor.name,
    uploaded_at: ev.uploaded_at || now,
    notes: ev.notes ?? null
  }));

  const db = getDb();
  db.prepare(
    `INSERT INTO quality_exceptions (
      id, exception_number, inspection_id, shipment_id, shipment_reference,
      supplier_id, supplier_name, sku, product_name, internal_lot,
      warehouse, location, exception_type, severity,
      expected_limits, actual_reading, food_safety_impact, responsible_person,
      evidence_json, investigation_notes, status, detected_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`
  ).run(
    id,
    excNum,
    input.inspection_id ?? null,
    input.shipment_id ?? null,
    input.shipment_reference ?? null,
    input.supplier_id ?? null,
    input.supplier_name ?? null,
    input.sku,
    input.product_name || prodLimits.productName,
    input.internal_lot,
    warehouse,
    input.location || "RCV-STAGE-01",
    input.exception_type || "temperature_excursion",
    input.severity || "high",
    input.expected_limits,
    input.actual_reading,
    input.food_safety_impact,
    input.responsible_person || actor.name,
    JSON.stringify(evidenceList),
    input.investigation_notes ?? null,
    now,
    now,
    now
  );

  recordAuditEvent({
    actor,
    action: "quality.exception_created",
    entityType: "QualityException",
    entityId: id,
    after: {
      exception_number: excNum,
      internal_lot: input.internal_lot,
      exception_type: input.exception_type,
      severity: input.severity || "high"
    }
  });

  return getExceptionDetail(actor, id);
}

export function updateException(
  actor: AuthenticatedUser,
  idOrNumber: string,
  input: {
    investigation_notes?: string | null;
    resolution?: string | null;
    status?: QualityException["status"];
    severity?: QualityException["severity"];
    evidence?: Partial<EvidenceItem>[];
  }
): QualityException {
  if (!hasPermission(actor, "quality.inspect") && !hasPermission(actor, "quality.decide") && !hasPermission(actor, "quality.capa")) {
    throw new ApiError(403, "FORBIDDEN_INSUFFICIENT_ROLE", "Not authorized to update quality exceptions.");
  }
  requireMutationAuthorization(actor, "update quality exception");

  const existing = getExceptionDetail(actor, idOrNumber);
  const nextStatus = input.status ?? existing.status;
  const nextResolution = input.resolution !== undefined ? input.resolution : existing.resolution;

  if ((nextStatus === "resolved" || nextStatus === "closed") && (!nextResolution || !nextResolution.trim())) {
    throw new ApiError(
      400,
      "RESOLUTION_REQUIRED",
      "A documented resolution is required before marking a quality exception as resolved or closed."
    );
  }

  if ((nextStatus === "resolved" || nextStatus === "closed") && !hasPermission(actor, "quality.decide")) {
    throw new ApiError(
      403,
      "FORBIDDEN_EXCEPTION_CLOSURE",
      "Only authorized QA decision-makers ('quality.decide') can resolve or close a quality exception."
    );
  }

  const now = new Date().toISOString();
  const mergedEvidence: EvidenceItem[] = input.evidence
    ? [
        ...existing.evidence,
        ...input.evidence
          .filter((ev) => !existing.evidence.some((e) => e.id === ev.id))
          .map((ev, idx) => ({
            id: ev.id || `EV-EXC-${Date.now()}-${idx + 1}`,
            title: ev.title || `Exception Evidence #${existing.evidence.length + idx + 1}`,
            file_type: ev.file_type || "document",
            file_url: ev.file_url || `/evidence/${existing.exception_number}-${idx + 1}.pdf`,
            uploaded_by: ev.uploaded_by || actor.name,
            uploaded_at: ev.uploaded_at || now,
            notes: ev.notes ?? null
          }))
      ]
    : existing.evidence;

  const db = getDb();
  db.prepare(
    `UPDATE quality_exceptions
     SET investigation_notes = ?,
         resolution = ?,
         status = ?,
         severity = ?,
         evidence_json = ?,
         resolved_by = CASE WHEN ? IN ('resolved', 'closed') THEN ? ELSE resolved_by END,
         resolved_at = CASE WHEN ? IN ('resolved', 'closed') THEN ? ELSE resolved_at END,
         updated_at = ?
     WHERE id = ?`
  ).run(
    input.investigation_notes !== undefined ? input.investigation_notes : existing.investigation_notes,
    nextResolution,
    nextStatus,
    input.severity ?? existing.severity,
    JSON.stringify(mergedEvidence),
    nextStatus,
    actor.name,
    nextStatus,
    now,
    now,
    existing.id
  );

  recordAuditEvent({
    actor,
    action: "quality.exception_updated",
    entityType: "QualityException",
    entityId: existing.id,
    before: { status: existing.status, resolution: existing.resolution },
    after: { status: nextStatus, resolution: nextResolution }
  });

  return getExceptionDetail(actor, existing.id);
}

export function listCapas(
  actor: AuthenticatedUser,
  filters: {
    status?: string | null;
    warehouse?: string | null;
    supplier_id?: string | null;
    lot?: string | null;
    overdue_only?: boolean;
    search?: string | null;
  } = {}
): QualityCapa[] {
  assertPermission(actor, "quality.read");
  const db = getDb();
  const conditions: string[] = [];
  const params: string[] = [];

  const wf = buildWarehouseFilter(actor, filters.warehouse);
  if (wf.clause) {
    conditions.push(wf.clause);
    params.push(...wf.params);
  }
  if (filters.status && filters.status !== "ALL") {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters.supplier_id && filters.supplier_id !== "ALL") {
    conditions.push("(supplier_id = ? OR lower(COALESCE(supplier_name, '')) LIKE ?)");
    params.push(filters.supplier_id, `%${filters.supplier_id.toLowerCase()}%`);
  }
  if (filters.lot) {
    conditions.push("upper(internal_lot) = upper(?)");
    params.push(filters.lot);
  }
  if (filters.overdue_only) {
    conditions.push("status NOT IN ('Closed', 'Rejected') AND target_completion_date < ?");
    params.push(new Date().toISOString().slice(0, 10));
  }
  if (filters.search && filters.search.trim()) {
    const q = `%${filters.search.trim().toLowerCase()}%`;
    conditions.push(
      `(lower(capa_number) LIKE ? OR lower(problem_description) LIKE ? OR lower(COALESCE(internal_lot, '')) LIKE ? OR lower(COALESCE(supplier_name, '')) LIKE ?)`
    );
    params.push(q, q, q, q);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM quality_capas ${whereSql} ORDER BY created_at DESC, id DESC`)
    .all(...params) as Record<string, unknown>[];

  return rows.map(hydrateCapa);
}

export function getCapaDetail(actor: AuthenticatedUser, idOrNumber: string): QualityCapa {
  assertPermission(actor, "quality.read");
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM quality_capas WHERE id = ? OR capa_number = ?`)
    .get(idOrNumber, idOrNumber) as Record<string, unknown> | undefined;

  if (!row) {
    throw new ApiError(404, "CAPA_NOT_FOUND", `CAPA '${idOrNumber}' was not found.`);
  }
  const capa = hydrateCapa(row);
  requireRecordAccess(actor, { warehouse: capa.warehouse, supplier_id: capa.supplier_id });
  return capa;
}

export function createCapa(
  actor: AuthenticatedUser,
  input: {
    exception_id?: string | null;
    inspection_id?: string | null;
    shipment_id?: string | null;
    supplier_id?: string | null;
    supplier_name?: string | null;
    sku?: string | null;
    product_name?: string | null;
    internal_lot?: string | null;
    warehouse?: string;
    problem_description: string;
    root_cause?: string | null;
    containment_action?: string | null;
    corrective_action?: string | null;
    preventive_action?: string | null;
    assigned_to_id?: string | null;
    assigned_to_name: string;
    target_completion_date: string;
    evidence?: Partial<EvidenceItem>[];
  }
): QualityCapa {
  if (!hasPermission(actor, "quality.capa") && !hasPermission(actor, "quality.inspect") && !hasPermission(actor, "quality.decide")) {
    throw new ApiError(403, "FORBIDDEN_INSUFFICIENT_ROLE", `Role '${actor.role}' is not authorized to create CAPA records.`);
  }
  requireMutationAuthorization(actor, "create CAPA");

  if (!input.problem_description?.trim() || !input.assigned_to_name?.trim() || !input.target_completion_date?.trim()) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "problem_description, assigned_to_name, and target_completion_date are required."
    );
  }

  const warehouse = (input.warehouse || actor.warehouse || "Milan Cold Hub").trim();
  requireWarehouseAccess(actor, warehouse);

  const now = new Date().toISOString();
  const id = `CAP-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;
  const capaNumber = `CAPA-2026-${Math.floor(1000 + Math.random() * 8999)}`;

  const evidenceList: EvidenceItem[] = (input.evidence || []).map((ev, idx) => ({
    id: ev.id || `EV-CAPA-${Date.now()}-${idx + 1}`,
    title: ev.title || `CAPA Evidence #${idx + 1}`,
    file_type: ev.file_type || "document",
    file_url: ev.file_url || `/evidence/capa-${id}-${idx + 1}.pdf`,
    uploaded_by: ev.uploaded_by || actor.name,
    uploaded_at: ev.uploaded_at || now,
    notes: ev.notes ?? null
  }));

  withTransaction(() => {
    const db = getDb();
    db.prepare(
      `INSERT INTO quality_capas (
        id, capa_number, exception_id, inspection_id, shipment_id,
        supplier_id, supplier_name, sku, product_name, internal_lot, warehouse,
        problem_description, root_cause, containment_action, corrective_action, preventive_action,
        assigned_to_id, assigned_to_name, target_completion_date,
        evidence_json, status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Open', ?, ?, ?)`
    ).run(
      id,
      capaNumber,
      input.exception_id ?? null,
      input.inspection_id ?? null,
      input.shipment_id ?? null,
      input.supplier_id ?? null,
      input.supplier_name ?? null,
      input.sku ?? null,
      input.product_name ?? null,
      input.internal_lot ?? null,
      warehouse,
      input.problem_description.trim(),
      input.root_cause?.trim() || null,
      input.containment_action?.trim() || null,
      input.corrective_action?.trim() || null,
      input.preventive_action?.trim() || null,
      input.assigned_to_id ?? null,
      input.assigned_to_name.trim(),
      input.target_completion_date.trim(),
      JSON.stringify(evidenceList),
      actor.name,
      now,
      now
    );

    if (input.exception_id) {
      db.prepare(
        `UPDATE quality_exceptions
         SET status = CASE WHEN status = 'open' THEN 'capa_assigned' ELSE status END,
             updated_at = ?
         WHERE id = ? OR exception_number = ?`
      ).run(now, input.exception_id, input.exception_id);
    }

    recordAuditEvent({
      actor,
      action: "quality.capa_created",
      entityType: "QualityCapa",
      entityId: id,
      after: {
        capa_number: capaNumber,
        exception_id: input.exception_id,
        internal_lot: input.internal_lot,
        assigned_to_name: input.assigned_to_name,
        target_completion_date: input.target_completion_date
      }
    });
  });

  return getCapaDetail(actor, id);
}

export function updateCapa(
  actor: AuthenticatedUser,
  idOrNumber: string,
  input: Partial<{
    problem_description: string;
    root_cause: string | null;
    containment_action: string | null;
    corrective_action: string | null;
    preventive_action: string | null;
    assigned_to_name: string;
    target_completion_date: string;
    verification_notes: string | null;
    effectiveness_review: string | null;
    status: CapaStatus;
    evidence: Partial<EvidenceItem>[];
  }>
): QualityCapa {
  if (!hasPermission(actor, "quality.capa") && !hasPermission(actor, "quality.decide")) {
    throw new ApiError(403, "FORBIDDEN_INSUFFICIENT_ROLE", `Role '${actor.role}' is not authorized to update CAPAs.`);
  }
  requireMutationAuthorization(actor, "update CAPA");

  const existing = getCapaDetail(actor, idOrNumber);

  const rootCause = input.root_cause !== undefined ? input.root_cause?.trim() || null : existing.root_cause;
  const containmentAction =
    input.containment_action !== undefined ? input.containment_action?.trim() || null : existing.containment_action;
  const correctiveAction =
    input.corrective_action !== undefined ? input.corrective_action?.trim() || null : existing.corrective_action;
  const preventiveAction =
    input.preventive_action !== undefined ? input.preventive_action?.trim() || null : existing.preventive_action;
  const verificationNotes =
    input.verification_notes !== undefined ? input.verification_notes?.trim() || null : existing.verification_notes;
  const effectivenessReview =
    input.effectiveness_review !== undefined ? input.effectiveness_review?.trim() || null : existing.effectiveness_review;
  const nextStatus: CapaStatus = input.status ?? existing.status;

  // Enforce strict CAPA closure rules
  if (nextStatus === "Closed") {
    if (!hasPermission(actor, "quality.decide")) {
      throw new ApiError(
        403,
        "FORBIDDEN_CAPA_CLOSURE",
        `Role '${actor.role}' cannot verify and close a CAPA. QA approval ('quality.decide') is required.`
      );
    }
    if (!rootCause || !correctiveAction || !preventiveAction || (!verificationNotes && !effectivenessReview)) {
      throw new ApiError(
        400,
        "CAPA_VERIFICATION_REQUIRED",
        "A CAPA cannot be marked Closed until root_cause, corrective_action, preventive_action, and verification/effectiveness review are all completed."
      );
    }
  }

  const now = new Date().toISOString();
  const mergedEvidence: EvidenceItem[] = input.evidence
    ? [
        ...existing.evidence,
        ...input.evidence
          .filter((ev) => !existing.evidence.some((e) => e.id === ev.id))
          .map((ev, idx) => ({
            id: ev.id || `EV-CAPA-${Date.now()}-${idx + 1}`,
            title: ev.title || `CAPA Evidence #${existing.evidence.length + idx + 1}`,
            file_type: ev.file_type || "document",
            file_url: ev.file_url || `/evidence/${existing.capa_number}-${idx + 1}.pdf`,
            uploaded_by: ev.uploaded_by || actor.name,
            uploaded_at: ev.uploaded_at || now,
            notes: ev.notes ?? null
          }))
      ]
    : existing.evidence;

  const isClosed = nextStatus === "Closed";

  withTransaction(() => {
    const db = getDb();
    db.prepare(
      `UPDATE quality_capas
       SET problem_description = ?,
           root_cause = ?,
           containment_action = ?,
           corrective_action = ?,
           preventive_action = ?,
           assigned_to_name = ?,
           target_completion_date = ?,
           evidence_json = ?,
           verification_notes = ?,
           effectiveness_review = ?,
           verified_by_id = CASE WHEN ? = 1 THEN ? ELSE verified_by_id END,
           verified_by_name = CASE WHEN ? = 1 THEN ? ELSE verified_by_name END,
           verified_at = CASE WHEN ? = 1 THEN ? ELSE verified_at END,
           closed_at = CASE WHEN ? = 1 THEN ? ELSE closed_at END,
           status = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(
      input.problem_description?.trim() || existing.problem_description,
      rootCause,
      containmentAction,
      correctiveAction,
      preventiveAction,
      input.assigned_to_name?.trim() || existing.assigned_to_name,
      input.target_completion_date?.trim() || existing.target_completion_date,
      JSON.stringify(mergedEvidence),
      verificationNotes,
      effectivenessReview,
      isClosed ? 1 : 0,
      actor.id,
      isClosed ? 1 : 0,
      actor.name,
      isClosed ? 1 : 0,
      now,
      isClosed ? 1 : 0,
      now,
      nextStatus,
      now,
      existing.id
    );

    if (isClosed && existing.exception_id) {
      db.prepare(
        `UPDATE quality_exceptions
         SET status = 'closed',
             resolution = COALESCE(resolution, ?),
             resolved_by = COALESCE(resolved_by, ?),
             resolved_at = COALESCE(resolved_at, ?),
             updated_at = ?
         WHERE id = ?`
      ).run(
        `Resolved and verified via ${existing.capa_number}: ${effectivenessReview || verificationNotes}`,
        actor.name,
        now,
        now,
        existing.exception_id
      );
    }

    recordAuditEvent({
      actor,
      action: isClosed ? "quality.capa_closed" : "quality.capa_updated",
      entityType: "QualityCapa",
      entityId: existing.id,
      before: { status: existing.status, root_cause: existing.root_cause },
      after: {
        status: nextStatus,
        root_cause: rootCause,
        corrective_action: correctiveAction,
        preventive_action: preventiveAction,
        verification_notes: verificationNotes,
        effectiveness_review: effectivenessReview
      }
    });
  });

  return getCapaDetail(actor, existing.id);
}

export function getQualityHistory(
  actor: AuthenticatedUser,
  filters: {
    lot?: string | null;
    supplier_id?: string | null;
    sku?: string | null;
    warehouse?: string | null;
  }
): QualityHistorySummary {
  assertPermission(actor, "quality.read");
  const inspections = listInspections(actor, {
    lot: filters.lot,
    supplier_id: filters.supplier_id,
    sku: filters.sku,
    warehouse: filters.warehouse,
    page: 1,
    page_size: 100
  }).items;

  const exceptions = listExceptions(actor, {
    lot: filters.lot,
    warehouse: filters.warehouse,
    search: filters.supplier_id || filters.sku || null
  });

  const capas = listCapas(actor, {
    lot: filters.lot,
    supplier_id: filters.supplier_id,
    warehouse: filters.warehouse,
    search: filters.sku || null
  });

  const db = getDb();
  const inspectionIds = inspections.map((i) => i.id);
  let haccpReadings: HaccpCheckpointReading[] = [];
  if (inspectionIds.length > 0) {
    const placeholders = inspectionIds.map(() => "?").join(", ");
    const rows = db
      .prepare(`SELECT * FROM haccp_checkpoint_readings WHERE inspection_id IN (${placeholders}) ORDER BY recorded_at DESC`)
      .all(...inspectionIds) as Record<string, unknown>[];
    haccpReadings = rows.map(hydrateHaccpReading);
  } else if (filters.lot) {
    const rows = db
      .prepare(`SELECT * FROM haccp_checkpoint_readings WHERE upper(internal_lot) = upper(?) ORDER BY recorded_at DESC`)
      .all(filters.lot) as Record<string, unknown>[];
    haccpReadings = rows.map(hydrateHaccpReading);
  }

  const passCount = haccpReadings.filter((r) => r.status === "pass").length;
  const haccpPassRate =
    haccpReadings.length > 0 ? Number(((passCount / haccpReadings.length) * 100).toFixed(1)) : 100;

  return {
    query: {
      lot: filters.lot ?? null,
      supplier_id: filters.supplier_id ?? null,
      sku: filters.sku ?? null
    },
    inspections,
    haccp_readings: haccpReadings,
    exceptions,
    capas,
    stats: {
      total_inspections: inspections.length,
      released_count: inspections.filter((i) => i.status === "released" || i.status === "partially_released").length,
      rejected_count: inspections.filter((i) => i.status === "rejected").length,
      on_hold_count: inspections.filter((i) => i.status === "on_hold").length,
      quarantined_count: inspections.filter((i) => i.status === "quarantined").length,
      haccp_pass_rate_pct: haccpPassRate,
      recurring_exception_count: exceptions.length,
      open_capa_count: capas.filter((c) => c.status !== "Closed" && c.status !== "Rejected").length
    }
  };
}
