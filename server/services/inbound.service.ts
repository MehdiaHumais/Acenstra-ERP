import fs from "node:fs";
import path from "node:path";
import { getDb, withTransaction } from "@/server/db/connection";
import { ApiError } from "@/server/core/http";
import {
  AuthenticatedUser,
  assertPermission,
  hasPermission,
  recordAuditEvent,
  requireMutationAuthorization,
  requireWarehouseAccess,
  requireRecordAccess
} from "@/server/security/auth";
import { listSuppliers } from "./master-data.service";
import { listProducts } from "./product-master.service";

const DOCUMENT_DIR = path.join(process.cwd(), "data", "inbound-documents");
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

function ensureDocDir() {
  fs.mkdirSync(DOCUMENT_DIR, { recursive: true });
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateOnly(value: unknown): string | null {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, 10);
}

function isoDateTimeOrDate(value: unknown): string | null {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length >= 16 && (text.includes("T") || text.includes(" "))) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
    return text;
  }
  return text.slice(0, 10);
}

function num(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function nullableStr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function actorWarehouse(actor: AuthenticatedUser): string | null {
  return actor.warehouse ?? null;
}

function assertRead(actor: AuthenticatedUser) {
  assertPermission(actor, "inbound.read");
}

function assertManage(actor: AuthenticatedUser) {
  assertPermission(actor, "inbound.manage");
  requireMutationAuthorization(actor, "manage inbound shipment");
}

function canArrival(actor: AuthenticatedUser, shipment: { destination_warehouse: string; driver_name?: string | null }) {
  if (hasPermission(actor, "inbound.arrival")) return true;
  if (hasPermission(actor, "inbound.driver_update")) {
    if (actor.role === "driver") {
      const driver = shipment.driver_name || "";
      if (driver && driver.toLowerCase() !== (actor.name || "").toLowerCase() && driver.toLowerCase() !== (actor.email || "").toLowerCase() && driver !== actor.id) {
        return false;
      }
      return true;
    }
    return true;
  }
  return false;
}

function canReceive(actor: AuthenticatedUser) {
  if (hasPermission(actor, "inbound.receive")) return true;
  return false;
}

function canTemperature(actor: AuthenticatedUser, shipment: { driver_name?: string | null }) {
  if (hasPermission(actor, "inbound.temperature")) return true;
  if (hasPermission(actor, "inbound.driver_update")) {
    if (actor.role === "driver") {
      const driver = shipment.driver_name || "";
      if (driver && driver.toLowerCase() !== (actor.name || "").toLowerCase() && driver.toLowerCase() !== (actor.email || "").toLowerCase() && driver !== actor.id) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function canQuality(actor: AuthenticatedUser) {
  return hasPermission(actor, "inbound.quality");
}

function canDocuments(actor: AuthenticatedUser) {
  return hasPermission(actor, "inbound.documents");
}

function canDecision(actor: AuthenticatedUser) {
  return hasPermission(actor, "inbound.decision");
}

function scopeShipment(actor: AuthenticatedUser, shipment: { destination_warehouse: string; driver_name?: string | null }) {
  requireRecordAccess(actor, { warehouse: shipment.destination_warehouse });
  if (actor.role === "driver") {
    const driver = shipment.driver_name || "";
    if (driver && driver.toLowerCase() !== (actor.name || "").toLowerCase() && driver.toLowerCase() !== (actor.email || "").toLowerCase() && driver !== actor.id) {
      throw new ApiError(403, "FORBIDDEN_DRIVER_SCOPE", "Driver can only access assigned shipments.");
    }
  }
}

function loadShipment(id: string) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM inbound_shipments WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) throw new ApiError(404, "SHIPMENT_NOT_FOUND", "Inbound shipment not found.");
  return row;
}

function rowToShipment(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    shipment_ref: String(row.shipment_ref),
    supplier_id: row.supplier_id ? String(row.supplier_id) : null,
    supplier_name: String(row.supplier_name),
    po_id: row.po_id ? String(row.po_id) : null,
    po_number: row.po_number ? String(row.po_number) : null,
    asn_reference: row.asn_reference ? String(row.asn_reference) : null,
    carrier: row.carrier ? String(row.carrier) : null,
    vehicle_reg: row.vehicle_reg ? String(row.vehicle_reg) : null,
    driver_name: row.driver_name ? String(row.driver_name) : null,
    driver_phone: row.driver_phone ? String(row.driver_phone) : null,
    expected_arrival: row.expected_arrival ? String(row.expected_arrival) : null,
    actual_arrival: row.actual_arrival ? String(row.actual_arrival) : null,
    origin_warehouse: row.origin_warehouse ? String(row.origin_warehouse) : null,
    destination_warehouse: String(row.destination_warehouse),
    status: String(row.status),
    transport_notes: row.transport_notes ? String(row.transport_notes) : null,
    created_by: String(row.created_by),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

function listItems(shipmentId: string) {
  const db = getDb();
  return db.prepare("SELECT * FROM inbound_shipment_items WHERE shipment_id = ? ORDER BY created_at").all(shipmentId).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      shipment_id: String(row.shipment_id),
      sku: String(row.sku),
      product_name: String(row.product_name),
      ordered_qty: Number(row.ordered_qty ?? 0),
      ordered_uom: row.ordered_uom ? String(row.ordered_uom) : null,
      received_qty: Number(row.received_qty ?? 0),
      accepted_qty: Number(row.accepted_qty ?? 0),
      rejected_qty: Number(row.rejected_qty ?? 0),
      damaged_qty: Number(row.damaged_qty ?? 0),
      actual_weight: row.actual_weight !== null && row.actual_weight !== undefined ? Number(row.actual_weight) : null,
      expected_weight: row.expected_weight !== null && row.expected_weight !== undefined ? Number(row.expected_weight) : null,
      weight_uom: row.weight_uom ? String(row.weight_uom) : null,
      weight_variance_pct: row.weight_variance_pct !== null && row.weight_variance_pct !== undefined ? Number(row.weight_variance_pct) : null,
      weight_discrepancy_status: row.weight_discrepancy_status ? String(row.weight_discrepancy_status) : null,
      scale_reference: row.scale_reference ? String(row.scale_reference) : null,
      weight_tolerance_pct: row.weight_tolerance_pct !== null && row.weight_tolerance_pct !== undefined ? Number(row.weight_tolerance_pct) : null,
      packages: Number(row.packages ?? 0),
      notes: row.notes ? String(row.notes) : null,
      discrepancy_status: row.discrepancy_status ? String(row.discrepancy_status) : null,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at)
    };
  });
}

