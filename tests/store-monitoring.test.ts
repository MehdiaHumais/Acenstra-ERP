import test from "node:test";
import assert from "node:assert/strict";
import { getDb, resetDatabaseForTests } from "@/server/db/connection";
import type { AuthenticatedUser } from "@/server/security/auth";
import {
  acknowledgeStoreAlert,
  compareStoresAndProducts,
  configureStorePosIntegration,
  createStoreAccount,
  exportConsolidatedStoresCsv,
  exportStorePurchaseHistoryCsv,
  getDistributorConsolidatedDashboard,
  getStoreAccountDetail,
  getStoreConsumptionAnalysis,
  getStoreDashboard,
  getStoreInventoryReconciliation,
  getStorePosIntegrationStatus,
   getStorePurchaseOrderHistory,
  importStorePosTransactions,
  inviteOrUpdateStoreUser,
  listStoreAccounts,
  recordStoreInventorySnapshot,
  updateStoreAccountStatus,
  upsertStoreConsumptionConfig,
  upsertStorePosSkuMapping,
} from "@/server/services/store-monitoring.service";

const distributorAdmin: AuthenticatedUser = {
  id: "USR-01",
  name: "Marco Bellini",
  email: "marco.bellini@ascentra.it",
  role: "super_admin",
  mfa_enabled: true,
  active: true,
};

const storeOwnerMil01: AuthenticatedUser = {
  id: "USR-STR",
  name: "Chiara Moretti",
  email: "chiara.moretti@store-navigli.it",
  role: "store_owner",
  store_id: "STR-MIL-01",
  mfa_enabled: true,
  active: true,
};

const storeManagerMil01: AuthenticatedUser = {
  id: "USR-STR-MGR-01",
  name: "Luca Ferrari",
  email: "luca.ferrari@gourmetbrera.it",
  role: "store_manager",
  store_id: "STR-MIL-01",
  mfa_enabled: true,
  active: true,
};

const storeStaffMil01: AuthenticatedUser = {
  id: "USR-STR-STF-01",
  name: "Sara Bianchi",
  email: "sara.bianchi@gourmetbrera.it",
  role: "store_staff",
  store_id: "STR-MIL-01",
  mfa_enabled: false,
  active: true,
};

const storeOwnerMil02: AuthenticatedUser = {
  id: "USR-STR-OWN-02",
  name: "Alessandro Riva",
  email: "alessandro.riva@botteganavigli.it",
  role: "store_owner",
  store_id: "STR-MIL-02",
  mfa_enabled: true,
  active: true,
};

test.beforeEach(() => {
  resetDatabaseForTests();
});

test("1. Store-level data isolation: Store user can access own store but is strictly blocked from other stores", () => {
  // Store Owner of STR-MIL-01 can access STR-MIL-01
  const ownDash = getStoreDashboard(storeOwnerMil01, "STR-MIL-01");
  assert.equal(ownDash.store.id, "STR-MIL-01");
  assert.equal(ownDash.store.name, "Gourmet Market Brera");

  // Store Owner of STR-MIL-01 is strictly blocked from STR-MIL-02 across all endpoints
  assert.throws(
    () => getStoreDashboard(storeOwnerMil01, "STR-MIL-02"),
    (err: any) => err.code === "FORBIDDEN_STORE_ISOLATION" && err.statusCode === 403
  );

  assert.throws(
    () => getStorePurchaseOrderHistory(storeOwnerMil01, "STR-MIL-02"),
    (err: any) => err.code === "FORBIDDEN_STORE_ISOLATION" && err.statusCode === 403
  );

  assert.throws(
    () => getStoreConsumptionAnalysis(storeOwnerMil01, "STR-MIL-02"),
    (err: any) => err.code === "FORBIDDEN_STORE_ISOLATION" && err.statusCode === 403
  );

  assert.throws(
    () => getStoreInventoryReconciliation(storeOwnerMil01, "STR-MIL-02"),
    (err: any) => err.code === "FORBIDDEN_STORE_ISOLATION" && err.statusCode === 403
  );

  assert.throws(
    () => getStorePosIntegrationStatus(storeOwnerMil01, "STR-MIL-02"),
    (err: any) => err.code === "FORBIDDEN_STORE_ISOLATION" && err.statusCode === 403
  );

  // Listing store accounts as STR-MIL-01 owner returns ONLY STR-MIL-01
  const visibleStores = listStoreAccounts(storeOwnerMil01);
  assert.equal(visibleStores.length, 1);
  assert.equal(visibleStores[0].id, "STR-MIL-01");
});

