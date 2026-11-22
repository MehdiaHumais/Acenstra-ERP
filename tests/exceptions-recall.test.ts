import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextRequest } from "next/server";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ascentra-exceptions-test-"));
const tmpDbPath = path.join(tmpDir, "test-exceptions.sqlite");
process.env.SQLITE_DB_PATH = tmpDbPath;
process.env.SEED_DEMO_DATA = "true";

import { getDb, seedFinanceModule, seedExceptionsAndRecallModule } from "@/server/db/connection";
import { signAccessToken } from "@/server/security/crypto";
import { AuthenticatedUser } from "@/server/security/auth";

import {
  calculateLotMassBalance,
  getForwardTraceability,
  getBackwardTraceability,
  quarantineLot,
  releaseQuarantineLot,
  listExceptions,
  getException,
  createException,
  updateException,
  listRecalls,
  getRecall,
  initiateRecall,
  approveRecall,
  notifyRecallCustomer,
  recordRecallRecovery,
  closeRecall,
  generateFinalRecallReport,
} from "@/server/services/exceptions-recall.service";

import { GET as getForwardTraceRoute } from "@/app/api/v1/exceptions-recall/trace/forward/route";
import { GET as getBackwardTraceRoute } from "@/app/api/v1/exceptions-recall/trace/backward/route";
import { GET as getMassBalanceRoute } from "@/app/api/v1/exceptions-recall/mass-balance/route";
import { GET as getExceptionsRoute, POST as postExceptionsRoute } from "@/app/api/v1/exceptions-recall/exceptions/route";
import { GET as getExceptionByIdRoute, PATCH as patchExceptionRoute } from "@/app/api/v1/exceptions-recall/exceptions/[id]/route";
import { POST as postQuarantineRoute } from "@/app/api/v1/exceptions-recall/quarantine/route";
import { POST as postReleaseRoute } from "@/app/api/v1/exceptions-recall/quarantine/release/route";
import { GET as getRecallsRoute, POST as postRecallsRoute } from "@/app/api/v1/exceptions-recall/recalls/route";
import { GET as getRecallByIdRoute } from "@/app/api/v1/exceptions-recall/recalls/[id]/route";
import { POST as postApproveRecallRoute } from "@/app/api/v1/exceptions-recall/recalls/[id]/approve/route";
import { POST as postNotifyCustomerRoute } from "@/app/api/v1/exceptions-recall/recalls/[id]/notify/route";
import { POST as postRecoverRecallRoute } from "@/app/api/v1/exceptions-recall/recalls/[id]/recover/route";
import { POST as postCloseRecallRoute } from "@/app/api/v1/exceptions-recall/recalls/[id]/close/route";
import { GET as getRecallReportRoute } from "@/app/api/v1/exceptions-recall/recalls/[id]/report/route";