function listBatches(shipmentId: string) {
  const db = getDb();
  return db.prepare("SELECT * FROM inbound_batches WHERE shipment_id = ? ORDER BY created_at").all(shipmentId).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      shipment_id: String(row.shipment_id),
      item_id: row.item_id ? String(row.item_id) : null,
      sku: String(row.sku),
      product_name: String(row.product_name),
      supplier_batch: String(row.supplier_batch),
      internal_lot: String(row.internal_lot),
      supplier_id: row.supplier_id ? String(row.supplier_id) : null,
      supplier_name: row.supplier_name ? String(row.supplier_name) : null,
      po_id: row.po_id ? String(row.po_id) : null,
      po_number: row.po_number ? String(row.po_number) : null,
      manufacture_date: row.manufacture_date ? String(row.manufacture_date) : null,
      expiry_date: String(row.expiry_date),
      received_date: String(row.received_date),
      origin: row.origin ? String(row.origin) : null,
      quantity: Number(row.quantity ?? 0),
      unit: String(row.unit),
      storage: row.storage ? String(row.storage) : null,
      status: String(row.status),
      accepted_qty: Number(row.accepted_qty ?? 0),
      rejected_qty: Number(row.rejected_qty ?? 0),
      quarantined_qty: Number(row.quarantined_qty ?? 0),
      created_at: String(row.created_at)
    };
  });
}

function listTemps(shipmentId: string) {
  const db = getDb();
  return db.prepare("SELECT * FROM inbound_temperature_logs WHERE shipment_id = ? ORDER BY recorded_at DESC").all(shipmentId).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      shipment_id: String(row.shipment_id),
      sku: row.sku ? String(row.sku) : null,
      temp_c: Number(row.temp_c),
      unit: String(row.unit),
      min_c: Number(row.min_c),
      max_c: Number(row.max_c),
      recorded_at: String(row.recorded_at),
      recorded_by: String(row.recorded_by),
      verified_by: row.verified_by ? String(row.verified_by) : null,
      excursion: Number(row.excursion ?? 0) === 1,
      notes: row.notes ? String(row.notes) : null,
      evidence_ref: row.evidence_ref ? String(row.evidence_ref) : null,
      created_at: String(row.created_at)
    };
  });
}

function listDocs(shipmentId: string) {
  const db = getDb();
  return db.prepare("SELECT * FROM inbound_documents WHERE shipment_id = ? ORDER BY uploaded_at DESC").all(shipmentId).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      shipment_id: String(row.shipment_id),
      sku: row.sku ? String(row.sku) : null,
      doc_type: String(row.doc_type),
      reference_number: row.reference_number ? String(row.reference_number) : null,
      issuer: row.issuer ? String(row.issuer) : null,
      issue_date: row.issue_date ? String(row.issue_date) : null,
      expiry_date: row.expiry_date ? String(row.expiry_date) : null,
      file_name: String(row.file_name),
      mime_type: String(row.mime_type),
      size_bytes: Number(row.size_bytes),
      storage_path: String(row.storage_path),
      status: String(row.status),
      verified_by: row.verified_by ? String(row.verified_by) : null,
      verified_at: row.verified_at ? String(row.verified_at) : null,
      review_notes: row.review_notes ? String(row.review_notes) : null,
      uploaded_by: String(row.uploaded_by),
      uploaded_at: String(row.uploaded_at)
    };
  });
}

function listQCs(shipmentId: string) {
  const db = getDb();
  return db.prepare("SELECT * FROM inbound_quality_checks WHERE shipment_id = ? ORDER BY performed_at DESC").all(shipmentId).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      shipment_id: String(row.shipment_id),
      item_id: row.item_id ? String(row.item_id) : null,
      check_type: String(row.check_type),
      result: String(row.result),
      notes: row.notes ? String(row.notes) : null,
      evidence: row.evidence ? String(row.evidence) : null,
      performed_by: String(row.performed_by),
      performed_at: String(row.performed_at)
    };
  });
}

export function listShipments(actor: AuthenticatedUser, filters: {
  status?: string;
  supplier?: string;
  destination?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  assertRead(actor);
  const db = getDb();
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
  const offset = (page - 1) * limit;
  const where: string[] = [];
  const params: unknown[] = [];

  if (actor.role === "driver") {
    where.push("(lower(driver_name) = lower(?) OR driver_name = ?)");
    params.push(actor.name, actor.id);
  } else if (!["super_admin", "administrator", "ceo", "management"].includes(actor.role)) {
    if (actor.warehouse) {
      where.push("destination_warehouse = ?");
      params.push(actor.warehouse);
    }
  }

  if (filters.status) { where.push("status = ?"); params.push(filters.status); }
  if (filters.supplier) { where.push("(supplier_id = ? OR lower(supplier_name) LIKE ?)"); params.push(filters.supplier, `%${filters.supplier.toLowerCase()}%`); }
  if (filters.destination) { where.push("destination_warehouse = ?"); params.push(filters.destination); }
  if (filters.search) {
    where.push("(shipment_ref LIKE ? OR supplier_name LIKE ? OR po_number LIKE ? OR asn_reference LIKE ?)");
    const q = `%${filters.search}%`;
    params.push(q, q, q, q);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) as c FROM inbound_shipments ${whereSql}`).get(...(params as any[])) as { c: number }).c;
  const rows = db.prepare(`SELECT * FROM inbound_shipments ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...(params as any), limit, offset) as Record<string, unknown>[];
  return {
    shipments: rows.map(rowToShipment),
    total,
    page,
    limit
  };
}

export function getShipmentDetail(actor: AuthenticatedUser, id: string) {
  assertRead(actor);
  const row = loadShipment(id);
  const shipment = rowToShipment(row);
  scopeShipment(actor, shipment);
  const items = listItems(id);
  const batches = listBatches(id);
  const temperature_logs = listTemps(id);
  const documents = listDocs(id);
  const quality_checks = listQCs(id);
  const todayStr = today();
  const exceptions = {
    temp_excursions: temperature_logs.filter((t) => t.excursion).length,
    expired_documents: documents.filter((d) => d.status === "expired" || (d.expiry_date && d.expiry_date < todayStr)).length,
    rejected_documents: documents.filter((d) => d.status === "rejected").length,
    unverified_documents: documents.filter((d) => d.status === "pending_review").length,
    missing_documents: documents.length === 0,
    qty_discrepancies: items.filter((i) => i.discrepancy_status && i.discrepancy_status !== "match").length,
    weight_discrepancies: items.filter((i) => i.weight_discrepancy_status && i.weight_discrepancy_status !== "within_tolerance").length,
    failed_quality_checks: quality_checks.filter((q) => q.result === "fail").length
  };
  return {
    shipment,
    items,
    batches,
    temperature_logs,
    documents,
    quality_checks,
    exceptions
  };
}

