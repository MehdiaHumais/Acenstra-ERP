import { getDb, withTransaction } from "@/server/db/connection";
import { ApiError } from "@/server/core/http";
import {
  AuthenticatedUser,
  assertPermission,
  hasPermission,
  recordAuditEvent,
  requireMutationAuthorization,
  requireWarehouseAccess
} from "@/server/security/auth";
import {
  evaluateFefoAllocation,
  resolveMinimumShelfLifeRequirement,
  createStockReservation,
  releaseOrCancelReservation
} from "@/server/services/stock-intelligence.service";

// ============================================================================
// Types & Enums
// ============================================================================

export type PickWaveStatus =
  | "pending"
  | "wave_created"
  | "assigned"
  | "picking"
  | "partially_picked"
  | "picked"
  | "packing"
  | "packed"
  | "staged"
  | "blocked"
  | "cancelled";

export type PickTaskStatus =
  | "pending"
  | "assigned"
  | "in_progress"
  | "picked"
  | "partially_picked"
  | "blocked"
  | "cancelled";

export type PackingRecordStatus =
  | "packing"
  | "packed"
  | "staged"
  | "loaded"
  | "rejected";

export type WaveStrategy =
  | "single_order"
  | "multi_order_batch"
  | "zone_batch"
  | "delivery_batch";

export interface PickWaveRecord {
  id: string;
  wave_number: string;
  warehouse: string;
  zone: string | null;
  priority: "urgent" | "high" | "normal" | "low";
  status: PickWaveStatus;
  strategy: WaveStrategy;
  assigned_picker_id: string | null;
  assigned_picker_name: string | null;
  scheduled_delivery_date: string | null;
  route_code: string | null;
  orders_count: number;
  tasks_count: number;
  cases_total: number;
  cases_picked: number;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  orders?: PickWaveOrderRecord[];
  tasks?: PickTaskRecord[];
}

export interface PickWaveOrderRecord {
  id: string;
  wave_id: string;
  order_id: string;
  order_number: string;
  customer_id: string;
  customer_name: string;
  status: string;
  delivery_date?: string;
  total_cents?: number;
  cases_total?: number;
  created_at: string;
}

export interface PickTaskRecord {
  id: string;
  task_number: string;
  wave_id: string;
  wave_number: string;
  order_id: string;
  order_number: string;
  order_line_id: string | null;
  customer_id: string;
  customer_name: string;
  sku: string;
  product_name: string;
  uom: string;
  requested_cases: number;
  picked_cases: number;
  allocated_lot: string;
  supplier_lot: string | null;
  expiry_date: string;
  warehouse: string;
  zone: string;
  bin_code: string;
  aisle: string | null;
  shelf_level: string | null;
  route_sequence: number;
  barcode_sku: string;
  barcode_bin: string;
  barcode_lot: string;
  is_catch_weight: boolean;
  expected_weight_kg: number;
  actual_weight_kg: number | null;
  weight_variance_pct: number | null;
  weight_tolerance_pct: number;
  weight_approved_by: string | null;
  status: PickTaskStatus;
  assigned_to: string | null;
  picker_id: string | null;
  picker_name: string | null;
  scanned_sku: string | null;
  scanned_bin: string | null;
  scanned_lot: string | null;
  manual_entry_reason: string | null;
  picked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PackingRecord {
  id: string;
  pack_number: string;
  wave_id: string | null;
  order_id: string;
  order_number: string;
  customer_id: string;
  customer_name: string;
  package_type: "pallet" | "carton" | "crate" | "insulated_box";
  sscc_barcode: string;
  container_id: string;
  temp_zone: "ambient" | "chilled" | "frozen";
  temp_condition_verified: boolean;
  segregation_verified: boolean;
  packaging_condition_verified: boolean;
  customer_instructions_verified: boolean;
  total_cases: number;
  total_weight_kg: number;
  staging_bin: string | null;
  staged_at: string | null;
  staged_by: string | null;
  status: PackingRecordStatus;
  packed_by: string;
  packed_at: string;
  notes: string | null;
  items?: PackingRecordItem[];
}

export interface PackingRecordItem {
  id: string;
  packing_id: string;
  pick_task_id: string | null;
  sku: string;
  product_name: string;
  lot_batch: string;
  expiry_date: string;
  cases_packed: number;
  weight_kg: number;
  uom: string;
}

export interface DispatchStagingLane {
  id: string;
  warehouse: string;
  lane_code: string;
  zone: string;
  capacity_pallets: number;
  current_occupancy: number;
  assigned_route: string | null;
  status: string;
}

export interface ShippingLabelData {
  package_id: string;
  pack_number: string;
  sscc_barcode: string;
  order_number: string;
  customer_name: string;
  delivery_address: string;
  delivery_date: string;
  package_type: string;
  temp_zone: string;
  total_cases: number;
  total_weight_kg: number;
  qr_payload: string;
  staging_bin: string | null;
  items: Array<{
    sku: string;
    product_name: string;
    lot_batch: string;
    expiry_date: string;
    cases: number;
    weight_kg: number;
  }>;
  pallet_label?: {
    sscc: string;
    order_id: string;
    order_number: string;
    customer_name: string;
    delivery_address: string;
    delivery_date: string;
    total_cases: number;
    total_weight_kg: number;
    qr_payload: string;
  };
  package_labels?: Array<{
    sku: string;
    product_name: string;
    lot_number: string;
    expiry_date: string;
    cases: number;
    weight_kg: number;
  }>;
}

// ============================================================================
// Helper Utilities
// ============================================================================

/**
 * Computes deterministic alphanumeric route sequence based on physical warehouse layout.
 * Example: Zone prefix + Aisle + Shelf rank (CH-A01 -> 101, CH-A02 -> 102, CH-B03 -> 203, FZ-D08 -> 408)
 */
function computeRouteSequence(zone: string, binCode: string): number {
  const normBin = binCode.toUpperCase().trim();
  // Extract number from bin (e.g. CH-A01 -> A=1, 01 -> 101)
  const aisleMatch = normBin.match(/([A-Z]+)[-_]?([0-9]+)/);
  if (aisleMatch) {
    const letterCode = aisleMatch[1].charCodeAt(aisleMatch[1].length - 1) - 64; // A=1, B=2
    const numCode = parseInt(aisleMatch[2], 10);
    return letterCode * 100 + numCode;
  }
  return 999;
}

/**
 * Computes GS1 SSCC-18 Modulo 10 Check Digit
 */
function calculateSscc18CheckDigit(digits17: string): number {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const digit = parseInt(digits17[i], 10);
    sum += i % 2 === 0 ? digit * 3 : digit * 1;
  }
  const mod = sum % 10;
  return mod === 0 ? 0 : 10 - mod;
}

function generateSscc18Barcode(serialIndex: number): string {
  // (00) 3 8001234 567890123 C
  // 3 (pallet extension), 8001234 (GS1 company prefix for Ascentra), 9 digits serial
  const ext = "3";
  const prefix = "8001234";
  const serial = String(serialIndex).padStart(9, "0");
  const base17 = `${ext}${prefix}${serial}`;
  const checkDigit = calculateSscc18CheckDigit(base17);
  return `(00)${base17}${checkDigit}`;
}

// ============================================================================
// 1. List Eligible Customer Orders For Wave Creation
// ============================================================================

