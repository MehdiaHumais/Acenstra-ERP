import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Isolate from the live database — this suite mutates orders, inventory and
// deliveries, and must never touch production data. A seeded in-memory-style
// temp copy is created instead.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ascentra-sec-test-"));
process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-security.sqlite");
process.env.SEED_DEMO_DATA = "true";

import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  AuthenticatedUser,
  assertPermission,
  resolveRequestUser,
  requireAuthenticatedUser,
  requirePermission,
  requireWarehouseAccess,
  requireStoreVendorAccess,
  requireDriverAccess,
  requireRecordAccess,
  requireMutationAuthorization,
  recordAuditEvent,
  listAuditEvents
} from "@/server/security/auth";
import { signAccessToken } from "@/server/security/crypto";
import { ApiError, authorizeRequest } from "@/server/core/http";
import { listOrders, createOrder, deleteOrder, releaseOrderCredit } from "@/server/services/orders-warehouse.service";
import { listLots, postCycleCount } from "@/server/services/inventory-fefo.service";
import { getFinanceSummary, updateStoreStatus } from "@/server/services/finance-analytics.service";
import { listDeliveries, updateDelivery } from "@/server/services/deliveries-traceability.service";
import { GET as getOrdersRoute } from "@/app/api/v1/orders/route";
import { GET as getFinanceRoute } from "@/app/api/v1/finance/summary/route";
import { GET as getDeliveriesRoute } from "@/app/api/v1/deliveries/route";
import { GET as getInventoryRoute } from "@/app/api/v1/inventory/lots/route";
import { GET as getWarehouseTasksRoute } from "@/app/api/v1/warehouse/tasks/route";