test("2. Multiple stores under one franchise group and store account lifecycle management", () => {
  // Gruppo Gastronomico Lombardo has both STR-MIL-01 and STR-MIL-02 seeded
  const lombardoStores = listStoreAccounts(distributorAdmin, {
    franchise_group: "Gruppo Gastronomico Lombardo",
  });
  assert.equal(lombardoStores.length, 2);
  const ids = lombardoStores.map((s) => s.id).sort();
  assert.deepEqual(ids, ["STR-MIL-01", "STR-MIL-02"]);

  // Distributor admin creates a 3rd store under Gruppo Gastronomico Lombardo
  const created = createStoreAccount(distributorAdmin, {
    name: "Gourmet Express Stazione Centrale",
    store_code: "GMB-MIL-03",
    parent_franchise_group: "Gruppo Gastronomico Lombardo",
    city: "Milano",
    region: "Lombardy",
    contact_name: "Paolo Verdi",
    contact_email: "paolo.verdi@gourmetbrera.it",
    credit_limit_cents: 4_000_000,
    payment_terms_days: 30,
    price_book_code: "PB-HORECA-NORTH",
  });

  assert.equal(created.store_code, "GMB-MIL-03");
  assert.equal(created.parent_franchise_group, "Gruppo Gastronomico Lombardo");
  assert.equal(created.status, "active");

  const updatedGroupStores = listStoreAccounts(distributorAdmin, {
    franchise_group: "Gruppo Gastronomico Lombardo",
  });
  assert.equal(updatedGroupStores.length, 3);

  // Suspend and reactivate store account
  const suspended = updateStoreAccountStatus(distributorAdmin, created.id, {
    status: "suspended",
    reason: "Seasonal renovation closure",
  });
  assert.equal(suspended.store.status, "suspended");
  assert.ok(suspended.account_history.some((h: any) => h.action.includes("suspended")));

  // Invite a store manager to the new store
  const invited = inviteOrUpdateStoreUser(distributorAdmin, created.id, {
    name: "Elena Rossi",
    email: "elena.rossi@gourmetbrera.it",
    store_sub_role: "store_manager",
  });
  assert.equal(invited.store_id, created.id);
  assert.equal(invited.store_sub_role, "store_manager");
});

test("3 & 4. Accurate purchase totals and delivered vs ordered quantities (including partial deliveries)", () => {
  const dash = getStoreDashboard(storeOwnerMil01, "STR-MIL-01");

  // STR-MIL-01 has orders SO-2026-8414 (delivered), SO-2026-8501 (delivered), SO-2026-8502 (delivered), SO-2026-8503 (confirmed)
  assert.ok(dash.purchases.total_orders_count >= 4);
  assert.ok(dash.purchases.total_purchases_cents > 0);
  assert.ok(dash.purchases.total_ordered_cases > 0);
  assert.ok(dash.purchases.total_delivered_cases > 0);
  // Ordered cases include confirmed pending order SO-2026-8503, so ordered > delivered
  assert.ok(dash.purchases.total_ordered_cases > dash.purchases.total_delivered_cases);

  // Verify partial delivery detection on STR-MIL-02 (SO-2026-8504 ordered 20 cases, DEL-4423 delivered 16 cases)
  const mil02Orders = getStorePurchaseOrderHistory(storeOwnerMil02, "STR-MIL-02");
  const partialOrder = mil02Orders.orders.find((o: any) => o.order_id === "SO-2026-8504");
  assert.ok(partialOrder, "Expected SO-2026-8504 in STR-MIL-02 order history");
  assert.equal(partialOrder.ordered_cases, 20);
  assert.equal(partialOrder.delivered_cases, 16);
  assert.equal(partialOrder.is_partial_delivery, true);
});

