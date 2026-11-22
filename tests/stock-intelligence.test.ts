import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextRequest } from "next/server";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ascentra-stock-intel-test-"));
const tmpDbPath = path.join(tmpDir, "test-stock-intel.sqlite");
process.env.SQLITE_DB_PATH = tmpDbPath;
process.env.SEED_DEMO_DATA = "true";

import { getDb } from "@/server/db/connection";
import { signAccessToken } from "@/server/security/crypto";
import { GET as getDashboard } from "@/app/api/v1/inventory/dashboard/route";
import { GET as getLotDetail } from "@/app/api/v1/inventory/lots/[id]/route";
import { POST as postFefo } from "@/app/api/v1/inventory/fefo/route";
import {
  GET as getReservations,
  POST as postReservation
} from "@/app/api/v1/inventory/reservations/route";
import { PATCH as patchReservation } from "@/app/api/v1/inventory/reservations/[id]/route";
import {
  GET as getShelfLife,
  POST as postShelfLifeRule
} from "@/app/api/v1/inventory/shelf-life/route";
import {
  GET as getCycleCounts,
  POST as postCycleCount
} from "@/app/api/v1/inventory/cycle-counts/route";
import {
  POST as postSubmitCycleCount,
  PATCH as patchCycleCount
} from "@/app/api/v1/inventory/cycle-counts/[id]/route";
import {
  GET as getAdjustments,
  POST as postAdjustment
} from "@/app/api/v1/inventory/adjustments/route";
import { PATCH as patchAdjustment } from "@/app/api/v1/inventory/adjustments/[id]/route";
import { GET as getMovements } from "@/app/api/v1/inventory/movements/route";
import { POST as postOrder } from "@/app/api/v1/orders/route";

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
  return new NextRequest(`http://127.0.0.1:3001${urlPath}`, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
}

