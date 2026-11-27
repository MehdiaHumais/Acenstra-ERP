"use client";

import { useState, useEffect, useTransition } from "react";
import {
  Truck,
  UserCheck,
  CheckCircle2,
  AlertTriangle,
  QrCode,
  FileText,
  Thermometer,
  ShieldAlert,
  ArrowRight,
  Plus,
  RefreshCw,
  Box,
  ClipboardList,
  ExternalLink,
  MapPin,
  Clock,
  Layers,
  Search,
} from "lucide-react";
import { Badge, statusTone } from "@/components/ui";
import { Can } from "@/components/access-gate";
import type {
  DetailedDelivery,
  Vehicle,
  Driver,
  DeliveryManifestItem,
  VehicleInspection,
  DeliveryTemperatureLog,
  DeliveryProof,
  DeliveryException,
} from "@/lib/types";

export function LoadingDeliveryWorkbench() {
  const [deliveries, setDeliveries] = useState<DetailedDelivery[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"deliveries" | "fleet" | "manifest" | "temperature" | "pod">("deliveries");
  const [isPending, startTransition] = useTransition();

  // Modals state
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [inspectionModalOpen, setInspectionModalOpen] = useState(false);
  const [tempModalOpen, setTempModalOpen] = useState(false);
  const [exceptionModalOpen, setExceptionModalOpen] = useState(false);
  const [dispatchConfirmOpen, setDispatchConfirmOpen] = useState(false);
  const [toast, setToast] = useState<{
    text: string;
    tone: "ok" | "error" | "warning";
  } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Form states
  const [planOrders, setPlanOrders] = useState("SO-2026-9841");
  const [planRoute, setPlanRoute] = useState("RT-MIL-N1");
  const [planVehicle, setPlanVehicle] = useState("");
  const [planDriver, setPlanDriver] = useState("");

  const [assignVehicleId, setAssignVehicleId] = useState("");
  const [assignDriverId, setAssignDriverId] = useState("");

  const [inspectionVehicleId, setInspectionVehicleId] = useState("");
  const [inspectionDriverId, setInspectionDriverId] = useState("");
  const [cleanlinessPassed, setCleanlinessPassed] = useState(true);
  const [conditionPassed, setConditionPassed] = useState(true);
  const [reeferFunctioning, setReeferFunctioning] = useState(true);
  const [chilledTemp, setChilledTemp] = useState("2.5");
  const [frozenTemp, setFrozenTemp] = useState("-19.0");
  const [dividersSecure, setDividersSecure] = useState(true);
  const [capacityValid, setCapacityValid] = useState(true);
  const [docsVerified, setDocsVerified] = useState(true);
  const [driverConfirmed, setDriverConfirmed] = useState(true);

  // Scan state
  const [barcodeInput, setBarcodeInput] = useState("");
  const [scanCompartment, setScanCompartment] = useState<"chilled" | "frozen" | "ambient">("chilled");
  const [scanMessage, setScanMessage] = useState<{ text: string; isError: boolean } | null>(null);

  // Temp log state
  const [tempCompartment, setTempCompartment] = useState<"chilled" | "frozen" | "ambient">("chilled");
  const [tempStage, setTempStage] = useState<"pre_loading" | "post_loading" | "in_transit" | "arrival" | "delivery">("in_transit");
  const [tempReading, setTempReading] = useState("3.2");
  const [tempNotes, setTempNotes] = useState("");

  // Exception state
  const [excType, setExcType] = useState<any>("damaged_goods");
  const [excReason, setExcReason] = useState("");
  const [excCases, setExcCases] = useState("1");
  const [excFollowUp, setExcFollowUp] = useState<any>("return_to_warehouse");

  async function loadData() {
    try {
      setLoading(true);
      const [delRes, vehRes, drvRes] = await Promise.all([
        fetch("/api/v1/deliveries/plan").then((r) => r.json()),
        fetch("/api/v1/deliveries/vehicles").then((r) => r.json()),
        fetch("/api/v1/deliveries/drivers").then((r) => r.json()),
      ]);

      if (delRes.deliveries) {
        setDeliveries(delRes.deliveries);
        if (!selectedDeliveryId && delRes.deliveries.length > 0) {
          setSelectedDeliveryId(delRes.deliveries[0].id);
        }
      }
      if (vehRes.vehicles) setVehicles(vehRes.vehicles);
      if (drvRes.drivers) setDrivers(drvRes.drivers);
    } catch (e) {
      console.error("Failed to load delivery data", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const selectedDelivery = deliveries.find((d) => d.id === selectedDeliveryId) || deliveries[0];

  async function handlePlanDelivery() {
    const orders = planOrders.split(",").map((s) => s.trim()).filter(Boolean);
    if (orders.length === 0) return;
    try {
      const res = await fetch("/api/v1/deliveries/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_ids: orders,
          route_code: planRoute,
          vehicle_id: planVehicle || undefined,
          driver_id: planDriver || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to create delivery plan");
      setPlanModalOpen(false);
      loadData();
      if (data.delivery) setSelectedDeliveryId(data.delivery.id);
    } catch (err: any) {
      setToast({ text: err.message, tone: "error" });
    }
  }

  async function handleAssignVehicleDriver() {
    if (!selectedDelivery || !assignVehicleId || !assignDriverId) return;
    try {
      const res = await fetch("/api/v1/deliveries/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delivery_id: selectedDelivery.id,
          vehicle_id: assignVehicleId,
          driver_id: assignDriverId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to assign vehicle and driver");
      setAssignModalOpen(false);
      loadData();
    } catch (err: any) {
      setToast({ text: err.message, tone: "error" });
    }
  }

  async function handleSubmitInspection() {
    if (!inspectionVehicleId || !inspectionDriverId) return;
    try {
      const res = await fetch("/api/v1/deliveries/inspections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle_id: inspectionVehicleId,
          driver_id: inspectionDriverId,
          delivery_id: selectedDelivery?.id,
          cleanliness_passed: cleanlinessPassed,
          vehicle_condition_passed: conditionPassed,
          reefer_functioning: reeferFunctioning,
          chilled_temp_c: parseFloat(chilledTemp),
          frozen_temp_c: parseFloat(frozenTemp),
          compartment_dividers_secure: dividersSecure,
          load_capacity_valid: capacityValid,
          transport_documents_verified: docsVerified,
          driver_confirmed: driverConfirmed,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to submit inspection");
      setInspectionModalOpen(false);
      loadData();
      setToast({
        text: `Pre-loading inspection recorded: ${data.inspection.status.toUpperCase()}`,
        tone: "ok",
      });
    } catch (err: any) {
      setToast({ text: err.message, tone: "error" });
    }
  }

  async function handleScanLoading() {
    if (!selectedDelivery || !barcodeInput.trim()) return;
    try {
      setScanMessage(null);
      const res = await fetch(`/api/v1/deliveries/${selectedDelivery.id}/manifest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scanned_barcode: barcodeInput.trim(),
          compartment: scanCompartment,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setScanMessage({ text: data.error?.message || "Scanning failed", isError: true });
        return;
      }
      setScanMessage({ text: data.message, isError: false });
      setBarcodeInput("");
      loadData();
    } catch (err: any) {
      setScanMessage({ text: err.message, isError: true });
    }
  }

  function handleDispatchDelivery() {
    if (!selectedDelivery) return;
    setDispatchConfirmOpen(true);
  }

  async function confirmDispatchDelivery() {
    if (!selectedDelivery) return;
    setDispatchConfirmOpen(false);
    try {
      const res = await fetch(`/api/v1/deliveries/${selectedDelivery.id}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departure_time: new Date().toISOString() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to dispatch delivery");
      loadData();
      setToast({
        text: `Delivery ${selectedDelivery.id} dispatched! Driver status updated to on_route.`,
        tone: "ok",
      });
    } catch (err: any) {
      setToast({ text: err.message, tone: "error" });
    }
  }

  async function handleRecordTemp() {
    if (!selectedDelivery) return;
    try {
      const res = await fetch(`/api/v1/deliveries/${selectedDelivery.id}/temperature`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          compartment: tempCompartment,
          stage: tempStage,
          actual_temp_c: parseFloat(tempReading),
          notes: tempNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to log temperature");
      setTempModalOpen(false);
      loadData();
      if (data.log.is_excursion) {
        setToast({
          text: `WARNING: Cold chain excursion detected (${data.log.actual_temp_c}°C)! Hold applied.`,
          tone: "warning",
        });
      } else {
        setToast({ text: "Temperature recorded successfully.", tone: "ok" });
      }
    } catch (err: any) {
      setToast({ text: err.message, tone: "error" });
    }
  }

  async function handleRecordException() {
    if (!selectedDelivery || !excReason) return;
    try {
      const res = await fetch(`/api/v1/deliveries/${selectedDelivery.id}/exception`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exception_type: excType,
          reason: excReason,
          affected_cases: parseFloat(excCases) || 1,
          follow_up_action: excFollowUp,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to record exception");
      setExceptionModalOpen(false);
      loadData();
      setToast({
        text: `Delivery exception logged: ${data.exception.exception_type}`,
        tone: "ok",
      });
    } catch (err: any) {
      setToast({ text: err.message, tone: "error" });
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-surface/50 p-4">
        <div className="flex items-center gap-3">
          <Truck className="h-6 w-6 text-primary" />
          <div>
            <h2 className="text-base font-semibold">Delivery Control Tower</h2>
            <p className="text-xs text-muted-foreground">
              Module 09: Fleet Assignment, Multi-Temp Loading, Route Dispatch & POD
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
            onClick={() => loadData()}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </button>
          <button
            className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
            onClick={() => setPlanModalOpen(true)}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Plan Delivery
          </button>
          <button
            className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
            onClick={() => setInspectionModalOpen(true)}
          >
            <ClipboardList className="mr-1.5 h-3.5 w-3.5" /> Pre-Loading Inspection
          </button>
          <a
            href="/deliveries/driver"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center rounded-lg bg-marine-steel px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-marine-steel transition-colors"
          >
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Driver PWA View
          </a>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto whitespace-nowrap border-b border-border text-sm font-medium [-webkit-overflow-scrolling:touch]">
        <button
          onClick={() => setActiveTab("deliveries")}
          className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "deliveries"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Truck className="h-4 w-4" /> Active Deliveries ({deliveries.length})
        </button>
        <button
          onClick={() => setActiveTab("fleet")}
          className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "fleet"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Layers className="h-4 w-4" /> Fleet & Drivers ({vehicles.length} / {drivers.length})
        </button>
        <button
          onClick={() => setActiveTab("manifest")}
          className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "manifest"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <QrCode className="h-4 w-4" /> Loading Scanner & Manifest
        </button>
        <button
          onClick={() => setActiveTab("temperature")}
          className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "temperature"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Thermometer className="h-4 w-4" /> Cold Chain Telemetry
        </button>
        <button
          onClick={() => setActiveTab("pod")}
          className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "pod"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <CheckCircle2 className="h-4 w-4" /> POD & Exceptions
        </button>
      </div>

      {/* Tab 1: Active Deliveries */}
      {activeTab === "deliveries" && (
        <div className="grid gap-5 lg:grid-cols-3">
          {/* Deliveries List */}
          <div className="space-y-3 lg:col-span-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Delivery Queue
            </h3>
            {deliveries.length === 0 ? (
              <p className="rounded-lg border border-border p-4 text-center text-xs text-muted-foreground">
                No deliveries scheduled.
              </p>
            ) : (
              deliveries.map((d) => (
                <div
                  key={d.id}
                  onClick={() => setSelectedDeliveryId(d.id)}
                  className={`cursor-pointer rounded-xl border p-4 transition-all ${
                    selectedDelivery?.id === d.id
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border/80 bg-surface hover:border-border"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-primary">
                      {d.delivery_reference || d.id}
                    </span>
                    <Badge tone={statusTone(d.status)} dot>
                      {d.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <h4 className="mt-1 text-sm font-semibold text-foreground">{d.customer}</h4>
                  <p className="mt-0.5 text-xs text-muted-foreground">{d.delivery_address}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="rounded bg-muted/60 px-1.5 py-0.5 font-medium text-foreground">
                      {d.route_code}
                    </span>
                    <span>• {d.total_cases} cases</span>
                    <span>• {d.total_weight_kg.toFixed(1)} kg</span>
                    <span>• {d.driver || "Unassigned"}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Delivery Detail Panel */}
          <div className="lg:col-span-2">
            {selectedDelivery ? (
              <div className="rounded-xl border border-border/80 bg-surface p-5 space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-bold">{selectedDelivery.delivery_reference || selectedDelivery.id}</h3>
                      <Badge tone={statusTone(selectedDelivery.status)}>
                        {selectedDelivery.status.replace(/_/g, " ")}
                      </Badge>
                      {selectedDelivery.priority && (
                        <Badge tone={selectedDelivery.priority === "urgent" ? "critical" : "info"}>
                          {selectedDelivery.priority}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Linked Orders: {selectedDelivery.order_number}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedDelivery.status === "planned" && (
                      <button
                        className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                        onClick={() => {
                          setAssignVehicleId(selectedDelivery.vehicle_id || (vehicles[0]?.id ?? ""));
                          setAssignDriverId(selectedDelivery.driver_id || (drivers[0]?.id ?? ""));
                          setAssignModalOpen(true);
                        }}
                      >
                        <UserCheck className="mr-1.5 h-3.5 w-3.5" /> Assign Vehicle/Driver
                      </button>
                    )}
                    {(selectedDelivery.status === "assigned" || selectedDelivery.status === "ready_for_loading") && (
                      <button
                        className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                        onClick={() => setActiveTab("manifest")}
                      >
                        <QrCode className="mr-1.5 h-3.5 w-3.5" /> Open Loading Scanner
                      </button>
                    )}
                    {selectedDelivery.status === "loaded" && (
                      <Can permission="deliveries:update" mode="disable">
                        <button
                          className="inline-flex items-center justify-center rounded-lg bg-marine-steel px-3 py-1.5 text-xs font-semibold text-white hover:bg-marine-steel"
                          onClick={handleDispatchDelivery}
                        >
                          <Truck className="mr-1.5 h-3.5 w-3.5" /> Dispatch Vehicle
                        </button>
                      </Can>
                    )}
                    <button
                      className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
                      onClick={() => setTempModalOpen(true)}
                    >
                      <Thermometer className="mr-1.5 h-3.5 w-3.5" /> Log Temp
                    </button>
                    <button
                      className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
                      onClick={() => setExceptionModalOpen(true)}
                    >
                      <ShieldAlert className="mr-1.5 h-3.5 w-3.5" /> Log Exception
                    </button>
                  </div>
                </div>

                {/* Key Metrics */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                    <p className="text-[10px] uppercase font-semibold text-muted-foreground">Assigned Vehicle</p>
                    <p className="mt-1 text-sm font-bold text-foreground">
                      {selectedDelivery.vehicle || "Not Assigned"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                    <p className="text-[10px] uppercase font-semibold text-muted-foreground">Assigned Driver</p>
                    <p className="mt-1 text-sm font-bold text-foreground">
                      {selectedDelivery.driver || "Not Assigned"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                    <p className="text-[10px] uppercase font-semibold text-muted-foreground">Load Weight</p>
                    <p className="mt-1 text-sm font-bold text-foreground">
                      {selectedDelivery.total_weight_kg.toFixed(1)} kg ({selectedDelivery.total_cases} cases)
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                    <p className="text-[10px] uppercase font-semibold text-muted-foreground">Current Temp</p>
                    <p className="mt-1 text-sm font-bold text-foreground">
                      {selectedDelivery.temp_c ? `${selectedDelivery.temp_c.toFixed(1)}°C` : "N/A"}
                    </p>
                  </div>
                </div>

                {/* Exception banner if any */}
                {selectedDelivery.exception && (
                  <div className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold">Active Exception: </span>
                      {selectedDelivery.exception}
                    </div>
                  </div>
                )}

                {/* Delivery Stops */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Stop Sequence
                  </h4>
                  <div className="space-y-2">
                    {selectedDelivery.stops && selectedDelivery.stops.length > 0 ? (
                      selectedDelivery.stops.map((stop) => (
                        <div
                          key={stop.id}
                          className="flex items-center justify-between rounded-lg border border-border p-3 text-xs"
                        >
                          <div className="flex items-center gap-3">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">
                              {stop.stop_number}
                            </span>
                            <div>
                              <p className="font-semibold text-foreground">{stop.customer_name}</p>
                              <p className="text-muted-foreground text-[11px]">{stop.delivery_address}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-muted-foreground">
                              {stop.time_window_start} - {stop.time_window_end}
                            </span>
                            <Badge tone={statusTone(stop.stop_status)} dot>
                              {stop.stop_status}
                            </Badge>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-lg border border-border p-3 text-xs">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-foreground">{selectedDelivery.customer}</p>
                            <p className="text-muted-foreground text-[11px]">{selectedDelivery.delivery_address}</p>
                          </div>
                          <Badge tone="ok" dot>Stop 1</Badge>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
                Select a delivery from the queue to view details.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Fleet & Drivers */}
      {activeTab === "fleet" && (
        <div className="space-y-5">
          {/* Vehicles */}
          <div className="surface overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <h3 className="text-sm font-semibold">Active Vehicle Fleet</h3>
              <Badge tone="info">{vehicles.length} vehicles</Badge>
            </div>
            <div className="table-shell">
              <table className="table-fit" style={{ minWidth: "640px" }}>
                <thead>
                  <tr>
                    <th>Registration</th>
                    <th>Vehicle</th>
                    <th>Status</th>
                    <th>Payload (kg)</th>
                    <th>Pallets</th>
                    <th>Temp</th>
                    <th>Inspection</th>
                    <th>ATP Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {vehicles.length === 0 && (
                    <tr><td colSpan={8} className="py-6 text-center text-xs text-muted-foreground">No vehicles found.</td></tr>
                  )}
                  {vehicles.map((v) => (
                    <tr key={v.id}>
                      <td className="font-mono text-xs font-bold text-primary">{v.registration_number}</td>
                      <td className="font-medium">{v.vehicle_name}</td>
                      <td>
                        <Badge tone={v.status === "active" ? "ok" : "warning"} dot>
                          {v.status}
                        </Badge>
                      </td>
                      <td>{v.max_payload_kg}</td>
                      <td>{v.max_pallets}</td>
                      <td className="text-muted-foreground">{v.temperature_capability}</td>
                      <td className={v.inspection_status === "passed" ? "text-marine-mid font-semibold" : "text-amber-500 font-semibold"}>
                        {v.inspection_status}
                      </td>
                      <td className="text-muted-foreground">{v.atp_expiry_date || "N/A"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Drivers */}
          <div className="surface overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <h3 className="text-sm font-semibold">Driver Roster</h3>
              <Badge tone="info">{drivers.length} drivers</Badge>
            </div>
            <div className="table-shell">
              <table className="table-fit" style={{ minWidth: "720px" }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Status</th>
                    <th>Licence</th>
                    <th>Expiry</th>
                    <th>Assigned Route</th>
                    <th>Hub</th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.length === 0 && (
                    <tr><td colSpan={8} className="py-6 text-center text-xs text-muted-foreground">No drivers found.</td></tr>
                  )}
                  {drivers.map((d) => (
                    <tr key={d.id}>
                      <td className="font-semibold">{d.name}</td>
                      <td className="text-muted-foreground">{d.email}</td>
                      <td className="text-muted-foreground">{d.phone}</td>
                      <td>
                        <Badge tone={d.status === "available" ? "ok" : "info"} dot>
                          {d.status}
                        </Badge>
                      </td>
                      <td>{d.license_type} ({d.license_number})</td>
                      <td className="text-muted-foreground">{d.license_expiry_date}</td>
                      <td>{d.current_route_code || "None"}</td>
                      <td className="text-muted-foreground">{d.warehouse}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Manifest & Barcode Scanner */}
      {activeTab === "manifest" && (
        <div className="space-y-4">
          {selectedDelivery ? (
            <div className="rounded-xl border border-border bg-surface p-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
                <div>
                  <h3 className="text-base font-bold">
                    Vehicle Loading Manifest: {selectedDelivery.delivery_reference} ({selectedDelivery.vehicle})
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Scan pallet and carton SSCC-18 barcodes to verify package loading and temperature segregation.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="info">
                    {selectedDelivery.manifest_items?.filter((i) => i.is_scanned_loaded).length || 0} /{" "}
                    {selectedDelivery.manifest_items?.length || 0} Packages Loaded
                  </Badge>
                </div>
              </div>

              {/* Barcode Scanner Input */}
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="w-full min-w-0 sm:w-auto sm:min-w-[240px] sm:flex-1">
                    <label className="text-xs font-semibold">Scan Barcode / SSCC-18 / SKU</label>
                    <div className="mt-1 flex gap-2">
                      <input
                        type="text"
                        value={barcodeInput}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBarcodeInput(e.target.value)}
                        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                          if (e.key === "Enter") handleScanLoading();
                        }}
                        placeholder="Scan SSCC barcode, container ID, or SKU..."
                        className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
                      />
                      <Can permission="deliveries:update" mode="disable">
                        <button
                          onClick={handleScanLoading}
                          className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 whitespace-nowrap"
                        >
                          Verify & Load
                        </button>
                      </Can>
                    </div>
                  </div>
                  <div className="w-full sm:w-48">
                    <label className="text-xs font-semibold">Target Compartment</label>
                    <select
                      value={scanCompartment}
                      onChange={(e) => setScanCompartment(e.target.value as any)}
                      className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-xs"
                    >
                      <option value="chilled">Chilled Compartment (0-4°C)</option>
                      <option value="frozen">Frozen Compartment (-18°C)</option>
                      <option value="ambient">Ambient Compartment</option>
                    </select>
                  </div>
                </div>

                {scanMessage && (
                  <div
                    className={`rounded-lg p-2.5 text-xs font-medium ${
                      scanMessage.isError
                        ? "border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
                        : "border border-marine-ocean/60 bg-marine-steel/10 text-marine-mid dark:text-marine-mid"
                    }`}
                  >
                    {scanMessage.text}
                  </div>
                )}
              </div>

              {/* Manifest Items Table */}
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50 text-muted-foreground uppercase text-[10px] font-semibold">
                    <tr>
                      <th className="px-3 py-2.5">Seq</th>
                      <th className="px-3 py-2.5">Package SSCC / ID</th>
                      <th className="px-3 py-2.5">Product & SKU</th>
                      <th className="px-3 py-2.5">Lot / Batch</th>
                      <th className="px-3 py-2.5">Cases</th>
                      <th className="px-3 py-2.5">Weight (kg)</th>
                      <th className="px-3 py-2.5">Compartment</th>
                      <th className="px-3 py-2.5">Loading Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {selectedDelivery.manifest_items && selectedDelivery.manifest_items.length > 0 ? (
                      selectedDelivery.manifest_items.map((item) => (
                        <tr key={item.id} className={item.is_scanned_loaded ? "bg-marine-steel/5" : ""}>
                          <td className="px-3 py-2 font-mono">{item.loading_sequence}</td>
                          <td className="px-3 py-2 font-mono font-medium text-primary">
                            {item.sscc_barcode || item.container_id || "N/A"}
                          </td>
                          <td className="px-3 py-2">
                            <span className="font-semibold text-foreground">{item.product_name}</span>
                            <span className="ml-1 text-[11px] text-muted-foreground">({item.sku})</span>
                          </td>
                          <td className="px-3 py-2 font-mono">{item.lot_batch}</td>
                          <td className="px-3 py-2 font-medium">{item.cases}</td>
                          <td className="px-3 py-2 font-medium">{item.weight_kg.toFixed(1)}</td>
                          <td className="px-3 py-2">
                            <Badge tone={item.compartment === "frozen" ? "info" : "warning"}>
                              {item.compartment}
                            </Badge>
                          </td>
                          <td className="px-3 py-2">
                            {item.is_scanned_loaded ? (
                              <Badge tone="ok" dot>Loaded</Badge>
                            ) : (
                              <Badge tone="neutral" dot>Pending Scan</Badge>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={8} className="p-4 text-center text-muted-foreground">
                          No manifest items found for this delivery.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-center text-xs text-muted-foreground">Please select a delivery first.</p>
          )}
        </div>
      )}

      {/* Tab 4: Cold Chain Telemetry */}
      {activeTab === "temperature" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Cold Chain Temperature Logs</h3>
            <button
              className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              onClick={() => setTempModalOpen(true)}
            >
              <Thermometer className="mr-1.5 h-3.5 w-3.5" /> Log Reading
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/50 text-muted-foreground uppercase text-[10px] font-semibold">
                <tr>
                  <th className="px-3 py-2.5">Timestamp</th>
                  <th className="px-3 py-2.5">Vehicle / Delivery</th>
                  <th className="px-3 py-2.5">Compartment</th>
                  <th className="px-3 py-2.5">Stage</th>
                  <th className="px-3 py-2.5">Allowed Range</th>
                  <th className="px-3 py-2.5">Actual Temp</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Recorded By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {selectedDelivery?.temperature_logs && selectedDelivery.temperature_logs.length > 0 ? (
                  selectedDelivery.temperature_logs.map((log) => (
                    <tr key={log.id} className={log.is_excursion ? "bg-red-500/10" : ""}>
                      <td className="px-3 py-2 text-muted-foreground">{log.recorded_at}</td>
                      <td className="px-3 py-2 font-mono font-medium">{log.vehicle_registration || selectedDelivery.vehicle}</td>
                      <td className="px-3 py-2 capitalize">{log.compartment}</td>
                      <td className="px-3 py-2 capitalize">{log.stage.replace(/_/g, " ")}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {log.expected_temp_min_c}°C to {log.expected_temp_max_c}°C
                      </td>
                      <td className="px-3 py-2 font-bold font-mono">
                        {log.actual_temp_c.toFixed(1)}°C
                      </td>
                      <td className="px-3 py-2">
                        {log.is_excursion ? (
                          <Badge tone="critical" dot>EXCURSION ({log.excursion_severity})</Badge>
                        ) : (
                          <Badge tone="ok" dot>Normal</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{log.recorded_by_name}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="p-4 text-center text-muted-foreground">
                      No temperature logs recorded for this delivery yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 5: Proof of Delivery (POD) & Exceptions */}
      {activeTab === "pod" && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* POD Information */}
          <div className="space-y-4 rounded-xl border border-border bg-surface p-5">
            <h3 className="text-base font-bold flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-marine-mid" /> Proof of Delivery (POD)
            </h3>
            {selectedDelivery?.proof_of_delivery ? (
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-3">
                  <div>
                    <span className="text-muted-foreground">Recipient Name:</span>
                    <p className="font-semibold text-foreground">{selectedDelivery.proof_of_delivery.recipient_name}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Role:</span>
                    <p className="font-semibold text-foreground">{selectedDelivery.proof_of_delivery.recipient_role || "Receiving Staff"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Delivered / Accepted:</span>
                    <p className="font-semibold text-foreground">
                      {selectedDelivery.proof_of_delivery.delivered_cases} delivered, {selectedDelivery.proof_of_delivery.accepted_cases} accepted
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Timestamp:</span>
                    <p className="font-semibold text-foreground">{selectedDelivery.proof_of_delivery.captured_at}</p>
                  </div>
                </div>

                <div>
                  <span className="text-xs font-semibold text-muted-foreground">Digital Signature Confirmation:</span>
                  <div className="mt-1.5 rounded-lg border border-border bg-white p-3 dark:bg-zinc-900">
                    {selectedDelivery.proof_of_delivery.signature_data.startsWith("data:image") ? (
                      <img
                        src={selectedDelivery.proof_of_delivery.signature_data}
                        alt="Customer Signature"
                        className="max-h-24 mx-auto"
                      />
                    ) : (
                      <p className="font-mono text-center text-xs font-bold text-foreground">
                        {selectedDelivery.proof_of_delivery.signature_data}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Proof of Delivery has not been captured yet for this delivery.
              </p>
            )}
          </div>

          {/* Exceptions List */}
          <div className="space-y-4 rounded-xl border border-border bg-surface p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-amber-500" /> Delivery Exceptions
              </h3>
              <button
                className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted"
                onClick={() => setExceptionModalOpen(true)}
              >
                <Plus className="mr-1 h-3 w-3" /> Log Exception
              </button>
            </div>
            {selectedDelivery?.exceptions && selectedDelivery.exceptions.length > 0 ? (
              <div className="space-y-2.5">
                {selectedDelivery.exceptions.map((exc) => (
                  <div key={exc.id} className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold uppercase tracking-wider text-red-600 dark:text-red-400">
                        {exc.exception_type.replace(/_/g, " ")}
                      </span>
                      <Badge tone={exc.severity === "critical" ? "critical" : "warning"}>
                        {exc.severity}
                      </Badge>
                    </div>
                    <p className="mt-1 text-foreground">{exc.reason}</p>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>Action: <span className="font-semibold text-foreground">{exc.follow_up_action.replace(/_/g, " ")}</span></span>
                      <span>By {exc.driver_name} at {exc.reported_at}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-6 text-center text-xs text-muted-foreground">
                No exceptions reported for this delivery.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Plan Delivery Modal */}
      {planModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="plan-modal-title"
            className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl sm:max-h-[90vh] sm:max-w-lg sm:rounded-xl sm:p-6"
          >
            <div className="flex items-center justify-between border-b border-border px-4 pb-3 pt-4 sm:px-0 sm:pt-0">
              <h3 id="plan-modal-title" className="text-base font-bold">Generate New Delivery Plan</h3>
              <button
                onClick={() => setPlanModalOpen(false)}
                aria-label="Close"
                className="flex min-h-11 min-w-11 items-center justify-center text-muted-foreground hover:text-foreground sm:min-h-0 sm:min-w-0"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4 text-xs sm:px-0 sm:pb-0">
              <div>
                <label className="font-semibold">Packed Order IDs (comma separated)</label>
                <input
                  type="text"
                  value={planOrders}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPlanOrders(e.target.value)}
                  placeholder="e.g. SO-2026-9841, SO-2026-9842"
                  className="mt-1 w-full rounded-md border border-border bg-background p-2 text-xs"
                />
              </div>
              <div>
                <label className="font-semibold">Route Code</label>
                <input
                  type="text"
                  value={planRoute}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPlanRoute(e.target.value)}
                  placeholder="e.g. RT-MIL-N1"
                  className="mt-1 w-full rounded-md border border-border bg-background p-2 text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold">Vehicle (optional)</label>
                  <select
                    value={planVehicle}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPlanVehicle(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background p-2"
                  >
                    <option value="">Unassigned</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.registration_number} ({v.vehicle_name})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-semibold">Driver (optional)</label>
                  <select
                    value={planDriver}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPlanDriver(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background p-2"
                  >
                    <option value="">Unassigned</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.license_type})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="sticky bottom-0 z-10 flex justify-end gap-2 border-t border-border bg-card pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:pb-0">
                <button
                  type="button"
                  onClick={() => setPlanModalOpen(false)}
                  className="min-h-11 rounded border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted sm:min-h-0"
                >
                  Cancel
                </button>
                <Can permission="deliveries:update" mode="disable">
                  <button
                    type="button"
                    onClick={handlePlanDelivery}
                    className="min-h-11 rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 sm:min-h-0"
                  >
                    Create Plan
                  </button>
                </Can>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assign Vehicle & Driver Modal */}
      {assignModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="assign-modal-title"
            className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl sm:max-h-[90vh] sm:max-w-lg sm:rounded-xl sm:p-6"
          >
            <div className="flex items-center justify-between border-b border-border px-4 pb-3 pt-4 sm:px-0 sm:pt-0">
              <h3 id="assign-modal-title" className="text-base font-bold">Assign Vehicle & Driver</h3>
              <button
                onClick={() => setAssignModalOpen(false)}
                aria-label="Close"
                className="flex min-h-11 min-w-11 items-center justify-center text-muted-foreground hover:text-foreground sm:min-h-0 sm:min-w-0"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4 text-xs sm:px-0 sm:pb-0">
              <div>
                <label className="font-semibold">Select Vehicle</label>
                <select
                  value={assignVehicleId}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setAssignVehicleId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-background p-2"
                >
                  <option value="">Choose vehicle...</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.registration_number} - {v.vehicle_name} (Max: {v.max_payload_kg} kg, {v.temperature_capability})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="font-semibold">Select Driver</label>
                <select
                  value={assignDriverId}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setAssignDriverId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-background p-2"
                >
                  <option value="">Choose driver...</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.license_type}, {d.status})
                    </option>
                  ))}
                </select>
              </div>
              <div className="sticky bottom-0 z-10 flex justify-end gap-2 border-t border-border bg-card pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:pb-0">
                <button
                  type="button"
                  onClick={() => setAssignModalOpen(false)}
                  className="min-h-11 rounded border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted sm:min-h-0"
                >
                  Cancel
                </button>
                <Can permission="deliveries:update" mode="disable">
                  <button
                    type="button"
                    onClick={handleAssignVehicleDriver}
                    className="min-h-11 rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 sm:min-h-0"
                  >
                    Confirm Assignment
                  </button>
                </Can>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pre-Loading Inspection Modal */}
      {inspectionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="inspection-modal-title"
            className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl sm:max-h-[90vh] sm:max-w-lg sm:rounded-xl sm:p-6"
          >
            <div className="flex items-center justify-between border-b border-border px-4 pb-3 pt-4 sm:px-0 sm:pt-0">
              <h3 id="inspection-modal-title" className="text-base font-bold">Pre-Loading Vehicle Safety Inspection</h3>
              <button
                onClick={() => setInspectionModalOpen(false)}
                aria-label="Close"
                className="flex min-h-11 min-w-11 items-center justify-center text-muted-foreground hover:text-foreground sm:min-h-0 sm:min-w-0"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 space-y-3.5 overflow-y-auto px-4 pb-4 text-xs sm:px-0 sm:pb-0">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold">Vehicle</label>
                  <select
                    value={inspectionVehicleId}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setInspectionVehicleId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background p-2"
                  >
                    <option value="">Select vehicle...</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>{v.registration_number} ({v.vehicle_name})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-semibold">Driver</label>
                  <select
                    value={inspectionDriverId}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setInspectionDriverId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background p-2"
                  >
                    <option value="">Select driver...</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded-lg border border-border p-3 space-y-2.5">
                <p className="font-semibold text-foreground">Safety & Temperature Checklist</p>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={cleanlinessPassed} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCleanlinessPassed(e.target.checked)} />
                  <span>Cargo compartment sanitized and clean (HACCP compliant)</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={conditionPassed} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConditionPassed(e.target.checked)} />
                  <span>Vehicle physical condition, tires, door seals verified</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={reeferFunctioning} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReeferFunctioning(e.target.checked)} />
                  <span>Refrigeration unit operating normally</span>
                </label>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <label className="text-[11px] text-muted-foreground">Chilled Temp (°C, max 4.0)</label>
                    <input
                      type="text"
                      value={chilledTemp}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setChilledTemp(e.target.value)}
                      className="mt-0.5 w-full rounded border border-border bg-background p-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Frozen Temp (°C, max -15.0)</label>
                    <input
                      type="text"
                      value={frozenTemp}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFrozenTemp(e.target.value)}
                      className="mt-0.5 w-full rounded border border-border bg-background p-1.5 text-xs"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 pt-1">
                  <input type="checkbox" checked={dividersSecure} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDividersSecure(e.target.checked)} />
                  <span>Multi-temp movable bulkhead dividers secure</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={capacityValid} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCapacityValid(e.target.checked)} />
                  <span>Load weight and pallet count within vehicle limits</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={docsVerified} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDocsVerified(e.target.checked)} />
                  <span>Transport documents (DDT / CMR) verified</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={driverConfirmed} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDriverConfirmed(e.target.checked)} />
                  <span>Driver confirms inspection checklist</span>
                </label>
              </div>

              <div className="sticky bottom-0 z-10 flex justify-end gap-2 border-t border-border bg-card pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:pb-0">
                <button
                  type="button"
                  onClick={() => setInspectionModalOpen(false)}
                  className="min-h-11 rounded border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted sm:min-h-0"
                >
                  Cancel
                </button>
                <Can permission="deliveries:update" mode="disable">
                  <button
                    type="button"
                    onClick={handleSubmitInspection}
                    className="min-h-11 rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 sm:min-h-0"
                  >
                    Submit Inspection
                  </button>
                </Can>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Temperature Modal */}
      {tempModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="temp-modal-title"
            className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl sm:max-h-[90vh] sm:max-w-lg sm:rounded-xl sm:p-6"
          >
            <div className="flex items-center justify-between border-b border-border px-4 pb-3 pt-4 sm:px-0 sm:pt-0">
              <h3 id="temp-modal-title" className="text-base font-bold">Log Transport Temperature</h3>
              <button
                onClick={() => setTempModalOpen(false)}
                aria-label="Close"
                className="flex min-h-11 min-w-11 items-center justify-center text-muted-foreground hover:text-foreground sm:min-h-0 sm:min-w-0"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4 text-xs sm:px-0 sm:pb-0">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold">Compartment</label>
                  <select
                    value={tempCompartment}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTempCompartment(e.target.value as any)}
                    className="mt-1 w-full rounded-md border border-border bg-background p-2"
                  >
                    <option value="chilled">Chilled (0 - 4°C)</option>
                    <option value="frozen">Frozen (-25 - -15°C)</option>
                    <option value="ambient">Ambient (10 - 22°C)</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold">Transport Stage</label>
                  <select
                    value={tempStage}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTempStage(e.target.value as any)}
                    className="mt-1 w-full rounded-md border border-border bg-background p-2"
                  >
                    <option value="pre_loading">Pre-Loading</option>
                    <option value="post_loading">Post-Loading</option>
                    <option value="in_transit">In Transit</option>
                    <option value="arrival">Arrival at Customer</option>
                    <option value="delivery">Final Handover</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="font-semibold">Actual Temperature Reading (°C)</label>
                <input
                  type="text"
                  value={tempReading}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTempReading(e.target.value)}
                  placeholder="e.g. 2.8"
                  className="mt-1 w-full rounded-md border border-border bg-background p-2 font-mono text-sm"
                />
              </div>
              <div>
                <label className="font-semibold">Notes</label>
                <input
                  type="text"
                  value={tempNotes}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTempNotes(e.target.value)}
                  placeholder="Optional telemetry note..."
                  className="mt-1 w-full rounded-md border border-border bg-background p-2 text-xs"
                />
              </div>
              <div className="sticky bottom-0 z-10 flex justify-end gap-2 border-t border-border bg-card pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:pb-0">
                <button
                  type="button"
                  onClick={() => setTempModalOpen(false)}
                  className="min-h-11 rounded border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted sm:min-h-0"
                >
                  Cancel
                </button>
                <Can permission="deliveries:update" mode="disable">
                  <button
                    type="button"
                    onClick={handleRecordTemp}
                    className="min-h-11 rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 sm:min-h-0"
                  >
                    Record Reading
                  </button>
                </Can>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Exception Modal */}
      {exceptionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="exception-modal-title"
            className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl sm:max-h-[90vh] sm:max-w-lg sm:rounded-xl sm:p-6"
          >
            <div className="flex items-center justify-between border-b border-border px-4 pb-3 pt-4 sm:px-0 sm:pt-0">
              <h3 id="exception-modal-title" className="text-base font-bold">Record Delivery Exception</h3>
              <button
                onClick={() => setExceptionModalOpen(false)}
                aria-label="Close"
                className="flex min-h-11 min-w-11 items-center justify-center text-muted-foreground hover:text-foreground sm:min-h-0 sm:min-w-0"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4 text-xs sm:px-0 sm:pb-0">
              <div>
                <label className="font-semibold">Exception Type</label>
                <select
                  value={excType}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setExcType(e.target.value as any)}
                  className="mt-1 w-full rounded-md border border-border bg-background p-2"
                >
                  <option value="customer_unavailable">Customer Unavailable / Closed</option>
                  <option value="delivery_refused">Delivery Refused by Recipient</option>
                  <option value="damaged_goods">Damaged Goods in Transit</option>
                  <option value="missing_quantity">Missing Quantity Discrepancy</option>
                  <option value="temperature_excursion">Temperature Excursion Breach</option>
                  <option value="incorrect_product">Incorrect Product / Barcode</option>
                  <option value="access_issue">Dock Access Issue / Traffic Obstruction</option>
                  <option value="partial_delivery">Partial Delivery Accepted</option>
                </select>
              </div>
              <div>
                <label className="font-semibold">Reason & Observations</label>
                <input
                  type="text"
                  value={excReason}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExcReason(e.target.value)}
                  placeholder="Detailed reason for delivery exception..."
                  className="mt-1 w-full rounded-md border border-border bg-background p-2 text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold">Affected Cases</label>
                  <input
                    type="text"
                    value={excCases}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExcCases(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="font-semibold">Follow-Up Action</label>
                  <select
                    value={excFollowUp}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setExcFollowUp(e.target.value as any)}
                    className="mt-1 w-full rounded-md border border-border bg-background p-2"
                  >
                    <option value="return_to_warehouse">Return to Warehouse</option>
                    <option value="redeliver">Schedule Redelivery</option>
                    <option value="credit_note">Issue Credit Note</option>
                    <option value="quarantine">Quarantine at Hub</option>
                  </select>
                </div>
              </div>
              <div className="sticky bottom-0 z-10 flex justify-end gap-2 border-t border-border bg-card pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:pb-0">
                <button
                  type="button"
                  onClick={() => setExceptionModalOpen(false)}
                  className="min-h-11 rounded border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted sm:min-h-0"
                >
                  Cancel
                </button>
                <Can permission="deliveries:update" mode="disable">
                  <button
                    type="button"
                    onClick={handleRecordException}
                    className="min-h-11 rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 sm:min-h-0"
                  >
                    Submit Exception
                  </button>
                </Can>
              </div>
            </div>
          </div>
        </div>
      )}

      {dispatchConfirmOpen && selectedDelivery && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm delivery dispatch"
            className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-border bg-card p-4 shadow-xl sm:rounded-xl sm:p-5"
          >
            <h3 className="text-sm font-bold">Dispatch delivery?</h3>
            <p className="mt-2 text-xs text-muted-foreground">
              Dispatch {selectedDelivery.id} on route {selectedDelivery.route_code}? The driver status will be
              updated to on_route.
            </p>
            <div className="sticky bottom-0 mt-4 flex flex-col gap-2 border-t border-border bg-card pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:justify-end sm:pb-0">
              <button
                type="button"
                onClick={() => setDispatchConfirmOpen(false)}
                className="min-h-11 w-full rounded border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted sm:min-h-0 sm:w-auto"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDispatchDelivery}
                className="min-h-11 w-full rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 sm:min-h-0 sm:w-auto"
              >
                Dispatch now
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 right-4 z-[80] rounded-lg border px-4 py-3 text-xs font-medium shadow-lg sm:bottom-5 sm:left-auto sm:right-5 sm:max-w-sm ${
            toast.tone === "error"
              ? "border-red-500/40 bg-red-50 text-red-700"
              : toast.tone === "warning"
                ? "border-amber-500/40 bg-amber-50 text-amber-800"
                : "border-marine-ocean/60 bg-card text-foreground"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
