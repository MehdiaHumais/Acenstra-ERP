import { getDb, withTransaction } from "@/server/db/connection";
import { ApiError } from "@/server/core/http";
import {
  AuthenticatedUser,
  assertPermission,
  recordAuditEvent,
  requireAssignedDelivery,
  requireMutationAuthorization,
  requireRecordAccess
} from "@/server/security/auth";
import { listLots } from "@/server/services/inventory-fefo.service";
import type { Delivery, TraceabilityResult } from "@/lib/types";

function numericId(rawId: string, indexFallback: number): number {
  const digits = rawId.replace(/\D/g, "");
  if (digits.length > 0) {
    return Number(digits.slice(-6)) || indexFallback;
  }
  return indexFallback;
}

interface DeliveryRow {
  id: string;
  order_number: string;
  customer: string;
  route_code: string;
  driver: string;
  vehicle: string;
  eta: string;
  temp_c: number;
  status: Delivery["status"];
  pod_signed: number;
  stops_completed: number;
  stops_total: number;
  exception: string | null;
}

export function listDeliveries(actor?: AuthenticatedUser): Delivery[] {
  const db = getDb();
  let query = `
    SELECT
      id, order_number, customer, route_code, driver, vehicle, eta, temp_c,
      status, pod_signed, stops_completed, stops_total, exception
    FROM deliveries
  `;
  const conditions: string[] = [];
  const params: string[] = [];

  // Scoped authorization for drivers
  if (actor?.role === "driver") {
    conditions.push("(lower(driver) = lower(?) OR lower(driver) = lower(?) OR lower(driver) = lower(?))");
    params.push(actor.name, actor.email, actor.id);
  } else if ((actor?.role === "store_vendor" || actor?.role === "store_user") && actor.store_id) {
    conditions.push("(lower(customer) LIKE lower(?) OR lower(order_number) LIKE lower(?))");
    params.push(`%${actor.store_id}%`, `%${actor.store_id}%`);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }
  query += ` ORDER BY id DESC`;

  const rows = db.prepare(query).all(...params) as unknown as DeliveryRow[];

  return rows.map((row, idx) => ({
    id: numericId(row.id, idx + 1),
    number: row.id,
    order_number: row.order_number,
    customer_name: row.customer,
    driver: row.driver,
    vehicle: row.vehicle,
    route: row.route_code,
    status: row.status,
    planned_at: `Today ${row.eta}`,
    temperature_c: Number(row.temp_c),
    pod_signed: Boolean(row.pod_signed),
    exception: row.exception
  }));
}

function findDeliveryRow(deliveryId: string | number): DeliveryRow | undefined {
  const db = getDb();
  const str = String(deliveryId).trim();
  const direct = db.prepare(`SELECT * FROM deliveries WHERE id = ? OR order_number = ?`).get(str, str) as
    | DeliveryRow
    | undefined;
  if (direct) return direct;
  const all = db.prepare(`SELECT * FROM deliveries`).all() as unknown as DeliveryRow[];
  return all.find((r, i) => String(numericId(r.id, i + 1)) === str);
}

