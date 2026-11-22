import { getDb, withTransaction } from "@/server/db/connection";
import { ApiError } from "@/server/core/http";
import {
  AuthenticatedUser,
  assertPermission,
  recordAuditEvent,
  requireMutationAuthorization,
  requireWarehouseAccess
} from "@/server/security/auth";
import type { Lot, TemperatureReading } from "@/lib/types";

interface RawLotRow {
  id: string;
  batch_id: string;
  sku: string;
  product_name: string;
  category: string;
  warehouse: string;
  location: string;
  zone: string;
  quantity_cases: number;
  received_cases: number;
  allocated_cases: number;
  held_cases?: number;
  quarantined_cases?: number;
  rejected_cases?: number;
  pending_cases?: number;
  received_date: string;
  expiry_date: string;
  supplier: string;
  supplier_lot: string;
  origin_country: string;
  quality_status: "released" | "hold" | "on_hold" | "quarantine" | "rejected" | "pending";
  inspection_id?: string | null;
  quality_decision_reason?: string | null;
  temp_c: number;
  unit_weight_kg: number;
}

function numericId(rawId: string, indexFallback: number): number {
  const digits = rawId.replace(/\D/g, "");
  if (digits.length > 0) {
    return Number(digits.slice(-6)) || indexFallback;
  }
  return indexFallback;
}

function computeDaysRemaining(expiryDateStr: string): number {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const expiry = new Date(`${expiryDateStr}T00:00:00Z`);
  const diffMs = expiry.getTime() - today.getTime();
  return Math.max(0, Math.ceil(diffMs / 86400000));
}

export function listLots(actor?: AuthenticatedUser): Lot[] {
  const db = getDb();
  let query = `
    SELECT
      id, batch_id, sku, product_name, category, warehouse, location, zone,
      quantity_cases, received_cases, allocated_cases,
      COALESCE(held_cases, 0) as held_cases,
      COALESCE(quarantined_cases, 0) as quarantined_cases,
      COALESCE(rejected_cases, 0) as rejected_cases,
      COALESCE(pending_cases, 0) as pending_cases,
      received_date, expiry_date,
      supplier, supplier_lot, origin_country, quality_status,
      inspection_id, quality_decision_reason, temp_c, unit_weight_kg
    FROM inventory_lots
  `;
  const conditions: string[] = [];
  const params: string[] = [];

  if (actor && (actor.role === "warehouse_manager" || actor.role === "picker" || actor.role === "warehouse_staff") && actor.warehouse) {
    conditions.push("lower(warehouse) = lower(?)");
    params.push(actor.warehouse);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }
  query += ` ORDER BY expiry_date ASC, received_date ASC, batch_id ASC`;

  const rows = db.prepare(query).all(...params) as unknown as RawLotRow[];

  const skuRankCounter = new Map<string, number>();

  return rows.map((row, idx) => {
    const daysRemaining = computeDaysRemaining(row.expiry_date);
    let rank = 99;
    if (row.quality_status === "released" && row.quantity_cases > 0) {
      const current = (skuRankCounter.get(row.sku) ?? 0) + 1;
      skuRankCounter.set(row.sku, current);
      rank = current;
    }
    const unitWeight = Number(row.unit_weight_kg || 5.0);
    const remainingKg = Number((Number(row.quantity_cases) * unitWeight).toFixed(1));
    const tempC = Number(row.temp_c);
    const tempStatus: Lot["temperature_status"] =
      tempC > 6.0 ? "excursion" : tempC > 4.2 ? "warning" : "in_range";
    const qualityStatus: Lot["quality_status"] =
      row.quality_status === "quarantine"
        ? "quarantine"
        : row.quality_status === "rejected"
          ? "rejected"
          : row.quality_status === "on_hold" || row.quality_status === "hold"
            ? "on_hold"
            : row.quality_status === "pending"
              ? "pending"
              : "released";

    return {
      id: numericId(row.id, idx + 1),
      batch_code: row.batch_id,
      batch_id: row.batch_id,
      sku: row.sku,
      product_name: row.product_name,
      supplier_name: row.supplier,
      supplier_lot: row.supplier_lot,
      warehouse: row.warehouse,
      location: row.location,
      zone: row.zone,
      received_at: row.received_date,
      expires_on: row.expiry_date,
      days_remaining: daysRemaining,
      remaining_kg: remainingKg,
      quantity_cases: Number(row.quantity_cases),
      received_cases: Number(row.received_cases),
      allocated_cases: Number(row.allocated_cases ?? 0),
      held_cases: Number(row.held_cases ?? 0),
      quarantined_cases: Number(row.quarantined_cases ?? 0),
      rejected_cases: Number(row.rejected_cases ?? 0),
      pending_cases: Number(row.pending_cases ?? 0),
      temperature_status: tempStatus,
      quality_status: qualityStatus,
      inspection_id: row.inspection_id ?? null,
      quality_decision_reason: row.quality_decision_reason ?? null,
      fefo_rank: rank
    };
  });
}

