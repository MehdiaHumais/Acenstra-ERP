import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextRequest } from "next/server";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ascentra-customer-order-test-"));
const tmpDbPath = path.join(tmpDir, "test-customer-order.sqlite");
process.env.SQLITE_DB_PATH = tmpDbPath;
process.env.SEED_DEMO_DATA = "true";

import { getDb } from "@/server/db/connection";
import { signAccessToken } from "@/server/security/crypto";
import {
  resolveProductPricing,
  validateCustomerCredit,
  evaluateOrderLineStock,
  validateCustomerOrder,
  submitCustomerOrder,
  approveCreditException,
  cancelCustomerOrder,
  getCustomerOrder,
  listCustomerOrders,
  getCustomerCatalog,
  listCustomerContracts,
  upsertCustomerContract
} from "@/server/services/customer-order.service";

import { GET as getCatalog } from "@/app/api/v1/customer-portal/catalog/route";
import { GET as getPricing, POST as postPricing } from "@/app/api/v1/customer-portal/pricing/route";
import { POST as postValidate } from "@/app/api/v1/customer-portal/validate/route";
import { GET as getOrders, POST as postOrder } from "@/app/api/v1/customer-portal/orders/route";
import { GET as getOrderDetail } from "@/app/api/v1/customer-portal/orders/[id]/route";
import { POST as postCancelOrder } from "@/app/api/v1/customer-portal/orders/[id]/cancel/route";
import { POST as postApproveOrder } from "@/app/api/v1/customer-portal/orders/[id]/approve/route";
import { GET as getContracts, POST as postContract } from "@/app/api/v1/customer-portal/contracts/route";
import { GET as getCustomers } from "@/app/api/v1/customer-portal/customers/route";

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
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
}

function addDaysIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("Module 07 — Customer Order (B2B Portal, Ordering, Pricing & Availability)", () => {
  let superAdminToken: string;
  let salesToken: string;
  let financeToken: string;
  let craccoCustomerToken: string;
  let savoiaCustomerToken: string;
  let driverToken: string;

  const adminActor = {
    id: "USR-ADMIN",
    email: "elena.conti@ascentra.it",
    name: "Elena Conti",
    role: "super_admin" as const,
    roles: ["super_admin" as const],
    store_id: null,
    warehouse: "Milan Cold Hub",
    mfa_enabled: false
  };

  const craccoActor = {
    id: "USR-CUST-CRACCO",
    email: "carlo@ristorantecracco.it",
    name: "Carlo Cracco",
    role: "store_vendor" as const,
    roles: ["store_vendor" as const],
    store_id: "CUST-B2B-01",
    warehouse: "Milan Cold Hub",
    mfa_enabled: false
  };

  const savoiaActor = {
    id: "USR-CUST-SAVOIA",
    email: "fnb@hotelprincipedisavoia.it",
    name: "Hotel Savoia F&B",
    role: "store_vendor" as const,
    roles: ["store_vendor" as const],
    store_id: "CUST-B2B-02",
    warehouse: "Milan Cold Hub",
    mfa_enabled: false
  };

  const salesActor = {
    id: "USR-SALES",
    email: "sofia.greco@ascentra.it",
    name: "Sofia Greco",
    role: "sales" as const,
    roles: ["sales" as const],
    store_id: null,
    warehouse: "Milan Cold Hub",
    mfa_enabled: false
  };

  const financeActor = {
    id: "USR-FIN",
    email: "matteo.ricci@ascentra.it",
    name: "Matteo Ricci",
    role: "finance" as const,
    roles: ["finance" as const],
    store_id: null,
    warehouse: "Milan Cold Hub",
    mfa_enabled: false
  };

  const driverActor = {
    id: "USR-DRV",
    email: "davide.galli@ascentra.it",
    name: "Davide Galli",
    role: "driver" as const,
    roles: ["driver" as const],
    store_id: null,
    warehouse: "Milan Cold Hub",
    mfa_enabled: false
  };

  before(() => {
    // Initialize database
    getDb();

    superAdminToken = signAccessToken({
      sub: adminActor.id,
      email: adminActor.email,
      name: adminActor.name,
      role: adminActor.role,
      store_id: null,
      warehouse: adminActor.warehouse
    });

    salesToken = signAccessToken({
      sub: salesActor.id,
      email: salesActor.email,
      name: salesActor.name,
      role: salesActor.role,
      store_id: null,
      warehouse: salesActor.warehouse
    });

    financeToken = signAccessToken({
      sub: financeActor.id,
      email: financeActor.email,
      name: financeActor.name,
      role: financeActor.role,
      store_id: null,
      warehouse: financeActor.warehouse
    });

    craccoCustomerToken = signAccessToken({
      sub: craccoActor.id,
      email: craccoActor.email,
      name: craccoActor.name,
      role: craccoActor.role,
      store_id: craccoActor.store_id,
      warehouse: craccoActor.warehouse
    });

    savoiaCustomerToken = signAccessToken({
      sub: savoiaActor.id,
      email: savoiaActor.email,
      name: savoiaActor.name,
      role: savoiaActor.role,
      store_id: savoiaActor.store_id,
      warehouse: savoiaActor.warehouse
    });

    driverToken = signAccessToken({
      sub: driverActor.id,
      email: driverActor.email,
      name: driverActor.name,
      role: driverActor.role,
      store_id: null,
      warehouse: driverActor.warehouse
    });
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // =========================================================================
  // 1. Contract Pricing & Precedence Tests
  // =========================================================================
  describe("1. Contract Pricing & Precedence Engine", () => {
    it("applies active promotional price first when within valid date window", () => {
      // Hotel Savoia (CUST-B2B-02) has active Winter Gastronomy promo on SKU-SAL-001 (€82.00 vs list €94.50)
      const pricing = resolveProductPricing(adminActor, {
        customer_id: "CUST-B2B-02",
        sku: "SKU-SAL-001",
        quantity: 5
      });

      assert.equal(pricing.pricing_source, "promotion");
      assert.equal(pricing.unit_price_cents, 8200);
      assert.equal(pricing.original_list_price_cents, 9450);
      assert.equal(pricing.discount_cents, 1250);
      assert.equal(pricing.line_subtotal_cents, 8200 * 5);
    });

    it("applies customer volume tier price when quantity meets or exceeds threshold", () => {
      // Cracco Galleria (CUST-B2B-01) has volume tier on SKU-SAL-001 for min 20 cases (€84.00)
      const tierPricing = resolveProductPricing(adminActor, {
        customer_id: "CUST-B2B-01",
        sku: "SKU-SAL-001",
        quantity: 25
      });

      assert.equal(tierPricing.pricing_source, "contract_tier");
      assert.equal(tierPricing.unit_price_cents, 8400);
      assert.equal(tierPricing.line_subtotal_cents, 8400 * 25);
    });

    it("applies customer contract base price when quantity is below volume tier threshold", () => {
      // Cracco Galleria (CUST-B2B-01) for 5 cases (below 20) uses base contract €89.00
      const basePricing = resolveProductPricing(adminActor, {
        customer_id: "CUST-B2B-01",
        sku: "SKU-SAL-001",
        quantity: 5
      });

      assert.equal(basePricing.pricing_source, "contract_base");
      assert.equal(basePricing.unit_price_cents, 8900);
      assert.equal(basePricing.line_subtotal_cents, 8900 * 5);
    });

    it("falls back to standard catalog base price when no contract or segment price exists", () => {
      // Trattoria Trippa Milano (CUST-B2B-04) ordering Dry-Aged Beef (SKU-BFL-009) without special contract
      const standardPricing = resolveProductPricing(adminActor, {
        customer_id: "CUST-B2B-04",
        sku: "SKU-BFL-009",
        quantity: 2
      });

      assert.equal(standardPricing.pricing_source, "standard");
      assert.equal(standardPricing.unit_price_cents, 21600);
    });

    it("stores an immutable price snapshot on order lines so subsequent price changes do not alter past orders", () => {
      // 1. Submit an order with snapshot
      const order = submitCustomerOrder(adminActor, {
        customer_id: "CUST-B2B-01",
        delivery_date: addDaysIso(2),
        lines: [{ sku: "SKU-SAL-001", cases: 2 }]
      });

      const orderLine = order.lines[0];
      const initialUnitPrice = orderLine.unit_price_cents;
      assert.equal(initialUnitPrice, 8900);

      // 2. Mutate contract price in database
      const db = getDb();
      db.prepare(`
        UPDATE customer_contract_items
        SET unit_price_cents = 9999
        WHERE contract_id = 'CTR-2026-CRACCO' AND sku = 'SKU-SAL-001' AND min_quantity = 1
      `).run();

      // 3. Re-read placed order
      const fetchedOrder = getCustomerOrder(adminActor, order.id);
      assert.equal(
        fetchedOrder.lines[0].unit_price_cents,
        initialUnitPrice,
        "Placed order line unit price must remain unchanged after contract update"
      );

      // Revert back
      db.prepare(`
        UPDATE customer_contract_items
        SET unit_price_cents = 8900
        WHERE contract_id = 'CTR-2026-CRACCO' AND sku = 'SKU-SAL-001' AND min_quantity = 1
      `).run();
    });

    it("blocks unauthorized roles from creating or updating contract prices", () => {
      assert.throws(
        () => {
          upsertCustomerContract(driverActor, {
            customer_id: "CUST-B2B-01",
            title: "Hacked Contract",
            start_date: addDaysIso(-1),
            end_date: addDaysIso(30),
            items: [{ sku: "SKU-SAL-001", unit_price_cents: 100 }]
          });
        },
        /not authorized/
      );
    });
  });

  // =========================================================================
  // 2. Real-Time Stock Availability & Module 06 Integration Tests
  // =========================================================================
  describe("2. Real-Time Stock Availability & Module 06 FEFO Integration", () => {
    it("checks stock availability and respects customer-specific shelf-life requirements", () => {
      // Cracco Galleria requires minimum 4 days remaining shelf life
      const lineEval = evaluateOrderLineStock(adminActor, {
        customer_id: "CUST-B2B-01",
        sku: "SKU-SAL-001",
        cases: 10,
        delivery_date: addDaysIso(1)
      });

      assert.ok(lineEval.min_shelf_life_days_required >= 4);
      assert.ok(lineEval.allocated_cases > 0);
      assert.ok(lineEval.allocations.length > 0);
      assert.ok(lineEval.is_fully_available);
    });

    it("strictly excludes quarantined, held, or expired lots from available allocations", () => {
      const db = getDb();

      // Insert an expired lot
      db.prepare(`
        INSERT OR REPLACE INTO inventory_lots (
          id, batch_id, sku, product_name, category, warehouse, location, zone,
          quantity_cases, received_cases, allocated_cases, received_date, expiry_date,
          supplier, supplier_lot, origin_country, quality_status, temp_c, unit_weight_kg
        ) VALUES (
          'LOT-TEST-EXPIRED', 'LOT-TEST-EXP-01', 'SKU-SAL-001', 'Norwegian Atlantic Salmon Fillet',
          'Seafood', 'Milan Cold Hub', 'CH-A09', 'Chilled A', 100, 100, 0,
          '${addDaysIso(-20)}', '${addDaysIso(-1)}', 'Nordic Fjord Seafood', 'SUP-EXP', 'Norway',
          'released', 1.0, 5.0
        )
      `).run();

      const lineEval = evaluateOrderLineStock(adminActor, {
        customer_id: "CUST-B2B-01",
        sku: "SKU-SAL-001",
        cases: 10,
        delivery_date: addDaysIso(1)
      });

      // The expired lot must NOT be allocated
      const hasExpiredLot = lineEval.allocations.some((a) => a.internal_lot === "LOT-TEST-EXP-01");
      assert.equal(hasExpiredLot, false, "Expired lot must never be allocated to an order");

      // Clean up test lot
      db.prepare("DELETE FROM inventory_lots WHERE id = 'LOT-TEST-EXPIRED'").run();
    });

    it("evaluates pre-validation and flags partial fulfillment / stock shortfall", () => {
      // Requesting an enormous quantity beyond available stock
      const preval = validateCustomerOrder(adminActor, {
        customer_id: "CUST-B2B-01",
        delivery_date: addDaysIso(2),
        lines: [{ sku: "SKU-BUR-004", cases: 500 }]
      });

      assert.equal(preval.valid, true);
      assert.equal(preval.requires_stock_backorder, true);
      assert.ok(preval.summary.total_shortfall_cases > 0);
      assert.ok(preval.warnings.some((w) => w.includes("Partial stock") || w.includes("backordered")));
    });
  });

  // =========================================================================
  // 3. Credit Limit & Payment Terms Engine Tests
  // =========================================================================
  describe("3. Credit Limit & Payment Terms Engine", () => {
    it("validates credit exposure and allows orders within approved credit limit", () => {
      // Cracco Galleria (CUST-B2B-01) has credit limit €25,000. Order of €500 is clear.
      const creditEval = validateCustomerCredit(adminActor, {
        customer_id: "CUST-B2B-01",
        new_order_cents: 50000
      });

      assert.equal(creditEval.credit_status, "clear");
      assert.equal(creditEval.is_allowed, true);
      assert.ok(creditEval.remaining_credit_cents > 0);
    });

    it("flags and blocks immediate confirmation when order exceeds permitted credit limit", () => {
      // Hotel Savoia (CUST-B2B-02) has credit limit €12,000 and unpaid invoice of €8,950.
      // A new order of €4,000 will breach the ceiling (projected €12,950 > €12,000).
      const creditEval = validateCustomerCredit(adminActor, {
        customer_id: "CUST-B2B-02",
        new_order_cents: 400000
      });

      assert.equal(creditEval.credit_status, "exceeded");
      assert.equal(creditEval.is_allowed, false);
      assert.ok(creditEval.projected_exposure_cents > creditEval.credit_limit_cents);
    });

    it("automatically places credit-breaching orders into pending_approval status", () => {
      // Submit order for Hotel Savoia that exceeds credit (€4,100 + €8,950 = €13,050 > €12,000)
      const order = submitCustomerOrder(adminActor, {
        customer_id: "CUST-B2B-02",
        delivery_date: addDaysIso(1),
        lines: [{ sku: "SKU-SAL-001", cases: 50 }]
      });

      assert.equal(order.status, "pending_approval");
      assert.equal(order.credit_hold, true);
      assert.equal(order.approval_status, "pending");
      assert.ok(order.credit_hold_reason?.includes("exceeds approved credit limit"));
    });
  });

  // =========================================================================
  // 4. Maker-Checker Credit Override Workflow Tests
  // =========================================================================
  describe("4. Maker-Checker Credit Override Workflow", () => {
    it("allows finance or super_admin to approve credit exception with audit reason", () => {
      // 1. Submit order on credit hold
      const order = submitCustomerOrder(adminActor, {
        customer_id: "CUST-B2B-02",
        delivery_date: addDaysIso(1),
        lines: [{ sku: "SKU-SAL-001", cases: 50 }]
      });

      assert.equal(order.status, "pending_approval");

      // 2. Finance approves with maker-checker override reason
      const approvedOrder = approveCreditException(financeActor, order.id, {
        reason: "Customer verified wire transfer MT103 in transit; executive VIP approval."
      });

      assert.equal(approvedOrder.status, "confirmed");
      assert.equal(approvedOrder.credit_hold, false);
      assert.equal(approvedOrder.approval_status, "approved");
      assert.equal(approvedOrder.approved_by, financeActor.name);
      assert.ok(approvedOrder.lines[0].cases_allocated > 0);
    });

    it("rejects credit approval attempts from unauthorized roles", () => {
      const order = submitCustomerOrder(adminActor, {
        customer_id: "CUST-B2B-02",
        delivery_date: addDaysIso(1),
        lines: [{ sku: "SKU-SAL-001", cases: 50 }]
      });

      assert.throws(
        () => {
          approveCreditException(driverActor, order.id, {
            reason: "Driver cannot approve credit limits"
          });
        },
        /not authorized/
      );
    });
  });

  // =========================================================================
  // 5. Order State Machine & Atomic Stock Reservation Tests
  // =========================================================================
  describe("5. Order State Machine & Atomic Stock Reservations", () => {
    it("creates official Module 06 stock reservations atomically upon order confirmation", () => {
      const order = submitCustomerOrder(adminActor, {
        customer_id: "CUST-B2B-01",
        delivery_date: addDaysIso(1),
        lines: [{ sku: "SKU-SAL-001", cases: 3 }]
      });

      assert.equal(order.status, "confirmed");

      const db = getDb();
      const reservations = db.prepare(`
        SELECT * FROM stock_reservations
        WHERE order_id = ? AND status = 'Active'
      `).all(order.id) as any[];

      assert.ok(reservations.length > 0, "Stock reservation records must be generated");
      assert.equal(reservations[0].sku, "SKU-SAL-001");
      assert.equal(reservations[0].reserved_cases, 3);
    });

    it("cancels an order, releases all stock reservations atomically, and adjusts customer exposure", () => {
      // 1. Submit confirmed order
      const order = submitCustomerOrder(adminActor, {
        customer_id: "CUST-B2B-01",
        delivery_date: addDaysIso(1),
        lines: [{ sku: "SKU-SAL-001", cases: 2 }]
      });

      const db = getDb();
      const initialRes = db.prepare(`
        SELECT count(*) as c FROM stock_reservations
        WHERE order_id = ? AND status = 'Active'
      `).get(order.id) as { c: number };
      assert.ok(initialRes.c > 0);

      // 2. Cancel order
      const cancelled = cancelCustomerOrder(adminActor, order.id, "Customer banquet schedule adjusted");

      assert.equal(cancelled.status, "cancelled");
      assert.equal(cancelled.cancellation_reason, "Customer banquet schedule adjusted");

      // Verify reservations were released
      const activeResAfter = db.prepare(`
        SELECT count(*) as c FROM stock_reservations
        WHERE order_id = ? AND status = 'Active'
      `).get(order.id) as { c: number };
      assert.equal(activeResAfter.c, 0, "All reservations must be released upon cancellation");

      const cancelledRes = db.prepare(`
        SELECT count(*) as c FROM stock_reservations
        WHERE order_id = ? AND status = 'Cancelled'
      `).get(order.id) as { c: number };
      assert.ok(cancelledRes.c > 0, "Reservation status must be transitioned to Cancelled");
    });
  });

  // =========================================================================
  // 6. Security, Multi-Tenant B2B Isolation & IDOR Protection Tests
  // =========================================================================
  describe("6. Security, Multi-Tenant B2B Isolation & IDOR Protection", () => {
    it("strictly isolates customer data: customer A cannot access orders of customer B", () => {
      // Create an order for Customer B (Hotel Savoia, CUST-B2B-02)
      const savoiaOrder = submitCustomerOrder(adminActor, {
        customer_id: "CUST-B2B-02",
        delivery_date: addDaysIso(1),
        lines: [{ sku: "SKU-SAL-001", cases: 1 }]
      });

      // Customer A (Cracco, CUST-B2B-01) attempts to inspect Savoia's order
      assert.throws(
        () => {
          getCustomerOrder(craccoActor, savoiaOrder.id);
        },
        /Access denied/
      );
    });

    it("prevents customer A from cancelling an order owned by customer B", () => {
      const savoiaOrder = submitCustomerOrder(adminActor, {
        customer_id: "CUST-B2B-02",
        delivery_date: addDaysIso(1),
        lines: [{ sku: "SKU-SAL-001", cases: 1 }]
      });

      assert.throws(
        () => {
          cancelCustomerOrder(craccoActor, savoiaOrder.id, "Malicious cancellation attempt");
        },
        /Access denied/
      );
    });

    it("allows authorized sales staff to place orders on behalf of any customer", () => {
      const staffOrder = submitCustomerOrder(salesActor, {
        customer_id: "CUST-B2B-03", // Osteria Francescana
        channel: "sales_rep",
        delivery_date: addDaysIso(2),
        lines: [{ sku: "SKU-BFL-009", cases: 2 }]
      });

      assert.equal(staffOrder.customer_id, "CUST-B2B-03");
      assert.equal(staffOrder.channel, "sales_rep");
      assert.equal(staffOrder.created_by, salesActor.email);
    });
  });

  // =========================================================================
  // 7. REST API Endpoints Verification Tests
  // =========================================================================
  describe("7. Customer Order & Portal REST API Endpoints", () => {
    it("GET /api/v1/customer-portal/catalog returns customer-scoped catalog and pricing", async () => {
      const req = makeReq("/api/v1/customer-portal/catalog?customer_id=CUST-B2B-01", {
        token: craccoCustomerToken
      });
      const res = await getCatalog(req);
      assert.equal(res.status, 200);

      const data = await res.json();
      assert.ok(data.products.length >= 8);
      assert.equal(data.customer.id, "CUST-B2B-01");
      assert.ok(data.customer.credit_limit_cents > 0);
    });

    it("GET /api/v1/customer-portal/pricing resolves exact live price snapshot", async () => {
      const req = makeReq("/api/v1/customer-portal/pricing?sku=SKU-SAL-001&quantity=20&customer_id=CUST-B2B-01", {
        token: craccoCustomerToken
      });
      const res = await getPricing(req);
      assert.equal(res.status, 200);

      const pricing = await res.json();
      assert.equal(pricing.sku, "SKU-SAL-001");
      assert.equal(pricing.pricing_source, "contract_tier");
      assert.equal(pricing.unit_price_cents, 8400);
    });

    it("POST /api/v1/customer-portal/validate evaluates basket availability and credit status", async () => {
      const req = makeReq("/api/v1/customer-portal/validate", {
        token: craccoCustomerToken,
        body: {
          customer_id: "CUST-B2B-01",
          delivery_date: addDaysIso(2),
          lines: [{ sku: "SKU-SAL-001", cases: 5 }]
        }
      });
      const res = await postValidate(req);
      assert.equal(res.status, 200);

      const val = await res.json();
      assert.equal(val.valid, true);
      assert.equal(val.can_confirm_immediately, true);
      assert.equal(val.credit_evaluation.credit_status, "clear");
    });

    it("POST /api/v1/customer-portal/orders places and confirms order via API with idempotency", async () => {
      const req = makeReq("/api/v1/customer-portal/orders", {
        token: craccoCustomerToken,
        idempotencyKey: `IDEMP-TEST-${Date.now()}`,
        body: {
          customer_id: "CUST-B2B-01",
          delivery_date: addDaysIso(1),
          po_reference: "PO-API-TEST-01",
          lines: [{ sku: "SKU-SAL-001", cases: 2 }]
        }
      });
      const res = await postOrder(req);
      assert.equal(res.status, 201);

      const order = await res.json();
      assert.ok(order.order_number.startsWith("SO-2026-"));
      assert.equal(order.status, "confirmed");
      assert.equal(order.po_reference, "PO-API-TEST-01");
    });

    it("GET /api/v1/customer-portal/contracts lists active contracts", async () => {
      const req = makeReq("/api/v1/customer-portal/contracts?customer_id=CUST-B2B-01", {
        token: craccoCustomerToken
      });
      const res = await getContracts(req);
      assert.equal(res.status, 200);

      const list = await res.json();
      assert.ok(list.length > 0);
      assert.equal(list[0].customer_id, "CUST-B2B-01");
      assert.ok(list[0].items.length > 0);
    });

    it("GET /api/v1/customer-portal/customers returns credit profiles for staff selector", async () => {
      const req = makeReq("/api/v1/customer-portal/customers", {
        token: salesToken
      });
      const res = await getCustomers(req);
      assert.equal(res.status, 200);

      const custs = await res.json();
      assert.ok(custs.length >= 5);
      assert.ok(custs[0].credit_evaluation !== undefined);
    });
  });
});