test("5. Invoice and payment calculations and store_staff financial visibility restriction", () => {
  // Store Owner of STR-MIL-01 sees full invoice and payment figures
  const ownerDash = getStoreDashboard(storeOwnerMil01, "STR-MIL-01");
  assert.equal(ownerDash.spending.financials_restricted, false);
  assert.ok(ownerDash.spending.invoiced_total_cents > 0);
  assert.ok(ownerDash.spending.paid_amount_cents > 0);
  assert.ok(ownerDash.spending.unpaid_amount_cents > 0);
  assert.equal(
    ownerDash.spending.invoiced_total_cents - ownerDash.spending.paid_amount_cents,
    ownerDash.spending.unpaid_amount_cents
  );

  // Store Staff (Matteo Galli) without view_financials permission gets masked financial totals
  const staffDash = getStoreDashboard(storeStaffMil01, "STR-MIL-01");
  assert.equal(staffDash.spending.financials_restricted, true);
  assert.equal(staffDash.spending.total_spending_cents, 0);
  assert.equal(staffDash.spending.outstanding_invoices.length, 0);
});

test("6 & 7. Consumption estimate labelling (ESTIMATED vs ACTUAL) and missing POS data handling", () => {
  // STR-MIL-01 has connected POS (Lightspeed_Restaurant_POS) and imported sales for SKU-SAL-001, SKU-BUR-004, SKU-RVL-033
  const mil01Cons = getStoreConsumptionAnalysis(storeOwnerMil01, "STR-MIL-01");
  assert.equal(mil01Cons.pos_connected, true);

  const salItem = mil01Cons.items.find((i: any) => i.sku === "SKU-SAL-001");
  assert.ok(salItem);
  assert.equal(salItem.data_classification, "ACTUAL");
  assert.ok(salItem.actual_consumed_cases !== null && salItem.actual_consumed_cases > 0);
  // Purchased quantity is never blindly equated to consumed quantity
  assert.notEqual(salItem.purchased_cases, salItem.estimated_consumed_cases);

  // STR-MIL-02 has NO POS integration and NO inventory snapshots
  const mil02Cons = getStoreConsumptionAnalysis(storeOwnerMil02, "STR-MIL-02");
  assert.equal(mil02Cons.pos_connected, false);
  assert.ok(mil02Cons.items.length > 0);

  for (const item of mil02Cons.items) {
    assert.equal(item.data_classification, "ESTIMATED");
    assert.equal(item.actual_consumed_cases, null, "Must never fabricate actual POS consumption when POS is disconnected");
    assert.equal(
      item.estimated_remaining_stock_cases,
      null,
      "Must never fabricate remaining stock when no inventory count exists"
    );
    assert.ok(item.missing_data_flags.includes("POS_SALES_FEED_NOT_CONNECTED"));
    assert.ok(item.missing_data_flags.includes("STORE_INVENTORY_COUNTS_NOT_AVAILABLE"));
  }

  // Upsert consumption configuration for STR-MIL-02
  const updatedCons = upsertStoreConsumptionConfig(storeOwnerMil02, "STR-MIL-02", {
    sku: "SKU-RVL-033",
    estimation_method: "manual_store_rate",
    estimated_daily_usage_cases: 1.5,
    waste_Shrinkage_allowance_pct: 5.0,
    replenishment_threshold_cases: 4.0,
  });
  const rvlItem = updatedCons.items.find((i: any) => i.sku === "SKU-RVL-033");
  assert.ok(rvlItem);
  assert.equal(rvlItem.estimation_method, "manual_store_rate");
  assert.equal(rvlItem.waste_Shrinkage_allowance_pct, 5.0);
});

