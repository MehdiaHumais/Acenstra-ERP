"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Building2,
  Calculator,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Database,
  Download,
  Eye,
  FileSpreadsheet,
  Filter,
  Layers,
  Lock,
  Package,
  Plus,
  RefreshCw,
  Scale,
  ShieldAlert,
  ShoppingBag,
  Store,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import { Badge, KpiCard, SectionHeader, Surface, statusTone } from "@/components/ui";
import { Can, ViewOnlyBadge } from "@/components/access-gate";
import { cn, money, number, percent, titleCase } from "@/lib/format";

type ViewMode = "distributor_consolidated" | "store_portal";

type DistributorTab = "consolidated" | "comparison" | "accounts" | "alerts";
type StoreTab =
  | "dashboard"
  | "orders"
  | "consumption"
  | "inventory"
  | "pos_adapter"
  | "users_access";

const ACTOR_HEADERS: Record<string, Record<string, string>> = {
  distributor_admin: {
    "x-Erp-User": "Marco Bellini",
    "x-Erp-Role": "super_admin",
  },
  store_owner_mil01: {
    "x-Erp-User": "Giulia Ferri",
    "x-Erp-Role": "store_owner",
    "x-Erp-Store-Id": "STR-MIL-01",
  },
  store_manager_mil01: {
    "x-Erp-User": "Davide Conti",
    "x-Erp-Role": "store_manager",
    "x-Erp-Store-Id": "STR-MIL-01",
  },
  store_staff_mil01: {
    "x-Erp-User": "Matteo Galli",
    "x-Erp-Role": "store_staff",
    "x-Erp-Store-Id": "STR-MIL-01",
  },
  store_owner_mil02: {
    "x-Erp-User": "Chiara Lombardi",
    "x-Erp-Role": "store_owner",
    "x-Erp-Store-Id": "STR-MIL-02",
  },
};