export function updateDelivery(
  actor: AuthenticatedUser,
  input: {
    delivery_id: string | number;
    action: "start_load" | "dispatch" | "capture_pod" | "resolve" | "record_exception";
    reason?: string;
    temp_c?: number;
  }
): Delivery {
  assertPermission(actor, "deliveries:update");
  requireMutationAuthorization(actor, "update delivery");

  const db = getDb();
  const existing = findDeliveryRow(input.delivery_id);
  if (!existing) {
    throw new ApiError(404, "DELIVERY_NOT_FOUND", `Delivery '${input.delivery_id}' not found.`);
  }

  // Enforce driver assignment check (IDOR protection)
  requireAssignedDelivery(actor, existing.driver);

  return withTransaction(() => {
    const now = new Date().toISOString();

    if (input.action === "start_load") {
      db.prepare(`
        UPDATE deliveries
        SET status = 'loading', updated_at = ?
        WHERE id = ?
      `).run(now, existing.id);
    } else if (input.action === "dispatch") {
      db.prepare(`
        UPDATE deliveries
        SET status = 'in_transit',
            stops_completed = CASE WHEN stops_completed < 1 THEN 1 ELSE stops_completed END,
            updated_at = ?
        WHERE id = ?
      `).run(now, existing.id);

      db.prepare(`
        UPDATE sales_orders
        SET status = 'dispatched', updated_at = ?
        WHERE order_number = ? AND status NOT IN ('delivered', 'invoiced', 'cancelled')
      `).run(now, existing.order_number);
    } else if (input.action === "capture_pod") {
      db.prepare(`
        UPDATE deliveries
        SET status = 'delivered',
            pod_signed = 1,
            stops_completed = stops_total,
            exception = NULL,
            updated_at = ?
        WHERE id = ?
      `).run(now, existing.id);

      db.prepare(`
        UPDATE sales_orders
        SET status = 'delivered', updated_at = ?
        WHERE order_number = ?
      `).run(now, existing.order_number);

      const order = db.prepare(`SELECT * FROM sales_orders WHERE order_number = ?`).get(existing.order_number) as
        | { id: string; order_number: string; customer_id: string; customer: string; total_cents: number }
        | undefined;
      if (order) {
        const invExists = db.prepare(`SELECT id FROM invoices WHERE order_number = ?`).get(order.order_number) as
          | { id: string }
          | undefined;
        if (!invExists) {
          const invCount = (db.prepare(`SELECT COUNT(*) as c FROM invoices`).get() as { c: number }).c;
          const invoiceNumber = `INV-2026-${8421 + invCount}`;
          const issuedDate = now.slice(0, 10);
          const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
          db.prepare(`
            INSERT INTO invoices (
              id, invoice_number, order_id, order_number, customer_id, customer,
              issued_date, due_date, amount_cents, paid_cents, status, sdi_status, payment_terms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'issued', 'pending', 'Net 30')
          `).run(
            invoiceNumber,
            invoiceNumber,
            order.id,
            order.order_number,
            order.customer_id,
            order.customer,
            issuedDate,
            dueDate,
            order.total_cents
          );
        }
      }
    } else if (input.action === "resolve") {
      db.prepare(`
        UPDATE deliveries
        SET status = 'in_transit',
            exception = NULL,
            updated_at = ?
        WHERE id = ?
      `).run(now, existing.id);
    } else if (input.action === "record_exception") {
      const reason = input.reason?.trim() || "Delivery exception reported by driver";
      const tempC = input.temp_c !== undefined ? Number(input.temp_c) : Number(existing.temp_c);
      db.prepare(`
        UPDATE deliveries
        SET status = 'exception',
            exception = ?,
            temp_c = ?,
            updated_at = ?
        WHERE id = ?
      `).run(reason, tempC, now, existing.id);

      db.prepare(`
        INSERT INTO alert_events (id, severity, module, title, detail, created_at)
        VALUES (?, 'critical', 'Deliveries', ?, ?, ?)
      `).run(
        `ALT-DEL-${Date.now()}`,
        `Delivery ${existing.id} exception (${existing.customer})`,
        `${reason} on route ${existing.route_code}. Credit note & QA review queued.`,
        now
      );
    }

    recordAuditEvent({
      actor,
      action: `delivery.${input.action}`,
      entityType: "Delivery",
      entityId: existing.id,
      before: { status: existing.status, pod_signed: Boolean(existing.pod_signed), exception: existing.exception },
      after: { action: input.action, reason: input.reason ?? null }
    });

    const updated = listDeliveries().find((d) => d.number === existing.id);
    if (!updated) {
      throw new ApiError(500, "DELIVERY_UPDATE_FAILED", "Failed to load updated delivery.");
    }
    return updated;
  });
}

export function getBatchTraceability(batchIdInput: string | number): TraceabilityResult {
  const db = getDb();
  const batchId = decodeURIComponent(String(batchIdInput)).trim();
  const allLots = listLots();
  const matchedFromList =
    allLots.find((l) => l.batch_code === batchId || String(l.id) === batchId) ?? allLots[0];

  const lookupBatchCode = matchedFromList ? matchedFromList.batch_code : batchId;

  let rawLot = db.prepare(`SELECT * FROM inventory_lots WHERE batch_id = ?`).get(lookupBatchCode) as
    | {
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
        received_date: string;
        expiry_date: string;
        supplier: string;
        supplier_lot: string;
        origin_country: string;
        quality_status: "released" | "hold" | "quarantine";
        unit_weight_kg: number;
      }
    | undefined;

  if (!rawLot) {
    rawLot = db.prepare(`SELECT * FROM inventory_lots ORDER BY expiry_date ASC LIMIT 1`).get() as typeof rawLot;
  }

  if (!rawLot) {
    throw new ApiError(404, "BATCH_NOT_FOUND", `Batch '${batchId}' was not found.`);
  }

  const matchedLot = allLots.find((l) => l.batch_code === rawLot!.batch_id) ?? allLots[0];

  const lines = db.prepare(`
    SELECT
      sol.cases_allocated,
      sol.weight_kg,
      so.order_number,
      so.customer,
      so.delivery_date,
      COALESCE(d.status, so.status) as delivery_status,
      CASE WHEN rn.id IS NOT NULL THEN 1 ELSE 0 END as notified
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.order_id
    LEFT JOIN deliveries d ON d.order_number = so.order_number
    LEFT JOIN recall_notifications rn ON rn.batch_id = sol.batch_id AND rn.order_number = so.order_number
    WHERE sol.batch_id = ?
    ORDER BY so.created_at DESC
  `).all(rawLot.batch_id) as Array<{
    cases_allocated: number;
    weight_kg: number;
    order_number: string;
    customer: string;
    delivery_date: string;
    delivery_status: string;
    notified: number;
  }>;

  const unitWeightKg = Number(rawLot.unit_weight_kg || 5.0);
  const receivedKg = Number((Number(rawLot.received_cases) * unitWeightKg).toFixed(1));
  const shippedKg = Number(
    lines.reduce((acc, line) => acc + Number(line.weight_kg || line.cases_allocated * unitWeightKg), 0).toFixed(1)
  );
  const remainingKg = Number((Number(rawLot.quantity_cases) * unitWeightKg).toFixed(1));
  const varianceKg = Number(Math.max(0, receivedKg - shippedKg - remainingKg).toFixed(1));

  return {
    batch: matchedLot,
    upstream: {
      supplier: `${rawLot.supplier} (${rawLot.origin_country})`,
      purchase_order: `PO-2026-${rawLot.supplier_lot.slice(-3) || "1041"}`,
      received_at: rawLot.received_date,
      initial_kg: receivedKg,
      certificate: `EU-HACCP-${rawLot.supplier_lot}`
    },
    downstream: lines.map((line) => ({
      order_number: line.order_number,
      customer_name: line.customer,
      shipped_kg: Number(line.weight_kg || line.cases_allocated * unitWeightKg),
      delivered_at: line.delivery_date
    })),
    mass_balance: {
      received_kg: receivedKg,
      shipped_kg: shippedKg,
      remaining_kg: remainingKg,
      variance_kg: varianceKg
    }
  };
}