test("Security Test Suite — Ascentra ERP Defense in Depth", async (t) => {
  // Test User Identities
  const superAdmin: AuthenticatedUser = {
    id: "USR-ADMIN-SEC",
    email: "elena.conti@ascentra.it",
    name: "Elena Conti",
    role: "super_admin",
    roles: ["super_admin"],
    warehouse: "Milan Cold Hub",
    store_id: null,
    mfa_enabled: true
  };

  const ceoUser: AuthenticatedUser = {
    id: "USR-CEO-SEC",
    email: "ceo@ascentra.it",
    name: "Marco Ascentra",
    role: "ceo",
    roles: ["ceo"],
    warehouse: null,
    store_id: null,
    mfa_enabled: true
  };

  const milanManager: AuthenticatedUser = {
    id: "USR-MGR-MILAN",
    email: "milan.mgr@ascentra.it",
    name: "Milan Manager",
    role: "warehouse_manager",
    roles: ["warehouse_manager"],
    warehouse: "Milan Cold Hub",
    store_id: null,
    mfa_enabled: false
  };

  const romeManager: AuthenticatedUser = {
    id: "USR-MGR-ROME",
    email: "rome.mgr@ascentra.it",
    name: "Rome Manager",
    role: "warehouse_manager",
    roles: ["warehouse_manager"],
    warehouse: "Rome Distribution Center",
    store_id: null,
    mfa_enabled: false
  };

  const driverDavide: AuthenticatedUser = {
    id: "USR-DRV-DAVIDE",
    email: "davide.galli@ascentra.it",
    name: "Davide Galli",
    role: "driver",
    roles: ["driver"],
    warehouse: "Milan Cold Hub",
    store_id: null,
    mfa_enabled: false
  };

  const driverMatteo: AuthenticatedUser = {
    id: "USR-DRV-MATTEO",
    email: "matteo.driver@ascentra.it",
    name: "Matteo Driver",
    role: "driver",
    roles: ["driver"],
    warehouse: "Milan Cold Hub",
    store_id: null,
    mfa_enabled: false
  };

  const pickerUser: AuthenticatedUser = {
    id: "USR-PCK-01",
    email: "picker@ascentra.it",
    name: "Marco Bellini",
    role: "picker",
    roles: ["picker"],
    warehouse: "Milan Cold Hub",
    store_id: null,
    mfa_enabled: false
  };

  const storeVendorA: AuthenticatedUser = {
    id: "USR-STR-A",
    email: "vendor.milano@esselunga.it",
    name: "Esselunga Duomo",
    role: "store_vendor",
    roles: ["store_vendor"],
    warehouse: null,
    store_id: "STR-MIL-001",
    mfa_enabled: false
  };

  const storeVendorB: AuthenticatedUser = {
    id: "USR-STR-B",
    email: "vendor.roma@conad.it",
    name: "Conad Roma",
    role: "store_vendor",
    roles: ["store_vendor"],
    warehouse: null,
    store_id: "STR-ROM-002",
    mfa_enabled: false
  };

  await t.test("1. Unauthenticated Requests Rejected with 401", () => {
    const unauthReq = new NextRequest("http://localhost:3000/api/v1/orders");
    assert.throws(
      () => requireAuthenticatedUser(unauthReq),
      (err: any) => {
        assert.equal(err.status, 401);
        assert.equal(err.code, "UNAUTHORIZED");
        return true;
      },
      "Must throw 401 UNAUTHORIZED when Authorization header is absent"
    );

    const invalidTokenReq = new NextRequest("http://localhost:3000/api/v1/orders", {
      headers: { authorization: "Bearer invalid.token.payload" }
    });
    assert.throws(
      () => requireAuthenticatedUser(invalidTokenReq),
      (err: any) => {
        assert.equal(err.status, 401);
        assert.equal(err.code, "UNAUTHORIZED");
        return true;
      },
      "Must throw 401 UNAUTHORIZED when Bearer token signature is invalid"
    );
  });

  await t.test("2. Production Role Spoofing Prevention", () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      (process.env as any).NODE_ENV = "production";
      const spoofReq = new NextRequest("http://localhost:3000/api/v1/orders", {
        headers: { "x-ascentra-role": "super_admin" }
      });
      assert.throws(
        () => requireAuthenticatedUser(spoofReq),
        (err: any) => {
          assert.equal(err.status, 401);
          assert.equal(err.code, "UNAUTHORIZED");
          return true;
        },
        "In production mode, x-ascentra-role without verified credentials must fail with 401"
      );
    } finally {
      (process.env as any).NODE_ENV = originalEnv;
    }
  });

  await t.test("3. RBAC Permission Enforcement", () => {
    // Store Vendor cannot access finance payment or warehouse management
    assert.throws(
      () => assertPermission(storeVendorA, "finance:payment"),
      (err: any) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, "FORBIDDEN_INSUFFICIENT_ROLE");
        return true;
      },
      "Store vendor must be forbidden from finance:payment"
    );

    // Picker cannot approve credit overrides
    assert.throws(
      () => assertPermission(pickerUser, "orders:credit_override"),
      (err: any) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, "FORBIDDEN_INSUFFICIENT_ROLE");
        return true;
      },
      "Picker must be forbidden from orders:credit_override"
    );

    // Super Admin has all permissions
    assert.doesNotThrow(() => assertPermission(superAdmin, "orders:credit_override"));
    assert.doesNotThrow(() => assertPermission(superAdmin, "inventory:adjust"));
  });

  await t.test("4. Warehouse Boundary Enforcement (Cross-Warehouse Tampering Blocked)", () => {
    // Milan manager accessing Milan warehouse passes
    assert.doesNotThrow(() => requireWarehouseAccess(milanManager, "Milan Cold Hub"));

    // Rome manager accessing Milan warehouse fails
    assert.throws(
      () => requireWarehouseAccess(romeManager, "Milan Cold Hub"),
      (err: any) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, "FORBIDDEN_WAREHOUSE_SCOPE");
        return true;
      },
      "Rome manager must not access Milan Cold Hub assets"
    );

    // Attempting postCycleCount on a Milan lot by Rome manager must be blocked
    const milanLots = listLots().filter((l) => l.warehouse.toLowerCase().includes("milan"));
    if (milanLots.length > 0) {
      assert.throws(
        () =>
          postCycleCount(romeManager, {
            batch_id: milanLots[0].batch_code,
            counted_cases: 50,
            reason: "Malicious cross-warehouse count"
          }),
        (err: any) => {
          assert.equal(err.status, 403);
          assert.equal(err.code, "FORBIDDEN_WAREHOUSE_SCOPE");
          return true;
        },
        "Cross-warehouse cycle count adjustment must be rejected with 403"
      );
    }
  });

  await t.test("5. Store Vendor Boundary Enforcement & Data Isolation", () => {
    // Store Vendor A cannot access Store Vendor B's customer ID
    assert.throws(
      () => requireStoreVendorAccess(storeVendorA, "STR-ROM-002"),
      (err: any) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, "FORBIDDEN_VENDOR_SCOPE");
        return true;
      },
      "Store vendor A must not access store B resources"
    );

    // Store vendor creating an order for another store must be rejected
    assert.throws(
      () =>
        createOrder(storeVendorA, {
          customer_name: "Conad Roma",
          sku: "SKU-SAL-001",
          cases: 10
        }),
      (err: any) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, "FORBIDDEN_STORE_BOUNDARY");
        return true;
      },
      "Store vendor creating order for another customer must be rejected with 403"
    );

    // Invoices list for Store Vendor A must not leak Store Vendor B's data or company profit margins
    const financeSummary = getFinanceSummary(storeVendorA);
    assert.equal(financeSummary.gross_margin_pct, 0, "Company gross margin must be redacted (0) for store vendor");
    assert.equal(financeSummary.ap_cents, 0, "Company AP must be redacted (0) for store vendor");
    for (const inv of financeSummary.invoices) {
      assert.equal(inv.margin_pct, 0, "Invoice profit margin must be redacted (0) for store vendor");
    }
  });

  await t.test("6. Driver BOLA / IDOR Protection", () => {
    // Davide Galli accessing his own delivery passes
    assert.doesNotThrow(() => requireDriverAccess(driverDavide, "Davide Galli"));

    // Matteo Driver accessing Davide Galli's delivery fails
    assert.throws(
      () => requireDriverAccess(driverMatteo, "Davide Galli"),
      (err: any) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, "FORBIDDEN_DRIVER_SCOPE");
        return true;
      },
      "Matteo driver must be forbidden from accessing Davide Galli's delivery"
    );

    // Driver listDeliveries should only return deliveries assigned to that driver
    const davideDeliveries = listDeliveries(driverDavide);
    for (const del of davideDeliveries) {
      assert.ok(
        del.driver.toLowerCase().includes("davide"),
        `Delivery ${del.id} driver '${del.driver}' must belong to Davide`
      );
    }
  });

  await t.test("7. Executive (CEO) Read-Only Mutation Restrictions", () => {
    // CEO can read all views
    assert.doesNotThrow(() => assertPermission(ceoUser, "dashboard:read"));
    assert.doesNotThrow(() => assertPermission(ceoUser, "orders:read"));
    assert.doesNotThrow(() => assertPermission(ceoUser, "finance:read"));

    // CEO attempting sensitive physical warehouse or operational mutations fails with 403
    assert.throws(
      () => requireMutationAuthorization(ceoUser, "delete order"),
      (err: any) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, "EXECUTIVE_READ_ONLY");
        return true;
      },
      "CEO must be prevented from executing operational mutations directly"
    );

    assert.throws(
      () =>
        postCycleCount(ceoUser, {
          batch_id: "LOT-2026-SAL-041",
          counted_cases: 100
        }),
      (err: any) => {
        assert.equal(err.status, 403);
        assert.ok(
          err.code === "EXECUTIVE_READ_ONLY" || err.code === "FORBIDDEN_INSUFFICIENT_ROLE",
          "Must fail with EXECUTIVE_READ_ONLY or FORBIDDEN_INSUFFICIENT_ROLE"
        );
        return true;
      },
      "CEO cycle count adjustment must be rejected with 403"
    );
  });

  await t.test("8. Operational Roles Barred from Financial Intelligence", () => {
    // Picker accessing financial summary must fail
    assert.throws(
      () => getFinanceSummary(pickerUser),
      (err: any) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, "FORBIDDEN_FINANCE_ACCESS");
        return true;
      },
      "Warehouse picker must not access finance summary"
    );

    // Driver accessing financial summary must fail
    assert.throws(
      () => getFinanceSummary(driverDavide),
      (err: any) => {
        assert.equal(err.status, 403);
        assert.equal(err.code, "FORBIDDEN_FINANCE_ACCESS");
        return true;
      },
      "Driver must not access finance summary"
    );
  });

  await t.test("9. End-to-End API Route Authorization & Security Headers", async () => {
    const unauthReq = new NextRequest("http://localhost:3000/api/v1/orders");
    const resOrders = await getOrdersRoute(unauthReq);
    assert.equal(resOrders.status, 401, "GET /api/v1/orders without auth must return HTTP 401");
    assert.equal(resOrders.headers.get("x-content-type-options"), "nosniff");
    assert.equal(resOrders.headers.get("x-frame-options"), "DENY");

    const resFinance = await getFinanceRoute(new NextRequest("http://localhost:3000/api/v1/finance/summary"));
    assert.equal(resFinance.status, 401, "GET /api/v1/finance/summary without auth must return HTTP 401");

    const resDeliveries = await getDeliveriesRoute(new NextRequest("http://localhost:3000/api/v1/deliveries"));
    assert.equal(resDeliveries.status, 401, "GET /api/v1/deliveries without auth must return HTTP 401");

    const resInventory = await getInventoryRoute(new NextRequest("http://localhost:3000/api/v1/inventory/lots"));
    assert.equal(resInventory.status, 401, "GET /api/v1/inventory/lots without auth must return HTTP 401");

    const resTasks = await getWarehouseTasksRoute(new NextRequest("http://localhost:3000/api/v1/warehouse/tasks"));
    assert.equal(resTasks.status, 401, "GET /api/v1/warehouse/tasks without auth must return HTTP 401");

    // Authenticated request with valid token
    const token = signAccessToken({
      sub: superAdmin.id,
      email: superAdmin.email,
      name: superAdmin.name,
      role: superAdmin.role,
      roles: superAdmin.roles,
      warehouse: superAdmin.warehouse,
      store_id: superAdmin.store_id
    });
    const authReq = new NextRequest("http://localhost:3000/api/v1/orders", {
      headers: { authorization: `Bearer ${token}` }
    });
    const resAuthOrders = await getOrdersRoute(authReq);
    assert.equal(resAuthOrders.status, 200, "Authenticated request with valid token must return HTTP 200");
  });

  await t.test("10. Audit Logging and Credential Redaction", () => {
    recordAuditEvent({
      actor: superAdmin,
      action: "security.test_mutation",
      entityType: "SecurityPolicy",
      entityId: "POL-001",
      after: {
        setting: "mfa_enforced",
        token: "sensitive-jwt-token-string",
        password: "SuperSecretPassword123",
        secret: "totp-secret-key"
      }
    });

    const events = listAuditEvents(5);
    const recorded = events.find((e) => e.action === "security.test_mutation");
    assert.ok(recorded, "Audit event must be saved in database");
    assert.equal(recorded.actor_id, superAdmin.id);

    // Verify credential redaction
    assert.ok(recorded.after_json, "After JSON must be present");
    assert.ok(
      !recorded.after_json.includes("SuperSecretPassword123"),
      "Passwords must be redacted from audit logs"
    );
    assert.ok(
      !recorded.after_json.includes("sensitive-jwt-token-string"),
      "Tokens must be redacted from audit logs"
    );
  });
});
