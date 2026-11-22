"use client";

import { useState, useEffect, useRef } from "react";
import {
  Truck,
  Wifi,
  WifiOff,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  QrCode,
  Thermometer,
  ShieldAlert,
  ChevronRight,
  User,
  PenTool,
  Clock,
  Layers,
} from "lucide-react";
import { Badge, statusTone } from "@/components/ui";
import { Can } from "@/components/access-gate";
import type { DetailedDelivery, DeliveryStop } from "@/lib/types";

interface QueuedAction {
  sync_action_id: string;
  idempotency_key: string;
  action_type:
    | "SUBMIT_INSPECTION"
    | "LOG_TEMPERATURE"
    | "SCAN_MANIFEST"
    | "START_TRANSIT"
    | "ARRIVE_STOP"
    | "SUBMIT_POD"
    | "REPORT_EXCEPTION";
  payload: any;
  device_timestamp: string;
  label: string;
}

export function DriverPwa() {
  const [deliveries, setDeliveries] = useState<DetailedDelivery[]>([]);
  const [activeDelivery, setActiveDelivery] = useState<DetailedDelivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [queue, setQueue] = useState<QueuedAction[]>([]);
  const [activeTab, setActiveTab] = useState<"stops" | "inspection" | "loading" | "temperature" | "pod">("stops");

  // Inspection state
  const [inspCleanliness, setInspCleanliness] = useState(true);
  const [inspCondition, setInspCondition] = useState(true);
  const [inspReefer, setInspReefer] = useState(true);
  const [inspChilledTemp, setInspChilledTemp] = useState("2.2");
  const [inspFrozenTemp, setInspFrozenTemp] = useState("-18.5");
  const [inspDividers, setInspDividers] = useState(true);
  const [inspCapacity, setInspCapacity] = useState(true);
  const [inspDocs, setInspDocs] = useState(true);
  const [inspDriverConfirmed, setInspDriverConfirmed] = useState(true);

  // Scan state
  const [barcodeScan, setBarcodeScan] = useState("");
  const [scanResult, setScanResult] = useState<{ text: string; error?: boolean } | null>(null);

  // Temp state
  const [tempComp, setTempComp] = useState<"chilled" | "frozen" | "ambient">("chilled");
  const [tempVal, setTempVal] = useState("2.8");
  const [tempAlert, setTempAlert] = useState<string | null>(null);

  // POD Canvas state
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [recipientRole, setRecipientRole] = useState("Store Manager / Chef");
  const [acceptedCases, setAcceptedCases] = useState("8");
  const [rejectedCases, setRejectedCases] = useState("0");
  const [podNotes, setPodNotes] = useState("");

  // Exception modal
  const [excOpen, setExcOpen] = useState(false);
  const [excType, setExcType] = useState("damaged_goods");
  const [excReason, setExcReason] = useState("");
  const [excCases, setExcCases] = useState("1");
  const [excAction, setExcAction] = useState("return_to_warehouse");

  // Load offline queue from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ascentra_driver_offline_queue");
      if (saved) {
        setQueue(JSON.parse(saved));
      }
    } catch {
      // ignore
    }

    // Network status listener
    const handleOnline = () => {
      setIsOnline(true);
      triggerSync();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    loadDeliveries();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Save offline queue
  useEffect(() => {
    try {
      localStorage.setItem("ascentra_driver_offline_queue", JSON.stringify(queue));
    } catch {
      // ignore
    }
  }, [queue]);

  async function loadDeliveries() {
    try {
      setLoading(true);
      const res = await fetch("/api/v1/deliveries/plan");
      const data = await res.json();
      if (data.deliveries && data.deliveries.length > 0) {
        setDeliveries(data.deliveries);
        setActiveDelivery(data.deliveries[0]);
        setAcceptedCases(String(data.deliveries[0].total_cases || 8));
      }
    } catch (e) {
      console.error("Failed to load driver deliveries", e);
    } finally {
      setLoading(false);
    }
  }

  function queueAction(action: Omit<QueuedAction, "sync_action_id" | "idempotency_key" | "device_timestamp">) {
    const fullAction: QueuedAction = {
      ...action,
      sync_action_id: `SYNC-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      idempotency_key: `IDEMP-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      device_timestamp: new Date().toISOString(),
    };
    setQueue((prev) => [...prev, fullAction]);

    // If online, attempt instant sync
    if (isOnline) {
      setTimeout(() => triggerSync(), 100);
    } else {
      alert(`Offline mode: Action "${fullAction.label}" queued locally.`);
    }
  }

  async function triggerSync() {
    if (queue.length === 0 || syncing) return;
    try {
      setSyncing(true);
      const res = await fetch("/api/v1/deliveries/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actions: queue }),
      });
      const data = await res.json();
      if (res.ok) {
        setQueue([]);
        localStorage.removeItem("ascentra_driver_offline_queue");
        loadDeliveries();
      }
    } catch (e) {
      console.error("Failed to sync offline queue", e);
    } finally {
      setSyncing(false);
    }
  }

  // Canvas drawing handlers
  function startDraw(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    setIsDrawing(true);
    setHasSignature(true);
    const rect = canvas.getBoundingClientRect();
    const x = "touches" in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = "touches" in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function draw(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = "touches" in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = "touches" in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#2D5B75"; // Marine steel ink
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function stopDraw() {
    setIsDrawing(false);
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  }

  // Pre-loading inspection submission
  function handleInspectionSubmit() {
    if (!activeDelivery) return;
    queueAction({
      action_type: "SUBMIT_INSPECTION",
      label: "Vehicle Pre-Trip Inspection",
      payload: {
        vehicle_id: activeDelivery.vehicle_id || "VEH-001",
        driver_id: activeDelivery.driver_id || "DRV-001",
        delivery_id: activeDelivery.id,
        cleanliness_passed: inspCleanliness,
        vehicle_condition_passed: inspCondition,
        reefer_functioning: inspReefer,
        chilled_temp_c: parseFloat(inspChilledTemp),
        frozen_temp_c: parseFloat(inspFrozenTemp),
        compartment_dividers_secure: inspDividers,
        load_capacity_valid: inspCapacity,
        transport_documents_verified: inspDocs,
        driver_confirmed: inspDriverConfirmed,
      },
    });
    alert("Inspection recorded and queued!");
  }

  // Loading scan verification
  function handleScanPackage() {
    if (!activeDelivery || !barcodeScan.trim()) return;
    queueAction({
      action_type: "SCAN_MANIFEST",
      label: `Scan Package: ${barcodeScan.trim()}`,
      payload: {
        delivery_id: activeDelivery.id,
        scanned_barcode: barcodeScan.trim(),
        compartment: "chilled",
      },
    });
    setScanResult({ text: `Queued scan for barcode ${barcodeScan.trim()}` });
    setBarcodeScan("");
  }

  // Log temperature
  function handleLogTemp() {
    if (!activeDelivery) return;
    const val = parseFloat(tempVal);
    let isExc = false;
    if (tempComp === "chilled" && (val < 0 || val > 4)) isExc = true;
    if (tempComp === "frozen" && val > -15) isExc = true;

    if (isExc) {
      setTempAlert(`EXCURSION WARNING: ${val}°C exceeds permitted ${tempComp} limits!`);
    } else {
      setTempAlert(null);
    }

    queueAction({
      action_type: "LOG_TEMPERATURE",
      label: `Temp Log: ${val}°C (${tempComp})`,
      payload: {
        delivery_id: activeDelivery.id,
        compartment: tempComp,
        stage: "in_transit",
        actual_temp_c: val,
      },
    });
    alert(`Temperature ${val}°C queued.`);
  }

  // Submit POD
  function handleSubmitPod() {
    if (!activeDelivery) return;
    if (!recipientName.trim()) {
      alert("Please enter recipient name.");
      return;
    }
    const canvas = canvasRef.current;
    const signatureData = canvas ? canvas.toDataURL("image/png") : "DATA:SIGNATURE_CONFIRMED";

    queueAction({
      action_type: "SUBMIT_POD",
      label: `POD: ${recipientName} (${activeDelivery.delivery_reference})`,
      payload: {
        delivery_id: activeDelivery.id,
        order_number: activeDelivery.order_number,
        customer_name: activeDelivery.customer,
        recipient_name: recipientName.trim(),
        recipient_role: recipientRole,
        signature_data: signatureData,
        delivered_cases: parseFloat(acceptedCases) + parseFloat(rejectedCases),
        accepted_cases: parseFloat(acceptedCases),
        rejected_cases: parseFloat(rejectedCases),
        delivery_notes: podNotes,
      },
    });
    alert("Proof of delivery signed and queued for sync!");
  }

  // Submit Exception
  function handleSubmitException() {
    if (!activeDelivery || !excReason.trim()) return;
    queueAction({
      action_type: "REPORT_EXCEPTION",
      label: `Exception: ${excType}`,
      payload: {
        delivery_id: activeDelivery.id,
        exception_type: excType,
        reason: excReason.trim(),
        affected_cases: parseFloat(excCases) || 1,
        follow_up_action: excAction,
      },
    });
    setExcOpen(false);
    alert("Exception logged and queued!");
  }

  return (
    <div className="mx-auto max-w-md space-y-4 pb-12 pt-2 px-2 text-foreground">
      {/* Mobile Header */}
      <div className="rounded-2xl border border-border/80 bg-surface/90 p-4 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-sm font-bold">Ascentra Driver PWA</h1>
              <p className="text-[11px] text-muted-foreground">
                {activeDelivery?.driver || "Davide Galli"} • {activeDelivery?.vehicle || "IVECO-FRIGO-08"}
              </p>
            </div>
          </div>
          {/* Online / Offline status & Sync */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setIsOnline(!isOnline)}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                isOnline
                  ? "bg-marine-steel/10 text-marine-mid dark:text-marine-mid"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
              }`}
            >
              {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {isOnline ? "Online" : "Offline"}
            </button>
          </div>
        </div>

        {/* Offline Queue Bar */}
        {queue.length > 0 && (
          <div className="mt-3 flex items-center justify-between rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4" />
              <span>{queue.length} offline action(s) pending</span>
            </div>
            <Can permission="deliveries:update" mode="disable">
              <button
                onClick={triggerSync}
                disabled={syncing || !isOnline}
                className="flex items-center gap-1 rounded-lg bg-amber-500 px-2 py-1 text-[11px] font-bold text-white hover:bg-amber-600 disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
                Sync Now
              </button>
            </Can>
          </div>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="grid grid-cols-5 gap-1 rounded-xl bg-muted/60 p-1 text-[11px] font-semibold">
        <button
          onClick={() => setActiveTab("stops")}
          className={`rounded-lg py-2 transition-all ${
            activeTab === "stops" ? "bg-surface text-primary shadow-sm" : "text-muted-foreground"
          }`}
        >
          Stops
        </button>
        <button
          onClick={() => setActiveTab("inspection")}
          className={`rounded-lg py-2 transition-all ${
            activeTab === "inspection" ? "bg-surface text-primary shadow-sm" : "text-muted-foreground"
          }`}
        >
          Pre-Trip
        </button>
        <button
          onClick={() => setActiveTab("loading")}
          className={`rounded-lg py-2 transition-all ${
            activeTab === "loading" ? "bg-surface text-primary shadow-sm" : "text-muted-foreground"
          }`}
        >
          Scan
        </button>
        <button
          onClick={() => setActiveTab("temperature")}
          className={`rounded-lg py-2 transition-all ${
            activeTab === "temperature" ? "bg-surface text-primary shadow-sm" : "text-muted-foreground"
          }`}
        >
          Reefer
        </button>
        <button
          onClick={() => setActiveTab("pod")}
          className={`rounded-lg py-2 transition-all ${
            activeTab === "pod" ? "bg-surface text-primary shadow-sm" : "text-muted-foreground"
          }`}
        >
          Sign POD
        </button>
      </div>

      {/* Tab 1: Stops */}
      {activeTab === "stops" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-primary">
                Route: {activeDelivery?.route_code || "RT-MIL-N1"}
              </span>
              <Badge tone={statusTone(activeDelivery?.status || "planned")} dot>
                {activeDelivery?.status || "In Transit"}
              </Badge>
            </div>
            <h2 className="mt-1 text-sm font-bold">{activeDelivery?.customer}</h2>
            <p className="text-xs text-muted-foreground">{activeDelivery?.delivery_address}</p>
            <div className="mt-2.5 flex items-center justify-between border-t border-border/60 pt-2 text-xs">
              <span className="text-muted-foreground">Time Window: 08:30 - 11:30</span>
              <span className="font-semibold">{activeDelivery?.total_cases || 8} cases ({activeDelivery?.total_weight_kg || 92} kg)</span>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Today's Route Stops
            </h3>
            {deliveries.map((del, i) => (
              <div
                key={del.id}
                onClick={() => setActiveDelivery(del)}
                className={`flex items-center justify-between rounded-xl border p-3.5 transition-all cursor-pointer ${
                  activeDelivery?.id === del.id
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border/70 bg-surface"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {i + 1}
                  </span>
                  <div>
                    <h4 className="text-xs font-bold text-foreground">{del.customer}</h4>
                    <p className="text-[11px] text-muted-foreground">{del.eta || "09:30"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={statusTone(del.status)} dot>
                    {del.status}
                  </Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 pt-2">
            <Can permission="deliveries:update" mode="disable">
              <button
                className="flex-1 inline-flex items-center justify-center rounded-lg bg-marine-steel py-2.5 text-xs font-semibold text-white hover:bg-marine-steel"
                onClick={() => {
                  queueAction({
                    action_type: "START_TRANSIT",
                    label: "Depart Hub / In Transit",
                    payload: { delivery_id: activeDelivery?.id },
                  });
                  alert("Departure logged!");
                }}
              >
                <Truck className="mr-1.5 h-4 w-4" /> Start Transit
              </button>
            </Can>
            <button
              className="flex-1 inline-flex items-center justify-center rounded-lg border border-border bg-background py-2.5 text-xs font-semibold text-foreground hover:bg-muted"
              onClick={() => setExcOpen(true)}
            >
              <ShieldAlert className="mr-1.5 h-4 w-4" /> Report Issue
            </button>
          </div>
        </div>
      )}

      {/* Tab 2: Pre-Trip Inspection */}
      {activeTab === "inspection" && (
        <div className="space-y-4 rounded-xl border border-border bg-surface p-4 text-xs">
          <div className="border-b border-border pb-3">
            <h3 className="text-sm font-bold">Vehicle Pre-Loading Check</h3>
            <p className="text-[11px] text-muted-foreground">
              HACCP cold chain and physical safety inspection checklist.
            </p>
          </div>

          <div className="space-y-2.5">
            <label className="flex items-center gap-2.5">
              <input type="checkbox" checked={inspCleanliness} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInspCleanliness(e.target.checked)} />
              <span>Cargo hold clean, odor-free & sanitized</span>
            </label>
            <label className="flex items-center gap-2.5">
              <input type="checkbox" checked={inspCondition} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInspCondition(e.target.checked)} />
              <span>Tires, lights, mirrors & door seals intact</span>
            </label>
            <label className="flex items-center gap-2.5">
              <input type="checkbox" checked={inspReefer} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInspReefer(e.target.checked)} />
              <span>Refrigeration unit powered and operating</span>
            </label>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <label className="text-[10px] text-muted-foreground">Chilled Probe (°C)</label>
                <input
                  type="text"
                  value={inspChilledTemp}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInspChilledTemp(e.target.value)}
                  className="w-full rounded border border-border bg-background px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Frozen Probe (°C)</label>
                <input
                  type="text"
                  value={inspFrozenTemp}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInspFrozenTemp(e.target.value)}
                  className="w-full rounded border border-border bg-background px-2.5 py-1.5 text-xs"
                />
              </div>
            </div>
            <label className="flex items-center gap-2.5 pt-1">
              <input type="checkbox" checked={inspDividers} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInspDividers(e.target.checked)} />
              <span>Movable compartment bulkheads locked</span>
            </label>
            <label className="flex items-center gap-2.5">
              <input type="checkbox" checked={inspCapacity} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInspCapacity(e.target.checked)} />
              <span>Total load within vehicle payload weight limit</span>
            </label>
            <label className="flex items-center gap-2.5">
              <input type="checkbox" checked={inspDocs} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInspDocs(e.target.checked)} />
              <span>Shipping documents (DDT / CMR) on board</span>
            </label>
            <label className="flex items-center gap-2.5">
              <input type="checkbox" checked={inspDriverConfirmed} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInspDriverConfirmed(e.target.checked)} />
              <span>Driver sign-off completed</span>
            </label>
          </div>

          <Can permission="deliveries:update" mode="disable">
            <button
              className="w-full inline-flex items-center justify-center rounded-lg bg-primary py-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              onClick={handleInspectionSubmit}
            >
              <CheckCircle2 className="mr-1.5 h-4 w-4" /> Confirm & Save Inspection
            </button>
          </Can>
        </div>
      )}

      {/* Tab 3: Loading Scanner */}
      {activeTab === "loading" && (
        <div className="space-y-4 rounded-xl border border-border bg-surface p-4 text-xs">
          <div className="border-b border-border pb-3">
            <h3 className="text-sm font-bold">Package Barcode Verification</h3>
            <p className="text-[11px] text-muted-foreground">
              Scan SSCC-18 barcodes on cartons and pallets as they enter the truck.
            </p>
          </div>

          <div className="space-y-2">
            <input
              type="text"
              value={barcodeScan}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBarcodeScan(e.target.value)}
              placeholder="Scan or enter barcode..."
              className="w-full rounded border border-border bg-background px-3 py-2 font-mono text-sm"
            />
            <Can permission="deliveries:update" mode="disable">
              <button
                className="w-full inline-flex items-center justify-center rounded-lg bg-primary py-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                onClick={handleScanPackage}
              >
                <QrCode className="mr-1.5 h-4 w-4" /> Verify Barcode Scan
              </button>
            </Can>
          </div>

          {scanResult && (
            <div className="rounded-lg bg-primary/10 p-2.5 text-center font-medium text-primary text-xs">
              {scanResult.text}
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Reefer Telemetry */}
      {activeTab === "temperature" && (
        <div className="space-y-4 rounded-xl border border-border bg-surface p-4 text-xs">
          <div className="border-b border-border pb-3">
            <h3 className="text-sm font-bold">Cold Chain Transport Telemetry</h3>
            <p className="text-[11px] text-muted-foreground">
              Record real-time temperature probe readings during transit.
            </p>
          </div>

          <div>
            <label className="font-semibold">Compartment</label>
            <select
              value={tempComp}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTempComp(e.target.value as any)}
              className="mt-1 w-full rounded-md border border-border bg-background p-2"
            >
              <option value="chilled">Chilled Cargo (0°C to 4°C)</option>
              <option value="frozen">Frozen Cargo (-25°C to -15°C)</option>
              <option value="ambient">Ambient Cargo (10°C to 22°C)</option>
            </select>
          </div>

          <div>
            <label className="font-semibold">Current Probe Reading (°C)</label>
            <input
              type="text"
              value={tempVal}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTempVal(e.target.value)}
              className="mt-1 w-full rounded border border-border bg-background px-3 py-2 font-mono text-base font-bold"
            />
          </div>

          {tempAlert && (
            <div className="flex items-center gap-2 rounded-lg bg-red-500/10 p-2.5 text-xs font-semibold text-red-600 dark:text-red-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {tempAlert}
            </div>
          )}

          <Can permission="deliveries:update" mode="disable">
            <button
              className="w-full inline-flex items-center justify-center rounded-lg bg-primary py-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              onClick={handleLogTemp}
            >
              <Thermometer className="mr-1.5 h-4 w-4" /> Save Temperature Reading
            </button>
          </Can>
        </div>
      )}

      {/* Tab 5: Proof of Delivery (POD) */}
      {activeTab === "pod" && (
        <div className="space-y-4 rounded-xl border border-border bg-surface p-4 text-xs">
          <div className="border-b border-border pb-2">
            <h3 className="text-sm font-bold">Capture Proof of Delivery (POD)</h3>
            <p className="text-[11px] text-muted-foreground">
              Customer: {activeDelivery?.customer}
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="font-semibold">Recipient Full Name *</label>
              <input
                type="text"
                value={recipientName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRecipientName(e.target.value)}
                placeholder="e.g. Marco Rossi"
                className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="font-semibold">Role / Title</label>
              <input
                type="text"
                value={recipientRole}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRecipientRole(e.target.value)}
                placeholder="e.g. Head Chef, Receiving Clerk"
                className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-semibold">Accepted Cases</label>
                <input
                  type="text"
                  value={acceptedCases}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAcceptedCases(e.target.value)}
                  className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label className="font-semibold">Rejected Cases</label>
                <input
                  type="text"
                  value={rejectedCases}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRejectedCases(e.target.value)}
                  className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-xs"
                />
              </div>
            </div>

            {/* Signature Canvas */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-semibold flex items-center gap-1">
                  <PenTool className="h-3 w-3" /> Customer Digital Signature *
                </label>
                <button
                  type="button"
                  onClick={clearCanvas}
                  className="text-[10px] text-primary hover:underline"
                >
                  Clear Signature
                </button>
              </div>
              <div className="relative rounded-xl border-2 border-dashed border-border bg-white overflow-hidden">
                <canvas
                  ref={canvasRef}
                  width={340}
                  height={140}
                  onMouseDown={startDraw}
                  onMouseMove={draw}
                  onMouseUp={stopDraw}
                  onMouseLeave={stopDraw}
                  onTouchStart={startDraw}
                  onTouchMove={draw}
                  onTouchEnd={stopDraw}
                  className="w-full touch-none cursor-crosshair"
                />
                {!hasSignature && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-zinc-400">
                    Sign on touch screen or draw with mouse
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="font-semibold">Delivery Notes / DDT Stamped</label>
              <input
                type="text"
                value={podNotes}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPodNotes(e.target.value)}
                placeholder="e.g. Delivered to cold room #2, DDT signed & stamped"
                className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-xs"
              />
            </div>

            <Can permission="deliveries:update" mode="disable">
              <button
                className="w-full inline-flex items-center justify-center rounded-lg bg-marine-steel py-2.5 text-xs font-semibold text-white hover:bg-marine-steel"
                onClick={handleSubmitPod}
              >
                <CheckCircle2 className="mr-1.5 h-4 w-4" /> Confirm & Submit POD
              </button>
            </Can>
          </div>
        </div>
      )}

      {/* Exception Modal */}
      {excOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-card p-5 shadow-xl space-y-3 max-h-[90vh] overflow-y-auto border border-border">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h3 className="text-sm font-bold">Report Delivery Exception</h3>
              <button onClick={() => setExcOpen(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold">Exception Type</label>
                <select
                  value={excType}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setExcType(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-background p-2"
                >
                  <option value="damaged_goods">Damaged Goods</option>
                  <option value="delivery_refused">Delivery Refused</option>
                  <option value="customer_unavailable">Customer Unavailable / Closed</option>
                  <option value="missing_quantity">Missing Cases Discrepancy</option>
                  <option value="temperature_excursion">Cold Chain Excursion</option>
                  <option value="partial_delivery">Partial Delivery</option>
                </select>
              </div>
              <div>
                <label className="font-semibold">Detailed Reason</label>
                <input
                  type="text"
                  value={excReason}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExcReason(e.target.value)}
                  placeholder="Reason description..."
                  className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold">Affected Cases</label>
                  <input
                    type="text"
                    value={excCases}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExcCases(e.target.value)}
                    className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="font-semibold">Follow-Up Action</label>
                  <select
                    value={excAction}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setExcAction(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background p-2"
                  >
                    <option value="return_to_warehouse">Return to Hub</option>
                    <option value="redeliver">Redelivery</option>
                    <option value="credit_note">Issue Credit Note</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setExcOpen(false)}
                  className="rounded border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  Cancel
                </button>
                <Can permission="deliveries:update" mode="disable">
                  <button
                    type="button"
                    onClick={handleSubmitException}
                    className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    Queue Exception
                  </button>
                </Can>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
