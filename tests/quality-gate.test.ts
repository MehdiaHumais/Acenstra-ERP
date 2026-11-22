import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextRequest } from "next/server";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ascentra-quality-gate-test-"));
const tmpDbPath = path.join(tmpDir, "test-quality-gate.sqlite");
process.env.SQLITE_DB_PATH = tmpDbPath;
process.env.SEED_DEMO_DATA = "true";

import { getDb } from "@/server/db/connection";
import { signAccessToken } from "@/server/security/crypto";
import { findFefoLotForSku, listLots } from "@/server/services/inventory-fefo.service";
import { createOrder, transitionOrderStatus, updateWarehouseTask } from "@/server/services/orders-warehouse.service";
import { GET as getDashboard } from "@/app/api/v1/quality/dashboard/route";
import { GET as getInspections, POST as postInspection } from "@/app/api/v1/quality/inspections/route";
import { GET as getInspectionById, PATCH as patchInspection } from "@/app/api/v1/quality/inspections/[id]/route";
import {
  POST as postHaccpReading,
  PATCH as patchHaccpReading,
  DELETE as deleteHaccpReading
} from "@/app/api/v1/quality/inspections/[id]/haccp/route";
import { POST as postDecision } from "@/app/api/v1/quality/inspections/[id]/decision/route";
import { GET as getTemplates, POST as postTemplate } from "@/app/api/v1/quality/haccp-templates/route";
import { GET as getExceptions, POST as postException } from "@/app/api/v1/quality/exceptions/route";
import { PATCH as patchException } from "@/app/api/v1/quality/exceptions/[id]/route";
import { GET as getCapas, POST as postCapa } from "@/app/api/v1/quality/capas/route";
import { PATCH as patchCapa } from "@/app/api/v1/quality/capas/[id]/route";
import { GET as getHistory } from "@/app/api/v1/quality/history/route";

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