function addDaysIso(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

describe("Module 06 — Stock Intelligence (Inventory Control, FEFO, Reservations & Cycle Counting)", () => {
  let superAdminToken: string;
  let whManagerToken: string;
  let whStaffToken: string;
  let pickerToken: string;
  let qaManagerToken: string;
  let romeWhManagerToken: string;

  before(() => {
    const db = getDb();

    db.prepare(
      `INSERT OR IGNORE INTO users (id, email, name, password_hash, role, store_id, warehouse)
       VALUES (?, ?, ?, 'hash', ?, NULL, ?)`
    ).run(
      "USR-WH-STAFF",
      "paolo.staff@ascentra.it",
      "Paolo Warehouse Staff",
      "warehouse_staff",
      "Milan Cold Hub"
    );

    db.prepare(
      `INSERT OR IGNORE INTO users (id, email, name, password_hash, role, store_id, warehouse)
       VALUES (?, ?, ?, 'hash', ?, NULL, ?)`
    ).run(
      "USR-ROME-WH-MGR",
      "marco.rome@ascentra.it",
      "Marco Rome Manager",
      "warehouse_manager",
      "Rome Cold Hub"
    );

    superAdminToken = signAccessToken({
      sub: "USR-ADMIN",
      email: "elena.rossi@ascentra.it",
      name: "Elena Rossi",
      role: "super_admin",
      warehouse: "Milan Cold Hub"
    });

    whManagerToken = signAccessToken({
      sub: "USR-WH-MGR",
      email: "marco.bellini@ascentra.it",
      name: "Marco Bellini",
      role: "warehouse_manager",
      warehouse: "Milan Cold Hub"
    });

    whStaffToken = signAccessToken({
      sub: "USR-WH-STAFF",
      email: "paolo.staff@ascentra.it",
      name: "Paolo Warehouse Staff",
      role: "warehouse_staff",
      warehouse: "Milan Cold Hub"
    });

    pickerToken = signAccessToken({
      sub: "USR-PICK",
      email: "luca.bianchi@ascentra.it",
      name: "Luca Bianchi",
      role: "picker",
      warehouse: "Milan Cold Hub"
    });

    qaManagerToken = signAccessToken({
      sub: "USR-QA",
      email: "giulia.romano@ascentra.it",
      name: "Giulia Romano",
      role: "qa_manager",
      warehouse: "Milan Cold Hub"
    });

    romeWhManagerToken = signAccessToken({
      sub: "USR-ROME-WH-MGR",
      email: "marco.rome@ascentra.it",
      name: "Marco Rome Manager",
      role: "warehouse_manager",
      warehouse: "Rome Cold Hub"
    });

    // Ensure SKU-TEST-SALMON exists in products with catch weight, shelf life, and cost
    db.prepare(
      `INSERT OR REPLACE INTO products
       (id, sku, name, category, origin, uom, temp_zone, shelf_life_days, min_shelf_life_days,
        unit_price_cents, cost_price_cents, unit_weight_kg, case_weight_kg, catch_weight,
        base_uom, allergens_json, temp_min_c, temp_max_c, supplier_name, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
    ).run(
      "PRD-TEST-SALMON",
      "SKU-TEST-SALMON",
      "Norwegian Fjord Salmon Fillet",
      "Chilled Seafood",
      "Norway",
      "CASE",
      "Chilled (0 to 4 C)",
      14,
      4,
      9800,
      6200,
      5.0,
      5.0,
      1,
      "CASE",
      JSON.stringify(["Fish"]),
      0.0,
      4.0,
      "Nordic Seafood AS"
    );

    // Seed diverse lots across statuses to verify multi-level visibility, FEFO, and blocked exclusions
    const insertLot = db.prepare(
      `INSERT OR REPLACE INTO inventory_lots
       (id, batch_id, sku, product_name, category, supplier, supplier_lot,
        warehouse, zone, location, received_date, expiry_date,
        quantity_cases, received_cases, allocated_cases, damaged_cases, in_transit_cases,
        unit_weight_kg, catch_weight_kg, unit_cost_cents, temp_c, quality_status, origin_country)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    // Lot 1: Earliest expiry (+6 days), released, 30 cases physical, 0 reserved
    insertLot.run(
      "LOT-SI-EARLY",
      "LOT-SI-EARLY-01",
      "SKU-TEST-SALMON",
      "Norwegian Fjord Salmon Fillet",
      "Chilled Seafood",
      "Nordic Seafood AS",
      "SUP-BATCH-E1",
      "Milan Cold Hub",
      "CHILL-A",
      "CHILL-A-01-01",
      addDaysIso(-2),
      addDaysIso(6),
      30,
      30,
      0,
      0,
      0,
      5.0,
      151.2,
      6200,
      1.8,
      "released",
      "NO"
    );

    // Lot 2: Later expiry (+12 days), released, 50 cases physical, 0 reserved
    insertLot.run(
      "LOT-SI-LATER",
      "LOT-SI-LATER-02",
      "SKU-TEST-SALMON",
      "Norwegian Fjord Salmon Fillet",
      "Chilled Seafood",
      "Nordic Seafood AS",
      "SUP-BATCH-L2",
      "Milan Cold Hub",
      "CHILL-A",
      "CHILL-A-01-02",
      addDaysIso(-1),
      addDaysIso(12),
      50,
      50,
      0,
      0,
      0,
      5.0,
      250.5,
      6200,
      1.9,
      "released",
      "NO"
    );

    // Lot 3: Earlier expiry (+4 days) BUT on_hold -> must be excluded from FEFO & have 0 available
    insertLot.run(
      "LOT-SI-HELD",
      "LOT-SI-HELD-03",
      "SKU-TEST-SALMON",
      "Norwegian Fjord Salmon Fillet",
      "Chilled Seafood",
      "Nordic Seafood AS",
      "SUP-BATCH-H3",
      "Milan Cold Hub",
      "HOLD-Q",
      "HOLD-Q-01-01",
      addDaysIso(-3),
      addDaysIso(4),
      25,
      25,
      0,
      0,
      0,
      5.0,
      125.0,
      6200,
      2.1,
      "on_hold",
      "NO"
    );

    // Lot 4: Quarantined lot -> 0 available, 20 quarantined
    insertLot.run(
      "LOT-SI-QUAR",
      "LOT-SI-QUAR-04",
      "SKU-TEST-SALMON",
      "Norwegian Fjord Salmon Fillet",
      "Chilled Seafood",
      "Nordic Seafood AS",
      "SUP-BATCH-Q4",
      "Milan Cold Hub",
      "HOLD-Q",
      "HOLD-Q-01-01",
      addDaysIso(-3),
      addDaysIso(9),
      20,
      20,
      0,
      0,
      0,
      5.0,
      100.0,
      6200,
      2.2,
      "quarantine",
      "NO"
    );

    // Lot 5: Rejected lot -> 0 available, 15 rejected
    insertLot.run(
      "LOT-SI-REJ",
      "LOT-SI-REJ-05",
      "SKU-TEST-SALMON",
      "Norwegian Fjord Salmon Fillet",
      "Chilled Seafood",
      "Nordic Seafood AS",
      "SUP-BATCH-R5",
      "Milan Cold Hub",
      "HOLD-Q",
      "HOLD-Q-01-02",
      addDaysIso(-4),
      addDaysIso(8),
      15,
      15,
      0,
      0,
      0,
      5.0,
      75.0,
      6200,
      2.0,
      "rejected",
      "NO"
    );

    // Lot 6: Expired lot (expiry -2 days) -> even though quality_status = 'released', must be Expired & 0 available
    insertLot.run(
      "LOT-SI-EXP",
      "LOT-SI-EXP-06",
      "SKU-TEST-SALMON",
      "Norwegian Fjord Salmon Fillet",
      "Chilled Seafood",
      "Nordic Seafood AS",
      "SUP-BATCH-X6",
      "Milan Cold Hub",
      "CHILL-A",
      "CHILL-A-01-01",
      addDaysIso(-16),
      addDaysIso(-2),
      12,
      12,
      0,
      0,
      0,
      5.0,
      60.0,
      6200,
      2.0,
      "released",
      "NO"
    );

    // Lot 7: Partially damaged + in-transit lot (40 physical: 5 reserved, 6 damaged, 4 in_transit => 25 available)
    insertLot.run(
      "LOT-SI-MIXED",
      "LOT-SI-MIXED-07",
      "SKU-TEST-SALMON",
      "Norwegian Fjord Salmon Fillet",
      "Chilled Seafood",
      "Nordic Seafood AS",
      "SUP-BATCH-M7",
      "Milan Cold Hub",
      "CHILL-B",
      "CHILL-B-01-01",
      addDaysIso(-1),
      addDaysIso(13),
      40,
      40,
      5,
      6,
      4,
      5.0,
      202.0,
      6200,
      2.0,
      "released",
      "NO"
    );
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore Windows temp file lock on cleanup
    }
  });

  it("1. Multi-Level Stock Visibility & Reconciliation: physical stock is never automatically available and reconciles across all 8 statuses", async () => {
    const res = await getDashboard(
      makeReq("/api/v1/inventory/dashboard?sku=SKU-TEST-SALMON", {
        token: superAdminToken
      })
    );
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.ok(Array.isArray(data.lots), "Expected lots array");
    const lotsByInternal = new Map<string, any>(
      data.lots.map((l: any) => [l.internal_lot, l])
    );

    // Verify Held lot has 0 available cases and 25 blocked/held cases
    const heldLot = lotsByInternal.get("LOT-SI-HELD-03");
    assert.ok(heldLot);
    assert.equal(heldLot.physical_cases, 25);
    assert.equal(heldLot.available_cases, 0);
    assert.equal(heldLot.held_cases, 25);
    assert.equal(heldLot.blocked_cases, 25);
    assert.equal(heldLot.primary_stock_status, "Held");

    // Verify Quarantined lot has 0 available cases and 20 quarantined cases
    const quarLot = lotsByInternal.get("LOT-SI-QUAR-04");
    assert.ok(quarLot);
    assert.equal(quarLot.physical_cases, 20);
    assert.equal(quarLot.available_cases, 0);
    assert.equal(quarLot.quarantined_cases, 20);
    assert.equal(quarLot.primary_stock_status, "Quarantined");

    // Verify Rejected lot has 0 available cases and 15 rejected cases
    const rejLot = lotsByInternal.get("LOT-SI-REJ-05");
    assert.ok(rejLot);
    assert.equal(rejLot.physical_cases, 15);
    assert.equal(rejLot.available_cases, 0);
    assert.equal(rejLot.rejected_cases, 15);
    assert.equal(rejLot.primary_stock_status, "Rejected");

    // Verify Expired lot has 0 available cases even though quality_status = 'released'
    const expLot = lotsByInternal.get("LOT-SI-EXP-06");
    assert.ok(expLot);
    assert.equal(expLot.physical_cases, 12);
    assert.equal(expLot.available_cases, 0);
    assert.equal(expLot.expired_cases, 12);
    assert.equal(expLot.blocked_cases, 12);
    assert.equal(expLot.primary_stock_status, "Expired");

    // Verify Mixed lot reconciles physical = available + reserved + blocked + in_transit
    const mixedLot = lotsByInternal.get("LOT-SI-MIXED-07");
    assert.ok(mixedLot);
    assert.equal(mixedLot.physical_cases, 40);
    assert.equal(mixedLot.reserved_cases, 5);
    assert.equal(mixedLot.damaged_cases, 6);
    assert.equal(mixedLot.blocked_cases, 6);
    assert.equal(mixedLot.in_transit_cases, 4);
    assert.equal(mixedLot.available_cases, 25);
    assert.equal(
      mixedLot.available_cases +
        mixedLot.reserved_cases +
        mixedLot.blocked_cases +
        mixedLot.in_transit_cases,
      mixedLot.physical_cases
    );
    assert.equal(mixedLot.stock_value_cents, 40 * 6200);
    assert.equal(mixedLot.available_value_cents, 25 * 6200);

    // Verify summary reconciliation across all lots for SKU-TEST-SALMON
    const s = data.summary;
    assert.equal(
      s.available_cases + s.reserved_cases + s.blocked_cases + s.in_transit_cases,
      s.physical_cases,
      "Summary physical cases must strictly equal available + reserved + blocked + in_transit"
    );

    // Verify hierarchy breakdown (organization -> warehouse -> zone -> bin) exists
    assert.ok(data.by_warehouse.length >= 1);
    assert.ok(data.by_zone.length >= 2);
    assert.ok(data.by_bin.length >= 3);
    assert.ok(data.by_sku.length === 1);

    // Verify lot detail endpoint
    const lotDetailRes = await getLotDetail(
      makeReq("/api/v1/inventory/lots/LOT-SI-EARLY-01", { token: superAdminToken }),
      { params: Promise.resolve({ id: "LOT-SI-EARLY-01" }) }
    );
    assert.equal(lotDetailRes.status, 200);
    const lotDetail = await lotDetailRes.json();
    assert.equal(lotDetail.lot.internal_lot, "LOT-SI-EARLY-01");
    assert.equal(lotDetail.lot.catch_weight_kg, 151.2);
  });

  it("2. FEFO Inventory Allocation & Partial Lot Allocation: allocates earliest eligible expiry first, skips held/quarantined/expired, and logs reasons", async () => {
    // Request 45 cases of SKU-TEST-SALMON with delivery tomorrow (+1 day).
    // LOT-SI-EARLY-01 has 30 available (+6 days expiry -> 5 days remaining at delivery >= 4 days required)
    // LOT-SI-LATER-02 has 50 available (+12 days expiry -> 11 days remaining at delivery >= 4 days required)
    // Should allocate 30 from LOT-SI-EARLY-01 and 15 from LOT-SI-LATER-02!
    const res = await postFefo(
      makeReq("/api/v1/inventory/fefo", {
        token: whManagerToken,
        body: {
          sku: "SKU-TEST-SALMON",
          requested_cases: 45,
          warehouse: "Milan Cold Hub",
          delivery_date: addDaysIso(1),
          order_number: "SO-FEFO-TEST-01",
          persist_log: true
        }
      })
    );
    assert.equal(res.status, 200);
    const plan = await res.json();

    assert.equal(plan.status, "allocated");
    assert.equal(plan.allocated_cases, 45);
    assert.equal(plan.shortfall_cases, 0);
    assert.equal(plan.allocations.length, 2, "Expected partial allocation across 2 FEFO lots");

    assert.equal(plan.allocations[0].internal_lot, "LOT-SI-EARLY-01");
    assert.equal(plan.allocations[0].allocated_cases, 30);

    assert.equal(plan.allocations[1].internal_lot, "LOT-SI-LATER-02");
    assert.equal(plan.allocations[1].allocated_cases, 15);

    // Check candidate evaluations include held, quarantined, rejected, and expired lots with explicit exclusion reasons
    const evalByLot = new Map<string, any>(
      plan.candidates.map((c: any) => [c.internal_lot, c])
    );

    const heldEval = evalByLot.get("LOT-SI-HELD-03");
    assert.ok(heldEval);
    assert.equal(heldEval.eligible, false);
    assert.ok(
      heldEval.exclusion_reasons.some((r: string) => r.includes("on_hold")),
      "Held lot must have explicit exclusion reason"
    );

    const expEval = evalByLot.get("LOT-SI-EXP-06");
    assert.ok(expEval);
    assert.equal(expEval.eligible, false);
    assert.ok(
      expEval.exclusion_reasons.some((r: string) => r.toLowerCase().includes("expired")),
      "Expired lot must have explicit exclusion reason"
    );
  });

  it("3. Minimum Remaining Shelf Life against Expected Delivery Date & Customer-Specific Rules", async () => {
    // Create a customer-specific rule requiring 9 days remaining shelf life at delivery for customer CUS-LUXURY-HOTEL
    const ruleRes = await postShelfLifeRule(
      makeReq("/api/v1/inventory/shelf-life", {
        token: qaManagerToken,
        body: {
          rule_scope: "customer_product",
          sku: "SKU-TEST-SALMON",
          customer_id: "CUS-LUXURY-HOTEL",
          customer_name: "Grand Hotel Duomo Milano",
          min_remaining_days: 9,
          notes: "Grand Hotel requires at least 9 days shelf life upon delivery"
        }
      })
    );
    assert.equal(ruleRes.status, 201);
    const createdRule = await ruleRes.json();
    assert.equal(createdRule.min_remaining_days, 9);

    // Now evaluate FEFO for CUS-LUXURY-HOTEL with delivery in +2 days:
    // - LOT-SI-EARLY-01 expires in +6 days -> at delivery (+2 days) it only has 4 days remaining (< 9 days required!) -> MUST BE EXCLUDED!
    // - LOT-SI-LATER-02 expires in +12 days -> at delivery (+2 days) it has 10 days remaining (>= 9 days required!) -> MUST BE SELECTED!
    const fefoRes = await postFefo(
      makeReq("/api/v1/inventory/fefo", {
        token: whManagerToken,
        body: {
          sku: "SKU-TEST-SALMON",
          requested_cases: 20,
          warehouse: "Milan Cold Hub",
          customer_id: "CUS-LUXURY-HOTEL",
          customer_name: "Grand Hotel Duomo Milano",
          delivery_date: addDaysIso(2)
        }
      })
    );
    assert.equal(fefoRes.status, 200);
    const plan = await fefoRes.json();

    assert.equal(plan.min_shelf_life_days_required, 9);
    assert.equal(plan.allocations.length, 1);
    assert.equal(
      plan.allocations[0].internal_lot,
      "LOT-SI-LATER-02",
      "Must skip LOT-SI-EARLY-01 because it only has 4 days left at delivery date vs 9 required"
    );

    const earlyEval = plan.candidates.find(
      (c: any) => c.internal_lot === "LOT-SI-EARLY-01"
    );
    assert.ok(earlyEval);
    assert.equal(earlyEval.eligible, false);
    assert.equal(earlyEval.days_remaining_at_delivery, 4);
    assert.ok(
      earlyEval.exclusion_reasons.some((r: string) =>
        r.includes("Remaining shelf life at delivery")
      )
    );

    // Also verify shelf-life endpoint returns rules and evaluation
    const slGetRes = await getShelfLife(
      makeReq(
        `/api/v1/inventory/shelf-life?sku=SKU-TEST-SALMON&customer_id=CUS-LUXURY-HOTEL&delivery_date=${addDaysIso(2)}`,
        { token: whManagerToken }
      )
    );
    assert.equal(slGetRes.status, 200);
    const slData = await slGetRes.json();
    assert.ok(slData.rules.some((r: any) => r.customer_id === "CUS-LUXURY-HOTEL"));
  });

  it("4. Blocked Stock Exclusion: returns clear 409 INSUFFICIENT_ELIGIBLE_STOCK when no eligible stock satisfies shelf-life or availability", async () => {
    // Request with order_min_remaining_days = 25 days (no lot has 25 days remaining)
    const failRes = await postReservation(
      makeReq("/api/v1/inventory/reservations", {
        token: whManagerToken,
        body: {
          sku: "SKU-TEST-SALMON",
          requested_cases: 10,
          warehouse: "Milan Cold Hub",
          order_min_remaining_days: 25,
          order_number: "SO-IMPOSSIBLE-SL"
        }
      })
    );
    assert.equal(failRes.status, 409);
    const failBody = await failRes.json();
    assert.equal(failBody.error.code, "INSUFFICIENT_ELIGIBLE_STOCK");
    assert.ok(
      failBody.error.message.includes("eligible") ||
        failBody.error.message.includes("FEFO allocation failed"),
      "Expected clear availability error message"
    );
  });

  it("5 & 6. Reservation Lifecycle, Partial Multi-Lot Reservation, Overselling Prevention & Picking Conversion", async () => {
    // Create a reservation for 45 cases of SKU-TEST-SALMON across FEFO lots (allow_partial = false)
    // LOT-SI-EARLY-01 has 30 available, LOT-SI-LATER-02 has 50 available
    const createRes = await postReservation(
      makeReq("/api/v1/inventory/reservations", {
        token: whManagerToken,
        body: {
          order_id: "ORD-SI-100",
          order_number: "SO-SI-100",
          customer_id: "CUS-STD-01",
          customer_name: "Trattoria Milanese",
          sku: "SKU-TEST-SALMON",
          requested_cases: 45,
          warehouse: "Milan Cold Hub",
          delivery_date: addDaysIso(1),
          ttl_hours: 12
        }
      })
    );
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.reservations.length, 2, "Should create 2 lot-linked reservations");
    assert.equal(created.reservations[0].internal_lot, "LOT-SI-EARLY-01");
    assert.equal(created.reservations[0].reserved_cases, 30);
    assert.equal(created.reservations[1].internal_lot, "LOT-SI-LATER-02");
    assert.equal(created.reservations[1].reserved_cases, 15);

    // Check LOT-SI-EARLY-01 now has 0 available cases and 30 reserved cases
    const lot1Res = await getLotDetail(
      makeReq("/api/v1/inventory/lots/LOT-SI-EARLY-01", { token: whManagerToken }),
      { params: Promise.resolve({ id: "LOT-SI-EARLY-01" }) }
    );
    const lot1Data = await lot1Res.json();
    assert.equal(lot1Data.lot.physical_cases, 30);
    assert.equal(lot1Data.lot.reserved_cases, 30);
    assert.equal(lot1Data.lot.available_cases, 0);

    // Attempt to double-reserve LOT-SI-EARLY-01 directly -> must fail with 409 INSUFFICIENT_ELIGIBLE_STOCK
    const doubleReserveRes = await postReservation(
      makeReq("/api/v1/inventory/reservations", {
        token: whManagerToken,
        body: {
          order_number: "SO-DOUBLE-ATTEMPT",
          sku: "SKU-TEST-SALMON",
          internal_lot: "LOT-SI-EARLY-01",
          requested_cases: 5,
          warehouse: "Milan Cold Hub"
        }
      })
    );
    assert.equal(doubleReserveRes.status, 409);
    const doubleErr = await doubleReserveRes.json();
    assert.equal(doubleErr.error.code, "INSUFFICIENT_ELIGIBLE_STOCK");

    // Convert first reservation (30 cases on LOT-SI-EARLY-01) into a picking allocation task
    const resId1 = created.reservations[0].id;
    const convertRes = await patchReservation(
      makeReq(`/api/v1/inventory/reservations/${resId1}`, {
        method: "PATCH",
        token: whManagerToken,
        body: {
          action: "convert_to_pick",
          assignee: "Luca Bianchi",
          reason: "Release order SO-SI-100 to floor picking"
        }
      }),
      { params: Promise.resolve({ id: resId1 }) }
    );
    assert.equal(convertRes.status, 200);
    const converted = await convertRes.json();
    assert.equal(converted.status, "AllocatedToPick");
    assert.ok(converted.pick_task_id, "Must link to a generated warehouse_tasks pick task");

    // Release the second reservation (15 cases on LOT-SI-LATER-02) and verify available stock is restored
    const resId2 = created.reservations[1].id;
    const releaseRes = await patchReservation(
      makeReq(`/api/v1/inventory/reservations/${resId2}`, {
        method: "PATCH",
        token: whManagerToken,
        body: {
          action: "release",
          reason: "Customer reduced order quantity by 15 cases"
        }
      }),
      { params: Promise.resolve({ id: resId2 }) }
    );
    assert.equal(releaseRes.status, 200);
    const released = await releaseRes.json();
    assert.equal(released.status, "Released");

    // Verify LOT-SI-LATER-02 available cases returned to 50
    const lot2Res = await getLotDetail(
      makeReq("/api/v1/inventory/lots/LOT-SI-LATER-02", { token: whManagerToken }),
      { params: Promise.resolve({ id: "LOT-SI-LATER-02" }) }
    );
    const lot2Data = await lot2Res.json();
    assert.equal(lot2Data.lot.available_cases, 50);
    assert.equal(lot2Data.lot.reserved_cases, 0);

    // List reservations and verify audit events exist
    const listRes = await getReservations(
      makeReq("/api/v1/inventory/reservations?order_number=SO-SI-100", {
        token: whManagerToken
      })
    );
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.equal(listData.reservations.length, 2);
    assert.ok(listData.events.length >= 4);
  });

  it("7. Cycle Counting Workflow: blind count masks expected quantities for non-managers, submitting count does NOT auto-adjust stock, supports recount & manager approval reconciliation", async () => {
    // 1. Warehouse manager schedules a blind cycle count on LOT-SI-LATER-02 (expected = 50 cases)
    const createCcRes = await postCycleCount(
      makeReq("/api/v1/inventory/cycle-counts", {
        token: whManagerToken,
        body: {
          count_type: "blind",
          warehouse: "Milan Cold Hub",
          zone: "CHILL-A",
          bin_code: "CHILL-A-01-02",
          sku: "SKU-TEST-SALMON",
          internal_lot: "LOT-SI-LATER-02",
          blind_count: true,
          assigned_to: "USR-PICK",
          assigned_to_name: "Luca Bianchi",
          notes: "Weekly high-value seafood blind audit"
        }
      })
    );
    assert.equal(createCcRes.status, 201);
    const ccCreated = await createCcRes.json();
    const ccId = ccCreated.id;

    // Manager can see expected_cases = 50
    assert.equal(ccCreated.expected_cases, 50);

    // 2. Picker (non-manager) fetches cycle counts -> expected_cases MUST be masked (`null`) while Pending in blind count!
    const pickerListRes = await getCycleCounts(
      makeReq("/api/v1/inventory/cycle-counts?warehouse=Milan Cold Hub", {
        token: pickerToken
      })
    );
    assert.equal(pickerListRes.status, 200);
    const pickerList = await pickerListRes.json();
    const blindTaskForPicker = pickerList.counts.find((c: any) => c.id === ccId);
    assert.ok(blindTaskForPicker);
    assert.equal(
      blindTaskForPicker.expected_cases,
      null,
      "Blind count must mask expected_cases from non-manager before submission"
    );

    // 3. Verify wrong barcode scan is rejected
    const badScanRes = await postSubmitCycleCount(
      makeReq(`/api/v1/inventory/cycle-counts/${ccId}`, {
        token: pickerToken,
        body: {
          counted_cases: 48,
          barcode_scanned: "WRONG-BARCODE-999",
          discrepancy_reason: "2 cases missing from back pallet"
        }
      }),
      { params: Promise.resolve({ id: ccId }) }
    );
    assert.equal(badScanRes.status, 400);
    const badScanErr = await badScanRes.json();
    assert.equal(badScanErr.error.code, "BARCODE_MISMATCH");

    // 4. Picker submits count with valid barcode (LOT-SI-LATER-02) and 48 cases (discrepancy of -2 cases)
    const submitRes = await postSubmitCycleCount(
      makeReq(`/api/v1/inventory/cycle-counts/${ccId}`, {
        token: pickerToken,
        body: {
          counted_cases: 48,
          counted_weight_kg: 240.5,
          barcode_scanned: "LOT-SI-LATER-02",
          discrepancy_reason: "2 cases missing from lower tier"
        }
      }),
      { params: Promise.resolve({ id: ccId }) }
    );
    assert.equal(submitRes.status, 200);
    const submitted = await submitRes.json();
    assert.equal(submitted.status, "In Review");
    assert.equal(submitted.variance_cases, -2);
    assert.equal(submitted.barcode_verified, true);

    // CRITICAL CHECK: Submitting a count MUST NOT modify physical stock before manager approval!
    const lotBeforeApprovalRes = await getLotDetail(
      makeReq("/api/v1/inventory/lots/LOT-SI-LATER-02", { token: whManagerToken }),
      { params: Promise.resolve({ id: "LOT-SI-LATER-02" }) }
    );
    const lotBeforeApproval = await lotBeforeApprovalRes.json();
    assert.equal(
      lotBeforeApproval.lot.physical_cases,
      50,
      "Submitting a cycle count must NEVER modify stock before approval"
    );

    // 5. Manager requests a recount first
    const recountRes = await patchCycleCount(
      makeReq(`/api/v1/inventory/cycle-counts/${ccId}`, {
        method: "PATCH",
        token: whManagerToken,
        body: {
          action: "request_recount",
          notes: "Please recount rear pallet row B"
        }
      }),
      { params: Promise.resolve({ id: ccId }) }
    );
    assert.equal(recountRes.status, 200);
    const recountState = await recountRes.json();
    assert.equal(recountState.count.status, "Recount Requested");
    assert.equal(recountState.count.recount_iteration, 1);

    // 6. Picker submits recount confirming 48 cases
    const resubmitRes = await postSubmitCycleCount(
      makeReq(`/api/v1/inventory/cycle-counts/${ccId}`, {
        token: pickerToken,
        body: {
          counted_cases: 48,
          counted_weight_kg: 240.5,
          barcode_scanned: "LOT-SI-LATER-02",
          discrepancy_reason: "Confirmed 48 cases on second physical count"
        }
      }),
      { params: Promise.resolve({ id: ccId }) }
    );
    assert.equal(resubmitRes.status, 200);

    // 7. Picker tries to approve their own cycle count -> must be blocked with 403!
    const unauthorizedApproveRes = await patchCycleCount(
      makeReq(`/api/v1/inventory/cycle-counts/${ccId}`, {
        method: "PATCH",
        token: pickerToken,
        body: {
          action: "approve",
          notes: "Self-approve attempt"
        }
      }),
      { params: Promise.resolve({ id: ccId }) }
    );
    assert.equal(unauthorizedApproveRes.status, 403);

    // 8. Warehouse manager approves the cycle count -> stock reconciles from 50 to 48 and creates adjustment + stock movement
    const approveRes = await patchCycleCount(
      makeReq(`/api/v1/inventory/cycle-counts/${ccId}`, {
        method: "PATCH",
        token: whManagerToken,
        body: {
          action: "approve",
          notes: "Verified recount variance of -2 cases; approving reconciliation"
        }
      }),
      { params: Promise.resolve({ id: ccId }) }
    );
    assert.equal(approveRes.status, 200);
    const approvedData = await approveRes.json();
    assert.equal(approvedData.count.status, "Approved");
    assert.ok(approvedData.adjustment, "Must create reconciled stock adjustment record");
    assert.equal(approvedData.adjustment.status, "Applied");
    assert.equal(approvedData.adjustment.difference_cases, -2);
    assert.ok(approvedData.adjustment.movement_id, "Must generate immutable stock_movements record");

    // Verify LOT-SI-LATER-02 physical stock is now reconciled to 48 cases
    const lotAfterApprovalRes = await getLotDetail(
      makeReq("/api/v1/inventory/lots/LOT-SI-LATER-02", { token: whManagerToken }),
      { params: Promise.resolve({ id: "LOT-SI-LATER-02" }) }
    );
    const lotAfterApproval = await lotAfterApprovalRes.json();
    assert.equal(lotAfterApproval.lot.physical_cases, 48);
    assert.equal(lotAfterApproval.lot.available_cases, 48);
  });

  it("8 & 9. Approval-Required Stock Adjustments & Duplicate Movement Prevention (Idempotency)", async () => {
    // 1. Warehouse staff requests a damaged stock write-off of 6 cases on LOT-SI-LATER-02 (48 -> 42).
    // Since warehouse_staff does not have `inventory.approve_adjustment` AND delta >= 5 cases,
    // it MUST enter `Pending Approval` and NOT change stock yet.
    const reqAdjRes = await postAdjustment(
      makeReq("/api/v1/inventory/adjustments", {
        token: whStaffToken,
        body: {
          internal_lot: "LOT-SI-LATER-02",
          adjustment_type: "damaged",
          actual_cases: 42,
          actual_weight_kg: 210.0,
          reason_code: "FORKLIFT_PUNCTURE",
          reason_notes: "6 cases punctured during aisle transfer",
          evidence_ref: "PHOTO-DMG-2026-88",
          idempotency_key: "IDEMP-ADJ-DAMAGED-01"
        }
      })
    );
    assert.equal(reqAdjRes.status, 201);
    const pendingAdj = await reqAdjRes.json();
    assert.equal(pendingAdj.status, "Pending Approval");
    assert.equal(pendingAdj.requires_approval, true);
    assert.equal(pendingAdj.difference_cases, -6);
    assert.equal(pendingAdj.movement_id, null);

    // Verify LOT-SI-LATER-02 still has 48 physical cases prior to manager approval
    const lotStill48Res = await getLotDetail(
      makeReq("/api/v1/inventory/lots/LOT-SI-LATER-02", { token: whManagerToken }),
      { params: Promise.resolve({ id: "LOT-SI-LATER-02" }) }
    );
    const lotStill48 = await lotStill48Res.json();
    assert.equal(
      lotStill48.lot.physical_cases,
      48,
      "Pending adjustment must not alter physical stock before manager approval"
    );

    // 2. Duplicate adjustment submission with same idempotency_key -> must be rejected with 409 DUPLICATE_ADJUSTMENT
    const dupAdjRes = await postAdjustment(
      makeReq("/api/v1/inventory/adjustments", {
        token: whStaffToken,
        body: {
          internal_lot: "LOT-SI-LATER-02",
          adjustment_type: "damaged",
          actual_cases: 42,
          reason_code: "FORKLIFT_PUNCTURE",
          idempotency_key: "IDEMP-ADJ-DAMAGED-01"
        }
      })
    );
    assert.equal(dupAdjRes.status, 409);
    const dupErr = await dupAdjRes.json();
    assert.equal(dupErr.error.code, "DUPLICATE_ADJUSTMENT");

    // 3. Warehouse staff attempts to approve the adjustment -> must be rejected with 403 Forbidden
    const staffApproveAttempt = await patchAdjustment(
      makeReq(`/api/v1/inventory/adjustments/${pendingAdj.id}`, {
        method: "PATCH",
        token: whStaffToken,
        body: {
          decision: "approve",
          approval_notes: "Trying to approve my own adjustment"
        }
      }),
      { params: Promise.resolve({ id: pendingAdj.id }) }
    );
    assert.equal(staffApproveAttempt.status, 403);

    // 4. Warehouse manager approves the adjustment -> updates stock (48 -> 42) and records immutable stock movement
    const mgrApproveRes = await patchAdjustment(
      makeReq(`/api/v1/inventory/adjustments/${pendingAdj.id}`, {
        method: "PATCH",
        token: whManagerToken,
        body: {
          decision: "approve",
          approval_notes: "Inspected damaged cases at dock; approved write-off"
        }
      }),
      { params: Promise.resolve({ id: pendingAdj.id }) }
    );
    assert.equal(mgrApproveRes.status, 200);
    const appliedAdj = await mgrApproveRes.json();
    assert.equal(appliedAdj.status, "Applied");
    assert.ok(appliedAdj.movement_id, "Approved adjustment must record a stock movement");
    assert.equal(appliedAdj.approved_by_name, "Marco Bellini");

    // Re-approving an already applied adjustment must fail with 409
    const doubleApproveRes = await patchAdjustment(
      makeReq(`/api/v1/inventory/adjustments/${pendingAdj.id}`, {
        method: "PATCH",
        token: whManagerToken,
        body: {
          decision: "approve"
        }
      }),
      { params: Promise.resolve({ id: pendingAdj.id }) }
    );
    assert.equal(doubleApproveRes.status, 409);

    // Verify LOT-SI-LATER-02 physical stock is now 42 cases
    const lotNow42Res = await getLotDetail(
      makeReq("/api/v1/inventory/lots/LOT-SI-LATER-02", { token: whManagerToken }),
      { params: Promise.resolve({ id: "LOT-SI-LATER-02" }) }
    );
    const lotNow42 = await lotNow42Res.json();
    assert.equal(lotNow42.lot.physical_cases, 42);

    // Verify immutable stock movement ledger contains the adjustment movement
    const movRes = await getMovements(
      makeReq("/api/v1/inventory/movements?lot_number=LOT-SI-LATER-02", {
        token: whManagerToken
      })
    );
    assert.equal(movRes.status, 200);
    const movData = await movRes.json();
    assert.ok(
      movData.movements.some((m: any) => m.id === appliedAdj.movement_id),
      "Stock movement ledger must include the approved adjustment movement"
    );
  });

  it("10. Cross-Warehouse RBAC Restrictions & Orders Integration", async () => {
    // Rome warehouse manager attempts to create an adjustment on a Milan Cold Hub lot -> must be blocked with 403!
    const crossWhRes = await postAdjustment(
      makeReq("/api/v1/inventory/adjustments", {
        token: romeWhManagerToken,
        body: {
          internal_lot: "LOT-SI-LATER-02",
          adjustment_type: "missing_shrinkage",
          actual_cases: 40,
          reason_code: "SHRINKAGE_CHECK"
        }
      })
    );
    assert.equal(crossWhRes.status, 403);

    // Create a Sales Order via `/api/v1/orders` for SKU-TEST-SALMON (10 cases) and verify it automatically records a linked StockReservation
    const orderRes = await postOrder(
      makeReq("/api/v1/orders", {
        token: superAdminToken,
        idempotencyKey: "IDEMP-SO-SI-INTEGRATION-01",
        body: {
          customerName: "Ristorante Brera",
          storeId: "STR-MILAN-01",
          warehouse: "Milan Cold Hub",
          deliveryDate: addDaysIso(2),
          lines: [
            {
              sku: "SKU-TEST-SALMON",
              QuantityCases: undefined,
              quantityCases: 10
            }
          ]
        }
      })
    );
    assert.equal(orderRes.status, 201);
    const createdOrder = await orderRes.json();
    assert.ok(createdOrder.order_number);

    // Verify a stock_reservations record was automatically created for this order
    const orderResList = await getReservations(
      makeReq(`/api/v1/inventory/reservations?order_number=${createdOrder.order_number}`, {
        token: superAdminToken
      })
    );
    assert.equal(orderResList.status, 200);
    const orderReservations = await orderResList.json();
    assert.ok(
      orderReservations.reservations.length >= 1,
      "Order creation must automatically record a lot-linked StockReservation"
    );
    assert.equal(orderReservations.reservations[0].reserved_cases, 10);
  });
});
