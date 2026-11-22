import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextRequest } from "next/server";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ascentra-putaway-test-"));
const tmpDbPath = path.join(tmpDir, "test-putaway.sqlite");
process.env.SQLITE_DB_PATH = tmpDbPath;
process.env.SEED_DEMO_DATA = "true";

import { getDb } from "@/server/db/connection";
import { signAccessToken } from "@/server/security/crypto";
import { findFefoLotForSku, listLots } from "@/server/services/inventory-fefo.service";
import { POST as postInspection } from "@/app/api/v1/quality/inspections/route";
import { POST as postDecision } from "@/app/api/v1/quality/inspections/[id]/decision/route";
import { GET as getPutawayDashboard } from "@/app/api/v1/putaway/dashboard/route";
import { GET as getPutawayTasks, POST as postPutawayTask } from "@/app/api/v1/putaway/tasks/route";
import { GET as getPutawayTaskById, PATCH as patchPutawayTask } from "@/app/api/v1/putaway/tasks/[id]/route";
import { POST as postOverride } from "@/app/api/v1/putaway/tasks/[id]/override/route";
import { POST as postScan } from "@/app/api/v1/putaway/tasks/[id]/scan/route";
import { POST as postConfirm } from "@/app/api/v1/putaway/tasks/[id]/confirm/route";
import { GET as getBins } from "@/app/api/v1/putaway/bins/route";
import { GET as getRecommendations } from "@/app/api/v1/putaway/recommendations/route";
import { GET as getPutawayHistory } from "@/app/api/v1/putaway/history/route";

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