describe("Module 11 - Exceptions and Recall Management Test Suite", () => {
  let adminUser: AuthenticatedUser;
  let qaUser: AuthenticatedUser;
  let driverUser: AuthenticatedUser;
  let adminToken: string;
  let qaToken: string;
  let driverToken: string;

  before(async () => {
    (global as any).__ascentraDbInstance = null;
    const db = getDb();
    seedFinanceModule(db);
    seedExceptionsAndRecallModule(db);

    adminUser = {
      id: "USR-ADMIN",
      email: "elena.conti@ascentra.it",
      name: "Elena Conti",
      role: "super_admin",
      store_id: null,
      warehouse: "Milan Cold Hub",
    };

    qaUser = {
      id: "USR-QA",
      email: "giulia.romano@ascentra.it",
      name: "Giulia Romano",
      role: "qa",
      store_id: null,
      warehouse: "Milan Cold Hub",
    };

    driverUser = {
      id: "USR-DRV",
      email: "davide.galli@ascentra.it",
      name: "Davide Galli",
      role: "driver",
      store_id: null,
      warehouse: "Milan Cold Hub",
    };

    adminToken = await signAccessToken(adminUser);
    qaToken = await signAccessToken(qaUser);
    driverToken = await signAccessToken(driverUser);
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // --------------------------------------------------------------------------
  // 1. FORWARD TRACEABILITY TESTS
  // --------------------------------------------------------------------------
  describe("1. Forward Traceability (Supplier to Customer)", () => {
    it("traces complete batch history from origin supplier to final customer delivery", () => {
      const trace = getForwardTraceability("LOT-2026-SAL-082", qaUser);
      assert.ok(trace);
      assert.equal(trace.lot.internal_lot, "LOT-2026-SAL-082");
      assert.equal(trace.lot.sku, "SKU-SAL-001");

      // Verify Supplier info
      assert.ok(trace.supplier);
      assert.ok(trace.supplier.name.length > 0);
      assert.ok(trace.supplier.purchase_order_number);

      // Verify Receiving Inspection & HACCP
      assert.ok(trace.inspection);
      assert.ok(trace.inspection.temp_reading_c !== null);
      assert.equal(trace.inspection.traceability_verified, true);

      // Verify Storage Putaway
      assert.ok(trace.storage);
      assert.ok(trace.storage.warehouse);
      assert.ok(trace.storage.bin);

      // Verify Customer Orders and Deliveries
      assert.ok(Array.isArray(trace.orders));
      assert.ok(Array.isArray(trace.deliveries));
      assert.ok(trace.deliveries.length >= 1, "Delivered customers should appear in trace");

      // Verify Chronological Timeline
      assert.ok(trace.timeline.length >= 4, "Timeline must contain complete supply chain milestones");
      for (let i = 0; i < trace.timeline.length - 1; i++) {
        assert.ok(
          trace.timeline[i].timestamp <= trace.timeline[i + 1].timestamp,
          `Timeline must be strictly chronological: ${trace.timeline[i].stage} (${trace.timeline[i].timestamp}) <= ${trace.timeline[i + 1].stage} (${trace.timeline[i + 1].timestamp})`
        );
      }
    });

    it("throws 404 for unknown lot identifier", () => {
      assert.throws(
        () => getForwardTraceability("LOT-NON-EXISTENT-999", qaUser),
        (err: any) => err.status === 404 && err.code === "LOT_NOT_FOUND"
      );
    });
  });

  // --------------------------------------------------------------------------
  // 2. BACKWARD TRACEABILITY TESTS
  // --------------------------------------------------------------------------
  describe("2. Backward Traceability (Customer to Supplier)", () => {
    it("traces backward from customer order to original supplier and identifies other affected customers", () => {
      const trace = getBackwardTraceability({ order_number: "SO-2026-9841" }, qaUser);
      assert.ok(trace);
      assert.equal(trace.customer.name, "Ristorante Cracco Galleria");
      assert.ok(trace.delivered_products.length > 0);

      // Verify origin suppliers resolved
      assert.ok(trace.suppliers.length > 0);
      const salmonSupplier = trace.suppliers.find((s) => s.sku === "SKU-SAL-001");
      assert.ok(salmonSupplier, "Salmon supplier must be resolved");
      assert.ok(salmonSupplier.purchase_order_number);

      // CRITICAL: Verify other affected customers who received the same batch
      assert.ok(Array.isArray(trace.other_affected_customers));

      // CRITICAL: Verify current physical locations where remaining stock resides
      assert.ok(Array.isArray(trace.current_physical_locations));
    });

    it("traces backward by customer ID", () => {
      const trace = getBackwardTraceability({ customer_id: "CUST-001" }, qaUser);
      assert.ok(trace);
      assert.equal(trace.customer.id, "CUST-001");
      assert.ok(trace.delivered_products.length > 0);
    });
  });

  // --------------------------------------------------------------------------
  // 3. MASS BALANCE RECONCILIATION TESTS
  // --------------------------------------------------------------------------
  describe("3. Mass Balance Quantity Reconciliation", () => {
    it("calculates exact mass balance equation with cases and catch weight (kg)", () => {
      const mb = calculateLotMassBalance("LOT-2026-SAL-082");
      assert.ok(mb);
      assert.equal(mb.lot_id, "LOT-2026-SAL-082");
      assert.ok(mb.received_cases > 0);
      assert.ok(mb.received_weight_kg > 0);

      // Verify accounted components are non-negative
      assert.ok(mb.current_physical_cases >= 0);
      assert.ok(mb.delivered_cases >= 0);
      assert.ok(mb.returned_cases >= 0);

      // Mathematical consistency check:
      // total accounted = current_physical + delivered + rejected + abs(adjusted) - returned
      const accounted = mb.current_physical_cases + mb.delivered_cases + mb.rejected_cases + Math.abs(mb.adjusted_cases) - mb.returned_cases;
      assert.equal(
        Math.round((mb.received_cases - accounted) * 100) / 100,
        Math.round(mb.unaccounted_variance_cases * 100) / 100
      );
    });

    it("flags variance when stock is artificially altered without transaction", () => {
      const db = getDb();
      // Temporarily create a mock lot with an unaccounted discrepancy
      db.prepare(`
        INSERT INTO inventory_lots (
          id, batch_id, sku, product_name, category, warehouse, location, zone,
          quantity_cases, received_cases, allocated_cases, received_date, expiry_date,
          supplier, supplier_lot, origin_country, quality_status, temp_c, unit_weight_kg
        ) VALUES (
          'LOT-TEST-UNBAL', 'LOT-TEST-UNBAL', 'SKU-SAL-001', 'Test Discrepancy Salmon', 'Seafood',
          'Milan Cold Hub', 'CHILL-A1-01', 'Z-MIL-SEAFOOD', 10, 50, 0, '2026-03-01', '2026-03-20',
          'Nordic Fjords', 'SUP-BAT-999', 'NO', 'released', 2.0, 5.0
        )
      `).run();

      const mb = calculateLotMassBalance("LOT-TEST-UNBAL");
      assert.equal(mb.reconciliation_status, "variance_flagged");
      assert.ok(mb.unaccounted_variance_cases > 0, "Discrepancy must be flagged");
    });
  });

  // --------------------------------------------------------------------------
  // 4. QUARANTINE & STOCK BLOCKING TESTS
  // --------------------------------------------------------------------------
  describe("4. Quarantine Hold & Release Operations", () => {
    it("places lot on quarantine hold and blocks reservations", () => {
      const result = quarantineLot(
        {
          lot_id: "LOT-2026-SAL-082",
          reason: "Suspected temperature abuse at air cargo hub",
          quarantine_bin_code: "QUAR-ZONE-01",
        },
        qaUser
      );

      assert.ok(result);
      assert.equal(result.new_status, "quarantine");
      assert.equal(result.quarantine_bin_code, "QUAR-ZONE-01");

      // Verify in DB
      const db = getDb();
      const lot = db.prepare(`SELECT * FROM inventory_lots WHERE id = 'LOT-2026-SAL-082'`).get() as any;
      assert.equal(lot.quality_status, "quarantine");
      assert.equal(lot.quarantined_cases, lot.quantity_cases);

      // Verify audit record exists
      const audit = db.prepare(`SELECT * FROM audit_events WHERE entity_id = 'LOT-2026-SAL-082' AND action = 'QUARANTINE_LOT'`).get() as any;
      assert.ok(audit);
    });

    it("releases lot from quarantine back to available stock", () => {
      const result = releaseQuarantineLot(
        {
          lot_id: "LOT-2026-SAL-082",
          reason: "Laboratory microbiological test verified negative (Cert #LAB-8891)",
          target_bin_code: "CHILL-A1-01",
        },
        qaUser
      );

      assert.ok(result);
      assert.equal(result.new_status, "released");
      assert.equal(result.quarantined_cases, 0);

      const db = getDb();
      const lot = db.prepare(`SELECT * FROM inventory_lots WHERE id = 'LOT-2026-SAL-082'`).get() as any;
      assert.equal(lot.quality_status, "released");
      assert.equal(lot.quarantined_cases, 0);
      assert.ok(lot.quantity_cases > 0);
    });

    it("rejects unauthorized driver from executing quarantine actions", () => {
      assert.throws(
        () => quarantineLot({ lot_id: "LOT-2026-SAL-082", reason: "Unauthorized" }, driverUser),
        (err: any) => err.status === 403
      );
    });
  });

  // --------------------------------------------------------------------------
  // 5. QUALITY EXCEPTIONS TESTS
  // --------------------------------------------------------------------------
  describe("5. Quality Exceptions Management", () => {
    let createdExpId: string;

    it("creates a new quality exception with auto-quarantine option", () => {
      const exp = createException(
        {
          sku: "SKU-BUR-004",
          product_name: "Artisanal Burrata di Andria IGP",
          internal_lot: "LOT-2026-BUR-019",
          exception_type: "temperature_excursion",
          severity: "high",
          expected_limits: "2°C to 4°C",
          actual_reading: "6.2°C core probe",
          food_safety_impact: "Shortened shelf life, accelerated acidity development",
          containment_actions: "Isolated in cold buffer bay, temperature re-checked",
        },
        qaUser
      );

      assert.ok(exp);
      assert.ok(exp.exception_number.startsWith("EXP-"));
      assert.equal(exp.severity, "high");
      assert.equal(exp.status, "open");
      createdExpId = exp.id;
    });

    it("updates exception investigation notes and transitions status to resolved", () => {
      const updated = updateException(
        createdExpId,
        {
          status: "resolved",
          investigation_notes: "Secondary probe calibrated and reading normalized. Cold chain logger shows transient spike during door opening.",
          resolution: "Re-certified compliant. Stock released with priority dispatch.",
        },
        qaUser
      );

      assert.equal(updated.status, "resolved");
      assert.ok(updated.resolved_by);
      assert.ok(updated.resolved_at);
    });
  });

  // --------------------------------------------------------------------------
  // 6. PRODUCT RECALL LIFECYCLE TESTS
  // --------------------------------------------------------------------------
  describe("6. Product Recall Workflow & Safety Gates", () => {
    let recallId: string;

    it("initiates a Class 1 product recall and automatically discovers affected customers", () => {
      const recall = initiateRecall(
        {
          title: "Precautionary Listeria Recall - Atlantic Salmon",
          classification: "class_1",
          reason_category: "microbiological_contamination",
          risk_assessment: "Positive environmental swab on line 3 at supplier facility",
          affected_lot: "LOT-2026-SAL-082",
          target_recovery_date: "2026-03-25",
        },
        qaUser
      );

      assert.ok(recall);
      assert.ok(recall.recall_number.startsWith("RCL-"));
      assert.equal(recall.status, "draft");
      assert.ok(recall.affected_customers_count >= 1, "Delivered customers must be auto-populated");
      recallId = recall.id;
    });

    it("approves and activates recall by authorized management", () => {
      const approved = approveRecall(recallId, adminUser);
      assert.equal(approved.status, "active");
      assert.ok(approved.approved_by);
      assert.equal(approved.approved_by.name, "Elena Conti");
    });

    it("blocks non-management role (e.g. driver) from approving recalls", () => {
      assert.throws(
        () => approveRecall(recallId, driverUser),
        (err: any) => err.status === 403
      );
    });

    it("dispatches formal customer recall notification", () => {
      const recall = getRecall(recallId, qaUser);
      const targetCustomer = recall.affected_customers[0];
      assert.ok(targetCustomer);

      const notif = notifyRecallCustomer(
        recallId,
        targetCustomer.customer_id,
        { channel: "email" },
        qaUser
      );

      assert.ok(notif);
      assert.equal(notif.acknowledgment_status, "sent");
      assert.ok(notif.subject.includes("URGENT FOOD SAFETY RECALL"));
    });

    it("records customer returned goods recovery into quarantine cage", () => {
      const recall = getRecall(recallId, qaUser);
      const targetCustomer = recall.affected_customers[0];

      const log = recordRecallRecovery(
        recallId,
        {
          customer_id: targetCustomer.customer_id,
          recovered_cases: 5,
          recovered_weight_kg: 6.25,
          seal_number: "SEAL-QA-TEST-01",
          temp_c: 2.3,
          notes: "First reverse logistics collection batch",
        },
        qaUser
      );

      assert.ok(log);
      assert.equal(log.recovered_cases, 5);
      assert.equal(log.quarantine_bin_code, "QUAR-ZONE-01");

      // Verify recall aggregate was updated
      const updatedRecall = getRecall(recallId, qaUser);
      assert.ok(updatedRecall.recovered_cases >= 5);
    });

    it("blocks recall closure when linked CAPA is still open", () => {
      const db = getDb();
      // Ensure linked CAPA is in 'In Progress' state
      db.prepare(`UPDATE recalls SET capa_id = 'CAPA-2026-001' WHERE id = ?`).run(recallId);
      db.prepare(`UPDATE quality_capas SET status = 'In Progress' WHERE id = 'CAPA-2026-001'`).run();

      assert.throws(
        () => closeRecall(recallId, "Attempting closure with open CAPA", adminUser),
        (err: any) => err.status === 409 && err.code === "OPEN_CAPA_EXISTS"
      );
    });

    it("blocks recall closure when closure notes are empty or too brief", () => {
      assert.throws(
        () => closeRecall(recallId, "short", adminUser),
        (err: any) => err.status === 400 && err.code === "CLOSURE_JUSTIFICATION_REQUIRED"
      );
    });

    it("successfully closes recall after CAPA resolution and mass balance verification", () => {
      const db = getDb();
      // Close the linked CAPA
      db.prepare(`UPDATE quality_capas SET status = 'Closed' WHERE id = 'CAPA-2026-001'`).run();

      const closed = closeRecall(
        recallId,
        "All affected stock accounted for. Reverse logistics completed. Destruction certificate #DC-2026-901 archived. Health authority signed off.",
        adminUser
      );

      assert.equal(closed.status, "closed");
      assert.ok(closed.closed_by);
      assert.ok(closed.closed_at);
    });

    it("generates comprehensive regulatory recall report", () => {
      const report = generateFinalRecallReport(recallId, adminUser);
      assert.ok(report);
      assert.ok(report.report_reference.startsWith("REP-RCL-"));
      assert.ok(report.regulatory_compliance.framework.includes("178/2002"));
      assert.ok(report.customer_effectiveness.recovery_effectiveness_pct >= 0);
    });
  });

  // --------------------------------------------------------------------------
  // 7. REST API ENDPOINTS TESTS
  // --------------------------------------------------------------------------
  describe("7. Exceptions & Recall REST API Routes", () => {
    it("GET /api/v1/exceptions-recall/trace/forward returns forward traceability result", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/exceptions-recall/trace/forward?lot_id=LOT-2026-SAL-082", {
        headers: { Authorization: `Bearer ${qaToken}` },
      });
      const res = await getForwardTraceRoute(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.result);
      assert.equal(data.result.lot.internal_lot, "LOT-2026-SAL-082");
    });

    it("GET /api/v1/exceptions-recall/trace/backward returns backward traceability result", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/exceptions-recall/trace/backward?order_number=SO-2026-9841", {
        headers: { Authorization: `Bearer ${qaToken}` },
      });
      const res = await getBackwardTraceRoute(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.result);
      assert.equal(data.result.customer.name, "Ristorante Cracco Galleria");
    });

    it("GET /api/v1/exceptions-recall/mass-balance returns mass balance", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/exceptions-recall/mass-balance?lot_id=LOT-2026-SAL-082", {
        headers: { Authorization: `Bearer ${qaToken}` },
      });
      const res = await getMassBalanceRoute(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.mass_balance);
      assert.equal(data.mass_balance.lot_id, "LOT-2026-SAL-082");
    });

    it("GET /api/v1/exceptions-recall/exceptions lists non-conformances", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/exceptions-recall/exceptions", {
        headers: { Authorization: `Bearer ${qaToken}` },
      });
      const res = await getExceptionsRoute(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.exceptions));
    });

    it("GET /api/v1/exceptions-recall/recalls lists product recall cases", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/exceptions-recall/recalls", {
        headers: { Authorization: `Bearer ${qaToken}` },
      });
      const res = await getRecallsRoute(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.recalls));
      assert.ok(data.recalls.length >= 1);
    });

    it("POST /api/v1/exceptions-recall/quarantine applies quarantine hold via API", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/exceptions-recall/quarantine", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${qaToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "IDEMP-Q-TEST-001",
        },
        body: JSON.stringify({
          lot_id: "LOT-2026-BUR-019",
          reason: "Packaging micro-defect hold via REST API",
        }),
      });

      const res = await postQuarantineRoute(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.result);
      assert.equal(data.result.new_status, "quarantine");
    });
  });
});
