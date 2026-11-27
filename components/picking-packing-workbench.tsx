"use client";

import { useEffect, useState } from "react";
import { BarcodeMatchStrip } from "@/components/barcode-match-strip";
import {
  Barcode,
  Boxes,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock,
  ExternalLink,
  Layers,
  MapPin,
  Package,
  PackageCheck,
  Printer,
  QrCode,
  RefreshCw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Thermometer,
  Truck,
  UserCheck,
  Weight
} from "lucide-react";
import { Badge, Surface, SectionHeader, KpiCard, statusTone } from "@/components/ui";
import { Can, ViewOnlyBadge } from "@/components/access-gate";
import { formatCurrency, shortDate } from "@/lib/format";
import type {
  PickWaveRecord,
  PickTaskRecord,
  PackingRecord,
  DispatchStagingLane,
  ShippingLabelData
} from "@/server/services/picking-packing.service";

interface PickingWorkbenchProps {
  initialWarehouse?: string;
  currentUser?: {
    id: string;
    email: string;
    name: string;
    role: string;
    warehouse: string;
  };
}

export function PickingPackingWorkbench({
  initialWarehouse = "Milan Cold Hub",
  currentUser = {
    id: "USR-WH-MGR",
    email: "marco.bellini@ascentra.it",
    name: "Marco Bellini",
    role: "warehouse_manager",
    warehouse: "Milan Cold Hub"
  }
}: PickingWorkbenchProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "waves" | "picker" | "packing" | "labels" | "staging">("overview");
  const [warehouse, setWarehouse] = useState<string>(initialWarehouse);
  const [loading, setLoading] = useState<boolean>(true);
  const [feedback, setFeedback] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  // Data states
  const [waves, setWaves] = useState<PickWaveRecord[]>([]);
  const [eligibleOrders, setEligibleOrders] = useState<any[]>([]);
  const [activeWave, setActiveWave] = useState<PickWaveRecord | null>(null);
  const [tasks, setTasks] = useState<PickTaskRecord[]>([]);
  const [activeTask, setActiveTask] = useState<PickTaskRecord | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [stagingLanes, setStagingLanes] = useState<DispatchStagingLane[]>([]);
  const [stagedPackages, setStagedPackages] = useState<PackingRecord[]>([]);

  // Modals & form states
  const [isCreateWaveOpen, setIsCreateWaveOpen] = useState<boolean>(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [waveStrategy, setWaveStrategy] = useState<string>("multi_order_batch");
  const [wavePriority, setWavePriority] = useState<string>("normal");
  const [waveZone, setWaveZone] = useState<string>("ALL");
  const [assignedPicker, setAssignedPicker] = useState<string>("Pietro Rossi");
  const [waveToCancel, setWaveToCancel] = useState<PickWaveRecord | null>(null);

  // Barcode Scanning simulator state
  const [scanBin, setScanBin] = useState<string>("");
  const [scanSku, setScanSku] = useState<string>("");
  const [scanLot, setScanLot] = useState<string>("");
  const [isManualEntry, setIsManualEntry] = useState<boolean>(false);
  const [manualReason, setManualReason] = useState<string>("");

  // Catch-weight dialog state
  const [isCatchWeightOpen, setIsCatchWeightOpen] = useState<boolean>(false);
  const [scaleWeight, setScaleWeight] = useState<number>(0);
  const [managerOverrideNotes, setManagerOverrideNotes] = useState<string>("");

  // Packing station state
  const [packingOrderNumber, setPackingOrderNumber] = useState<string>("");
  const [tempVerified, setTempVerified] = useState<boolean>(true);
  const [segregationVerified, setSegregationVerified] = useState<boolean>(true);
  const [pkgConditionVerified, setPkgConditionVerified] = useState<boolean>(true);
  const [notesVerified, setNotesVerified] = useState<boolean>(true);
  const [packageType, setPackageType] = useState<"pallet" | "carton" | "crate" | "insulated_box">("carton");
  const [packingResult, setPackingResult] = useState<PackingRecord | null>(null);

  // Label viewer state
  const [labelData, setLabelData] = useState<ShippingLabelData | null>(null);

  // Staging assignment state
  const [stagingPackingId, setStagingPackingId] = useState<string>("");
  const [selectedStagingLane, setSelectedStagingLane] = useState<string>("STAGE-D1");
  const [scannedLaneBarcode, setScannedLaneBarcode] = useState<string>("LOC-STAGE-D1");

  const notify = (type: "success" | "error" | "info", message: string) => {
    setFeedback({ type, message });
    window.setTimeout(() => setFeedback(null), 4500);
  };

  // --------------------------------------------------------------------------
  // Data Fetching
  // --------------------------------------------------------------------------
  const loadDashboardData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Waves
      const wavesRes = await fetch(`/api/v1/picking/waves?warehouse=${encodeURIComponent(warehouse)}`);
      const wavesJson = await wavesRes.json();
      const waveList = wavesJson.waves || [];
      setWaves(waveList);

      if (waveList.length > 0 && !activeWave) {
        loadWaveDetails(waveList[0].id);
      }

      // 2. Fetch Eligible Orders
      const ordersRes = await fetch(`/api/v1/picking/waves?mode=eligible_orders&warehouse=${encodeURIComponent(warehouse)}`);
      const ordersJson = await ordersRes.json();
      setEligibleOrders(ordersJson.orders || []);

      // 3. Fetch Staging Status
      const stagingRes = await fetch(`/api/v1/picking/staging?warehouse=${encodeURIComponent(warehouse)}`);
      const stagingJson = await stagingRes.json();
      setStagingLanes(stagingJson.lanes || []);
      setStagedPackages(stagingJson.staged_packages || []);
    } catch (err: any) {
      notify("error", err?.message || "Failed to load warehouse data");
    } finally {
      setLoading(false);
    }
  };

  const loadWaveDetails = async (waveId: string) => {
    try {
      const res = await fetch(`/api/v1/picking/waves/${encodeURIComponent(waveId)}`);
      if (res.ok) {
        const wave: PickWaveRecord = await res.json();
        setActiveWave(wave);
        const taskList = wave.tasks || [];
        setTasks(taskList);
        if (taskList.length > 0) {
          const nextPending = taskList.find((t) => t.status !== "picked") || taskList[0];
          setActiveTask(nextPending);
          setScanBin(nextPending.barcode_bin);
          setScanSku(nextPending.sku);
          setScanLot(nextPending.allocated_lot);
          setScaleWeight(nextPending.expected_weight_kg || 10.0);
        }
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [warehouse]);

  // --------------------------------------------------------------------------
  // Wave Creation
  // --------------------------------------------------------------------------
  const handleCreateWave = async () => {
    if (selectedOrderIds.length === 0) {
      notify("error", "Please select at least one order to generate a pick wave.");
      return;
    }

    try {
      const res = await fetch("/api/v1/picking/waves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouse,
          strategy: waveStrategy,
          priority: wavePriority,
          zone: waveZone,
          order_ids: selectedOrderIds,
          assigned_picker_name: assignedPicker,
          notes: `Batch wave created from Picking Console on ${new Date().toLocaleTimeString()}`
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Failed to create wave");
      }

      notify("success", `Pick Wave ${data.wave_number} generated successfully with ${data.tasks_count} tasks!`);
      setIsCreateWaveOpen(false);
      setSelectedOrderIds([]);
      loadDashboardData();
      if (data.id) loadWaveDetails(data.id);
      setActiveTab("waves");
    } catch (err: any) {
      notify("error", err.message);
    }
  };

  // --------------------------------------------------------------------------
  // Barcode Verification Scan
  // --------------------------------------------------------------------------
  const handleVerifyScan = async () => {
    if (!activeTask || verifying) return;
    setVerifying(true);
    try {
      const res = await fetch(`/api/v1/picking/tasks/${encodeURIComponent(activeTask.id)}/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scanned_bin: scanBin,
          scanned_sku: scanSku,
          scanned_lot: scanLot,
          is_manual_entry: isManualEntry,
          manual_entry_reason: isManualEntry ? manualReason : undefined
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Scan verification rejected");
      }

      notify("success", data.message || "Barcode verification passed!");
      setActiveTask(data.task);

      // If catch-weight, prompt weight confirmation
      if (data.task.is_catch_weight && data.task.actual_weight_kg === null) {
        setScaleWeight(data.task.expected_weight_kg);
        setIsCatchWeightOpen(true);
      } else {
        // Automatically complete task if fully verified
        handleCompleteTask(data.task.id);
      }
    } catch (err: any) {
      notify("error", err.message);
    } finally {
      setVerifying(false);
    }
  };

  // --------------------------------------------------------------------------
  // Catch-Weight Confirmation
  // --------------------------------------------------------------------------
  const handleConfirmCatchWeight = async () => {
    if (!activeTask) return;

    try {
      const res = await fetch(`/api/v1/picking/tasks/${encodeURIComponent(activeTask.id)}/catch-weight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actual_weight_kg: Number(scaleWeight),
          manager_approval_notes: managerOverrideNotes || undefined
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Weight confirmation rejected");
      }

      notify(data.approved ? "success" : "info", data.message);
      setActiveTask(data.task);

      if (data.approved) {
        setIsCatchWeightOpen(false);
        handleCompleteTask(data.task.id);
      }
    } catch (err: any) {
      notify("error", err.message);
    }
  };

  // --------------------------------------------------------------------------
  // Complete Task
  // --------------------------------------------------------------------------
  const handleCompleteTask = async (taskId: string) => {
    try {
      const res = await fetch(`/api/v1/picking/tasks/${encodeURIComponent(taskId)}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Failed to complete task");
      }

      notify("success", `Task ${data.task_number} marked as Picked!`);
      if (activeWave) loadWaveDetails(activeWave.id);
    } catch (err: any) {
      notify("error", err.message);
    }
  };

  // --------------------------------------------------------------------------
  // Packing Verification Checklist
  // --------------------------------------------------------------------------
  const handleConfirmPacking = async () => {
    if (!packingOrderNumber) {
      notify("error", "Please select an order to pack.");
      return;
    }

    try {
      const res = await fetch("/api/v1/picking/packing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: packingOrderNumber,
          package_type: packageType,
          checklist: {
            temp_condition_verified: tempVerified,
            segregation_verified: segregationVerified,
            packaging_condition_verified: pkgConditionVerified,
            customer_instructions_verified: notesVerified
          }
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Packing checklist failed");
      }

      notify("success", `Order ${data.order_number} packed! SSCC Barcode generated: ${data.sscc_barcode}`);
      setPackingResult(data);
      setStagingPackingId(data.id);
      loadLabels(data.id);
    } catch (err: any) {
      notify("error", err.message);
    }
  };

  // --------------------------------------------------------------------------
  // Load Labels
  // --------------------------------------------------------------------------
  const loadLabels = async (idOrOrder: string) => {
    try {
      const res = await fetch(`/api/v1/picking/labels?id=${encodeURIComponent(idOrOrder)}`);
      if (res.ok) {
        const data = await res.json();
        setLabelData(data);
      }
    } catch {
      // ignore
    }
  };

  // --------------------------------------------------------------------------
  // Dispatch Staging Assignment
  // --------------------------------------------------------------------------
  const handleAssignStaging = async () => {
    if (!stagingPackingId) {
      notify("error", "Please select a packed container to stage.");
      return;
    }

    try {
      const res = await fetch("/api/v1/picking/staging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packing_id: stagingPackingId,
          staging_lane_code: selectedStagingLane,
          scanned_lane_barcode: scannedLaneBarcode
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Staging assignment rejected");
      }

      notify("success", `Container staged at lane ${selectedStagingLane}! Inventory consumed & stock movements logged.`);
      loadDashboardData();
    } catch (err: any) {
      notify("error", err.message);
    }
  };

  async function confirmCancelWave() {
    if (!waveToCancel) return;
    const waveId = waveToCancel.id;
    setWaveToCancel(null);
    try {
      await fetch(`/api/v1/picking/waves/${waveId}?reason=Cancelled+by+supervisor`, {
        method: "DELETE",
      });
      notify("success", `Wave cancelled.`);
      loadDashboardData();
    } catch (err: any) {
      notify("error", err.message || "Failed to cancel wave");
    }
  }

  // Quick stats
  const totalWaves = waves.length;
  const inProgressWaves = waves.filter((w) => w.status === "picking" || w.status === "assigned" || w.status === "partially_picked").length;
  const totalTasks = tasks.length;
  const pickedTasks = tasks.filter((t) => t.status === "picked").length;

  return (
    <div className="space-y-6">
      {/* Toast Feedback */}
      {feedback && (
        <div
          className={`rounded-lg p-3 text-sm font-medium transition-all ${
            feedback.type === "success"
              ? "bg-marine-ocean/20 text-marine-mid/90 border border-marine-ocean/60"
              : feedback.type === "error"
                ? "bg-red-50 text-red-800 border border-red-200"
                : "bg-blue-50 text-blue-800 border border-blue-200"
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Header and Control Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
              Module 08 · Warehouse Execution
            </span>
            <Badge tone="ok" dot>
              Scanner Ready
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Picking, Packing & Dispatch Staging</h1>
          <p className="text-sm text-muted-foreground">
            Wave creation, FEFO batch allocation, barcode scan verification, catch-weight validation, and dispatch staging.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={warehouse}
            onChange={(e) => setWarehouse(e.target.value)}
            className="rounded-lg border bg-card px-3 py-1.5 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="Milan Cold Hub">Milan Cold Hub (Hub Central)</option>
            <option value="Bologna Freezer DC">Bologna Freezer DC (Frozen Hub)</option>
          </select>

          <button
            onClick={() => setIsCreateWaveOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
          >
            <Boxes className="h-4 w-4" />
            Generate Wave
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Open Waves"
          value={String(totalWaves)}
          change={`${inProgressWaves} currently picking`}
          trend="flat"
          icon={<Layers className="h-4 w-4" />}
        />
        <KpiCard
          label="Orders Ready for Pick"
          value={String(eligibleOrders.length)}
          change="Confirmed customer orders"
          trend="up"
          tone="ok"
          icon={<ClipboardCheck className="h-4 w-4" />}
        />
        <KpiCard
          label="FEFO Pick Accuracy"
          value="99.9%"
          change="Barcode scan verified"
          trend="up"
          tone="ok"
          icon={<Barcode className="h-4 w-4" />}
        />
        <KpiCard
          label="Staging Lanes Occupied"
          value={`${stagingLanes.reduce((sum, l) => sum + l.current_occupancy, 0)} / ${stagingLanes.reduce((sum, l) => sum + l.capacity_pallets, 0)}`}
          change="Pallet spaces utilized"
          trend="flat"
          icon={<Truck className="h-4 w-4" />}
        />
      </div>

      {/* Main Navigation Tabs */}
      <div className="border-b">
        <nav className="flex space-x-6 overflow-x-auto whitespace-nowrap text-sm font-medium [-webkit-overflow-scrolling:touch]">
          {[
            { id: "overview", label: "Overview & Pipeline", icon: Layers },
            { id: "waves", label: "Wave Manager", icon: Boxes },
            { id: "picker", label: "Mobile Picker Interface", icon: Barcode },
            { id: "packing", label: "Packing Verification", icon: PackageCheck },
            { id: "labels", label: "Shipping Labels & SSCC", icon: Printer },
            { id: "staging", label: "Dispatch Staging", icon: MapPin }
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`inline-flex shrink-0 items-center gap-2 border-b-2 pb-3 transition-colors ${
                  active
                    ? "border-primary text-primary font-semibold"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Surface className="lg:col-span-2 space-y-4">
            <SectionHeader
              eyebrow="Active Waves"
              title="Picking Waves in Progress"
              action={
                <button
                  onClick={loadDashboardData}
                  className="rounded p-1 text-muted-foreground hover:bg-muted"
                  title="Refresh"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              }
            />

            {waves.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No active pick waves found in {warehouse}. Click "Generate Wave" to group confirmed orders.
              </div>
            ) : (
              <div className="divide-y rounded-lg border">
                {waves.slice(0, 5).map((w) => (
                  <div key={w.id} className="flex items-center justify-between p-4 hover:bg-muted/40">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{w.wave_number}</span>
                        <Badge tone={statusTone(w.status)}>{w.status}</Badge>
                        <Badge tone={w.priority === "urgent" ? "critical" : "neutral"}>{w.priority}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {w.orders_count} orders · {w.tasks_count} tasks · Assigned to: {w.assigned_picker_name || "Unassigned"}
                      </p>
                      <div className="w-48 bg-muted rounded-full h-1.5 mt-1">
                        <div
                          className="bg-primary h-1.5 rounded-full transition-all"
                          style={{
                            width: `${w.cases_total > 0 ? Math.min(100, Math.round((w.cases_picked / w.cases_total) * 100)) : 0}%`
                          }}
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        loadWaveDetails(w.id);
                        setActiveTab("picker");
                      }}
                      className="inline-flex items-center gap-1 rounded bg-muted px-3 py-1.5 text-xs font-semibold hover:bg-muted/80"
                    >
                      Open in Picker
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Surface>

          {/* Quick Stage Status */}
          <Surface className="space-y-4">
            <SectionHeader
              eyebrow="Dispatch Flow"
              title="Staging Lanes Capacity"
              action={<ViewOnlyBadge modifyPermissions={["warehouse:update"]} />}
            />
            <div className="space-y-3">
              {stagingLanes.map((lane) => {
                const pct = Math.round((lane.current_occupancy / lane.capacity_pallets) * 100);
                return (
                  <div key={lane.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span>{lane.lane_code}</span>
                      <span className="text-muted-foreground">
                        {lane.current_occupancy} / {lane.capacity_pallets} pallets ({pct}%)
                      </span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2 mt-2">
                      <div
                        className={`h-2 rounded-full ${pct > 80 ? "bg-amber-500" : "bg-marine-steel"}`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">Zone: {lane.zone} · Route: {lane.assigned_route || "General"}</p>
                  </div>
                );
              })}
            </div>
          </Surface>
        </div>
      )}

      {/* TAB 2: WAVE MANAGER */}
      {activeTab === "waves" && (
        <Surface className="space-y-4">
          <SectionHeader
            eyebrow="Wave Management"
            title="Generated Waves"
            action={
              <button
                onClick={() => setIsCreateWaveOpen(true)}
                className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                + New Pick Wave
              </button>
            }
          />

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs font-semibold uppercase text-muted-foreground">
                <tr>
                  <th className="py-2.5 px-3">Wave Number</th>
                  <th className="py-2.5 px-3">Warehouse / Zone</th>
                  <th className="py-2.5 px-3">Priority</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Orders</th>
                  <th className="py-2.5 px-3">Cases (Picked / Total)</th>
                  <th className="py-2.5 px-3">Picker</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {waves.map((w) => (
                  <tr key={w.id} className="hover:bg-muted/30">
                    <td className="py-3 px-3 font-semibold">{w.wave_number}</td>
                    <td className="py-3 px-3 text-xs">
                      <div>{w.warehouse}</div>
                      <div className="text-muted-foreground">{w.zone || "All Zones"}</div>
                    </td>
                    <td className="py-3 px-3">
                      <Badge tone={w.priority === "urgent" ? "critical" : "neutral"}>{w.priority}</Badge>
                    </td>
                    <td className="py-3 px-3">
                      <Badge tone={statusTone(w.status)}>{w.status}</Badge>
                    </td>
                    <td className="py-3 px-3">{w.orders_count} orders</td>
                    <td className="py-3 px-3">
                      {w.cases_picked} / {w.cases_total} cases
                    </td>
                    <td className="py-3 px-3 text-xs">{w.assigned_picker_name || "Unassigned"}</td>
                    <td className="py-3 px-3 text-right space-x-2">
                      <button
                        onClick={() => {
                          loadWaveDetails(w.id);
                          setActiveTab("picker");
                        }}
                        className="rounded bg-muted px-2.5 py-1 text-xs font-semibold hover:bg-muted/80"
                      >
                        Pick
                      </button>
                      {w.status !== "cancelled" && w.status !== "staged" && (
                        <Can permission="warehouse:update" mode="hide">
                          <button
                            onClick={() => setWaveToCancel(w)}
                            className="rounded bg-red-50 text-red-700 px-2 py-1 text-xs hover:bg-red-100"
                          >
                            Cancel
                          </button>
                        </Can>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Surface>
      )}

      {/* TAB 3: MOBILE PICKER INTERFACE */}
      {activeTab === "picker" && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Pick Tasks List with Route Sequencing */}
          <Surface className="space-y-4">
            <SectionHeader
              eyebrow="Route Optimization"
              title={`Wave Tasks (${tasks.length})`}
              action={
                <Badge tone="ok">
                  {pickedTasks} / {totalTasks} Picked
                </Badge>
              }
            />

            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {tasks.map((task, idx) => {
                const isSelected = activeTask?.id === task.id;
                const isDone = task.status === "picked";
                return (
                  <div
                    key={task.id}
                    onClick={() => {
                      setActiveTask(task);
                      setScanBin(task.barcode_bin);
                      setScanSku(task.sku);
                      setScanLot(task.allocated_lot);
                      setScaleWeight(task.expected_weight_kg);
                    }}
                    className={`cursor-pointer rounded-lg border p-3 transition-all ${
                      isSelected
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : isDone
                          ? "bg-muted/30 opacity-70"
                          : "hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold">
                        #{idx + 1} · {task.task_number}
                      </span>
                      <Badge tone={isDone ? "ok" : statusTone(task.status)}>{task.status}</Badge>
                    </div>
                    <div className="mt-1 font-medium text-sm">{task.product_name}</div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
                      <span>Bin: <strong className="text-foreground">{task.bin_code}</strong></span>
                      <span>Qty: <strong>{task.requested_cases} {task.uom}s</strong></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Surface>

          {/* Active Task & Live Barcode Scanner Simulation */}
          <Surface className="lg:col-span-2 space-y-5">
            {activeTask ? (
              <>
                <div className="flex items-center justify-between border-b pb-3">
                  <div>
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">Current Pick Task</span>
                    <h2 className="text-xl font-bold">{activeTask.product_name}</h2>
                    <p className="text-xs text-muted-foreground">
                      Order: {activeTask.order_number} · Customer: {activeTask.customer_name}
                    </p>
                  </div>
                  <Badge tone={activeTask.status === "picked" ? "ok" : "critical"}>
                    {activeTask.status.toUpperCase()}
                  </Badge>
                </div>

                {/* Big Visual Location Guide */}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg bg-muted p-3 text-center">
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Target Bin</span>
                    <div className="text-2xl font-black text-primary">{activeTask.bin_code}</div>
                    <span className="text-xs text-muted-foreground">Zone: {activeTask.zone}</span>
                  </div>
                  <div className="rounded-lg bg-muted p-3 text-center">
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Required Cases</span>
                    <div className="text-2xl font-black">{activeTask.requested_cases}</div>
                    <span className="text-xs text-muted-foreground">UOM: {activeTask.uom}</span>
                  </div>
                  <div className="rounded-lg bg-muted p-3 text-center">
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Assigned FEFO Lot</span>
                    <div className="text-lg font-bold">{activeTask.allocated_lot}</div>
                    <span className="text-xs text-muted-foreground">Expires: {shortDate(activeTask.expiry_date)}</span>
                  </div>
                </div>

                {/* Barcode Scanner Controls */}
                <div className="rounded-lg border bg-card p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Barcode className="h-5 w-5 text-primary" />
                      <span className="font-semibold text-sm">GS1 Barcode Verification</span>
                    </div>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isManualEntry}
                        onChange={(e) => setIsManualEntry(e.target.checked)}
                        className="rounded"
                      />
                      <span>Manual Override Fallback</span>
                    </label>
                  </div>

                  <BarcodeMatchStrip
                    operation="picking"
                    referenceId={activeTask.id}
                    expectedSku={activeTask?.sku ?? null}
                    lotHint={activeTask ? `${activeTask.allocated_lot} · exp ${activeTask.expiry_date}` : null}
                    onMatch={(productSku) => {
                      setScanSku(productSku);
                      setScanLot(activeTask?.allocated_lot ?? "");
                    }}
                  />

                  <div className="grid gap-3 sm:grid-cols-3 text-xs">
                    <div>
                      <label className="font-medium text-muted-foreground">1. Scan Bin Location</label>
                      <input
                        type="text"
                        value={scanBin}
                        onChange={(e) => setScanBin(e.target.value)}
                        placeholder="LOC-MCH-CH-A01"
                        className="mt-1 w-full rounded border px-2.5 py-1.5 font-mono text-xs focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="font-medium text-muted-foreground">2. Scan Product SKU</label>
                      <input
                        type="text"
                        value={scanSku}
                        onChange={(e) => setScanSku(e.target.value)}
                        placeholder="SKU-SAL-001"
                        className="mt-1 w-full rounded border px-2.5 py-1.5 font-mono text-xs focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="font-medium text-muted-foreground">3. Scan Batch / Lot</label>
                      <input
                        type="text"
                        value={scanLot}
                        onChange={(e) => setScanLot(e.target.value)}
                        placeholder="LOT-2026-SAL-041"
                        className="mt-1 w-full rounded border px-2.5 py-1.5 font-mono text-xs focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  </div>

                  {isManualEntry && (
                    <div>
                      <label className="text-xs font-medium text-amber-800">
                        Manual Entry Reason (Mandatory audit justification)
                      </label>
                      <input
                        type="text"
                        value={manualReason}
                        onChange={(e) => setManualReason(e.target.value)}
                        placeholder="e.g. Scuffed thermal label, verified physical print"
                        className="mt-1 w-full rounded border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs"
                      />
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                    <button
                      onClick={() => {
                        // Quick Fill Accurate Values
                        setScanBin(activeTask.bin_code);
                        setScanSku(activeTask.sku);
                        setScanLot(activeTask.allocated_lot);
                      }}
                      className="min-h-11 rounded px-3 text-xs text-muted-foreground underline hover:text-foreground sm:min-h-0 sm:px-0"
                    >
                      Fill Correct Barcode Values
                    </button>

                    <Can permission="warehouse:update" mode="disable">
                      <button
                        onClick={handleVerifyScan}
                        disabled={verifying}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {verifying ? "Verifying…" : "Verify Scan & Confirm Pick"}
                      </button>
                    </Can>
                  </div>
                </div>

                {/* Catch-Weight Banner if applicable */}
                {activeTask.is_catch_weight && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-blue-900">
                      <Scale className="h-4 w-4 text-blue-700" />
                      <span>
                        Catch-Weight Product: Expected weight <strong>{activeTask.expected_weight_kg} kg</strong> ·
                        Confirmed: <strong>{activeTask.actual_weight_kg ? `${activeTask.actual_weight_kg} kg` : "Pending Scale"}</strong>
                      </span>
                    </div>
                    <button
                      onClick={() => setIsCatchWeightOpen(true)}
                      className="min-h-11 rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 sm:min-h-0 sm:px-2.5 sm:py-1"
                    >
                      Scale Input
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="p-8 text-center text-sm text-muted-foreground">Select a wave task to begin picking.</div>
            )}
          </Surface>
        </div>
      )}

      {/* TAB 4: PACKING VERIFICATION */}
      {activeTab === "packing" && (
        <Surface className="space-y-6 max-w-3xl mx-auto">
          <SectionHeader
            eyebrow="Quality Gate"
            title="Packing Verification Checklist"
            description="All four quality and food safety gates must be confirmed before sealing the container."
          />

          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold">Select Order to Pack</label>
              <select
                value={packingOrderNumber}
                onChange={(e) => setPackingOrderNumber(e.target.value)}
                className="mt-1 w-full rounded-lg border bg-card px-3 py-2 text-sm"
              >
                <option value="">-- Choose an order --</option>
                {eligibleOrders.map((o) => (
                  <option key={o.id} value={o.order_number}>
                    {o.order_number} · {o.customer_name} ({o.cases_total} cases)
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold">Container Type</label>
                <select
                  value={packageType}
                  onChange={(e) => setPackageType(e.target.value as any)}
                  className="mt-1 w-full rounded-lg border bg-card px-3 py-2 text-sm"
                >
                  <option value="carton">Standard Carton Box</option>
                  <option value="pallet">EUR-Pallet (Wood/Plastic)</option>
                  <option value="insulated_box">Insulated Cold-Chain Box (Gel Packs)</option>
                  <option value="crate">Returnable Plastic Crate</option>
                </select>
              </div>
            </div>

            {/* Quality Checklist */}
            <div className="rounded-lg border divide-y text-sm">
              <label className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/40">
                <input
                  type="checkbox"
                  checked={tempVerified}
                  onChange={(e) => setTempVerified(e.target.checked)}
                  className="h-4 w-4 rounded text-primary"
                />
                <div>
                  <div className="font-medium">1. Cold-Chain & Temperature Requirements</div>
                  <div className="text-xs text-muted-foreground">Gel packs or reefer pre-chill verified for delivery journey.</div>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/40">
                <input
                  type="checkbox"
                  checked={segregationVerified}
                  onChange={(e) => setSegregationVerified(e.target.checked)}
                  className="h-4 w-4 rounded text-primary"
                />
                <div>
                  <div className="font-medium">2. Product & Allergen Segregation</div>
                  <div className="text-xs text-muted-foreground">Raw seafood/meat segregated from ready-to-eat dairy and produce.</div>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/40">
                <input
                  type="checkbox"
                  checked={pkgConditionVerified}
                  onChange={(e) => setPkgConditionVerified(e.target.checked)}
                  className="h-4 w-4 rounded text-primary"
                />
                <div>
                  <div className="font-medium">3. Packaging Integrity & Tamper Seal</div>
                  <div className="text-xs text-muted-foreground">Container is undamaged, clean, and tamper-evident seal is applied.</div>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/40">
                <input
                  type="checkbox"
                  checked={notesVerified}
                  onChange={(e) => setNotesVerified(e.target.checked)}
                  className="h-4 w-4 rounded text-primary"
                />
                <div>
                  <div className="font-medium">4. Customer-Specific Delivery Instructions</div>
                  <div className="text-xs text-muted-foreground">Special knife cuts, vacuum seals, and label requirements verified.</div>
                </div>
              </label>
            </div>

            <Can permission="warehouse:update" mode="disable">
              <button
                onClick={handleConfirmPacking}
                className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Confirm Packing & Generate SSCC-18 Barcode
              </button>
            </Can>
          </div>
        </Surface>
      )}

      {/* TAB 5: SHIPPING LABELS & SSCC */}
      {activeTab === "labels" && (
        <Surface className="space-y-6 max-w-2xl mx-auto">
          <SectionHeader
            eyebrow="GS1 Standards"
            title="Shipping & SSCC-18 Pallet Label"
            action={
              <button
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded bg-muted px-3 py-1.5 text-xs font-semibold hover:bg-muted/80"
              >
                <Printer className="h-4 w-4" />
                Print Label
              </button>
            }
          />

          {labelData ? (
            <div className="rounded-xl border-2 border-black bg-white p-6 font-mono text-black space-y-4 shadow-md print:border-0 print:shadow-none">
              {/* Top Banner */}
              <div className="flex items-center justify-between border-b-2 border-black pb-3">
                <div>
                  <div className="text-xl font-black">ASCENTRA LOGISTICS</div>
                  <div className="text-xs">Cold-Chain Distribution Network</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold uppercase">{labelData.package_type}</div>
                  <div className="text-sm font-black uppercase text-blue-700">{labelData.temp_zone}</div>
                </div>
              </div>

              {/* Ship To */}
              <div className="border-b-2 border-black pb-3">
                <div className="text-[10px] text-gray-500 uppercase">SHIP TO:</div>
                <div className="text-lg font-bold">{labelData.customer_name}</div>
                <div className="text-xs">{labelData.delivery_address}</div>
                <div className="text-xs mt-1">Delivery Date: <strong>{labelData.delivery_date}</strong> · Order: <strong>{labelData.order_number}</strong></div>
              </div>

              {/* Contents Table */}
              <div className="border-b-2 border-black pb-3 text-xs">
                <div className="text-[10px] text-gray-500 uppercase mb-1">CONTAINER CONTENTS:</div>
                {labelData.items.map((it, i) => (
                  <div key={i} className="flex justify-between py-0.5">
                    <span>{it.sku} · {it.product_name}</span>
                    <span>{it.cases} cs ({it.weight_kg} kg)</span>
                  </div>
                ))}
              </div>

              {/* Weight & Cases */}
              <div className="grid grid-cols-2 border-b-2 border-black pb-3 text-center">
                <div>
                  <div className="text-[10px] text-gray-500">TOTAL CASES</div>
                  <div className="text-xl font-black">{labelData.total_cases}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500">GROSS WEIGHT</div>
                  <div className="text-xl font-black">{labelData.total_weight_kg} KG</div>
                </div>
              </div>

              {/* SSCC Barcode Representation */}
              <div className="pt-2 text-center space-y-2">
                <div className="text-[10px] text-gray-500 uppercase">SSCC-18 (SERIAL SHIPPING CONTAINER CODE)</div>
                <div className="bg-gray-100 p-3 rounded flex flex-col items-center justify-center">
                  <div className="tracking-[0.25em] font-black text-lg">{labelData.sscc_barcode}</div>
                  <div className="text-[10px] text-gray-500 mt-1">GS1-128 Compliant Barcode</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground border rounded-lg">
              No label loaded. Pack an order in the Packing Verification tab or select a packed container.
            </div>
          )}
        </Surface>
      )}

      {/* TAB 6: DISPATCH STAGING */}
      {activeTab === "staging" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Surface className="space-y-4">
            <SectionHeader eyebrow="Lane Assignment" title="Stage Container" />

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold">Packing ID</label>
                <input
                  type="text"
                  value={stagingPackingId}
                  onChange={(e) => setStagingPackingId(e.target.value)}
                  placeholder="PCK-2026-0001"
                  className="mt-1 w-full rounded border px-3 py-2"
                />
              </div>

              <div>
                <label className="font-semibold">Target Staging Lane</label>
                <select
                  value={selectedStagingLane}
                  onChange={(e) => {
                    setSelectedStagingLane(e.target.value);
                    setScannedLaneBarcode(`LOC-${e.target.value}`);
                  }}
                  className="mt-1 w-full rounded border px-3 py-2"
                >
                  {stagingLanes.map((l) => (
                    <option key={l.id} value={l.lane_code}>
                      {l.lane_code} ({l.zone}) · {l.current_occupancy}/{l.capacity_pallets} pallets
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-semibold">Scan Staging Lane Barcode</label>
                <input
                  type="text"
                  value={scannedLaneBarcode}
                  onChange={(e) => setScannedLaneBarcode(e.target.value)}
                  placeholder="LOC-STAGE-D1"
                  className="mt-1 w-full rounded border px-3 py-2 font-mono"
                />
              </div>

              <Can permission="warehouse:update" mode="disable">
                <button
                  onClick={handleAssignStaging}
                  className="w-full rounded bg-primary py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 mt-2"
                >
                  Confirm Staging & Consume Inventory
                </button>
              </Can>
            </div>
          </Surface>

          {/* Staged Packages List */}
          <Surface className="lg:col-span-2 space-y-4">
            <SectionHeader eyebrow="Ready for Loading" title={`Currently Staged Packages (${stagedPackages.length})`} />

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-muted/40 font-semibold uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2.5 px-3">SSCC Barcode</th>
                    <th className="py-2.5 px-3">Order</th>
                    <th className="py-2.5 px-3">Customer</th>
                    <th className="py-2.5 px-3">Staging Lane</th>
                    <th className="py-2.5 px-3">Weight</th>
                    <th className="py-2.5 px-3">Staged At</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {stagedPackages.map((pkg) => (
                    <tr key={pkg.id}>
                      <td className="py-2 px-3 font-mono font-semibold">{pkg.sscc_barcode}</td>
                      <td className="py-2 px-3">{pkg.order_number}</td>
                      <td className="py-2 px-3">{pkg.customer_name}</td>
                      <td className="py-2 px-3">
                        <Badge tone="ok">{pkg.staging_bin}</Badge>
                      </td>
                      <td className="py-2 px-3">{pkg.total_weight_kg} kg</td>
                      <td className="py-2 px-3 text-muted-foreground">{pkg.staged_at?.slice(11, 16) || "Ready"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Surface>
        </div>
      )}

      {/* CREATE WAVE MODAL */}
      {isCreateWaveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-card p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto border">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-lg font-bold">Generate Pick Wave</h3>
              <button onClick={() => setIsCreateWaveOpen(false)} className="text-muted-foreground hover:text-foreground">
                ✕
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 text-xs">
              <div>
                <label className="font-semibold">Strategy</label>
                <select
                  value={waveStrategy}
                  onChange={(e) => setWaveStrategy(e.target.value)}
                  className="mt-1 w-full rounded border px-2.5 py-1.5"
                >
                  <option value="multi_order_batch">Multi-Order Batch Pick</option>
                  <option value="single_order">Single-Order Pick</option>
                  <option value="zone_batch">Zone-Based Batch</option>
                  <option value="delivery_batch">Delivery Schedule Batch</option>
                </select>
              </div>

              <div>
                <label className="font-semibold">Zone Filter</label>
                <select
                  value={waveZone}
                  onChange={(e) => setWaveZone(e.target.value)}
                  className="mt-1 w-full rounded border px-2.5 py-1.5"
                >
                  <option value="ALL">All Warehouse Zones</option>
                  <option value="Chilled A">Chilled A (Seafood)</option>
                  <option value="Chilled B">Chilled B (Dairy)</option>
                  <option value="Deep Freeze">Deep Freeze (IQF)</option>
                  <option value="Produce C">Produce C</option>
                </select>
              </div>

              <div>
                <label className="font-semibold">Priority</label>
                <select
                  value={wavePriority}
                  onChange={(e) => setWavePriority(e.target.value as any)}
                  className="mt-1 w-full rounded border px-2.5 py-1.5"
                >
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold">Assign Picker</label>
              <select
                value={assignedPicker}
                onChange={(e) => setAssignedPicker(e.target.value)}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              >
                <option value="Pietro Rossi">Pietro Rossi (Lead Picker - Milan Cold Hub)</option>
                <option value="Marco Bellini">Marco Bellini (Warehouse Manager)</option>
                <option value="Davide Galli">Davide Galli (Logistics Driver)</option>
              </select>
            </div>

            {/* Select Orders Table */}
            <div>
              <div className="flex items-center justify-between text-xs font-semibold mb-2">
                <span>Select Orders ({eligibleOrders.length} available)</span>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedOrderIds.length === eligibleOrders.length) {
                      setSelectedOrderIds([]);
                    } else {
                      setSelectedOrderIds(eligibleOrders.map((o) => o.id));
                    }
                  }}
                  className="text-primary hover:underline"
                >
                  {selectedOrderIds.length === eligibleOrders.length ? "Deselect All" : "Select All"}
                </button>
              </div>

              <div className="max-h-60 overflow-y-auto rounded border divide-y text-xs">
                {eligibleOrders.map((ord) => {
                  const isChecked = selectedOrderIds.includes(ord.id);
                  return (
                    <label key={ord.id} className="flex items-center gap-3 p-2.5 hover:bg-muted/40 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedOrderIds([...selectedOrderIds, ord.id]);
                          } else {
                            setSelectedOrderIds(selectedOrderIds.filter((id) => id !== ord.id));
                          }
                        }}
                        className="rounded"
                      />
                      <div className="flex-1">
                        <div className="font-semibold">{ord.order_number} · {ord.customer_name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {ord.cases_total} cases · Delivery: {ord.delivery_date} · Route: {ord.route_code || "Direct"}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <button
                type="button"
                onClick={() => setIsCreateWaveOpen(false)}
                className="rounded border px-4 py-2 text-sm hover:bg-muted"
              >
                Cancel
              </button>
              <Can permission="warehouse:update" mode="disable">
                <button
                  type="button"
                  onClick={handleCreateWave}
                  className="rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  Generate Pick Wave ({selectedOrderIds.length} orders)
                </button>
              </Can>
            </div>
          </div>
        </div>
      )}

      {/* CATCH WEIGHT SCALE MODAL */}
      {isCatchWeightOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="catch-weight-title"
            className="flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-2xl border bg-card shadow-xl sm:max-w-md sm:rounded-xl sm:p-6"
          >
            <div className="flex items-center justify-between border-b px-4 pb-3 pt-4 sm:px-0 sm:pt-0">
              <div className="flex items-center gap-2">
                <Scale className="h-5 w-5 text-blue-600" />
                <h3 id="catch-weight-title" className="text-lg font-bold">Catch-Weight Confirmation</h3>
              </div>
              <button
                onClick={() => setIsCatchWeightOpen(false)}
                aria-label="Close"
                className="flex min-h-11 min-w-11 items-center justify-center text-muted-foreground hover:text-foreground sm:min-h-0 sm:min-w-0"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4 text-xs sm:px-0 sm:pb-0">
              <div className="rounded bg-muted p-3">
                <div className="text-muted-foreground">Product</div>
                <div className="font-semibold text-sm">{activeTask?.product_name}</div>
                <div className="text-muted-foreground mt-1">
                  Expected Weight: <strong>{activeTask?.expected_weight_kg} kg</strong> (Tolerance ±{activeTask?.weight_tolerance_pct}%)
                </div>
              </div>

              <div>
                <label className="font-semibold text-sm">Actual Scale Weight (kg)</label>
                <div className="relative mt-1">
                  <input
                    type="number"
                    step="0.01"
                    value={scaleWeight}
                    onChange={(e) => setScaleWeight(Number(e.target.value))}
                    className="w-full rounded border px-3 py-2 text-lg font-mono font-bold"
                  />
                  <span className="absolute right-3 top-2.5 text-muted-foreground font-bold">KG</span>
                </div>
              </div>

              {/* Live variance indicator */}
              {activeTask && (
                <div className="rounded p-2 border text-xs">
                  {(() => {
                    const exp = activeTask.expected_weight_kg || 1;
                    const diff = scaleWeight - exp;
                    const varPct = Math.round((diff / exp) * 1000) / 10;
                    const tol = activeTask.weight_tolerance_pct || 5.0;
                    const isExceeded = Math.abs(varPct) > tol;
                    return (
                      <div className="flex items-center justify-between">
                        <span>Variance: <strong>{varPct > 0 ? "+" : ""}{varPct}%</strong></span>
                        <Badge tone={isExceeded ? "critical" : "ok"}>
                          {isExceeded ? `Exceeds ±${tol}%` : `Within ±${tol}%`}
                        </Badge>
                      </div>
                    );
                  })()}
                </div>
              )}

              <div>
                <label className="text-[11px] text-muted-foreground">Manager Override Justification (if tolerance exceeded)</label>
                <input
                  type="text"
                  value={managerOverrideNotes}
                  onChange={(e) => setManagerOverrideNotes(e.target.value)}
                  placeholder="Supervisor sign-off notes"
                  className="mt-1 w-full rounded border px-2.5 py-1.5 text-xs"
                />
              </div>

              <div className="sticky bottom-0 z-10 flex justify-end gap-2 border-t bg-card pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:pb-0">
                <button
                  type="button"
                  onClick={() => setIsCatchWeightOpen(false)}
                  className="min-h-11 rounded border px-4 py-2 text-xs sm:min-h-0"
                >
                  Cancel
                </button>
                <Can permission="warehouse:update" mode="disable">
                  <button
                    type="button"
                    onClick={handleConfirmCatchWeight}
                    className="min-h-11 rounded bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 sm:min-h-0"
                  >
                    Confirm Weight
                  </button>
                </Can>
              </div>
            </div>
          </div>
        </div>
      )}

      {waveToCancel && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Cancel pick wave"
            className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-border bg-card p-4 shadow-xl sm:rounded-xl sm:p-5"
          >
            <h3 className="text-sm font-bold">Cancel pick wave?</h3>
            <p className="mt-2 text-xs text-muted-foreground">
              {waveToCancel.wave_number} will be cancelled and removed from the active picking queue.
            </p>
            <div className="sticky bottom-0 mt-4 flex flex-col gap-2 border-t border-border bg-card pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:justify-end sm:pb-0">
              <button
                type="button"
                onClick={() => setWaveToCancel(null)}
                className="min-h-11 w-full rounded border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted sm:min-h-0 sm:w-auto"
              >
                Keep wave
              </button>
              <button
                type="button"
                onClick={confirmCancelWave}
                className="min-h-11 w-full rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 sm:min-h-0 sm:w-auto"
              >
                Cancel wave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