describe("Module 05 — Put-away (Storage Recommendation, Bin Assignment & Stock Placement)", () => {
  let qaManagerToken: string;
  let whManagerToken: string;
  let pickerToken: string;
  let romeWhToken: string;

  before(() => {
    const db = getDb();

    db.prepare(
      `INSERT OR IGNORE INTO users (id, email, name, password_hash, role, store_id, warehouse)
       VALUES (?, ?, ?, 'hash', ?, NULL, ?)`
    ).run("USR-ROME-WH", "marco.rome@ascentra.it", "Marco Rome Manager", "warehouse_manager", "Rome Cold Hub");

    qaManagerToken = signAccessToken({
      sub: "USR-QA",
      email: "giulia.romano@ascentra.it",
      name: "Giulia Romano",
      role: "qa",
      warehouse: "Milan Cold Hub"
    });

    whManagerToken = signAccessToken({
      sub: "USR-WH-MGR",
      email: "marco.bellini@ascentra.it",
      name: "Marco Bellini",
      role: "warehouse_manager",
      warehouse: "Milan Cold Hub"
    });

    pickerToken = signAccessToken({
      sub: "USR-PICK",
      email: "luca.bianchi@ascentra.it",
      name: "Luca Bianchi",
      role: "picker",
      warehouse: "Milan Cold Hub"
    });

    romeWhToken = signAccessToken({
      sub: "USR-ROME-WH",
      email: "marco.rome@ascentra.it",
      name: "Marco Rome Manager",
      role: "warehouse_manager",
      warehouse: "Rome Cold Hub"
    });

    // Seed frozen, ambient, and dairy product entries in `products` so we can test all 3 temperature regimes + allergen segregation
    db.prepare(
      `INSERT OR IGNORE INTO products (
        id, sku, name, category, origin, uom, temp_zone, shelf_life_days,
        unit_price_cents, supplier_name, case_weight_kg, catch_weight, allergens_json, temp_min_c, temp_max_c
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "PRD-FROZ-01",
      "SKU-FROZ-SHRIMP-01",
      "Deep-Frozen Argentine Red Shrimp 2kg",
      "Frozen",
      "Argentina",
      "CASE",
      "Frozen (-22 to -18 C)",
      365,
      9200,
      "Cooperativa Agricola Sud",
      8.0,
      1,
      JSON.stringify(["Crustaceans"]),
      -22,
      -18
    );

    db.prepare(
      `INSERT OR IGNORE INTO products (
        id, sku, name, category, origin, uom, temp_zone, shelf_life_days,
        unit_price_cents, supplier_name, case_weight_kg, catch_weight, allergens_json, temp_min_c, temp_max_c
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "PRD-AMB-01",
      "SKU-AMB-OLIVE-01",
      "Extra Virgin Olive Oil DOP 6x1L",
      "Ambient",
      "Italy",
      "CASE",
      "Ambient (10 to 22 C)",
      540,
      5400,
      "Cooperativa Agricola Sud",
      6.0,
      0,
      JSON.stringify([]),
      10,
      22
    );

    db.prepare(
      `INSERT OR IGNORE INTO products (
        id, sku, name, category, origin, uom, temp_zone, shelf_life_days,
        unit_price_cents, supplier_name, case_weight_kg, catch_weight, allergens_json, temp_min_c, temp_max_c
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "PRD-DAIRY-01",
      "SKU-DAIRY-BURRATA-01",
      "Artisanal Pugliese Burrata 12x250g",
      "Dairy",
      "Italy",
      "CASE",
      "Chilled (+2°C to +4°C)",
      14,
      3800,
      "Cooperativa Agricola Sud",
      3.0,
      0,
      JSON.stringify(["Milk"]),
      2,
      4
    );
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore Windows file lock on exit
    }
  });

  it("1. Auto-generates Put-away tasks when Quality Gate releases a batch & recommends temperature/category-compatible bins", async () => {
    // Create a receiving inspection in Module 04 for 40 cases of Atlantic Salmon (chilled 0..2 C, Fish allergen)
    const createInspRes = await postInspection(
      makeReq("/api/v1/quality/inspections", {
        token: qaManagerToken,
        idempotencyKey: "putaway-test-insp-1",
        body: {
          shipment_reference: "SHP-2026-PUT-01",
          asn_reference: "ASN-2026-PUT-01",
          purchase_order_id: "PO-2026-PUT-01",
          supplier_id: "SUP-001",
          supplier_name: "Cooperativa Agricola Sud",
          sku: "SKU-ATLANT-001",
          product_name: "Atlantic Salmon Fillet",
          supplier_batch: "SUP-BATCH-SAL-01",
          internal_lot: "LOT-2026-PUT-SAL-01",
          warehouse: "Milan Cold Hub",
          receiving_location: "RCV-STAGE-01",
          received_qty: 40,
          uom: "case",
          actual_weight_kg: 200,
          expected_weight_kg: 200,
          manufacture_date: "2026-11-01",
          expiry_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          temp_reading_c: 1.4
        }
      })
    );
    assert.equal(createInspRes.status, 201);
    const inspBody = await createInspRes.json();
    const inspectionId = inspBody.inspection.id as string;

    // QA releases 40 cases -> should automatically create a Put-away task in Module 05
    const decideRes = await postDecision(
      makeReq(`/api/v1/quality/inspections/${inspectionId}/decision`, {
        token: qaManagerToken,
        idempotencyKey: "putaway-test-decide-1",
        body: {
          decision: "released",
          accepted_qty: 40,
          reason: "All HACCP and temperature checks passed at 1.4°C; released for put-away."
        }
      }),
      { params: { id: inspectionId } }
    );
    assert.equal(decideRes.status, 200);

    // Verify Put-away task was automatically created for LOT-2026-PUT-SAL-01
    const tasksRes = await getPutawayTasks(
      makeReq("/api/v1/putaway/tasks?lot=LOT-2026-PUT-SAL-01", { token: whManagerToken })
    );
    assert.equal(tasksRes.status, 200);
    const tasksBody = await tasksRes.json();
    assert.equal(tasksBody.items.length, 1);

    const task = tasksBody.items[0];
    assert.equal(task.internal_lot, "LOT-2026-PUT-SAL-01");
    assert.equal(task.total_eligible_qty, 40);
    assert.equal(task.remaining_qty, 40);
    assert.equal(task.status, "Ready for Put-away");
    // Chilled Seafood (0..2°C) with Fish allergen must be recommended to CHILL-A1-01 or CHILL-A1-02 (Z-MIL-SEAFOOD)
    assert.ok(
      task.recommended_bin_code === "CHILL-A1-01" || task.recommended_bin_code === "CHILL-A1-02",
      `Expected CHILL-A1-01 or CHILL-A1-02, got ${task.recommended_bin_code}`
    );
    assert.equal(task.recommended_zone_code, "Z-MIL-SEAFOOD");

    // Verify recommendation engine across Frozen, Ambient, and Dairy products
    const frozRecRes = await getRecommendations(
      makeReq("/api/v1/putaway/recommendations?warehouse=Milan%20Cold%20Hub&sku=SKU-FROZ-SHRIMP-01&qty=25", {
        token: whManagerToken
      })
    );
    assert.equal(frozRecRes.status, 200);
    const frozRec = await frozRecRes.json();
    const topFrozen = frozRec.recommendations.find((r: { eligible: boolean }) => r.eligible);
    assert.ok(topFrozen, "Frozen shrimp should have an eligible frozen bin");
    assert.ok(topFrozen.bin.code.startsWith("FROZ-F1-"), `Expected FROZ-F1-*, got ${topFrozen.bin.code}`);

    const ambRecRes = await getRecommendations(
      makeReq("/api/v1/putaway/recommendations?warehouse=Milan%20Cold%20Hub&sku=SKU-AMB-OLIVE-01&qty=30", {
        token: whManagerToken
      })
    );
    assert.equal(ambRecRes.status, 200);
    const ambRec = await ambRecRes.json();
    const topAmbient = ambRec.recommendations.find((r: { eligible: boolean }) => r.eligible);
    assert.ok(topAmbient, "Ambient olive oil should have an eligible ambient bin");
    assert.ok(topAmbient.bin.code.startsWith("AMB-D1-"), `Expected AMB-D1-*, got ${topAmbient.bin.code}`);

    const dairyRecRes = await getRecommendations(
      makeReq("/api/v1/putaway/recommendations?warehouse=Milan%20Cold%20Hub&sku=SKU-DAIRY-BURRATA-01&qty=20", {
        token: whManagerToken
      })
    );
    assert.equal(dairyRecRes.status, 200);
    const dairyRec = await dairyRecRes.json();
    const topDairy = dairyRec.recommendations.find((r: { eligible: boolean }) => r.eligible);
    assert.ok(topDairy, "Dairy burrata should have an eligible dairy chilled bin");
    assert.ok(topDairy.bin.code.startsWith("CHILL-B1-"), `Expected CHILL-B1-*, got ${topDairy.bin.code}`);
  });

  it("2. Rejects temperature-incompatible, allergen-conflicting, full, blocked, and quarantine bins", async () => {
    const tasksRes = await getPutawayTasks(
      makeReq("/api/v1/putaway/tasks?lot=LOT-2026-PUT-SAL-01", { token: whManagerToken })
    );
    const task = (await tasksRes.json()).items[0];

    // 2a. Attempt to place chilled salmon (0..2°C) into Ambient bin AMB-D1-01 (10..22°C) -> 409 TEMPERATURE_INCOMPATIBLE_BIN
    const tempIncompatRes = await postConfirm(
      makeReq(`/api/v1/putaway/tasks/${task.id}/confirm`, {
        token: pickerToken,
        idempotencyKey: "putaway-incompat-temp-1",
        body: {
          to_bin_code: "AMB-D1-01",
          placed_qty: 10,
          temp_c: 1.5
        }
      }),
      { params: Promise.resolve({ id: task.id }) }
    );
    assert.equal(tempIncompatRes.status, 409);
    const tempIncompatErr = await tempIncompatRes.json();
    assert.equal(tempIncompatErr.error.code, "TEMPERATURE_INCOMPATIBLE_BIN");

    // 2b. Attempt to place Fish allergen salmon into Dairy bin CHILL-B1-01 (restricts Fish allergen & dedicated to Dairy) -> 409
    const allergenConflictRes = await postConfirm(
      makeReq(`/api/v1/putaway/tasks/${task.id}/confirm`, {
        token: pickerToken,
        idempotencyKey: "putaway-allergen-conflict-1",
        body: {
          to_bin_code: "CHILL-B1-01",
          placed_qty: 10,
          temp_c: 1.5
        }
      }),
      { params: Promise.resolve({ id: task.id }) }
    );
    assert.equal(allergenConflictRes.status, 409);

    // 2c. Attempt to place into Full bin CHILL-FULL-99 (100/100 cases occupied) -> 409 BIN_CAPACITY_EXCEEDED
    const fullBinRes = await postConfirm(
      makeReq(`/api/v1/putaway/tasks/${task.id}/confirm`, {
        token: pickerToken,
        idempotencyKey: "putaway-full-bin-1",
        body: {
          to_bin_code: "CHILL-FULL-99",
          placed_qty: 5,
          temp_c: 1.5
        }
      }),
      { params: Promise.resolve({ id: task.id }) }
    );
    assert.equal(fullBinRes.status, 409);
    const fullBinErr = await fullBinRes.json();
    assert.equal(fullBinErr.error.code, "BIN_CAPACITY_EXCEEDED");

    // 2d. Attempt to place into Blocked bin CHILL-BLK-98 -> 409 BIN_NOT_ACTIVE
    const blockedBinRes = await postConfirm(
      makeReq(`/api/v1/putaway/tasks/${task.id}/confirm`, {
        token: pickerToken,
        idempotencyKey: "putaway-blocked-bin-1",
        body: {
          to_bin_code: "CHILL-BLK-98",
          placed_qty: 5,
          temp_c: 1.5
        }
      }),
      { params: Promise.resolve({ id: task.id }) }
    );
    assert.equal(blockedBinRes.status, 409);
    const blockedBinErr = await blockedBinRes.json();
    assert.equal(blockedBinErr.error.code, "BIN_NOT_ACTIVE");

    // 2e. Attempt to place normal stock into Quarantine bin QUAR-ZONE-01 -> 409 BIN_NOT_ACTIVE
    const quarBinRes = await postConfirm(
      makeReq(`/api/v1/putaway/tasks/${task.id}/confirm`, {
        token: pickerToken,
        idempotencyKey: "putaway-quar-bin-1",
        body: {
          to_bin_code: "QUAR-ZONE-01",
          placed_qty: 5,
          temp_c: 1.5
        }
      }),
      { params: Promise.resolve({ id: task.id }) }
    );
    assert.equal(quarBinRes.status, 409);
    const quarBinErr = await quarBinRes.json();
    assert.equal(quarBinErr.error.code, "BIN_NOT_ACTIVE");
  });

  it("3. Enforces RBAC & mandatory reason on Storage Recommendation Overrides", async () => {
    const tasksRes = await getPutawayTasks(
      makeReq("/api/v1/putaway/tasks?lot=LOT-2026-PUT-SAL-01", { token: whManagerToken })
    );
    const task = (await tasksRes.json()).items[0];

    // 3a. Ordinary warehouse picker cannot override storage recommendation -> 403 FORBIDDEN_PUTAWAY_OVERRIDE
    const pickerOverrideRes = await postOverride(
      makeReq(`/api/v1/putaway/tasks/${task.id}/override`, {
        token: pickerToken,
        idempotencyKey: "putaway-override-picker-1",
        body: {
          target_bin_code: "CHILL-A1-01",
          override_reason: "Picker trying to override without manager permission"
        }
      }),
      { params: Promise.resolve({ id: task.id }) }
    );
    // Ordinary warehouse picker has no putaway.override permission. The route
    // layer now denies the call before any service work runs; the service-level
    // FORBIDDEN_PUTAWAY_OVERRIDE guard remains as a second line of defence.
    assert.equal(pickerOverrideRes.status, 403);
    const pickerOverrideErr = await pickerOverrideRes.json();
    assert.ok(
      ["FORBIDDEN_PUTAWAY_OVERRIDE", "FORBIDDEN_INSUFFICIENT_ROLE"].includes(
        pickerOverrideErr.error.code
      ),
      `unexpected error code: ${pickerOverrideErr.error.code}`
    );

    // 3b. Warehouse manager without reason -> 400 OVERRIDE_REASON_REQUIRED
    const noReasonRes = await postOverride(
      makeReq(`/api/v1/putaway/tasks/${task.id}/override`, {
        token: whManagerToken,
        idempotencyKey: "putaway-override-noreason-1",
        body: {
          target_bin_code: "CHILL-A1-01",
          override_reason: ""
        }
      }),
      { params: Promise.resolve({ id: task.id }) }
    );
    assert.equal(noReasonRes.status, 400);
    const noReasonErr = await noReasonRes.json();
    assert.equal(noReasonErr.error.code, "OVERRIDE_REASON_REQUIRED");

    // 3c. Warehouse manager with valid reason and compatible bin CHILL-A1-02 -> 200
    const mgrOverrideRes = await postOverride(
      makeReq(`/api/v1/putaway/tasks/${task.id}/override`, {
        token: whManagerToken,
        idempotencyKey: "putaway-override-mgr-1",
        body: {
          target_bin_code: "CHILL-A1-02",
          override_reason: "Aisle A1 Rack 1 undergoing routine condensation wipe; redirecting to Rack 2."
        }
      }),
      { params: Promise.resolve({ id: task.id }) }
    );
    assert.equal(mgrOverrideRes.status, 200);
    const mgrOverrideBody = await mgrOverrideRes.json();
    assert.equal(mgrOverrideBody.assigned_bin_code, "CHILL-A1-02");
    assert.equal(mgrOverrideBody.overridden_by, "Marco Bellini");
  });

  it("4. Validates Barcode/QR scans (task, SKU, lot, bin) and logs scan failures in audit trail", async () => {
    const tasksRes = await getPutawayTasks(
      makeReq("/api/v1/putaway/tasks?lot=LOT-2026-PUT-SAL-01", { token: whManagerToken })
    );
    const task = (await tasksRes.json()).items[0];

    // Valid task barcode scan
    const validTaskScan = await postScan(
      makeReq(`/api/v1/putaway/tasks/${task.id}/scan`, {
        token: pickerToken,
        body: { scan_step: "task", scanned_value: `TASK:${task.task_number}` }
      }),
      { params: Promise.resolve({ id: task.id }) }
    );
    assert.equal(validTaskScan.status, 200);
    assert.equal((await validTaskScan.json()).valid, true);

    // Invalid SKU barcode scan -> 400 + logged in putaway_scan_logs
    const invalidSkuScan = await postScan(
      makeReq(`/api/v1/putaway/tasks/${task.id}/scan`, {
        token: pickerToken,
        body: { scan_step: "sku", scanned_value: "SKU-WRONG-999" }
      }),
      { params: Promise.resolve({ id: task.id }) }
    );
    assert.equal(invalidSkuScan.status, 400);
    const invalidSkuBody = await invalidSkuScan.json();
    assert.equal(invalidSkuBody.error.code, "BARCODE_SCAN_MISMATCH");

    // Valid SKU, Lot, and Bin scans
    const validSkuScan = await postScan(
      makeReq(`/api/v1/putaway/tasks/${task.id}/scan`, {
        token: pickerToken,
        body: { scan_step: "sku", scanned_value: "SKU-ATLANT-001" }
      }),
      { params: Promise.resolve({ id: task.id }) }
    );
    assert.equal(validSkuScan.status, 200);

    const validLotScan = await postScan(
      makeReq(`/api/v1/putaway/tasks/${task.id}/scan`, {
        token: pickerToken,
        body: { scan_step: "lot", scanned_value: "LOT-2026-PUT-SAL-01" }
      }),
      { params: Promise.resolve({ id: task.id }) }
    );
    assert.equal(validLotScan.status, 200);

    const validBinScan = await postScan(
      makeReq(`/api/v1/putaway/tasks/${task.id}/scan`, {
        token: pickerToken,
        body: { scan_step: "bin", scanned_value: "BIN:CHILL-A1-02" }
      }),
      { params: Promise.resolve({ id: task.id }) }
    );
    assert.equal(validBinScan.status, 200);

    // Check task detail scan logs
    const detailRes = await getPutawayTaskById(
      makeReq(`/api/v1/putaway/tasks/${task.id}`, { token: pickerToken }),
      { params: Promise.resolve({ id: task.id }) }
    );
    const detailBody = await detailRes.json();
    assert.equal(detailBody.scan_logs.length, 5);
  });

  it("5. Supports Partial Put-away, Multi-Bin Split Placement, Weight Variance, and Idempotent Confirmation", async () => {
    const tasksRes = await getPutawayTasks(
      makeReq("/api/v1/putaway/tasks?lot=LOT-2026-PUT-SAL-01", { token: whManagerToken })
    );
    const task = (await tasksRes.json()).items[0];
    assert.equal(task.remaining_qty, 40);

    // 5a. Partial put-away: place 15 cases (76.5 kg actual vs 75.0 kg expected -> +1.5 kg / +2% catch-weight variance) into CHILL-A1-02
    const partialRes = await postConfirm(
      makeReq(`/api/v1/putaway/tasks/${task.id}/confirm`, {
        token: pickerToken,
        idempotencyKey: "putaway-confirm-partial-1",
        body: {
          to_bin_code: "CHILL-A1-02",
          placed_qty: 15,
          actual_weight_kg: 76.5,
          packages: 15,
          temp_c: 1.3,
          scan_method: "barcode_scan",
          discrepancy_notes: "First pallet placed in CHILL-A1-02"
        }
      }),
      { params: Promise.resolve({ id: task.id }) }
    );
    assert.equal(partialRes.status, 200);
    const partialBody = await partialRes.json();
    assert.equal(partialBody.task.status, "Partially Completed");
    assert.equal(partialBody.task.placed_qty, 15);
    assert.equal(partialBody.task.remaining_qty, 25);
    assert.equal(partialBody.placement.weight_variance_kg, 1.5);
    assert.equal(partialBody.placement.weight_variance_pct, 2);

    // 5b. Duplicate confirmation with same Idempotency-Key returns cached response without double-placing
    const dupRes = await postConfirm(
      makeReq(`/api/v1/putaway/tasks/${task.id}/confirm`, {
        token: pickerToken,
        idempotencyKey: "putaway-confirm-partial-1",
        body: {
          to_bin_code: "CHILL-A1-02",
          placed_qty: 15,
          actual_weight_kg: 76.5,
          packages: 15,
          temp_c: 1.3,
          scan_method: "barcode_scan",
          discrepancy_notes: "First pallet placed in CHILL-A1-02"
        }
      }),
      { params: Promise.resolve({ id: task.id }) }
    );
    assert.equal(dupRes.status, 200);
    const dupBody = await dupRes.json();
    assert.equal(dupBody.task.placed_qty, 15);
    assert.equal(dupBody.task.remaining_qty, 25);

    // 5c. Attempt to place more than remaining quantity (30 > 25) -> 400 PLACED_QTY_EXCEEDS_REMAINING
    const overQtyRes = await postConfirm(
      makeReq(`/api/v1/putaway/tasks/${task.id}/confirm`, {
        token: pickerToken,
        idempotencyKey: "putaway-confirm-overqty-1",
        body: {
          to_bin_code: "CHILL-A1-02",
          placed_qty: 30,
          temp_c: 1.4
        }
      }),
      { params: Promise.resolve({ id: task.id }) }
    );
    assert.equal(overQtyRes.status, 400);
    assert.equal((await overQtyRes.json()).error.code, "PLACED_QTY_EXCEEDS_REMAINING");

    // 5d. Multi-bin placement for the same lot: place 15 more cases into CHILL-A1-02, then final 10 cases into CHILL-A1-01
    const secondDropRes = await postConfirm(
      makeReq(`/api/v1/putaway/tasks/${task.id}/confirm`, {
        token: pickerToken,
        idempotencyKey: "putaway-confirm-drop-2",
        body: {
          to_bin_code: "CHILL-A1-02",
          placed_qty: 15,
          actual_weight_kg: 75.0,
          packages: 15,
          temp_c: 1.2
        }
      }),
      { params: Promise.resolve({ id: task.id }) }
    );
    assert.equal(secondDropRes.status, 200);
    assert.equal((await secondDropRes.json()).task.remaining_qty, 10);

    const finalDropRes = await postConfirm(
      makeReq(`/api/v1/putaway/tasks/${task.id}/confirm`, {
        token: whManagerToken,
        idempotencyKey: "putaway-confirm-drop-3",
        body: {
          to_bin_code: "CHILL-A1-01",
          placed_qty: 10,
          actual_weight_kg: 50.0,
          packages: 10,
          temp_c: 1.2,
          discrepancy_notes: "Final 10 cases split into CHILL-A1-01"
        }
      }),
      { params: Promise.resolve({ id: task.id }) }
    );
    assert.equal(finalDropRes.status, 200);
    const finalBody = await finalDropRes.json();
    assert.equal(finalBody.task.status, "Completed");
    assert.equal(finalBody.task.placed_qty, 40);
    assert.equal(finalBody.task.remaining_qty, 0);
    assert.ok(finalBody.task.completed_at);

    // 5e. Attempt to confirm again on a Completed task -> 409 TASK_ALREADY_COMPLETED
    const afterCompleteRes = await postConfirm(
      makeReq(`/api/v1/putaway/tasks/${task.id}/confirm`, {
        token: pickerToken,
        idempotencyKey: "putaway-confirm-after-complete",
        body: {
          to_bin_code: "CHILL-A1-02",
          placed_qty: 5,
          temp_c: 1.2
        }
      }),
      { params: Promise.resolve({ id: task.id }) }
    );
    assert.equal(afterCompleteRes.status, 409);
    assert.equal((await afterCompleteRes.json()).error.code, "TASK_ALREADY_COMPLETED");

    // 5f. Verify bin_stock_placements & warehouse_bins occupancy reflect the 30 cases in CHILL-A1-02 and +10 cases in CHILL-A1-01 (15 initial + 10 = 25)
    const binsRes = await getBins(makeReq("/api/v1/putaway/bins?zone_code=Z-MIL-SEAFOOD", { token: whManagerToken }));
    const binsData = await binsRes.json();
    const binA102 = binsData.bins.find((b: { code: string }) => b.code === "CHILL-A1-02");
    const binA101 = binsData.bins.find((b: { code: string }) => b.code === "CHILL-A1-01");
    assert.equal(binA102.current_cases, 30);
    assert.equal(binA101.current_cases, 25);
  });

  it("6. Prevents Held/Quarantined/Rejected lots from entering Put-away & blocks tasks on Put-away Temperature Excursion", async () => {
    // 6a. Create an inspection that is placed On Hold in Module 04
    const holdInspRes = await postInspection(
      makeReq("/api/v1/quality/inspections", {
        token: qaManagerToken,
        idempotencyKey: "putaway-hold-insp-1",
        body: {
          shipment_reference: "SHP-2026-HOLD-01",
          sku: "SKU-ATLANT-001",
          product_name: "Atlantic Salmon Fillet",
          supplier_batch: "SUP-BATCH-HOLD-01",
          internal_lot: "LOT-2026-HOLD-SAL-99",
          warehouse: "Milan Cold Hub",
          receiving_location: "RCV-STAGE-01",
          received_qty: 20,
          expiry_date: new Date(Date.now() + 32 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          temp_reading_c: 1.8
        }
      })
    );
    const holdInspId = (await holdInspRes.json()).inspection.id as string;

    await postDecision(
      makeReq(`/api/v1/quality/inspections/${holdInspId}/decision`, {
        token: qaManagerToken,
        idempotencyKey: "putaway-hold-decide-1",
        body: {
          decision: "on_hold",
          held_qty: 20,
          reason: "Awaiting certificate of analysis from supplier"
        }
      }),
      { params: { id: holdInspId } }
    );

    // Attempt to generate a Put-away task for the held lot -> 409 QUALITY_NOT_RELEASED
    const heldTaskRes = await postPutawayTask(
      makeReq("/api/v1/putaway/tasks", {
        token: whManagerToken,
        idempotencyKey: "putaway-create-held-fail",
        body: {
          internal_lot: "LOT-2026-HOLD-SAL-99"
        }
      })
    );
    assert.equal(heldTaskRes.status, 409);
    assert.equal((await heldTaskRes.json()).error.code, "QUALITY_NOT_RELEASED");

    // 6b. Create and release a batch, then detect a Temperature Excursion (6.8°C > 2.0°C max) at Put-away
    const excInspRes = await postInspection(
      makeReq("/api/v1/quality/inspections", {
        token: qaManagerToken,
        idempotencyKey: "putaway-exc-insp-1",
        body: {
          shipment_reference: "SHP-2026-EXC-01",
          sku: "SKU-ATLANT-001",
          product_name: "Atlantic Salmon Fillet",
          supplier_batch: "SUP-BATCH-EXC-01",
          internal_lot: "LOT-2026-EXC-SAL-02",
          warehouse: "Milan Cold Hub",
          receiving_location: "RCV-STAGE-01",
          received_qty: 20,
          expiry_date: new Date(Date.now() + 34 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          temp_reading_c: 1.5
        }
      })
    );
    const excInspId = (await excInspRes.json()).inspection.id as string;

    await postDecision(
      makeReq(`/api/v1/quality/inspections/${excInspId}/decision`, {
        token: qaManagerToken,
        idempotencyKey: "putaway-exc-decide-1",
        body: {
          decision: "released",
          accepted_qty: 20,
          reason: "Released at receiving dock"
        }
      }),
      { params: { id: excInspId } }
    );

    const excTasksRes = await getPutawayTasks(
      makeReq("/api/v1/putaway/tasks?lot=LOT-2026-EXC-SAL-02", { token: whManagerToken })
    );
    const excTask = (await excTasksRes.json()).items[0];
    assert.ok(excTask);

    // Operator attempts to confirm placement at 6.8°C -> 409 PUTAWAY_TEMPERATURE_EXCURSION
    const tempExcConfirmRes = await postConfirm(
      makeReq(`/api/v1/putaway/tasks/${excTask.id}/confirm`, {
        token: pickerToken,
        idempotencyKey: "putaway-temp-excursion-confirm-1",
        body: {
          to_bin_code: excTask.recommended_bin_code,
          placed_qty: 20,
          temp_c: 6.8
        }
      }),
      { params: Promise.resolve({ id: excTask.id }) }
    );
    assert.equal(tempExcConfirmRes.status, 409);
    const tempExcErr = await tempExcConfirmRes.json();
    assert.equal(tempExcErr.error.code, "PUTAWAY_TEMPERATURE_EXCURSION");

    // Verify task is now Blocked, lot is placed on_hold (0 available cases), and a Quality Exception was created
    const blockedTaskRes = await getPutawayTaskById(
      makeReq(`/api/v1/putaway/tasks/${excTask.id}`, { token: whManagerToken }),
      { params: Promise.resolve({ id: excTask.id }) }
    );
    const blockedTaskBody = await blockedTaskRes.json();
    assert.equal(blockedTaskBody.status, "Blocked");

    const db = getDb();
    const lotAfterExc = db
      .prepare(`SELECT quality_status, quantity_cases, held_cases FROM inventory_lots WHERE batch_id = ?`)
      .get("LOT-2026-EXC-SAL-02") as { quality_status: string; quantity_cases: number; held_cases: number };
    assert.equal(lotAfterExc.quality_status, "on_hold");
    assert.equal(lotAfterExc.quantity_cases, 0);
    assert.equal(lotAfterExc.held_cases, 20);

    const qaException = db
      .prepare(`SELECT * FROM quality_exceptions WHERE internal_lot = ?`)
      .get("LOT-2026-EXC-SAL-02") as { exception_type: string; status: string } | undefined;
    assert.ok(qaException, "Quality exception must be created when put-away temperature excursion occurs");
    assert.equal(qaException.exception_type, "temperature_excursion");
  });

  it("7. Enforces Warehouse ABAC isolation & verifies FEFO inventory integration", async () => {
    const tasksRes = await getPutawayTasks(
      makeReq("/api/v1/putaway/tasks?lot=LOT-2026-PUT-SAL-01", { token: whManagerToken })
    );
    const milanTask = (await tasksRes.json()).items[0];

    // Rome Warehouse Manager cannot access or modify a Milan Cold Hub put-away task -> 403
    const crossWhRes = await patchPutawayTask(
      makeReq(`/api/v1/putaway/tasks/${milanTask.id}`, {
        method: "PATCH",
        token: romeWhToken,
        body: { status: "In Progress" }
      }),
      { params: Promise.resolve({ id: milanTask.id }) }
    );
    assert.equal(crossWhRes.status, 403);

    // Dashboard & History endpoints return accurate metrics and movement records
    const dashRes = await getPutawayDashboard(makeReq("/api/v1/putaway/dashboard", { token: whManagerToken }));
    assert.equal(dashRes.status, 200);
    const dashBody = await dashRes.json();
    assert.ok(dashBody.metrics.completed_tasks >= 1);
    assert.ok(dashBody.metrics.blocked_tasks >= 1);

    const histRes = await getPutawayHistory(
      makeReq("/api/v1/putaway/history?lot=LOT-2026-PUT-SAL-01", { token: whManagerToken })
    );
    assert.equal(histRes.status, 200);
    const histBody = await histRes.json();
    assert.equal(histBody.placements.length, 3);
    assert.ok(histBody.stock_movements.length >= 3);

    // Verify FEFO allocation sees our placed lot LOT-2026-PUT-SAL-01 (40 available cases) and never sees the blocked lot LOT-2026-EXC-SAL-02
    const fefoLot = findFefoLotForSku("SKU-ATLANT-001", 10);
    assert.ok(fefoLot, "FEFO should find an eligible released lot");
    assert.notEqual(fefoLot.batch_id, "LOT-2026-EXC-SAL-02");
    assert.notEqual(fefoLot.batch_id, "LOT-2026-HOLD-SAL-99");

    const allLots = listLots();
    const placedLot = allLots.find((l) => l.batch_id === "LOT-2026-PUT-SAL-01");
    assert.ok(placedLot, "Placed lot LOT-2026-PUT-SAL-01 must be in released FEFO inventory");
    assert.equal(placedLot.quality_status, "released");
    assert.equal(placedLot.quantity_cases, 40);
    assert.ok(placedLot.location.includes("CHILL-A1-01") && placedLot.location.includes("CHILL-A1-02"));
  });
});