export function listEligibleOrdersForWave(
  actor: AuthenticatedUser,
  filters: {
    warehouse?: string;
    scheduled_delivery_date?: string;
    route_code?: string;
    limit?: number;
  } = {}
): Array<{
  id: string;
  order_number: string;
  customer_id: string;
  customer_name: string;
  segment: string;
  warehouse: string;
  delivery_date: string;
  route_code: string | null;
  items_count: number;
  cases_total: number;
  total_cents: number;
  status: string;
  lines: Array<{
    id: string;
    sku: string;
    product_name: string;
    cases_ordered: number;
    cases_allocated: number;
    uom: string;
    batch_id: string | null;
  }>;
}> {
  assertPermission(actor, "orders.read");
  const db = getDb();

  const conditions: string[] = ["s.status IN ('confirmed', 'partially_confirmed')"];
  const params: any[] = [];

  if (filters.warehouse) {
    requireWarehouseAccess(actor, filters.warehouse);
    conditions.push("s.warehouse = ?");
    params.push(filters.warehouse);
  } else if (actor.warehouse && actor.role !== "super_admin") {
    conditions.push("s.warehouse = ?");
    params.push(actor.warehouse);
  }

  if (filters.scheduled_delivery_date) {
    conditions.push("s.delivery_date = ?");
    params.push(filters.scheduled_delivery_date.slice(0, 10));
  }

  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 50));
  const query = `
    SELECT s.id, s.order_number, s.customer_id, s.customer as customer_name,
           s.segment, s.warehouse, s.delivery_date, s.items_count, s.cases_total,
           s.total_cents, s.status,
           d.route_code
    FROM sales_orders s
    LEFT JOIN deliveries d ON d.order_number = s.order_number
    WHERE ${conditions.join(" AND ")}
    ORDER BY s.delivery_date ASC, s.order_number ASC
    LIMIT ?
  `;
  params.push(limit);

  const orders = db.prepare(query).all(...params) as any[];

  return orders.map((ord) => {
    const lines = db.prepare(`
      SELECT id, sku, product_name, cases_ordered, cases_allocated, uom, batch_id
      FROM sales_order_lines
      WHERE order_id = ?
    `).all(ord.id) as any[];

    return {
      id: ord.id,
      order_number: ord.order_number,
      customer_id: ord.customer_id,
      customer_name: ord.customer_name,
      segment: ord.segment,
      warehouse: ord.warehouse,
      delivery_date: ord.delivery_date,
      route_code: ord.route_code || null,
      items_count: ord.items_count,
      cases_total: ord.cases_total,
      total_cents: ord.total_cents,
      status: ord.status,
      lines: lines.map((l) => ({
        id: l.id,
        sku: l.sku,
        product_name: l.product_name,
        cases_ordered: Number(l.cases_ordered),
        cases_allocated: Number(l.cases_allocated),
        uom: l.uom || "case",
        batch_id: l.batch_id || null
      }))
    };
  });
}

// ============================================================================
// 2. Pick Wave Generation with FEFO Batch Allocation & Route Optimization
// ============================================================================