test("8. Store inventory reconciliation formula and zero fabricated stock balances when unavailable", () => {
  // STR-MIL-02 has no inventory snapshots -> inventory_data_available must be false and snapshots empty
  const mil02Inv = getStoreInventoryReconciliation(storeOwnerMil02, "STR-MIL-02");
  assert.equal(mil02Inv.inventory_data_available, false);
  assert.equal(mil02Inv.snapshots.length, 0);

  // Record a new physical inventory count on STR-MIL-01 and verify exact formula:
  // Opening (10) + Received (25) - Recorded Consumption (28) - Waste (1.5) + Adjustments (-0.5) = Expected Closing (5.0)
  const reconciledSnap = recordStoreInventorySnapshot(storeOwnerMil01, "STR-MIL-01", {
    sku: "SKU-SAL-001",
    period_start: "2026-11-01",
    period_end: "2026-11-08",
    opening_stock_cases: 10,
    deliveries_received_cases: 25,
    recorded_consumption_cases: 28,
    waste_spoilage_cases: 1.5,
    adjustments_cases: -0.5,
    actual_closing_cases: 5.0,
    notes: "Exact match count",
  });

  assert.equal(reconciledSnap.expected_closing_cases, 5.0);
  assert.equal(reconciledSnap.actual_closing_cases, 5.0);
  assert.equal(reconciledSnap.variance_cases, 0);
  assert.equal(reconciledSnap.reconciliation_status, "reconciled");

  // Record a count with a discrepancy -> variance_flagged + alert created
  const varianceSnap = recordStoreInventorySnapshot(storeOwnerMil01, "STR-MIL-01", {
    sku: "SKU-BUR-004",
    period_start: "2026-11-01",
    period_end: "2026-11-08",
    opening_stock_cases: 8,
    deliveries_received_cases: 20,
    recorded_consumption_cases: 18,
    waste_spoilage_cases: 1,
    adjustments_cases: 0,
    actual_closing_cases: 6.5, // Expected is 9.0 -> variance -2.5 cases
  });

  assert.equal(varianceSnap.expected_closing_cases, 9.0);
  assert.equal(varianceSnap.actual_closing_cases, 6.5);
  assert.equal(varianceSnap.variance_cases, -2.5);
  assert.equal(varianceSnap.reconciliation_status, "variance_flagged");
});

test("9. Optional POS integration adapter: SKU mapping validation and duplicate transaction prevention", () => {
  // Attempt to enable active POS integration without credentials stays unconfigured
  const incompletePos = configureStorePosIntegration(storeOwnerMil02, "STR-MIL-02", {
    provider_name: "Toast_POS",
    external_store_ref: "",
    api_credentials_present: false,
  });
  assert.equal(incompletePos.integration.connection_status, "unconfigured");

  // Add a new SKU mapping on STR-MIL-01
  const mapped = upsertStorePosSkuMapping(storeOwnerMil01, "STR-MIL-01", {
    provider_name: "Lightspeed_Restaurant_POS",
    pos_item_code: "POS-PRO-100G",
    pos_item_name: "Tagliere Prosciutto 100g",
    distributor_sku: "SKU-PRO-021",
    mapping_type: "ingredient_recipe",
    cases_per_pos_unit: 0.025,
  });
  assert.ok(mapped.sku_mappings.some((m: any) => m.pos_item_code === "POS-PRO-100G"));

  // Import batch with 1 already-seeded transaction (LS-TX-2026-901), 1 new valid transaction, and 1 unmapped POS code
  const importRes = importStorePosTransactions(storeOwnerMil01, "STR-MIL-01", {
    provider_name: "Lightspeed_Restaurant_POS",
    period_start: "2026-11-01",
    period_end: "2026-11-08",
    transactions: [
      {
        external_tx_id: "LS-TX-2026-901", // Duplicate of seeded transaction!
        transaction_date: "2026-11-02T22:00:00Z",
        pos_item_code: "POS-SAL-250G",
        quantity_sold: 145,
      },
      {
        external_tx_id: "LSP-MIL01-9999-NEW",
        transaction_date: "2026-11-08T12:00:00Z",
        pos_item_code: "POS-PRO-100G",
        quantity_sold: 40, // 40 * 0.025 = 1.0 case consumed
      },
      {
        external_tx_id: "LSP-MIL01-UNMAPPED",
        transaction_date: "2026-11-08T12:05:00Z",
        pos_item_code: "POS-UNKNOWN-999",
        quantity_sold: 10,
      },
    ],
  });

  assert.equal(importRes.records_submitted, 3);
  assert.equal(importRes.records_imported, 1);
  assert.equal(importRes.duplicates_skipped, 1);
  assert.equal(importRes.validation_errors.length, 1);
  assert.equal(importRes.status, "completed_with_warnings");
});