export function StoreMonitoringWorkbench() {
  const [viewMode, setViewMode] = useState<ViewMode>("distributor_consolidated");
  const [actorKey, setActorKey] = useState<string>("distributor_admin");
  const [selectedStoreId, setSelectedStoreId] = useState<string>("STR-MIL-01");
  const [distTab, setDistTab] = useState<DistributorTab>("consolidated");
  const [storeTab, setStoreTab] = useState<StoreTab>("dashboard");

  // Filters for Distributor Consolidated View
  const [franchiseGroupFilter, setFranchiseGroupFilter] = useState<string>("all");
  const [regionFilter, setRegionFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Store comparison selection
  const [compareStoreA, setCompareStoreA] = useState<string>("STR-MIL-01");
  const [compareStoreB, setCompareStoreB] = useState<string>("STR-MIL-02");

  // Order history filters
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>("all");
  const [skuFilter, setSkuFilter] = useState<string>("");

  // Loaded data states
  const [consolidatedData, setConsolidatedData] = useState<any>(null);
  const [comparisonData, setComparisonData] = useState<any>(null);
  const [storeAccounts, setStoreAccounts] = useState<any[]>([]);
  const [storeDashboard, setStoreDashboard] = useState<any>(null);
  const [storeAccountDetail, setStoreAccountDetail] = useState<any>(null);
  const [storeOrders, setStoreOrders] = useState<any>(null);
  const [consumptionData, setConsumptionData] = useState<any>(null);
  const [inventoryData, setInventoryData] = useState<any>(null);
  const [posData, setPosData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "warning" | "critical"; text: string } | null>(null);

  // Forms
  const [newStoreForm, setNewStoreForm] = useState({
    name: "",
    store_code: "",
    parent_franchise_group: "Gruppo Gastronomico Lombardo",
    city: "Milano",
    region: "Lombardy",
    contact_name: "",
    contact_email: "",
    credit_limit_eur: "30000",
    payment_terms_days: "30",
    price_book_code: "PB-HORECA-NORTH",
  });

  const [inviteUserForm, setInviteUserForm] = useState({
    name: "",
    email: "",
    store_sub_role: "store_manager" as "store_owner" | "store_manager" | "store_staff",
  });

  const [snapshotForm, setSnapshotForm] = useState({
    sku: "SKU-SAL-001",
    period_start: "2026-11-01",
    period_end: "2026-11-08",
    opening_stock_cases: "5",
    deliveries_received_cases: "18",
    recorded_consumption_cases: "15.5",
    waste_spoilage_cases: "0.5",
    adjustments_cases: "0",
    actual_closing_cases: "7.0",
    notes: "Weekly walk-in chiller physical count",
  });

  const [posMappingForm, setPosMappingForm] = useState({
    pos_item_code: "POS-PRO-100G",
    pos_item_name: "Tagliere Prosciutto di Parma 100g",
    distributor_sku: "SKU-PRO-012",
    cases_per_pos_unit: "0.025",
  });

  const [posImportForm, setPosImportForm] = useState({
    external_tx_id: `LSP-MIL01-${Math.floor(1000 + Math.random() * 9000)}`,
    pos_item_code: "POS-SAL-250G",
    quantity_sold: "40",
    transaction_date: "2026-11-08T14:30:00Z",
  });

  const [consumptionConfigForm, setConsumptionConfigForm] = useState({
    sku: "SKU-SAL-001",
    estimation_method: "pos_recipe_actual" as
      | "delivery_cycle_interpolation"
      | "rolling_average"
      | "manual_store_rate"
      | "pos_recipe_actual",
    estimated_daily_usage_cases: "2.4",
    waste_Shrinkage_allowance_pct: "3.0",
    replenishment_threshold_cases: "6.0",
  });

  const getHeaders = useCallback(() => {
    return {
      "Content-Type": "application/json",
      ...(ACTOR_HEADERS[actorKey] || ACTOR_HEADERS.distributor_admin),
    };
  }, [actorKey]);

  const loadDistributorData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (franchiseGroupFilter !== "all") params.set("franchise_group", franchiseGroupFilter);
      if (regionFilter !== "all") params.set("region", regionFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);

      const [consRes, accRes, cmpRes] = await Promise.all([
        fetch(`/api/v1/stores/consolidated?${params.toString()}`, { headers: getHeaders() }),
        fetch(`/api/v1/stores/accounts?${params.toString()}`, { headers: getHeaders() }),
        fetch(
          `/api/v1/stores/compare?store_a_id=${encodeURIComponent(compareStoreA)}&store_b_id=${encodeURIComponent(compareStoreB)}`,
          { headers: getHeaders() }
        ),
      ]);

      if (consRes.ok) {
        setConsolidatedData(await consRes.json());
      } else {
        const err = await consRes.json();
        setFeedback({ tone: "critical", text: err?.error?.message || "Access denied to consolidated view." });
      }
      if (accRes.ok) {
        const data = await accRes.json();
        setStoreAccounts(data.stores || []);
      }
      if (cmpRes.ok) {
        setComparisonData(await cmpRes.json());
      }
    } catch (e: any) {
      setFeedback({ tone: "critical", text: e?.message || "Failed to load distributor store data" });
    } finally {
      setLoading(false);
    }
  }, [franchiseGroupFilter, regionFilter, statusFilter, compareStoreA, compareStoreB, getHeaders]);

  const loadStorePortalData = useCallback(async () => {
    setLoading(true);
    try {
      const orderParams = new URLSearchParams();
      if (orderStatusFilter !== "all") orderParams.set("order_status", orderStatusFilter);
      if (skuFilter.trim()) orderParams.set("sku", skuFilter.trim());

      const [dashRes, detRes, ordRes, consRes, invRes, posRes] = await Promise.all([
        fetch(`/api/v1/stores/${selectedStoreId}/dashboard`, { headers: getHeaders() }),
        fetch(`/api/v1/stores/${selectedStoreId}`, { headers: getHeaders() }),
        fetch(`/api/v1/stores/${selectedStoreId}/orders?${orderParams.toString()}`, { headers: getHeaders() }),
        fetch(`/api/v1/stores/${selectedStoreId}/consumption`, { headers: getHeaders() }),
        fetch(`/api/v1/stores/${selectedStoreId}/inventory`, { headers: getHeaders() }),
        fetch(`/api/v1/stores/${selectedStoreId}/pos`, { headers: getHeaders() }),
      ]);

      if (!dashRes.ok) {
        const err = await dashRes.json();
        setFeedback({
          tone: "critical",
          text: `RBAC Store Isolation Enforced: ${err?.error?.message || "Forbidden cross-store access"}`,
        });
        setStoreDashboard(null);
        return;
      }

      const dashJson = await dashRes.json();
      setStoreDashboard(dashJson.dashboard);
      if (detRes.ok) setStoreAccountDetail(await detRes.json());
      if (ordRes.ok) setStoreOrders(await ordRes.json());
      if (consRes.ok) setConsumptionData(await consRes.json());
      if (invRes.ok) setInventoryData(await invRes.json());
      if (posRes.ok) setPosData(await posRes.json());
    } catch (e: any) {
      setFeedback({ tone: "critical", text: e?.message || "Failed to load store dashboard" });
    } finally {
      setLoading(false);
    }
  }, [selectedStoreId, orderStatusFilter, skuFilter, getHeaders]);

  useEffect(() => {
    if (viewMode === "distributor_consolidated") {
      loadDistributorData();
    } else {
      loadStorePortalData();
    }
  }, [viewMode, loadDistributorData, loadStorePortalData]);

  // Handlers
  async function handleCreateStore(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const res = await fetch("/api/v1/stores/accounts", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        name: newStoreForm.name,
        store_code: newStoreForm.store_code,
        parent_franchise_group: newStoreForm.parent_franchise_group,
        city: newStoreForm.city,
        region: newStoreForm.region,
        contact_name: newStoreForm.contact_name,
        contact_email: newStoreForm.contact_email,
        credit_limit_cents: Math.round(Number(newStoreForm.credit_limit_eur || 25000) * 100),
        payment_terms_days: Number(newStoreForm.payment_terms_days || 30),
        price_book_code: newStoreForm.price_book_code,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFeedback({ tone: "critical", text: data?.error?.message || "Could not create store account" });
      return;
    }
    setFeedback({ tone: "ok", text: `Created restricted store account ${data.store.id} (${data.store.name}).` });
    setNewStoreForm({ ...newStoreForm, name: "", store_code: "" });
    loadDistributorData();
  }

  async function handleToggleStoreStatus(storeId: string, nextStatus: "active" | "watch" | "suspended") {
    setFeedback(null);
    const res = await fetch(`/api/v1/stores/${storeId}`, {
      method: "PATCH",
      headers: getHeaders(),
      body: JSON.stringify({
        status: nextStatus,
        reason: `Distributor status update to ${nextStatus}`,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFeedback({ tone: "critical", text: data?.error?.message || "Status update failed" });
      return;
    }
    setFeedback({ tone: "ok", text: `Store ${storeId} status updated to ${nextStatus.toUpperCase()}.` });
    if (viewMode === "distributor_consolidated") loadDistributorData();
    else loadStorePortalData();
  }

  async function handleInviteUser(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const res = await fetch(`/api/v1/stores/${selectedStoreId}/users`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(inviteUserForm),
    });
    const data = await res.json();
    if (!res.ok) {
      setFeedback({ tone: "critical", text: data?.error?.message || "Failed to invite store user" });
      return;
    }
    setFeedback({
      tone: "ok",
      text: `User ${data.email} invited to ${selectedStoreId} with role ${data.store_sub_role}.`,
    });
    setInviteUserForm({ name: "", email: "", store_sub_role: "store_manager" });
    loadStorePortalData();
  }

  async function handleRecordInventorySnapshot(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const res = await fetch(`/api/v1/stores/${selectedStoreId}/inventory`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        sku: snapshotForm.sku,
        period_start: snapshotForm.period_start,
        period_end: snapshotForm.period_end,
        opening_stock_cases: Number(snapshotForm.opening_stock_cases),
        deliveries_received_cases: Number(snapshotForm.deliveries_received_cases),
        recorded_consumption_cases: Number(snapshotForm.recorded_consumption_cases),
        waste_spoilage_cases: Number(snapshotForm.waste_spoilage_cases),
        adjustments_cases: Number(snapshotForm.adjustments_cases),
        actual_closing_cases:
          snapshotForm.actual_closing_cases !== "" ? Number(snapshotForm.actual_closing_cases) : null,
        notes: snapshotForm.notes,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFeedback({ tone: "critical", text: data?.error?.message || "Failed to record inventory snapshot" });
      return;
    }
    setFeedback({
      tone: data.snapshot.reconciliation_status === "variance_flagged" ? "warning" : "ok",
      text: `Recorded snapshot ${data.snapshot.snapshot_ref}: Expected Closing ${data.snapshot.expected_closing_cases} cases vs Actual ${data.snapshot.actual_closing_cases ?? "Pending"} (${data.snapshot.reconciliation_status}).`,
    });
    loadStorePortalData();
  }

  async function handleUpdateConsumptionConfig(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const res = await fetch(`/api/v1/stores/${selectedStoreId}/consumption`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        sku: consumptionConfigForm.sku,
        estimation_method: consumptionConfigForm.estimation_method,
        estimated_daily_usage_cases: Number(consumptionConfigForm.estimated_daily_usage_cases),
        waste_Shrinkage_allowance_pct: Number(consumptionConfigForm.waste_Shrinkage_allowance_pct),
        replenishment_threshold_cases: Number(consumptionConfigForm.replenishment_threshold_cases),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFeedback({ tone: "critical", text: data?.error?.message || "Failed to update consumption config" });
      return;
    }
    setFeedback({
      tone: "ok",
      text: `Updated consumption estimation parameters for ${consumptionConfigForm.sku} (${consumptionConfigForm.estimation_method}).`,
    });
    loadStorePortalData();
  }

  async function handleAddPosMapping(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const res = await fetch(`/api/v1/stores/${selectedStoreId}/pos`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        action: "upsert_sku_mapping",
        provider_name: "Lightspeed_Restaurant_POS",
        pos_item_code: posMappingForm.pos_item_code,
        pos_item_name: posMappingForm.pos_item_name,
        distributor_sku: posMappingForm.distributor_sku,
        mapping_type: "ingredient_recipe",
        cases_per_pos_unit: Number(posMappingForm.cases_per_pos_unit),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFeedback({ tone: "critical", text: data?.error?.message || "Failed to add POS SKU mapping" });
      return;
    }
    setFeedback({
      tone: "ok",
      text: `Mapped POS item ${posMappingForm.pos_item_code} -> Distributor SKU ${posMappingForm.distributor_sku}.`,
    });
    loadStorePortalData();
  }

  async function handleImportPosTransaction(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const res = await fetch(`/api/v1/stores/${selectedStoreId}/pos`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        action: "import_transactions",
        provider_name: "Lightspeed_Restaurant_POS",
        period_start: "2026-11-01",
        period_end: "2026-11-08",
        transactions: [
          {
            external_tx_id: posImportForm.external_tx_id,
            transaction_date: posImportForm.transaction_date,
            pos_item_code: posImportForm.pos_item_code,
            quantity_sold: Number(posImportForm.quantity_sold),
          },
        ],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFeedback({ tone: "critical", text: data?.error?.message || "POS import failed" });
      return;
    }
    setFeedback({
      tone: data.duplicates_skipped > 0 || data.validation_errors?.length > 0 ? "warning" : "ok",
      text: `POS Batch ${data.import_ref}: Imported ${data.records_imported}, Duplicates Skipped ${data.duplicates_skipped}, Errors ${data.validation_errors?.length || 0}.`,
    });
    loadStorePortalData();
  }

  async function handleAcknowledgeAlert(alertId: string, status: "acknowledged" | "resolved") {
    const res = await fetch("/api/v1/stores/alerts", {
      method: "PATCH",
      headers: getHeaders(),
      body: JSON.stringify({ alert_id: alertId, status }),
    });
    if (res.ok) {
      setFeedback({ tone: "ok", text: `Alert ${alertId} marked as ${status}.` });
      if (viewMode === "distributor_consolidated") loadDistributorData();
      else loadStorePortalData();
    }
  }

  return (
    <div className="space-y-5">
      {/* Scope & Governance Banner */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-xs text-blue-950 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Store className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
            <div>
              <p className="font-semibold">
                Module 13 · Fast-Food Store / Vendor Monitoring & Consolidated Purchasing Analytics
              </p>
              <p className="mt-0.5 text-[11px] text-blue-800">
                Provides restricted store/vendor portals with isolated purchasing, invoice, and transparent consumption
                analytics, plus distributor-wide consolidated multi-store performance.{" "}
                <span className="font-semibold">
                  Purchase quantities are never equated to exact kitchen consumption without connected POS/inventory
                  data.
                </span>
              </p>
            </div>
          </div>

          {/* Role & Perspective Switcher */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={actorKey}
              onChange={(e) => {
                const nextActor = e.target.value;
                setActorKey(nextActor);
                setFeedback(null);
                if (nextActor.includes("mil01")) {
                  setViewMode("store_portal");
                  setSelectedStoreId("STR-MIL-01");
                } else if (nextActor.includes("mil02")) {
                  setViewMode("store_portal");
                  setSelectedStoreId("STR-MIL-02");
                }
              }}
              className="rounded-lg border border-blue-300 bg-white px-2.5 py-1.5 text-xs font-medium text-marine-navy"
              aria-label="Active RBAC Identity"
            >
              <option value="distributor_admin">Actor: Marco Bellini (Distributor Admin)</option>
              <option value="store_owner_mil01">Actor: Giulia Ferri (Store Owner · STR-MIL-01)</option>
              <option value="store_manager_mil01">Actor: Davide Conti (Store Manager · STR-MIL-01)</option>
              <option value="store_staff_mil01">Actor: Matteo Galli (Store Staff · STR-MIL-01 · No Financials)</option>
              <option value="store_owner_mil02">Actor: Chiara Lombardi (Store Owner · STR-MIL-02)</option>
            </select>

            <div className="flex rounded-lg border border-blue-300 bg-white p-0.5">
              <button
                type="button"
                onClick={() => {
                  setViewMode("distributor_consolidated");
                  setFeedback(null);
                }}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-semibold transition-all",
                  viewMode === "distributor_consolidated"
                    ? "bg-primary text-primary-foreground"
                    : "text-marine-mid/80 hover:bg-black/[0.04]"
                )}
              >
                Distributor Consolidated View
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode("store_portal");
                  setFeedback(null);
                }}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-semibold transition-all",
                  viewMode === "store_portal"
                    ? "bg-primary text-primary-foreground"
                    : "text-marine-mid/80 hover:bg-black/[0.04]"
                )}
              >
                Individual Store Dashboard
              </button>
            </div>
          </div>
        </div>
      </div>

      {feedback && (
        <div
          className={cn(
            "flex items-center justify-between rounded-xl border px-4 py-3 text-xs font-medium",
            feedback.tone === "ok"
              ? "border-marine-ocean/60 bg-marine-ocean/20 text-marine-navy"
              : feedback.tone === "warning"
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-red-200 bg-red-50 text-red-900"
          )}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="ml-4 text-[11px] underline opacity-75 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* =====================================================================
          MODE 1: DISTRIBUTOR CONSOLIDATED VIEW
         ===================================================================== */}
      {viewMode === "distributor_consolidated" && (
        <div className="space-y-5">
          {/* Distributor Sub-Navigation & Filters */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: "consolidated", label: "Consolidated Network & Analytics", icon: Layers },
                  { id: "comparison", label: "Store A vs Store B Comparison", icon: ArrowLeftRight },
                  { id: "accounts", label: "Store Account Directory & Onboarding", icon: Building2 },
                  { id: "alerts", label: "Monitoring Alerts & Thresholds", icon: AlertTriangle },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setDistTab(tab.id)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                      distTab === tab.id
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={franchiseGroupFilter}
                onChange={(e) => setFranchiseGroupFilter(e.target.value)}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs"
              >
                <option value="all">All Franchise Groups</option>
                {(consolidatedData?.franchise_groups || []).map((g: string) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>

              <select
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value)}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs"
              >
                <option value="all">All Regions</option>
                {(consolidatedData?.regions || []).map((r: string) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>

              <Can permission="stores.export" mode="hide">
                <a
                  href={`/api/v1/stores/consolidated/export?franchise_group=${encodeURIComponent(franchiseGroupFilter)}&region=${encodeURIComponent(regionFilter)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export Consolidated CSV
                </a>
              </Can>
            </div>
          </div>

          {consolidatedData && distTab === "consolidated" && (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <KpiCard
                  label="Associated Stores"
                  value={String(consolidatedData.summary.total_associated_stores)}
                  change={`${consolidatedData.summary.active_stores} active · ${consolidatedData.summary.watch_stores} watch · ${consolidatedData.summary.suspended_stores} suspended`}
                  trend="flat"
                  icon={<Store className="h-4 w-4" />}
                />
                <KpiCard
                  label="Consolidated Store Spend"
                  value={money(consolidatedData.summary.total_purchases_cents)}
                  change={`${number(consolidatedData.summary.total_ordered_cases)} cases ordered`}
                  trend="up"
                  icon={<ShoppingBag className="h-4 w-4" />}
                />
                <KpiCard
                  label="Delivered vs Ordered"
                  value={`${number(consolidatedData.summary.total_delivered_cases)} / ${number(consolidatedData.summary.total_ordered_cases)} cases`}
                  change="Actual POD delivered cases"
                  trend="up"
                  icon={<Package className="h-4 w-4" />}
                />
                <KpiCard
                  label="Est. Store Consumption"
                  value={`${number(consolidatedData.summary.total_estimated_consumption_cases)} cases`}
                  change="Directional & POS-derived combined"
                  trend="flat"
                  tone="warning"
                  icon={<Scale className="h-4 w-4" />}
                />
                <KpiCard
                  label="Store Receivables"
                  value={money(consolidatedData.summary.total_outstanding_receivables_cents)}
                  change="Open & overdue store invoices"
                  trend="down"
                  icon={<CreditCard className="h-4 w-4" />}
                />
              </div>

              <div className="grid gap-5 xl:grid-cols-3">
                <Surface className="xl:col-span-2">
                  <SectionHeader
                    eyebrow="Multi-Store Performance"
                    title="Consolidated Purchasing & Consumption by Store"
                    description="Click 'Inspect Store Portal' on any row to drill into its isolated store dashboard, order history, consumption calculator, and POS mappings."
                  />
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase text-muted-foreground">
                          <th className="px-4 py-3">Store & Franchise Group</th>
                          <th className="px-3 py-3">Status</th>
                          <th className="px-3 py-3 text-right">Orders</th>
                          <th className="px-3 py-3 text-right">Purchases</th>
                          <th className="px-3 py-3 text-right">Ordered / Deliv.</th>
                          <th className="px-3 py-3 text-right">Est. Consumed</th>
                          <th className="px-3 py-3">Data Source</th>
                          <th className="px-3 py-3 text-right">Receivables</th>
                          <th className="px-4 py-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {consolidatedData.spending_by_store.map((s: any) => (
                          <tr key={s.store_id} className="hover:bg-muted/20">
                            <td className="px-4 py-3">
                              <div className="font-semibold text-foreground">
                                {s.store_name}{" "}
                                <span className="font-mono text-[10px] text-muted-foreground">({s.store_code})</span>
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {s.parent_franchise_group} · {s.city} ({s.region})
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <Badge tone={statusTone(s.status)} dot>
                                {titleCase(s.status)}
                              </Badge>
                            </td>
                            <td className="px-3 py-3 text-right font-mono">{s.orders_count}</td>
                            <td className="px-3 py-3 text-right font-semibold">{money(s.total_purchases_cents)}</td>
                            <td className="px-3 py-3 text-right font-mono">
                              {s.ordered_cases} / {s.delivered_cases} c
                            </td>
                            <td className="px-3 py-3 text-right font-mono">
                              {s.estimated_consumption_cases} c
                            </td>
                            <td className="px-3 py-3">
                              <Badge tone={s.pos_connection_status === "active" ? "ok" : "warning"}>
                                {s.pos_connection_status === "active" ? "POS Connected" : "Directional Est."}
                              </Badge>
                            </td>
                            <td className="px-3 py-3 text-right font-mono">
                              {money(s.outstanding_receivables_cents)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedStoreId(s.store_id);
                                  setViewMode("store_portal");
                                }}
                                className="rounded-md bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/20"
                              >
                                Inspect Store
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Surface>

                <Surface>
                  <SectionHeader
                    eyebrow="Cross-Store Product Demand"
                    title="Top Purchased Products Across Stores"
                    description="Aggregated distributor SKU volume across all associated fast-food stores."
                  />
                  <div className="divide-y divide-border">
                    {consolidatedData.purchases_by_product.slice(0, 7).map((p: any) => (
                      <div key={p.sku} className="flex items-center justify-between px-4 py-3 text-xs">
                        <div>
                          <p className="font-semibold text-foreground">{p.product_name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            <span className="font-mono">{p.sku}</span> · Ordered by {p.stores_ordering_count} stores (
                            {p.orders_count} orders)
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">{money(p.total_spend_cents)}</p>
                          <p className="font-mono text-[11px] text-muted-foreground">{p.ordered_cases} cases</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Surface>
              </div>
            </div>
          )}

          {/* TAB 2: STORE A VS STORE B COMPARISON */}
          {distTab === "comparison" && comparisonData && (
            <div className="space-y-5">
              <Surface className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold">Side-by-Side Store & Product Demand Comparison</h3>
                    <p className="text-xs text-muted-foreground">{comparisonData.calculation_definition}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={compareStoreA}
                      onChange={(e) => setCompareStoreA(e.target.value)}
                      className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold"
                    >
                      {storeAccounts.map((s) => (
                        <option key={s.id} value={s.id}>
                          Store A: {s.name} ({s.id})
                        </option>
                      ))}
                    </select>
                    <span className="text-xs font-bold text-muted-foreground">VS</span>
                    <select
                      value={compareStoreB}
                      onChange={(e) => setCompareStoreB(e.target.value)}
                      className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold"
                    >
                      {storeAccounts.map((s) => (
                        <option key={s.id} value={s.id}>
                          Store B: {s.name} ({s.id})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </Surface>

              <div className="grid gap-4 md:grid-cols-2">
                {[comparisonData.store_a, comparisonData.store_b].map((st: any, idx: number) => (
                  <Surface key={st.store_id} className="p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-[11px] font-semibold uppercase text-muted-foreground">
                          {idx === 0 ? "Store A Benchmark" : "Store B Benchmark"} · {st.franchise_group}
                        </p>
                        <h4 className="mt-1 text-base font-bold">
                          {st.store_name} ({st.store_id})
                        </h4>
                      </div>
                      <Badge tone={st.pos_connected ? "ok" : "warning"}>{st.data_completeness_note}</Badge>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4 text-xs">
                      <div>
                        <p className="text-muted-foreground">Total Purchases</p>
                        <p className="mt-0.5 text-sm font-bold">{money(st.total_purchases_cents)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Ordered / Delivered</p>
                        <p className="mt-0.5 font-mono text-sm font-bold">
                          {st.ordered_cases} / {st.delivered_cases} c
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Avg Order Value</p>
                        <p className="mt-0.5 text-sm font-bold">{money(st.average_order_value_cents)}</p>
                      </div>
                    </div>
                  </Surface>
                ))}
              </div>

              <Surface>
                <SectionHeader
                  eyebrow="SKU Demand Variance"
                  title="Product-Level Purchasing Comparison"
                  description="Compares ordered case volumes and spend per SKU between the two selected stores."
                />
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase text-muted-foreground">
                        <th className="px-4 py-3">SKU & Product</th>
                        <th className="px-4 py-3 text-right">{comparisonData.store_a.store_name}</th>
                        <th className="px-4 py-3 text-right">{comparisonData.store_b.store_name}</th>
                        <th className="px-4 py-3 text-right">Case Difference (A - B)</th>
                        <th className="px-4 py-3 text-right">Spend Difference (A - B)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {comparisonData.product_demand_comparison.map((row: any) => (
                        <tr key={row.sku}>
                          <td className="px-4 py-3">
                            <span className="font-semibold">{row.product_name}</span>{" "}
                            <span className="font-mono text-[11px] text-muted-foreground">({row.sku})</span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            {row.store_a_cases} c ({money(row.store_a_spend_cents)})
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            {row.store_b_cases} c ({money(row.store_b_spend_cents)})
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-semibold">
                            {row.difference_cases > 0 ? `+${row.difference_cases}` : row.difference_cases} cases
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-semibold">
                            {money(row.difference_spend_cents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Surface>
            </div>
          )}

          {/* TAB 3: STORE ACCOUNT DIRECTORY & ONBOARDING */}
          {distTab === "accounts" && (
            <div className="grid gap-5 xl:grid-cols-3">
              <Surface className="xl:col-span-2">
                <SectionHeader
                  eyebrow="Store / Vendor Account Governance"
                  title="Associated Fast-Food Stores & Franchise Accounts"
                  description="Manage store status (Active / Watch / Suspended), pricing contracts, credit limits, and assigned store users."
                />
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase text-muted-foreground">
                        <th className="px-4 py-3">Store Ref & Code</th>
                        <th className="px-3 py-3">Franchise Group</th>
                        <th className="px-3 py-3">Contract & Credit</th>
                        <th className="px-3 py-3">Users</th>
                        <th className="px-3 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Controls</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {storeAccounts.map((st) => (
                        <tr key={st.id}>
                          <td className="px-4 py-3">
                            <div className="font-semibold">{st.name}</div>
                            <div className="font-mono text-[11px] text-muted-foreground">
                              {st.id} · {st.store_code} · {st.city}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-[11px]">
                            {st.parent_franchise_group || "Independent"}
                          </td>
                          <td className="px-3 py-3 text-[11px]">
                            <div className="font-mono">{st.price_book_code}</div>
                            <div className="text-muted-foreground">
                              Limit: {money(st.credit_limit_cents)} ({st.credit_utilization_pct}% used)
                            </div>
                          </td>
                          <td className="px-3 py-3 font-mono">{st.assigned_users_count} users</td>
                          <td className="px-3 py-3">
                            <Badge tone={statusTone(st.status)} dot>
                              {titleCase(st.status)}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end gap-1.5">
                              {st.status !== "active" && (
                                <Can permission="stores.manage" mode="disable">
                                  <button
                                    type="button"
                                    onClick={() => handleToggleStoreStatus(st.id, "active")}
                                    className="rounded border border-marine-ocean/60 bg-marine-ocean/25 px-2 py-1 text-[10px] font-semibold text-marine-mid/90"
                                  >
                                    Activate
                                  </button>
                                </Can>
                              )}
                              {st.status !== "suspended" && (
                                <Can permission="stores.manage" mode="disable">
                                  <button
                                    type="button"
                                    onClick={() => handleToggleStoreStatus(st.id, "suspended")}
                                    className="rounded border border-red-300 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-800"
                                  >
                                    Suspend
                                  </button>
                                </Can>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedStoreId(st.id);
                                  setViewMode("store_portal");
                                }}
                                className="rounded bg-primary px-2 py-1 text-[10px] font-semibold text-primary-foreground"
                              >
                                Open
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Surface>

              <Surface className="p-5">
                <SectionHeader
                  eyebrow="Onboarding"
                  title="Create Store / Vendor Account"
                  description="Provision a restricted store account under a parent franchise group with contract pricing."
                />
                <form onSubmit={handleCreateStore} className="mt-4 space-y-3 text-xs">
                  <div>
                    <label className="block font-semibold text-foreground">Store Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Burger & Focaccia Porta Romana"
                      value={newStoreForm.name}
                      onChange={(e) => setNewStoreForm({ ...newStoreForm, name: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-border px-3 py-1.5"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-semibold text-foreground">Store Code *</label>
                      <input
                        type="text"
                        required
                        placeholder="MB-MIL-09"
                        value={newStoreForm.store_code}
                        onChange={(e) => setNewStoreForm({ ...newStoreForm, store_code: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-border px-3 py-1.5 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-foreground">City *</label>
                      <input
                        type="text"
                        required
                        value={newStoreForm.city}
                        onChange={(e) => setNewStoreForm({ ...newStoreForm, city: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-border px-3 py-1.5"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-semibold text-foreground">Parent Franchise Group</label>
                    <input
                      type="text"
                      value={newStoreForm.parent_franchise_group}
                      onChange={(e) =>
                        setNewStoreForm({ ...newStoreForm, parent_franchise_group: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-border px-3 py-1.5"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-semibold text-foreground">Credit Limit (EUR)</label>
                      <input
                        type="number"
                        value={newStoreForm.credit_limit_eur}
                        onChange={(e) => setNewStoreForm({ ...newStoreForm, credit_limit_eur: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-border px-3 py-1.5 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-foreground">Pricing Contract</label>
                      <input
                        type="text"
                        value={newStoreForm.price_book_code}
                        onChange={(e) => setNewStoreForm({ ...newStoreForm, price_book_code: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-border px-3 py-1.5 font-mono"
                      />
                    </div>
                  </div>
                  <Can permission="stores.manage" mode="disable">
                    <button
                      type="submit"
                      className="w-full rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground hover:opacity-95"
                    >
                      Create Restricted Store Account
                    </button>
                  </Can>
                </form>
              </Surface>
            </div>
          )}

          {/* TAB 4: ALERTS */}
          {distTab === "alerts" && consolidatedData && (
            <Surface>
              <SectionHeader
                eyebrow="Non-Blocking Store Monitoring"
                title="Store Purchasing, Credit & Consumption Alerts"
                description="Alerts highlight unusual drops/spikes, missing POS data, replenishment thresholds, and stock reconciliation variances without automatically blocking store orders."
              />
              <div className="divide-y divide-border">
                {(consolidatedData.alerts || []).map((a: any) => (
                  <div key={a.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 text-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          tone={
                            a.severity === "critical"
                              ? "critical"
                              : a.severity === "warning"
                                ? "warning"
                                : "info"
                          }
                          dot
                        >
                          {a.severity.toUpperCase()}
                        </Badge>
                        <span className="font-mono text-[11px] text-muted-foreground">{a.alert_ref}</span>
                        <span className="font-semibold text-foreground">{a.store_name}</span>
                        <Badge tone="neutral">{a.alert_type}</Badge>
                      </div>
                      <p className="font-semibold text-foreground">{a.title}</p>
                      <p className="text-muted-foreground">{a.detail}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={a.status === "open" ? "warning" : "ok"}>{a.status}</Badge>
                      {a.status === "open" && (
                        <>
                          <Can permission="stores.read" mode="disable">
                            <button
                              type="button"
                              onClick={() => handleAcknowledgeAlert(a.id, "acknowledged")}
                              className="rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold hover:bg-muted"
                            >
                              Acknowledge
                            </button>
                          </Can>
                          <Can permission="stores.read" mode="disable">
                            <button
                              type="button"
                              onClick={() => handleAcknowledgeAlert(a.id, "resolved")}
                              className="rounded-lg bg-marine-steel px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-marine-steelLight"
                            >
                              Resolve
                            </button>
                          </Can>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Surface>
          )}
        </div>
      )}

      {/* =====================================================================
          MODE 2: INDIVIDUAL STORE / VENDOR PORTAL VIEW
         ===================================================================== */}
      {viewMode === "store_portal" && (
        <div className="space-y-5">
          {/* Store Selector & Sub-Tab Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">Selected Store Account:</span>
              <select
                value={selectedStoreId}
                onChange={(e) => {
                  setSelectedStoreId(e.target.value);
                  setFeedback(null);
                }}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-bold"
              >
                <option value="STR-MIL-01">STR-MIL-01 · Gourmet Market Brera (POS Connected)</option>
                <option value="STR-MIL-02">STR-MIL-02 · Bottega Alimentare Navigli (No POS Feed)</option>
                <option value="STR-TUR-03">STR-TUR-03 · Bistrot Sabaudo Torino</option>
                <option value="STR-ROM-04">STR-ROM-04 · Osteria Moderna Trastevere</option>
                <option value="STR-FLO-05">STR-FLO-05 · Dispensa Toscana Firenze</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: "dashboard", label: "Store Dashboard & Analytics", icon: Activity },
                  { id: "orders", label: "Purchase & Order History", icon: ClipboardList },
                  { id: "consumption", label: "Consumption Estimates", icon: Scale },
                  { id: "inventory", label: "Stock Reconciliation", icon: Calculator },
                  { id: "pos_adapter", label: "POS Adapter & SKU Mapping", icon: Database },
                  { id: "users_access", label: "Users, RBAC & History", icon: Users },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStoreTab(tab.id)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                      storeTab === tab.id
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Store Header Banner */}
          {storeDashboard && (
            <Surface className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-primary">
                      {storeDashboard.store.id} ({storeDashboard.store.store_code})
                    </span>
                    <Badge tone={statusTone(storeDashboard.store.status)} dot>
                      {titleCase(storeDashboard.store.status)}
                    </Badge>
                    <Badge tone="info">
                      Franchise Group: {storeDashboard.store.parent_franchise_group || "Independent"}
                    </Badge>
                  </div>
                  <h2 className="mt-1 text-lg font-bold">{storeDashboard.store.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {storeDashboard.store.delivery_address} · Contract:{" "}
                    <span className="font-mono font-semibold">{storeDashboard.store.price_book_code}</span> · Payment
                    Terms: Net {storeDashboard.store.payment_terms_days}d
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Badge tone={storeDashboard.consumption_estimates.pos_connected ? "ok" : "warning"} dot>
                    {storeDashboard.consumption_estimates.pos_connected
                      ? "POS Connected (Lightspeed_Restaurant_POS)"
                      : "POS Unconfigured (Directional Estimates Only)"}
                  </Badge>
                </div>
              </div>
            </Surface>
          )}

          {/* STORE TAB 1: STORE OVERVIEW, PURCHASES, SPENDING & PRODUCT ANALYTICS */}
          {storeDashboard && storeTab === "dashboard" && (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard
                  label="Total Store Purchases"
                  value={money(storeDashboard.purchases.total_purchases_cents)}
                  change={`${storeDashboard.purchases.total_orders_count} orders (${storeDashboard.purchases.delivered_orders_count} delivered, ${storeDashboard.purchases.pending_orders_count} pending)`}
                  trend="up"
                  icon={<ShoppingBag className="h-4 w-4" />}
                />
                <KpiCard
                  label="Ordered vs Delivered"
                  value={`${storeDashboard.purchases.total_ordered_cases} / ${storeDashboard.purchases.total_delivered_cases} cases`}
                  change="Ordered cases vs POD delivered cases"
                  trend="up"
                  icon={<Package className="h-4 w-4" />}
                />
                <KpiCard
                  label="Spending & MoM Trend"
                  value={
                    storeDashboard.spending.financials_restricted
                      ? "Restricted (Staff Role)"
                      : money(storeDashboard.spending.average_order_value_cents)
                  }
                  change={
                    storeDashboard.spending.financials_restricted
                      ? "Financials hidden for store_staff"
                      : `Avg Order Value · ${storeDashboard.spending.period_growth_pct >= 0 ? "+" : ""}${storeDashboard.spending.period_growth_pct}% vs prior period`
                  }
                  trend="up"
                  icon={<TrendingUp className="h-4 w-4" />}
                />
                <KpiCard
                  label="Outstanding Invoices"
                  value={
                    storeDashboard.spending.financials_restricted
                      ? "Restricted"
                      : money(storeDashboard.spending.unpaid_amount_cents)
                  }
                  change={
                    storeDashboard.spending.financials_restricted
                      ? "Requires store_owner / store_manager"
                      : `${money(storeDashboard.spending.paid_amount_cents)} paid · ${money(storeDashboard.spending.overdue_amount_cents)} overdue`
                  }
                  trend="flat"
                  tone={storeDashboard.spending.overdue_amount_cents > 0 ? "warning" : "default"}
                  icon={<CreditCard className="h-4 w-4" />}
                />
              </div>

              <div className="grid gap-5 xl:grid-cols-3">
                <Surface className="xl:col-span-2">
                  <SectionHeader
                    eyebrow="Store Product Analytics"
                    title="Purchases by Product, Frequency & Price Trends"
                    description="Shows ordered vs allocated cases, order frequency, and contract unit price trends."
                  />
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase text-muted-foreground">
                          <th className="px-4 py-3">SKU & Product</th>
                          <th className="px-3 py-3 text-right">Order Freq.</th>
                          <th className="px-3 py-3 text-right">Ordered Cases</th>
                          <th className="px-3 py-3 text-right">Total Spend</th>
                          <th className="px-4 py-3 text-right">Unit Price Range</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {storeDashboard.product_analytics.product_price_trends.map((p: any) => (
                          <tr key={p.sku}>
                            <td className="px-4 py-3">
                              <span className="font-semibold">{p.product_name}</span>{" "}
                              <span className="font-mono text-[11px] text-muted-foreground">({p.sku})</span>
                            </td>
                            <td className="px-3 py-3 text-right font-mono">
                              {
                                storeDashboard.product_analytics.purchase_frequency.find((f: any) => f.sku === p.sku)
                                  ?.orders_count
                              }{" "}
                              orders
                            </td>
                            <td className="px-3 py-3 text-right font-mono">
                              {
                                storeDashboard.purchases.purchases_by_sku.find((s: any) => s.sku === p.sku)
                                  ?.ordered_cases
                              }{" "}
                              cases
                            </td>
                            <td className="px-3 py-3 text-right font-semibold">
                              {money(
                                storeDashboard.purchases.purchases_by_sku.find((s: any) => s.sku === p.sku)
                                  ?.total_spend_cents || 0
                              )}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-[11px]">
                              {money(p.min_unit_price_cents)} – {money(p.max_unit_price_cents)}{" "}
                              {p.price_change_pct !== 0 && (
                                <span className="text-amber-700">({p.price_change_pct}%)</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Surface>

                <Surface className="p-5">
                  <SectionHeader
                    eyebrow="Monthly Spending Trend"
                    title="Period Spend & Order Volume"
                    description="Historical monthly purchasing trajectory for this store."
                  />
                  {storeDashboard.spending.financials_restricted ? (
                    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                      <Lock className="mb-1 h-4 w-4" />
                      <p className="font-semibold">Financial Statements Restricted</p>
                      <p className="mt-1">
                        Your current role (<span className="font-mono">store_staff</span>) is restricted from viewing
                        invoice totals and spending trends. Switch to <span className="font-mono">store_owner</span> or{" "}
                        <span className="font-mono">store_manager</span>.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {storeDashboard.spending.monthly_spending_trends.map((m: any) => (
                        <div
                          key={m.month}
                          className="flex items-center justify-between rounded-lg border border-border p-3 text-xs"
                        >
                          <div>
                            <p className="font-mono font-bold">{m.month}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {m.orders_count} orders · {m.cases_total} cases
                            </p>
                          </div>
                          <p className="text-sm font-bold">{money(m.spend_cents)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </Surface>
              </div>
            </div>
          )}

          {/* STORE TAB 2: PURCHASE & ORDER HISTORY */}
          {storeOrders && storeTab === "orders" && (
            <Surface>
              <SectionHeader
                eyebrow="Connected to Customer Order Module"
                title="Store Purchase, Delivery & Invoice History"
                description="Displays ordered vs delivered cases (including partial deliveries), lot allocations, and linked invoice status."
                action={
                  <div className="flex flex-wrap items-center gap-2">
                    <ViewOnlyBadge
                      modifyPermissions={[
                        "stores.manage",
                        "stores.export",
                        "stores.pos.manage",
                        "stores.consumption.manage",
                        "users.manage",
                      ]}
                    />
                    <input
                      type="text"
                      placeholder="Filter SKU (e.g. SKU-SAL-001)"
                      value={skuFilter}
                      onChange={(e) => setSkuFilter(e.target.value)}
                      className="rounded-lg border border-border px-2.5 py-1 text-xs font-mono"
                    />
                    <select
                      value={orderStatusFilter}
                      onChange={(e) => setOrderStatusFilter(e.target.value)}
                      className="rounded-lg border border-border px-2.5 py-1 text-xs"
                    >
                      <option value="all">All Order Statuses</option>
                      <option value="delivered">Delivered</option>
                      <option value="confirmed">Confirmed</option>
                      <option value="picking">Picking</option>
                    </select>
                    <Can permission="stores.export" mode="hide">
                      <a
                        href={`/api/v1/stores/${selectedStoreId}/orders/export`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Export Store CSV
                      </a>
                    </Can>
                  </div>
                }
              />
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase text-muted-foreground">
                      <th className="px-4 py-3">Order & Delivery Date</th>
                      <th className="px-3 py-3">Order Status</th>
                      <th className="px-3 py-3 text-right">Ordered / Deliv.</th>
                      <th className="px-3 py-3">Partial Delivery</th>
                      <th className="px-3 py-3">SKU Lines & Lot Numbers</th>
                      <th className="px-3 py-3">Invoice & Payment</th>
                      <th className="px-4 py-3 text-right">Order Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(storeOrders.orders || []).map((o: any) => (
                      <tr key={o.order_id}>
                        <td className="px-4 py-3">
                          <div className="font-mono font-bold">{o.order_number}</div>
                          <div className="text-[11px] text-muted-foreground">{o.delivery_date}</div>
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={statusTone(o.order_status)} dot>
                            {titleCase(o.order_status)}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 text-right font-mono">
                          {o.ordered_cases} / {o.delivered_cases} c
                        </td>
                        <td className="px-3 py-3">
                          {o.is_partial_delivery ? (
                            <Badge tone="warning">Partial Delivery</Badge>
                          ) : (
                            <Badge tone="ok">Full / On Track</Badge>
                          )}
                        </td>
                        <td className="px-3 py-3 text-[11px]">
                          {(o.lines || []).map((l: any) => (
                            <div key={`${o.order_id}-${l.sku}`}>
                              <span className="font-mono font-semibold">{l.sku}</span>: {l.cases_ordered}c ordered (
                              {l.cases_allocated}c alloc · Lot {l.allocated_lot || "Pending"})
                            </div>
                          ))}
                        </td>
                        <td className="px-3 py-3 text-[11px]">
                          {o.invoices && o.invoices.length > 0 ? (
                            o.invoices.map((inv: any) => (
                              <div key={inv.id}>
                                <span className="font-mono font-semibold">{inv.number}</span>:{" "}
                                <Badge tone={statusTone(inv.status)}>{inv.status}</Badge> (Unpaid:{" "}
                                {money(inv.outstanding_cents)})
                              </div>
                            ))
                          ) : (
                            <span className="text-muted-foreground">Not yet invoiced</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold">
                          {o.total_cents !== null ? money(o.total_cents) : "Restricted"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Surface>
          )}

          {/* STORE TAB 3: TRANSPARENT PRODUCT CONSUMPTION ESTIMATION */}
          {consumptionData && storeTab === "consumption" && (
            <div className="space-y-5">
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950">
                <p className="font-bold">Transparency & Estimation Methodology Rule</p>
                <p className="mt-1">{consumptionData.methodology_note}</p>
              </div>

              <div className="grid gap-5 xl:grid-cols-3">
                <Surface className="xl:col-span-2">
                  <SectionHeader
                    eyebrow="Purchases vs Estimated vs Actual Consumption"
                    title="SKU Consumption & Replenishment Analysis"
                    description="Strictly separates Purchased Qty, Delivered Qty, Estimated Consumption (with waste %), and Actual POS/Inventory Consumption."
                  />
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase text-muted-foreground">
                          <th className="px-4 py-3">SKU & Product</th>
                          <th className="px-3 py-3">Classification</th>
                          <th className="px-3 py-3 text-right">Purchased / Deliv.</th>
                          <th className="px-3 py-3 text-right">Est. Consumed</th>
                          <th className="px-3 py-3 text-right">Actual (POS)</th>
                          <th className="px-3 py-3 text-right">Est. Remaining</th>
                          <th className="px-4 py-3">Method & Missing Data Flags</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {(consumptionData.items || []).map((item: any) => (
                          <tr key={item.sku}>
                            <td className="px-4 py-3">
                              <div className="font-semibold">{item.product_name}</div>
                              <div className="font-mono text-[11px] text-muted-foreground">
                                {item.sku} · Waste allow: {item.waste_Shrinkage_allowance_pct}%
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <Badge tone={item.data_classification === "ACTUAL" ? "ok" : "warning"} dot>
                                {item.data_classification} ({item.confidence_level})
                              </Badge>
                            </td>
                            <td className="px-3 py-3 text-right font-mono">
                              {item.purchased_cases} / {item.delivered_cases} c
                            </td>
                            <td className="px-3 py-3 text-right font-mono font-semibold">
                              {item.estimated_consumed_cases} c ({item.estimated_consumed_kg} kg)
                            </td>
                            <td className="px-3 py-3 text-right font-mono">
                              {item.actual_consumed_cases !== null ? (
                                <span className="font-bold text-marine-mid">{item.actual_consumed_cases} c</span>
                              ) : (
                                <span className="text-muted-foreground">N/A (No POS)</span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right font-mono">
                              {item.estimated_remaining_stock_cases !== null ? (
                                <span>
                                  {item.estimated_remaining_stock_cases} c{" "}
                                  {item.replenishment_Alert_triggered && (
                                    <Badge tone="critical">Reorder</Badge>
                                  )}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">No Count Data</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-[11px]">
                              <div className="font-semibold">{item.estimation_method}</div>
                              {item.missing_data_flags?.length > 0 ? (
                                <div className="text-amber-700">
                                  Missing: {item.missing_data_flags.join(", ")}
                                </div>
                              ) : (
                                <div className="text-marine-mid">Complete POS + Inventory Data</div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Surface>

                <Surface className="p-5">
                  <SectionHeader
                    eyebrow="Estimation Parameters"
                    title="Configure SKU Consumption Model"
                    description="Configure store usage rate, waste/shrinkage allowance %, and replenishment alert threshold."
                  />
                  <form onSubmit={handleUpdateConsumptionConfig} className="mt-4 space-y-3 text-xs">
                    <div>
                      <label className="block font-semibold">Distributor SKU</label>
                      <input
                        type="text"
                        value={consumptionConfigForm.sku}
                        onChange={(e) => setConsumptionConfigForm({ ...consumptionConfigForm, sku: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-border px-3 py-1.5 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold">Estimation Method</label>
                      <select
                        value={consumptionConfigForm.estimation_method}
                        onChange={(e) =>
                          setConsumptionConfigForm({
                            ...consumptionConfigForm,
                            estimation_method: e.target.value as any,
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-border px-3 py-1.5"
                      >
                        <option value="pos_recipe_actual">POS Recipe Actual</option>
                        <option value="delivery_cycle_interpolation">Delivery Cycle Interpolation</option>
                        <option value="rolling_average">Rolling Average</option>
                        <option value="manual_store_rate">Manual Store Rate</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block font-semibold">Daily Cases</label>
                        <input
                          type="number"
                          step="0.1"
                          value={consumptionConfigForm.estimated_daily_usage_cases}
                          onChange={(e) =>
                            setConsumptionConfigForm({
                              ...consumptionConfigForm,
                              estimated_daily_usage_cases: e.target.value,
                            })
                          }
                          className="mt-1 w-full rounded-lg border border-border px-2 py-1.5 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold">Waste %</label>
                        <input
                          type="number"
                          step="0.1"
                          value={consumptionConfigForm.waste_Shrinkage_allowance_pct}
                          onChange={(e) =>
                            setConsumptionConfigForm({
                              ...consumptionConfigForm,
                              waste_Shrinkage_allowance_pct: e.target.value,
                            })
                          }
                          className="mt-1 w-full rounded-lg border border-border px-2 py-1.5 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold">Min Stock</label>
                        <input
                          type="number"
                          step="0.5"
                          value={consumptionConfigForm.replenishment_threshold_cases}
                          onChange={(e) =>
                            setConsumptionConfigForm({
                              ...consumptionConfigForm,
                              replenishment_threshold_cases: e.target.value,
                            })
                          }
                          className="mt-1 w-full rounded-lg border border-border px-2 py-1.5 font-mono"
                        />
                      </div>
                    </div>
                    <Can permission="stores.consumption.manage" mode="disable">
                      <button
                        type="submit"
                        className="w-full rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground"
                      >
                        Save Consumption Parameters
                      </button>
                    </Can>
                  </form>
                </Surface>
              </div>
            </div>
          )}

          {/* STORE TAB 4: STORE INVENTORY VISIBILITY & RECONCILIATION */}
          {inventoryData && storeTab === "inventory" && (
            <div className="space-y-5">
              <div className="rounded-xl border border-marine-ocean/70 bg-marine-ocean/15 p-4 text-xs text-marine-navy">
                <p className="font-mono font-bold">{inventoryData.formula}</p>
                <p className="mt-1 text-muted-foreground">{inventoryData.message}</p>
              </div>

              <div className="grid gap-5 xl:grid-cols-3">
                <Surface className="xl:col-span-2">
                  <SectionHeader
                    eyebrow="Store Stock Balance Verification"
                    title="Store Inventory Snapshots & Variance Reconciliation"
                    description="When store inventory data is not available, no fabricated stock balances are displayed."
                  />
                  {!inventoryData.inventory_data_available ? (
                    <div className="p-8 text-center text-xs text-muted-foreground">
                      <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-amber-600" />
                      <p className="font-semibold text-foreground">
                        No Physical Store Stock Counts Recorded for {selectedStoreId}
                      </p>
                      <p className="mt-1">
                        System refuses to fabricate store closing stock balances. Use the form on the right to submit a
                        store inventory declaration or import POS inventory counts.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase text-muted-foreground">
                            <th className="px-4 py-3">Snapshot & SKU</th>
                            <th className="px-2 py-3 text-right">Opening</th>
                            <th className="px-2 py-3 text-right">+ Recv</th>
                            <th className="px-2 py-3 text-right">- Consumed</th>
                            <th className="px-2 py-3 text-right">- Waste</th>
                            <th className="px-2 py-3 text-right">+/- Adj</th>
                            <th className="px-3 py-3 text-right">= Expected</th>
                            <th className="px-3 py-3 text-right">Actual</th>
                            <th className="px-4 py-3 text-right">Variance & Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {inventoryData.snapshots.map((s: any) => (
                            <tr key={s.id}>
                              <td className="px-4 py-3">
                                <div className="font-semibold">{s.product_name}</div>
                                <div className="font-mono text-[10px] text-muted-foreground">
                                  {s.snapshot_ref} · {s.sku} ({s.period_start} to {s.period_end})
                                </div>
                              </td>
                              <td className="px-2 py-3 text-right font-mono">{s.opening_stock_cases}</td>
                              <td className="px-2 py-3 text-right font-mono">+{s.deliveries_received_cases}</td>
                              <td className="px-2 py-3 text-right font-mono">-{s.recorded_consumption_cases}</td>
                              <td className="px-2 py-3 text-right font-mono">-{s.waste_spoilage_cases}</td>
                              <td className="px-2 py-3 text-right font-mono">{s.adjustments_cases}</td>
                              <td className="px-3 py-3 text-right font-mono font-bold">
                                {s.expected_closing_cases} c
                              </td>
                              <td className="px-3 py-3 text-right font-mono font-bold">
                                {s.actual_closing_cases !== null ? `${s.actual_closing_cases} c` : "Pending"}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="font-mono font-bold">
                                  {s.variance_cases !== null
                                    ? `${s.variance_cases > 0 ? "+" : ""}${s.variance_cases} c`
                                    : "—"}
                                </div>
                                <Badge
                                  tone={
                                    s.reconciliation_status === "reconciled"
                                      ? "ok"
                                      : s.reconciliation_status === "variance_flagged"
                                        ? "critical"
                                        : "warning"
                                  }
                                >
                                  {s.reconciliation_status}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Surface>

                <Surface className="p-5">
                  <SectionHeader
                    eyebrow="Store Declaration"
                    title="Record Physical Stock Count"
                    description="Computes Expected Closing Stock and reconciles against actual physical closing count."
                  />
                  <form onSubmit={handleRecordInventorySnapshot} className="mt-4 space-y-2.5 text-xs">
                    <div>
                      <label className="block font-semibold">SKU</label>
                      <input
                        type="text"
                        value={snapshotForm.sku}
                        onChange={(e) => setSnapshotForm({ ...snapshotForm, sku: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-border px-3 py-1.5 font-mono"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block font-semibold">Opening (Cases)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={snapshotForm.opening_stock_cases}
                          onChange={(e) => setSnapshotForm({ ...snapshotForm, opening_stock_cases: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-border px-2.5 py-1.5 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold">+ Received (Cases)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={snapshotForm.deliveries_received_cases}
                          onChange={(e) =>
                            setSnapshotForm({ ...snapshotForm, deliveries_received_cases: e.target.value })
                          }
                          className="mt-1 w-full rounded-lg border border-border px-2.5 py-1.5 font-mono"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block font-semibold">- Consumed</label>
                        <input
                          type="number"
                          step="0.1"
                          value={snapshotForm.recorded_consumption_cases}
                          onChange={(e) =>
                            setSnapshotForm({ ...snapshotForm, recorded_consumption_cases: e.target.value })
                          }
                          className="mt-1 w-full rounded-lg border border-border px-2 py-1.5 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold">- Waste</label>
                        <input
                          type="number"
                          step="0.1"
                          value={snapshotForm.waste_spoilage_cases}
                          onChange={(e) => setSnapshotForm({ ...snapshotForm, waste_spoilage_cases: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-border px-2 py-1.5 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold">+/- Adjust</label>
                        <input
                          type="number"
                          step="0.1"
                          value={snapshotForm.adjustments_cases}
                          onChange={(e) => setSnapshotForm({ ...snapshotForm, adjustments_cases: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-border px-2 py-1.5 font-mono"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block font-semibold">Actual Physical Closing Count (Cases)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={snapshotForm.actual_closing_cases}
                        onChange={(e) => setSnapshotForm({ ...snapshotForm, actual_closing_cases: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-border px-3 py-1.5 font-mono"
                      />
                    </div>
                    <Can permission="stores.read" mode="disable">
                      <button
                        type="submit"
                        className="w-full rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground"
                      >
                        Reconcile Store Inventory
                      </button>
                    </Can>
                  </form>
                </Surface>
              </div>
            </div>
          )}

          {/* STORE TAB 5: OPTIONAL POS ADAPTER & SKU MAPPING */}
          {posData && storeTab === "pos_adapter" && (
            <div className="grid gap-5 xl:grid-cols-3">
              <Surface className="xl:col-span-2">
                <SectionHeader
                  eyebrow="Provider Adapter Architecture"
                  title="POS SKU Recipe Mappings & Imported Transaction Batches"
                  description="Maps store POS menu items to distributor SKUs and enforces idempotent duplicate transaction prevention."
                />
                <div className="p-4">
                  <div className="mb-4 flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3 text-xs">
                    <div>
                      <p className="font-semibold">
                        Provider: <span className="font-mono">{posData.integration.provider_name}</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        External Store Ref: {posData.integration.external_store_ref || "None"} · Last Sync:{" "}
                        {posData.integration.last_sync_status}
                      </p>
                    </div>
                    <Badge tone={posData.integration.connection_status === "active" ? "ok" : "warning"} dot>
                      {posData.integration.connection_status}
                    </Badge>
                  </div>

                  <h4 className="mb-2 text-xs font-bold uppercase text-muted-foreground">
                    Active POS Item &rarr; Distributor SKU Mappings
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase text-muted-foreground">
                          <th className="px-3 py-2">POS Item Code</th>
                          <th className="px-3 py-2">POS Menu Item Name</th>
                          <th className="px-3 py-2">Distributor SKU</th>
                          <th className="px-3 py-2 text-right">Cases / POS Unit</th>
                          <th className="px-3 py-2 text-right">Kg / POS Unit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {(posData.sku_mappings || []).map((m: any) => (
                          <tr key={m.id}>
                            <td className="px-3 py-2 font-mono font-semibold">{m.pos_item_code}</td>
                            <td className="px-3 py-2">{m.pos_item_name}</td>
                            <td className="px-3 py-2 font-mono">{m.distributor_sku}</td>
                            <td className="px-3 py-2 text-right font-mono">{m.cases_per_pos_unit}</td>
                            <td className="px-3 py-2 text-right font-mono">{m.kg_per_pos_unit} kg</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </Surface>

              <div className="space-y-5">
                <Surface className="p-5">
                  <SectionHeader
                    eyebrow="Recipe Mapping"
                    title="Add POS Item Mapping"
                    description="Link a store POS menu item code to an ERP distributor SKU."
                  />
                  <form onSubmit={handleAddPosMapping} className="mt-3 space-y-2.5 text-xs">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block font-semibold">POS Item Code</label>
                        <input
                          type="text"
                          value={posMappingForm.pos_item_code}
                          onChange={(e) => setPosMappingForm({ ...posMappingForm, pos_item_code: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-border px-2.5 py-1.5 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold">Distributor SKU</label>
                        <input
                          type="text"
                          value={posMappingForm.distributor_sku}
                          onChange={(e) => setPosMappingForm({ ...posMappingForm, distributor_sku: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-border px-2.5 py-1.5 font-mono"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block font-semibold">POS Menu Item Name</label>
                      <input
                        type="text"
                        value={posMappingForm.pos_item_name}
                        onChange={(e) => setPosMappingForm({ ...posMappingForm, pos_item_name: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-border px-2.5 py-1.5"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold">Cases Consumed per POS Unit Sold</label>
                      <input
                        type="number"
                        step="0.001"
                        value={posMappingForm.cases_per_pos_unit}
                        onChange={(e) => setPosMappingForm({ ...posMappingForm, cases_per_pos_unit: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-border px-2.5 py-1.5 font-mono"
                      />
                    </div>
                    <Can permission="stores.pos.manage" mode="disable">
                      <button
                        type="submit"
                        className="w-full rounded-lg bg-primary px-3 py-2 font-semibold text-primary-foreground"
                      >
                        Save POS SKU Mapping
                      </button>
                    </Can>
                  </form>
                </Surface>

                <Surface className="p-5">
                  <SectionHeader
                    eyebrow="Idempotent POS Feed"
                    title="Import POS Sales Transaction"
                    description="Duplicate external_tx_id records are automatically skipped."
                  />
                  <form onSubmit={handleImportPosTransaction} className="mt-3 space-y-2.5 text-xs">
                    <div>
                      <label className="block font-semibold">External Transaction ID</label>
                      <input
                        type="text"
                        value={posImportForm.external_tx_id}
                        onChange={(e) => setPosImportForm({ ...posImportForm, external_tx_id: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-border px-2.5 py-1.5 font-mono"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block font-semibold">POS Item Code</label>
                        <input
                          type="text"
                          value={posImportForm.pos_item_code}
                          onChange={(e) => setPosImportForm({ ...posImportForm, pos_item_code: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-border px-2.5 py-1.5 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold">Qty Sold</label>
                        <input
                          type="number"
                          value={posImportForm.quantity_sold}
                          onChange={(e) => setPosImportForm({ ...posImportForm, quantity_sold: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-border px-2.5 py-1.5 font-mono"
                        />
                      </div>
                    </div>
                    <Can permission="stores.pos.manage" mode="disable">
                      <button
                        type="submit"
                        className="w-full rounded-lg border border-primary bg-primary/10 px-3 py-2 font-semibold text-primary hover:bg-primary/20"
                      >
                        Import POS Transaction Batch
                      </button>
                    </Can>
                  </form>
                </Surface>
              </div>
            </div>
          )}

          {/* STORE TAB 6: STORE USERS, RBAC & APPROVAL HISTORY */}
          {storeAccountDetail && storeTab === "users_access" && (
            <div className="grid gap-5 xl:grid-cols-3">
              <Surface className="xl:col-span-2">
                <SectionHeader
                  eyebrow="Restricted Store Users"
                  title="Assigned Store Users & Sub-Role Permissions"
                  description="Each store user is strictly isolated to their store_id and governed by sub-role permissions."
                />
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase text-muted-foreground">
                        <th className="px-4 py-3">Name & Email</th>
                        <th className="px-3 py-3">Store Sub-Role</th>
                        <th className="px-3 py-3">Granular Store Permissions</th>
                        <th className="px-4 py-3">Invited By</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(storeAccountDetail.assigned_users || []).map((u: any) => (
                        <tr key={u.id}>
                          <td className="px-4 py-3">
                            <div className="font-semibold">{u.name}</div>
                            <div className="font-mono text-[11px] text-muted-foreground">{u.email}</div>
                          </td>
                          <td className="px-3 py-3">
                            <Badge tone="info">{u.store_sub_role || u.role}</Badge>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-1">
                              {(u.store_permissions || []).map((perm: string) => (
                                <span
                                  key={perm}
                                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                                >
                                  {perm}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-[11px] text-muted-foreground">
                            {u.invited_by || "System"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="border-t border-border p-4">
                  <h4 className="mb-2 text-xs font-bold uppercase text-muted-foreground">
                    Account Creation & Approval Audit History
                  </h4>
                  <div className="space-y-2 text-xs">
                    {(storeAccountDetail.account_history || []).map((h: any) => (
                      <div key={h.id} className="flex items-center justify-between rounded border border-border p-2.5">
                        <div>
                          <span className="font-semibold">{h.action}</span>: {h.previous_status || "none"} →{" "}
                          <span className="font-semibold">{h.new_status}</span> ({h.reason})
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {h.actor_name} · {h.created_at}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </Surface>

              <Surface className="p-5">
                <SectionHeader
                  eyebrow="Access Management"
                  title="Invite Store Manager or Staff"
                  description="Assign a restricted user to this store account."
                />
                <form onSubmit={handleInviteUser} className="mt-4 space-y-3 text-xs">
                  <div>
                    <label className="block font-semibold">Full Name *</label>
                    <input
                      type="text"
                      required
                      value={inviteUserForm.name}
                      onChange={(e) => setInviteUserForm({ ...inviteUserForm, name: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-border px-3 py-1.5"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold">Email Address *</label>
                    <input
                      type="email"
                      required
                      value={inviteUserForm.email}
                      onChange={(e) => setInviteUserForm({ ...inviteUserForm, email: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-border px-3 py-1.5 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold">Store Sub-Role</label>
                    <select
                      value={inviteUserForm.store_sub_role}
                      onChange={(e) =>
                        setInviteUserForm({
                          ...inviteUserForm,
                          store_sub_role: e.target.value as any,
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-border px-3 py-1.5"
                    >
                      <option value="store_owner">store_owner (Full Store + Financials + User Invite)</option>
                      <option value="store_manager">store_manager (Orders + Financials + Exports)</option>
                      <option value="store_staff">store_staff (Operational Orders & Stock · No Financials)</option>
                    </select>
                  </div>
                  <Can anyOf={["stores.manage", "users.manage"]} mode="disable">
                    <button
                      type="submit"
                      className="w-full rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground"
                    >
                      Invite Store User
                    </button>
                  </Can>
                </form>
              </Surface>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
