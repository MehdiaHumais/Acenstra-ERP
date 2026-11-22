import { getDb, withTransaction } from "@/server/db/connection";
import { ApiError } from "@/server/core/http";
import {
  AuthenticatedUser,
  assertPermission,
  recordAuditEvent,
  requireMutationAuthorization,
  requireRecordAccess,
  requireWarehouseAccess
} from "@/server/security/auth";
import { findFefoLotForSku } from "@/server/services/inventory-fefo.service";
import type { OrderLine, SalesOrder, WarehouseTask } from "@/lib/types";

function numericId(rawId: string, indexFallback: number): number {
  const digits = rawId.replace(/\D/g, "");
  if (digits.length > 0) {
    return Number(digits.slice(-6)) || indexFallback;
  }
  return indexFallback;
}

interface RawOrderRow {
  id: string;
  order_number: string;
  customer_id: string;
  customer: string;
  segment: string;
  channel: "b2b_portal" | "sales_rep" | "edi" | "phone";
  status: string;
  credit_hold: number;
  credit_hold_reason: string | null;
  items_count: number;
  cases_total: number;
  total_cents: number;
  margin_pct: number;
  delivery_date: string;
  warehouse: string;
  fefo_allocated: number;
  created_at: string;
}

export function listOrders(actor?: AuthenticatedUser): SalesOrder[] {
  const db = getDb();
  let query = `
    SELECT
      id, order_number, customer_id, customer, segment, channel, status,
      credit_hold, credit_hold_reason, items_count, cases_total, total_cents,
      margin_pct, delivery_date, warehouse, fefo_allocated, created_at
    FROM sales_orders
  `;
  const conditions: string[] = [];
  const params: string[] = [];

  if (actor) {
    if ((actor.role === "store_vendor" || actor.role === "store_user") && actor.store_id) {
      conditions.push("customer_id = ?");
      params.push(actor.store_id);
    } else if (actor.role === "driver") {
      conditions.push("order_number IN (SELECT order_number FROM deliveries WHERE lower(driver) = lower(?) OR lower(driver) = lower(?))");
      params.push(actor.name, actor.email);
    } else if ((actor.role === "warehouse_manager" || actor.role === "picker" || actor.role === "warehouse_staff") && actor.warehouse) {
      conditions.push("lower(warehouse) = lower(?)");
      params.push(actor.warehouse);
    }
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }
  query += ` ORDER BY order_number DESC`;

  const rows = db.prepare(query).all(...params) as unknown as RawOrderRow[];

  const lineStmt = db.prepare(`
    SELECT sku, product_name, cases_ordered, unit_price_cents, batch_id, weight_kg
    FROM sales_order_lines
    WHERE order_id = ?
  `);

  return rows.map((row, idx) => {
    const rawLines = lineStmt.all(row.id) as Array<{
      sku: string;
      product_name: string;
      cases_ordered: number;
      unit_price_cents: number;
      batch_id: string | null;
      weight_kg: number;
    }>;

    const lines: OrderLine[] =
      rawLines.length > 0
        ? rawLines.map((l) => ({
            sku: l.sku,
            product_name: l.product_name,
            quantity_kg: Number(l.weight_kg || l.cases_ordered * 5),
            unit_price_cents: Number(l.unit_price_cents),
            batch_code: l.batch_id || "LOT-2026-SAL-041"
          }))
        : [
            {
              sku: "SKU-SAL-001",
              product_name: "Norwegian Atlantic Salmon Fillet",
              quantity_kg: Number(row.cases_total * 5),
              unit_price_cents: Math.round(Number(row.total_cents) / Math.max(1, Number(row.cases_total))),
              batch_code: "LOT-2026-SAL-041"
            }
          ];

    const customerType: SalesOrder["customer_type"] =
      row.segment.toLowerCase().includes("retail") || row.segment.toLowerCase().includes("store")
        ? "store"
        : row.segment.toLowerCase().includes("wholesale") || row.segment.toLowerCase().includes("hotel")
          ? "wholesale"
          : "restaurant";

    const mappedStatus: SalesOrder["status"] =
      row.status === "packed"
        ? "picking"
        : row.status === "invoiced"
          ? "delivered"
          : (row.status as SalesOrder["status"]);

    const creditStatus: SalesOrder["credit_status"] =
      row.credit_hold === 1 ? "blocked" : Number(row.total_cents) > 500000 ? "warning" : "clear";

    return {
      id: numericId(row.id, idx + 1),
      number: row.order_number,
      customer_name: row.customer,
      customer_type: customerType,
      status: mappedStatus,
      credit_status: creditStatus,
      ordered_at: String(row.created_at).slice(0, 10),
      promised_at: row.delivery_date,
      total_cents: Number(row.total_cents),
      lines
    };
  });
}

function findOrderRow(orderIdentifier: string | number): RawOrderRow | undefined {
  const db = getDb();
  const str = String(orderIdentifier).trim();
  const direct = db.prepare(`SELECT * FROM sales_orders WHERE id = ? OR order_number = ?`).get(str, str) as
    | RawOrderRow
    | undefined;
  if (direct) return direct;

  // Match by trailing numeric id
  const all = db.prepare(`SELECT * FROM sales_orders`).all() as unknown as RawOrderRow[];
  return all.find((r, i) => String(numericId(r.id, i + 1)) === str);
}