export function findFefoLotForSku(sku: string, requiredCases: number): RawLotRow | null {
  const db = getDb();
  const lots = db.prepare(`
    SELECT *
    FROM inventory_lots
    WHERE sku = ?
      AND quality_status = 'released'
      AND (quantity_cases - allocated_cases) > 0
      AND expiry_date > date('now')
    ORDER BY expiry_date ASC, received_date ASC
  `).all(sku) as unknown as RawLotRow[];

  if (lots.length === 0) return null;
  const fullMatch = lots.find((l) => l.quantity_cases - l.allocated_cases >= requiredCases);
  return fullMatch ?? lots[0];
}

export function postCycleCount(
  actor: AuthenticatedUser,
  input: {
    batch_id: string;
    counted_cases: number;
    reason?: string;
  }
): {
  lot: Lot;
  previous_cases: number;
  counted_cases: number;
  variance_cases: number;
} {
  assertPermission(actor, "inventory:adjust");
  requireMutationAuthorization(actor, "adjust inventory");

  if (!input.batch_id || typeof input.counted_cases !== "number" || input.counted_cases < 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Valid batch_id and non-negative counted_cases are required.");
  }

  const db = getDb();
  const existing = db.prepare(`SELECT * FROM inventory_lots WHERE batch_id = ? OR id = ?`).get(
    input.batch_id.trim(),
    input.batch_id.trim()
  ) as RawLotRow | undefined;

  if (!existing) {
    throw new ApiError(404, "LOT_NOT_FOUND", `Inventory batch '${input.batch_id}' was not found.`);
  }

  requireWarehouseAccess(actor, existing.warehouse);

  const countedCases = Math.round(input.counted_cases);
  const previousCases = Number(existing.quantity_cases);
  const varianceCases = countedCases - previousCases;
  const reason = input.reason?.trim() || "Cycle count physical verification";

  return withTransaction(() => {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE inventory_lots
      SET quantity_cases = ?,
          allocated_cases = MIN(allocated_cases, ?),
          updated_at = ?
      WHERE id = ?
    `).run(countedCases, countedCases, now, existing.id);

    db.prepare(`
      INSERT INTO stock_movements (
        id, batch_id, sku, movement_type, quantity_delta, previous_cases, new_cases, reason, actor_email, created_at
      ) VALUES (?, ?, ?, 'cycle_count', ?, ?, ?, ?, ?, ?)
    `).run(
      `MOV-${Date.now()}`,
      existing.batch_id,
      existing.sku,
      varianceCases,
      previousCases,
      countedCases,
      reason,
      actor.email,
      now
    );

    recordAuditEvent({
      actor,
      action: "inventory.cycle_count_posted",
      entityType: "InventoryLot",
      entityId: existing.batch_id,
      before: { quantity_cases: previousCases },
      after: { quantity_cases: countedCases, variance_cases: varianceCases, reason }
    });

    const updatedLots = listLots();
    const updatedLot = updatedLots.find((l) => l.batch_code === existing.batch_id)!;
    return {
      lot: updatedLot,
      previous_cases: previousCases,
      counted_cases: countedCases,
      variance_cases: varianceCases
    };
  });
}

export function listTemperatureReadings(actor?: AuthenticatedUser): TemperatureReading[] {
  const db = getDb();
  let query = `
    SELECT id, zone_name, warehouse, target_min_c, target_max_c, current_c, humidity_pct, status, sensor_id, updated_at
    FROM temperature_readings
  `;
  const conditions: string[] = [];
  const params: string[] = [];

  if (actor && (actor.role === "warehouse_manager" || actor.role === "picker" || actor.role === "warehouse_staff") && actor.warehouse) {
    conditions.push("lower(warehouse) = lower(?)");
    params.push(actor.warehouse);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }
  query += ` ORDER BY id ASC`;

  const rows = db.prepare(query).all(...params) as Array<{
    id: string;
    zone_name: string;
    warehouse: string;
    target_min_c: number;
    target_max_c: number;
    current_c: number;
    humidity_pct: number;
    status: "normal" | "warning" | "excursion";
    sensor_id: string;
    updated_at: string;
  }>;

  return rows.map((r, idx) => ({
    id: numericId(r.id, idx + 1),
    location: r.warehouse,
    zone: r.zone_name,
    celsius: Number(r.current_c),
    min_c: Number(r.target_min_c),
    max_c: Number(r.target_max_c),
    status: r.status === "normal" ? "in_range" : r.status,
    device: r.sensor_id,
    recorded_at: r.updated_at
  }));
}

export function recordTemperatureReading(
  actor: AuthenticatedUser,
  input: { zone_id: string; current_c: number; humidity_pct?: number }
): TemperatureReading {
  assertPermission(actor, "inventory:adjust");
  requireMutationAuthorization(actor, "record temperature reading");
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM temperature_readings WHERE id = ? OR zone_name = ?`).get(
    input.zone_id,
    input.zone_id
  ) as
    | {
        id: string;
        zone_name: string;
        warehouse: string;
        target_min_c: number;
        target_max_c: number;
        current_c: number;
        humidity_pct: number;
        status: "normal" | "warning" | "excursion";
        sensor_id: string;
      }
    | undefined;

  if (!existing) {
    throw new ApiError(404, "ZONE_NOT_FOUND", `Temperature zone '${input.zone_id}' not found.`);
  }

  requireWarehouseAccess(actor, existing.warehouse);

  const currentC = Number(input.current_c);
  const humidity = input.humidity_pct !== undefined ? Number(input.humidity_pct) : Number(existing.humidity_pct);
  let status: "normal" | "warning" | "excursion" = "normal";

  if (currentC > existing.target_max_c + 1.5 || currentC < existing.target_min_c - 3.0) {
    status = "excursion";
  } else if (currentC > existing.target_max_c || currentC < existing.target_min_c) {
    status = "warning";
  }

  withTransaction(() => {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE temperature_readings
      SET current_c = ?, humidity_pct = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(currentC, humidity, status, now, existing.id);

    if (status === "excursion" || status === "warning") {
      db.prepare(`
        INSERT INTO alert_events (id, severity, module, title, detail, created_at)
        VALUES (?, ?, 'Cold Chain', ?, ?, ?)
      `).run(
        `ALT-${Date.now()}`,
        status === "excursion" ? "critical" : "warning",
        `${existing.zone_name} thermal ${status} (${currentC}°C)`,
        `Sensor ${existing.sensor_id} reported ${currentC}°C outside target [${existing.target_min_c}°C .. ${existing.target_max_c}°C].`,
        now
      );
    }

    recordAuditEvent({
      actor,
      action: "cold_chain.temperature_recorded",
      entityType: "TemperatureZone",
      entityId: existing.id,
      before: { current_c: existing.current_c, status: existing.status },
      after: { current_c: currentC, status }
    });
  });

  return listTemperatureReadings().find((t) => t.zone === existing.zone_name)!;
}
