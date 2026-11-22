"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  History,
  Lock,
  MapPin,
  PackageCheck,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Sparkles,
  Thermometer,
  UserCheck,
  Warehouse
} from "lucide-react";
import { Badge, Surface as Card } from "@/components/ui";
import { Can } from "@/components/access-gate";
import type {
  BinRecommendationCandidate,
  PutawayDashboardMetrics,
  PutawayPlacement,
  PutawayTask,
  PutawayTaskDetail,
  WarehouseBinRecord,
  WarehouseZoneRecord
} from "@/lib/putaway";

type ActiveTab = "tasks" | "recommendations" | "scanner" | "bins" | "history";

interface EligibleLotSummary {
  batch_id: string;
  sku: string;
  product_name: string;
  warehouse: string;
  location: string;
  quantity_cases: number;
  quality_status: string;
  expiry_date: string;
  temp_c: number | null;
}

export function PutawayWorkbench() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("tasks");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [warehouseFilter, setWarehouseFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [metrics, setMetrics] = useState<PutawayDashboardMetrics | null>(null);
  const [tasks, setTasks] = useState<PutawayTask[]>([]);
  const [zones, setZones] = useState<WarehouseZoneRecord[]>([]);
  const [bins, setBins] = useState<WarehouseBinRecord[]>([]);
  const [eligibleLots, setEligibleLots] = useState<EligibleLotSummary[]>([]);
  const [historyData, setHistoryData] = useState<{
    placements: PutawayPlacement[];
    stock_movements: Array<Record<string, unknown>>;
  }>({ placements: [], stock_movements: [] });

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<PutawayTaskDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);

  // Create Put-away Task Modal / Form state
  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);
  const [newTaskLot, setNewTaskLot] = useState<string>("");
  const [newTaskQty, setNewTaskQty] = useState<string>("");
  const [newTaskPriority, setNewTaskPriority] = useState<"low" | "normal" | "high" | "urgent">("normal");
  const [newTaskOperator, setNewTaskOperator] = useState<string>("Luca Bianchi");

  // Operator Assignment state
  const [operatorNameInput, setOperatorNameInput] = useState<string>("Luca Bianchi");
  const [priorityInput, setPriorityInput] = useState<"low" | "normal" | "high" | "urgent">("normal");

  // Manager Recommendation Override state
  const [overrideBinCode, setOverrideBinCode] = useState<string>("");
  const [overrideReason, setOverrideReason] = useState<string>("");

  // Barcode / QR Scan state
  const [scanTaskInput, setScanTaskInput] = useState<string>("");
  const [scanSkuInput, setScanSkuInput] = useState<string>("");
  const [scanLotInput, setScanLotInput] = useState<string>("");
  const [scanBinInput, setScanBinInput] = useState<string>("");
  const [manualScanFallback, setManualScanFallback] = useState<boolean>(false);
  const [scanStatusMap, setScanStatusMap] = useState<Record<string, { valid: boolean; message: string }>>({});

  // Stock Placement Confirmation state
  const [destinationBinInput, setDestinationBinInput] = useState<string>("");
  const [placedQtyInput, setPlacedQtyInput] = useState<string>("");
  const [actualWeightInput, setActualWeightInput] = useState<string>("");
  const [packagesCountInput, setPackagesCountInput] = useState<string>("1");
  const [putawayTempC, setPutawayTempC] = useState<string>("1.5");
  const [placementNotes, setPlacementNotes] = useState<string>("");

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (warehouseFilter !== "ALL") qs.set("warehouse", warehouseFilter);
      const res = await fetch(`/api/v1/putaway/dashboard?${qs.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Failed to load Put-away dashboard");
      }
      setMetrics(data.metrics);
      setTasks(data.tasks || []);
      setZones(data.zones || []);
      setBins(data.bins || []);
      setEligibleLots(data.eligible_lots || []);
      setHistoryData(data.history || { placements: [], stock_movements: [] });

      if (!selectedTaskId && data.tasks && data.tasks.length > 0) {
        setSelectedTaskId(data.tasks[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error loading put-away data");
    } finally {
      setLoading(false);
    }
  }, [warehouseFilter, selectedTaskId]);

  const loadTaskDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/v1/putaway/tasks/${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Failed to load task detail");
      }
      const detail = data as PutawayTaskDetail;
      setTaskDetail(detail);
      const targetBin = detail.assigned_bin_code || detail.recommended_bin_code || "";
      setOverrideBinCode(targetBin);
      setDestinationBinInput(targetBin);
      setPlacedQtyInput(String(detail.remaining_qty));
      setScanTaskInput(detail.task_number);
      setScanSkuInput(detail.sku);
      setScanLotInput(detail.internal_lot);
      setScanBinInput(targetBin ? `BIN:${targetBin}` : "");
      setPutawayTempC(detail.temp_reading_c !== null ? String(detail.temp_reading_c) : "1.5");

      const defaultWeight =
        detail.expected_weight_kg && detail.total_eligible_qty > 0
          ? Number(((detail.expected_weight_kg / detail.total_eligible_qty) * detail.remaining_qty).toFixed(2))
          : Number((detail.remaining_qty * 5).toFixed(2));
      setActualWeightInput(String(defaultWeight));
      setPackagesCountInput(String(Math.max(1, Math.round(detail.remaining_qty))));
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to load put-away task detail"
      });
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (selectedTaskId) {
      void loadTaskDetail(selectedTaskId);
    }
  }, [selectedTaskId, loadTaskDetail]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (statusFilter !== "ALL" && t.status !== statusFilter) return false;
      if (warehouseFilter !== "ALL" && t.warehouse !== warehouseFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const match =
          t.task_number.toLowerCase().includes(q) ||
          t.sku.toLowerCase().includes(q) ||
          t.product_name.toLowerCase().includes(q) ||
          t.internal_lot.toLowerCase().includes(q) ||
          t.supplier_batch.toLowerCase().includes(q) ||
          (t.recommended_bin_code || "").toLowerCase().includes(q) ||
          (t.assigned_bin_code || "").toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [tasks, statusFilter, warehouseFilter, searchQuery]);

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = await fetch("/api/v1/putaway/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `putaway-create-${newTaskLot}-${Date.now()}`
        },
        body: JSON.stringify({
          internal_lot: newTaskLot.trim(),
          eligible_qty: newTaskQty ? Number(newTaskQty) : undefined,
          priority: newTaskPriority,
          assigned_operator_name: newTaskOperator
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Failed to generate put-away task");
      }
      setFeedback({
        type: "success",
        message: `Generated put-away task ${data.task.task_number} with recommended bin ${data.task.recommended_bin_code || "pending"}.`
      });
      setShowCreateForm(false);
      setNewTaskLot("");
      setNewTaskQty("");
      await loadDashboard();
      if (data.task?.id) {
        setSelectedTaskId(data.task.id);
      }
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to create task"
      });
    }
  }

  async function handleAssignOrStatusUpdate(status?: PutawayTask["status"], reason?: string) {
    if (!selectedTaskId) return;
    setFeedback(null);
    try {
      const res = await fetch(`/api/v1/putaway/tasks/${encodeURIComponent(selectedTaskId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assigned_operator_name: operatorNameInput,
          priority: priorityInput,
          status,
          notes: reason,
          reason
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Failed to update put-away task");
      }
      setTaskDetail(data);
      setFeedback({
        type: "success",
        message: `Updated task ${data.task_number} (${data.status}).`
      });
      await loadDashboard();
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to update task"
      });
    }
  }

  async function handleOverrideRecommendation(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTaskId) return;
    setFeedback(null);
    try {
      const res = await fetch(`/api/v1/putaway/tasks/${encodeURIComponent(selectedTaskId)}/override`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `putaway-override-${selectedTaskId}-${Date.now()}`
        },
        body: JSON.stringify({
          target_bin_code: overrideBinCode.trim(),
          override_reason: overrideReason.trim()
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Override failed");
      }
      setTaskDetail(data);
      setOverrideReason("");
      setFeedback({
        type: "success",
        message: `Storage recommendation overridden to bin ${data.assigned_bin_code} and recorded in audit trail.`
      });
      await loadDashboard();
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to override recommendation"
      });
    }
  }

  async function handleVerifyScan(scanStep: "task" | "sku" | "lot" | "bin", value: string) {
    if (!selectedTaskId) return;
    try {
      const res = await fetch(`/api/v1/putaway/tasks/${encodeURIComponent(selectedTaskId)}/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scan_step: scanStep,
          scanned_value: value,
          scan_mode: manualScanFallback ? "manual" : "scanner"
        })
      });
      const data = await res.json();
      setScanStatusMap((prev) => ({
        ...prev,
        [scanStep]: {
          valid: Boolean(res.ok && data.valid),
          message: res.ok
            ? data.message || `Verified (${data.expected_value})`
            : data?.error?.message || data.failure_reason || "Scan mismatch"
        }
      }));
      await loadTaskDetail(selectedTaskId);
    } catch (err) {
      setScanStatusMap((prev) => ({
        ...prev,
        [scanStep]: {
          valid: false,
          message: err instanceof Error ? err.message : "Scan failed"
        }
      }));
    }
  }

  async function handleConfirmPlacement(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTaskId || !taskDetail) return;
    setFeedback(null);

    try {
      const res = await fetch(`/api/v1/putaway/tasks/${encodeURIComponent(selectedTaskId)}/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `putaway-confirm-${selectedTaskId}-${Date.now()}`
        },
        body: JSON.stringify({
          to_bin_code: destinationBinInput.trim(),
          placed_qty: Number(placedQtyInput),
          actual_weight_kg: actualWeightInput ? Number(actualWeightInput) : undefined,
          packages: packagesCountInput ? Number(packagesCountInput) : 1,
          temp_c: putawayTempC !== "" ? Number(putawayTempC) : undefined,
          scan_method: manualScanFallback ? "manual_fallback" : "barcode_scan",
          discrepancy_notes: placementNotes.trim() || undefined
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Stock placement confirmation failed");
      }

      setTaskDetail(data.task);
      setFeedback({
        type: "success",
        message: `Confirmed stock placement into ${data.placement.to_bin_code}! Task ${data.task.task_number} is now '${data.task.status}' (Remaining: ${data.task.remaining_qty} ${data.task.uom}).`
      });
      await loadDashboard();
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to confirm stock placement"
      });
      if (selectedTaskId) {
        await loadTaskDetail(selectedTaskId);
        await loadDashboard();
      }
    }
  }

  async function handleToggleBinStatus(bin: WarehouseBinRecord, nextStatus: WarehouseBinRecord["status"]) {
    setFeedback(null);
    try {
      const res = await fetch("/api/v1/putaway/bins", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bin_id_or_code: bin.code,
          status: nextStatus,
          notes: `Updated status to ${nextStatus} via Put-away Bin Explorer`
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Failed to update bin status");
      }
      setFeedback({
        type: "success",
        message: `Bin ${bin.code} status updated to '${nextStatus}'.`
      });
      await loadDashboard();
      if (selectedTaskId) {
        await loadTaskDetail(selectedTaskId);
      }
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to update bin status"
      });
    }
  }

  function renderStatusBadge(status: PutawayTask["status"]) {
    switch (status) {
      case "Completed":
        return <Badge tone="ok">Completed</Badge>;
      case "Partially Completed":
        return <Badge tone="info">Partially Completed</Badge>;
      case "In Progress":
      case "Assigned":
        return <Badge tone="info">{status}</Badge>;
      case "Ready for Put-away":
        return <Badge tone="neutral">Ready for Put-away</Badge>;
      case "Blocked":
        return <Badge tone="critical">Blocked</Badge>;
      case "Pending Recommendation":
        return <Badge tone="warning">Pending Recommendation</Badge>;
      default:
        return <Badge tone="neutral">{status}</Badge>;
    }
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner & Action Bar */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-400">
            <Warehouse className="h-4 w-4" />
            <span>Module 05 · Put-away, Storage Recommendation & Bin Assignment</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-marine-navy dark:text-white">
            Put-away & Cold-Chain Bin Placement Control Tower
          </h1>
          <p className="text-sm text-marine-navy/65 dark:text-slate-400">
            Move QA-released batches from receiving staging into temperature-verified, allergen-segregated warehouse bins with full FEFO & catch-weight traceability.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={warehouseFilter}
            onChange={(e) => setWarehouseFilter(e.target.value)}
            className="rounded-lg border border-marine-ocean/70 bg-white px-3 py-2 text-xs font-medium text-marine-mid/90 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="ALL">All Warehouses</option>
            <option value="Milan Cold Hub">Milan Cold Hub</option>
            <option value="Rome Cold Hub">Rome Cold Hub</option>
          </select>

          <button
            type="button"
            onClick={() => setShowCreateForm((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-sky-500"
          >
            <Plus className="h-4 w-4" />
            Generate Put-away Task
          </button>

          <button
            type="button"
            onClick={() => void loadDashboard()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-marine-ocean/70 bg-white px-3 py-2 text-xs font-medium text-marine-mid/80 hover:bg-marine-ocean/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${
            feedback.type === "success"
              ? "border-marine-ocean/60 bg-marine-steel/10 text-marine-mid dark:text-marine-mid"
              : "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs font-semibold underline opacity-80 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-600 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Generate Put-away Task Drawer */}
      {showCreateForm && (
        <Card className="border border-sky-500/30 bg-sky-500/5 p-5">
          <div className="flex items-center justify-between border-b border-marine-ocean/60/60 pb-3 dark:border-slate-800">
            <div>
              <h3 className="text-sm font-semibold text-marine-navy dark:text-white">
                Generate Put-away Task from QA-Released Batch
              </h3>
              <p className="text-xs text-marine-mid/55 dark:text-slate-400">
                Only lots with Quality Gate status &lsquo;released&rsquo; or &lsquo;partially_released&rsquo; and accepted quantity &gt; 0 can be assigned to normal storage.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="text-xs text-marine-mid/55 hover:text-marine-mid/90 dark:hover:text-white"
            >
              Close
            </button>
          </div>

          <form onSubmit={handleCreateTask} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-5">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-marine-mid/80 dark:text-slate-300">
                Internal Lot / Batch ID *
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  required
                  placeholder="e.g. LOT-2026-SAL-001"
                  value={newTaskLot}
                  onChange={(e) => setNewTaskLot(e.target.value)}
                  className="w-full rounded-lg border border-marine-ocean/70 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                />
                {eligibleLots.length > 0 && (
                  <select
                    onChange={(e) => {
                      if (e.target.value) setNewTaskLot(e.target.value);
                    }}
                    value=""
                    className="rounded-lg border border-marine-ocean/70 bg-marine-ocean/15 px-2 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value="">Pick released lot...</option>
                    {eligibleLots.map((l) => (
                      <option key={l.batch_id} value={l.batch_id}>
                        {l.batch_id} ({l.sku} · {l.quantity_cases} cs)
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-marine-mid/80 dark:text-slate-300">
                Eligible Qty (optional)
              </label>
              <input
                type="number"
                step="0.01"
                placeholder="Defaults to QA accepted qty"
                value={newTaskQty}
                onChange={(e) => setNewTaskQty(e.target.value)}
                className="mt-1 w-full rounded-lg border border-marine-ocean/70 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-marine-mid/80 dark:text-slate-300">Task Priority</label>
              <select
                value={newTaskPriority}
                onChange={(e) => setNewTaskPriority(e.target.value as "low" | "normal" | "high" | "urgent")}
                className="mt-1 w-full rounded-lg border border-marine-ocean/70 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent (Cold Chain Priority)</option>
              </select>
            </div>

            <div className="flex items-end">
              <Can anyOf={["putaway.manage", "putaway.execute", "quality.decide"]} mode="disable">
                <button
                  type="submit"
                  className="w-full rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500"
                >
                  Compute Recommendation & Create
                </button>
              </Can>
            </div>
          </form>
        </Card>
      )}

      {/* 7 KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Card className="p-3.5">
          <div className="text-[11px] font-medium text-marine-mid/55 dark:text-slate-400">Pending Put-away</div>
          <div className="mt-1 text-2xl font-bold text-marine-navy dark:text-white">
            {metrics?.pending_putaway_tasks ?? 0}
          </div>
          <div className="mt-0.5 text-[11px] text-sky-500">Ready at receiving dock</div>
        </Card>

        <Card className="p-3.5">
          <div className="text-[11px] font-medium text-marine-mid/55 dark:text-slate-400">In Progress</div>
          <div className="mt-1 text-2xl font-bold text-indigo-600 dark:text-indigo-400">
            {metrics?.tasks_in_progress ?? 0}
          </div>
          <div className="mt-0.5 text-[11px] text-marine-mid/55">Active operator tasks</div>
        </Card>

        <Card className="p-3.5">
          <div className="text-[11px] font-medium text-marine-mid/55 dark:text-slate-400">Partially Completed</div>
          <div className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400">
            {metrics?.partially_completed_tasks ?? 0}
          </div>
          <div className="mt-0.5 text-[11px] text-marine-mid/55">Split / partial bin drops</div>
        </Card>

        <Card className="p-3.5">
          <div className="text-[11px] font-medium text-marine-mid/55 dark:text-slate-400">Completed Tasks</div>
          <div className="mt-1 text-2xl font-bold text-marine-mid dark:text-marine-mid">
            {metrics?.completed_tasks ?? 0}
          </div>
          <div className="mt-0.5 text-[11px] text-marine-mid/55">100% stock placed</div>
        </Card>

        <Card className="p-3.5">
          <div className="text-[11px] font-medium text-marine-mid/55 dark:text-slate-400">Blocked Tasks</div>
          <div className="mt-1 text-2xl font-bold text-rose-600 dark:text-rose-400">
            {metrics?.blocked_tasks ?? 0}
          </div>
          <div className="mt-0.5 text-[11px] text-marine-mid/55">Excursion / QA hold</div>
        </Card>

        <Card className="p-3.5">
          <div className="text-[11px] font-medium text-marine-mid/55 dark:text-slate-400">Awaiting Placement</div>
          <div className="mt-1 text-2xl font-bold text-marine-navy dark:text-white">
            {metrics?.total_quantities_awaiting_placement ?? 0}
          </div>
          <div className="mt-0.5 text-[11px] text-marine-mid/55">Remaining cases to bin</div>
        </Card>

        <Card className="p-3.5">
          <div className="text-[11px] font-medium text-marine-mid/55 dark:text-slate-400">Bin Utilization</div>
          <div className="mt-1 text-2xl font-bold text-sky-600 dark:text-sky-400">
            {metrics?.warehouse_bin_utilization_pct ?? 0}%
          </div>
          <div className="mt-0.5 text-[11px] text-marine-mid/55">
            {metrics?.active_bins_count ?? 0}/{metrics?.total_bins_count ?? 0} active bins
          </div>
        </Card>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-marine-ocean/60 pb-2 dark:border-slate-800">
        {[
          { id: "tasks", label: "1. Put-away Tasks & Detail", icon: ClipboardCheck },
          { id: "recommendations", label: "2. Storage Recommendation & Override", icon: Sparkles },
          { id: "scanner", label: "3. Barcode Scanner & Stock Placement", icon: QrCode },
          { id: "bins", label: "4. Warehouse / Zone / Bin Explorer", icon: Boxes },
          { id: "history", label: "5. Put-away & Movement History", icon: History }
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as ActiveTab)}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                active
                  ? "bg-sky-600 text-white shadow-sm"
                  : "bg-marine-ocean/25 text-marine-mid/80 hover:bg-marine-ocean/35 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: PUT-AWAY TASKS & TASK DETAIL */}
      {activeTab === "tasks" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Tasks Queue Table */}
          <Card className="p-4 lg:col-span-7">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-bold text-marine-navy dark:text-white">
                Put-away Tasks Queue ({filteredTasks.length})
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search task, SKU, lot, bin..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="rounded-lg border border-marine-ocean/70 bg-white pl-8 pr-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-lg border border-marine-ocean/70 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="Ready for Put-away">Ready for Put-away</option>
                  <option value="Assigned">Assigned</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Partially Completed">Partially Completed</option>
                  <option value="Completed">Completed</option>
                  <option value="Blocked">Blocked</option>
                </select>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-marine-ocean/60 text-[11px] uppercase text-marine-mid/55 dark:border-slate-800">
                    <th className="pb-2 pr-3">Task Ref</th>
                    <th className="pb-2 pr-3">Product / Lot</th>
                    <th className="pb-2 pr-3">Staging → Target Bin</th>
                    <th className="pb-2 pr-3">Remaining / Total</th>
                    <th className="pb-2 pr-3">Priority</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800">
                  {filteredTasks.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-marine-mid/55">
                        No put-away tasks match the current filter. Release a batch in Quality Gate or click &ldquo;Generate Put-away Task&rdquo;.
                      </td>
                    </tr>
                  ) : (
                    filteredTasks.map((t) => {
                      const isSelected = t.id === selectedTaskId;
                      const targetBin = t.assigned_bin_code || t.recommended_bin_code || "Unassigned";
                      return (
                        <tr
                          key={t.id}
                          onClick={() => setSelectedTaskId(t.id)}
                          className={`cursor-pointer transition ${
                            isSelected
                              ? "bg-sky-500/10 dark:bg-sky-500/15"
                              : "hover:bg-marine-ocean/15 dark:hover:bg-slate-900/50"
                          }`}
                        >
                          <td className="py-3 pr-3 font-mono font-semibold text-sky-600 dark:text-sky-400">
                            {t.task_number}
                            <div className="text-[10px] font-normal text-marine-mid/55">{t.warehouse}</div>
                          </td>
                          <td className="py-3 pr-3">
                            <div className="font-semibold text-marine-navy dark:text-white">{t.product_name}</div>
                            <div className="font-mono text-[11px] text-marine-mid/55">
                              {t.sku} · Lot: {t.internal_lot}
                            </div>
                          </td>
                          <td className="py-3 pr-3">
                            <div className="flex items-center gap-1 font-mono text-[11px]">
                              <span className="rounded bg-marine-ocean/25 px-1.5 py-0.5 dark:bg-slate-800">
                                {t.receiving_location}
                              </span>
                              <ArrowRight className="h-3 w-3 text-slate-400" />
                              <span className="rounded bg-marine-steel/15 px-1.5 py-0.5 font-semibold text-marine-mid dark:text-marine-mid">
                                {targetBin}
                              </span>
                            </div>
                            {t.overridden_by && (
                              <div className="mt-0.5 text-[10px] text-amber-500">
                                Manager override ({t.overridden_by})
                              </div>
                            )}
                          </td>
                          <td className="py-3 pr-3">
                            <span className="font-semibold text-marine-navy dark:text-white">{t.remaining_qty}</span> /{" "}
                            {t.total_eligible_qty} {t.uom}
                            {t.expected_weight_kg > 0 && (
                              <div className="text-[10px] text-marine-mid/55">
                                Placed: {t.placed_weight_kg} / {t.expected_weight_kg} kg
                              </div>
                            )}
                          </td>
                          <td className="py-3 pr-3">
                            <Badge
                              tone={
                                t.priority === "urgent"
                                  ? "critical"
                                  : t.priority === "high"
                                    ? "warning"
                                    : "neutral"
                              }
                            >
                              {t.priority.toUpperCase()}
                            </Badge>
                          </td>
                          <td className="py-3">{renderStatusBadge(t.status)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Selected Task Detail Panel */}
          <Card className="p-5 lg:col-span-5">
            {detailLoading ? (
              <div className="py-12 text-center text-xs text-marine-mid/55">Loading put-away task detail...</div>
            ) : !taskDetail ? (
              <div className="py-12 text-center text-xs text-marine-mid/55">
                Select a put-away task from the table to inspect full batch traceability, recommendations, and actions.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between border-b border-marine-ocean/60 pb-3 dark:border-slate-800">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-base font-bold text-sky-600 dark:text-sky-400">
                        {taskDetail.task_number}
                      </span>
                      {renderStatusBadge(taskDetail.status)}
                    </div>
                    <p className="mt-0.5 text-xs font-medium text-marine-mid/80 dark:text-slate-300">
                      {taskDetail.product_name} ({taskDetail.sku})
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setActiveTab("scanner")}
                      className="rounded-lg bg-marine-steel px-3 py-1.5 text-xs font-semibold text-white hover:bg-marine-steel"
                    >
                      Scan & Place Stock
                    </button>
                  </div>
                </div>

                {/* Traceability Metadata Grid */}
                <div className="grid grid-cols-2 gap-2.5 rounded-xl bg-marine-ocean/15 p-3 text-xs dark:bg-slate-900/70">
                  <div>
                    <span className="text-marine-mid/55">Shipment / ASN:</span>
                    <div className="font-mono font-medium text-marine-navy dark:text-white">
                      {taskDetail.shipment_reference || "Direct"} / {taskDetail.asn_reference || "N/A"}
                    </div>
                  </div>
                  <div>
                    <span className="text-marine-mid/55">Supplier & PO:</span>
                    <div className="font-medium text-marine-navy dark:text-white">
                      {taskDetail.supplier_name || "N/A"} ({taskDetail.purchase_order_id || "N/A"})
                    </div>
                  </div>
                  <div>
                    <span className="text-marine-mid/55">Internal Lot / Supplier Batch:</span>
                    <div className="font-mono font-semibold text-marine-navy dark:text-white">
                      {taskDetail.internal_lot} / {taskDetail.supplier_batch}
                    </div>
                  </div>
                  <div>
                    <span className="text-marine-mid/55">Expiry Date (FEFO):</span>
                    <div className="font-mono font-semibold text-marine-navy dark:text-white">
                      {taskDetail.expiry_date}
                    </div>
                  </div>
                  <div>
                    <span className="text-marine-mid/55">Accepted / Placed / Remaining:</span>
                    <div className="font-semibold text-marine-navy dark:text-white">
                      {taskDetail.total_eligible_qty} / {taskDetail.placed_qty} /{" "}
                      <span className="text-sky-500">{taskDetail.remaining_qty}</span> {taskDetail.uom}
                    </div>
                  </div>
                  <div>
                    <span className="text-marine-mid/55">Temperature Status:</span>
                    <div className="flex items-center gap-1 font-semibold">
                      <Thermometer className="h-3.5 w-3.5 text-sky-400" />
                      <span>
                        {taskDetail.temp_reading_c !== null ? `${taskDetail.temp_reading_c} °C` : "N/A"} (
                        {taskDetail.temp_status.toUpperCase()})
                      </span>
                    </div>
                  </div>
                </div>

                {/* Recommended Storage Location Box */}
                <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                      Recommended Destination Bin
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab("recommendations")}
                      className="text-[11px] font-semibold text-sky-500 underline"
                    >
                      Inspect / Override
                    </button>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-sky-500" />
                    <span className="font-mono text-sm font-bold text-marine-navy dark:text-white">
                      {taskDetail.warehouse} → {taskDetail.recommended_zone_code || "N/A"} →{" "}
                      {taskDetail.assigned_bin_code || taskDetail.recommended_bin_code || "None"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-marine-navy/65 dark:text-slate-300">
                    {taskDetail.recommendation_reason}
                  </p>
                  {taskDetail.overridden_by && (
                    <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
                      <strong>Manager Override Active:</strong> Bin {taskDetail.assigned_bin_code} selected by{" "}
                      {taskDetail.overridden_by}. Reason: &ldquo;{taskDetail.override_reason}&rdquo;
                    </div>
                  )}
                  {taskDetail.status === "Blocked" && taskDetail.notes && (
                    <div className="mt-2 rounded border border-rose-500/40 bg-rose-500/10 p-2 text-[11px] text-rose-700 dark:text-rose-300">
                      <strong>Blocked Notes:</strong> {taskDetail.notes}
                    </div>
                  )}
                </div>

                {/* Operator Assignment & Workflow Status Controls */}
                <div className="space-y-2 border-t border-marine-ocean/60 pt-3 dark:border-slate-800">
                  <div className="text-xs font-semibold text-marine-mid/90 dark:text-slate-200">
                    Operator Assignment & Workflow Controls
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={operatorNameInput}
                      onChange={(e) => setOperatorNameInput(e.target.value)}
                      placeholder="Assigned operator name"
                      className="rounded-lg border border-marine-ocean/70 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                    />
                    <select
                      value={priorityInput}
                      onChange={(e) => setPriorityInput(e.target.value as "low" | "normal" | "high" | "urgent")}
                      className="rounded-lg border border-marine-ocean/70 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                    >
                      <option value="low">Low Priority</option>
                      <option value="normal">Normal Priority</option>
                      <option value="high">High Priority</option>
                      <option value="urgent">Urgent Priority</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Can anyOf={["putaway.execute", "putaway.manage"]} mode="disable">
                      <button
                        type="button"
                        onClick={() => void handleAssignOrStatusUpdate("Assigned")}
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 dark:bg-slate-700"
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        Assign Operator
                      </button>
                    </Can>
                    <Can anyOf={["putaway.execute", "putaway.manage"]} mode="disable">
                      <button
                        type="button"
                        onClick={() => void handleAssignOrStatusUpdate("In Progress")}
                        className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
                      >
                        Start Put-away
                      </button>
                    </Can>
                    <Can anyOf={["putaway.execute", "putaway.manage"]} mode="disable">
                      <button
                        type="button"
                        onClick={() =>
                          void handleAssignOrStatusUpdate("Blocked", "Temporarily blocked by operator for aisle clearance")
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-300"
                      >
                        Block Task
                      </button>
                    </Can>
                  </div>
                </div>

                {/* Previous Placements for this Task */}
                {taskDetail.placements.length > 0 && (
                  <div className="border-t border-marine-ocean/60 pt-3 dark:border-slate-800">
                    <div className="text-xs font-semibold text-marine-mid/90 dark:text-slate-200">
                      Recorded Bin Placements ({taskDetail.placements.length})
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {taskDetail.placements.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between rounded-lg bg-marine-ocean/25 px-3 py-2 text-[11px] dark:bg-slate-900"
                        >
                          <div>
                            <span className="font-mono font-bold text-marine-mid dark:text-marine-mid">
                              {p.to_bin_code}
                            </span>{" "}
                            · {p.placed_qty} {p.uom} ({p.actual_weight_kg} kg)
                          </div>
                          <div className="text-marine-mid/55">
                            {p.temp_c !== null ? `${p.temp_c}°C` : ""} · {p.operator_name}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* TAB 2: INTELLIGENT STORAGE RECOMMENDATION & OVERRIDE */}
      {activeTab === "recommendations" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <Card className="p-5 lg:col-span-8">
            <div className="flex items-center justify-between border-b border-marine-ocean/60 pb-3 dark:border-slate-800">
              <div>
                <h2 className="text-sm font-bold text-marine-navy dark:text-white">
                  Intelligent Storage Recommendation Engine
                </h2>
                <p className="text-xs text-marine-mid/55">
                  Evaluates product temperature profile, zone/bin capacity, current occupancy, allergen & category segregation, and FEFO consolidation.
                </p>
              </div>
              {taskDetail && (
                <Badge tone="info">
                  Task {taskDetail.task_number} · {taskDetail.sku} ({taskDetail.remaining_qty} cs)
                </Badge>
              )}
            </div>

            {!taskDetail ? (
              <div className="py-10 text-center text-xs text-marine-mid/55">
                Select a task in Tab 1 to inspect its ranked candidate bins and disqualification rules.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {taskDetail.recommendations.map((cand: BinRecommendationCandidate, index: number) => (
                  <div
                    key={cand.bin.code}
                    className={`rounded-xl border p-3.5 text-xs transition ${
                      cand.eligible
                        ? index === 0
                          ? "border-marine-ocean/70 bg-marine-steel/10"
                          : "border-marine-ocean/60 bg-white dark:border-slate-800 dark:bg-slate-900/60"
                        : "border-rose-500/20 bg-rose-500/5 opacity-75"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-marine-navy dark:text-white">
                          {cand.bin.code}
                        </span>
                        <span className="text-marine-mid/55">
                          ({cand.bin.zone_code} · {cand.bin.zone_name})
                        </span>
                        <Badge tone={cand.eligible ? (index === 0 ? "ok" : "info") : "critical"}>
                          {cand.eligible
                            ? index === 0
                              ? `Best Match · Score ${cand.score}`
                              : `Eligible · Score ${cand.score}`
                            : "Disqualified"}
                        </Badge>
                      </div>
                      <div className="font-mono text-[11px] text-marine-mid/55">
                        Temp: {cand.bin.min_temp_c}°C to {cand.bin.max_temp_c}°C · Free: {cand.bin.available_cases} cs /{" "}
                        {cand.bin.available_weight_kg} kg ({cand.bin.utilization_pct}% full)
                      </div>
                    </div>

                    {cand.eligible ? (
                      <div className="mt-2 text-[11px] text-marine-mid dark:text-marine-mid">
                        {cand.reason}
                      </div>
                    ) : (
                      <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-rose-600 dark:text-rose-300">
                        {cand.disqualify_reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Manager Override Panel */}
          <Card className="p-5 lg:col-span-4">
            <div className="flex items-center gap-2 border-b border-marine-ocean/60 pb-3 dark:border-slate-800">
              <Lock className="h-4 w-4 text-amber-500" />
              <h3 className="text-sm font-bold text-marine-navy dark:text-white">
                Warehouse Manager Override
              </h3>
            </div>
            <p className="mt-2 text-xs text-marine-mid/55 dark:text-slate-400">
              Authorized warehouse managers (`putaway.override`) may override the recommended bin for operational reasons. Temperature-incompatible, full, blocked, or quarantine bins remain strictly rejected.
            </p>

            <form onSubmit={handleOverrideRecommendation} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-medium text-marine-mid/80 dark:text-slate-300">
                  Target Override Bin Code *
                </label>
                <select
                  required
                  value={overrideBinCode}
                  onChange={(e) => setOverrideBinCode(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-marine-ocean/70 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                >
                  <option value="">Select eligible active bin...</option>
                  {bins
                    .filter((b) => b.status === "active" && b.storage_type !== "quarantine")
                    .map((b) => (
                      <option key={b.code} value={b.code}>
                        {b.code} ({b.zone_code} · {b.min_temp_c}°C..{b.max_temp_c}°C · Free: {b.available_cases} cs)
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-marine-mid/80 dark:text-slate-300">
                  Mandatory Override Justification *
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="Explain why the primary recommended bin is being overridden (recorded in Audit Log)..."
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-marine-ocean/70 bg-white p-2.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                />
              </div>

              <Can permission="putaway.override" mode="disable">
                <button
                  type="submit"
                  disabled={!selectedTaskId}
                  className="w-full rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
                >
                  Authorize & Log Bin Override
                </button>
              </Can>
            </form>
          </Card>
        </div>
      )}

      {/* TAB 3: BARCODE / QR SCANNER & STOCK PLACEMENT CONFIRMATION */}
      {activeTab === "scanner" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* 4-Step Barcode Scanner */}
          <Card className="p-5 lg:col-span-5">
            <div className="flex items-center justify-between border-b border-marine-ocean/60 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <QrCode className="h-4 w-4 text-sky-500" />
                <h2 className="text-sm font-bold text-marine-navy dark:text-white">
                  Barcode / QR Verification
                </h2>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-marine-navy/65 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={manualScanFallback}
                  onChange={(e) => setManualScanFallback(e.target.checked)}
                />
                Manual Entry Fallback
              </label>
            </div>

            {!taskDetail ? (
              <div className="py-8 text-center text-xs text-marine-mid/55">Select a task first.</div>
            ) : (
              <div className="mt-4 space-y-3.5 text-xs">
                {/* 1. Task Barcode */}
                <div className="rounded-lg border border-marine-ocean/60 p-3 dark:border-slate-800">
                  <div className="flex justify-between font-medium">
                    <span>1. Put-away Task Barcode</span>
                    <span className="font-mono text-slate-400">Expected: {taskDetail.task_number}</span>
                  </div>
                  <div className="mt-1.5 flex gap-2">
                    <input
                      type="text"
                      value={scanTaskInput}
                      onChange={(e) => setScanTaskInput(e.target.value)}
                      placeholder="Scan TASK:PUT-2026-..."
                      className="w-full rounded-lg border border-marine-ocean/70 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
                    />
                    <Can permission="putaway.execute" mode="disable">
                      <button
                        type="button"
                        onClick={() => void handleVerifyScan("task", scanTaskInput)}
                        className="rounded-lg bg-slate-800 px-3 py-1.5 font-semibold text-white hover:bg-slate-700"
                      >
                        Verify
                      </button>
                    </Can>
                  </div>
                  {scanStatusMap.task && (
                    <div
                      className={`mt-1 text-[11px] font-medium ${
                        scanStatusMap.task.valid ? "text-marine-mid" : "text-rose-500"
                      }`}
                    >
                      {scanStatusMap.task.message}
                    </div>
                  )}
                </div>

                {/* 2. SKU Barcode */}
                <div className="rounded-lg border border-marine-ocean/60 p-3 dark:border-slate-800">
                  <div className="flex justify-between font-medium">
                    <span>2. Product / SKU Barcode</span>
                    <span className="font-mono text-slate-400">Expected: {taskDetail.sku}</span>
                  </div>
                  <div className="mt-1.5 flex gap-2">
                    <input
                      type="text"
                      value={scanSkuInput}
                      onChange={(e) => setScanSkuInput(e.target.value)}
                      placeholder="Scan SKU..."
                      className="w-full rounded-lg border border-marine-ocean/70 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
                    />
                    <Can permission="putaway.execute" mode="disable">
                      <button
                        type="button"
                        onClick={() => void handleVerifyScan("sku", scanSkuInput)}
                        className="rounded-lg bg-slate-800 px-3 py-1.5 font-semibold text-white hover:bg-slate-700"
                      >
                        Verify
                      </button>
                    </Can>
                  </div>
                  {scanStatusMap.sku && (
                    <div
                      className={`mt-1 text-[11px] font-medium ${
                        scanStatusMap.sku.valid ? "text-marine-mid" : "text-rose-500"
                      }`}
                    >
                      {scanStatusMap.sku.message}
                    </div>
                  )}
                </div>

                {/* 3. Batch / Internal Lot Barcode */}
                <div className="rounded-lg border border-marine-ocean/60 p-3 dark:border-slate-800">
                  <div className="flex justify-between font-medium">
                    <span>3. Internal Lot / Supplier Batch</span>
                    <span className="font-mono text-slate-400">Expected: {taskDetail.internal_lot}</span>
                  </div>
                  <div className="mt-1.5 flex gap-2">
                    <input
                      type="text"
                      value={scanLotInput}
                      onChange={(e) => setScanLotInput(e.target.value)}
                      placeholder="Scan LOT-2026-..."
                      className="w-full rounded-lg border border-marine-ocean/70 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
                    />
                    <Can permission="putaway.execute" mode="disable">
                      <button
                        type="button"
                        onClick={() => void handleVerifyScan("lot", scanLotInput)}
                        className="rounded-lg bg-slate-800 px-3 py-1.5 font-semibold text-white hover:bg-slate-700"
                      >
                        Verify
                      </button>
                    </Can>
                  </div>
                  {scanStatusMap.lot && (
                    <div
                      className={`mt-1 text-[11px] font-medium ${
                        scanStatusMap.lot.valid ? "text-marine-mid" : "text-rose-500"
                      }`}
                    >
                      {scanStatusMap.lot.message}
                    </div>
                  )}
                </div>

                {/* 4. Destination Bin Barcode */}
                <div className="rounded-lg border border-marine-ocean/60 p-3 dark:border-slate-800">
                  <div className="flex justify-between font-medium">
                    <span>4. Destination Bin Barcode</span>
                    <span className="font-mono text-slate-400">
                      Target: BIN:{taskDetail.assigned_bin_code || taskDetail.recommended_bin_code}
                    </span>
                  </div>
                  <div className="mt-1.5 flex gap-2">
                    <input
                      type="text"
                      value={scanBinInput}
                      onChange={(e) => setScanBinInput(e.target.value)}
                      placeholder="Scan BIN:CHILL-A1-01..."
                      className="w-full rounded-lg border border-marine-ocean/70 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
                    />
                    <Can permission="putaway.execute" mode="disable">
                      <button
                        type="button"
                        onClick={() => void handleVerifyScan("bin", scanBinInput)}
                        className="rounded-lg bg-slate-800 px-3 py-1.5 font-semibold text-white hover:bg-slate-700"
                      >
                        Verify
                      </button>
                    </Can>
                  </div>
                  {scanStatusMap.bin && (
                    <div
                      className={`mt-1 text-[11px] font-medium ${
                        scanStatusMap.bin.valid ? "text-marine-mid" : "text-rose-500"
                      }`}
                    >
                      {scanStatusMap.bin.message}
                    </div>
                  )}
                </div>

                {/* Recent Scan Audit Log */}
                {taskDetail.scan_logs.length > 0 && (
                  <div className="pt-2">
                    <div className="font-semibold text-marine-mid/80 dark:text-slate-300">
                      Scan Verification Audit Trail ({taskDetail.scan_logs.length})
                    </div>
                    <div className="mt-1.5 max-h-36 space-y-1 overflow-y-auto">
                      {taskDetail.scan_logs.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center justify-between rounded bg-marine-ocean/25 px-2.5 py-1 text-[11px] dark:bg-slate-900"
                        >
                          <span>
                            <strong className="uppercase">{s.scan_step}</strong>: {s.scanned_value}
                          </span>
                          <Badge tone={s.valid === 1 ? "ok" : "critical"}>
                            {s.valid === 1 ? "PASS" : "FAIL"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Stock Placement Confirmation Form */}
          <Card className="p-5 lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-marine-ocean/60 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <PackageCheck className="h-4 w-4 text-marine-mid" />
                <h2 className="text-sm font-bold text-marine-navy dark:text-white">
                  Confirm Stock Placement (Full, Partial, or Multi-Bin Split)
                </h2>
              </div>
            </div>

            {!taskDetail ? (
              <div className="py-8 text-center text-xs text-marine-mid/55">Select a task to confirm placement.</div>
            ) : (
              <form onSubmit={handleConfirmPlacement} className="mt-4 space-y-4 text-xs">
                <div className="grid grid-cols-3 gap-3 rounded-xl bg-marine-ocean/15 p-3 dark:bg-slate-900">
                  <div>
                    <span className="text-marine-mid/55">Task / Lot:</span>
                    <div className="font-mono font-bold text-marine-navy dark:text-white">
                      {taskDetail.task_number} · {taskDetail.internal_lot}
                    </div>
                  </div>
                  <div>
                    <span className="text-marine-mid/55">Remaining Eligible Qty:</span>
                    <div className="text-sm font-bold text-sky-600 dark:text-sky-400">
                      {taskDetail.remaining_qty} {taskDetail.uom}
                    </div>
                  </div>
                  <div>
                    <span className="text-marine-mid/55">Recommended Bin:</span>
                    <div className="font-mono font-bold text-marine-mid dark:text-marine-mid">
                      {taskDetail.assigned_bin_code || taskDetail.recommended_bin_code}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 rounded-xl border border-marine-ocean/60 p-3.5 sm:grid-cols-2 dark:border-slate-800">
                  <div>
                    <label className="block font-medium text-marine-mid/80 dark:text-slate-300">
                      Destination Bin *
                    </label>
                    <select
                      required
                      value={destinationBinInput}
                      onChange={(e) => setDestinationBinInput(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-marine-ocean/70 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
                    >
                      <option value="">Select bin...</option>
                      {bins
                        .filter((b) => b.warehouse.toLowerCase() === taskDetail.warehouse.toLowerCase())
                        .map((b) => (
                          <option key={b.code} value={b.code}>
                            {b.code} ({b.storage_type} · Free: {b.available_cases} cs)
                          </option>
                        ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-medium text-marine-mid/80 dark:text-slate-300">
                      Placed Qty ({taskDetail.uom}) * (Partial or Full)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={placedQtyInput}
                      onChange={(e) => setPlacedQtyInput(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-marine-ocean/70 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-marine-mid/80 dark:text-slate-300">
                      Actual Weight (kg)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={actualWeightInput}
                      onChange={(e) => setActualWeightInput(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-marine-ocean/70 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-marine-mid/80 dark:text-slate-300">Packages Count</label>
                    <input
                      type="number"
                      min={1}
                      value={packagesCountInput}
                      onChange={(e) => setPackagesCountInput(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-marine-ocean/70 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>
                </div>

                {/* Temperature at Put-away & Notes */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block font-medium text-marine-mid/80 dark:text-slate-300">
                      Temperature at Put-away (°C) *
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      required
                      value={putawayTempC}
                      onChange={(e) => setPutawayTempC(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-marine-ocean/70 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                    />
                    <span className="text-[10px] text-marine-mid/55">
                      Allowed range: {taskDetail.temp_min_c}°C to {taskDetail.temp_max_c}°C. Excursion auto-blocks task & creates QA exception.
                    </span>
                  </div>

                  <div>
                    <label className="block font-medium text-marine-mid/80 dark:text-slate-300">
                      Placement / Weight Discrepancy Notes
                    </label>
                    <input
                      type="text"
                      value={placementNotes}
                      onChange={(e) => setPlacementNotes(e.target.value)}
                      placeholder="Pallet label verified, FEFO front-aligned..."
                      className="mt-1 w-full rounded-lg border border-marine-ocean/70 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-marine-ocean/60 pt-3 dark:border-slate-800">
                  <Can permission="putaway.execute" mode="disable">
                    <button
                      type="submit"
                      disabled={taskDetail.status === "Completed"}
                      className="inline-flex items-center gap-2 rounded-lg bg-marine-steel px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-marine-steel disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Confirm Stock Placement & Update Bin Inventory
                    </button>
                  </Can>
                </div>
              </form>
            )}
          </Card>
        </div>
      )}

      {/* TAB 4: WAREHOUSE / ZONE / BIN CAPACITY & OCCUPANCY EXPLORER */}
      {activeTab === "bins" && (
        <div className="space-y-6">
          {/* Zones Overview */}
          <Card className="p-5">
            <h2 className="text-sm font-bold text-marine-navy dark:text-white">
              Configured Warehouse Zones ({zones.length})
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {zones.map((z) => (
                <div
                  key={z.id}
                  className="rounded-xl border border-marine-ocean/60 p-3.5 text-xs dark:border-slate-800"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-sky-600 dark:text-sky-400">{z.code}</span>
                    <Badge tone={z.zone_type === "quarantine" ? "critical" : "info"}>
                      {z.zone_type.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="mt-1 font-semibold text-marine-navy dark:text-white">{z.name}</div>
                  <div className="text-[11px] text-marine-mid/55">{z.warehouse}</div>
                  <div className="mt-2 font-mono text-[11px] text-marine-navy/65 dark:text-slate-300">
                    Temp Range: {z.min_temp_c}°C to {z.max_temp_c}°C
                  </div>
                  <div className="mt-1 text-[11px] text-marine-mid/55">
                    Categories: {z.allowed_categories.join(", ")}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Bins Capacity & Lot Contents Grid */}
          <Card className="p-5">
            <h2 className="text-sm font-bold text-marine-navy dark:text-white">
              Bin-Level Capacity, Occupancy & Batch Traceability ({bins.length} Bins)
            </h2>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {bins.map((b) => (
                <div
                  key={b.id}
                  className={`rounded-xl border p-4 text-xs ${
                    b.status === "active"
                      ? "border-marine-ocean/60 dark:border-slate-800"
                      : "border-rose-500/30 bg-rose-500/5"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-mono text-sm font-bold text-marine-navy dark:text-white">
                        {b.code}
                      </span>
                      <span className="ml-2 font-mono text-[11px] text-slate-400">{b.barcode}</span>
                    </div>
                    <Badge
                      tone={
                        b.status === "active"
                          ? b.available_cases === 0
                            ? "warning"
                            : "ok"
                          : "critical"
                      }
                    >
                      {b.status === "active" && b.available_cases === 0 ? "FULL" : b.status.toUpperCase()}
                    </Badge>
                  </div>

                  <div className="mt-1 text-[11px] text-marine-mid/55">
                    {b.warehouse} · Zone {b.zone_code} · Aisle {b.aisle} / Rack {b.rack} / Shelf {b.shelf}
                  </div>

                  <div className="mt-2 flex items-center justify-between font-mono text-[11px]">
                    <span>
                      Temp: {b.min_temp_c}°C..{b.max_temp_c}°C
                    </span>
                    <span>
                      {b.current_cases}/{b.max_cases} cs ({b.utilization_pct}%)
                    </span>
                  </div>

                  {/* Utilization Bar */}
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-marine-ocean/35 dark:bg-slate-800">
                    <div
                      className={`h-full rounded-full ${
                        b.utilization_pct >= 95
                          ? "bg-rose-500"
                          : b.utilization_pct >= 75
                            ? "bg-amber-500"
                            : "bg-marine-steel"
                      }`}
                      style={{ width: `${Math.min(100, b.utilization_pct)}%` }}
                    />
                  </div>

                  <div className="mt-1.5 flex justify-between text-[11px] text-marine-mid/55">
                    <span>
                      Weight: {b.current_weight_kg}/{b.max_weight_kg} kg
                    </span>
                    <span>Free: {b.available_cases} cs</span>
                  </div>

                  {/* Current Lots Inside Bin */}
                  {b.lots && b.lots.length > 0 && (
                    <div className="mt-3 border-t border-marine-ocean/60/70 pt-2 dark:border-slate-800">
                      <div className="text-[11px] font-semibold text-marine-mid/80 dark:text-slate-300">
                        Stored Batches ({b.lots.length}):
                      </div>
                      <div className="mt-1 space-y-1">
                        {b.lots.map((p) => (
                          <div
                            key={p.id}
                            className="flex items-center justify-between rounded bg-marine-ocean/25 px-2 py-1 font-mono text-[10px] dark:bg-slate-900"
                          >
                            <span>
                              {p.sku} · {p.internal_lot}
                            </span>
                            <span>
                              {p.quantity_cases} cs ({p.weight_kg} kg) · Exp {p.expiry_date}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Manager Status Toggle */}
                  <div className="mt-3 flex items-center justify-end gap-1.5 border-t border-marine-ocean/60/60 pt-2 dark:border-slate-800">
                    {b.status !== "active" ? (
                      <Can permission="putaway.manage" mode="disable">
                        <button
                          type="button"
                          onClick={() => void handleToggleBinStatus(b, "active")}
                          className="rounded bg-marine-steel px-2 py-1 text-[10px] font-semibold text-white hover:bg-marine-steel"
                        >
                          Activate Bin
                        </button>
                      </Can>
                    ) : (
                      <Can permission="putaway.manage" mode="disable">
                        <button
                          type="button"
                          onClick={() => void handleToggleBinStatus(b, "blocked")}
                          className="rounded border border-rose-500/40 px-2 py-1 text-[10px] font-semibold text-rose-500 hover:bg-rose-500/10"
                        >
                          Block Bin
                        </button>
                      </Can>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* TAB 5: PUT-AWAY & STOCK MOVEMENT HISTORY */}
      {activeTab === "history" && (
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="text-sm font-bold text-marine-navy dark:text-white">
              Put-away Placement History ({historyData.placements.length})
            </h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-marine-ocean/60 text-[11px] uppercase text-marine-mid/55 dark:border-slate-800">
                    <th className="pb-2 pr-3">Timestamp</th>
                    <th className="pb-2 pr-3">Task Ref</th>
                    <th className="pb-2 pr-3">SKU / Internal Lot</th>
                    <th className="pb-2 pr-3">Source → Destination Bin</th>
                    <th className="pb-2 pr-3">Placed Qty</th>
                    <th className="pb-2 pr-3">Weight & Variance</th>
                    <th className="pb-2 pr-3">Temp</th>
                    <th className="pb-2">Operator</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800">
                  {historyData.placements.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-marine-mid/55">
                        No put-away placements recorded yet.
                      </td>
                    </tr>
                  ) : (
                    historyData.placements.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2.5 pr-3 font-mono text-[11px] text-marine-mid/55">
                          {p.placed_at.slice(0, 19).replace("T", " ")}
                        </td>
                        <td className="py-2.5 pr-3 font-mono font-semibold text-sky-600 dark:text-sky-400">
                          {p.task_number}
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="font-medium text-marine-navy dark:text-white">{p.sku}</div>
                          <div className="font-mono text-[11px] text-marine-mid/55">{p.internal_lot}</div>
                        </td>
                        <td className="py-2.5 pr-3 font-mono text-[11px]">
                          {p.from_location} →{" "}
                          <span className="font-bold text-marine-mid dark:text-marine-mid">
                            {p.to_bin_code}
                          </span>{" "}
                          ({p.to_zone_code})
                        </td>
                        <td className="py-2.5 pr-3 font-semibold">
                          {p.placed_qty} {p.uom} ({p.packages} pkg)
                        </td>
                        <td className="py-2.5 pr-3 font-mono text-[11px]">
                          {p.actual_weight_kg} kg{" "}
                          <span
                            className={
                              Math.abs(p.weight_variance_pct) > 2 ? "text-amber-500" : "text-slate-400"
                            }
                          >
                            ({p.weight_variance_kg >= 0 ? "+" : ""}
                            {p.weight_variance_kg} kg / {p.weight_variance_pct}%)
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 font-mono">
                          {p.temp_c !== null ? `${p.temp_c}°C` : "N/A"}
                        </td>
                        <td className="py-2.5 text-marine-navy/65 dark:text-slate-300">{p.operator_name}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