export function createShipment(actor: AuthenticatedUser, input: Record<string, unknown>) {
  assertManage(actor);
  const db = getDb();
  const supplierName = str(input.supplier_name || input.supplier);
  if (!supplierName) throw new ApiError(400, "INVALID_INPUT", "supplier_name is required.");
  const destination = str(input.destination_warehouse || input.destination || actor.warehouse);
  if (!destination) throw new ApiError(400, "INVALID_INPUT", "destination_warehouse is required.");
  requireWarehouseAccess(actor, destination);

  let shipmentRef = str(input.shipment_ref);
  if (!shipmentRef) {
    shipmentRef = `IB-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  }
  // ensure unique
  const existing = db.prepare("SELECT id FROM inbound_shipments WHERE shipment_ref = ?").get(shipmentRef);
  if (existing) throw new ApiError(409, "DUPLICATE_SHIPMENT_REF", "Shipment reference already exists.");

  const id = newId("ISH");
  const supplierId = nullableStr(input.supplier_id);
  const poId = nullableStr(input.po_id);
  const poNumber = nullableStr(input.po_number);
  const asn = nullableStr(input.asn_reference);
  const carrier = nullableStr(input.carrier);
  const vehicle = nullableStr(input.vehicle_reg);
  const driverName = nullableStr(input.driver_name);
  const driverPhone = nullableStr(input.driver_phone);
  const expectedArrival = isoDateTimeOrDate(input.expected_arrival);
  const origin = nullableStr(input.origin_warehouse);
  const notes = nullableStr(input.transport_notes || input.notes);
  const status = str(input.status || "expected");
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO inbound_shipments (id, shipment_ref, supplier_id, supplier_name, po_id, po_number, asn_reference, carrier, vehicle_reg, driver_name, driver_phone, expected_arrival, actual_arrival, origin_warehouse, destination_warehouse, status, transport_notes, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, shipmentRef, supplierId, supplierName, poId, poNumber, asn, carrier, vehicle, driverName, driverPhone, expectedArrival, origin, destination, status, notes, actor.email, now, now);

  // optional items
  const items = Array.isArray(input.items) ? input.items : [];
  for (const it of items) {
    const sku = str((it as Record<string, unknown>).sku);
    if (!sku) continue;
    const productName = str((it as Record<string, unknown>).product_name || sku);
    const itemId = newId("ISI");
    db.prepare(`
      INSERT INTO inbound_shipment_items (id, shipment_id, sku, product_name, ordered_qty, ordered_uom, received_qty, accepted_qty, rejected_qty, damaged_qty, actual_weight, weight_uom, packages, notes, discrepancy_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, NULL, NULL, 0, ?, NULL, ?, ?)
    `).run(itemId, id, sku, productName, num((it as Record<string, unknown>).ordered_qty), nullableStr((it as Record<string, unknown>).ordered_uom || "case"), nullableStr((it as Record<string, unknown>).notes), now, now);
  }

  recordAuditEvent({ actor, action: "inbound.shipment_created", entityType: "InboundShipment", entityId: id, after: { shipment_ref: shipmentRef, supplier_name: supplierName, destination }, ipAddress: "127.0.0.1" });
  return getShipmentDetail(actor, id);
}

export function updateShipment(actor: AuthenticatedUser, id: string, input: Record<string, unknown>) {
  assertManage(actor);
  const row = loadShipment(id);
  const shipment = rowToShipment(row);
  scopeShipment(actor, shipment);
  const db = getDb();
  const fields: string[] = [];
  const params: unknown[] = [];
  const map: Record<string, string> = {
    shipment_ref: "shipment_ref",
    supplier_id: "supplier_id",
    supplier_name: "supplier_name",
    po_id: "po_id",
    po_number: "po_number",
    asn_reference: "asn_reference",
    carrier: "carrier",
    vehicle_reg: "vehicle_reg",
    driver_name: "driver_name",
    driver_phone: "driver_phone",
    expected_arrival: "expected_arrival",
    origin_warehouse: "origin_warehouse",
    destination_warehouse: "destination_warehouse",
    status: "status",
    transport_notes: "transport_notes"
  };
  for (const [key, col] of Object.entries(map)) {
    if (input[key] !== undefined) {
      let val: unknown = input[key];
      if (key === "expected_arrival") val = isoDateTimeOrDate(val);
      fields.push(`${col} = ?`);
      params.push(val === "" ? null : val);
    }
  }
  if (input.destination_warehouse !== undefined) {
    requireWarehouseAccess(actor, String(input.destination_warehouse));
  }
  if (fields.length === 0) return getShipmentDetail(actor, id);
  fields.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(id);
  db.prepare(`UPDATE inbound_shipments SET ${fields.join(", ")} WHERE id = ?`).run(...(params as never[]));
  recordAuditEvent({ actor, action: "inbound.shipment_updated", entityType: "InboundShipment", entityId: id, before: shipment, after: input });
  return getShipmentDetail(actor, id);
}

export function recordArrival(actor: AuthenticatedUser, id: string, input: Record<string, unknown>) {
  const row = loadShipment(id);
  const shipment = rowToShipment(row);
  scopeShipment(actor, shipment);
  if (!canArrival(actor, shipment)) throw new ApiError(403, "FORBIDDEN_INBOUND_ARRIVAL", "Not authorized to record arrival.");
  const db = getDb();
  const actualArrival = isoDateTimeOrDate(input.actual_arrival) || new Date().toISOString();
  const status = str(input.status || "arrived");
  db.prepare("UPDATE inbound_shipments SET actual_arrival = ?, status = ?, transport_notes = COALESCE(?, transport_notes), updated_at = ? WHERE id = ?").run(actualArrival, status, nullableStr(input.transport_notes), new Date().toISOString(), id);
  recordAuditEvent({ actor, action: "inbound.arrival_recorded", entityType: "InboundShipment", entityId: id, after: { actual_arrival: actualArrival, status } });
  return getShipmentDetail(actor, id);
}

export function addTemperature(actor: AuthenticatedUser, id: string, input: Record<string, unknown>) {
  const row = loadShipment(id);
  const shipment = rowToShipment(row);
  scopeShipment(actor, shipment);
  if (!canTemperature(actor, shipment)) throw new ApiError(403, "FORBIDDEN_INBOUND_TEMPERATURE", "Not authorized to record temperature.");
  const rawTemp = num(input.temp_c);
  const unit = str(input.unit || "C");
  const tempC = unit.toUpperCase() === "F" ? Math.round(((rawTemp - 32) * 5 / 9) * 100) / 100 : rawTemp;
  let sku = nullableStr(input.sku);
  let minC = input.min_c !== undefined && input.min_c !== null && input.min_c !== "" ? num(input.min_c) : null;
  let maxC = input.max_c !== undefined && input.max_c !== null && input.max_c !== "" ? num(input.max_c) : null;

  if (minC === null || maxC === null) {
    const db = getDb();
    let lookupSku = sku;
    if (!lookupSku) {
      const firstItem = db.prepare("SELECT sku FROM inbound_shipment_items WHERE shipment_id = ? ORDER BY created_at LIMIT 1").get(id) as { sku: string } | undefined;
      if (firstItem) lookupSku = firstItem.sku;
    }
    if (lookupSku) {
      const prod = db.prepare("SELECT temp_min_c, temp_max_c, temp_zone FROM products WHERE sku = ?").get(lookupSku) as Record<string, unknown> | undefined;
      if (prod) {
        if (minC === null && prod.temp_min_c !== null && prod.temp_min_c !== undefined) minC = Number(prod.temp_min_c);
        if (maxC === null && prod.temp_max_c !== null && prod.temp_max_c !== undefined) maxC = Number(prod.temp_max_c);
      }
    }
  }
  if (minC === null || maxC === null) {
    throw new ApiError(400, "INVALID_INPUT", "min_c and max_c are required when product thresholds are not configured.");
  }
  const recordedAt = str(input.recorded_at || new Date().toISOString());
  const excursion = tempC < minC || tempC > maxC ? 1 : 0;
  const logId = newId("ITL");
  const db = getDb();
  db.prepare(`
    INSERT INTO inbound_temperature_logs (id, shipment_id, sku, temp_c, unit, min_c, max_c, recorded_at, recorded_by, verified_by, excursion, notes, evidence_ref, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(logId, id, sku, tempC, unit, minC, maxC, recordedAt, actor.email, nullableStr(input.verified_by), excursion, nullableStr(input.notes), nullableStr(input.evidence_ref), new Date().toISOString());
  recordAuditEvent({ actor, action: "inbound.temperature_recorded", entityType: "InboundTemperatureLog", entityId: logId, after: { shipment_id: id, temp_c: tempC, excursion: Boolean(excursion) } });
  return listTemps(id).find((t) => t.id === logId)!;
}

export function addDocument(actor: AuthenticatedUser, id: string, input: Record<string, unknown>) {
  const row = loadShipment(id);
  const shipment = rowToShipment(row);
  scopeShipment(actor, shipment);
  if (!canDocuments(actor)) throw new ApiError(403, "FORBIDDEN_INBOUND_DOCUMENTS", "Not authorized to manage documents.");
  const docType = str(input.doc_type);
  if (!docType) throw new ApiError(400, "INVALID_INPUT", "doc_type is required.");
  const fileName = str(input.file_name);
  const mimeType = str(input.mime_type);
  const content = str(input.content_base64);
  if (!fileName || !mimeType || !content) throw new ApiError(400, "INVALID_INPUT", "file_name, mime_type, and content_base64 are required.");
  if (!ALLOWED_MIME.has(mimeType)) throw new ApiError(400, "INVALID_FILE_TYPE", "File type not allowed.");
  let buffer: Buffer;
  try {
    buffer = Buffer.from(content, "base64");
  } catch {
    throw new ApiError(400, "INVALID_FILE", "Invalid base64 content.");
  }
  if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) throw new ApiError(400, "INVALID_FILE_SIZE", "File must be between 1 byte and 5 MB.");

  ensureDocDir();
  const docId = newId("IDOC");
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = path.join(DOCUMENT_DIR, `${docId}-${safeName}`);
  fs.writeFileSync(storagePath, buffer);

  const db = getDb();
  const relativePath = path.relative(process.cwd(), storagePath);
  db.prepare(`
    INSERT INTO inbound_documents (id, shipment_id, sku, doc_type, reference_number, issuer, issue_date, expiry_date, file_name, mime_type, size_bytes, storage_path, status, verified_by, verified_at, review_notes, uploaded_by, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', NULL, NULL, NULL, ?, ?)
  `).run(docId, id, nullableStr(input.sku), docType, nullableStr(input.reference_number), nullableStr(input.issuer), dateOnly(input.issue_date), dateOnly(input.expiry_date), fileName, mimeType, buffer.length, relativePath, actor.email, new Date().toISOString());

  recordAuditEvent({ actor, action: "inbound.document_uploaded", entityType: "InboundDocument", entityId: docId, after: { shipment_id: id, doc_type: docType, file_name: fileName } });
  return listDocs(id).find((d) => d.id === docId)!;
}

export function getDocumentPath(actor: AuthenticatedUser, shipmentId: string, docId: string): string {
  assertRead(actor);
  const row = loadShipment(shipmentId);
  const shipment = rowToShipment(row);
  scopeShipment(actor, shipment);
  const db = getDb();
  const doc = db.prepare("SELECT * FROM inbound_documents WHERE id = ? AND shipment_id = ?").get(docId, shipmentId) as Record<string, unknown> | undefined;
  if (!doc) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "Document not found.");
  if (!canDocuments(actor) && !canQuality(actor) && !canDecision(actor) && !["super_admin", "warehouse_manager", "qa", "finance", "ceo"].includes(actor.role)) {
    throw new ApiError(403, "FORBIDDEN_INBOUND_DOCUMENTS", "Not authorized to download quality documents.");
  }
  const fullPath = path.join(process.cwd(), String(doc.storage_path));
  if (!fs.existsSync(fullPath)) throw new ApiError(404, "FILE_NOT_FOUND", "Stored file not found.");
  return fullPath;
}

