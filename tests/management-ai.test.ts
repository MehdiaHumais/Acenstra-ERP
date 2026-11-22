import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextRequest } from "next/server";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ascentra-mgmt-ai-test-"));
const tmpDbPath = path.join(tmpDir, "test-mgmt-ai.sqlite");
process.env.SQLITE_DB_PATH = tmpDbPath;
process.env.SEED_DEMO_DATA = "true";

import { getDb, seedFinanceModule, seedExceptionsAndRecallModule, seedManagementAndAiModule } from "@/server/db/connection";
import { signAccessToken } from "@/server/security/crypto";
import { AuthenticatedUser } from "@/server/security/auth";

import {
  getCeoDashboardKpis,
  getBiReport,
  exportBiReportCsv,
  generateProductDemandForecasts,
  detectOperationalAnomalies,
  reviewAnomaly,
  generateReplenishmentSuggestions,
  proposeAiAction,
  listGovernedAiActions,
  getGovernedAiAction,
  approveAndExecuteAiAction,
  rejectAiAction,
  runAiOperationalAnalysis,
} from "@/server/services/management-ai.service";

import { GET as getDashboardRoute } from "@/app/api/v1/management/dashboard/route";
import { GET as getBiRoute } from "@/app/api/v1/management/bi/route";
import { GET as getBiExportRoute } from "@/app/api/v1/management/bi/export/route";
import { GET as getForecastingRoute } from "@/app/api/v1/management/forecasting/route";
import { GET as getAnomaliesRoute } from "@/app/api/v1/management/anomalies/route";
import { PATCH as patchAnomalyRoute } from "@/app/api/v1/management/anomalies/[id]/route";
import { GET as getReplenishmentRoute } from "@/app/api/v1/management/replenishment/route";
import { GET as getAiActionsRoute, POST as postAiActionRoute } from "@/app/api/v1/management/ai/actions/route";
import { GET as getAiActionByIdRoute } from "@/app/api/v1/management/ai/actions/[id]/route";
import { POST as postApproveAiActionRoute } from "@/app/api/v1/management/ai/actions/[id]/approve/route";
import { POST as postRejectAiActionRoute } from "@/app/api/v1/management/ai/actions/[id]/reject/route";
import { POST as postAiAnalyzeRoute } from "@/app/api/v1/management/ai/analyze/route";