export function quarantineBatch(
  actor: AuthenticatedUser,
  batchId: string,
  reason?: string
): TraceabilityResult {
  assertPermission(actor, "traceability:quarantine");
  const db = getDb();
  const lot = (db.prepare(`SELECT * FROM inventory_lots WHERE batch_id = ?`).get(batchId) ??
    db.prepare(`SELECT * FROM inventory_lots ORDER BY expiry_date ASC LIMIT 1`).get()) as
    | { id: string; batch_id: string; sku: string; quality_status: string; location: string; quantity_cases: number }
    | undefined;
  if (!lot) {
    throw new ApiError(404, "BATCH_NOT_FOUND", `Batch '${batchId}' not found.`);
  }

  withTransaction(() => {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE inventory_lots
      SET quality_status = 'quarantine',
          location = 'QR-Z01',
          zone = 'Quarantine',
          updated_at = ?
      WHERE batch_id = ?
    `).run(now, lot.batch_id);

    db.prepare(`
      UPDATE warehouse_tasks
      SET status = 'blocked', updated_at = ?
      WHERE batch_id = ? AND status IN ('queued', 'in_progress')
    `).run(now, lot.batch_id);

    db.prepare(`
      INSERT INTO stock_movements (id, batch_id, sku, movement_type, quantity_delta, previous_cases, new_cases, reason, actor_email, created_at)
      VALUES (?, ?, ?, 'quarantine', 0, ?, ?, ?, ?, ?)
    `).run(
      `MOV-QR-${Date.now()}`,
      lot.batch_id,
      lot.sku,
      lot.quantity_cases,
      lot.quantity_cases,
      reason || "Emergency recall simulation / QA quarantine hold",
      actor.email,
      now
    );

    db.prepare(`
      INSERT INTO alert_events (id, severity, module, title, detail, created_at)
      VALUES (?, 'critical', 'Traceability', ?, ?, ?)
    `).run(
      `ALT-QR-${Date.now()}`,
      `Lot ${lot.batch_id} placed in Quarantine`,
      `Moved from ${lot.location} to QR-Z01 by ${actor.name}. Open pick tasks blocked.`,
      now
    );

    recordAuditEvent({
      actor,
      action: "traceability.batch_quarantined",
      entityType: "InventoryLot",
      entityId: lot.batch_id,
      before: { quality_status: lot.quality_status, location: lot.location },
      after: { quality_status: "quarantine", location: "QR-Z01", reason: reason ?? "QA Quarantine" }
    });
  });

  return getBatchTraceability(lot.batch_id);
}

export function notifyRecallCustomer(
  actor: AuthenticatedUser,
  batchId: string,
  orderNumber: string
): { batch_id: string; order_number: string; notified: boolean; notified_at: string } {
  assertPermission(actor, "traceability:quarantine");
  const db = getDb();
  const now = new Date().toISOString();

  const order = db.prepare(`SELECT customer FROM sales_orders WHERE order_number = ?`).get(orderNumber) as
    | { customer: string }
    | undefined;

  withTransaction(() => {
    db.prepare(`
      INSERT INTO recall_notifications (id, batch_id, order_number, customer, notified_by, notified_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(batch_id, order_number) DO UPDATE SET
        notified_by = excluded.notified_by,
        notified_at = excluded.notified_at
    `).run(
      `RCL-${Date.now()}`,
      batchId,
      orderNumber,
      order?.customer ?? "Downstream Customer",
      actor.email,
      now
    );

    recordAuditEvent({
      actor,
      action: "traceability.recall_notice_sent",
      entityType: "RecallNotification",
      entityId: `${batchId}:${orderNumber}`,
      after: { batch_id: batchId, order_number: orderNumber, notified_at: now }
    });
  });

  return {
    batch_id: batchId,
    order_number: orderNumber,
    notified: true,
    notified_at: now
  };
}
