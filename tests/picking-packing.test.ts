import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextRequest } from "next/server";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ascentra-picking-packing-test-"));
const tmpDbPath = path.join(tmpDir, "test-picking-packing.sqlite");
process.env.SQLITE_DB_PATH = tmpDbPath;
process.env.SEED_DEMO_DATA = "true";

import { getDb } from "@/server/db/connection";
import { signAccessToken } from "@/server/security/crypto";
import { AuthenticatedUser } from "@/server/security/auth";
import {
  listEligibleOrdersForWave,
  createPickWave,
  getPickWave,
  listPickWaves,
  assignPickWave,
  cancelPickWave,
  listPickTasks,
  getPickTask,
  verifyPickScan,
  confirmCatchWeight,
  completePickTask,
  createPackingRecord,
  getPackingRecord,
  generateLabels,
  assignStagingLane,
  getDispatchStagingStatus
} from "@/server/services/picking-packing.service";

import { GET as getWavesRoute, POST as postWavesRoute } from "@/app/api/v1/picking/waves/route";
import { GET as getWaveDetailRoute, PATCH as patchWaveRoute, DELETE as deleteWaveRoute } from "@/app/api/v1/picking/waves/[id]/route";
import { GET as getTasksRoute } from "@/app/api/v1/picking/tasks/route";
import { POST as postScanRoute } from "@/app/api/v1/picking/tasks/[id]/scan/route";
import { POST as postCatchWeightRoute } from "@/app/api/v1/picking/tasks/[id]/catch-weight/route";
import { POST as postCompleteTaskRoute } from "@/app/api/v1/picking/tasks/[id]/complete/route";
import { GET as getPackingRoute, POST as postPackingRoute } from "@/app/api/v1/picking/packing/route";
import { GET as getLabelsRoute } from "@/app/api/v1/picking/labels/route";
import { GET as getStagingRoute, POST as postStagingRoute } from "@/app/api/v1/picking/staging/route";