describe("Module 04 — Quality Gate (Receiving Inspection, HACCP, Hold/Release & CAPA)", () => {
  let qaManagerToken: string;
  let qaInspectorToken: string;
  let whManagerToken: string;
  let pickerToken: string;
  let romeQaToken: string;

  before(() => {
    const db = getDb();
    // Create a QA Inspector user and a Rome QA Manager user to test RBAC & warehouse boundaries
    db.prepare(
      `INSERT OR IGNORE INTO users (id, email, name, password_hash, role, store_id, warehouse)
       VALUES (?, ?, ?, 'hash', ?, NULL, ?)`
    ).run("USR-QA-INSP", "luca.inspector@ascentra.it", "Luca Inspector", "qa_inspector", "Milan Cold Hub");

    db.prepare(
      `INSERT OR IGNORE INTO users (id, email, name, password_hash, role, store_id, warehouse)
       VALUES (?, ?, ?, 'hash', ?, NULL, ?)`
    ).run("USR-QA-ROME", "paola.rome@ascentra.it", "Paola Rome QA", "qa_manager", "Rome Cold Hub");

    qaManagerToken = signAccessToken({
      sub: "USR-QA",
      email: "giulia.romano@ascentra.it",
      name: "Giulia Romano",
      role: "qa",
      warehouse: "Milan Cold Hub"
    });
    qaInspectorToken = signAccessToken({
      sub: "USR-QA-INSP",
      email: "luca.inspector@ascentra.it",
      name: "Luca Inspector",
      role: "qa_inspector",
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
      email: "pietro.rossi@ascentra.it",
      name: "Pietro Rossi",
      role: "picker",
      warehouse: "Milan Cold Hub"
    });
    romeQaToken = signAccessToken({
      sub: "USR-QA-ROME",
      email: "paola.rome@ascentra.it",
      name: "Paola Rome QA",
      role: "qa_manager",
      warehouse: "Rome Cold Hub"
    });
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  });

  it("1. Enforces unauthenticated (401) and unauthorized role separation of duties (403)", async () => {
    // Unauthenticated request returns 401
    const unauthRes = await getDashboard(makeReq("/api/v1/quality/dashboard"));
    assert.equal(unauthRes.status, 401);

    // Create a pending inspection as QA Inspector
    const createRes = await postInspection(
      makeReq("/api/v1/quality/inspections", {
        token: qaInspectorToken,
        body: {
          shipment_reference: "IB-2026-QG-01",
          asn_reference: "ASN-QG-01",
          purchase_order_id: "PO-2026-0844",
          supplier_id: "SUP-NOR-01",
          supplier_name: "Nordic Fjord Seafood AS",
          sku: "SKU-SAL-001",
          product_name: "Norwegian Atlantic Salmon Fillet (Trim D)",
          supplier_batch: "SUP-BATCH-QG-01",
          internal_lot: "LOT-2026-QG-001",
          warehouse: "Milan Cold Hub",
          receiving_location: "RCV-STAGE-01",
          received_qty: 50,
          actual_weight_kg: 250,
          manufacture_date: "2026-10-30",
          expiry_date: "2027-01-15",
          temp_reading_c: 1.2,
          visual_inspection: "pass",
          packaging_condition: "pass",
          product_condition: "pass",
          freshness_status: "pass",
          labelling_status: "pass",
          traceability_verified: true,
          certificates_verified: true
        }
      })
    );
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()).inspection;
    assert.equal(created.status, "pending");
    assert.equal(created.accepted_qty, 0);

    // Verify lot is NOT available in FEFO before QA release
    const lotBeforeRelease = listLots().find((l) => l.batch_code === "LOT-2026-QG-001");
    assert.ok(lotBeforeRelease);
    assert.equal(lotBeforeRelease.quality_status, "pending");
    assert.equal(lotBeforeRelease.quantity_cases, 0);
    assert.equal(lotBeforeRelease.pending_cases, 50);

    // Picker cannot release goods (403)
    const pickerReleaseRes = await postDecision(
      makeReq(`/api/v1/quality/inspections/${created.id}/decision`, {
        token: pickerToken,
        body: { decision: "released", accepted_qty: 50, reason: "Picker attempting bypass" }
      }),
      { params: { id: created.id } }
    );
    assert.equal(pickerReleaseRes.status, 403);

    // Ordinary Warehouse Manager cannot bypass QA to release goods (403)
    const whReleaseRes = await postDecision(
      makeReq(`/api/v1/quality/inspections/${created.id}/decision`, {
        token: whManagerToken,
        body: { decision: "released", accepted_qty: 50, reason: "Warehouse manager attempting bypass" }
      }),
      { params: { id: created.id } }
    );
    assert.equal(whReleaseRes.status, 403);

    // QA Inspector (without quality.decide) cannot approve final release (403)
    const inspReleaseRes = await postDecision(
      makeReq(`/api/v1/quality/inspections/${created.id}/decision`, {
        token: qaInspectorToken,
        body: { decision: "released", accepted_qty: 50, reason: "QA inspector attempting final sign-off" }
      }),
      { params: { id: created.id } }
    );
    assert.equal(inspReleaseRes.status, 403);
  });

  it("2. Successful inspection, HACCP pass, and QA release makes stock available in FEFO", async () => {
    const listRes = await getInspections(makeReq("/api/v1/quality/inspections?lot=LOT-2026-QG-001", { token: qaManagerToken }));
    const insp = (await listRes.json()).items[0];
    assert.ok(insp);

    // Record passing HACCP checkpoint reading
    const haccpRes = await postHaccpReading(
      makeReq(`/api/v1/quality/inspections/${insp.id}/haccp`, {
        token: qaInspectorToken,
        body: {
          template_id: "HCT-01",
          actual_numeric: 1.4,
          actual_text: "Core temperature 1.4°C within 0..2°C salmon limit",
          status: "pass"
        }
      }),
      { params: { id: insp.id } }
    );
    assert.equal(haccpRes.status, 201);
    const haccpBody = await haccpRes.json();
    assert.equal(haccpBody.reading.status, "pass");
    assert.equal(haccpBody.exception_created, null);

    // Decision without a reason is rejected (400 REASON_REQUIRED)
    const noReasonRes = await postDecision(
      makeReq(`/api/v1/quality/inspections/${insp.id}/decision`, {
        token: qaManagerToken,
        body: { decision: "released", accepted_qty: 50, reason: "" }
      }),
      { params: { id: insp.id } }
    );
    assert.equal(noReasonRes.status, 400);

    // Authorized QA Manager releases all 50 cases with documented reason
    const releaseRes = await postDecision(
      makeReq(`/api/v1/quality/inspections/${insp.id}/decision`, {
        token: qaManagerToken,
        body: {
          decision: "released",
          accepted_qty: 50,
          target_location: "CHILL-A1-02",
          reason: "All receiving checks, COA, and CCP-1B temperature (1.4°C) verified within spec."
        }
      }),
      { params: { id: insp.id } }
    );
    assert.equal(releaseRes.status, 200);
    const releasedInsp = (await releaseRes.json()).inspection;
    assert.equal(releasedInsp.status, "released");
    assert.equal(releasedInsp.accepted_qty, 50);

    // Verify lot is now released and available in inventory_lots
    const lotAfter = listLots().find((l) => l.batch_code === "LOT-2026-QG-001");
    assert.ok(lotAfter);
    assert.equal(lotAfter.quality_status, "released");
    assert.equal(lotAfter.quantity_cases, 50);
    assert.equal(lotAfter.pending_cases, 0);
  });

  it("3. Failed HACCP checkpoint & temperature excursion automatically block stock, create exception, and preserve immutable evidence", async () => {
    // Create an inspection for a new lot
    const createRes = await postInspection(
      makeReq("/api/v1/quality/inspections", {
        token: qaInspectorToken,
        body: {
          shipment_reference: "IB-2026-QG-02",
          supplier_name: "Nordic Fjord Seafood AS",
          sku: "SKU-SAL-001",
          product_name: "Norwegian Atlantic Salmon Fillet (Trim D)",
          supplier_batch: "SUP-BATCH-QG-02",
          internal_lot: "LOT-2026-QG-EXCURSION",
          warehouse: "Milan Cold Hub",
          receiving_location: "RCV-STAGE-02",
          received_qty: 30,
          expiry_date: "2027-01-20",
          temp_reading_c: 1.8
        }
      })
    );
    assert.equal(createRes.status, 201);
    const insp = (await createRes.json()).inspection;

    // Record a failed HACCP temperature checkpoint (7.6°C > 2.0°C product-specific max for SKU-SAL-001)
    const failHaccpRes = await postHaccpReading(
      makeReq(`/api/v1/quality/inspections/${insp.id}/haccp`, {
        token: qaInspectorToken,
        body: {
          template_id: "HCT-01",
          actual_numeric: 7.6,
          actual_text: "Reefer door seal leak caused warm air ingress (7.6°C)",
          evidence: [
            {
              title: "Data Logger Excursion Graph",
              file_type: "temperature_log",
              file_url: "/evidence/excursion-7.6c.pdf"
            }
          ]
        }
      }),
      { params: { id: insp.id } }
    );
    assert.equal(failHaccpRes.status, 201);
    const failData = await failHaccpRes.json();
    assert.equal(failData.reading.status, "fail");
    assert.equal(failData.reading.critical_violation, 1);
    assert.ok(failData.exception_created, "Expected quality exception to be automatically created on HACCP failure");
    assert.equal(failData.exception_created.exception_type, "temperature_excursion");
    assert.equal(failData.exception_created.severity, "critical");

    // Verify inspection and lot were automatically placed on hold with 0 available cases
    assert.equal(failData.inspection.status, "on_hold");
    assert.equal(failData.inspection.held_qty, 30);
    assert.equal(failData.inspection.accepted_qty, 0);

    const heldLot = listLots().find((l) => l.batch_code === "LOT-2026-QG-EXCURSION");
    assert.ok(heldLot);
    assert.equal(heldLot.quality_status, "on_hold");
    assert.equal(heldLot.quantity_cases, 0);
    assert.equal(heldLot.held_cases, 30);

    // Attempt to overwrite or delete the failed HACCP reading is blocked (403 IMMUTABLE_HACCP_READING)
    const patchTamperRes = await patchHaccpReading(
      makeReq(`/api/v1/quality/inspections/${insp.id}/haccp`, {
        method: "PATCH",
        token: qaManagerToken,
        body: { status: "pass", actual_numeric: 1.2 }
      }),
      { params: { id: insp.id } }
    );
    assert.equal(patchTamperRes.status, 403);

    const deleteTamperRes = await deleteHaccpReading(
      makeReq(`/api/v1/quality/inspections/${insp.id}/haccp`, {
        method: "DELETE",
        token: qaManagerToken
      }),
      { params: { id: insp.id } }
    );
    assert.equal(deleteTamperRes.status, 403);

    // Attempting full release while HACCP exception is unresolved is blocked (409 UNRESOLVED_HACCP_FAILURE)
    const prematureRelease = await postDecision(
      makeReq(`/api/v1/quality/inspections/${insp.id}/decision`, {
        token: qaManagerToken,
        body: {
          decision: "released",
          accepted_qty: 30,
          reason: "Trying to release full batch despite unresolved CCP excursion"
        }
      }),
      { params: { id: insp.id } }
    );
    assert.equal(prematureRelease.status, 409);
  });

  it("4. Supports partial acceptance and partial rejection, and prevents releasing more than received quantity", async () => {
    const createRes = await postInspection(
      makeReq("/api/v1/quality/inspections", {
        token: qaManagerToken,
        body: {
          shipment_reference: "IB-2026-QG-03",
          supplier_name: "Caseificio Val d'Orcia Srl",
          sku: "SKU-BUR-004",
          product_name: "Artisanal Burrata di Andria IGP (12x125g)",
          supplier_batch: "SUP-BATCH-QG-03",
          internal_lot: "LOT-2026-QG-PARTIAL",
          warehouse: "Milan Cold Hub",
          receiving_location: "RCV-STAGE-01",
          received_qty: 40,
          expiry_date: "2027-02-01",
          temp_reading_c: 3.1
        }
      })
    );
    assert.equal(createRes.status, 201);
    const insp = (await createRes.json()).inspection;
    // Verify dynamic product-specific limits for SKU-BUR-004 (+2°C to +4°C)
    assert.equal(insp.temp_min_c, 2);
    assert.equal(insp.temp_max_c, 4);
    assert.equal(insp.temp_status, "pass");

    // Attempt to release more than received quantity (50 > 40) -> 400 QUANTITY_EXCEEDED
    const overReleaseRes = await postDecision(
      makeReq(`/api/v1/quality/inspections/${insp.id}/decision`, {
        token: qaManagerToken,
        body: {
          decision: "released",
          accepted_qty: 50,
          reason: "Attempting over-release"
        }
      }),
      { params: { id: insp.id } }
    );
    assert.equal(overReleaseRes.status, 400);

    // Partial release: 28 accepted, 7 on hold, 5 rejected (= 40 total)
    const partialRes = await postDecision(
      makeReq(`/api/v1/quality/inspections/${insp.id}/decision`, {
        token: qaManagerToken,
        idempotencyKey: "idem-partial-decision-001",
        body: {
          decision: "partially_released",
          accepted_qty: 28,
          held_qty: 7,
          rejected_qty: 5,
          quarantined_qty: 0,
          target_location: "CHILL-B1-04",
          reason: "28 cases passed inspection; 5 outer cartons crushed (rejected); 7 cases held for secondary seal check."
        }
      }),
      { params: { id: insp.id } }
    );
    assert.equal(partialRes.status, 200);
    const partialInsp = (await partialRes.json()).inspection;
    assert.equal(partialInsp.status, "partially_released");
    assert.equal(partialInsp.accepted_qty, 28);
    assert.equal(partialInsp.held_qty, 7);
    assert.equal(partialInsp.rejected_qty, 5);

    // Duplicate concurrent replay with same Idempotency-Key returns identical response without double-releasing
    const duplicateReplay = await postDecision(
      makeReq(`/api/v1/quality/inspections/${insp.id}/decision`, {
        token: qaManagerToken,
        idempotencyKey: "idem-partial-decision-001",
        body: {
          decision: "partially_released",
          accepted_qty: 28,
          held_qty: 7,
          rejected_qty: 5,
          quarantined_qty: 0,
          target_location: "CHILL-B1-04",
          reason: "28 cases passed inspection; 5 outer cartons crushed (rejected); 7 cases held for secondary seal check."
        }
      }),
      { params: { id: insp.id } }
    );
    assert.equal(duplicateReplay.status, 200);

    // Verify ONLY the 28 accepted cases are available in inventory_lots
    const lot = listLots().find((l) => l.batch_code === "LOT-2026-QG-PARTIAL");
    assert.ok(lot);
    assert.equal(lot.quality_status, "released");
    assert.equal(lot.quantity_cases, 28);
    assert.equal(lot.held_cases, 7);
    assert.equal(lot.rejected_cases, 5);
  });

  it("5. Rejected, quarantined, and held lots cannot be allocated by FEFO, picked, or dispatched", async () => {
    // Create and reject a lot with the earliest expiry date so it would be FEFO #1 if quality gate were bypassed
    const createRej = await postInspection(
      makeReq("/api/v1/quality/inspections", {
        token: qaManagerToken,
        body: {
          shipment_reference: "IB-2026-QG-REJ",
          supplier_name: "Nordic Fjord Seafood AS",
          sku: "SKU-SAL-001",
          product_name: "Norwegian Atlantic Salmon Fillet (Trim D)",
          supplier_batch: "SUP-BATCH-REJ-01",
          internal_lot: "LOT-2026-QG-REJECTED",
          warehouse: "Milan Cold Hub",
          receiving_location: "REJ-DOCK-01",
          received_qty: 60,
          expiry_date: "2026-11-05",
          temp_reading_c: 9.5,
          visual_inspection: "fail"
        }
      })
    );
    const rejInsp = (await createRej.json()).inspection;

    const rejectDecision = await postDecision(
      makeReq(`/api/v1/quality/inspections/${rejInsp.id}/decision`, {
        token: qaManagerToken,
        body: {
          decision: "rejected",
          accepted_qty: 0,
          rejected_qty: 60,
          reason: "Severe thermal abuse (9.5°C) and organoleptic spoilage; entire batch rejected."
        }
      }),
      { params: { id: rejInsp.id } }
    );
    assert.equal(rejectDecision.status, 200);

    // Verify FEFO never selects LOT-2026-QG-REJECTED or LOT-2026-QG-EXCURSION (which is on_hold)
    const fefoLot = findFefoLotForSku("SKU-SAL-001", 5);
    assert.ok(fefoLot);
    assert.notEqual(fefoLot.batch_id, "LOT-2026-QG-REJECTED");
    assert.notEqual(fefoLot.batch_id, "LOT-2026-QG-EXCURSION");
    assert.equal(fefoLot.quality_status, "released");

    // Verify warehouse task picking and order dispatch block if a lot is subsequently placed on_hold
    const db = getDb();
    db.prepare(
      `INSERT INTO warehouse_tasks (id, task_type, sku, product_name, batch_id, from_bin, to_bin, cases, priority, status, assignee, order_number, updated_at)
       VALUES ('TSK-QG-BLOCK-01', 'pick', 'SKU-SAL-001', 'Salmon', 'LOT-2026-QG-EXCURSION', 'RCV-STAGE-02', 'PACK-01', 5, 'high', 'queued', 'Pietro Rossi', 'SO-QG-TEST', datetime('now'))`
    ).run();

    const adminActor = {
      id: "USR-ADMIN",
      email: "elena.conti@ascentra.it",
      name: "Elena Conti",
      role: "super_admin" as const,
      warehouse: "Milan Cold Hub"
    };

    assert.throws(
      () => updateWarehouseTask(adminActor, { task_id: "TSK-QG-BLOCK-01", action: "complete" }),
      (err: any) => err.code === "LOT_QUALITY_BLOCKED" && err.status === 409
    );
  });

  it("6. Enforces CAPA lifecycle rules: cannot close CAPA without root cause, corrective/preventive actions, and verification", async () => {
    const excRes = await getExceptions(makeReq("/api/v1/quality/exceptions?lot=LOT-2026-QG-EXCURSION", { token: qaManagerToken }));
    const excList = (await excRes.json()).exceptions;
    assert.ok(excList.length > 0);
    const targetExc = excList[0];

    // Create a CAPA linked to the excursion exception
    const createCapaRes = await postCapa(
      makeReq("/api/v1/quality/capas", {
        token: qaInspectorToken,
        body: {
          exception_id: targetExc.id,
          inspection_id: targetExc.inspection_id,
          supplier_id: "SUP-NOR-01",
          supplier_name: "Nordic Fjord Seafood AS",
          sku: "SKU-SAL-001",
          product_name: "Norwegian Atlantic Salmon Fillet (Trim D)",
          internal_lot: "LOT-2026-QG-EXCURSION",
          warehouse: "Milan Cold Hub",
          problem_description: "Reefer trailer seal degradation caused +7.6°C arrival excursion on LOT-2026-QG-EXCURSION",
          assigned_to_name: "Giulia Romano",
          target_completion_date: "2026-10-15" // Past date to also verify overdue CAPA tracking
        }
      })
    );
    assert.equal(createCapaRes.status, 201);
    const capa = (await createCapaRes.json()).capa;
    assert.equal(capa.status, "Open");
    assert.equal(capa.is_overdue, true);

    // Attempt to close CAPA without root cause, corrective action, preventive action, and verification -> 400 CAPA_VERIFICATION_REQUIRED
    const prematureCloseRes = await patchCapa(
      makeReq(`/api/v1/quality/capas/${capa.id}`, {
        method: "PATCH",
        token: qaManagerToken,
        body: {
          status: "Closed",
          root_cause: "Worn gasket on carrier reefer door"
          // Missing corrective_action, preventive_action, effectiveness_review
        }
      }),
      { params: { id: capa.id } }
    );
    assert.equal(prematureCloseRes.status, 400);

    // QA Inspector (without quality.decide) cannot close CAPA -> 403 FORBIDDEN_CAPA_CLOSURE
    const inspectorCloseRes = await patchCapa(
      makeReq(`/api/v1/quality/capas/${capa.id}`, {
        method: "PATCH",
        token: qaInspectorToken,
        body: {
          status: "Closed",
          root_cause: "Worn gasket on carrier reefer door",
          corrective_action: "Replaced carrier gasket and rejected affected pallet",
          preventive_action: "Added pre-loading gasket pressure test to carrier SOP",
          verification_notes: "Verified on next 3 shipments",
          effectiveness_review: "100% temperature compliance across 3 consecutive deliveries"
        }
      }),
      { params: { id: capa.id } }
    );
    assert.equal(inspectorCloseRes.status, 403);

    // Authorized QA Manager completes root cause, actions, and verification and closes CAPA -> 200 OK
    const validCloseRes = await patchCapa(
      makeReq(`/api/v1/quality/capas/${capa.id}`, {
        method: "PATCH",
        token: qaManagerToken,
        body: {
          status: "Closed",
          root_cause: "Worn gasket on carrier reefer door",
          containment_action: "Isolated LOT-2026-QG-EXCURSION in HOLD-CAGE-01",
          corrective_action: "Replaced carrier gasket and recalibrated dual-zone probe",
          preventive_action: "Added mandatory pre-loading door seal check to carrier SLA",
          verification_notes: "Verified calibration certificates and 3 subsequent shipments",
          effectiveness_review: "Effective — zero excursions observed in follow-up audit"
        }
      }),
      { params: { id: capa.id } }
    );
    assert.equal(validCloseRes.status, 200);
    const closedCapa = (await validCloseRes.json()).capa;
    assert.equal(closedCapa.status, "Closed");
    assert.ok(closedCapa.verified_by_name);
    assert.ok(closedCapa.closed_at);
  });

  it("7. Enforces cross-warehouse access restrictions and provides complete Lot/Supplier Quality History", async () => {
    // Rome QA user cannot access Milan Cold Hub inspection or filter Milan Cold Hub
    const crossWhListRes = await getInspections(
      makeReq("/api/v1/quality/inspections?warehouse=Milan%20Cold%20Hub", { token: romeQaToken })
    );
    assert.equal(crossWhListRes.status, 403);

    // Query Quality History for LOT-2026-QG-EXCURSION as Milan QA Manager
    const historyRes = await getHistory(
      makeReq("/api/v1/quality/history?lot=LOT-2026-QG-EXCURSION", { token: qaManagerToken })
    );
    assert.equal(historyRes.status, 200);
    const history = await historyRes.json();
    assert.equal(history.inspections.length, 1);
    assert.equal(history.haccp_readings.length, 1);
    assert.equal(history.exceptions.length, 1);
    assert.equal(history.capas.length, 1);
  });
});