export function verifyDocument(actor: AuthenticatedUser, shipmentId: string, docId: string, input: Record<string, unknown>) {
  const row = loadShipment(shipmentId);
  const shipment = rowToShipment(row);
  scopeShipment(actor, shipment);
  if (!canDocuments(actor)) throw new ApiError(403, "FORBIDDEN_INBOUND_DOCUMENTS", "Not authorized to verify documents.");
  const db = getDb();
  const doc = db.prepare("SELECT * FROM inbound_documents WHERE id = ? AND shipment_id = ?").get(docId, shipmentId) as Record<string, unknown> | undefined;
  if (!doc) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "Document not found.");
  const status = str(input.status);
  if (!["pending_review", "verified", "rejected", "expired"].includes(status)) throw new ApiError(400, "INVALID_STATUS", "Invalid document status.");
  if (status === "verified" && doc.expiry_date && String(doc.expiry_date) < today()) {
    throw new ApiError(400, "DOCUMENT_EXPIRED", "Cannot verify an expired certificate. Mark as expired or upload a valid certificate.");
  }
  const now = new Date().toISOString();
  db.prepare("UPDATE inbound_documents SET status = ?, verified_by = ?, verified_at = ?, review_notes = ? WHERE id = ?").run(status, actor.email, now, nullableStr(input.review_notes), docId);
  recordAuditEvent({ actor, action: "inbound.document_verified", entityType: "InboundDocument", entityId: docId, before: { status: doc.status }, after: { shipment_id: shipmentId, status } });
  return listDocs(shipmentId).find((d) => d.id === docId)!;
}