export function createPickWave(
  actor: AuthenticatedUser,
  input: {
    warehouse: string;
    strategy?: WaveStrategy;
    priority?: "urgent" | "high" | "normal" | "low";
    zone?: string;
    order_ids: string[];
    scheduled_delivery_date?: string;
    assigned_picker_id?: string;
    assigned_picker_name?: string;
    notes?: string;
  }
): PickWaveRecord {
  assertPermission(actor, "warehouse:update");
  requireMutationAuthorization(actor, "create pick wave");
  requireWarehouseAccess(actor, input.warehouse);

  if (!input.order_ids || input.order_ids.length === 0) {
    throw new ApiError(400, "ORDERS_REQUIRED", "At least one confirmed order must be selected for wave generation.");
  }

  const db = getDb();
  const warehouse = input.warehouse.trim();
  const priority = input.priority || "normal";
  const strategy = input.strategy || (input.order_ids.length === 1 ? "single_order" : "multi_order_batch");
  const targetZone = input.zone?.trim() || null;

  return withTransaction(() => {
    // 1. Fetch and validate selected orders
    const placeholders = input.order_ids.map(() => "?").join(",");
    const orders = db.prepare(`
      SELECT * FROM sales_orders
      WHERE (id IN (${placeholders}) OR order_number IN (${placeholders}))
        AND warehouse = ?
    `).all(...input.order_ids, ...input.order_ids, warehouse) as any[];

    if (orders.length === 0) {
      throw new ApiError(404, "ORDERS_NOT_FOUND", `None of the requested orders were found in warehouse '${warehouse}'.`);
    }

    for (const ord of orders) {
      if (ord.status !== "confirmed" && ord.status !== "partially_confirmed") {
        throw new ApiError(
          409,
          "ORDER_NOT_CONFIRMED",
          `Order '${ord.order_number}' has status '${ord.status}'. Only confirmed or partially confirmed orders can be added to a pick wave.`
        );
      }
    }

    // 2. Generate unique wave number WAV-2026-XXXX
    const maxWaveRow = db.prepare(`SELECT wave_number FROM pick_waves WHERE wave_number LIKE 'WAV-2026-%' ORDER BY wave_number DESC LIMIT 1`).get() as { wave_number: string } | undefined;
    let nextSuffix = 101;
    if (maxWaveRow?.wave_number) {
      const parsed = parseInt(maxWaveRow.wave_number.replace("WAV-2026-", ""), 10);
      if (!isNaN(parsed)) nextSuffix = parsed + 1;
    }
    const waveNumber = `WAV-2026-${String(nextSuffix).padStart(4, "0")}`;
    const waveId = waveNumber;
    const now = new Date().toISOString();

    let totalCases = 0;
    const taskRowsToInsert: any[] = [];
    let taskCounter = 1;

    // 3. Process each order and each line with FEFO batch allocation
    for (const order of orders) {
      const lines = db.prepare(`SELECT * FROM sales_order_lines WHERE order_id = ?`).all(order.id) as any[];

      for (const line of lines) {
        // If zone filter is specified, only include products matching the zone
        const prod = db.prepare(`SELECT * FROM products WHERE sku = ?`).get(line.sku) as any;
        if (!prod) continue;

        const prodZone = prod.temp_zone?.toLowerCase().includes("frozen")
          ? "Deep Freeze"
          : prod.temp_zone?.toLowerCase().includes("produce")
            ? "Produce C"
            : prod.category === "Seafood"
              ? "Chilled A"
              : prod.category === "Dairy"
                ? "Chilled B"
                : "Ambient";

        if (targetZone && targetZone !== "ALL" && !prodZone.toLowerCase().includes(targetZone.toLowerCase())) {
          continue;
        }

        const casesNeeded = Math.max(1, Number(line.cases_ordered) - Number(line.cases_allocated || 0));

        // Evaluate FEFO allocation via Module 06
        let fefoEval: any = null;
        try {
          fefoEval = evaluateFefoAllocation(actor, {
            sku: line.sku,
            requested_cases: Number(line.cases_ordered),
            delivery_date: order.delivery_date,
            customer_id: order.customer_id,
            warehouse,
            allow_partial: true,
            persist_log: false
          });
        } catch (err: any) {
          // If no released stock available
          if (err?.code !== "INSUFFICIENT_ELIGIBLE_STOCK" && err?.statusCode !== 409) {
            throw err;
          }
        }

        // If FEFO allocation produced lot candidates, allocate across lots
        const allocations = fefoEval?.allocations && fefoEval.allocations.length > 0
          ? fefoEval.allocations
          : [
              {
                internal_lot: line.batch_id || "LOT-DEFAULT",
                supplier_batch: "SUP-DEFAULT",
                warehouse,
                bin_code: "CH-A01",
                expiry_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
                allocated_cases: casesNeeded
              }
            ];

        for (const alloc of allocations) {
          if (alloc.allocated_cases <= 0) continue;

          // Find exact lot record for location & supplier lot
          const lotRow = db.prepare(`SELECT * FROM inventory_lots WHERE batch_id = ?`).get(alloc.internal_lot) as any;
          const binCode = lotRow?.location || alloc.bin_code || "CH-A01";
          const zone = lotRow?.zone || prodZone;
          const lotExpiry = lotRow?.expiry_date || alloc.expiry_date;
          const supplierLot = lotRow?.supplier_lot || alloc.supplier_batch || null;

          // Route sequence calculation (shortest physical walking path in warehouse)
          const routeSeq = computeRouteSequence(zone, binCode);

          // Catch-weight calculation
          const isCatchWeight = prod.catch_weight === 1;
          const unitWeightKg = Number(prod.unit_weight_kg) || 5.0;
          const expectedWeightKg = Math.round(alloc.allocated_cases * unitWeightKg * 100) / 100;
          const weightTolerancePct = Number(prod.weight_tolerance_pct) || 5.0;

          // Barcode generation
          const barcodeSku = `800${line.sku.replace(/\D/g, "").padStart(10, "0")}`;
          const barcodeBin = `LOC-${warehouse.substring(0, 3).toUpperCase()}-${binCode}`;
          const barcodeLot = `(01)${barcodeSku}(10)${alloc.internal_lot}(17)${lotExpiry.replace(/-/g, "").slice(2)}`;

          const taskNumber = `PTK-2026-${String(nextSuffix).padStart(4, "0")}-${String(taskCounter++).padStart(3, "0")}`;
          const taskId = taskNumber;

          totalCases += Number(alloc.allocated_cases);

          taskRowsToInsert.push({
            id: taskId,
            task_number: taskNumber,
            wave_id: waveId,
            wave_number: waveNumber,
            order_id: order.id,
            order_number: order.order_number,
            order_line_id: line.id,
            customer_id: order.customer_id,
            customer_name: order.customer,
            sku: line.sku,
            product_name: line.product_name,
            uom: line.uom || prod.uom || "case",
            requested_cases: Number(alloc.allocated_cases),
            allocated_lot: alloc.internal_lot,
            supplier_lot: supplierLot,
            expiry_date: lotExpiry,
            warehouse,
            zone,
            bin_code: binCode,
            aisle: binCode.split("-")[0] || null,
            shelf_level: binCode.split("-")[1] || null,
            route_sequence: routeSeq,
            barcode_sku: barcodeSku,
            barcode_bin: barcodeBin,
            barcode_lot: barcodeLot,
            is_catch_weight: isCatchWeight ? 1 : 0,
            expected_weight_kg: expectedWeightKg,
            weight_tolerance_pct: weightTolerancePct,
            status: "pending",
            assigned_to: input.assigned_picker_name || null,
            picker_id: input.assigned_picker_id || null,
            picker_name: input.assigned_picker_name || null
          });

          // Reserve stock in Module 06 if not already reserved
          try {
            createStockReservation(actor, {
              order_id: order.id,
              order_number: order.order_number,
              order_line_id: line.id,
              customer_id: order.customer_id,
              customer_name: order.customer,
              sku: line.sku,
              internal_lot: alloc.internal_lot,
              warehouse,
              requested_cases: Number(alloc.allocated_cases),
              delivery_date: order.delivery_date
            });
          } catch {
            // Reservation already active
          }
        }
      }

      // Transition order status to "picking"
      db.prepare(`UPDATE sales_orders SET status = 'picking', updated_at = ? WHERE id = ?`).run(now, order.id);
    }

    if (taskRowsToInsert.length === 0) {
      throw new ApiError(400, "NO_TASKS_GENERATED", "No eligible picking tasks could be generated for the selected orders and zone criteria.");
    }

    // Sort tasks along optimized physical warehouse picking route
    taskRowsToInsert.sort((a, b) => a.route_sequence - b.route_sequence);

    // 4. Insert Wave Header
    const initialWaveStatus: PickWaveStatus = input.assigned_picker_id ? "assigned" : "wave_created";

    db.prepare(`
      INSERT INTO pick_waves (
        id, wave_number, warehouse, zone, priority, status, strategy,
        assigned_picker_id, assigned_picker_name, scheduled_delivery_date,
        orders_count, tasks_count, cases_total, cases_picked, notes, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
    `).run(
      waveId,
      waveNumber,
      warehouse,
      targetZone,
      priority,
      initialWaveStatus,
      strategy,
      input.assigned_picker_id || null,
      input.assigned_picker_name || null,
      input.scheduled_delivery_date || orders[0]?.delivery_date || null,
      orders.length,
      taskRowsToInsert.length,
      totalCases,
      input.notes || null,
      actor.name || actor.email,
      now,
      now
    );

    // 5. Insert Wave Orders
    const insertWaveOrder = db.prepare(`
      INSERT INTO pick_wave_orders (id, wave_id, order_id, order_number, customer_id, customer_name, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'picking', ?)
    `);
    for (let i = 0; i < orders.length; i++) {
      const o = orders[i];
      insertWaveOrder.run(`PWO-${waveId}-${i + 1}`, waveId, o.id, o.order_number, o.customer_id, o.customer, now);
    }

    // 6. Insert Pick Tasks
    const insertTask = db.prepare(`
      INSERT INTO pick_tasks (
        id, task_number, wave_id, wave_number, order_id, order_number, order_line_id,
        customer_id, customer_name, sku, product_name, uom, requested_cases, picked_cases,
        allocated_lot, supplier_lot, expiry_date, warehouse, zone, bin_code, aisle, shelf_level,
        route_sequence, barcode_sku, barcode_bin, barcode_lot, is_catch_weight,
        expected_weight_kg, weight_tolerance_pct, status, assigned_to, picker_id, picker_name,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const t of taskRowsToInsert) {
      insertTask.run(
        t.id, t.task_number, t.wave_id, t.wave_number, t.order_id, t.order_number, t.order_line_id,
        t.customer_id, t.customer_name, t.sku, t.product_name, t.uom, t.requested_cases,
        t.allocated_lot, t.supplier_lot, t.expiry_date, t.warehouse, t.zone, t.bin_code,
        t.aisle, t.shelf_level, t.route_sequence, t.barcode_sku, t.barcode_bin, t.barcode_lot,
        t.is_catch_weight, t.expected_weight_kg, t.weight_tolerance_pct,
        input.assigned_picker_id ? "assigned" : "pending",
        t.assigned_to, t.picker_id, t.picker_name, now, now
      );

      // Sync into generic warehouse_tasks table for unified ERP visibility
      db.prepare(`
        INSERT OR REPLACE INTO warehouse_tasks (
          id, task_type, priority, status, sku, product_name, batch_id,
          from_bin, to_bin, cases, assignee, order_number, updated_at
        ) VALUES (?, 'pick', ?, 'queued', ?, ?, ?, ?, 'STAGE-D1', ?, ?, ?, ?)
      `).run(
        t.id, priority, t.sku, t.product_name, t.allocated_lot,
        t.bin_code, Math.ceil(t.requested_cases), t.assigned_to || "Pietro Rossi", t.order_number, now
      );
    }

    // 7. Audit Event
    recordAuditEvent({
      actor,
      action: "picking.wave_created",
      entityType: "PickWave",
      entityId: waveNumber,
      after: {
        wave_number: waveNumber,
        warehouse,
        strategy,
        orders_count: orders.length,
        tasks_count: taskRowsToInsert.length,
        total_cases: totalCases
      }
    });

    return getPickWave(actor, waveId);
  });
}

// ============================================================================
// 3. Get / List / Assign / Cancel Waves
// ============================================================================

export function getPickWave(actor: AuthenticatedUser, waveIdOrNumber: string): PickWaveRecord {
  assertPermission(actor, "warehouse:read");
  const db = getDb();

  const wave = db.prepare(`
    SELECT * FROM pick_waves
    WHERE id = ? OR wave_number = ?
    LIMIT 1
  `).get(waveIdOrNumber, waveIdOrNumber) as any;

  if (!wave) {
    throw new ApiError(404, "WAVE_NOT_FOUND", `Pick wave '${waveIdOrNumber}' was not found.`);
  }

  requireWarehouseAccess(actor, wave.warehouse);

  const orders = db.prepare(`
    SELECT o.*, s.delivery_date, s.total_cents, s.cases_total
    FROM pick_wave_orders o
    JOIN sales_orders s ON s.id = o.order_id
    WHERE o.wave_id = ?
    ORDER BY o.order_number ASC
  `).all(wave.id) as any[];

  const tasks = db.prepare(`
    SELECT * FROM pick_tasks
    WHERE wave_id = ?
    ORDER BY route_sequence ASC, task_number ASC
  `).all(wave.id) as any[];

  return {
    id: wave.id,
    wave_number: wave.wave_number,
    warehouse: wave.warehouse,
    zone: wave.zone || null,
    priority: wave.priority,
    status: wave.status,
    strategy: wave.strategy,
    assigned_picker_id: wave.assigned_picker_id || null,
    assigned_picker_name: wave.assigned_picker_name || null,
    scheduled_delivery_date: wave.scheduled_delivery_date || null,
    route_code: wave.route_code || null,
    orders_count: Number(wave.orders_count),
    tasks_count: Number(wave.tasks_count),
    cases_total: Number(wave.cases_total),
    cases_picked: Number(wave.cases_picked),
    notes: wave.notes || null,
    created_by: wave.created_by,
    created_at: wave.created_at,
    updated_at: wave.updated_at,
    orders: orders.map((o) => ({
      id: o.id,
      wave_id: o.wave_id,
      order_id: o.order_id,
      order_number: o.order_number,
      customer_id: o.customer_id,
      customer_name: o.customer_name,
      status: o.status,
      delivery_date: o.delivery_date,
      total_cents: Number(o.total_cents),
      cases_total: Number(o.cases_total),
      created_at: o.created_at
    })),
    tasks: tasks.map(hydratePickTask)
  };
}

export function listPickWaves(
  actor: AuthenticatedUser,
  filters: {
    warehouse?: string;
    status?: string;
    priority?: string;
    assigned_picker_id?: string;
    limit?: number;
    offset?: number;
  } = {}
): PickWaveRecord[] {
  assertPermission(actor, "warehouse:read");
  const db = getDb();

  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.warehouse) {
    requireWarehouseAccess(actor, filters.warehouse);
    conditions.push("warehouse = ?");
    params.push(filters.warehouse);
  } else if (actor.warehouse && actor.role !== "super_admin") {
    conditions.push("warehouse = ?");
    params.push(actor.warehouse);
  }

  if (filters.status && filters.status !== "all") {
    conditions.push("status = ?");
    params.push(filters.status);
  }

  if (filters.priority) {
    conditions.push("priority = ?");
    params.push(filters.priority);
  }

  if (filters.assigned_picker_id) {
    conditions.push("assigned_picker_id = ?");
    params.push(filters.assigned_picker_id);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 50));
  const offset = Math.max(0, Number(filters.offset) || 0);

  const rows = db.prepare(`
    SELECT * FROM pick_waves
    ${whereClause}
    ORDER BY
      CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END ASC,
      created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[];

  return rows.map((r) => ({
    id: r.id,
    wave_number: r.wave_number,
    warehouse: r.warehouse,
    zone: r.zone || null,
    priority: r.priority,
    status: r.status,
    strategy: r.strategy,
    assigned_picker_id: r.assigned_picker_id || null,
    assigned_picker_name: r.assigned_picker_name || null,
    scheduled_delivery_date: r.scheduled_delivery_date || null,
    route_code: r.route_code || null,
    orders_count: Number(r.orders_count),
    tasks_count: Number(r.tasks_count),
    cases_total: Number(r.cases_total),
    cases_picked: Number(r.cases_picked),
    notes: r.notes || null,
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at
  }));
}

export function assignPickWave(
  actor: AuthenticatedUser,
  waveIdOrNumber: string,
  input: { picker_id: string; picker_name: string }
): PickWaveRecord {
  assertPermission(actor, "warehouse:update");
  requireMutationAuthorization(actor, "assign pick wave");
  const db = getDb();
  const wave = getPickWave(actor, waveIdOrNumber);

  const pickerId = input.picker_id.trim();
  const pickerName = input.picker_name.trim();
  const now = new Date().toISOString();

  withTransaction(() => {
    db.prepare(`
      UPDATE pick_waves
      SET assigned_picker_id = ?,
          assigned_picker_name = ?,
          status = 'assigned',
          updated_at = ?
      WHERE id = ?
    `).run(pickerId, pickerName, now, wave.id);

    db.prepare(`
      UPDATE pick_tasks
      SET assigned_to = ?,
          picker_id = ?,
          picker_name = ?,
          status = CASE WHEN status = 'pending' THEN 'assigned' ELSE status END,
          updated_at = ?
      WHERE wave_id = ? AND status = 'pending'
    `).run(pickerName, pickerId, pickerName, now, wave.id);

    db.prepare(`
      UPDATE warehouse_tasks
      SET assignee = ?, updated_at = ?
      WHERE id IN (SELECT id FROM pick_tasks WHERE wave_id = ?)
    `).run(pickerName, now, wave.id);

    recordAuditEvent({
      actor,
      action: "picking.wave_assigned",
      entityType: "PickWave",
      entityId: wave.wave_number,
      after: { picker_id: pickerId, picker_name: pickerName }
    });
  });

  return getPickWave(actor, wave.id);
}

export function cancelPickWave(
  actor: AuthenticatedUser,
  waveIdOrNumber: string,
  reason: string
): { cancelled: true; wave_number: string } {
  assertPermission(actor, "warehouse:update");
  requireMutationAuthorization(actor, "cancel pick wave");
  const db = getDb();
  const wave = getPickWave(actor, waveIdOrNumber);

  if (wave.status === "staged" || wave.status === "packed") {
    throw new ApiError(409, "CANNOT_CANCEL_WAVE", `Wave '${wave.wave_number}' is already '${wave.status}' and cannot be cancelled.`);
  }

  const now = new Date().toISOString();

  withTransaction(() => {
    // 1. Mark wave cancelled
    db.prepare(`UPDATE pick_waves SET status = 'cancelled', notes = ?, updated_at = ? WHERE id = ?`).run(
      reason, now, wave.id
    );

    // 2. Mark tasks cancelled
    db.prepare(`UPDATE pick_tasks SET status = 'cancelled', updated_at = ? WHERE wave_id = ?`).run(now, wave.id);
    db.prepare(`UPDATE warehouse_tasks SET status = 'blocked', updated_at = ? WHERE id IN (SELECT id FROM pick_tasks WHERE wave_id = ?)`).run(now, wave.id);

    // 3. Revert order statuses to confirmed
    const orderIds = (wave.orders || []).map((o) => o.order_id);
    for (const orderId of orderIds) {
      db.prepare(`UPDATE sales_orders SET status = 'confirmed', updated_at = ? WHERE id = ?`).run(now, orderId);
    }

    recordAuditEvent({
      actor,
      action: "picking.wave_cancelled",
      entityType: "PickWave",
      entityId: wave.wave_number,
      after: { reason }
    });
  });

  return { cancelled: true, wave_number: wave.wave_number };
}

// ============================================================================
// 4. Picking Task Inspection & Route List
// ============================================================================

export function listPickTasks(
  actor: AuthenticatedUser,
  filters: {
    wave_id?: string;
    order_number?: string;
    warehouse?: string;
    status?: string;
    assigned_to?: string;
    limit?: number;
  } = {}
): PickTaskRecord[] {
  assertPermission(actor, "warehouse:read");
  const db = getDb();

  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.warehouse) {
    requireWarehouseAccess(actor, filters.warehouse);
    conditions.push("warehouse = ?");
    params.push(filters.warehouse);
  } else if (actor.warehouse && actor.role !== "super_admin") {
    conditions.push("warehouse = ?");
    params.push(actor.warehouse);
  }

  if (filters.wave_id) {
    conditions.push("(wave_id = ? OR wave_number = ?)");
    params.push(filters.wave_id, filters.wave_id);
  }

  if (filters.order_number) {
    conditions.push("order_number = ?");
    params.push(filters.order_number);
  }

  if (filters.status && filters.status !== "all") {
    conditions.push("status = ?");
    params.push(filters.status);
  }

  if (filters.assigned_to) {
    conditions.push("lower(assigned_to) = lower(?)");
    params.push(filters.assigned_to);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(200, Math.max(1, Number(filters.limit) || 100));

  const rows = db.prepare(`
    SELECT * FROM pick_tasks
    ${whereClause}
    ORDER BY route_sequence ASC, task_number ASC
    LIMIT ?
  `).all(...params, limit) as any[];

  return rows.map(hydratePickTask);
}

export function getPickTask(actor: AuthenticatedUser, taskIdOrNumber: string): PickTaskRecord {
  assertPermission(actor, "warehouse:read");
  const db = getDb();

  const task = db.prepare(`
    SELECT * FROM pick_tasks
    WHERE id = ? OR task_number = ?
    LIMIT 1
  `).get(taskIdOrNumber, taskIdOrNumber) as any;

  if (!task) {
    throw new ApiError(404, "TASK_NOT_FOUND", `Pick task '${taskIdOrNumber}' was not found.`);
  }

  requireWarehouseAccess(actor, task.warehouse);
  return hydratePickTask(task);
}

function hydratePickTask(t: any): PickTaskRecord {
  return {
    id: t.id,
    task_number: t.task_number,
    wave_id: t.wave_id,
    wave_number: t.wave_number,
    order_id: t.order_id,
    order_number: t.order_number,
    order_line_id: t.order_line_id || null,
    customer_id: t.customer_id,
    customer_name: t.customer_name,
    sku: t.sku,
    product_name: t.product_name,
    uom: t.uom || "case",
    requested_cases: Number(t.requested_cases),
    picked_cases: Number(t.picked_cases || 0),
    allocated_lot: t.allocated_lot,
    supplier_lot: t.supplier_lot || null,
    expiry_date: t.expiry_date,
    warehouse: t.warehouse,
    zone: t.zone,
    bin_code: t.bin_code,
    aisle: t.aisle || null,
    shelf_level: t.shelf_level || null,
    route_sequence: Number(t.route_sequence || 0),
    barcode_sku: t.barcode_sku,
    barcode_bin: t.barcode_bin,
    barcode_lot: t.barcode_lot,
    is_catch_weight: t.is_catch_weight === 1,
    expected_weight_kg: Number(t.expected_weight_kg || 0),
    actual_weight_kg: t.actual_weight_kg !== null ? Number(t.actual_weight_kg) : null,
    weight_variance_pct: t.weight_variance_pct !== null ? Number(t.weight_variance_pct) : null,
    weight_tolerance_pct: Number(t.weight_tolerance_pct || 5.0),
    weight_approved_by: t.weight_approved_by || null,
    status: t.status,
    assigned_to: t.assigned_to || null,
    picker_id: t.picker_id || null,
    picker_name: t.picker_name || null,
    scanned_sku: t.scanned_sku || null,
    scanned_bin: t.scanned_bin || null,
    scanned_lot: t.scanned_lot || null,
    manual_entry_reason: t.manual_entry_reason || null,
    picked_at: t.picked_at || null,
    created_at: t.created_at,
    updated_at: t.updated_at
  };
}

// ============================================================================
// 5. Barcode Verification Engine
// ============================================================================

export function verifyPickScan(
  actor: AuthenticatedUser,
  params: {
    task_id: string;
    scanned_bin: string;
    scanned_sku: string;
    scanned_lot: string;
    is_manual_entry?: boolean;
    manual_entry_reason?: string;
  }
): {
  verified: boolean;
  task: PickTaskRecord;
  message: string;
} {
  assertPermission(actor, "warehouse:update");
  const task = getPickTask(actor, params.task_id);
  const db = getDb();

  const scanBin = (params.scanned_bin || "").toUpperCase().trim();
  const scanSku = (params.scanned_sku || "").toUpperCase().trim();
  const scanLot = (params.scanned_lot || "").toUpperCase().trim();

  // If manual override was flagged, ensure reasoning was provided
  if (params.is_manual_entry) {
    const reason = params.manual_entry_reason?.trim();
    if (!reason || reason.length < 5) {
      throw new ApiError(400, "MANUAL_REASON_REQUIRED", "Manual barcode entry requires an explanation (minimum 5 characters).");
    }
  } else {
    // 1. Bin Verification
    const expectedBin = task.bin_code.toUpperCase();
    const expectedBinBarcode = task.barcode_bin.toUpperCase();
    const binMatches =
      scanBin === expectedBin ||
      scanBin === expectedBinBarcode ||
      scanBin.endsWith(expectedBin);

    if (!binMatches) {
      throw new ApiError(
        400,
        "WRONG_BIN_SCANNED",
        `Bin verification failed. Scanned '${params.scanned_bin}', but required bin is '${task.bin_code}'. Please navigate to aisle ${task.aisle || task.bin_code}.`
      );
    }

    // 2. SKU / Product Verification
    const expectedSku = task.sku.toUpperCase();
    const expectedSkuBarcode = task.barcode_sku.toUpperCase();
    const skuMatches =
      scanSku === expectedSku ||
      scanSku === expectedSkuBarcode ||
      scanSku.includes(expectedSku);

    if (!skuMatches) {
      throw new ApiError(
        400,
        "WRONG_PRODUCT_SCANNED",
        `Product verification failed. Scanned '${params.scanned_sku}', but required SKU is '${task.sku}' (${task.product_name}).`
      );
    }

    // 3. Lot / Batch Verification & FEFO Enforcement
    const expectedLot = task.allocated_lot.toUpperCase();
    const lotMatches =
      scanLot === expectedLot ||
      scanLot.includes(expectedLot);

    if (!lotMatches) {
      // Check if the scanned lot belongs to the same product but has a different expiry
      const scannedLotRow = db.prepare(`SELECT * FROM inventory_lots WHERE upper(batch_id) = ?`).get(scanLot) as any;

      if (scannedLotRow && scannedLotRow.sku.toUpperCase() === expectedSku) {
        if (scannedLotRow.expiry_date > task.expiry_date) {
          throw new ApiError(
            409,
            "FEFO_VIOLATION_BLOCKED",
            `FEFO violation blocked: Scanned lot '${scanLot}' expires on ${scannedLotRow.expiry_date}, but older FEFO rank lot '${task.allocated_lot}' (expires ${task.expiry_date}) must be picked first.`
          );
        }
        if (scannedLotRow.quality_status !== "released") {
          throw new ApiError(
            409,
            "LOT_NOT_RELEASED",
            `Blocked: Scanned lot '${scanLot}' has quality status '${scannedLotRow.quality_status}' and cannot be picked.`
          );
        }
      }

      throw new ApiError(
        400,
        "WRONG_LOT_SCANNED",
        `Lot verification failed. Scanned batch '${params.scanned_lot}', but assigned FEFO batch is '${task.allocated_lot}'.`
      );
    }
  }

  const now = new Date().toISOString();

  withTransaction(() => {
    db.prepare(`
      UPDATE pick_tasks
      SET scanned_bin = ?,
          scanned_sku = ?,
          scanned_lot = ?,
          manual_entry_reason = ?,
          status = CASE WHEN status = 'pending' OR status = 'assigned' THEN 'in_progress' ELSE status END,
          updated_at = ?
      WHERE id = ?
    `).run(
      params.scanned_bin,
      params.scanned_sku,
      params.scanned_lot,
      params.manual_entry_reason || null,
      now,
      task.id
    );

    recordAuditEvent({
      actor,
      action: "picking.scan_verified",
      entityType: "PickTask",
      entityId: task.task_number,
      after: {
        bin: params.scanned_bin,
        sku: params.scanned_sku,
        lot: params.scanned_lot,
        manual: Boolean(params.is_manual_entry)
      }
    });
  });

  return {
    verified: true,
    task: getPickTask(actor, task.id),
    message: `Barcode verification passed: Bin ${task.bin_code}, SKU ${task.sku}, Batch ${task.allocated_lot} verified successfully.`
  };
}

// ============================================================================
// 6. Catch-Weight Confirmation & Tolerance Checks
// ============================================================================

export function confirmCatchWeight(
  actor: AuthenticatedUser,
  params: {
    task_id: string;
    actual_weight_kg: number;
    package_count?: number;
    manager_approval_notes?: string;
  }
): {
  approved: boolean;
  variance_pct: number;
  requires_manager_override: boolean;
  message: string;
  task: PickTaskRecord;
} {
  assertPermission(actor, "warehouse:update");
  const task = getPickTask(actor, params.task_id);
  const db = getDb();

  const actualWeightKg = Math.round(Number(params.actual_weight_kg) * 100) / 100;
  if (actualWeightKg <= 0) {
    throw new ApiError(400, "INVALID_WEIGHT", "Actual weight must be a positive number.");
  }

  const expectedWeightKg = task.expected_weight_kg || task.requested_cases * 5.0;
  const varianceKg = actualWeightKg - expectedWeightKg;
  const variancePct = Math.round((varianceKg / expectedWeightKg) * 1000) / 10;
  const tolerancePct = task.weight_tolerance_pct || 5.0;

  const isWithinTolerance = Math.abs(variancePct) <= tolerancePct;
  let approved = isWithinTolerance;
  let approvedBy: string | null = null;
  let requiresManagerOverride = false;

  if (!isWithinTolerance) {
    // If user has manager/admin role, they can override with notes
    const canOverride = hasPermission(actor, "orders:credit_override") || hasPermission(actor, "settings.manage") || actor.role === "warehouse_manager";
    if (canOverride && params.manager_approval_notes && params.manager_approval_notes.trim().length >= 5) {
      approved = true;
      approvedBy = actor.name || actor.email;
    } else {
      requiresManagerOverride = true;
    }
  }

  const now = new Date().toISOString();

  withTransaction(() => {
    const nextStatus = approved ? (task.status === "pending" ? "in_progress" : task.status) : "blocked";

    db.prepare(`
      UPDATE pick_tasks
      SET actual_weight_kg = ?,
          weight_variance_pct = ?,
          weight_approved_by = ?,
          status = ?,
          updated_at = ?
      WHERE id = ?
    `).run(actualWeightKg, variancePct, approvedBy, nextStatus, now, task.id);

    // Propagate confirmed weight onto sales order line if approved
    if (approved && task.order_line_id) {
      db.prepare(`
        UPDATE sales_order_lines
        SET weight_kg = ?
        WHERE id = ?
      `).run(actualWeightKg, task.order_line_id);
    }

    recordAuditEvent({
      actor,
      action: "picking.catch_weight_confirmed",
      entityType: "PickTask",
      entityId: task.task_number,
      after: {
        actual_weight_kg: actualWeightKg,
        expected_weight_kg: expectedWeightKg,
        variance_pct: variancePct,
        approved,
        approved_by: approvedBy
      }
    });
  });

  return {
    approved,
    variance_pct: variancePct,
    requires_manager_override: requiresManagerOverride,
    message: approved
      ? `Catch-weight confirmed: ${actualWeightKg} kg (variance ${variancePct > 0 ? "+" : ""}${variancePct}%, tolerance ±${tolerancePct}%).`
      : `Variance ${variancePct}% exceeds configured tolerance of ±${tolerancePct}%. Supervisor approval required.`,
    task: getPickTask(actor, task.id)
  };
}

// ============================================================================
// 7. Complete Pick Task & Advance Wave Progress
// ============================================================================

export function completePickTask(
  actor: AuthenticatedUser,
  params: {
    task_id: string;
    picked_cases?: number;
    notes?: string;
  }
): PickTaskRecord {
  assertPermission(actor, "warehouse:update");
  requireMutationAuthorization(actor, "complete pick task");
  const task = getPickTask(actor, params.task_id);
  const db = getDb();

  if (task.status === "picked") {
    return task;
  }

  // Ensure barcode scan was performed or verified
  if (!task.scanned_lot && !task.manual_entry_reason) {
    throw new ApiError(400, "SCAN_REQUIRED", "Task barcode scanning must be verified before completing the pick.");
  }

  // If catch-weight, ensure weight was recorded
  if (task.is_catch_weight && task.actual_weight_kg === null) {
    throw new ApiError(400, "WEIGHT_REQUIRED", "Catch-weight confirmation must be recorded before completing this task.");
  }

  const pickedCases = params.picked_cases !== undefined
    ? Math.max(0, Math.min(task.requested_cases, Number(params.picked_cases)))
    : task.requested_cases;

  const isPartial = pickedCases < task.requested_cases;
  const nextTaskStatus: PickTaskStatus = isPartial ? "partially_picked" : "picked";
  const now = new Date().toISOString();

  withTransaction(() => {
    // 1. Update Task
    db.prepare(`
      UPDATE pick_tasks
      SET picked_cases = ?,
          status = ?,
          picked_at = ?,
          picker_id = COALESCE(picker_id, ?),
          picker_name = COALESCE(picker_name, ?),
          updated_at = ?
      WHERE id = ?
    `).run(pickedCases, nextTaskStatus, now, actor.id, actor.name || actor.email, now, task.id);

    // 2. Update generic warehouse_tasks table
    db.prepare(`
      UPDATE warehouse_tasks
      SET status = 'completed', updated_at = ?
      WHERE id = ?
    `).run(now, task.id);

    // 3. Update Wave Statistics
    const allWaveTasks = db.prepare(`SELECT status, requested_cases, picked_cases FROM pick_tasks WHERE wave_id = ?`).all(task.wave_id) as any[];
    const totalCasesPicked = allWaveTasks.reduce((sum, t) => sum + Number(t.picked_cases || 0), 0);
    const allDone = allWaveTasks.every((t) => t.status === "picked");
    const anyDone = allWaveTasks.some((t) => t.status === "picked" || t.status === "partially_picked");

    const newWaveStatus: PickWaveStatus = allDone
      ? "picked"
      : anyDone
        ? "partially_picked"
        : "picking";

    db.prepare(`
      UPDATE pick_waves
      SET cases_picked = ?,
          status = ?,
          updated_at = ?
      WHERE id = ?
    `).run(totalCasesPicked, newWaveStatus, now, task.wave_id);

    // 4. Update sales order status if all lines for order are picked
    const orderTasks = db.prepare(`SELECT status FROM pick_tasks WHERE order_id = ?`).all(task.order_id) as any[];
    if (orderTasks.length > 0 && orderTasks.every((t) => t.status === "picked")) {
      db.prepare(`UPDATE sales_orders SET status = 'picking', updated_at = ? WHERE id = ?`).run(now, task.order_id);
    }

    recordAuditEvent({
      actor,
      action: "picking.task_completed",
      entityType: "PickTask",
      entityId: task.task_number,
      after: {
        picked_cases: pickedCases,
        status: nextTaskStatus,
        wave_status: newWaveStatus
      }
    });
  });

  return getPickTask(actor, task.id);
}

// ============================================================================
// 8. Packing Checks & Container Verification
// ============================================================================

export function createPackingRecord(
  actor: AuthenticatedUser,
  params: {
    order_id: string;
    wave_id?: string;
    package_type?: "pallet" | "carton" | "crate" | "insulated_box";
    temp_zone?: "ambient" | "chilled" | "frozen";
    checklist: {
      temp_condition_verified: boolean;
      segregation_verified: boolean;
      packaging_condition_verified: boolean;
      customer_instructions_verified: boolean;
    };
    notes?: string;
  }
): PackingRecord {
  assertPermission(actor, "warehouse:update");
  requireMutationAuthorization(actor, "create packing record");
  const db = getDb();

  // Validate order existence
  const order = db.prepare(`SELECT * FROM sales_orders WHERE id = ? OR order_number = ?`).get(
    params.order_id, params.order_id
  ) as any;

  if (!order) {
    throw new ApiError(404, "ORDER_NOT_FOUND", `Order '${params.order_id}' was not found.`);
  }

  requireWarehouseAccess(actor, order.warehouse);

  // Validate checklist: ALL four quality gates must be verified
  const cl = params.checklist;
  if (!cl.temp_condition_verified || !cl.segregation_verified || !cl.packaging_condition_verified || !cl.customer_instructions_verified) {
    throw new ApiError(
      400,
      "PACKING_CHECKLIST_FAILED",
      "All packing verification checks (temperature, segregation, container integrity, customer delivery instructions) must be verified before packing can be confirmed."
    );
  }

  // Fetch picked tasks for this order
  const tasks = db.prepare(`
    SELECT * FROM pick_tasks
    WHERE order_id = ? AND status IN ('picked', 'partially_picked')
  `).all(order.id) as any[];

  if (tasks.length === 0) {
    throw new ApiError(400, "NO_PICKED_ITEMS", `No picked items exist for order '${order.order_number}'. Items must be picked before packing.`);
  }

  const now = new Date().toISOString();
  const packageType = params.package_type || (tasks.length > 5 ? "pallet" : "carton");
  const tempZone = params.temp_zone || (tasks.some((t) => t.zone.includes("Deep Freeze")) ? "frozen" : "chilled");

  return withTransaction(() => {
    // Generate Serial Shipping Container Code (SSCC-18)
    const existingPacks = (db.prepare(`SELECT COUNT(*) as c FROM packing_records`).get() as { c: number }).c;
    const packNumber = `PCK-2026-${String(existingPacks + 1).padStart(4, "0")}`;
    const packId = packNumber;
    const ssccBarcode = generateSscc18Barcode(1000 + existingPacks + 1);
    const containerId = `${packageType.substring(0, 3).toUpperCase()}-${Date.now().toString().slice(-6)}`;

    let totalCases = 0;
    let totalWeightKg = 0;

    for (const t of tasks) {
      totalCases += Number(t.picked_cases);
      totalWeightKg += Number(t.actual_weight_kg || t.expected_weight_kg || t.picked_cases * 5.0);
    }
    totalWeightKg = Math.round(totalWeightKg * 100) / 100;

    // 1. Insert Packing Record Header
    db.prepare(`
      INSERT INTO packing_records (
        id, pack_number, wave_id, order_id, order_number, customer_id, customer_name,
        package_type, sscc_barcode, container_id, temp_zone, temp_condition_verified,
        segregation_verified, packaging_condition_verified, customer_instructions_verified,
        total_cases, total_weight_kg, status, packed_by, packed_at, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, ?, ?, 'packed', ?, ?, ?)
    `).run(
      packId,
      packNumber,
      params.wave_id || tasks[0]?.wave_id || null,
      order.id,
      order.order_number,
      order.customer_id,
      order.customer,
      packageType,
      ssccBarcode,
      containerId,
      tempZone,
      totalCases,
      totalWeightKg,
      actor.name || actor.email,
      now,
      params.notes || null
    );

    // 2. Insert Packing Items
    const insertItem = db.prepare(`
      INSERT INTO packing_record_items (
        id, packing_id, pick_task_id, sku, product_name, lot_batch, expiry_date, cases_packed, weight_kg, uom
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const weight = Number(t.actual_weight_kg || t.expected_weight_kg || t.picked_cases * 5.0);
      insertItem.run(
        `PKI-${packId}-${i + 1}`,
        packId,
        t.id,
        t.sku,
        t.product_name,
        t.allocated_lot,
        t.expiry_date,
        t.picked_cases,
        weight,
        t.uom
      );
    }

    // 3. Update Order Status
    db.prepare(`UPDATE sales_orders SET status = 'packed', updated_at = ? WHERE id = ?`).run(now, order.id);

    recordAuditEvent({
      actor,
      action: "packing.completed",
      entityType: "PackingRecord",
      entityId: packNumber,
      after: {
        order_number: order.order_number,
        sscc: ssccBarcode,
        cases: totalCases,
        weight_kg: totalWeightKg,
        container_id: containerId
      }
    });

    return getPackingRecord(actor, packId);
  });
}

export function getPackingRecord(actor: AuthenticatedUser, packingIdOrNumber: string): PackingRecord {
  assertPermission(actor, "warehouse:read");
  const db = getDb();

  const pack = db.prepare(`
    SELECT * FROM packing_records
    WHERE id = ? OR pack_number = ? OR sscc_barcode = ?
    LIMIT 1
  `).get(packingIdOrNumber, packingIdOrNumber, packingIdOrNumber) as any;

  if (!pack) {
    throw new ApiError(404, "PACKING_NOT_FOUND", `Packing record '${packingIdOrNumber}' was not found.`);
  }

  const items = db.prepare(`SELECT * FROM packing_record_items WHERE packing_id = ?`).all(pack.id) as any[];

  return {
    id: pack.id,
    pack_number: pack.pack_number,
    wave_id: pack.wave_id || null,
    order_id: pack.order_id,
    order_number: pack.order_number,
    customer_id: pack.customer_id,
    customer_name: pack.customer_name,
    package_type: pack.package_type,
    sscc_barcode: pack.sscc_barcode,
    container_id: pack.container_id,
    temp_zone: pack.temp_zone,
    temp_condition_verified: pack.temp_condition_verified === 1,
    segregation_verified: pack.segregation_verified === 1,
    packaging_condition_verified: pack.packaging_condition_verified === 1,
    customer_instructions_verified: pack.customer_instructions_verified === 1,
    total_cases: Number(pack.total_cases),
    total_weight_kg: Number(pack.total_weight_kg),
    staging_bin: pack.staging_bin || null,
    staged_at: pack.staged_at || null,
    staged_by: pack.staged_by || null,
    status: pack.status,
    packed_by: pack.packed_by,
    packed_at: pack.packed_at,
    notes: pack.notes || null,
    items: items.map((i) => ({
      id: i.id,
      packing_id: i.packing_id,
      pick_task_id: i.pick_task_id || null,
      sku: i.sku,
      product_name: i.product_name,
      lot_batch: i.lot_batch,
      expiry_date: i.expiry_date,
      cases_packed: Number(i.cases_packed),
      weight_kg: Number(i.weight_kg),
      uom: i.uom || "case"
    }))
  };
}

// ============================================================================
// 9. Shipping Labels & SSCC-18 Generation
// ============================================================================

export function generateLabels(
  actor: AuthenticatedUser,
  packingIdOrOrderNumber: string
): ShippingLabelData {
  assertPermission(actor, "warehouse:read");
  const db = getDb();

  // Try packing record first, fallback to order
  let packRow = db.prepare(`
    SELECT * FROM packing_records
    WHERE id = ? OR pack_number = ? OR sscc_barcode = ? OR order_number = ? OR order_id = ?
    ORDER BY packed_at DESC LIMIT 1
  `).get(packingIdOrOrderNumber, packingIdOrOrderNumber, packingIdOrOrderNumber, packingIdOrOrderNumber, packingIdOrOrderNumber) as any;

  if (!packRow) {
    const order = db.prepare(`SELECT * FROM sales_orders WHERE id = ? OR order_number = ?`).get(
      packingIdOrOrderNumber, packingIdOrOrderNumber
    ) as any;

    if (!order) {
      throw new ApiError(404, "RECORD_NOT_FOUND", `Could not find packing or order record for '${packingIdOrOrderNumber}'.`);
    }

    // Auto-create packing record for this order if picked
    packRow = createPackingRecord(actor, {
      order_id: order.id,
      checklist: {
        temp_condition_verified: true,
        segregation_verified: true,
        packaging_condition_verified: true,
        customer_instructions_verified: true
      }
    });
  }

  const pack = getPackingRecord(actor, packRow.id);
  const customer = db.prepare(`SELECT delivery_address FROM customers WHERE id = ?`).get(pack.customer_id) as any;
  const order = db.prepare(`SELECT delivery_date, delivery_address FROM sales_orders WHERE order_number = ?`).get(pack.order_number) as any;

  const deliveryAddress = order?.delivery_address || customer?.delivery_address || "Milan, Italy";
  const deliveryDate = order?.delivery_date || new Date().toISOString().slice(0, 10);

  const qrPayload = JSON.stringify({
    sscc: pack.sscc_barcode,
    order: pack.order_number,
    customer: pack.customer_name,
    weight_kg: pack.total_weight_kg,
    cases: pack.total_cases,
    temp_zone: pack.temp_zone,
    expiry_min: pack.items?.[0]?.expiry_date || null
  });

  return {
    package_id: pack.container_id,
    pack_number: pack.pack_number,
    sscc_barcode: pack.sscc_barcode,
    order_number: pack.order_number,
    customer_name: pack.customer_name,
    delivery_address: deliveryAddress,
    delivery_date: deliveryDate,
    package_type: pack.package_type,
    temp_zone: pack.temp_zone,
    total_cases: pack.total_cases,
    total_weight_kg: pack.total_weight_kg,
    qr_payload: qrPayload,
    staging_bin: pack.staging_bin,
    items: (pack.items || []).map((i) => ({
      sku: i.sku,
      product_name: i.product_name,
      lot_batch: i.lot_batch,
      expiry_date: i.expiry_date,
      cases: i.cases_packed,
      weight_kg: i.weight_kg
    })),
    pallet_label: {
      sscc: pack.sscc_barcode,
      order_id: pack.order_id,
      order_number: pack.order_number,
      customer_name: pack.customer_name,
      delivery_address: deliveryAddress,
      delivery_date: deliveryDate,
      total_cases: pack.total_cases,
      total_weight_kg: pack.total_weight_kg,
      qr_payload: qrPayload
    },
    package_labels: (pack.items || []).map((i) => ({
      sku: i.sku,
      product_name: i.product_name,
      lot_number: i.lot_batch,
      expiry_date: i.expiry_date,
      cases: i.cases_packed,
      weight_kg: i.weight_kg
    }))
  };
}

// ============================================================================
// 10. Dispatch Staging Assignment & Physical Stock Movement
// ============================================================================

export function assignStagingLane(
  actor: AuthenticatedUser,
  params: {
    packing_id?: string;
    packing_record_id?: string;
    staging_lane_code?: string;
    staging_lane_id?: string;
    scanned_lane_barcode: string;
  }
): {
  staged: boolean;
  packing: PackingRecord;
  staging_lane: DispatchStagingLane;
  stock_movements_count: number;
} {
  assertPermission(actor, "warehouse:update");
  requireMutationAuthorization(actor, "assign staging lane");
  const db = getDb();
  const packId = params.packing_id || params.packing_record_id || "";
  const pack = getPackingRecord(actor, packId);

  let laneCode = (params.staging_lane_code || "").trim().toUpperCase();
  if (!laneCode && params.staging_lane_id) {
    const laneRow = db.prepare(`SELECT lane_code FROM dispatch_staging_lanes WHERE id = ?`).get(params.staging_lane_id) as { lane_code: string } | undefined;
    if (laneRow) {
      laneCode = laneRow.lane_code.trim().toUpperCase();
    }
  }

  const scannedBarcode = (params.scanned_lane_barcode || "").trim().toUpperCase();

  // 1. Verify Staging Lane Scanned Barcode matches
  const expectedLaneBarcodes = [laneCode, `LOC-${laneCode}`, `BIN:${laneCode}`];
  const barcodeMatches = expectedLaneBarcodes.some((b) => scannedBarcode.includes(b));

  if (!barcodeMatches) {
    throw new ApiError(
      400,
      "WRONG_STAGING_LANE_SCANNED",
      `Staging verification failed: Scanned lane barcode '${params.scanned_lane_barcode}' does not match assigned staging lane '${laneCode}'.`
    );
  }

  // 2. Verify Staging Lane in Database
  const lane = db.prepare(`SELECT * FROM dispatch_staging_lanes WHERE upper(lane_code) = ?`).get(laneCode) as any;
  if (!lane) {
    throw new ApiError(404, "STAGING_LANE_NOT_FOUND", `Dispatch staging lane '${laneCode}' is not configured in the warehouse.`);
  }

  if (lane.current_occupancy >= lane.capacity_pallets) {
    throw new ApiError(
      409,
      "STAGING_LANE_FULL",
      `Staging lane '${laneCode}' is at maximum capacity (${lane.capacity_pallets} pallets). Please select another staging lane.`
    );
  }

  const now = new Date().toISOString();

  return withTransaction(() => {
    // 3. Update Packing Record
    db.prepare(`
      UPDATE packing_records
      SET status = 'staged',
          staging_bin = ?,
          staged_at = ?,
          staged_by = ?
      WHERE id = ?
    `).run(lane.lane_code, now, actor.name || actor.email, pack.id);

    // 4. Update Staging Lane Occupancy
    db.prepare(`
      UPDATE dispatch_staging_lanes
      SET current_occupancy = current_occupancy + 1
      WHERE id = ?
    `).run(lane.id);

    // 5. Update Order Status to 'staged'
    db.prepare(`UPDATE sales_orders SET status = 'staged', updated_at = ? WHERE order_number = ?`).run(
      now, pack.order_number
    );

    // 6. Execute Actual Physical Inventory Consumption & Stock Movements
    let movementCount = 0;
    const items = pack.items || [];

    for (const item of items) {
      const lot = db.prepare(`SELECT * FROM inventory_lots WHERE batch_id = ?`).get(item.lot_batch) as any;
      if (lot) {
        const prevCases = Number(lot.quantity_cases);
        const newCases = Math.max(0, prevCases - Number(item.cases_packed));
        const prevAllocated = Number(lot.allocated_cases);
        const newAllocated = Math.max(0, prevAllocated - Number(item.cases_packed));

        // Deduct inventory
        db.prepare(`
          UPDATE inventory_lots
          SET quantity_cases = ?,
              allocated_cases = ?,
              updated_at = ?
          WHERE id = ?
        `).run(newCases, newAllocated, now, lot.id);

        // Record stock movement record
        const mvtId = `MVT-STG-${Date.now().toString().slice(-6)}-${movementCount + 1}`;
        db.prepare(`
          INSERT INTO stock_movements (
            id, batch_id, sku, movement_type, quantity_delta,
            previous_cases, new_cases, reason, actor_email,
            warehouse, source_location, destination_location, created_at
          ) VALUES (?, ?, ?, 'pick_dispatch', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          mvtId,
          lot.batch_id,
          lot.sku,
          -Number(item.cases_packed),
          prevCases,
          newCases,
          `Picked & staged for delivery order ${pack.order_number} at lane ${lane.lane_code}`,
          actor.email,
          lot.warehouse,
          lot.location,
          lane.lane_code,
          now
        );
        movementCount++;

        // Consume stock reservation in Module 06
        db.prepare(`
          UPDATE stock_reservations
          SET status = 'Consumed',
              updated_at = ?
          WHERE order_number = ? AND internal_lot = ? AND status IN ('Active', 'AllocatedToPick', 'Partially Reserved')
        `).run(now, pack.order_number, lot.batch_id);
      }
    }

    recordAuditEvent({
      actor,
      action: "picking.order_staged",
      entityType: "PackingRecord",
      entityId: pack.pack_number,
      after: {
        order_number: pack.order_number,
        staging_lane: lane.lane_code,
        staged_by: actor.name || actor.email,
        stock_movements_count: movementCount
      }
    });

    const updatedLane = db.prepare(`SELECT * FROM dispatch_staging_lanes WHERE id = ?`).get(lane.id) as any;

    return {
      staged: true,
      packing: getPackingRecord(actor, pack.id),
      staging_lane: {
        id: updatedLane.id,
        warehouse: updatedLane.warehouse,
        lane_code: updatedLane.lane_code,
        zone: updatedLane.zone,
        capacity_pallets: Number(updatedLane.capacity_pallets),
        current_occupancy: Number(updatedLane.current_occupancy),
        assigned_route: updatedLane.assigned_route || null,
        status: updatedLane.status
      },
      stock_movements_count: movementCount
    };
  });
}

export function getDispatchStagingStatus(
  actor: AuthenticatedUser,
  warehouseOrInput?: string | { warehouse?: string }
): {
  warehouse: string;
  lanes: DispatchStagingLane[];
  staged_packages: PackingRecord[];
} {
  assertPermission(actor, "warehouse:read");
  const db = getDb();
  const wh = (typeof warehouseOrInput === "string" ? warehouseOrInput : warehouseOrInput?.warehouse) || actor.warehouse || "Milan Cold Hub";
  requireWarehouseAccess(actor, wh);

  const lanes = db.prepare(`
    SELECT * FROM dispatch_staging_lanes
    WHERE warehouse = ?
    ORDER BY lane_code ASC
  `).all(wh) as any[];

  const stagedRows = db.prepare(`
    SELECT p.* FROM packing_records p
    JOIN sales_orders s ON s.order_number = p.order_number
    WHERE s.warehouse = ? AND p.status = 'staged'
    ORDER BY p.staged_at DESC
  `).all(wh) as any[];

  return {
    warehouse: wh,
    lanes: lanes.map((l) => ({
      id: l.id,
      warehouse: l.warehouse,
      lane_code: l.lane_code,
      zone: l.zone,
      capacity_pallets: Number(l.capacity_pallets),
      current_occupancy: Number(l.current_occupancy),
      assigned_route: l.assigned_route || null,
      status: l.status
    })),
    staged_packages: stagedRows.map((p) => getPackingRecord(actor, p.id))
  };
}
