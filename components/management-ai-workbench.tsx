"use client";

import { useState, useEffect, useTransition } from "react";
import {
  TrendingUp,
  BrainCircuit,
  AlertTriangle,
  Package,
  ShieldAlert,
  DollarSign,
  Download,
  RefreshCw,
  Search,
  CheckCircle2,
  XCircle,
  FileText,
  Truck,
  Users,
  Layers,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Building,
  BarChart3,
  Calendar,
  Clock,
  ExternalLink,
  ChevronRight,
  SlidersHorizontal,
  Bot
} from "lucide-react";
import { Badge, statusTone } from "@/components/ui";
import { Can, ViewOnlyBadge } from "@/components/access-gate";
import type {
  CeoDashboardKpis,
  BiReportSummary,
  BiReportFilter,
  DemandForecast,
  OperationalAnomaly,
  ReplenishmentSuggestion,
  GovernedAiAction,
  AiAnalysisResponse
} from "@/lib/management-ai";

export function ManagementAiWorkbench() {
  const [activeTab, setActiveTab] = useState<"kpis" | "bi" | "forecasting" | "anomalies" | "replenishment" | "governance" | "copilot">("kpis");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data states
  const [kpis, setKpis] = useState<CeoDashboardKpis | null>(null);
  const [biReport, setBiReport] = useState<BiReportSummary | null>(null);
  const [forecasts, setForecasts] = useState<DemandForecast[]>([]);
  const [anomalies, setAnomalies] = useState<OperationalAnomaly[]>([]);
  const [replenishments, setReplenishments] = useState<ReplenishmentSuggestion[]>([]);
  const [aiActions, setAiActions] = useState<GovernedAiAction[]>([]);
  
  // BI Filter
  const [biDimension, setBiDimension] = useState<"customer" | "product" | "supplier" | "warehouse" | "month">("customer");
  const [biWarehouse, setBiWarehouse] = useState<string>("");

  // Anomaly Review Modal
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [selectedAnomaly, setSelectedAnomaly] = useState<OperationalAnomaly | null>(null);
  const [reviewStatus, setReviewStatus] = useState<string>("under_review");
  const [reviewNotes, setReviewNotes] = useState<string>("");

  // AI Action Approval Modal
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState<GovernedAiAction | null>(null);
  const [actionApprovalNote, setActionApprovalNote] = useState<string>("");
  const [actionRejectReason, setActionRejectReason] = useState<string>("");
  const [actionModalMode, setActionModalMode] = useState<"approve" | "reject">("approve");

  // AI Copilot
  const [copilotPrompt, setCopilotPrompt] = useState<string>("");
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [copilotResponse, setCopilotResponse] = useState<AiAnalysisResponse | null>(null);

  const [isPending, startTransition] = useTransition();

  // Load all initial data
  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [kpisRes, biRes, foreRes, anomRes, replenRes, actRes] = await Promise.all([
        fetch("/api/v1/management/dashboard"),
        fetch(`/api/v1/management/bi?dimension=${biDimension}${biWarehouse ? `&warehouse=${biWarehouse}` : ""}`),
        fetch("/api/v1/management/forecasting"),
        fetch("/api/v1/management/anomalies"),
        fetch("/api/v1/management/replenishment"),
        fetch("/api/v1/management/ai/actions"),
      ]);

      if (kpisRes.ok) {
        const data = await kpisRes.json();
        setKpis(data.kpis);
      }
      if (biRes.ok) {
        const data = await biRes.json();
        setBiReport(data.report);
      }
      if (foreRes.ok) {
        const data = await foreRes.json();
        setForecasts(data.forecasts || []);
      }
      if (anomRes.ok) {
        const data = await anomRes.json();
        setAnomalies(data.anomalies || []);
      }
      if (replenRes.ok) {
        const data = await replenRes.json();
        setReplenishments(data.suggestions || []);
      }
      if (actRes.ok) {
        const data = await actRes.json();
        setAiActions(data.actions || []);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load management & AI records");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const refreshBi = async (dim = biDimension, wh = biWarehouse) => {
    try {
      const res = await fetch(`/api/v1/management/bi?dimension=${dim}${wh ? `&warehouse=${wh}` : ""}`);
      if (res.ok) {
        const data = await res.json();
        setBiReport(data.report);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Submit Anomaly Review
  const handleReviewAnomaly = async () => {
    if (!selectedAnomaly) return;
    try {
      const res = await fetch(`/api/v1/management/anomalies/${selectedAnomaly.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          review_status: reviewStatus,
          resolution_notes: reviewNotes,
        }),
      });
      if (res.ok) {
        setReviewModalOpen(false);
        setSelectedAnomaly(null);
        setReviewNotes("");
        // Reload anomalies
        const anomRes = await fetch("/api/v1/management/anomalies");
        if (anomRes.ok) {
          const data = await anomRes.json();
          setAnomalies(data.anomalies || []);
        }
      } else {
        const err = await res.json();
        alert(err.error || "Failed to update anomaly review");
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Approve AI Action
  const handleApproveAction = async () => {
    if (!selectedAction) return;
    try {
      const res = await fetch(`/api/v1/management/ai/actions/${selectedAction.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approval_note: actionApprovalNote }),
      });
      if (res.ok) {
        setActionModalOpen(false);
        setSelectedAction(null);
        setActionApprovalNote("");
        loadData();
      } else {
        const err = await res.json();
        alert(err.error || "Approval failed");
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Reject AI Action
  const handleRejectAction = async () => {
    if (!selectedAction) return;
    try {
      const res = await fetch(`/api/v1/management/ai/actions/${selectedAction.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: actionRejectReason || "Rejected by executive review" }),
      });
      if (res.ok) {
        setActionModalOpen(false);
        setSelectedAction(null);
        setActionRejectReason("");
        loadData();
      } else {
        const err = await res.json();
        alert(err.error || "Rejection failed");
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Run AI Copilot
  const handleRunCopilot = async (customPrompt?: string) => {
    const promptToUse = customPrompt || copilotPrompt;
    setCopilotLoading(true);
    try {
      const res = await fetch("/api/v1/management/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptToUse }),
      });
      if (res.ok) {
        const data = await res.json();
        setCopilotResponse(data.analysis);
      } else {
        const err = await res.json();
        alert(err.error || "AI Analysis failed");
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCopilotLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Executive & AI</h1>
            <Badge tone="brand">Step 12</Badge>
            <Badge tone="success">Production Ready</Badge>
            <ViewOnlyBadge modifyPermissions={["ai.recommendations.read", "ai.actions.approve", "dashboard:read", "reports.executive.read"]} />
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Management views business performance, financial metrics, inventory alerts, forecasts and AI recommendations. Consequential actions require authorized approval.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setRefreshing(true);
              loadData();
            }}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh Data
          </button>
          <Can permission="reports.executive.read" mode="hide">
            <a
              href={`/api/v1/management/bi/export?dimension=${biDimension}${biWarehouse ? `&warehouse=${biWarehouse}` : ""}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Download className="h-3.5 w-3.5" />
              Export BI CSV
            </a>
          </Can>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b pb-2">
        <button
          onClick={() => setActiveTab("kpis")}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            activeTab === "kpis" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          <BarChart3 className="h-4 w-4" />
          CEO Dashboard
        </button>
        <button
          onClick={() => setActiveTab("bi")}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            activeTab === "bi" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          BI & Margins
        </button>
        <button
          onClick={() => setActiveTab("forecasting")}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            activeTab === "forecasting" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          <TrendingUp className="h-4 w-4" />
          Demand Forecasts
        </button>
        <button
          onClick={() => setActiveTab("anomalies")}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            activeTab === "anomalies" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          <AlertTriangle className="h-4 w-4" />
          Operational Anomalies
          {anomalies.filter((a) => a.review_status === "detected").length > 0 && (
            <span className="ml-1 rounded-full bg-red-500 px-1.5 py-0.2 text-[10px] text-white">
              {anomalies.filter((a) => a.review_status === "detected").length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("replenishment")}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            activeTab === "replenishment" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          <Package className="h-4 w-4" />
          Replenishment Engine
        </button>
        <button
          onClick={() => setActiveTab("governance")}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            activeTab === "governance" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          <ShieldCheck className="h-4 w-4" />
          Governed AI Queue
          {aiActions.filter((a) => a.approval_status === "proposed").length > 0 && (
            <span className="ml-1 rounded-full bg-amber-500 px-1.5 py-0.2 text-[10px] text-white">
              {aiActions.filter((a) => a.approval_status === "proposed").length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("copilot")}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            activeTab === "copilot" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          <Bot className="h-4 w-4" />
          Executive AI Copilot
        </button>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Aggregating live ERP operational data...</p>
          </div>
        </div>
      ) : (
        <>
          {/* TAB 1: CEO MANAGEMENT DASHBOARD */}
          {activeTab === "kpis" && kpis && (
            <div className="space-y-6">
              {/* Executive Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-lg border bg-card p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Gross Revenue</span>
                    <DollarSign className="h-4 w-4 text-marine-mid" />
                  </div>
                  <div className="mt-2 text-2xl font-bold">
                    €{(kpis.finance.gross_revenue_cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 })}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-marine-mid">
                    <TrendingUp className="h-3 w-3" />
                    <span>+{kpis.sales.sales_growth_pct}% vs last period</span>
                  </div>
                </div>

                <div className="rounded-lg border bg-card p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Delivered Margin</span>
                    <TrendingUp className="h-4 w-4 text-primary" />
                  </div>
                  <div className="mt-2 text-2xl font-bold">
                    {kpis.finance.delivered_margin_pct}%
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    €{(kpis.finance.delivered_margin_cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 0 })} net margin after transport
                  </div>
                </div>

                <div className="rounded-lg border bg-card p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Active Stock Valuation</span>
                    <Package className="h-4 w-4 text-blue-500" />
                  </div>
                  <div className="mt-2 text-2xl font-bold">
                    €{(kpis.inventory.total_stock_value_cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 })}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {kpis.inventory.total_physical_cases.toLocaleString()} total physical cases ({kpis.inventory.warehouse_utilization_pct}% bin cap)
                  </div>
                </div>

                <div className="rounded-lg border bg-card p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">On-Time In-Full (OTIF)</span>
                    <Truck className="h-4 w-4 text-purple-500" />
                  </div>
                  <div className="mt-2 text-2xl font-bold">
                    {kpis.operations.on_time_delivery_rate_pct}%
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {kpis.operations.delivered_deliveries} of {kpis.operations.total_deliveries} deliveries completed
                  </div>
                </div>
              </div>

              {/* 6 Domain Detail Grids */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* 1. Sales & Customers */}
                <div className="rounded-lg border bg-card p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between border-b pb-2">
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                      <Users className="h-4 w-4 text-primary" />
                      Sales & Customers
                    </h3>
                    <Badge tone="neutral">{kpis.sales.active_customers_count} active</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Total Orders</p>
                      <p className="font-bold text-sm">{kpis.sales.total_orders_count}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Avg Order Value</p>
                      <p className="font-bold text-sm">€{(kpis.sales.average_order_value_cents / 100).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Outstanding AR</p>
                      <p className="font-bold text-sm text-amber-600">€{(kpis.sales.outstanding_receivables_cents / 100).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Sales Growth</p>
                      <p className="font-bold text-sm text-marine-mid">+{kpis.sales.sales_growth_pct}%</p>
                    </div>
                  </div>
                  <div className="pt-2 border-t">
                    <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Top Customers by Revenue</p>
                    <div className="space-y-1">
                      {kpis.sales.top_customers.slice(0, 3).map((c) => (
                        <div key={c.customer_id} className="flex justify-between text-xs">
                          <span className="truncate max-w-[140px]">{c.customer_name}</span>
                          <span className="font-mono">€{(c.total_sales_cents / 100).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 2. Inventory & Warehouse */}
                <div className="rounded-lg border bg-card p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between border-b pb-2">
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                      <Package className="h-4 w-4 text-blue-500" />
                      Inventory & Warehouse
                    </h3>
                    <Badge tone="info">{kpis.inventory.warehouse_utilization_pct}% utilized</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Available Cases</p>
                      <p className="font-bold text-sm text-marine-mid">{kpis.inventory.available_cases}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Reserved Cases</p>
                      <p className="font-bold text-sm text-blue-600">{kpis.inventory.reserved_cases}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Quarantined / Held</p>
                      <p className="font-bold text-sm text-red-600">{kpis.inventory.quarantined_cases + kpis.inventory.held_cases}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Expiring &le; 7 Days</p>
                      <p className="font-bold text-sm text-amber-600">{kpis.inventory.expiring_within_7d_cases} cs</p>
                    </div>
                  </div>
                  <div className="pt-2 border-t">
                    <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Slow-Moving SKUs (&gt;45d idle)</p>
                    <div className="space-y-1">
                      {kpis.inventory.slow_moving_inventory.slice(0, 2).map((s) => (
                        <div key={s.sku} className="flex justify-between text-xs">
                          <span className="truncate max-w-[140px]">{s.product_name}</span>
                          <span className="font-mono text-muted-foreground">{s.cases_on_hand} cs ({s.days_since_last_movement}d)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 3. Procurement & Suppliers */}
                <div className="rounded-lg border bg-card p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between border-b pb-2">
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                      <Building className="h-4 w-4 text-purple-500" />
                      Procurement & Suppliers
                    </h3>
                    <Badge tone="neutral">{kpis.procurement.active_suppliers_count} suppliers</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">PO Spend</p>
                      <p className="font-bold text-sm">€{(kpis.procurement.total_po_spend_cents / 100).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Supplier On-Time</p>
                      <p className="font-bold text-sm text-marine-mid">{kpis.procurement.supplier_on_time_rate_pct}%</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Quality Pass Rate</p>
                      <p className="font-bold text-sm text-marine-mid">{kpis.procurement.supplier_quality_pass_pct}%</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Avg Delay</p>
                      <p className="font-bold text-sm">{kpis.procurement.avg_delivery_delay_days} days</p>
                    </div>
                  </div>
                  <div className="pt-2 border-t">
                    <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Supplier Scorecard Leaders</p>
                    <div className="space-y-1">
                      {kpis.procurement.supplier_performance.slice(0, 2).map((sp) => (
                        <div key={sp.supplier_id} className="flex justify-between text-xs">
                          <span className="truncate max-w-[140px]">{sp.supplier_name}</span>
                          <span className="font-mono text-marine-mid">{sp.on_time_pct}% on-time</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 4. Operations & Fulfillment */}
                <div className="rounded-lg border bg-card p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between border-b pb-2">
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                      <Truck className="h-4 w-4 text-indigo-500" />
                      Operations & Fulfillment
                    </h3>
                    <Badge tone="info">{kpis.operations.active_vehicles_count} vehicles</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Picking Completed</p>
                      <p className="font-bold text-sm">{kpis.operations.picking_completion_pct}%</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Packing Completion</p>
                      <p className="font-bold text-sm">{kpis.operations.packing_completion_pct}%</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Order Fill Rate</p>
                      <p className="font-bold text-sm text-marine-mid">{kpis.operations.order_fulfillment_fill_rate_pct}%</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Vehicle Load Util</p>
                      <p className="font-bold text-sm">{kpis.operations.vehicle_capacity_utilization_pct}%</p>
                    </div>
                  </div>
                  <div className="pt-2 border-t text-xs text-muted-foreground">
                    Active drivers on route: <span className="font-bold text-foreground">{kpis.operations.active_drivers_count}</span>
                  </div>
                </div>

                {/* 5. Quality, Food Safety & Recalls */}
                <div className="rounded-lg border bg-card p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between border-b pb-2">
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4 text-red-500" />
                      Quality & Safety (EU 178)
                    </h3>
                    <Badge tone={kpis.quality.active_recalls_count > 0 ? "danger" : "success"}>
                      {kpis.quality.active_recalls_count > 0 ? "Active Recall" : "Compliant"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Open QA Exceptions</p>
                      <p className="font-bold text-sm text-amber-600">{kpis.quality.open_quality_exceptions}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Temp Excursions</p>
                      <p className="font-bold text-sm text-red-600">{kpis.quality.temperature_excursions}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Open CAPAs</p>
                      <p className="font-bold text-sm">{kpis.quality.open_capas_count}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Recall Recovery</p>
                      <p className="font-bold text-sm text-marine-mid">{kpis.quality.recall_recovery_rate_pct}%</p>
                    </div>
                  </div>
                  <div className="pt-2 border-t text-xs text-muted-foreground">
                    Rejected inbound cases: <span className="font-bold text-foreground">{kpis.quality.total_rejected_cases} cs</span>
                  </div>
                </div>

                {/* 6. Finance & Collections */}
                <div className="rounded-lg border bg-card p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between border-b pb-2">
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-marine-mid" />
                      Finance & Cash Flow
                    </h3>
                    <Badge tone="brand">DSO: {kpis.finance.dso_days}d</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Invoiced (Period)</p>
                      <p className="font-bold text-sm">€{(kpis.finance.total_invoiced_cents / 100).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Outstanding AR</p>
                      <p className="font-bold text-sm text-amber-600">€{(kpis.finance.outstanding_invoices_cents / 100).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Overdue AR</p>
                      <p className="font-bold text-sm text-red-600">€{(kpis.finance.overdue_receivables_cents / 100).toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Collection Rate</p>
                      <p className="font-bold text-sm text-marine-mid">{kpis.finance.collection_rate_pct}%</p>
                    </div>
                  </div>
                  <div className="pt-2 border-t text-xs text-muted-foreground">
                    Gross Margin: <span className="font-bold text-foreground">{kpis.finance.gross_margin_pct}%</span> | Net Delivered: <span className="font-bold text-foreground">{kpis.finance.delivered_margin_pct}%</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: BI & MARGINS EXPLORER */}
          {activeTab === "bi" && biReport && (
            <div className="space-y-4">
              {/* Filter controls */}
              <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 shadow-sm">
                <span className="text-xs font-semibold text-muted-foreground">Dimension:</span>
                {(["customer", "product", "supplier", "warehouse"] as const).map((dim) => (
                  <button
                    key={dim}
                    onClick={() => {
                      setBiDimension(dim);
                      refreshBi(dim, biWarehouse);
                    }}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize ${
                      biDimension === dim ? "bg-primary text-primary-foreground" : "border text-foreground hover:bg-muted"
                    }`}
                  >
                    {dim}
                  </button>
                ))}

                <div className="ml-auto flex items-center gap-2">
                  <select
                    value={biWarehouse}
                    onChange={(e) => {
                      setBiWarehouse(e.target.value);
                      refreshBi(biDimension, e.target.value);
                    }}
                    className="rounded-md border bg-background px-2.5 py-1 text-xs font-medium text-foreground"
                  >
                    <option value="">All Warehouses</option>
                    <option value="WH-MILAN-01">WH-MILAN-01 (Milan Hub)</option>
                    <option value="WH-VERONA-02">WH-VERONA-02 (Verona Facility)</option>
                  </select>
                </div>
              </div>

              {/* Summary KPIs */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border bg-card p-3">
                  <span className="text-[11px] text-muted-foreground">Total Revenue</span>
                  <p className="text-lg font-bold">€{(biReport.totals.total_revenue_cents / 100).toLocaleString()}</p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <span className="text-[11px] text-muted-foreground">Total Cases Sold</span>
                  <p className="text-lg font-bold">{biReport.totals.total_cases.toLocaleString()} cs</p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <span className="text-[11px] text-muted-foreground">Delivered Margin</span>
                  <p className="text-lg font-bold text-marine-mid">{biReport.totals.average_delivered_margin_pct}%</p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <span className="text-[11px] text-muted-foreground">Total Net Delivered Margin</span>
                  <p className="text-lg font-bold text-marine-mid">€{(biReport.totals.total_delivered_margin_cents / 100).toLocaleString()}</p>
                </div>
              </div>

              {/* BI Table */}
              <div className="rounded-lg border bg-card overflow-hidden shadow-sm">
                <table className="w-full text-xs">
                  <thead className="bg-muted border-b text-muted-foreground">
                    <tr>
                      <th className="py-2.5 px-4 text-left font-medium">Dimension ({biDimension})</th>
                      <th className="py-2.5 px-3 text-right font-medium">Orders</th>
                      <th className="py-2.5 px-3 text-right font-medium">Cases Sold</th>
                      <th className="py-2.5 px-3 text-right font-medium">Revenue (€)</th>
                      <th className="py-2.5 px-3 text-right font-medium">COGS (€)</th>
                      <th className="py-2.5 px-3 text-right font-medium">Gross Margin</th>
                      <th className="py-2.5 px-3 text-right font-medium">Delivered Margin</th>
                      <th className="py-2.5 px-3 text-right font-medium">OTIF Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {biReport.rows.map((r, i) => (
                      <tr key={r.dimension_key + i} className="hover:bg-muted/50">
                        <td className="py-2 px-4 font-medium text-foreground">
                          {r.dimension_label}
                          <span className="ml-1 text-[10px] text-muted-foreground font-mono">({r.dimension_key})</span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono">{r.order_count}</td>
                        <td className="py-2 px-3 text-right font-mono">{r.cases_sold}</td>
                        <td className="py-2 px-3 text-right font-mono font-medium">€{(r.revenue_cents / 100).toLocaleString()}</td>
                        <td className="py-2 px-3 text-right font-mono text-muted-foreground">€{(r.cogs_cents / 100).toLocaleString()}</td>
                        <td className="py-2 px-3 text-right font-mono text-marine-mid">{r.gross_margin_pct}%</td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-marine-mid">{r.delivered_margin_pct}%</td>
                        <td className="py-2 px-3 text-right font-mono">{r.on_time_rate_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: DEMAND FORECASTING */}
          {activeTab === "forecasting" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">14-Day Demand Projections & Stockout Depletion Risk</h3>
                  <p className="text-xs text-muted-foreground">
                    Based on 30-day historical order velocity, safety stock thresholds, and 95% statistical confidence intervals.
                  </p>
                </div>
                <Badge tone="neutral">{forecasts.length} Products Monitored</Badge>
              </div>

              <div className="rounded-lg border bg-card overflow-hidden shadow-sm">
                <table className="w-full text-xs">
                  <thead className="bg-muted border-b text-muted-foreground">
                    <tr>
                      <th className="py-2.5 px-4 text-left font-medium">Product / SKU</th>
                      <th className="py-2.5 px-3 text-left font-medium">Warehouse</th>
                      <th className="py-2.5 px-3 text-right font-medium">Daily Demand</th>
                      <th className="py-2.5 px-3 text-right font-medium">14d Projected</th>
                      <th className="py-2.5 px-3 text-right font-medium">95% Conf. Interval</th>
                      <th className="py-2.5 px-3 text-right font-medium">Available Stock</th>
                      <th className="py-2.5 px-3 text-right font-medium">Days of Supply</th>
                      <th className="py-2.5 px-3 text-center font-medium">Depletion Risk</th>
                      <th className="py-2.5 px-3 text-center font-medium">Data Confidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {forecasts.map((f) => {
                      const riskTone =
                        f.depletion_risk === "immediate"
                          ? "danger"
                          : f.depletion_risk === "high"
                          ? "warning"
                          : f.depletion_risk === "moderate"
                          ? "info"
                          : "success";
                      return (
                        <tr key={f.sku + f.warehouse} className="hover:bg-muted/50">
                          <td className="py-2 px-4">
                            <span className="font-semibold text-foreground">{f.product_name}</span>
                            <span className="ml-1 text-[10px] text-muted-foreground font-mono">({f.sku})</span>
                          </td>
                          <td className="py-2 px-3 text-muted-foreground">{f.warehouse}</td>
                          <td className="py-2 px-3 text-right font-mono">{f.daily_demand_mean_cases} cs/d</td>
                          <td className="py-2 px-3 text-right font-mono font-bold">{f.projected_demand_cases} cs</td>
                          <td className="py-2 px-3 text-right font-mono text-muted-foreground">
                            [{f.lower_bound_cases} - {f.upper_bound_cases}]
                          </td>
                          <td className="py-2 px-3 text-right font-mono">{f.current_available_cases} cs</td>
                          <td className="py-2 px-3 text-right font-mono font-semibold">{f.days_of_supply_remaining}d</td>
                          <td className="py-2 px-3 text-center">
                            <Badge tone={riskTone} className="uppercase text-[10px]">
                              {f.depletion_risk}
                            </Badge>
                          </td>
                          <td className="py-2 px-3 text-center">
                            <Badge tone={f.data_coverage === "high" ? "brand" : "neutral"} className="text-[10px]">
                              {f.data_coverage}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: OPERATIONAL ANOMALY CENTER */}
          {activeTab === "anomalies" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Automated Anomaly Detection & Review</h3>
                  <p className="text-xs text-muted-foreground">
                    10 anomaly algorithms continuously monitor temperature compliance, stock discrepancies, margin leaks, and overdue AR.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="danger">
                    {anomalies.filter((a) => a.severity === "critical").length} Critical
                  </Badge>
                  <Badge tone="warning">
                    {anomalies.filter((a) => a.severity === "warning").length} Warnings
                  </Badge>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {anomalies.map((anom) => {
                  const tone = anom.severity === "critical" ? "danger" : anom.severity === "warning" ? "warning" : "info";
                  return (
                    <div key={anom.id} className="rounded-lg border bg-card p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="space-y-1 max-w-2xl">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{anom.anomaly_number}</span>
                          <Badge tone={tone} className="uppercase text-[10px]">{anom.severity}</Badge>
                          <Badge tone="neutral" className="capitalize text-[10px]">{anom.category}</Badge>
                          <span className="text-xs font-semibold text-foreground">{anom.title}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{anom.explanation}</p>
                        <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px]">
                          <span className="text-muted-foreground">
                            Target: <span className="font-mono text-foreground">{anom.related_entity_type} ({anom.related_entity_id})</span>
                          </span>
                          <span className="text-muted-foreground">
                            Investigation: <span className="text-foreground">{anom.suggested_investigation}</span>
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Badge tone={anom.review_status === "resolved" ? "success" : anom.review_status === "under_review" ? "warning" : "neutral"}>
                          {anom.review_status}
                        </Badge>
                        <button
                          onClick={() => {
                            setSelectedAnomaly(anom);
                            setReviewStatus(anom.review_status);
                            setReviewNotes(anom.review_notes || "");
                            setReviewModalOpen(true);
                          }}
                          className="rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
                        >
                          Review & Act
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 5: STOCK REPLENISHMENT ADVISOR */}
          {activeTab === "replenishment" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Stock Replenishment Advisory Engine</h3>
                  <p className="text-xs text-muted-foreground">
                    Deterministic calculation of Reorder Points (ROP), safety stock, lead times, and open PO pipelines. Advisory only.
                  </p>
                </div>
                <Badge tone="brand">Advisory Only — PO Creation Requires Maker-Checker</Badge>
              </div>

              <div className="rounded-lg border bg-card overflow-hidden shadow-sm">
                <table className="w-full text-xs">
                  <thead className="bg-muted border-b text-muted-foreground">
                    <tr>
                      <th className="py-2.5 px-4 text-left font-medium">Product / SKU</th>
                      <th className="py-2.5 px-3 text-left font-medium">Warehouse</th>
                      <th className="py-2.5 px-3 text-right font-medium">Available</th>
                      <th className="py-2.5 px-3 text-right font-medium">Open PO Cases</th>
                      <th className="py-2.5 px-3 text-right font-medium">Lead Time</th>
                      <th className="py-2.5 px-3 text-right font-medium">Safety Stock</th>
                      <th className="py-2.5 px-3 text-right font-medium">Reorder Point</th>
                      <th className="py-2.5 px-3 text-right font-medium">Suggested Order</th>
                      <th className="py-2.5 px-3 text-center font-medium">Priority</th>
                      <th className="py-2.5 px-3 text-right font-medium">Estimated Cost</th>
                      <th className="py-2.5 px-3 text-center font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {replenishments.map((rep) => {
                      const tone = rep.priority === "urgent" ? "danger" : rep.priority === "high" ? "warning" : "neutral";
                      return (
                        <tr key={rep.sku + rep.warehouse} className="hover:bg-muted/50">
                          <td className="py-2 px-4">
                            <span className="font-semibold text-foreground">{rep.product_name}</span>
                            <span className="ml-1 text-[10px] text-muted-foreground font-mono">({rep.sku})</span>
                          </td>
                          <td className="py-2 px-3 text-muted-foreground">{rep.warehouse}</td>
                          <td className="py-2 px-3 text-right font-mono font-medium">{rep.current_available_cases} cs</td>
                          <td className="py-2 px-3 text-right font-mono text-muted-foreground">{rep.open_po_cases} cs</td>
                          <td className="py-2 px-3 text-right font-mono">{rep.supplier_lead_time_days}d</td>
                          <td className="py-2 px-3 text-right font-mono">{rep.safety_stock_cases} cs</td>
                          <td className="py-2 px-3 text-right font-mono font-semibold">{rep.reorder_point_cases} cs</td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-primary">{rep.suggested_reorder_cases} cs</td>
                          <td className="py-2 px-3 text-center">
                            <Badge tone={tone} className="uppercase text-[10px]">
                              {rep.priority}
                            </Badge>
                          </td>
                          <td className="py-2 px-3 text-right font-mono">
                            €{((rep.estimated_cost_cents ?? rep.estimated_order_value_cents ?? 0) / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 })}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <Can permission="ai.recommendations.read" mode="disable">
                              <button
                                onClick={async () => {
                                try {
                                  const res = await fetch("/api/v1/management/ai/actions", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      action_type: "create_purchase_order",
                                      target_entity: "purchase_orders",
                                      target_id: rep.sku,
                                      summary: `Create PO for ${rep.suggested_reorder_cases} cases of ${rep.product_name}`,
                                      rationale: `Stock below reorder point (${rep.current_available_cases} available vs ${rep.reorder_point_cases} ROP)`,
                                      parameters: {
                                        sku: rep.sku,
                                        quantity_cases: rep.suggested_reorder_cases,
                                        warehouse: rep.warehouse,
                                      },
                                      risk_level: rep.priority === "urgent" ? "high" : "medium",
                                    }),
                                  });
                                  if (res.ok) {
                                    alert("AI purchase proposal created and routed to Governed AI Queue for executive sign-off!");
                                    loadData();
                                  }
                                } catch (e: any) {
                                  alert(e.message);
                                }
                              }}
                                className="rounded bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20"
                              >
                                Propose PO
                              </button>
                            </Can>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 6: GOVERNED AI ACTIONS & MAKER-CHECKER QUEUE */}
          {activeTab === "governance" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Maker-Checker AI Governance Approval Queue</h3>
                  <p className="text-xs text-muted-foreground">
                    Strict boundary: AI recommends, system validates, human executive signs off. Zero autonomous data mutations.
                  </p>
                </div>
                <Badge tone="brand">Strict Maker-Checker</Badge>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {aiActions.map((action) => {
                  const statusTone =
                    action.approval_status === "executed"
                      ? "success"
                      : action.approval_status === "approved"
                      ? "brand"
                      : action.approval_status === "rejected"
                      ? "danger"
                      : "warning";
                  return (
                    <div key={action.id} className="rounded-lg border bg-card p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="space-y-1.5 max-w-2xl">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{action.action_number}</span>
                          <Badge tone={statusTone} className="uppercase text-[10px]">{action.approval_status}</Badge>
                          <Badge tone="neutral" className="text-[10px]">{action.action_type}</Badge>
                          <span className="text-xs font-semibold text-foreground">{action.summary}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{action.rationale}</p>
                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                          <span>Target: <span className="font-mono text-foreground">{action.target_entity} ({action.target_id})</span></span>
                          <span>Model: <span className="font-mono text-foreground">{action.model_version}</span></span>
                          <span>Risk: <span className="capitalize font-semibold text-foreground">{action.risk_level}</span></span>
                          {action.approved_by && <span>Approved by: <span className="font-semibold text-foreground">{action.approved_by}</span></span>}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {action.approval_status === "proposed" && (
                          <>
                            <Can permission="ai.actions.approve" mode="hide">
                              <button
                                onClick={() => {
                                  setSelectedAction(action);
                                  setActionModalMode("approve");
                                  setActionApprovalNote("");
                                  setActionModalOpen(true);
                                }}
                                className="rounded-md bg-marine-steel px-3 py-1.5 text-xs font-medium text-white hover:bg-marine-steelLight"
                              >
                                Approve & Execute
                              </button>
                            </Can>
                            <Can permission="ai.actions.approve" mode="hide">
                              <button
                                onClick={() => {
                                  setSelectedAction(action);
                                  setActionModalMode("reject");
                                  setActionRejectReason("");
                                  setActionModalOpen(true);
                                }}
                                className="rounded-md border border-red-300 bg-background px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                              >
                                Reject
                              </button>
                            </Can>
                          </>
                        )}
                        {action.approval_status === "executed" && (
                          <div className="flex items-center gap-1 text-xs text-marine-mid font-medium">
                            <CheckCircle2 className="h-4 w-4" />
                            Executed
                          </div>
                        )}
                        {action.approval_status === "rejected" && (
                          <div className="flex items-center gap-1 text-xs text-red-600 font-medium">
                            <XCircle className="h-4 w-4" />
                            Rejected
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 7: EXECUTIVE AI COPILOT */}
          {activeTab === "copilot" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Executive AI Copilot & Real-Time Operational Synthesizer
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Grounded directly in ERP operational databases. Fallback-safe to deterministic analysis if LLM is unavailable.
                  </p>
                </div>
                <Badge tone="brand">Gemini 2.5 / Resilient Deterministic Engine</Badge>
              </div>

              {/* Quick Prompt Starters */}
              <div className="flex flex-wrap gap-2">
                {[
                  "Provide executive summary of top operational risks across Milan and Verona",
                  "Analyze profit margin leaks and landed cost variances across product categories",
                  "Review temperature excursion compliance and recommend quarantine actions",
                  "Identify slow-moving inventory and suggest promotional markdown strategies",
                ].map((promptText) => (
                  <button
                    key={promptText}
                    onClick={() => {
                      setCopilotPrompt(promptText);
                      handleRunCopilot(promptText);
                    }}
                    className="rounded-full border bg-muted/50 px-3 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {promptText}
                  </button>
                ))}
              </div>

              {/* Input Box */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={copilotPrompt}
                  onChange={(e) => setCopilotPrompt(e.target.value)}
                  placeholder="Ask any strategic or operational question about Ascentra ERP..."
                  className="flex-1 rounded-md border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRunCopilot();
                  }}
                />
                <button
                  onClick={() => handleRunCopilot()}
                  disabled={copilotLoading}
                  className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5"
                >
                  {copilotLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
                  Analyze Live Data
                </button>
              </div>

              {/* Copilot Response Display */}
              {copilotResponse && (
                <div className="rounded-lg border bg-card p-5 space-y-4 shadow-sm">
                  <div className="flex items-center justify-between border-b pb-3">
                    <div className="flex items-center gap-2">
                      <Badge tone="brand">{copilotResponse.provider}</Badge>
                      <span className="font-semibold text-xs">{copilotResponse.headline}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      Generated: {new Date(copilotResponse.generated_at).toLocaleTimeString()}
                    </span>
                  </div>

                  <div className="text-xs leading-relaxed text-foreground whitespace-pre-line">
                    {copilotResponse.executive_summary}
                  </div>

                  {/* Highlights Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                    <div className="rounded border bg-muted/30 p-3 space-y-1.5">
                      <span className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        Operational Findings
                      </span>
                      <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
                        {(copilotResponse.key_highlights ?? []).map((h, idx) => (
                          <li key={idx}>{h}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="rounded border bg-muted/30 p-3 space-y-1.5">
                      <span className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-marine-mid" />
                        Recommended Executive Actions
                      </span>
                      <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
                        {(copilotResponse.recommended_actions ?? []).map((act, idx) => (
                          <li key={idx}>{act}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* MODAL 1: ANOMALY REVIEW */}
      {reviewModalOpen && selectedAnomaly && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-semibold text-sm">Review Anomaly: {selectedAnomaly.anomaly_number}</h3>
              <button onClick={() => setReviewModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                &times;
              </button>
            </div>

            <div className="text-xs space-y-2">
              <p className="font-semibold text-foreground">{selectedAnomaly.title}</p>
              <p className="text-muted-foreground">{selectedAnomaly.explanation}</p>
              <div className="rounded bg-muted p-2 text-[11px]">
                <p className="font-medium">Investigation Advice:</p>
                <p className="text-muted-foreground">{selectedAnomaly.suggested_investigation}</p>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <div>
                <label className="text-xs font-medium text-foreground">Review Status</label>
                <select
                  value={reviewStatus}
                  onChange={(e) => setReviewStatus(e.target.value)}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-xs"
                >
                  <option value="under_review">Under Review</option>
                  <option value="acknowledged">Acknowledged (Investigating)</option>
                  <option value="resolved">Resolved</option>
                  <option value="dismissed">Dismissed (False Positive)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-foreground">Resolution / Audit Notes</label>
                <textarea
                  rows={3}
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Detail operational causes, corrective measures taken, or justification..."
                  className="mt-1 w-full rounded-md border bg-background p-2 text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t pt-3">
              <button
                onClick={() => setReviewModalOpen(false)}
                className="rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
              >
                Cancel
              </button>
              <Can permission="dashboard:read" mode="disable">
                <button
                  onClick={handleReviewAnomaly}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Save Review
                </button>
              </Can>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: MAKER-CHECKER AI ACTION APPROVE / REJECT */}
      {actionModalOpen && selectedAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-semibold text-sm">
                {actionModalMode === "approve" ? "Sign-off & Execute Action" : "Reject Action Proposal"}
              </h3>
              <button onClick={() => setActionModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                &times;
              </button>
            </div>

            <div className="text-xs space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-mono">{selectedAction.action_number}</span>
                <Badge tone="brand">{selectedAction.action_type}</Badge>
              </div>
              <p className="font-semibold text-foreground">{selectedAction.summary}</p>
              <p className="text-muted-foreground">{selectedAction.rationale}</p>
              <div className="rounded bg-muted p-2 text-[11px] font-mono">
                Parameters: {JSON.stringify(selectedAction.parameters, null, 2)}
              </div>
            </div>

            {actionModalMode === "approve" ? (
              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground">Executive Sign-Off Note</label>
                <input
                  type="text"
                  value={actionApprovalNote}
                  onChange={(e) => setActionApprovalNote(e.target.value)}
                  placeholder="e.g. Approved per supply chain risk assessment."
                  className="w-full rounded-md border bg-background px-3 py-1.5 text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Upon approval, this action will directly execute domain transactions in the ERP and log an immutable audit event.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground">Rejection Reason</label>
                <input
                  type="text"
                  value={actionRejectReason}
                  onChange={(e) => setActionRejectReason(e.target.value)}
                  placeholder="State reason for rejecting proposal..."
                  className="w-full rounded-md border bg-background px-3 py-1.5 text-xs"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 border-t pt-3">
              <button
                onClick={() => setActionModalOpen(false)}
                className="rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
              >
                Cancel
              </button>
              {actionModalMode === "approve" ? (
                <Can permission="ai.actions.approve" mode="hide">
                  <button
                    onClick={handleApproveAction}
                    className="rounded-md bg-marine-steel px-3 py-1.5 text-xs font-medium text-white hover:bg-marine-steelLight"
                  >
                    Confirm Sign-Off & Execute
                  </button>
                </Can>
              ) : (
                <Can permission="ai.actions.approve" mode="hide">
                  <button
                    onClick={handleRejectAction}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                  >
                    Confirm Rejection
                  </button>
                </Can>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