export function addQualityCheck(actor: AuthenticatedUser, id: string, input: Record<string, unknown>) {
  const row = loadShipment(id);
  const shipment = rowToShipment(row);
  scopeShipment(actor, shipment);
  if (!canQuality(actor)) throw new ApiError(403, "FORBIDDEN_INBOUND_QUALITY", "Not authorized to perform quality checks.");
  const checkType = str(input.check_type);
  const result = str(input.result);
  if (!checkType || !result) throw new ApiError(400, "INVALID_INPUT", "check_type and result are required.");
  const qcId = newId("IQC");
  const db = getDb();
  db.prepare(`
    INSERT INTO inbound_quality_checks (id, shipment_id, item_id, check_type, result, notes, evidence, performed_by, performed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(qcId, id, nullableStr(input.item_id), checkType, result, nullableStr(input.notes), nullableStr(input.evidence), actor.email, new Date().toISOString());
  recordAuditEvent({ actor, action: "inbound.quality_check_recorded", entityType: "InboundQualityCheck", entityId: qcId, after: { shipment_id: id, check_type: checkType, result } });
  return listQCs(id).find((q) => q.id === qcId)!;
}

function validateBatch(batch: Record<string, unknown>) {
  const supplierBatch = str(batch.supplier_batch);
  const internalLot = str(batch.internal_lot || batch.lot_number);
  const expiry = dateOnly(batch.expiry_date);
  const manufacture = dateOnly(batch.manufacture_date);
  const quantity = num(batch.quantity);
  const unit = str(batch.unit || "case");
  if (!supplierBatch) throw new ApiError(400, "INVALID_BATCH", "supplier_batch is required.");
  if (!internalLot) throw new ApiError(400, "INVALID_BATCH", "internal_lot is required.");
  if (!expiry) throw new ApiError(400, "INVALID_BATCH", "expiry_date is required.");
  if (manufacture && expiry < manufacture) throw new ApiError(400, "INVALID_DATES", "expiry_date must not precede manufacture_date.");
  if (quantity <= 0) throw new ApiError(400, "INVALID_BATCH", "quantity must be greater than zero.");
  return { supplierBatch, internalLot, expiry, manufacture, quantity, unit };
}

export function receiveGoods(actor: AuthenticatedUser, id: string, input: Record<string, unknown>) {
  if (!canReceive(actor)) throw new ApiError(403, "FORBIDDEN_INBOUND_RECEIVE", "Not authorized to receive goods.");
  requireMutationAuthorization(actor, "receive inbound goods");
  const row = loadShipment(id);
  const shipment = rowToShipment(row);
  scopeShipment(actor, shipment);

  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length === 0) throw new ApiError(400, "INVALID_INPUT", "items are required.");

  return withTransaction(() => {
    const db = getDb();
    const now = new Date().toISOString();
    for (const raw of items) {
      const it = raw as Record<string, unknown>;
      const sku = str(it.sku);
      if (!sku) throw new ApiError(400, "INVALID_INPUT", "sku is required for each item.");
      const prod = db.prepare("SELECT name, catch_weight, case_weight_kg, unit_weight_kg, weight_tolerance_pct FROM products WHERE sku = ?").get(sku) as Record<string, unknown> | undefined;
      const productName = str(it.product_name || (prod ? prod.name : null) || sku);
      const orderedQty = num(it.ordered_qty);
      const receivedQty = num(it.received_qty);
      const acceptedQty = num(it.accepted_qty);
      const rejectedQty = num(it.rejected_qty);
      const damagedQty = num(it.damaged_qty);
      const actualWeight = it.actual_weight !== undefined && it.actual_weight !== null && it.actual_weight !== "" ? num(it.actual_weight) : null;
      let expectedWeight = it.expected_weight !== undefined && it.expected_weight !== null && it.expected_weight !== "" ? num(it.expected_weight) : null;
      if (expectedWeight === null && actualWeight !== null && prod && Number(prod.catch_weight ?? 0) === 1) {
        const unitW = Number(prod.case_weight_kg || prod.unit_weight_kg || 0);
        if (unitW > 0 && orderedQty > 0) {
          expectedWeight = Math.round(orderedQty * unitW * 100) / 100;
        }
      }
      const weightUom = nullableStr(it.weight_uom || (actualWeight !== null ? "kg" : null));
      const packages = num(it.packages || receivedQty);
      const notes = nullableStr(it.notes);
      const orderedUom = nullableStr(it.ordered_uom || "case");
      const scaleReference = nullableStr(it.scale_reference);
      const tolerance =
        it.weight_tolerance_pct !== undefined && it.weight_tolerance_pct !== null && it.weight_tolerance_pct !== ""
          ? num(it.weight_tolerance_pct)
          : prod && prod.weight_tolerance_pct !== null && prod.weight_tolerance_pct !== undefined
            ? Number(prod.weight_tolerance_pct)
            : null;

      let weightVariancePct: number | null = null;
      let weightDiscrepancyStatus: string | null = null;
      if (expectedWeight !== null && actualWeight !== null && expectedWeight > 0) {
        weightVariancePct = Math.round(((actualWeight - expectedWeight) / expectedWeight) * 10000) / 100;
        const tol = tolerance !== null ? tolerance : 5;
        const absVariance = Math.abs(weightVariancePct);
        weightDiscrepancyStatus = absVariance <= tol ? "within_tolerance" : (actualWeight < expectedWeight ? "short" : "excess");
      }

      // upsert item by sku
      const existingItem = db.prepare("SELECT id FROM inbound_shipment_items WHERE shipment_id = ? AND sku = ?").get(id, sku) as { id: string } | undefined;
      let itemId: string;
      const disc = receivedQty === 0 ? "missing" : receivedQty < orderedQty ? "short" : receivedQty > orderedQty ? "excess" : "match";
      if (existingItem) {
        itemId = existingItem.id;
        db.prepare(`
          UPDATE inbound_shipment_items SET product_name=?, ordered_qty=?, ordered_uom=?, received_qty=?, accepted_qty=?, rejected_qty=?, damaged_qty=?, actual_weight=?, expected_weight=?, weight_uom=?, weight_variance_pct=?, weight_discrepancy_status=?, scale_reference=?, weight_tolerance_pct=?, packages=?, notes=?, discrepancy_status=?, updated_at=? WHERE id=?
        `).run(productName, orderedQty, orderedUom, receivedQty, acceptedQty, rejectedQty, damagedQty, actualWeight, expectedWeight, weightUom, weightVariancePct, weightDiscrepancyStatus, scaleReference, tolerance, packages, notes, disc, now, itemId);
      } else {
        itemId = newId("ISI");
        db.prepare(`
          INSERT INTO inbound_shipment_items (id, shipment_id, sku, product_name, ordered_qty, ordered_uom, received_qty, accepted_qty, rejected_qty, damaged_qty, actual_weight, expected_weight, weight_uom, weight_variance_pct, weight_discrepancy_status, scale_reference, weight_tolerance_pct, packages, notes, discrepancy_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(itemId, id, sku, productName, orderedQty, orderedUom, receivedQty, acceptedQty, rejectedQty, damagedQty, actualWeight, expectedWeight, weightUom, weightVariancePct, weightDiscrepancyStatus, scaleReference, tolerance, packages, notes, disc, now, now);
      }

      // batches
      const batches = Array.isArray(it.batches) ? it.batches : [];
      for (const rawBatch of batches) {
        const b = rawBatch as Record<string, unknown>;
        const { supplierBatch, internalLot, expiry, manufacture, quantity, unit } = validateBatch(b);
        const receivedDate = dateOnly(b.received_date) || today();
        const origin = nullableStr(b.origin);
        const storage = nullableStr(b.storage);

        // duplicate check
        const dup = db.prepare("SELECT id FROM inbound_batches WHERE supplier_batch = ? AND sku = ? AND (supplier_id IS ? OR supplier_id = ?)").get(supplierBatch, sku, shipment.supplier_id, shipment.supplier_id) as { id: string } | undefined;
        if (dup) throw new ApiError(409, "DUPLICATE_BATCH", "Duplicate supplier batch for this product/supplier.");

        // internal lot uniqueness
        const lotDup = db.prepare("SELECT id FROM inbound_batches WHERE internal_lot = ?").get(internalLot) as { id: string } | undefined;
        if (lotDup) throw new ApiError(409, "DUPLICATE_INTERNAL_LOT", "Internal lot number already exists.");

        // also ensure not duplicate in inventory_lots
        const invDup = db.prepare("SELECT id FROM inventory_lots WHERE batch_id = ?").get(internalLot) as { id: string } | undefined;
        if (invDup) throw new ApiError(409, "DUPLICATE_INTERNAL_LOT", "Internal lot number already exists in inventory.");

        const batchId = newId("IBT");
        db.prepare(`
          INSERT INTO inbound_batches (id, shipment_id, item_id, sku, product_name, supplier_batch, internal_lot, supplier_id, supplier_name, po_id, po_number, manufacture_date, expiry_date, received_date, origin, quantity, unit, storage, status, accepted_qty, rejected_qty, quarantined_qty, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', 0, 0, 0, ?)
        `).run(batchId, id, itemId, sku, productName, supplierBatch, internalLot, shipment.supplier_id, shipment.supplier_name, shipment.po_id, shipment.po_number, manufacture, expiry, receivedDate, origin, quantity, unit, storage, now);

        // Automatically enqueue a pending Receiving Quality Inspection in Quality Gate (Module 04)
        const existingInsp = db.prepare("SELECT id FROM quality_inspections WHERE internal_lot = ?").get(internalLot);
        if (!existingInsp) {
          const inspId = newId("QIN");
          const inspNum = `QI-2026-${Math.floor(1000 + Math.random() * 8999)}`;
          const prodTemp = db.prepare("SELECT id, temp_min_c, temp_max_c FROM products WHERE sku = ?").get(sku) as
            | { id: string; temp_min_c?: number | null; temp_max_c?: number | null }
            | undefined;
          db.prepare(`
            INSERT INTO quality_inspections (
              id, inspection_number, shipment_id, shipment_reference, asn_reference,
              purchase_order_id, supplier_id, supplier_name, product_id, sku, product_name,
              supplier_batch, internal_lot, warehouse, receiving_location, uom,
              received_qty, accepted_qty, held_qty, rejected_qty, quarantined_qty,
              expected_weight_kg, actual_weight_kg, weight_verified, quantity_verified,
              manufacture_date, expiry_date, temp_min_c, temp_max_c,
              status, created_at, updated_at
            ) VALUES (
              ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?,
              ?, 0, 0, 0, 0,
              ?, ?, ?, 1,
              ?, ?, ?, ?,
              'pending', ?, ?
            )
          `).run(
            inspId,
            inspNum,
            id,
            shipment.shipment_ref,
            shipment.asn_reference,
            shipment.po_number || shipment.po_id,
            shipment.supplier_id,
            shipment.supplier_name,
            prodTemp?.id ?? null,
            sku,
            productName,
            supplierBatch,
            internalLot,
            shipment.destination_warehouse,
            storage || "RCV-STAGE-01",
            unit || "case",
            quantity,
            expectedWeight,
            actualWeight,
            actualWeight !== null ? 1 : 0,
            manufacture,
            expiry,
            prodTemp?.temp_min_c ?? 0,
            prodTemp?.temp_max_c ?? 4,
            now,
            now
          );
        }
      }
    }

    db.prepare("UPDATE inbound_shipments SET status = CASE WHEN status IN ('expected','confirmed','in_transit','arrived','unloading') THEN 'under_inspection' ELSE status END, updated_at = ? WHERE id = ?").run(now, id);
    recordAuditEvent({ actor, action: "inbound.goods_received", entityType: "InboundShipment", entityId: id, after: { items: items.length } });
    return getShipmentDetail(actor, id);
  });
}