test("10 & 11. Distributor consolidated analytics, Store A vs Store B comparison, and RBAC blocking of store users", () => {
  // Store Owner cannot access distributor consolidated dashboard or multi-store comparison
  assert.throws(
    () => getDistributorConsolidatedDashboard(storeOwnerMil01),
    (err: any) => err.code === "FORBIDDEN_DISTRIBUTOR_ONLY" && err.statusCode === 403
  );

  assert.throws(
    () =>
      compareStoresAndProducts(storeOwnerMil01, {
        store_a_id: "STR-MIL-01",
        store_b_id: "STR-MIL-02",
      }),
    (err: any) => err.code === "FORBIDDEN_DISTRIBUTOR_ONLY" && err.statusCode === 403
  );

  // Store Owner cannot change own credit limit or status
  assert.throws(
    () =>
      updateStoreAccountStatus(storeOwnerMil01, "STR-MIL-01", {
        credit_limit_cents: 99_000_000,
      }),
    (err: any) => err.code === "FORBIDDEN_DISTRIBUTOR_ONLY" && err.statusCode === 403
  );

  // Distributor Admin accesses full consolidated analytics
  const consolidated = getDistributorConsolidatedDashboard(distributorAdmin);
  assert.ok(consolidated.summary.total_associated_stores >= 5);
  assert.ok(consolidated.summary.total_purchases_cents > 0);
  assert.ok(consolidated.spending_by_store.length >= 5);
  assert.ok(consolidated.purchases_by_product.length > 0);

  // Store A vs Store B comparison
  const comparison = compareStoresAndProducts(distributorAdmin, {
    store_a_id: "STR-MIL-01",
    store_b_id: "STR-MIL-02",
  });
  assert.equal(comparison.store_a.store_id, "STR-MIL-01");
  assert.equal(comparison.store_b.store_id, "STR-MIL-02");
  assert.equal(comparison.store_a.pos_connected, true);
  assert.equal(comparison.store_b.pos_connected, false);
  assert.ok(comparison.product_demand_comparison.length > 0);
});

test("12. Export permission enforcement and immutable audit trail verification", () => {
  // Store Owner / Manager can export their own store's purchase history CSV
  const storeCsv = exportStorePurchaseHistoryCsv(storeManagerMil01, "STR-MIL-01");
  assert.ok(storeCsv.includes("Order Number,Store ID,Delivery Date,Order Status"));
  assert.ok(storeCsv.includes("STR-MIL-01"));
  assert.ok(!storeCsv.includes("STR-MIL-02"));

  // Store Staff without export_reports permission is blocked from exporting CSV
  assert.throws(
    () => exportStorePurchaseHistoryCsv(storeStaffMil01, "STR-MIL-01"),
    (err: any) => err.statusCode === 403
  );

  // Distributor Admin can export consolidated store CSV
  const consolidatedCsv = exportConsolidatedStoresCsv(distributorAdmin);
  assert.ok(consolidatedCsv.includes("Store Code,Store Name,Franchise Group"));
  assert.ok(consolidatedCsv.includes("Gourmet Market Brera"));

  // Acknowledge an alert and verify audit events exist
  acknowledgeStoreAlert(distributorAdmin, "SMA-2026-001", "acknowledged");

  const db = getDb();
  const auditRows = db
    .prepare("SELECT action, entity_type FROM audit_events WHERE action LIKE 'store.%'")
    .all() as Array<{ action: string; entity_type: string }>;

  const actions = new Set(auditRows.map((a) => a.action));
  assert.ok(actions.has("store.purchase_history_exported"));
  assert.ok(actions.has("store.consolidated_report_exported"));
  assert.ok(actions.has("store.alert_status_updated"));
});