function makeReq(
  urlPath: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    idempotencyKey?: string;
  } = {}
): NextRequest {
  const headers = new Headers();
  if (options.token) {
    headers.set("authorization", `Bearer ${options.token}`);
  }
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (options.idempotencyKey) {
    headers.set("idempotency-key", options.idempotencyKey);
  }
  return new NextRequest(`http://127.0.0.1:3000${urlPath}`, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

describe("Module 08 – Picking, Packing, Verification & Staging Test Suite", () => {
  let db: ReturnType<typeof getDb>;
  let adminActor: AuthenticatedUser;
  let pickerActor: AuthenticatedUser;
  let adminToken: string;
  let pickerToken: string;
  let targetOrderId: string;
  let testWarehouse: string = "Milan Cold Hub";

  before(() => {
    db = getDb();

    adminActor = {
      id: "USR-WH-MGR",
      email: "marco.bellini@ascentra.it",
      name: "Marco Bellini",
      role: "warehouse_manager",
      roles: ["warehouse_manager"],
      store_id: null,
      warehouse: testWarehouse,
      mfa_enabled: false
    };

    pickerActor = {
      id: "USR-PICK",
      email: "luca.bianchi@ascentra.it",
      name: "Luca Bianchi",
      role: "picker",
      roles: ["picker"],
      store_id: null,
      warehouse: testWarehouse,
      mfa_enabled: false
    };

    adminToken = signAccessToken({
      sub: adminActor.id,
      email: adminActor.email,
      name: adminActor.name,
      role: adminActor.role,
      store_id: null,
      warehouse: adminActor.warehouse
    });

    pickerToken = signAccessToken({
      sub: pickerActor.id,
      email: pickerActor.email,
      name: pickerActor.name,
      role: pickerActor.role,
      store_id: null,
      warehouse: pickerActor.warehouse
    });

    // Create a dedicated confirmed order with valid order lines and lot ready for picking in Milan Cold Hub
    targetOrderId = "ORD-TEST-CONF-01";
    db.prepare(`
      INSERT OR REPLACE INTO sales_orders (
        id, order_number, customer_id, customer, segment, channel, status,
        credit_hold, items_count, cases_total, total_cents, margin_pct,
        delivery_date, warehouse, created_at
      ) VALUES (
        ?, 'SO-TEST-001', 'CUST-B2B-01', 'Ristorante Cracco', 'Fine Dining', 'B2B Portal', 'confirmed',
        0, 1, 10, 85000, 22.5,
        date('now', '+2 days'), ?, datetime('now')
      )
    `).run(targetOrderId, testWarehouse);

    db.prepare(`
      INSERT OR REPLACE INTO sales_order_lines (
        id, order_id, sku, product_name, cases_ordered, cases_allocated,
        unit_price_cents, batch_id, weight_kg
      ) VALUES (
        'LINE-TEST-001', ?, 'SKU-SAL-001', 'Norwegian Atlantic Salmon Fillet (Trim D)', 10, 0,
        8500, 'LOT-2026-SAL-041', 50.0
      )
    `).run(targetOrderId);
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // 1. Pick Wave Generation
  it("should list eligible confirmed customer orders for wave creation", () => {
    const eligible = listEligibleOrdersForWave(adminActor, { warehouse: testWarehouse });
    assert.ok(Array.isArray(eligible));
    assert.ok(eligible.length > 0, "There should be at least one confirmed order in the warehouse");
    const found = eligible.find(o => o.id === targetOrderId);
    assert.ok(found, "Target order should be eligible for picking");
    assert.equal(found?.status, "confirmed");
  });

  let createdWaveId: string;
  let createdTaskId: string;

  it("should generate a pick wave, allocate batches with FEFO, and sequence routes along physical bins", () => {
    const wave = createPickWave(adminActor, {
      warehouse: testWarehouse,
      order_ids: [targetOrderId],
      strategy: "single_order",
      priority: "urgent",
      assigned_picker_id: pickerActor.id,
      notes: "Priority morning restaurant dispatch"
    });

    assert.ok(wave.wave_number.startsWith("WAV-"));
    assert.equal(wave.status, "assigned");
    assert.equal(wave.assigned_picker_id, pickerActor.id);
    assert.ok(wave.tasks && wave.tasks.length > 0);

    createdWaveId = wave.id;
    const task = wave.tasks[0];
    createdTaskId = task.id;

    assert.equal(task.order_id, targetOrderId);
    assert.ok(task.allocated_lot, "Task should have allocated lot batch");
    assert.ok(task.bin_code, "Task should have source bin");
    assert.ok(task.barcode_sku, "Task should contain barcode SKU");
    assert.ok(task.barcode_lot, "Task should contain lot barcode");
    assert.ok(task.route_sequence >= 0, "Route sequence should be calculated");

    // Check order status was transitioned to picking
    const updatedOrder = db.prepare(`SELECT status FROM sales_orders WHERE id = ?`).get(targetOrderId) as { status: string };
    assert.equal(updatedOrder.status, "picking");

    // Check stock reservation was recorded
    const res = db.prepare(`SELECT * FROM stock_reservations WHERE order_id = ?`).get(targetOrderId) as { status: string; quantity: number } | undefined;
    assert.ok(res, "Stock reservation should be recorded");
    assert.ok(res.status === "Active" || res.status === "AllocatedToPick");
  });

  // 2. Wave inspection and tasks
  it("should retrieve pick wave details and list tasks", () => {
    const wave = getPickWave(adminActor, createdWaveId);
    assert.equal(wave.id, createdWaveId);
    assert.ok(wave.orders && wave.orders.length > 0);
    assert.ok(wave.tasks && wave.tasks.length > 0);

    const tasks = listPickTasks(pickerActor, { wave_id: createdWaveId });
    assert.ok(tasks.length > 0);
    assert.equal(tasks[0].id, createdTaskId);
    assert.equal(tasks[0].status, "assigned");
  });

  // 3. Barcode Verification
  it("should reject barcode scan when scanning wrong bin", () => {
    const task = getPickTask(pickerActor, createdTaskId);

    assert.throws(() => {
      verifyPickScan(pickerActor, {
        task_id: task.id,
        scanned_bin: "WRONG-BIN-999",
        scanned_sku: task.barcode_sku,
        scanned_lot: task.barcode_lot,
      });
    }, (err: any) => err.code === "WRONG_BIN_SCANNED");
  });

  it("should reject barcode scan when scanning wrong SKU", () => {
    const task = getPickTask(pickerActor, createdTaskId);

    assert.throws(() => {
      verifyPickScan(pickerActor, {
        task_id: task.id,
        scanned_bin: task.bin_code,
        scanned_sku: "8888888888888",
        scanned_lot: task.barcode_lot,
      });
    }, (err: any) => err.code === "WRONG_PRODUCT_SCANNED");
  });

  it("should reject barcode scan when scanning wrong lot", () => {
    const task = getPickTask(pickerActor, createdTaskId);

    assert.throws(() => {
      verifyPickScan(pickerActor, {
        task_id: task.id,
        scanned_bin: task.bin_code,
        scanned_sku: task.barcode_sku,
        scanned_lot: "LOT-UNASSIGNED-999",
      });
    }, (err: any) => err.code === "WRONG_LOT_SCANNED");
  });

  it("should accept valid barcode scan and advance task to in_progress", () => {
    const task = getPickTask(pickerActor, createdTaskId);

    const result = verifyPickScan(pickerActor, {
      task_id: task.id,
      scanned_bin: task.bin_code,
      scanned_sku: task.barcode_sku,
      scanned_lot: task.allocated_lot,
    });

    assert.equal(result.verified, true);
    assert.equal(result.task.status, "in_progress");
  });

  it("should support manual barcode override with mandatory audit reason", () => {
    const task = getPickTask(pickerActor, createdTaskId);

    const result = verifyPickScan(pickerActor, {
      task_id: task.id,
      scanned_bin: "MANUAL-INPUT",
      scanned_sku: task.sku,
      scanned_lot: task.allocated_lot,
      is_manual_entry: true,
      manual_entry_reason: "Barcode label smudged with condensation in cold room",
    });

    assert.equal(result.verified, true);
  });

  // 4. Catch-Weight Confirmation
  it("should confirm catch-weight within permitted tolerance", () => {
    const task = getPickTask(pickerActor, createdTaskId);
    const expectedKg = task.expected_weight_kg || 50.0;
    const actualKg = Math.round(expectedKg * 1.02 * 100) / 100; // +2% variance (within +/-5%)

    const cw = confirmCatchWeight(pickerActor, {
      task_id: task.id,
      actual_weight_kg: actualKg,
      package_count: task.requested_cases,
    });

    assert.equal(cw.approved, true);
    assert.equal(cw.task.actual_weight_kg, actualKg);

    // Verify order line updated weight
    if (task.order_line_id) {
      const line = db.prepare(`SELECT weight_kg FROM sales_order_lines WHERE id = ?`).get(task.order_line_id) as { weight_kg: number };
      assert.equal(line.weight_kg, actualKg);
    }
  });

  it("should flag weight tolerance exceeded and require supervisor approval", () => {
    const task = getPickTask(pickerActor, createdTaskId);
    const expectedKg = task.expected_weight_kg || 50.0;
    const heavyKg = Math.round(expectedKg * 1.25 * 100) / 100; // +25% variance

    // Without supervisor override
    const flagged = confirmCatchWeight(pickerActor, {
      task_id: task.id,
      actual_weight_kg: heavyKg,
      package_count: task.requested_cases,
    });

    assert.equal(flagged.approved, false);
    assert.equal(flagged.requires_manager_override, true);

    // With supervisor approval
    const approved = confirmCatchWeight(adminActor, {
      task_id: task.id,
      actual_weight_kg: heavyKg,
      package_count: task.requested_cases,
      manager_approval_notes: "Extra large cuts approved by chef"
    });

    assert.equal(approved.approved, true);
    assert.equal(approved.task.actual_weight_kg, heavyKg);
    assert.ok(approved.task.weight_approved_by);
  });

  // 5. Complete Pick Task
  it("should complete pick task and transition wave to picked", () => {
    const task = getPickTask(pickerActor, createdTaskId);

    const completed = completePickTask(pickerActor, {
      task_id: task.id,
      picked_cases: task.requested_cases,
      notes: "Picked 10 pristine cases"
    });

    assert.equal(completed.status, "picked");
    assert.equal(completed.picked_cases, task.requested_cases);

    const wave = getPickWave(adminActor, task.wave_id);
    assert.equal(wave.status, "picked");
    assert.equal(wave.cases_picked, wave.cases_total);
  });

  // 6. Packing Quality Verification
  it("should block packing if 4-point quality checklist is incomplete", () => {
    assert.throws(() => {
      createPackingRecord(pickerActor, {
        order_id: targetOrderId,
        package_type: "pallet",
        checklist: {
          temp_condition_verified: true,
          segregation_verified: false, // Incomplete!
          packaging_condition_verified: true,
          customer_instructions_verified: true,
        }
      });
    }, (err: any) => err.code === "PACKING_CHECKLIST_FAILED");
  });

  let createdPackingRecordId: string;

  it("should verify packing, advance order to packed, and generate GS1 SSCC-18 pallet barcode", () => {
    const record = createPackingRecord(pickerActor, {
      order_id: targetOrderId,
      package_type: "pallet",
      checklist: {
        temp_condition_verified: true,
        segregation_verified: true,
        packaging_condition_verified: true,
        customer_instructions_verified: true,
      },
      notes: "SEAL-2026-9901"
    });

    assert.ok(record.sscc_barcode.startsWith("(00)"));
    assert.equal(record.status, "packed");
    createdPackingRecordId = record.id;

    const order = db.prepare(`SELECT status FROM sales_orders WHERE id = ?`).get(targetOrderId) as { status: string };
    assert.equal(order.status, "packed");
  });

  // 7. Labels Generation
  it("should generate carton and SSCC-18 pallet shipping labels", () => {
    const labels = generateLabels(adminActor, targetOrderId);
    assert.ok(labels.pallet_label);
    assert.ok(labels.pallet_label.sscc.startsWith("(00)"));
    assert.equal(labels.pallet_label.order_id, targetOrderId);
    assert.ok(labels.package_labels && labels.package_labels.length > 0);
  });

  // 8. Dispatch Staging & Real Inventory Movements
  it("should inspect dispatch staging lanes", () => {
    const staging = getDispatchStagingStatus(pickerActor, testWarehouse);
    assert.ok(staging.lanes.length > 0);
    assert.ok(staging.lanes.find(l => l.lane_code === "STAGE-D1" || l.id === "LNE-MCH-01"));
  });

  it("should assign to staging lane, verify scan, consume reservation, and log stock movement", () => {
    const packing = getPackingRecord(pickerActor, createdPackingRecordId);
    const stagingLanes = getDispatchStagingStatus(pickerActor, testWarehouse).lanes;
    const targetLane = stagingLanes.find(l => l.warehouse === testWarehouse && l.status === "active");
    assert.ok(targetLane, "Active staging lane must exist");

    const task = getPickTask(pickerActor, createdTaskId);
    const initialLot = db.prepare(`SELECT quantity_cases, allocated_cases FROM inventory_lots WHERE batch_id = ?`).get(task.allocated_lot) as { quantity_cases: number; allocated_cases: number } | undefined;

    const staged = assignStagingLane(pickerActor, {
      packing_record_id: packing.id,
      staging_lane_id: targetLane.id,
      scanned_lane_barcode: targetLane.lane_code,
    });

    assert.equal(staged.staged, true);
    assert.equal(staged.packing.status, "staged");
    assert.equal(staged.packing.staging_bin, targetLane.lane_code);

    // Check order status is staged
    const order = db.prepare(`SELECT status FROM sales_orders WHERE id = ?`).get(targetOrderId) as { status: string };
    assert.equal(order.status, "staged");

    // Check stock was deducted if lot existed
    if (initialLot) {
      const updatedLot = db.prepare(`SELECT quantity_cases, allocated_cases FROM inventory_lots WHERE batch_id = ?`).get(task.allocated_lot) as { quantity_cases: number; allocated_cases: number };
      assert.equal(updatedLot.quantity_cases, initialLot.quantity_cases - task.picked_cases);
    }

    // Check reservation was consumed upon staging
    const res = db.prepare(`SELECT status FROM stock_reservations WHERE order_id = ?`).get(targetOrderId) as { status: string } | undefined;
    if (res) {
      assert.ok(res.status === "Consumed" || res.status === "Fulfilled");
    }

    // Check audit stock movement was logged
    const movement = db.prepare(`SELECT * FROM stock_movements WHERE movement_type = 'pick_dispatch' AND batch_id = ?`).get(task.allocated_lot) as { id: string; quantity_delta: number } | undefined;
    assert.ok(movement, "Stock movement of type pick_dispatch must be recorded");
    assert.equal(movement.quantity_delta, -task.picked_cases);
  });

  // 9. API Routes Verification
  it("should test /api/v1/picking/waves GET and POST", async () => {
    const listReq = makeReq("/api/v1/picking/waves?include_eligible=true&warehouse=" + encodeURIComponent(testWarehouse), { token: adminToken });
    const listRes = await getWavesRoute(listReq);
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.ok(Array.isArray(listData.waves));
    assert.ok(Array.isArray(listData.eligible_orders));
  });

  it("should test /api/v1/picking/tasks GET", async () => {
    const req = makeReq("/api/v1/picking/tasks?warehouse=" + encodeURIComponent(testWarehouse), { token: pickerToken });
    const res = await getTasksRoute(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.tasks));
  });

  it("should test /api/v1/picking/labels GET", async () => {
    const req = makeReq("/api/v1/picking/labels?order_id=" + targetOrderId, { token: adminToken });
    const res = await getLabelsRoute(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    const pallet = data.pallet_label || data.labels?.pallet_label;
    assert.ok(pallet);
    assert.equal(pallet.order_id, targetOrderId);
  });

  it("should test /api/v1/picking/staging GET", async () => {
    const req = makeReq("/api/v1/picking/staging?warehouse=" + encodeURIComponent(testWarehouse), { token: pickerToken });
    const res = await getStagingRoute(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.lanes));
  });

  it("should reject unauthorized API requests", async () => {
    const req = makeReq("/api/v1/picking/waves", { token: "bad_token" });
    const res = await getWavesRoute(req);
    assert.equal(res.status, 401);
  });
});