export function acceptShipment(actor: AuthenticatedUser, id: string, input: Record<string, unknown>) {
  if (!canDecision(actor)) throw new ApiError(403, "FORBIDDEN_INBOUND_DECISION", "Not authorized to accept/reject/quarantine.");
  requireMutationAuthorization(actor, "accept inbound goods");
  const row = loadShipment(id);
  const shipment = rowToShipment(row);
  scopeShipment(actor, shipment);

  const bin = str(input.bin || input.location || "Receiving Dock");
  const warehouse = shipment.destination_warehouse;

  return withTransaction(() => {
    const db = getDb();
    const now = new Date().toISOString();
    const batches = listBatches(id).filter((b) => b.status === "received");
    if (batches.length === 0) throw new ApiError(400, "NO_RECEIVED_BATCHES", "No received batches to accept.");

    // optional accepted overrides
    const acceptedMap = new Map<string, number>();
    const arr = Array.isArray(input.accepted) ? input.accepted : [];
    for (const a of arr) {
      const o = a as Record<string, unknown>;
      acceptedMap.set(str(o.batch_id), num(o.accepted_qty));
    }

    let partialBatchFound = false;

    for (const b of batches) {
      const acceptedQty = acceptedMap.has(b.id) ? (acceptedMap.get(b.id) as number) : b.quantity;
      if (acceptedQty < 0 || acceptedQty > b.quantity) throw new ApiError(400, "INVALID_ACCEPTED_QTY", "Accepted quantity must be between 0 and received quantity.");
      const rejectedRemainder = Math.max(0, b.quantity - acceptedQty);
      if (rejectedRemainder > 0) partialBatchFound = true;

      if (acceptedQty <= 0) {
        db.prepare("UPDATE inbound_batches SET status = 'rejected', accepted_qty = 0, rejected_qty = ?, updated_at = ? WHERE id = ?").run(b.quantity, now, b.id);
        continue;
      }

      // product config
      const prod = db.prepare("SELECT category, temp_zone, temp_min_c, temp_max_c, unit_weight_kg, case_weight_kg FROM products WHERE sku = ?").get(b.sku) as Record<string, unknown> | undefined;
      const category = prod ? String(prod.category) : "Ambient";
      const tempC = prod && prod.temp_min_c !== null && prod.temp_min_c !== undefined ? Number(prod.temp_min_c) : 4;
      const unitWeight = prod && prod.unit_weight_kg ? Number(prod.unit_weight_kg) : 0;
      const caseWeight = prod && prod.case_weight_kg ? Number(prod.case_weight_kg) : (unitWeight > 0 ? unitWeight : 5);

      const lotId = `LOT-${b.internal_lot}`;
      // ensure not duplicate
      const existingLot = db.prepare("SELECT id FROM inventory_lots WHERE batch_id = ?").get(b.internal_lot) as { id: string } | undefined;
      if (existingLot) throw new ApiError(409, "LOT_EXISTS", "Inventory lot already exists for this batch.");

      db.prepare(`
        INSERT INTO inventory_lots (id, batch_id, sku, product_name, category, warehouse, location, zone, quantity_cases, received_cases, allocated_cases, received_date, expiry_date, supplier, supplier_lot, origin_country, quality_status, temp_c, unit_weight_kg, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'released', ?, ?, ?)
      `).run(lotId, b.internal_lot, b.sku, b.product_name, category, warehouse, bin, "Receiving", acceptedQty, acceptedQty, b.received_date, b.expiry_date, b.supplier_name || shipment.supplier_name, b.supplier_batch, b.origin || shipment.origin_warehouse || "", tempC, caseWeight, now);

      db.prepare("INSERT INTO stock_movements (id, batch_id, sku, movement_type, quantity_delta, previous_cases, new_cases, reason, actor_email, created_at) VALUES (?, ?, ?, 'receipt', ?, 0, ?, ?, ?, ?)").run(newId("SM"), b.internal_lot, b.sku, acceptedQty, acceptedQty, `Inbound acceptance ${shipment.shipment_ref}`, actor.email, now);

      const batchStatus = rejectedRemainder > 0 ? "partially_accepted" : "accepted";
      db.prepare("UPDATE inbound_batches SET status = ?, accepted_qty = ?, rejected_qty = ?, updated_at = ? WHERE id = ?").run(batchStatus, acceptedQty, rejectedRemainder, now, b.id);
    }

    // update item accepted & rejected totals
    db.prepare(`
      UPDATE inbound_shipment_items SET
        accepted_qty = (SELECT COALESCE(SUM(accepted_qty), 0) FROM inbound_batches WHERE item_id = inbound_shipment_items.id),
        rejected_qty = (SELECT COALESCE(SUM(rejected_qty), 0) FROM inbound_batches WHERE item_id = inbound_shipment_items.id),
        updated_at = ?
      WHERE shipment_id = ?
    `).run(now, id);

    // update shipment status
    const allBatches = listBatches(id);
    const remaining = allBatches.filter((b) => b.status === "received");
    const hasRejectedOrQuarantined = allBatches.some((b) => Number(b.rejected_qty) > 0 || Number(b.quarantined_qty) > 0 || b.status === "partially_accepted");
    const updatedItems = listItems(id);
    const hasItemShortage = updatedItems.some((i) => i.ordered_qty > 0 && i.accepted_qty < i.ordered_qty);
    const finalStatus =
      partialBatchFound || hasRejectedOrQuarantined || remaining.length > 0 || hasItemShortage
        ? "partially_accepted"
        : "accepted";
    db.prepare("UPDATE inbound_shipments SET status = ?, updated_at = ? WHERE id = ?").run(finalStatus, now, id);

    // Sync linked Purchase Order if po_id or po_number is set
    if (shipment.po_id || shipment.po_number) {
      const poRow = shipment.po_id
        ? (db.prepare("SELECT id, ordered_cases, received_cases FROM purchase_orders WHERE id = ?").get(shipment.po_id) as Record<string, unknown> | undefined)
        : (db.prepare("SELECT id, ordered_cases, received_cases FROM purchase_orders WHERE po_number = ?").get(shipment.po_number) as Record<string, unknown> | undefined);
      if (poRow) {
        const totalAccepted = updatedItems.reduce((sum, item) => sum + Number(item.accepted_qty || 0), 0);
        const newReceivedCases = Math.round(Number(poRow.received_cases || 0) + totalAccepted);
        const poStatus = newReceivedCases >= Number(poRow.ordered_cases || 0) ? "received" : "partially_received";
        db.prepare("UPDATE purchase_orders SET received_cases = ?, status = ? WHERE id = ?").run(newReceivedCases, poStatus, String(poRow.id));
      }
    }

    recordAuditEvent({ actor, action: "inbound.shipment_accepted", entityType: "InboundShipment", entityId: id, after: { accepted_batches: batches.length, status: finalStatus, bin, warehouse } });
    return getShipmentDetail(actor, id);
  });
}