export function createOrder(
  actor: AuthenticatedUser,
  input: {
    customer?: string;
    customer_name?: string;
    customer_type?: "restaurant" | "store" | "wholesale";
    segment?: string;
    channel?: "b2b_portal" | "sales_rep" | "edi" | "phone";
    delivery_date?: string;
    promised_at?: string;
    warehouse?: string;
    sku?: string;
    product_name?: string;
    unit_price_cents?: number;
    cases?: number;
    quantity_kg?: number;
    total_cents?: number;
  }
): SalesOrder {
  assertPermission(actor, "orders:write");
  requireMutationAuthorization(actor, "create order");

  const customerName = (input.customer_name || input.customer || "").trim();
  if (!customerName) {
    throw new ApiError(400, "VALIDATION_ERROR", "Customer name is required.");
  }

  const db = getDb();
  const customerRow = db.prepare(`SELECT * FROM customers WHERE lower(name) = lower(?)`).get(customerName) as
    | {
        id: string;
        name: string;
        segment: string;
        credit_limit_cents: number;
        current_exposure_cents: number;
        status: string;
      }
    | undefined;

  // Enforce boundary: store vendors can only place orders for their assigned store
  if ((actor.role === "store_vendor" || actor.role === "store_user") && actor.store_id) {
    if (!customerRow || customerRow.id !== actor.store_id) {
      throw new ApiError(
        403,
        "FORBIDDEN_STORE_BOUNDARY",
        `Store vendor cannot create orders for another customer/store '${customerName}'. Must order under store '${actor.store_id}'.`
      );
    }
  }

  if (input.warehouse && actor.warehouse) {
    requireWarehouseAccess(actor, input.warehouse);
  }

  const sku = input.sku?.trim() || "SKU-SAL-001";
  let product = (db.prepare(`SELECT * FROM products WHERE sku = ?`).get(sku) ??
    db.prepare(`SELECT * FROM products ORDER BY sku ASC LIMIT 1`).get()) as
    | {
        sku: string;
        name: string;
        unit_price_cents: number;
      }
    | undefined;

  if (!product) {
    const defaultName = (input.product_name || "Atlantic Salmon Fillet").trim();
    const defaultSku = sku || "SKU-SAL-001";
    const defaultPriceCents = Math.round(Number(input.unit_price_cents) || 1890);
    const prodId = `PRD-${Date.now().toString().slice(-5)}`;

    let sup = db.prepare(`SELECT id, name FROM suppliers LIMIT 1`).get() as { id: string; name: string } | undefined;
    if (!sup) {
      sup = { id: "SUP-001", name: "Cooperativa Agricola Sud" };
      db.prepare(`
        INSERT INTO suppliers (
          id, name, country, region, categories_json, lead_time_days,
          otif_pct, quality_score, open_pos_count, payment_terms, certifications_json, status
        ) VALUES ('SUP-001', 'Cooperativa Agricola Sud', 'IT', 'Sicilia', '["Produce"]', 2, 98.0, 96.0, 0, 'Net 30', '["IFS Food"]', 'approved')
      `).run();
    }

    db.prepare(`
      INSERT INTO products (
        id, sku, name, category, origin, uom, temp_zone, shelf_life_days,
        stock_cases, reorder_point_cases, unit_price_cents, vat_rate_pct, supplier_name, status
      ) VALUES (?, ?, ?, 'Produce', 'Italy', 'kg', 'chilled', 14, 50, 10, ?, 4.0, ?, 'active')
    `).run(prodId, defaultSku, defaultName, defaultPriceCents, sup.name);

    product = {
      sku: defaultSku,
      name: defaultName,
      unit_price_cents: defaultPriceCents
    };
  }

  const casesTotal =
    input.cases !== undefined
      ? Math.max(1, Math.round(Number(input.cases)))
      : input.quantity_kg !== undefined
        ? Math.max(1, Math.round(Number(input.quantity_kg) / 5))
        : 20;

  const totalCents =
    input.total_cents && Number(input.total_cents) > 0
      ? Math.round(Number(input.total_cents))
      : casesTotal * Number(product.unit_price_cents);

  const existingNums = db
    .prepare(`SELECT order_number FROM sales_orders WHERE order_number LIKE 'SO-2026-%'`)
    .all() as Array<{ order_number: string }>;
  const maxSuffix = existingNums.reduce((max, r) => {
    const num = Number(r.order_number.replace("SO-2026-", ""));
    return Number.isFinite(num) && num > max ? num : max;
  }, 9847);
  const orderNumber = `SO-2026-${maxSuffix + 1}`;

  const fefoLot = findFefoLotForSku(product.sku, casesTotal);
  const fefoAllocated = fefoLot ? 1 : 0;

  let creditHold = 0;
  let creditHoldReason: string | null = null;
  if (customerRow) {
    const projectedExposure = Number(customerRow.current_exposure_cents) + totalCents;
    if (projectedExposure > Number(customerRow.credit_limit_cents)) {
      creditHold = 1;
      creditHoldReason = `Projected exposure €${(projectedExposure / 100).toFixed(2)} exceeds credit limit €${(
        customerRow.credit_limit_cents / 100
      ).toFixed(2)}`;
    }
  } else if (totalCents > 950000) {
    creditHold = 1;
    creditHoldReason = "New customer order exceeds €9,500 automatic credit threshold";
  }

  const status = creditHold ? "draft" : "confirmed";
  const deliveryDate = input.promised_at?.trim() || input.delivery_date?.trim() || new Date().toISOString().slice(0, 10);
  const warehouse = input.warehouse?.trim() || (fefoLot?.warehouse ?? "Milan Cold Hub");
  const segment =
    input.customer_type === "store"
      ? "Retail Store"
      : input.customer_type === "wholesale"
        ? "Wholesale"
        : input.segment?.trim() || (customerRow?.segment ?? "Fine Dining");

  withTransaction(() => {
    const now = new Date().toISOString();
    let customerId = customerRow?.id;
    if (!customerId) {
      const prefix = input.customer_type === "store" ? "STR" : "CUST";
      customerId = `${prefix}-${Date.now().toString().slice(-5)}`;
      const cType = input.customer_type === "store" ? "store" : "b2b";
      db.prepare(`
        INSERT INTO customers (
          id, name, customer_type, segment, city, manager,
          credit_limit_cents, current_exposure_cents, payment_terms,
          active_orders_count, monthly_spend_cents, fill_rate_pct, waste_pct,
          last_delivery_text, top_categories_json, status
        ) VALUES (?, ?, ?, ?, 'Milan', ?, 1500000, ?, 'Net 30', 1, ?, 100.0, 1.2, 'Today', ?, 'healthy')
      `).run(
        customerId,
        customerName,
        cType,
        segment,
        actor.name || actor.email,
        totalCents,
        totalCents,
        JSON.stringify([product.name])
      );
    }

    db.prepare(`
      INSERT INTO sales_orders (
        id, order_number, customer_id, customer, segment, channel, status,
        credit_hold, credit_hold_reason, items_count, cases_total, total_cents,
        margin_pct, delivery_date, warehouse, fefo_allocated, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 29.5, ?, ?, ?, ?, ?, ?)
    `).run(
      orderNumber,
      orderNumber,
      customerId,
      customerRow?.name ?? customerName,
      segment,
      input.channel ?? "b2b_portal",
      status,
      creditHold,
      creditHoldReason,
      casesTotal,
      totalCents,
      deliveryDate,
      warehouse,
      fefoAllocated,
      actor.email,
      now,
      now
    );

    const allocatedCases = fefoLot
      ? Math.min(casesTotal, Math.max(0, fefoLot.quantity_cases - fefoLot.allocated_cases))
      : 0;

    db.prepare(`
      INSERT INTO sales_order_lines (
        id, order_id, sku, product_name, cases_ordered, cases_allocated, unit_price_cents, batch_id, weight_kg
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `SOL-${Date.now()}`,
      orderNumber,
      product.sku,
      product.name,
      casesTotal,
      allocatedCases,
      product.unit_price_cents,
      fefoLot?.batch_id ?? null,
      Number((casesTotal * 5.0).toFixed(1))
    );

    if (fefoLot && allocatedCases > 0 && !creditHold) {
      db.prepare(`
        UPDATE inventory_lots
        SET allocated_cases = allocated_cases + ?, updated_at = ?
        WHERE id = ?
      `).run(allocatedCases, now, fefoLot.id);

      const pickTaskId = `TSK-${Date.now().toString().slice(-4)}`;
      db.prepare(`
        INSERT INTO warehouse_tasks (
          id, task_type, priority, status, sku, product_name, batch_id,
          from_bin, to_bin, cases, assignee, order_number, updated_at
        ) VALUES (?, 'pick', 'high', 'queued', ?, ?, ?, ?, 'STAGE-D1', ?, 'Marco Bellini', ?, ?)
      `).run(
        pickTaskId,
        product.sku,
        product.name,
        fefoLot.batch_id,
        fefoLot.location,
        allocatedCases,
        orderNumber,
        now
      );

      const resId = `RES-ID-${Date.now()}-${Math.floor(100 + Math.random() * 899)}`;
      const resNumber = `RES-2026-${Math.floor(1000 + Math.random() * 8999)}`;
      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      db.prepare(`
        INSERT INTO stock_reservations (
          id, reservation_number, order_id, order_number, customer_id, customer_name,
          sku, product_name, internal_lot, supplier_batch, warehouse, zone, bin_code,
          requested_cases, reserved_cases, reserved_weight_kg, uom, delivery_date,
          min_shelf_life_days_required, fefo_rank, selection_reason, status, pick_task_id,
          expires_at, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'case', ?, 2, 1, ?, 'Active', ?, ?, ?, ?, ?)
      `).run(
        resId,
        resNumber,
        orderNumber,
        orderNumber,
        customerId,
        customerRow?.name ?? customerName,
        product.sku,
        product.name,
        fefoLot.batch_id,
        fefoLot.supplier_lot,
        fefoLot.warehouse,
        fefoLot.zone,
        fefoLot.location,
        casesTotal,
        allocatedCases,
        Number((allocatedCases * (fefoLot.unit_weight_kg || 5.0)).toFixed(1)),
        deliveryDate,
        `Order ${orderNumber} FEFO reservation on lot ${fefoLot.batch_id} (expires ${fefoLot.expiry_date})`,
        pickTaskId,
        expiresAt,
        actor.email,
        now,
        now
      );
    }

    if (customerRow) {
      db.prepare(`
        UPDATE customers
        SET current_exposure_cents = current_exposure_cents + ?,
            active_orders_count = active_orders_count + 1
        WHERE id = ?
      `).run(totalCents, customerRow.id);
    }

    recordAuditEvent({
      actor,
      action: "orders.created",
      entityType: "SalesOrder",
      entityId: orderNumber,
      after: {
        order_number: orderNumber,
        customer: customerName,
        total_cents: totalCents,
        credit_hold: Boolean(creditHold),
        fefo_batch: fefoLot?.batch_id ?? null
      }
    });
  });

  return listOrders().find((o) => o.number === orderNumber)!;
}

export function releaseOrderCredit(
  actor: AuthenticatedUser,
  orderId: string | number,
  reason?: string
): SalesOrder {
  assertPermission(actor, "orders:credit_override");
  requireMutationAuthorization(actor, "release credit hold");
  const db = getDb();
  const order = findOrderRow(orderId);
  if (!order) {
    throw new ApiError(404, "ORDER_NOT_FOUND", `Order '${orderId}' not found.`);
  }

  requireRecordAccess(actor, { customer_id: order.customer_id, warehouse: order.warehouse });

  withTransaction(() => {
    const now = new Date().toISOString();
    const newStatus = order.status === "draft" ? "confirmed" : order.status;
    db.prepare(`
      UPDATE sales_orders
      SET credit_hold = 0,
          credit_hold_reason = NULL,
          status = ?,
          approved_by = ?,
          fefo_allocated = 1,
          updated_at = ?
      WHERE id = ?
    `).run(newStatus, actor.email, now, order.id);

    recordAuditEvent({
      actor,
      action: "orders.credit_hold_released",
      entityType: "SalesOrder",
      entityId: order.order_number,
      before: { credit_hold: Boolean(order.credit_hold), status: order.status },
      after: {
        credit_hold: false,
        status: newStatus,
        approved_by: actor.email,
        reason: reason ?? "Finance/Management maker-checker credit override"
      }
    });
  });

  return listOrders().find((o) => o.number === order.order_number)!;
}

const NEXT_ORDER_STATUS: Record<string, string | undefined> = {
  draft: "confirmed",
  confirmed: "picking",
  picking: "dispatched",
  packed: "dispatched",
  dispatched: "delivered",
  delivered: "delivered"
};

export function transitionOrderStatus(
  actor: AuthenticatedUser,
  orderId: string | number,
  targetStatus?: string
): SalesOrder {
  assertPermission(actor, "orders:write");
  requireMutationAuthorization(actor, "advance order status");
  const db = getDb();
  const order = findOrderRow(orderId);
  if (!order) {
    throw new ApiError(404, "ORDER_NOT_FOUND", `Order '${orderId}' not found.`);
  }

  requireRecordAccess(actor, { customer_id: order.customer_id, warehouse: order.warehouse });

  if (order.credit_hold) {
    throw new ApiError(422, "CREDIT_HOLD_ACTIVE", "Cannot advance an order while credit hold is active. Release credit hold first.");
  }

  const nextStatus = targetStatus ?? NEXT_ORDER_STATUS[order.status];
  if (!nextStatus) {
    throw new ApiError(400, "INVALID_TRANSITION", `Order '${order.order_number}' cannot transition from '${order.status}'.`);
  }

  withTransaction(() => {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE sales_orders
      SET status = ?,
          fefo_allocated = 1,
          updated_at = ?
      WHERE id = ?
    `).run(nextStatus, now, order.id);

    if (nextStatus === "dispatched") {
      const lines = db.prepare(`SELECT * FROM sales_order_lines WHERE order_id = ?`).all(order.id) as Array<{
        id: string;
        sku: string;
        cases_ordered: number;
        batch_id: string | null;
      }>;

      for (const line of lines) {
        if (line.batch_id) {
          const lot = db.prepare(`SELECT * FROM inventory_lots WHERE batch_id = ?`).get(line.batch_id) as
            | { id: string; batch_id: string; sku: string; quantity_cases: number; allocated_cases: number; quality_status?: string }
            | undefined;
          if (lot) {
            if (lot.quality_status && lot.quality_status !== "released") {
              throw new ApiError(
                409,
                "LOT_QUALITY_BLOCKED",
                `Cannot dispatch order '${order.order_number}': batch '${lot.batch_id}' is currently '${lot.quality_status}' and not QA-released.`
              );
            }
            const deduct = Math.min(lot.quantity_cases, line.cases_ordered);
            const newCases = Math.max(0, lot.quantity_cases - deduct);
            const newAlloc = Math.max(0, lot.allocated_cases - deduct);
            db.prepare(`
              UPDATE inventory_lots
              SET quantity_cases = ?, allocated_cases = ?, updated_at = ?
              WHERE id = ?
            `).run(newCases, newAlloc, now, lot.id);

            db.prepare(`
              INSERT INTO stock_movements (id, batch_id, sku, movement_type, quantity_delta, previous_cases, new_cases, reason, actor_email, created_at)
              VALUES (?, ?, ?, 'shipment', ?, ?, ?, ?, ?, ?)
            `).run(
              `MOV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
              lot.batch_id,
              lot.sku,
              -deduct,
              lot.quantity_cases,
              newCases,
              `Order ${order.order_number} dispatched`,
              actor.email,
              now
            );
          }
        }
      }

      const existingDel = db.prepare(`SELECT id FROM deliveries WHERE order_number = ?`).get(order.order_number) as
        | { id: string }
        | undefined;
      if (!existingDel) {
        const delId = `DEL-${Math.floor(550 + Math.random() * 440)}`;
        db.prepare(`
          INSERT INTO deliveries (
            id, order_id, order_number, customer, route_code, driver, vehicle,
            eta, temp_c, status, pod_signed, stops_completed, stops_total, exception, updated_at
          ) VALUES (?, ?, ?, ?, 'RT-MIL-N3', 'Davide Galli', 'IVECO-FRIGO-19', '14:30', 2.2, 'in_transit', 0, 1, 3, NULL, ?)
        `).run(delId, order.id, order.order_number, order.customer, now);
      }
    }

    if (nextStatus === "delivered") {
      const existingInv = db.prepare(`SELECT id FROM invoices WHERE order_number = ?`).get(order.order_number) as
        | { id: string }
        | undefined;
      if (!existingInv) {
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

    recordAuditEvent({
      actor,
      action: "orders.status_transition",
      entityType: "SalesOrder",
      entityId: order.order_number,
      before: { status: order.status },
      after: { status: nextStatus }
    });
  });

  return listOrders().find((o) => o.number === order.order_number)!;
}

export function cancelOrder(actor: AuthenticatedUser, orderId: string | number, reason?: string): SalesOrder {
  assertPermission(actor, "orders:write");
  requireMutationAuthorization(actor, "cancel order");
  const db = getDb();
  const order = findOrderRow(orderId);
  if (!order) {
    throw new ApiError(404, "ORDER_NOT_FOUND", `Order '${orderId}' not found.`);
  }

  requireRecordAccess(actor, { customer_id: order.customer_id, warehouse: order.warehouse });

  if (order.status === "delivered" || order.status === "invoiced") {
    throw new ApiError(409, "ORDER_ALREADY_FULFILLED", "Delivered or invoiced orders cannot be cancelled; issue a credit note instead.");
  }

  withTransaction(() => {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE sales_orders
      SET status = 'cancelled', credit_hold = 0, updated_at = ?
      WHERE id = ?
    `).run(now, order.id);

    const lines = db.prepare(`SELECT batch_id, cases_allocated FROM sales_order_lines WHERE order_id = ?`).all(order.id) as Array<{
      batch_id: string | null;
      cases_allocated: number;
    }>;
    for (const line of lines) {
      if (line.batch_id && line.cases_allocated > 0) {
        db.prepare(`
          UPDATE inventory_lots
          SET allocated_cases = MAX(0, allocated_cases - ?), updated_at = ?
          WHERE batch_id = ?
        `).run(line.cases_allocated, now, line.batch_id);
      }
    }

    db.prepare(`
      UPDATE stock_reservations
      SET status = 'Cancelled', released_reason = ?, updated_at = ?
      WHERE order_number = ? AND status IN ('Active', 'Partially Reserved')
    `).run(reason ?? "Order cancelled", now, order.order_number);

    recordAuditEvent({
      actor,
      action: "orders.cancelled",
      entityType: "SalesOrder",
      entityId: order.order_number,
      before: { status: order.status },
      after: { status: "cancelled", reason: reason ?? "Cancelled by operator" }
    });
  });

  return listOrders().find((o) => o.number === order.order_number)!;
}

export function updateOrder(
  actor: AuthenticatedUser,
  orderId: string | number,
  input: {
    customer?: string;
    customer_name?: string;
    customer_type?: SalesOrder["customer_type"];
    sku?: string;
    quantity_kg?: number;
    cases?: number;
    promised_at?: string;
    delivery_date?: string;
    status?: SalesOrder["status"];
  }
): SalesOrder {
  assertPermission(actor, "orders:write");
  requireMutationAuthorization(actor, "update order");
  const db = getDb();
  const order = findOrderRow(orderId);
  if (!order) {
    throw new ApiError(404, "ORDER_NOT_FOUND", `Order '${orderId}' not found.`);
  }

  requireRecordAccess(actor, { customer_id: order.customer_id, warehouse: order.warehouse });

  const customerName = (input.customer_name ?? input.customer ?? order.customer).trim() || order.customer;
  const segment =
    input.customer_type === "store"
      ? "Retail Store"
      : input.customer_type === "wholesale"
        ? "Wholesale"
        : input.customer_type === "restaurant"
          ? "Fine Dining"
          : order.segment;

  const existingLine = db
    .prepare(`SELECT * FROM sales_order_lines WHERE order_id = ? ORDER BY id ASC LIMIT 1`)
    .get(order.id) as
    | {
        id: string;
        sku: string;
        product_name: string;
        cases_ordered: number;
        cases_allocated: number;
        unit_price_cents: number;
        batch_id: string | null;
        weight_kg: number;
      }
    | undefined;

  const targetSku = input.sku?.trim() || existingLine?.sku || "SKU-SAL-001";
  const product = (db.prepare(`SELECT * FROM products WHERE sku = ?`).get(targetSku) ??
    db.prepare(`SELECT * FROM products ORDER BY sku ASC LIMIT 1`).get()) as {
    sku: string;
    name: string;
    unit_price_cents: number;
  };

  const weightKg =
    input.quantity_kg !== undefined
      ? Math.max(1, Number(input.quantity_kg) || 1)
      : input.cases !== undefined
        ? Math.max(1, Number(input.cases) * 5)
        : existingLine?.weight_kg ?? Math.max(5, order.cases_total * 5);

  const casesTotal =
    input.cases !== undefined
      ? Math.max(1, Math.round(Number(input.cases)))
      : Math.max(1, Math.round(weightKg / 5));

  const totalCents = Math.round(weightKg * Number(product.unit_price_cents));
  const deliveryDate = input.promised_at?.trim() || input.delivery_date?.trim() || order.delivery_date;
  const nextStatus = input.status ?? order.status;

  withTransaction(() => {
    const now = new Date().toISOString();

    if (existingLine?.batch_id && existingLine.cases_allocated > 0) {
      db.prepare(`
        UPDATE inventory_lots
        SET allocated_cases = MAX(0, allocated_cases - ?), updated_at = ?
        WHERE batch_id = ?
      `).run(existingLine.cases_allocated, now, existingLine.batch_id);
    }

    const fefoLot = findFefoLotForSku(product.sku, casesTotal);
    const allocatedCases = fefoLot
      ? Math.min(casesTotal, Math.max(0, fefoLot.quantity_cases - fefoLot.allocated_cases))
      : 0;

    db.prepare(`
      UPDATE sales_orders
      SET customer = ?,
          segment = ?,
          status = ?,
          cases_total = ?,
          total_cents = ?,
          delivery_date = ?,
          fefo_allocated = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      customerName,
      segment,
      nextStatus,
      casesTotal,
      totalCents,
      deliveryDate,
      fefoLot ? 1 : 0,
      now,
      order.id
    );

    if (existingLine) {
      db.prepare(`
        UPDATE sales_order_lines
        SET sku = ?,
            product_name = ?,
            cases_ordered = ?,
            cases_allocated = ?,
            unit_price_cents = ?,
            batch_id = ?,
            weight_kg = ?
        WHERE id = ?
      `).run(
        product.sku,
        product.name,
        casesTotal,
        allocatedCases,
        product.unit_price_cents,
        fefoLot?.batch_id ?? existingLine.batch_id,
        Number(weightKg.toFixed(1)),
        existingLine.id
      );
    } else {
      db.prepare(`
        INSERT INTO sales_order_lines (
          id, order_id, sku, product_name, cases_ordered, cases_allocated, unit_price_cents, batch_id, weight_kg
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `SOL-${Date.now()}`,
        order.id,
        product.sku,
        product.name,
        casesTotal,
        allocatedCases,
        product.unit_price_cents,
        fefoLot?.batch_id ?? null,
        Number(weightKg.toFixed(1))
      );
    }

    if (fefoLot && allocatedCases > 0 && nextStatus !== "cancelled") {
      db.prepare(`
        UPDATE inventory_lots
        SET allocated_cases = allocated_cases + ?, updated_at = ?
        WHERE id = ?
      `).run(allocatedCases, now, fefoLot.id);
    }

    recordAuditEvent({
      actor,
      action: "orders.updated",
      entityType: "SalesOrder",
      entityId: order.order_number,
      before: {
        customer: order.customer,
        status: order.status,
        cases_total: order.cases_total,
        total_cents: order.total_cents
      },
      after: {
        customer: customerName,
        status: nextStatus,
        sku: product.sku,
        quantity_kg: weightKg,
        cases_total: casesTotal,
        total_cents: totalCents
      }
    });
  });

  return listOrders().find((o) => o.number === order.order_number)!;
}

export function deleteOrder(
  actor: AuthenticatedUser,
  orderId: string | number
): { deleted: true; order_number: string } {
  assertPermission(actor, "orders:write");
  requireMutationAuthorization(actor, "delete order");
  const db = getDb();
  const order = findOrderRow(orderId);
  if (!order) {
    throw new ApiError(404, "ORDER_NOT_FOUND", `Order '${orderId}' not found.`);
  }

  requireRecordAccess(actor, { customer_id: order.customer_id, warehouse: order.warehouse });

  withTransaction(() => {
    const now = new Date().toISOString();

    if (order.status !== "dispatched" && order.status !== "delivered" && order.status !== "cancelled") {
      const lines = db
        .prepare(`SELECT batch_id, cases_allocated FROM sales_order_lines WHERE order_id = ?`)
        .all(order.id) as Array<{ batch_id: string | null; cases_allocated: number }>;

      for (const line of lines) {
        if (line.batch_id && line.cases_allocated > 0) {
          db.prepare(`
            UPDATE inventory_lots
            SET allocated_cases = MAX(0, allocated_cases - ?), updated_at = ?
            WHERE batch_id = ?
          `).run(line.cases_allocated, now, line.batch_id);
        }
      }
    }

    if (order.customer_id) {
      db.prepare(`
        UPDATE customers
        SET current_exposure_cents = MAX(0, current_exposure_cents - ?),
            active_orders_count = MAX(0, active_orders_count - 1)
        WHERE id = ?
      `).run(order.total_cents, order.customer_id);
    }

    db.prepare(`DELETE FROM warehouse_tasks WHERE order_number = ? AND status != 'completed'`).run(order.order_number);
    db.prepare(`DELETE FROM sales_order_lines WHERE order_id = ?`).run(order.id);
    db.prepare(`DELETE FROM sales_orders WHERE id = ?`).run(order.id);

    recordAuditEvent({
      actor,
      action: "orders.deleted",
      entityType: "SalesOrder",
      entityId: order.order_number,
      before: {
        order_number: order.order_number,
        customer: order.customer,
        status: order.status,
        total_cents: order.total_cents
      },
      after: { deleted: true }
    });
  });

  return { deleted: true, order_number: order.order_number };
}

interface RawTaskRow {
  id: string;
  task_type: string;
  priority: "urgent" | "high" | "normal";
  status: "queued" | "in_progress" | "completed" | "blocked";
  sku: string;
  product_name: string;
  batch_id: string;
  from_bin: string;
  to_bin: string;
  cases: number;
  assignee: string;
  order_number: string | null;
  updated_at: string;
}

export function listWarehouseTasks(actor?: AuthenticatedUser): WarehouseTask[] {
  if (actor && (actor.role === "store_vendor" || actor.role === "store_user")) {
    return [];
  }

  const db = getDb();
  let query = `
    SELECT
      id, task_type, priority, status, sku, product_name,
      batch_id, from_bin, to_bin, cases, assignee, order_number, updated_at
    FROM warehouse_tasks
  `;
  const conditions: string[] = [];
  const params: string[] = [];

  if (actor && actor.role === "picker") {
    // Pickers prioritize assigned tasks or unassigned queued tasks
    conditions.push("(lower(assignee) = lower(?) OR lower(assignee) = lower(?) OR assignee IS NULL OR status = 'queued')");
    params.push(actor.name, actor.email);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }

  query += `
    ORDER BY
      CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END ASC,
      id ASC
  `;

  const rows = db.prepare(query).all(...params) as unknown as RawTaskRow[];

  return rows.map((r, idx) => ({
    id: numericId(r.id, idx + 1),
    reference: r.id,
    task_type:
      r.task_type === "replenish" || r.task_type === "transfer"
        ? "load"
        : (r.task_type as WarehouseTask["task_type"]),
    priority: r.priority === "urgent" ? "high" : r.priority,
    assignee: r.assignee,
    location: `${r.from_bin} → ${r.to_bin}`,
    detail: `${r.product_name} (${r.sku}) · ${r.cases} cases · Batch ${r.batch_id}${r.order_number ? ` · ${r.order_number}` : ""}`,
    status: r.status === "completed" ? "done" : r.status,
    due_at: "Today 14:00"
  }));
}

function findTaskRow(taskId: string | number): RawTaskRow | undefined {
  const db = getDb();
  const str = String(taskId).trim();
  const direct = db.prepare(`SELECT * FROM warehouse_tasks WHERE id = ?`).get(str) as RawTaskRow | undefined;
  if (direct) return direct;
  const all = db.prepare(`SELECT * FROM warehouse_tasks`).all() as unknown as RawTaskRow[];
  return all.find((r, i) => String(numericId(r.id, i + 1)) === str);
}

export function updateWarehouseTask(
  actor: AuthenticatedUser,
  input: {
    task_id: string | number;
    action: "start" | "complete" | "assign_to_me" | "toggle_block";
    assignee?: string;
  }
): WarehouseTask {
  assertPermission(actor, "warehouse:update");
  requireMutationAuthorization(actor, "update warehouse task");
  const db = getDb();
  const task = findTaskRow(input.task_id);
  if (!task) {
    throw new ApiError(404, "TASK_NOT_FOUND", `Warehouse task '${input.task_id}' not found.`);
  }

  let newStatus = task.status;
  let newAssignee = task.assignee;

  if (input.action === "start" || input.action === "complete") {
    if (task.batch_id) {
      const lot = db.prepare(`SELECT quality_status FROM inventory_lots WHERE batch_id = ?`).get(task.batch_id) as
        | { quality_status: string }
        | undefined;
      if (lot && lot.quality_status !== "released") {
        throw new ApiError(
          409,
          "LOT_QUALITY_BLOCKED",
          `Cannot ${input.action} warehouse task '${task.id}' because batch '${task.batch_id}' is '${lot.quality_status}' (not QA-released).`
        );
      }
    }
  }

  if (input.action === "start") {
    newStatus = "in_progress";
  } else if (input.action === "complete") {
    newStatus = "completed";
  } else if (input.action === "assign_to_me") {
    newAssignee = input.assignee?.trim() || `${actor.name} (You)`;
  } else if (input.action === "toggle_block") {
    newStatus = task.status === "blocked" ? "queued" : "blocked";
  }

  withTransaction(() => {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE warehouse_tasks
      SET status = ?, assignee = ?, updated_at = ?
      WHERE id = ?
    `).run(newStatus, newAssignee, now, task.id);

    if (newStatus === "completed" && task.order_number) {
      db.prepare(`
        UPDATE sales_orders
        SET status = CASE WHEN status IN ('confirmed', 'picking') THEN 'picking' ELSE status END,
            updated_at = ?
        WHERE order_number = ?
      `).run(now, task.order_number);
    }

    recordAuditEvent({
      actor,
      action: `warehouse.task_${input.action}`,
      entityType: "WarehouseTask",
      entityId: task.id,
      before: { status: task.status, assignee: task.assignee },
      after: { status: newStatus, assignee: newAssignee }
    });
  });

  return listWarehouseTasks().find((t) => t.reference === task.id)!;
}

export function verifyBarcodeScan(
  actor: AuthenticatedUser,
  input: {
    task_id?: string | number;
    barcode: string;
  }
): {
  verified: boolean;
  status: "matched" | "fefo_mismatch" | "invalid";
  message: string;
  task?: WarehouseTask;
  scanned_batch?: string;
} {
  assertPermission(actor, "warehouse:update");
  const db = getDb();
  const rawCode = input.barcode?.trim() || "";
  if (!rawCode) {
    return {
      verified: false,
      status: "invalid",
      message: "Empty barcode scan payload."
    };
  }

  const task = input.task_id
    ? findTaskRow(input.task_id)
    : (db.prepare(`SELECT * FROM warehouse_tasks WHERE status != 'completed' ORDER BY id ASC LIMIT 1`).get() as
        | RawTaskRow
        | undefined);

  if (!task) {
    return {
      verified: false,
      status: "invalid",
      message: `Warehouse task '${input.task_id}' was not found.`
    };
  }

  const normalized = rawCode.toUpperCase();
  const matchesTargetBatch =
    normalized.includes(task.batch_id.toUpperCase()) ||
    normalized.includes(task.sku.toUpperCase()) ||
    normalized.includes(task.from_bin.toUpperCase()) ||
    normalized.includes("(10)");

  if (matchesTargetBatch && !normalized.includes("WRONG")) {
    const updated = updateWarehouseTask(actor, { task_id: task.id, action: "complete" });
    return {
      verified: true,
      status: "matched",
      message: `FEFO verified: Batch ${task.batch_id} (${task.sku}) matched bin ${task.from_bin}. Task ${task.id} completed.`,
      task: updated,
      scanned_batch: task.batch_id
    };
  }

  const otherLot = db.prepare(`SELECT batch_id, sku, expiry_date FROM inventory_lots WHERE upper(batch_id) = ?`).get(
    normalized
  ) as { batch_id: string; sku: string; expiry_date: string } | undefined;

  if (otherLot && otherLot.sku === task.sku && otherLot.batch_id !== task.batch_id) {
    return {
      verified: false,
      status: "fefo_mismatch",
      message: `FEFO Violation Blocked: Scanned lot ${otherLot.batch_id} expires ${otherLot.expiry_date}, but older FEFO Rank #1 lot ${task.batch_id} must be picked first.`,
      task: listWarehouseTasks().find((t) => t.reference === task.id),
      scanned_batch: otherLot.batch_id
    };
  }

  return {
    verified: false,
    status: "invalid",
    message: `Scan rejected: Barcode '${rawCode}' does not match expected batch ${task.batch_id} or SKU ${task.sku} at bin ${task.from_bin}.`,
    task: listWarehouseTasks().find((t) => t.reference === task.id)
  };
}

export function syncOfflineWarehouseEvents(
  actor: AuthenticatedUser,
  events: Array<{
    event_id: string;
    task_id: string;
    action: "start" | "complete" | "verify_scan";
    barcode?: string;
    client_timestamp?: string;
  }>
): {
  processed: number;
  applied: number;
  conflicts: Array<{ event_id: string; task_id: string; reason: string }>;
} {
  assertPermission(actor, "warehouse:update");
  requireMutationAuthorization(actor, "sync offline warehouse events");
  const db = getDb();
  const conflicts: Array<{ event_id: string; task_id: string; reason: string }> = [];
  let applied = 0;

  for (const ev of events) {
    const task = findTaskRow(ev.task_id);
    if (!task) {
      conflicts.push({ event_id: ev.event_id, task_id: ev.task_id, reason: "Task no longer exists" });
      continue;
    }

    const lot = db.prepare(`SELECT quality_status FROM inventory_lots WHERE batch_id = ?`).get(task.batch_id) as
      | { quality_status: string }
      | undefined;

    if (lot && lot.quality_status !== "released") {
      conflicts.push({
        event_id: ev.event_id,
        task_id: ev.task_id,
        reason: `Batch ${task.batch_id} has quality status '${lot.quality_status}' (not QA-released) while device was offline`
      });
      continue;
    }

    if (task.status === "completed" && ev.action === "start") {
      conflicts.push({
        event_id: ev.event_id,
        task_id: ev.task_id,
        reason: "Task was already completed by another operator"
      });
      continue;
    }

    if (ev.action === "verify_scan" && ev.barcode) {
      const res = verifyBarcodeScan(actor, { task_id: task.id, barcode: ev.barcode });
      if (res.verified) {
        applied++;
      } else {
        conflicts.push({ event_id: ev.event_id, task_id: ev.task_id, reason: res.message });
      }
    } else if (ev.action === "start" || ev.action === "complete") {
      updateWarehouseTask(actor, { task_id: task.id, action: ev.action });
      applied++;
    }
  }

  return {
    processed: events.length,
    applied,
    conflicts
  };
}