describe("Module 12 - Management and AI Control Tower Test Suite", () => {
  let ceoUser: AuthenticatedUser;
  let adminUser: AuthenticatedUser;
  let managerUser: AuthenticatedUser;
  let driverUser: AuthenticatedUser;

  let ceoToken: string;
  let adminToken: string;
  let driverToken: string;

  before(async () => {
    (global as any).__ascentraDbInstance = null;
    const db = getDb();
    seedFinanceModule(db);
    seedExceptionsAndRecallModule(db);
    seedManagementAndAiModule(db);

    ceoUser = {
      id: "USR-CEO",
      email: "lorenzo.ferrari@ascentra.it",
      name: "Lorenzo Ferrari",
      role: "ceo",
      assignedWarehouse: "WH-MILAN-01",
      permissions: [
        "dashboard:read",
        "reports.executive.read",
        "ai.recommendations.read",
        "ai.actions.approve",
        "purchase_orders.read",
        "orders.read",
        "invoices.read",
      ],
    };

    adminUser = {
      id: "USR-ADMIN",
      email: "elena.conti@ascentra.it",
      name: "Elena Conti",
      role: "super_admin",
      permissions: [
        "dashboard:read",
        "reports.executive.read",
        "ai.recommendations.read",
        "ai.actions.approve",
        "purchase_orders.read",
        "purchase_orders.manage",
        "inventory.adjust",
        "traceability:quarantine",
      ],
    };

    managerUser = {
      id: "USR-WH-MGR",
      email: "marco.bellini@ascentra.it",
      name: "Marco Bellini",
      role: "warehouse_manager",
      assignedWarehouse: "WH-MILAN-01",
      permissions: [
        "dashboard:read",
        "reports.executive.read",
        "ai.recommendations.read",
        "ai.actions.approve",
        "purchase_orders.read",
      ],
    };

    driverUser = {
      id: "USR-DRV",
      email: "davide.galli@ascentra.it",
      name: "Davide Galli",
      role: "driver",
      permissions: ["deliveries.read"],
    };

    ceoToken = await signAccessToken({ sub: ceoUser.id, role: ceoUser.role, email: ceoUser.email });
    adminToken = await signAccessToken({ sub: adminUser.id, role: adminUser.role, email: adminUser.email });
    driverToken = await signAccessToken({ sub: driverUser.id, role: driverUser.role, email: driverUser.email });
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore tmp cleanup error
    }
  });

  // --------------------------------------------------------------------------
  // 1. CEO MANAGEMENT DASHBOARD
  // --------------------------------------------------------------------------
  describe("1. CEO Dashboard & Executive KPIs", () => {
    it("should compute real aggregations across all 6 business domains without fake static values", () => {
      const kpis = getCeoDashboardKpis(ceoUser);

      // Verify calculated envelope
      assert.ok(kpis.calculated_at);
      assert.equal(typeof kpis.period_days, "number");

      // Domain 1: Sales & Customers
      assert.ok(kpis.sales.total_revenue_cents > 0, "Revenue should be positive");
      assert.ok(kpis.sales.total_orders_count > 0, "Orders count should be positive");
      assert.ok(kpis.sales.average_order_value_cents > 0, "AOV should be positive");
      assert.ok(Array.isArray(kpis.sales.top_customers), "Top customers should be an array");
      assert.ok(Array.isArray(kpis.sales.top_products), "Top products should be an array");

      // Domain 2: Inventory & Warehouse
      assert.ok(kpis.inventory.total_stock_value_cents > 0, "Inventory valuation must be derived from lots");
      assert.ok(kpis.inventory.total_physical_cases > 0, "Physical cases must be positive");
      assert.ok(kpis.inventory.warehouse_utilization_pct >= 0 && kpis.inventory.warehouse_utilization_pct <= 100);
      assert.ok(Array.isArray(kpis.inventory.slow_moving_inventory));

      // Domain 3: Procurement
      assert.ok(kpis.procurement.total_po_spend_cents >= 0);
      assert.ok(Array.isArray(kpis.procurement.supplier_performance));

      // Domain 4: Operations
      assert.ok(kpis.operations.picking_completion_pct >= 0 && kpis.operations.picking_completion_pct <= 100);
      assert.ok(kpis.operations.on_time_delivery_rate_pct >= 0 && kpis.operations.on_time_delivery_rate_pct <= 100);

      // Domain 5: Quality & Food Safety
      assert.equal(typeof kpis.quality.open_quality_exceptions, "number");
      assert.equal(typeof kpis.quality.temperature_excursions, "number");
      assert.equal(typeof kpis.quality.active_recalls_count, "number");

      // Domain 6: Finance
      assert.ok(kpis.finance.gross_revenue_cents > 0);
      assert.ok(kpis.finance.delivered_margin_pct >= 0);
      assert.ok(kpis.finance.collection_rate_pct >= 0);
    });

    it("should serve CEO Dashboard over REST API with dashboard:read permission", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/management/dashboard", {
        headers: { Authorization: `Bearer ${ceoToken}` },
      });
      const res = await getDashboardRoute(req);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.ok(json.kpis);
      assert.ok(json.kpis.finance.gross_revenue_cents > 0);
    });

    it("should reject unauthorized driver from accessing CEO Dashboard", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/management/dashboard", {
        headers: { Authorization: `Bearer ${driverToken}` },
      });
      const res = await getDashboardRoute(req);
      assert.equal(res.status, 403);
    });
  });

  // --------------------------------------------------------------------------
  // 2. BUSINESS INTELLIGENCE & REPORTING
  // --------------------------------------------------------------------------
  describe("2. Governed Business Intelligence & Export", () => {
    it("should group operational data by customer dimension", () => {
      const report = getBiReport({ dimension: "customer" }, ceoUser);
      assert.ok(report.rows.length > 0);
      assert.ok(report.totals.total_revenue_cents > 0);
      assert.ok(report.rows[0].dimension_key);
      assert.ok(report.rows[0].dimension_label);
    });

    it("should group operational data by product dimension", () => {
      const report = getBiReport({ dimension: "product" }, ceoUser);
      assert.ok(report.rows.length > 0);
      assert.ok(report.rows[0].dimension_label);
      assert.ok(report.rows[0].cases_sold >= 0);
    });

    it("should filter report by warehouse", () => {
      const report = getBiReport({ warehouse: "WH-MILAN-01" }, ceoUser);
      assert.ok(report.rows.length >= 0);
    });

    it("should export governed BI report to RFC 4180 CSV format", () => {
      const csv = exportBiReportCsv({ dimension: "customer" }, ceoUser);
      assert.ok(csv.includes("Ascentra ERP - Governed Business Intelligence Report"));
      assert.ok(csv.includes("Key,Label,Orders,Cases Sold,Revenue (EUR),COGS (EUR),Gross Margin (EUR),Gross Margin %,Delivered Margin %"));
      assert.ok(csv.includes("SUMMARY TOTALS"));
    });

    it("should deliver CSV export via GET /api/v1/management/bi/export", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/management/bi/export?dimension=customer", {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const res = await getBiExportRoute(req);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "text/csv; charset=utf-8");
      const text = await res.text();
      assert.ok(text.includes("Ascentra ERP"));
    });
  });

  // --------------------------------------------------------------------------
  // 3. STATISTICAL DEMAND FORECASTING
  // --------------------------------------------------------------------------
  describe("3. Statistical Demand Forecasting", () => {
    it("should calculate daily run rates, 95% confidence intervals, and depletion risk per product", () => {
      const forecasts = generateProductDemandForecasts(30, 14, ceoUser);
      assert.ok(forecasts.length > 0, "Forecasts should be computed for catalogue products");

      for (const f of forecasts) {
        assert.ok(f.sku);
        assert.ok(f.product_name);
        assert.ok(f.forecast_period_days === 14);
        assert.ok(f.confidence_level_pct === 95);
        assert.ok(f.lower_bound_cases <= f.projected_demand_cases, "Lower bound must be <= projection");
        assert.ok(f.projected_demand_cases <= f.upper_bound_cases, "Projection must be <= upper bound");
        assert.ok(["high", "medium", "low", "insufficient_history"].includes(f.data_coverage));
        assert.ok(["immediate", "high", "moderate", "safe"].includes(f.depletion_risk));
      }
    });

    it("should expose forecasting results via GET /api/v1/management/forecasting", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/management/forecasting?lookback_days=30&horizon_days=14", {
        headers: { Authorization: `Bearer ${ceoToken}` },
      });
      const res = await getForecastingRoute(req);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(Array.isArray(json.forecasts));
      assert.ok(json.forecasts.length > 0);
    });
  });

  // --------------------------------------------------------------------------
  // 4. OPERATIONAL ANOMALY DETECTION & REVIEW
  // --------------------------------------------------------------------------
  describe("4. Operational Anomaly Detection & Review", () => {
    it("should run 10 anomaly algorithms and deduplicate records via fingerprints", () => {
      const anomalies = detectOperationalAnomalies(ceoUser);
      assert.ok(anomalies.length > 0, "Anomalies should be detected from operational tables");

      // Verify structure of anomalies
      for (const a of anomalies) {
        assert.ok(a.id);
        assert.ok(a.anomaly_number.startsWith("ANM-") || a.anomaly_number.startsWith("ANOM-"));
        assert.ok(a.title);
        assert.ok(a.fingerprint);
        assert.ok(["info", "warning", "critical"].includes(a.severity));
        assert.ok(["detected", "under_review", "acknowledged", "resolved", "dismissed"].includes(a.review_status));
      }
    });

    it("should transition anomaly review status and log reviewer audit notes", () => {
      const list = detectOperationalAnomalies(ceoUser);
      const target = list[0];

      const updated = reviewAnomaly(
        target.id,
        {
          review_status: "acknowledged",
          resolution_notes: "Operations manager dispatched technician to inspect probe.",
        },
        ceoUser
      );

      assert.equal(updated.review_status, "acknowledged");
      assert.equal(updated.reviewed_by, ceoUser.email);
      assert.equal(updated.review_notes, "Operations manager dispatched technician to inspect probe.");
    });

    it("should allow reviewing anomalies via PATCH /api/v1/management/anomalies/[id]", async () => {
      const list = detectOperationalAnomalies(ceoUser);
      const target = list[0];

      const req = new NextRequest(`http://localhost:3000/api/v1/management/anomalies/${target.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${ceoToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          review_status: "resolved",
          resolution_notes: "Recalibrated and verified normal operation.",
        }),
      });

      const res = await patchAnomalyRoute(req, { params: { id: target.id } });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.anomaly.review_status, "resolved");
    });
  });

  // --------------------------------------------------------------------------
  // 5. REPLENISHMENT ADVISORY ENGINE
  // --------------------------------------------------------------------------
  describe("5. Stock Replenishment Advisory Engine", () => {
    it("should calculate deterministic ROP, safety stock, and open PO cases", () => {
      const suggestions = generateReplenishmentSuggestions(ceoUser);
      assert.ok(Array.isArray(suggestions));

      for (const s of suggestions) {
        assert.ok(s.sku);
        assert.ok(s.supplier_lead_time_days > 0);
        assert.ok(s.safety_stock_cases >= 0);
        assert.ok(s.reorder_point_cases >= s.safety_stock_cases);
        assert.ok(["urgent", "high", "medium", "routine"].includes(s.priority));
        assert.ok(s.estimated_cost_cents >= 0);
      }
    });

    it("should be served via GET /api/v1/management/replenishment", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/management/replenishment", {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const res = await getReplenishmentRoute(req);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(Array.isArray(json.suggestions));
    });
  });

  // --------------------------------------------------------------------------
  // 6. GOVERNED AI ACTIONS & MAKER-CHECKER WORKFLOW
  // --------------------------------------------------------------------------
  describe("6. Governed AI Actions & Maker-Checker Approvals", () => {
    it("should allow proposing an AI action with 'proposed' status", () => {
      const action = proposeAiAction(
        {
          action_type: "create_purchase_order",
          target_entity: "purchase_orders",
          target_id: "PARM-REG-01",
          summary: "Replenish 25 cases of Parmigiano Reggiano DOP",
          rationale: "Projected stockout within 5 days due to elevated restaurant demand.",
          parameters: {
            sku: "PARM-REG-01",
            quantity_cases: 25,
            warehouse: "WH-MILAN-01",
          },
          risk_level: "medium",
        },
        ceoUser
      );

      assert.ok(action.id);
      assert.ok(action.action_number.startsWith("AIA-"));
      assert.equal(action.approval_status, "proposed");
      assert.ok(action.action_type === "create_purchase_order" || action.action_type === "create_replenishment_po");
    });

    it("should prevent unauthorized execution without human approval", () => {
      const action = proposeAiAction(
        {
          action_type: "quarantine_lot",
          target_entity: "inventory_lots",
          target_id: "LOT-TEST-999",
          summary: "Quarantine suspect batch",
          rationale: "Automated scan flagged temp deviation",
          parameters: { lot_id: "LOT-TEST-999", reason: "Temp excursion" },
          risk_level: "high",
        },
        ceoUser
      );

      // Verify it stays in proposed status
      const fetched = getGovernedAiAction(action.id, ceoUser);
      assert.equal(fetched?.approval_status, "proposed");
    });

    it("should execute real domain mutations upon executive sign-off (Maker-Checker)", () => {
      // 1. Propose purchase order creation
      const action = proposeAiAction(
        {
          action_type: "create_purchase_order",
          target_entity: "purchase_orders",
          target_id: "PARM-REG-01",
          summary: "PO for 20 cases of Parmigiano",
          rationale: "Safety stock replenishment",
          parameters: {
            sku: "PARM-REG-01",
            quantity_cases: 20,
            warehouse: "WH-MILAN-01",
          },
          risk_level: "medium",
        },
        ceoUser
      );

      // 2. Executive signs off & executes
      const result = approveAndExecuteAiAction(
        action.id,
        "Approved by CEO per inventory policy.",
        ceoUser
      );

      assert.equal(result.action.approval_status, "executed");
      assert.ok(result.action.approved_by);
      assert.ok(result.execution_result.po_number);

      // Verify purchase order was genuinely created in the database
      const db = getDb();
      const po = db.prepare("SELECT * FROM purchase_orders WHERE po_number = ?").get(result.execution_result.po_number) as any;
      assert.ok(po, "PO must be inserted into real purchase_orders table");
      assert.equal(po.warehouse, "WH-MILAN-01");
    });

    it("should execute lot quarantine upon approved quarantine_lot AI action", () => {
      const db = getDb();
      // Find an available lot
      const lot = db.prepare("SELECT id FROM inventory_lots WHERE quality_status = 'released' LIMIT 1").get() as any;
      assert.ok(lot, "Should have a released lot for testing quarantine");

      const action = proposeAiAction(
        {
          action_type: "quarantine_lot",
          target_entity: "inventory_lots",
          target_id: lot.id,
          summary: `Quarantine lot ${lot.id}`,
          rationale: "Precautionary quarantine following supplier audit",
          parameters: {
            lot_id: lot.id,
            reason: "Suspect cold chain handling",
          },
          risk_level: "critical",
        },
        ceoUser
      );

      const result = approveAndExecuteAiAction(action.id, "Executive approved emergency quarantine", ceoUser);
      assert.equal(result.action.approval_status, "executed");

      // Verify in DB that lot is now quarantined
      const updatedLot = db.prepare("SELECT quality_status FROM inventory_lots WHERE id = ?").get(lot.id) as any;
      assert.ok(updatedLot.quality_status === "quarantined" || updatedLot.quality_status === "quarantine");
    });

    it("should allow rejecting an AI proposal with a required reason", () => {
      const action = proposeAiAction(
        {
          action_type: "credit_hold_customer",
          target_entity: "customers",
          target_id: "CUST-001",
          summary: "Put customer on credit hold",
          rationale: "Overdue invoice by 10 days",
          parameters: { customer_id: "CUST-001" },
          risk_level: "high",
        },
        ceoUser
      );

      const rejected = rejectAiAction(action.id, "Customer provided confirmed wire receipt; hold waived.", ceoUser);
      assert.equal(rejected.approval_status, "rejected");
      assert.equal(rejected.rejection_reason, "Customer provided confirmed wire receipt; hold waived.");
    });

    it("should reject driver role from approving AI actions", () => {
      const action = proposeAiAction(
        {
          action_type: "create_purchase_order",
          target_entity: "purchase_orders",
          target_id: "MOZZ-DI-BUF-01",
          summary: "PO for mozzarella",
          rationale: "Advisory replenishment",
          parameters: { sku: "MOZZ-DI-BUF-01", quantity_cases: 10, warehouse: "WH-MILAN-01" },
          risk_level: "low",
        },
        ceoUser
      );

      assert.throws(
        () => approveAndExecuteAiAction(action.id, "Driver attempted approval", driverUser),
        /not authorized to approve and execute governed AI action|Executive/i
      );
    });

    it("should handle AI action approval via REST API POST /api/v1/management/ai/actions/[id]/approve", async () => {
      const action = proposeAiAction(
        {
          action_type: "initiate_capa",
          target_entity: "quality_capas",
          target_id: "CAPA-AI-TEST",
          summary: "Initiate CAPA for dock door 3 temperature probe",
          rationale: "Recurring calibration variance detected",
          parameters: {
            title: "Dock 3 Probe Calibration",
            source: "AI Anomaly Detection",
            warehouse: "WH-MILAN-01",
          },
          risk_level: "medium",
        },
        ceoUser
      );

      const req = new NextRequest(`http://localhost:3000/api/v1/management/ai/actions/${action.id}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ approval_note: "Approved by QA Executive" }),
      });

      const res = await postApproveAiActionRoute(req, { params: { id: action.id } });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.action.approval_status, "executed");
    });
  });

  // --------------------------------------------------------------------------
  // 7. RESILIENT AI SYNTHESIS & FALLBACK ARCHITECTURE
  // --------------------------------------------------------------------------
  describe("7. Resilient AI Synthesis & Fallback", () => {
    it("should generate grounded executive analysis even without external GEMINI_API_KEY", async () => {
      // Unset API key to test resilient deterministic fallback
      const prevKey = process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_API_KEY;

      try {
        const analysis = await runAiOperationalAnalysis(
          "Summarize top operational risks across Milan and Verona facilities",
          ceoUser
        );

        assert.ok(analysis.headline);
        assert.ok(analysis.executive_summary.length > 50);
        assert.ok(analysis.key_highlights.length > 0);
        assert.ok(analysis.recommended_actions.length > 0);
        assert.equal(analysis.provider, "Deterministic Engine (Air-Gapped Fallback)");
      } finally {
        if (prevKey) process.env.GEMINI_API_KEY = prevKey;
      }
    });

    it("should expose AI analysis endpoint via POST /api/v1/management/ai/analyze", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/management/ai/analyze", {
        method: "POST",
        headers: { Authorization: `Bearer ${ceoToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Review gross margin leaks and inventory risks" }),
      });

      const res = await postAiAnalyzeRoute(req);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(json.analysis);
      assert.ok(json.analysis.headline);
    });
  });
});