export function rejectShipment(actor: AuthenticatedUser, id: string, input: Record<string, unknown>) {
  if (!canDecision(actor)) throw new ApiError(403, "FORBIDDEN_INBOUND_DECISION", "Not authorized to accept/reject/quarantine.");
  requireMutationAuthorization(actor, "reject inbound goods");
  const row = loadShipment(id);
  const shipment = rowToShipment(row);
  scopeShipment(actor, shipment);
  const reason = nullableStr(input.reason || input.notes);
  return withTransaction(() => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare("UPDATE inbound_batches SET status = 'rejected', rejected_qty = quantity, updated_at = ? WHERE shipment_id = ? AND status = 'received'").run(now, id);
    db.prepare("UPDATE inbound_shipment_items SET rejected_qty = received_qty, updated_at = ? WHERE shipment_id = ?").run(now, id);
    db.prepare("UPDATE inbound_shipments SET status = 'rejected', transport_notes = COALESCE(?, transport_notes), updated_at = ? WHERE id = ?").run(reason, now, id);
    recordAuditEvent({ actor, action: "inbound.shipment_rejected", entityType: "InboundShipment", entityId: id, after: { reason } });
    return getShipmentDetail(actor, id);
  });
}

export function quarantineShipment(actor: AuthenticatedUser, id: string, input: Record<string, unknown>) {
  if (!canDecision(actor)) throw new ApiError(403, "FORBIDDEN_INBOUND_DECISION", "Not authorized to accept/reject/quarantine.");
  requireMutationAuthorization(actor, "quarantine inbound goods");
  const row = loadShipment(id);
  const shipment = rowToShipment(row);
  scopeShipment(actor, shipment);
  const bin = str(input.bin || input.location || "Quarantine");
  const warehouse = shipment.destination_warehouse;
  const reason = nullableStr(input.reason || input.notes);

  return withTransaction(() => {
    const db = getDb();
    const now = new Date().toISOString();
    const batches = listBatches(id).filter((b) => b.status === "received");
    for (const b of batches) {
      const prod = db.prepare("SELECT category, temp_zone, temp_min_c, temp_max_c, unit_weight_kg, case_weight_kg FROM products WHERE sku = ?").get(b.sku) as Record<string, unknown> | undefined;
      const category = prod ? String(prod.category) : "Ambient";
      const tempC = prod && prod.temp_min_c !== null && prod.temp_min_c !== undefined ? Number(prod.temp_min_c) : 4;
      const unitWeight = prod && prod.unit_weight_kg ? Number(prod.unit_weight_kg) : 0;
      const caseWeight = prod && prod.case_weight_kg ? Number(prod.case_weight_kg) : (unitWeight > 0 ? unitWeight : 5);

      const existingLot = db.prepare("SELECT id FROM inventory_lots WHERE batch_id = ?").get(b.internal_lot) as { id: string } | undefined;
      if (existingLot) throw new ApiError(409, "LOT_EXISTS", "Inventory lot already exists for this batch.");

      db.prepare(`
        INSERT INTO inventory_lots (id, batch_id, sku, product_name, category, warehouse, location, zone, quantity_cases, received_cases, allocated_cases, received_date, expiry_date, supplier, supplier_lot, origin_country, quality_status, temp_c, unit_weight_kg, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'quarantine', ?, ?, ?)
      `).run(`LOT-${b.internal_lot}`, b.internal_lot, b.sku, b.product_name, category, warehouse, bin, "Quarantine", b.quantity, b.quantity, b.received_date, b.expiry_date, b.supplier_name || shipment.supplier_name, b.supplier_batch, b.origin || "", tempC, caseWeight, now);

      db.prepare("UPDATE inbound_batches SET status = 'quarantined', quarantined_qty = quantity, updated_at = ? WHERE id = ?").run(now, b.id);
    }
    db.prepare("UPDATE inbound_shipments SET status = 'quarantined', transport_notes = COALESCE(?, transport_notes), updated_at = ? WHERE id = ?").run(reason, now, id);
    db.prepare("UPDATE inbound_shipment_items SET rejected_qty = received_qty - accepted_qty, updated_at = ? WHERE shipment_id = ?").run(now, id);
    recordAuditEvent({ actor, action: "inbound.shipment_quarantined", entityType: "InboundShipment", entityId: id, after: { reason, bin, warehouse } });
    return getShipmentDetail(actor, id);
  });
}

export function getHistory(actor: AuthenticatedUser, id: string) {
  assertRead(actor);
  const row = loadShipment(id);
  const shipment = rowToShipment(row);
  scopeShipment(actor, shipment);
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM audit_events
       WHERE entity_id = ?
          OR after_json LIKE ?
          OR entity_id IN (SELECT id FROM inbound_temperature_logs WHERE shipment_id = ?)
          OR entity_id IN (SELECT id FROM inbound_documents WHERE shipment_id = ?)
          OR entity_id IN (SELECT id FROM inbound_quality_checks WHERE shipment_id = ?)
          OR entity_id IN (SELECT id FROM inbound_batches WHERE shipment_id = ?)
       ORDER BY created_at DESC LIMIT 100`
    )
    .all(id, `%"shipment_id":"${id}"%`, id, id, id, id);
}

export function documentDownloadPath(actor: AuthenticatedUser, shipmentId: string, docId: string): string {
  return getDocumentPath(actor, shipmentId, docId);
}
