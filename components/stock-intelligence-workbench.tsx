"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  Eye,
  FileCheck2,
  Filter,
  History,
  Layers,
  Lock,
  PackageCheck,
  Plus,
  RefreshCw,
  Scale,
  ScanBarcode,
  Search,
  ShieldAlert,
  Sparkles,
  Warehouse,
  X
} from "lucide-react";
import { Badge, KpiCard, SectionHeader, Surface, statusTone } from "@/components/ui";
import { Can, ViewOnlyBadge } from "@/components/access-gate";
import { currency, dateTime, number, shortDate, titleCase } from "@/lib/format";
import type {
  CycleCountRecord,
  FefoAllocationResult,
  ShelfLifeRuleRecord,
  StockAdjustmentRecord,
  StockLotRecord,
  StockMovementRecord,
  StockReservationRecord,
  StockStatusType
} from "@/server/services/stock-intelligence.service";

type TabId =
  | "explorer"
  | "fefo"
  | "reservations"
  | "shelf_life"
  | "cycle_counts"
  | "adjustments"
  | "movements";

const STOCK_STATUSES: StockStatusType[] = [
  "Available",
  "Reserved",
  "Held",
  "Quarantined",
  "Rejected",
  "Damaged",
  "Expired",
  "In Transit"
];

export function StockIntelligenceWorkbench() {
  const [activeTab, setActiveTab] = useState<TabId>("explorer");
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  // Filters
  const [warehouseFilter, setWarehouseFilter] = useState("ALL");
  const [zoneFilter, setZoneFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [skuFilter, setSkuFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // Data states
  const [summary, setSummary] = useState<{
    physical_cases: number;
    available_cases: number;
    reserved_cases: number;
    blocked_cases: number;
    in_transit_cases: number;
    physical_weight_kg: number;
    available_weight_kg: number;
    reserved_weight_kg: number;
    blocked_weight_kg: number;
    catch_weight_kg: number;
    stock_value_cents: number;
    available_value_cents: number;
    reserved_value_cents: number;
    blocked_value_cents: number;
    active_lots_count: number;
    shelf_life_alerts_count: number;
    cycle_count_accuracy_pct: number;
    total_cycle_counts: number;
    pending_cycle_count_approvals: number;
    pending_adjustment_approvals: number;
    active_reservations_count: number;
    reconciled: boolean;
  } | null>(null);
  const [statusBreakdown, setStatusBreakdown] = useState<
    Record<StockStatusType, { cases: number; weight_kg: number; value_cents: number }> | null
  >(null);
  const [byWarehouse, setByWarehouse] = useState<
    Array<{
      warehouse: string;
      physical_cases: number;
      available_cases: number;
      reserved_cases: number;
      blocked_cases: number;
      in_transit_cases: number;
      physical_weight_kg: number;
      catch_weight_kg: number;
      stock_value_cents: number;
      lots_count: number;
    }>
  >([]);
  const [lots, setLots] = useState<StockLotRecord[]>([]);
  const [reservations, setReservations] = useState<StockReservationRecord[]>([]);
  const [shelfLifeRules, setShelfLifeRules] = useState<ShelfLifeRuleRecord[]>([]);
  const [shelfLifeAlerts, setShelfLifeAlerts] = useState<StockLotRecord[]>([]);
  const [cycleCounts, setCycleCounts] = useState<CycleCountRecord[]>([]);
  const [adjustments, setAdjustments] = useState<StockAdjustmentRecord[]>([]);
  const [movements, setMovements] = useState<StockMovementRecord[]>([]);
  const [movementsTotal, setMovementsTotal] = useState(0);

  // Lot 360° Detail Drawer
  const [selectedLotDetail, setSelectedLotDetail] = useState<{
    lot: StockLotRecord;
    reservations: StockReservationRecord[];
    movements: StockMovementRecord[];
    cycle_counts: CycleCountRecord[];
    adjustments: StockAdjustmentRecord[];
  } | null>(null);

  // FEFO Allocator State
  const [fefoSku, setFefoSku] = useState("SKU-SAL-001");
  const [fefoQty, setFefoQty] = useState("30");
  const [fefoWarehouse, setFefoWarehouse] = useState("Milan Cold Hub");
  const [fefoCustomer, setFefoCustomer] = useState("Ristorante Cracco Galleria");
  const [fefoDeliveryDate, setFefoDeliveryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fefoOrderMinDays, setFefoOrderMinDays] = useState("");
  const [fefoAllowPartial, setFefoAllowPartial] = useState(true);
  const [fefoResult, setFefoResult] = useState<FefoAllocationResult | null>(null);
  const [fefoError, setFefoError] = useState<string | null>(null);

  // Reservation Form State
  const [resOrderNumber, setResOrderNumber] = useState("SO-2026-9842");
  const [resCustomerName, setResCustomerName] = useState("Gourmet Market Brera");
  const [resSku, setResSku] = useState("SKU-SAL-001");
  const [resQty, setResQty] = useState("15");
  const [resWarehouse, setResWarehouse] = useState("Milan Cold Hub");
  const [resDeliveryDate, setResDeliveryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [resMinDays, setResMinDays] = useState("");
  const [resAllowPartial, setResAllowPartial] = useState(true);

  // Shelf-Life Rule Form State
  const [ruleScope, setRuleScope] = useState<"product" | "customer" | "customer_product" | "segment">("product");
  const [ruleSku, setRuleSku] = useState("SKU-SAL-001");
  const [ruleCustomerName, setRuleCustomerName] = useState("");
  const [ruleSegment, setRuleSegment] = useState("");
  const [ruleMinDays, setRuleMinDays] = useState("4");
  const [ruleMinPct, setRuleMinPct] = useState("40");
  const [ruleNotes, setRuleNotes] = useState("");

  // Cycle Count Creation & Submission States
  const [ccLot, setCcLot] = useState("");
  const [ccType, setCcType] = useState<"scheduled" | "ad_hoc">("scheduled");
  const [ccBlind, setCcBlind] = useState(true);
  const [ccAssignee, setCcAssignee] = useState("Pietro Rossi");
  const [ccNotes, setCcNotes] = useState("");
  const [activeCountModal, setActiveCountModal] = useState<CycleCountRecord | null>(null);
  const [submitCountCases, setSubmitCountCases] = useState("");
  const [submitCountWeight, setSubmitCountWeight] = useState("");
  const [submitBarcode, setSubmitBarcode] = useState("");
  const [submitReason, setSubmitReason] = useState("");

  // Adjustment Form State
  const [adjLot, setAdjLot] = useState("");
  const [adjType, setAdjType] = useState<StockAdjustmentRecord["adjustment_type"]>("damaged");
  const [adjActualCases, setAdjActualCases] = useState("");
  const [adjActualWeight, setAdjActualWeight] = useState("");
  const [adjTargetBin, setAdjTargetBin] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [adjEvidence, setAdjEvidence] = useState("");

  const notify = useCallback((tone: "ok" | "error", text: string) => {
    setFeedback({ tone, text });
    window.setTimeout(() => setFeedback(null), 5500);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (warehouseFilter !== "ALL") qs.set("warehouse", warehouseFilter);
      if (zoneFilter !== "ALL") qs.set("zone", zoneFilter);
      if (statusFilter !== "ALL") qs.set("status", statusFilter);
      if (skuFilter !== "ALL") qs.set("sku", skuFilter);
      if (searchQuery.trim()) qs.set("search", searchQuery.trim());

      const [dashRes, resRes, slRes, ccRes, adjRes, movRes] = await Promise.all([
        fetch(`/api/v1/inventory/dashboard?${qs.toString()}`, { cache: "no-store" }),
        fetch(`/api/v1/inventory/reservations?${warehouseFilter !== "ALL" ? `warehouse=${encodeURIComponent(warehouseFilter)}` : ""}`, { cache: "no-store" }),
        fetch(`/api/v1/inventory/shelf-life?${warehouseFilter !== "ALL" ? `warehouse=${encodeURIComponent(warehouseFilter)}` : ""}`, { cache: "no-store" }),
        fetch(`/api/v1/inventory/cycle-counts?${warehouseFilter !== "ALL" ? `warehouse=${encodeURIComponent(warehouseFilter)}` : ""}`, { cache: "no-store" }),
        fetch(`/api/v1/inventory/adjustments?${warehouseFilter !== "ALL" ? `warehouse=${encodeURIComponent(warehouseFilter)}` : ""}`, { cache: "no-store" }),
        fetch(`/api/v1/inventory/movements?page=1&page_size=50${warehouseFilter !== "ALL" ? `&warehouse=${encodeURIComponent(warehouseFilter)}` : ""}`, { cache: "no-store" })
      ]);

      if (dashRes.ok) {
        const d = await dashRes.json();
        setSummary(d.summary ?? null);
        setStatusBreakdown(d.status_breakdown ?? null);
        setByWarehouse(d.by_warehouse ?? []);
        const lotList: StockLotRecord[] = d.lots ?? [];
        setLots(lotList);
        if (lotList.length > 0 && !ccLot) setCcLot(lotList[0].internal_lot);
        if (lotList.length > 0 && !adjLot) setAdjLot(lotList[0].internal_lot);
      }
      if (resRes.ok) {
        const r = await resRes.json();
        setReservations(r.items ?? []);
      }
      if (slRes.ok) {
        const s = await slRes.json();
        setShelfLifeRules(s.rules ?? []);
        setShelfLifeAlerts(s.alerts ?? []);
      }
      if (ccRes.ok) {
        const c = await ccRes.json();
        setCycleCounts(c.items ?? []);
      }
      if (adjRes.ok) {
        const a = await adjRes.json();
        setAdjustments(a.items ?? []);
      }
      if (movRes.ok) {
        const m = await movRes.json();
        setMovements(m.items ?? []);
        setMovementsTotal(m.total ?? 0);
      }
    } catch {
      notify("error", "Failed to load stock intelligence data.");
    } finally {
      setLoading(false);
    }
  }, [warehouseFilter, zoneFilter, statusFilter, skuFilter, searchQuery, ccLot, adjLot, notify]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const availableSkus = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of lots) {
      map.set(l.sku, l.product_name);
    }
    if (!map.has("SKU-SAL-001")) map.set("SKU-SAL-001", "Norwegian Atlantic Salmon Fillet (Trim D)");
    if (!map.has("SKU-BUR-004")) map.set("SKU-BUR-004", "Artisanal Burrata di Andria IGP (12x125g)");
    if (!map.has("SKU-BFL-009")) map.set("SKU-BFL-009", "Dry-Aged Piedmontese Beef Striploin");
    return Array.from(map.entries());
  }, [lots]);

  const availableZones = useMemo(() => {
    const s = new Set<string>();
    for (const l of lots) s.add(l.zone);
    return Array.from(s);
  }, [lots]);

  const pagedLots = useMemo(() => {
    const start = (page - 1) * pageSize;
    return lots.slice(start, start + pageSize);
  }, [lots, page]);

  const openLotDetail = async (lotCode: string) => {
    try {
      const res = await fetch(`/api/v1/inventory/lots/${encodeURIComponent(lotCode)}`, { cache: "no-store" });
      if (!res.ok) {
        notify("error", "Could not load lot 360° detail.");
        return;
      }
      const data = await res.json();
      setSelectedLotDetail(data);
    } catch {
      notify("error", "Network error loading lot detail.");
    }
  };

  const exportCsv = () => {
    const header = [
      "FEFO Rank",
      "Internal Lot",
      "Supplier Batch",
      "SKU",
      "Product",
      "Warehouse",
      "Zone",
      "Bin",
      "Status",
      "Physical Cases",
      "Available Cases",
      "Reserved Cases",
      "Blocked Cases",
      "Catch Weight (kg)",
      "Stock Value (EUR)",
      "Expiry Date",
      "Days Remaining",
      "Temp (C)",
      "Quality Status"
    ];
    const rows = lots.map((l) => [
      l.fefo_rank ?? "—",
      l.internal_lot,
      l.supplier_batch,
      l.sku,
      l.product_name,
      l.warehouse,
      l.zone,
      l.bin_code,
      l.primary_stock_status,
      l.physical_cases,
      l.available_cases,
      l.reserved_cases,
      l.blocked_cases,
      l.catch_weight_kg,
      (l.stock_value_cents / 100).toFixed(2),
      l.expiry_date,
      l.days_remaining,
      l.temp_c,
      l.quality_status
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "ascentra-stock-intelligence-ledger.csv";
    link.click();
    URL.revokeObjectURL(url);
    notify("ok", "Multi-level stock ledger exported to CSV.");
  };

  const runFefoEvaluation = async (e: React.FormEvent) => {
    e.preventDefault();
    setFefoError(null);
    setFefoResult(null);
    try {
      const res = await fetch("/api/v1/inventory/fefo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: fefoSku,
          requested_cases: Number(fefoQty),
          warehouse: fefoWarehouse === "ALL" ? null : fefoWarehouse,
          customer_name: fefoCustomer.trim() || null,
          delivery_date: fefoDeliveryDate,
          order_min_remaining_days: fefoOrderMinDays ? Number(fefoOrderMinDays) : null,
          allow_partial: fefoAllowPartial,
          persist_log: true
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setFefoError(data?.error?.message ?? "FEFO allocation failed.");
        return;
      }
      setFefoResult(data);
      notify(
        "ok",
        `FEFO evaluated: allocated ${data.allocated_cases}/${data.requested_cases} cases across ${data.selected_allocations.length} lot(s).`
      );
    } catch {
      setFefoError("Network error while evaluating FEFO allocation.");
    }
  };

  const submitReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/v1/inventory/reservations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `res-${resSku}-${Date.now()}`
        },
        body: JSON.stringify({
          order_number: resOrderNumber.trim() || null,
          customer_name: resCustomerName.trim() || null,
          sku: resSku,
          requested_cases: Number(resQty),
          warehouse: resWarehouse === "ALL" ? null : resWarehouse,
          delivery_date: resDeliveryDate,
          order_min_remaining_days: resMinDays ? Number(resMinDays) : null,
          allow_partial: resAllowPartial
        })
      });
      const data = await res.json();
      if (!res.ok) {
        notify("error", data?.error?.message ?? "Could not create stock reservation.");
        return;
      }
      notify(
        "ok",
        `Created ${data.reservations?.length ?? 1} FEFO reservation(s) for ${data.allocation?.allocated_cases} cases.`
      );
      await loadAll();
    } catch {
      notify("error", "Network error while creating reservation.");
    }
  };

  const handleReservationAction = async (
    id: string,
    action: "release" | "cancel" | "convert_to_pick"
  ) => {
    try {
      const res = await fetch(`/api/v1/inventory/reservations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reason: `Operator ${action} via Stock Intelligence Workbench`
        })
      });
      const data = await res.json();
      if (!res.ok) {
        notify("error", data?.error?.message ?? `Failed to ${action} reservation.`);
        return;
      }
      notify("ok", `Reservation ${data.reservation_number} → ${data.status}.`);
      await loadAll();
    } catch {
      notify("error", "Network error updating reservation.");
    }
  };

  const submitShelfLifeRule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/v1/inventory/shelf-life", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rule_scope: ruleScope,
          sku: ruleScope === "product" || ruleScope === "customer_product" ? ruleSku : null,
          customer_name:
            ruleScope === "customer" || ruleScope === "customer_product"
              ? ruleCustomerName.trim()
              : null,
          customer_segment: ruleScope === "segment" ? ruleSegment.trim() : null,
          min_remaining_days: Number(ruleMinDays),
          min_remaining_pct: ruleMinPct ? Number(ruleMinPct) : null,
          notes: ruleNotes.trim() || null
        })
      });
      const data = await res.json();
      if (!res.ok) {
        notify("error", data?.error?.message ?? "Failed to save shelf-life rule.");
        return;
      }
      notify("ok", `Shelf-life rule ${data.rule_code} saved (>= ${data.min_remaining_days} days at delivery).`);
      setRuleNotes("");
      await loadAll();
    } catch {
      notify("error", "Network error saving shelf-life rule.");
    }
  };

  const submitNewCycleCount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/v1/inventory/cycle-counts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `cc-new-${ccLot}-${Date.now()}`
        },
        body: JSON.stringify({
          count_type: ccType,
          internal_lot: ccLot,
          is_blind: ccBlind,
          assigned_to_name: ccAssignee.trim() || "Pietro Rossi",
          notes: ccNotes.trim() || null
        })
      });
      const data = await res.json();
      if (!res.ok) {
        notify("error", data?.error?.message ?? "Failed to create cycle count.");
        return;
      }
      notify("ok", `Cycle count ${data.count_number} created (${data.is_blind ? "Blind Count" : "Guided"}).`);
      setCcNotes("");
      await loadAll();
    } catch {
      notify("error", "Network error creating cycle count.");
    }
  };

  const handleCountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCountModal) return;
    try {
      const res = await fetch(`/api/v1/inventory/cycle-counts/${encodeURIComponent(activeCountModal.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          counted_cases: Number(submitCountCases),
          counted_weight_kg: submitCountWeight ? Number(submitCountWeight) : null,
          barcode_scanned: submitBarcode.trim() || null,
          discrepancy_reason: submitReason.trim() || null
        })
      });
      const data = await res.json();
      if (!res.ok) {
        notify("error", data?.error?.message ?? "Failed to submit count.");
        return;
      }
      notify(
        "ok",
        `Count ${data.count_number} submitted (${data.counted_cases} cases). Status: ${data.status}. Stock remains untouched until manager approval.`
      );
      setActiveCountModal(null);
      setSubmitCountCases("");
      setSubmitCountWeight("");
      setSubmitBarcode("");
      setSubmitReason("");
      await loadAll();
    } catch {
      notify("error", "Network error submitting cycle count.");
    }
  };

  const handleCountDecision = async (
    id: string,
    action: "approve" | "request_recount" | "reject"
  ) => {
    try {
      const res = await fetch(`/api/v1/inventory/cycle-counts/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          notes: `Manager ${action} decision via Stock Intelligence`
        })
      });
      const data = await res.json();
      if (!res.ok) {
        notify("error", data?.error?.message ?? `Failed to ${action} count.`);
        return;
      }
      notify(
        "ok",
        `Cycle count ${data.cycle_count?.count_number} → ${data.cycle_count?.status}${
          data.adjustment ? ` (Reconciled via ${data.adjustment.adjustment_number})` : ""
        }.`
      );
      await loadAll();
    } catch {
      notify("error", "Network error updating cycle count.");
    }
  };

  const submitStockAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/v1/inventory/adjustments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `adj-${adjLot}-${Date.now()}`
        },
        body: JSON.stringify({
          internal_lot: adjLot,
          adjustment_type: adjType,
          actual_cases: Number(adjActualCases),
          actual_weight_kg: adjActualWeight ? Number(adjActualWeight) : null,
          target_bin_code: adjType === "mislocated_transfer" ? adjTargetBin.trim() : null,
          reason: adjReason.trim(),
          evidence: adjEvidence.trim() ? [adjEvidence.trim()] : []
        })
      });
      const data = await res.json();
      if (!res.ok) {
        notify("error", data?.error?.message ?? "Failed to submit stock adjustment.");
        return;
      }
      notify(
        "ok",
        `Adjustment ${data.adjustment_number} created (${data.status}). Difference: ${
          data.difference_cases > 0 ? "+" : ""
        }${data.difference_cases} cases.`
      );
      setAdjActualCases("");
      setAdjActualWeight("");
      setAdjReason("");
      setAdjEvidence("");
      await loadAll();
    } catch {
      notify("error", "Network error creating stock adjustment.");
    }
  };

  const handleAdjustmentDecision = async (id: string, decision: "approve" | "reject") => {
    try {
      const res = await fetch(`/api/v1/inventory/adjustments/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          approval_notes: `Manager ${decision} via Stock Intelligence`
        })
      });
      const data = await res.json();
      if (!res.ok) {
        notify("error", data?.error?.message ?? `Failed to ${decision} adjustment.`);
        return;
      }
      notify("ok", `Adjustment ${data.adjustment_number} → ${data.status}.`);
      await loadAll();
    } catch {
      notify("error", "Network error deciding adjustment.");
    }
  };

  return (
    <div className="space-y-5">
      {feedback && (
        <div
          className={`fixed bottom-5 right-5 z-[90] max-w-md rounded-xl border px-4 py-3 text-xs font-medium shadow-xl ${
            feedback.tone === "ok"
              ? "border-marine-ocean/60 bg-white text-marine-mid/90"
              : "border-red-200 bg-white text-red-800"
          }`}
        >
          <span className="flex items-start gap-2">
            {feedback.tone === "ok" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-marine-mid" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            )}
            <span>{feedback.text}</span>
          </span>
        </div>
      )}

      {/* Multi-Level Stock KPI Row */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          label="Available stock (FEFO)"
          value={`${number(summary?.available_cases ?? 0, 0)} cases`}
          change={`${number(summary?.available_weight_kg ?? 0, 1)} kg · ${currency(summary?.available_value_cents ?? 0)}`}
          trend="up"
          tone="ok"
          icon={<PackageCheck className="h-4 w-4" />}
        />
        <KpiCard
          label="Reserved stock"
          value={`${number(summary?.reserved_cases ?? 0, 0)} cases`}
          change={`${summary?.active_reservations_count ?? 0} active reservations (${number(summary?.reserved_weight_kg ?? 0, 1)} kg)`}
          trend="flat"
          tone="info"
          icon={<Lock className="h-4 w-4" />}
        />
        <KpiCard
          label="Blocked / Held / QA"
          value={`${number(summary?.blocked_cases ?? 0, 0)} cases`}
          change={`${number(summary?.blocked_weight_kg ?? 0, 1)} kg unavailable to sales`}
          trend="down"
          tone={(summary?.blocked_cases ?? 0) > 0 ? "warning" : "ok"}
          icon={<ShieldAlert className="h-4 w-4" />}
        />
        <KpiCard
          label="Physical & Catch-Weight"
          value={`${number(summary?.catch_weight_kg ?? 0, 1)} kg`}
          change={`${number(summary?.physical_cases ?? 0, 0)} physical cases · Valued at ${currency(summary?.stock_value_cents ?? 0)}`}
          trend="flat"
          icon={<Scale className="h-4 w-4" />}
        />
        <KpiCard
          label="Cycle Count Accuracy"
          value={`${number(summary?.cycle_count_accuracy_pct ?? 100, 1)}%`}
          change={`${summary?.pending_cycle_count_approvals ?? 0} counts & ${summary?.pending_adjustment_approvals ?? 0} adjustments awaiting approval`}
          trend="up"
          tone={(summary?.pending_adjustment_approvals ?? 0) > 0 ? "warning" : "ok"}
          icon={<ClipboardCheck className="h-4 w-4" />}
        />
      </div>

      {/* Status Reconciliation Bar across all 8 statuses */}
      {statusBreakdown && (
        <Surface>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold">
                Multi-Level Stock Status Breakdown (Organization: Ascentra Global Ltd)
              </span>
              <Badge tone={summary?.reconciled ? "ok" : "critical"} dot>
                {summary?.reconciled ? "100% Reconciled" : "Variance Detected"}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Can permission="exports.run" mode="hide">
                <button type="button" className="btn btn-secondary btn-sm" onClick={exportCsv}>
                  <Download className="h-3.5 w-3.5" /> Export Ledger CSV
                </button>
              </Can>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadAll()}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5 p-4 sm:grid-cols-4 xl:grid-cols-8">
            {STOCK_STATUSES.map((st) => {
              const item = statusBreakdown[st] ?? { cases: 0, weight_kg: 0, value_cents: 0 };
              const isSelected = statusFilter === st;
              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(isSelected ? "ALL" : st)}
                  className={`rounded-xl border p-3 text-left transition ${
                    isSelected
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border bg-background hover:bg-muted/60"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-muted-foreground">{st}</span>
                    <Badge
                      tone={
                        st === "Available"
                          ? "ok"
                          : st === "Reserved" || st === "In Transit"
                            ? "info"
                            : st === "Held"
                              ? "warning"
                              : "critical"
                      }
                    >
                      {number(item.cases, 0)}c
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-sm font-bold">{number(item.weight_kg, 1)} kg</p>
                  <p className="text-[10px] text-muted-foreground">{currency(item.value_cents)}</p>
                </button>
              );
            })}
          </div>
        </Surface>
      )}

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: "explorer", label: `Warehouse & Lot Explorer (${lots.length})`, icon: Boxes },
            { id: "fefo", label: "FEFO Allocation Engine", icon: Sparkles },
            { id: "reservations", label: `Reservations (${reservations.length})`, icon: Lock },
            { id: "shelf_life", label: `Shelf-Life Control (${shelfLifeAlerts.length} alerts)`, icon: CalendarClock },
            { id: "cycle_counts", label: `Cycle Counting (${cycleCounts.length})`, icon: ScanBarcode },
            { id: "adjustments", label: `Reconciled Adjustments (${adjustments.length})`, icon: ArrowRightLeft },
            { id: "movements", label: `Movement Ledger (${movementsTotal})`, icon: History }
          ].map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id as TabId)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? "bg-[#061222] text-white shadow-sm"
                    : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Global Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search batch, SKU, bin…"
              className="h-8 rounded-lg border border-input bg-background pl-8 pr-3 text-xs outline-none"
            />
          </div>
          <select
            value={warehouseFilter}
            onChange={(e) => {
              setWarehouseFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by warehouse"
            className="h-8 rounded-lg border border-input bg-background px-2.5 text-xs outline-none"
          >
            <option value="ALL">All Warehouses</option>
            <option value="Milan Cold Hub">Milan Cold Hub</option>
            <option value="Rome Cold Hub">Rome Cold Hub</option>
            <option value="Bologna Freezer DC">Bologna Freezer DC</option>
          </select>
          <select
            value={zoneFilter}
            onChange={(e) => {
              setZoneFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by zone"
            className="h-8 rounded-lg border border-input bg-background px-2.5 text-xs outline-none"
          >
            <option value="ALL">All Zones</option>
            {availableZones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by stock status"
            className="h-8 rounded-lg border border-input bg-background px-2.5 text-xs outline-none"
          >
            <option value="ALL">All Stock Statuses</option>
            {STOCK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* TAB 1: WAREHOUSE & LOT EXPLORER */}
      {activeTab === "explorer" && (
        <div className="space-y-5">
          {byWarehouse.length > 0 && (
            <div className="grid gap-3 md:grid-cols-3">
              {byWarehouse.map((wh) => (
                <Surface key={wh.warehouse} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Warehouse className="h-4 w-4 text-primary" />
                      <p className="text-xs font-bold">{wh.warehouse}</p>
                    </div>
                    <Badge tone="info">{wh.lots_count} lots</Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[11px]">
                    <div className="rounded-lg bg-secondary/70 p-2">
                      <p className="text-muted-foreground">Physical</p>
                      <p className="font-bold">{number(wh.physical_cases, 0)}c</p>
                    </div>
                    <div className="rounded-lg bg-marine-ocean/20 p-2 text-marine-navy">
                      <p className="text-[10px]">Available</p>
                      <p className="font-bold">{number(wh.available_cases, 0)}c</p>
                    </div>
                    <div className="rounded-lg bg-blue-50 p-2 text-blue-900">
                      <p className="text-[10px]">Reserved</p>
                      <p className="font-bold">{number(wh.reserved_cases, 0)}c</p>
                    </div>
                    <div className="rounded-lg bg-amber-50 p-2 text-amber-900">
                      <p className="text-[10px]">Blocked</p>
                      <p className="font-bold">{number(wh.blocked_cases, 0)}c</p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Catch-weight: {number(wh.catch_weight_kg, 1)} kg</span>
                    <span className="font-semibold text-foreground">{currency(wh.stock_value_cents)}</span>
                  </div>
                </Surface>
              ))}
            </div>
          )}

          <Surface>
            <SectionHeader
              eyebrow="Multi-level stock visibility"
              title="Warehouse, Zone, Bin & Lot Inventory Ledger"
              description="Physical stock is never automatically treated as available. Blocked stock includes Held, Quarantined, Rejected, Damaged, Expired, and Cold-Chain Excursion lots."
              action={
                <span className="inline-flex items-center gap-2">
                  <ViewOnlyBadge
                    modifyPermissions={["inventory:adjust", "inventory.reserve", "inventory.count", "inventory.approve_adjustment", "orders:write", "orders:credit_override", "warehouse:update", "exports.run"]}
                  />
                  <Badge tone="info">{lots.length} matching lots</Badge>
                </span>
              }
            />
            <div className="table-shell">
              <table className="data-table min-w-[1180px]">
                <thead>
                  <tr>
                    <th>FEFO</th>
                    <th>Internal Lot / Supplier Batch</th>
                    <th>Product / SKU</th>
                    <th>Warehouse · Zone · Bin</th>
                    <th>Expires</th>
                    <th>Physical</th>
                    <th>Available</th>
                    <th>Reserved</th>
                    <th>Blocked</th>
                    <th>Catch-Wt / Value</th>
                    <th>Status</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedLots.length === 0 && (
                    <tr>
                      <td colSpan={12} className="py-10 text-center text-xs text-muted-foreground">
                        No inventory lots match your current filters.
                      </td>
                    </tr>
                  )}
                  {pagedLots.map((lot) => (
                    <tr key={lot.id}>
                      <td data-label="FEFO">
                        {lot.fefo_rank ? (
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-[11px] font-bold text-primary">
                            #{lot.fefo_rank}
                          </span>
                        ) : (
                          <span className="text-[11px] font-semibold text-muted-foreground">Blocked</span>
                        )}
                      </td>
                      <td data-label="Lot / Batch">
                        <p className="font-mono text-xs font-semibold">{lot.internal_lot}</p>
                        <p className="text-[10px] text-muted-foreground">
                          Sup: {lot.supplier_batch} · {lot.supplier_name}
                        </p>
                      </td>
                      <td data-label="Product / SKU">
                        <p className="font-medium">{lot.product_name}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">
                          {lot.sku} · {lot.category}
                        </p>
                      </td>
                      <td data-label="Location">
                        <p className="font-mono text-xs font-semibold">{lot.bin_code}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {lot.warehouse} · {lot.zone}
                        </p>
                      </td>
                      <td data-label="Expires" className="whitespace-nowrap">
                        <p className="text-xs font-medium">{shortDate(lot.expiry_date)}</p>
                        <p
                          className={`text-[10px] font-semibold ${
                            lot.days_remaining <= 2
                              ? "text-red-600"
                              : lot.days_remaining <= 5
                                ? "text-amber-600"
                                : "text-muted-foreground"
                          }`}
                        >
                          {lot.days_remaining}d remaining (min {lot.min_shelf_life_days}d)
                        </p>
                      </td>
                      <td data-label="Physical" className="font-semibold">
                        {number(lot.physical_cases, 0)} c
                      </td>
                      <td data-label="Available">
                        <span
                          className={`font-bold ${
                            lot.available_cases > 0 ? "text-marine-mid" : "text-muted-foreground"
                          }`}
                        >
                          {number(lot.available_cases, 0)} c
                        </span>
                      </td>
                      <td data-label="Reserved">
                        <span className={lot.reserved_cases > 0 ? "font-semibold text-blue-700" : "text-muted-foreground"}>
                          {number(lot.reserved_cases, 0)} c
                        </span>
                      </td>
                      <td data-label="Blocked">
                        <span className={lot.blocked_cases > 0 ? "font-semibold text-red-700" : "text-muted-foreground"}>
                          {number(lot.blocked_cases, 0)} c
                        </span>
                      </td>
                      <td data-label="Catch-Wt / Value" className="whitespace-nowrap">
                        <p className="text-xs font-medium">{number(lot.catch_weight_kg, 1)} kg</p>
                        <p className="text-[10px] text-muted-foreground">{currency(lot.stock_value_cents)}</p>
                      </td>
                      <td data-label="Status">
                        <div className="flex flex-col gap-1">
                          <Badge
                            tone={
                              lot.primary_stock_status === "Available"
                                ? "ok"
                                : lot.primary_stock_status === "Reserved"
                                  ? "info"
                                  : lot.primary_stock_status === "Held"
                                    ? "warning"
                                    : "critical"
                            }
                            dot
                          >
                            {lot.primary_stock_status}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {lot.temp_c.toFixed(1)}°C · QA: {titleCase(lot.quality_status)}
                          </span>
                        </div>
                      </td>
                      <td data-label="Detail">
                        <button
                          type="button"
                          onClick={() => void openLotDetail(lot.internal_lot)}
                          className="btn btn-secondary btn-sm"
                        >
                          <Eye className="h-3.5 w-3.5" /> 360°
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {lots.length > pageSize && (
              <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs">
                <span>
                  Showing {(page - 1) * pageSize + 1}–{Math.min(lots.length, page * pageSize)} of {lots.length} lots
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="btn btn-secondary btn-sm"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={page * pageSize >= lots.length}
                    onClick={() => setPage((p) => p + 1)}
                    className="btn btn-secondary btn-sm"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </Surface>
        </div>
      )}

      {/* TAB 2: FEFO ALLOCATION ENGINE */}
      {activeTab === "fefo" && (
        <div className="grid gap-5 xl:grid-cols-3">
          <Surface>
            <SectionHeader
              eyebrow="First Expired, First Out"
              title="FEFO Allocation & Eligibility Evaluator"
              description="Calculates remaining shelf life against the expected delivery date and enforces product, customer, and order shelf-life rules."
            />
            <form onSubmit={runFefoEvaluation} className="space-y-3 p-5">
              <label className="block">
                <span className="field-label">Product / SKU</span>
                <select
                  value={fefoSku}
                  onChange={(e) => setFefoSku(e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-xs outline-none"
                >
                  {availableSkus.map(([code, name]) => (
                    <option key={code} value={code}>
                      {code} · {name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="field-label">Requested Cases</span>
                  <input
                    type="number"
                    min="1"
                    required
                    value={fefoQty}
                    onChange={(e) => setFefoQty(e.target.value)}
                    className="input mt-1"
                  />
                </label>
                <label className="block">
                  <span className="field-label">Warehouse</span>
                  <select
                    value={fefoWarehouse}
                    onChange={(e) => setFefoWarehouse(e.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-xs outline-none"
                  >
                    <option value="Milan Cold Hub">Milan Cold Hub</option>
                    <option value="Bologna Freezer DC">Bologna Freezer DC</option>
                    <option value="Rome Cold Hub">Rome Cold Hub</option>
                    <option value="ALL">Any Warehouse</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="field-label">Customer (for customer-specific shelf-life rules)</span>
                <input
                  type="text"
                  value={fefoCustomer}
                  onChange={(e) => setFefoCustomer(e.target.value)}
                  placeholder="e.g. Ristorante Cracco Galleria"
                  className="input mt-1"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="field-label">Expected Delivery Date</span>
                  <input
                    type="date"
                    required
                    value={fefoDeliveryDate}
                    onChange={(e) => setFefoDeliveryDate(e.target.value)}
                    className="input mt-1"
                  />
                </label>
                <label className="block">
                  <span className="field-label">Order Min Shelf Life (Days)</span>
                  <input
                    type="number"
                    min="0"
                    value={fefoOrderMinDays}
                    onChange={(e) => setFefoOrderMinDays(e.target.value)}
                    placeholder="Optional override"
                    className="input mt-1"
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 pt-1 text-xs">
                <input
                  type="checkbox"
                  checked={fefoAllowPartial}
                  onChange={(e) => setFefoAllowPartial(e.target.checked)}
                />
                <span>Allow partial allocation if total eligible stock is below requested quantity</span>
              </label>
              <Can permission="inventory:read" mode="disable">
                <button type="submit" className="btn btn-primary w-full justify-center">
                  <Sparkles className="h-4 w-4" /> Evaluate FEFO & Log Lot Decisions
                </button>
              </Can>
            </form>
          </Surface>

          <Surface className="xl:col-span-2">
            <SectionHeader
              eyebrow="FEFO Decision Audit"
              title="Lot Selection & Exclusion Breakdown"
              description="Every candidate lot is evaluated in earliest-expiry order with explicit selection or exclusion reasons."
            />
            <div className="p-5">
              {fefoError && (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-900">
                  <p className="font-bold">FEFO Availability Error (No Unsuitable Stock Allocated)</p>
                  <p className="mt-1 leading-5">{fefoError}</p>
                </div>
              )}

              {!fefoResult && !fefoError && (
                <p className="py-10 text-center text-xs text-muted-foreground">
                  Run the FEFO evaluator on the left to inspect lot rankings, partial splits, and exclusion reasons.
                </p>
              )}

              {fefoResult && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-secondary p-3.5 text-xs">
                    <div>
                      <p className="font-bold">
                        Allocation Ref: {fefoResult.allocation_ref} · Min Shelf Life at Delivery ({fefoResult.delivery_date}):{" "}
                        {fefoResult.min_shelf_life_days_required} days
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Rules applied: {fefoResult.applied_shelf_life_rules.join(" · ")}
                      </p>
                    </div>
                    <Badge tone={fefoResult.fully_allocated ? "ok" : "warning"} dot>
                      Allocated {fefoResult.allocated_cases} / {fefoResult.requested_cases} cases
                    </Badge>
                  </div>

                  <div className="table-shell">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>FEFO</th>
                          <th>Lot / Location</th>
                          <th>Expires</th>
                          <th>Days @ Delivery</th>
                          <th>Available</th>
                          <th>Allocated</th>
                          <th>Decision</th>
                          <th>Selection / Exclusion Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fefoResult.candidates.map((c) => (
                          <tr key={c.internal_lot}>
                            <td>{c.fefo_rank ? `#${c.fefo_rank}` : "—"}</td>
                            <td>
                              <p className="font-mono text-xs font-semibold">{c.internal_lot}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {c.warehouse} · {c.bin_code}
                              </p>
                            </td>
                            <td className="whitespace-nowrap text-xs">{shortDate(c.expiry_date)}</td>
                            <td>
                              <span
                                className={`font-semibold ${
                                  c.days_remaining_at_delivery < c.min_shelf_life_days_required
                                    ? "text-red-600"
                                    : "text-marine-mid"
                                }`}
                              >
                                {c.days_remaining_at_delivery}d
                              </span>{" "}
                              <span className="text-[10px] text-muted-foreground">
                                (req &ge;{c.min_shelf_life_days_required}d)
                              </span>
                            </td>
                            <td>{c.available_cases} c</td>
                            <td className="font-bold text-marine-mid">
                              {c.allocated_cases > 0 ? `${c.allocated_cases} c (${c.allocated_weight_kg} kg)` : "0 c"}
                            </td>
                            <td>
                              <Badge
                                tone={
                                  c.decision === "selected"
                                    ? "ok"
                                    : c.decision === "partial_selected"
                                      ? "info"
                                      : c.decision === "eligible_standby"
                                        ? "neutral"
                                        : "critical"
                                }
                              >
                                {c.decision.replace(/_/g, " ")}
                              </Badge>
                            </td>
                            <td className="max-w-sm text-[11px] leading-4 text-muted-foreground">
                              {c.reason_detail}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </Surface>
        </div>
      )}

      {/* TAB 3: STOCK RESERVATIONS */}
      {activeTab === "reservations" && (
        <div className="grid gap-5 xl:grid-cols-3">
          <Surface>
            <SectionHeader
              eyebrow="Concurrency-Protected Reservations"
              title="Create Order-Linked Reservation"
              description="Reserves eligible FEFO stock atomically inside an immediate database transaction to prevent overselling."
            />
            <form onSubmit={submitReservation} className="space-y-3 p-5">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="field-label">Order Number</span>
                  <input
                    type="text"
                    required
                    value={resOrderNumber}
                    onChange={(e) => setResOrderNumber(e.target.value)}
                    placeholder="SO-2026-9842"
                    className="input mt-1"
                  />
                </label>
                <label className="block">
                  <span className="field-label">Customer</span>
                  <input
                    type="text"
                    required
                    value={resCustomerName}
                    onChange={(e) => setResCustomerName(e.target.value)}
                    placeholder="Customer name"
                    className="input mt-1"
                  />
                </label>
              </div>
              <label className="block">
                <span className="field-label">SKU</span>
                <select
                  value={resSku}
                  onChange={(e) => setResSku(e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-xs outline-none"
                >
                  {availableSkus.map(([code, name]) => (
                    <option key={code} value={code}>
                      {code} · {name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="field-label">Quantity (Cases)</span>
                  <input
                    type="number"
                    min="1"
                    required
                    value={resQty}
                    onChange={(e) => setResQty(e.target.value)}
                    className="input mt-1"
                  />
                </label>
                <label className="block">
                  <span className="field-label">Warehouse</span>
                  <select
                    value={resWarehouse}
                    onChange={(e) => setResWarehouse(e.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-xs outline-none"
                  >
                    <option value="Milan Cold Hub">Milan Cold Hub</option>
                    <option value="Bologna Freezer DC">Bologna Freezer DC</option>
                    <option value="Rome Cold Hub">Rome Cold Hub</option>
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="field-label">Delivery Date</span>
                  <input
                    type="date"
                    required
                    value={resDeliveryDate}
                    onChange={(e) => setResDeliveryDate(e.target.value)}
                    className="input mt-1"
                  />
                </label>
                <label className="block">
                  <span className="field-label">Min Shelf Life (Days)</span>
                  <input
                    type="number"
                    min="0"
                    value={resMinDays}
                    onChange={(e) => setResMinDays(e.target.value)}
                    placeholder="Auto from rules"
                    className="input mt-1"
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 pt-1 text-xs">
                <input
                  type="checkbox"
                  checked={resAllowPartial}
                  onChange={(e) => setResAllowPartial(e.target.checked)}
                />
                <span>Allow partial reservation across available FEFO lots</span>
              </label>
              <Can anyOf={["inventory.reserve", "inventory:adjust", "orders:write", "orders:credit_override"]} mode="disable">
                <button type="submit" className="btn btn-primary w-full justify-center">
                  <Lock className="h-4 w-4" /> Reserve Eligible Stock (FEFO)
                </button>
              </Can>
            </form>
          </Surface>

          <Surface className="xl:col-span-2">
            <SectionHeader
              eyebrow="Reservation Ledger & Pick Conversion"
              title="Active & Historical Stock Reservations"
              description="Convert reservations directly into warehouse picking tasks, or release/cancel to restore available stock."
            />
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Reservation / Order</th>
                    <th>SKU / Internal Lot</th>
                    <th>Warehouse · Bin</th>
                    <th>Reserved</th>
                    <th>Delivery / Shelf Life</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reservations.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-xs text-muted-foreground">
                        No stock reservations recorded yet.
                      </td>
                    </tr>
                  )}
                  {reservations.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <p className="font-mono text-xs font-semibold">{r.reservation_number}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {r.order_number || "Ad-hoc"} · {r.customer_name || "Internal"}
                        </p>
                      </td>
                      <td>
                        <p className="font-medium">{r.sku}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">{r.internal_lot}</p>
                      </td>
                      <td>
                        <p className="text-xs">{r.bin_code || "—"}</p>
                        <p className="text-[10px] text-muted-foreground">{r.warehouse}</p>
                      </td>
                      <td>
                        <p className="font-bold">
                          {r.reserved_cases} / {r.requested_cases} c
                        </p>
                        <p className="text-[10px] text-muted-foreground">{r.reserved_weight_kg} kg</p>
                      </td>
                      <td>
                        <p className="text-xs">{r.delivery_date ? shortDate(r.delivery_date) : "—"}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {r.days_remaining_at_delivery ?? "—"}d at delivery (req &ge;{r.min_shelf_life_days_required}d)
                        </p>
                      </td>
                      <td>
                        <Badge
                          tone={
                            r.status === "Active" || r.status === "Converted to Pick"
                              ? "ok"
                              : r.status === "Partially Reserved"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {r.status}
                        </Badge>
                        {r.pick_task_id && (
                          <p className="mt-0.5 font-mono text-[10px] text-marine-mid">Pick: {r.pick_task_id}</p>
                        )}
                      </td>
                      <td>
                        {(r.status === "Active" || r.status === "Partially Reserved") && (
                          <div className="flex flex-wrap gap-1">
                            <Can anyOf={["inventory.reserve", "inventory:adjust", "orders:write", "warehouse:update"]} mode="disable">
                              <button
                                type="button"
                                onClick={() => void handleReservationAction(r.id, "convert_to_pick")}
                                className="btn btn-primary btn-sm"
                              >
                                To Pick
                              </button>
                            </Can>
                            <Can anyOf={["inventory.reserve", "inventory:adjust", "orders:write", "warehouse:update"]} mode="disable">
                              <button
                                type="button"
                                onClick={() => void handleReservationAction(r.id, "release")}
                                className="btn btn-secondary btn-sm"
                              >
                                Release
                              </button>
                            </Can>
                            <Can anyOf={["inventory.reserve", "inventory:adjust", "orders:write", "warehouse:update"]} mode="disable">
                              <button
                                type="button"
                                onClick={() => void handleReservationAction(r.id, "cancel")}
                                className="btn btn-ghost btn-sm text-red-600"
                              >
                                Cancel
                              </button>
                            </Can>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Surface>
        </div>
      )}

      {/* TAB 4: MINIMUM REMAINING SHELF-LIFE RULES & ALERTS */}
      {activeTab === "shelf_life" && (
        <div className="grid gap-5 xl:grid-cols-3">
          <Surface>
            <SectionHeader
              eyebrow="Configurable Eligibility Rules"
              title="Add / Update Shelf-Life Rule"
              description="Enforced against expected delivery date during FEFO allocation, reservation, and picking."
            />
            <form onSubmit={submitShelfLifeRule} className="space-y-3 p-5">
              <label className="block">
                <span className="field-label">Rule Scope</span>
                <select
                  value={ruleScope}
                  onChange={(e) => setRuleScope(e.target.value as typeof ruleScope)}
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-xs outline-none"
                >
                  <option value="product">Product-Specific Minimum Shelf Life</option>
                  <option value="customer">Customer-Specific SLA Minimum</option>
                  <option value="customer_product">Customer + Product Contract Rule</option>
                  <option value="segment">Customer Segment Rule</option>
                </select>
              </label>

              {(ruleScope === "product" || ruleScope === "customer_product") && (
                <label className="block">
                  <span className="field-label">SKU</span>
                  <select
                    value={ruleSku}
                    onChange={(e) => setRuleSku(e.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-xs outline-none"
                  >
                    {availableSkus.map(([code, name]) => (
                      <option key={code} value={code}>
                        {code} · {name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {(ruleScope === "customer" || ruleScope === "customer_product") && (
                <label className="block">
                  <span className="field-label">Customer Name</span>
                  <input
                    type="text"
                    required
                    value={ruleCustomerName}
                    onChange={(e) => setRuleCustomerName(e.target.value)}
                    placeholder="e.g. Hotel Principe di Savoia"
                    className="input mt-1"
                  />
                </label>
              )}

              {ruleScope === "segment" && (
                <label className="block">
                  <span className="field-label">Customer Segment</span>
                  <input
                    type="text"
                    required
                    value={ruleSegment}
                    onChange={(e) => setRuleSegment(e.target.value)}
                    placeholder="e.g. Fine Dining, Retail Store, Luxury Hotel"
                    className="input mt-1"
                  />
                </label>
              )}

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="field-label">Min Remaining Days</span>
                  <input
                    type="number"
                    min="1"
                    required
                    value={ruleMinDays}
                    onChange={(e) => setRuleMinDays(e.target.value)}
                    className="input mt-1"
                  />
                </label>
                <label className="block">
                  <span className="field-label">Min Remaining %</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={ruleMinPct}
                    onChange={(e) => setRuleMinPct(e.target.value)}
                    className="input mt-1"
                  />
                </label>
              </div>
              <label className="block">
                <span className="field-label">Policy Notes</span>
                <input
                  type="text"
                  value={ruleNotes}
                  onChange={(e) => setRuleNotes(e.target.value)}
                  placeholder="Contractual SLA or HACCP shelf-life note"
                  className="input mt-1"
                />
              </label>
              <Can permission="inventory:adjust" mode="disable">
                <button type="submit" className="btn btn-primary w-full justify-center">
                  <Plus className="h-4 w-4" /> Save Shelf-Life Rule
                </button>
              </Can>
            </form>
          </Surface>

          <div className="space-y-5 xl:col-span-2">
            <Surface>
              <SectionHeader
                eyebrow="Shelf-Life Risk Monitor"
                title="Lots Failing or Approaching Minimum Shelf-Life Thresholds"
                description="Flagged lots that are expired, below product minimum shelf life, or expiring within 48 hours of threshold."
                action={
                  <span className="inline-flex items-center gap-2">
                    <ViewOnlyBadge
                      modifyPermissions={["inventory:adjust", "inventory.reserve", "inventory.count", "inventory.approve_adjustment", "orders:write", "orders:credit_override", "warehouse:update", "exports.run"]}
                    />
                    <Badge tone="warning">{shelfLifeAlerts.length} lots flagged</Badge>
                  </span>
                }
              />
              <div className="table-shell">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Lot / SKU</th>
                      <th>Warehouse · Bin</th>
                      <th>Expiry Date</th>
                      <th>Days Left</th>
                      <th>Min Required</th>
                      <th>Physical / Available</th>
                      <th>Alert Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shelfLifeAlerts.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-xs text-muted-foreground">
                          All active lots currently satisfy minimum shelf-life thresholds.
                        </td>
                      </tr>
                    )}
                    {shelfLifeAlerts.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <p className="font-mono text-xs font-semibold">{l.internal_lot}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {l.sku} · {l.product_name}
                          </p>
                        </td>
                        <td>
                          <p className="text-xs">{l.bin_code}</p>
                          <p className="text-[10px] text-muted-foreground">{l.warehouse}</p>
                        </td>
                        <td className="text-xs">{shortDate(l.expiry_date)}</td>
                        <td className="font-bold text-red-600">{l.days_remaining}d</td>
                        <td>{l.min_shelf_life_days}d</td>
                        <td>
                          {l.physical_cases}c / {l.available_cases}c avail
                        </td>
                        <td>
                          <Badge
                            tone={
                              l.shelf_life_alert === "expired" || l.shelf_life_alert === "critical"
                                ? "critical"
                                : "warning"
                            }
                            dot
                          >
                            {titleCase(l.shelf_life_alert)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Surface>

            <Surface>
              <SectionHeader
                eyebrow="Configured Shelf-Life Matrix"
                title="Active Product, Customer & Segment Shelf-Life Rules"
              />
              <div className="table-shell">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Rule Code</th>
                      <th>Scope</th>
                      <th>Target SKU / Customer / Segment</th>
                      <th>Min Remaining Days</th>
                      <th>Min %</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shelfLifeRules.map((r) => (
                      <tr key={r.id}>
                        <td className="font-mono text-xs font-semibold">{r.rule_code}</td>
                        <td>
                          <Badge tone="info">{r.rule_scope.replace("_", " ")}</Badge>
                        </td>
                        <td className="text-xs font-medium">
                          {[r.sku, r.customer_name, r.customer_segment].filter(Boolean).join(" · ") || "Global"}
                        </td>
                        <td className="font-bold">&ge; {r.min_remaining_days} days at delivery</td>
                        <td>{r.min_remaining_pct ? `${r.min_remaining_pct}%` : "—"}</td>
                        <td className="text-[11px] text-muted-foreground">{r.notes || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Surface>
          </div>
        </div>
      )}

      {/* TAB 5: CYCLE COUNTING */}
      {activeTab === "cycle_counts" && (
        <div className="grid gap-5 xl:grid-cols-3">
          <Surface>
            <SectionHeader
              eyebrow="Blind & Guided Verification"
              title="Schedule / Assign Cycle Count"
              description="Submitting a count records variance and triggers review — it never modifies stock until a manager approves."
            />
            <form onSubmit={submitNewCycleCount} className="space-y-3 p-5">
              <label className="block">
                <span className="field-label">Target Lot & Bin</span>
                <select
                  value={ccLot}
                  onChange={(e) => setCcLot(e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-xs outline-none"
                >
                  {lots.map((l) => (
                    <option key={l.id} value={l.internal_lot}>
                      {l.internal_lot} · {l.sku} · {l.bin_code} ({l.warehouse})
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="field-label">Count Type</span>
                  <select
                    value={ccType}
                    onChange={(e) => setCcType(e.target.value as "scheduled" | "ad_hoc")}
                    className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-xs outline-none"
                  >
                    <option value="scheduled">Scheduled Cycle Count</option>
                    <option value="ad_hoc">Ad-Hoc Spot Check</option>
                  </select>
                </label>
                <label className="block">
                  <span className="field-label">Assign To Staff</span>
                  <input
                    type="text"
                    required
                    value={ccAssignee}
                    onChange={(e) => setCcAssignee(e.target.value)}
                    className="input mt-1"
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 pt-1 text-xs">
                <input
                  type="checkbox"
                  checked={ccBlind}
                  onChange={(e) => setCcBlind(e.target.checked)}
                />
                <span>Blind Count (hide expected quantities from counter before submission)</span>
              </label>
              <label className="block">
                <span className="field-label">Count Instructions / Notes</span>
                <input
                  type="text"
                  value={ccNotes}
                  onChange={(e) => setCcNotes(e.target.value)}
                  placeholder="Verify catch-weight labels and bin barcode"
                  className="input mt-1"
                />
              </label>
              <Can anyOf={["inventory.count", "inventory:adjust"]} mode="disable">
                <button type="submit" className="btn btn-primary w-full justify-center">
                  <ScanBarcode className="h-4 w-4" /> Assign Cycle Count Task
                </button>
              </Can>
            </form>
          </Surface>

          <Surface className="xl:col-span-2">
            <SectionHeader
              eyebrow="Cycle Count Queue & Approval"
              title="Scheduled, Submitted & Discrepant Counts"
              description="Submit physical count & weight, order recounts on discrepancies, or approve to reconcile ledger."
            />
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Count #</th>
                    <th>Lot / Bin / SKU</th>
                    <th>Mode</th>
                    <th>Expected</th>
                    <th>Counted</th>
                    <th>Variance</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {cycleCounts.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-xs text-muted-foreground">
                        No cycle counts scheduled yet. Assign a count on the left.
                      </td>
                    </tr>
                  )}
                  {cycleCounts.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <p className="font-mono text-xs font-semibold">{c.count_number}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {c.count_type} · {c.assigned_to_name}
                          {c.recount_number > 0 ? ` · Recount #${c.recount_number}` : ""}
                        </p>
                      </td>
                      <td>
                        <p className="font-mono text-xs font-medium">{c.internal_lot}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {c.bin_code} · {c.sku}
                        </p>
                      </td>
                      <td>
                        <Badge tone={c.is_blind ? "info" : "neutral"}>
                          {c.is_blind ? "Blind" : "Guided"}
                        </Badge>
                      </td>
                      <td>
                        {c.expected_cases === null ? (
                          <span className="text-[11px] italic text-muted-foreground">Hidden (Blind)</span>
                        ) : (
                          <div>
                            <p className="text-xs font-medium">{c.expected_cases} c</p>
                            <p className="text-[10px] text-muted-foreground">{c.expected_weight_kg} kg</p>
                          </div>
                        )}
                      </td>
                      <td>
                        {c.counted_cases === null ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <div>
                            <p className="text-xs font-bold">{c.counted_cases} c</p>
                            <p className="text-[10px] text-muted-foreground">{c.counted_weight_kg} kg</p>
                          </div>
                        )}
                      </td>
                      <td>
                        {c.variance_cases === null ? (
                          "—"
                        ) : (
                          <span
                            className={`font-bold ${
                              c.variance_cases === 0
                                ? "text-marine-mid"
                                : "text-red-600"
                            }`}
                          >
                            {c.variance_cases > 0 ? "+" : ""}
                            {c.variance_cases} c ({c.variance_weight_kg && c.variance_weight_kg > 0 ? "+" : ""}
                            {c.variance_weight_kg ?? 0} kg)
                          </span>
                        )}
                      </td>
                      <td>
                        <Badge
                          tone={
                            c.status === "Approved"
                              ? "ok"
                              : c.status === "Discrepancy Review" || c.status === "Recount Requested"
                                ? "warning"
                                : c.status === "Rejected"
                                  ? "critical"
                                  : "info"
                          }
                        >
                          {c.status}
                        </Badge>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {(c.status === "Assigned" ||
                            c.status === "In Progress" ||
                            c.status === "Recount Requested") && (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveCountModal(c);
                                setSubmitBarcode(c.bin_code);
                              }}
                              className="btn btn-primary btn-sm"
                            >
                              Submit Count
                            </button>
                          )}
                          {(c.status === "Submitted" || c.status === "Discrepancy Review") && (
                            <>
                              <Can permission="inventory.approve_adjustment" mode="hide">
                                <button
                                  type="button"
                                  onClick={() => void handleCountDecision(c.id, "approve")}
                                  className="btn btn-primary btn-sm"
                                >
                                  Approve
                                </button>
                              </Can>
                              <Can permission="inventory.approve_adjustment" mode="disable">
                                <button
                                  type="button"
                                  onClick={() => void handleCountDecision(c.id, "request_recount")}
                                  className="btn btn-secondary btn-sm"
                                >
                                  Recount
                                </button>
                              </Can>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Surface>
        </div>
      )}

      {/* TAB 6: RECONCILED STOCK ADJUSTMENTS */}
      {activeTab === "adjustments" && (
        <div className="grid gap-5 xl:grid-cols-3">
          <Surface>
            <SectionHeader
              eyebrow="Controlled Inventory Correction"
              title="Request Reconciled Adjustment"
              description="Significant adjustments (>= 5 cases or >= €500) require manager approval before modifying ledger balances."
            />
            <form onSubmit={submitStockAdjustment} className="space-y-3 p-5">
              <label className="block">
                <span className="field-label">Lot / Batch</span>
                <select
                  value={adjLot}
                  onChange={(e) => setAdjLot(e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-xs outline-none"
                >
                  {lots.map((l) => (
                    <option key={l.id} value={l.internal_lot}>
                      {l.internal_lot} · {l.sku} ({l.physical_cases}c physical)
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="field-label">Adjustment Type</span>
                <select
                  value={adjType}
                  onChange={(e) => setAdjType(e.target.value as StockAdjustmentRecord["adjustment_type"])}
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-xs outline-none"
                >
                  <option value="damaged">Damaged Stock Write-Down</option>
                  <option value="expired">Expired Stock Isolation</option>
                  <option value="missing_shrinkage">Missing / Shrinkage Correction</option>
                  <option value="mislocated_transfer">Mislocated Stock Bin Transfer</option>
                  <option value="found_surplus">Found Surplus Verification</option>
                  <option value="quality_writeoff">Quality Destruction Write-Off</option>
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="field-label">Actual Remaining Cases</span>
                  <input
                    type="number"
                    min="0"
                    required
                    value={adjActualCases}
                    onChange={(e) => setAdjActualCases(e.target.value)}
                    placeholder="e.g. 45"
                    className="input mt-1"
                  />
                </label>
                <label className="block">
                  <span className="field-label">Actual Weight (kg)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={adjActualWeight}
                    onChange={(e) => setAdjActualWeight(e.target.value)}
                    placeholder="Auto from unit wt"
                    className="input mt-1"
                  />
                </label>
              </div>
              {adjType === "mislocated_transfer" && (
                <label className="block">
                  <span className="field-label">Target Corrected Bin Code</span>
                  <input
                    type="text"
                    required
                    value={adjTargetBin}
                    onChange={(e) => setAdjTargetBin(e.target.value)}
                    placeholder="e.g. CHILL-A1-02"
                    className="input mt-1"
                  />
                </label>
              )}
              <label className="block">
                <span className="field-label">Mandatory Adjustment Reason</span>
                <input
                  type="text"
                  required
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  placeholder="e.g. Forklift punctured 2 outer cartons at dock bay"
                  className="input mt-1"
                />
              </label>
              <label className="block">
                <span className="field-label">Supporting Evidence Reference</span>
                <input
                  type="text"
                  value={adjEvidence}
                  onChange={(e) => setAdjEvidence(e.target.value)}
                  placeholder="e.g. PHOTO-DMG-2026-09.jpg / NCR-402"
                  className="input mt-1"
                />
              </label>
              <Can permission="inventory:adjust" mode="disable">
                <button type="submit" className="btn btn-primary w-full justify-center">
                  <FileCheck2 className="h-4 w-4" /> Submit Stock Adjustment
                </button>
              </Can>
            </form>
          </Surface>

          <Surface className="xl:col-span-2">
            <SectionHeader
              eyebrow="Maker-Checker Governance"
              title="Stock Adjustments & Approval Queue"
              description="Every approved adjustment generates an immutable stock movement and audit event."
            />
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Adjustment #</th>
                    <th>Lot / SKU</th>
                    <th>Type</th>
                    <th>Original → Actual</th>
                    <th>Difference / Impact</th>
                    <th>Reason & Evidence</th>
                    <th>Status</th>
                    <th>Approval</th>
                  </tr>
                </thead>
                <tbody>
                  {adjustments.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-xs text-muted-foreground">
                        No stock adjustments recorded yet.
                      </td>
                    </tr>
                  )}
                  {adjustments.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <p className="font-mono text-xs font-semibold">{a.adjustment_number}</p>
                        <p className="text-[10px] text-muted-foreground">By {a.requested_by_name}</p>
                      </td>
                      <td>
                        <p className="font-mono text-xs font-medium">{a.internal_lot}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {a.sku} · {a.warehouse}
                        </p>
                      </td>
                      <td>
                        <Badge tone="neutral">{a.adjustment_type.replace(/_/g, " ")}</Badge>
                      </td>
                      <td>
                        <p className="text-xs">
                          {a.original_cases}c → <span className="font-bold">{a.actual_cases}c</span>
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {a.original_weight_kg}kg → {a.actual_weight_kg}kg
                        </p>
                      </td>
                      <td>
                        <p
                          className={`font-bold ${
                            a.difference_cases < 0 ? "text-red-600" : "text-marine-mid"
                          }`}
                        >
                          {a.difference_cases > 0 ? "+" : ""}
                          {a.difference_cases} c
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {currency(a.value_impact_cents)}
                        </p>
                      </td>
                      <td className="max-w-xs">
                        <p className="text-xs">{a.reason}</p>
                        {a.evidence.length > 0 && (
                          <p className="font-mono text-[10px] text-primary">
                            Evidence: {a.evidence.join(", ")}
                          </p>
                        )}
                      </td>
                      <td>
                        <Badge
                          tone={
                            a.status === "Approved"
                              ? "ok"
                              : a.status === "Pending Approval"
                                ? "warning"
                                : "critical"
                          }
                        >
                          {a.status}
                        </Badge>
                        {a.movement_id && (
                          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                            {a.movement_id}
                          </p>
                        )}
                      </td>
                      <td>
                        {a.status === "Pending Approval" && (
                          <div className="flex gap-1">
                            <Can permission="inventory.approve_adjustment" mode="hide">
                              <button
                                type="button"
                                onClick={() => void handleAdjustmentDecision(a.id, "approve")}
                                className="btn btn-primary btn-sm"
                              >
                                Approve
                              </button>
                            </Can>
                            <Can permission="inventory.approve_adjustment" mode="hide">
                              <button
                                type="button"
                                onClick={() => void handleAdjustmentDecision(a.id, "reject")}
                                className="btn btn-ghost btn-sm text-red-600"
                              >
                                Reject
                              </button>
                            </Can>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Surface>
        </div>
      )}

      {/* TAB 7: IMMUTABLE STOCK MOVEMENT LEDGER */}
      {activeTab === "movements" && (
        <Surface>
          <SectionHeader
            eyebrow="Immutable Audit Trail"
            title="Stock Movement History"
            description="Every receipt, put-away placement, order dispatch, cycle count reconciliation, and approved adjustment is permanently recorded."
            action={
              <span className="inline-flex items-center gap-2">
                <ViewOnlyBadge
                  modifyPermissions={["inventory:adjust", "inventory.reserve", "inventory.count", "inventory.approve_adjustment", "orders:write", "orders:credit_override", "warehouse:update", "exports.run"]}
                />
                <Badge tone="info">{movementsTotal} total movements</Badge>
              </span>
            }
          />
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Movement ID</th>
                  <th>Timestamp</th>
                  <th>Batch / SKU</th>
                  <th>Warehouse / Locations</th>
                  <th>Movement Type</th>
                  <th>Previous → New</th>
                  <th>Delta</th>
                  <th>Reason & Reference</th>
                  <th>Actor</th>
                </tr>
              </thead>
              <tbody>
                {movements.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-10 text-center text-xs text-muted-foreground">
                      No stock movements recorded yet.
                    </td>
                  </tr>
                )}
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="font-mono text-xs font-semibold">{m.id}</td>
                    <td className="whitespace-nowrap text-xs">{dateTime(m.created_at)}</td>
                    <td>
                      <p className="font-mono text-xs font-semibold">{m.batch_id}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {m.sku} · {m.product_name}
                      </p>
                    </td>
                    <td>
                      <p className="text-xs">{m.warehouse}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {m.source_location || "—"} → {m.destination_location || "—"}
                      </p>
                    </td>
                    <td>
                      <Badge tone="info">{m.movement_type}</Badge>
                    </td>
                    <td className="text-xs">
                      {m.previous_cases} c → <span className="font-bold">{m.new_cases} c</span>
                    </td>
                    <td>
                      <span
                        className={`font-bold ${
                          m.quantity_delta < 0
                            ? "text-red-600"
                            : m.quantity_delta > 0
                              ? "text-marine-mid"
                              : "text-muted-foreground"
                        }`}
                      >
                        {m.quantity_delta > 0 ? "+" : ""}
                        {m.quantity_delta} c
                      </span>
                    </td>
                    <td className="max-w-sm text-xs">{m.reason}</td>
                    <td className="text-xs text-muted-foreground">{m.actor_email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Surface>
      )}

      {/* MODAL: SUBMIT CYCLE COUNT */}
      {activeCountModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={handleCountSubmit}
            className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl"
          >
            <div className="flex items-start justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold">
                  Submit Physical Count · {activeCountModal.count_number}
                </h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Lot {activeCountModal.internal_lot} · Bin {activeCountModal.bin_code} (
                  {activeCountModal.is_blind ? "Blind Count" : `Expected: ${activeCountModal.expected_cases} cases`})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveCountModal(null)}
                className="btn btn-ghost btn-sm"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <label className="block">
                <span className="field-label">Scan Bin / Lot / SKU Barcode</span>
                <input
                  type="text"
                  required
                  value={submitBarcode}
                  onChange={(e) => setSubmitBarcode(e.target.value)}
                  placeholder={activeCountModal.bin_code}
                  className="input mt-1 font-mono"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="field-label">Counted Cases</span>
                  <input
                    type="number"
                    min="0"
                    required
                    value={submitCountCases}
                    onChange={(e) => setSubmitCountCases(e.target.value)}
                    placeholder="Physical cases"
                    className="input mt-1"
                  />
                </label>
                <label className="block">
                  <span className="field-label">Verified Weight (kg)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={submitCountWeight}
                    onChange={(e) => setSubmitCountWeight(e.target.value)}
                    placeholder="Scale reading kg"
                    className="input mt-1"
                  />
                </label>
              </div>
              <label className="block">
                <span className="field-label">Discrepancy / Count Notes</span>
                <input
                  type="text"
                  value={submitReason}
                  onChange={(e) => setSubmitReason(e.target.value)}
                  placeholder="Optional observation"
                  className="input mt-1"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button
                type="button"
                onClick={() => setActiveCountModal(null)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <Can anyOf={["inventory.count", "inventory:adjust"]} mode="disable">
                <button type="submit" className="btn btn-primary">
                  Record Count (Await Approval)
                </button>
              </Can>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: LOT & BATCH 360° DETAIL */}
      {selectedLotDetail && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-start justify-between border-b border-border px-6 py-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-primary">
                  Lot & Batch 360° Traceability & Status Breakdown
                </p>
                <h3 className="mt-0.5 text-base font-bold">
                  {selectedLotDetail.lot.internal_lot} · {selectedLotDetail.lot.product_name}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Supplier Batch: {selectedLotDetail.lot.supplier_batch} ({selectedLotDetail.lot.supplier_name}) ·{" "}
                  {selectedLotDetail.lot.warehouse} · Zone {selectedLotDetail.lot.zone} · Bin{" "}
                  {selectedLotDetail.lot.bin_code}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLotDetail(null)}
                className="btn btn-ghost btn-sm"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-6">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {STOCK_STATUSES.map((st) => (
                  <div key={st} className="rounded-lg border border-border bg-background p-2.5">
                    <p className="text-[10px] font-semibold uppercase text-muted-foreground">{st}</p>
                    <p className="mt-1 text-sm font-bold">
                      {selectedLotDetail.lot.status_breakdown[st] ?? 0} cases
                    </p>
                  </div>
                ))}
              </div>

              {selectedLotDetail.lot.availability_block_reasons.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="font-bold">Availability Restrictions:</p>
                  <ul className="mt-1 list-disc pl-4">
                    {selectedLotDetail.lot.availability_block_reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Bin Placements ({selectedLotDetail.lot.bin_placements.length})
                </h4>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {selectedLotDetail.lot.bin_placements.map((bp, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg border border-border p-2.5 text-xs"
                    >
                      <div>
                        <p className="font-mono font-semibold">{bp.bin_code}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {bp.warehouse} · {bp.zone_code}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">{bp.quantity_cases} cases</p>
                        <p className="text-[10px] text-muted-foreground">{bp.weight_kg} kg</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Recent Stock Movements ({selectedLotDetail.movements.length})
                </h4>
                <div className="mt-2 space-y-1.5">
                  {selectedLotDetail.movements.slice(0, 6).map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between rounded-lg bg-secondary/50 px-3 py-2 text-xs"
                    >
                      <div>
                        <span className="font-mono font-semibold">{m.movement_type}</span> · {m.reason}
                      </div>
                      <div className="font-mono font-bold">
                        {m.previous_cases}c → {m.new_cases}c ({m.quantity_delta > 0 ? "+" : ""}
                        {m.quantity_delta}c)
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
