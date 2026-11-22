"use client";

import { useState, useEffect, useTransition } from "react";
import {
  ShieldAlert,
  Search,
  ArrowRight,
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Unlock,
  RefreshCw,
  FileText,
  Mail,
  Truck,
  Package,
  Layers,
  Thermometer,
  Scale,
  Ban,
  Clock,
  ExternalLink,
  ChevronRight,
  Check,
  X,
  FileWarning,
} from "lucide-react";
import { Badge, statusTone } from "@/components/ui";
import { Can, ViewOnlyBadge } from "@/components/access-gate";
import type {
  ForwardTraceabilityResult,
  BackwardTraceabilityResult,
  LotMassBalance,
  DetailedException,
  RecallCase,
  QuarantineActionResult,
} from "@/lib/exceptions-recall";

export function ExceptionsRecallWorkbench() {
  const [activeTab, setActiveTab] = useState<
    "forward" | "backward" | "mass_balance" | "quarantine" | "exceptions" | "recalls" | "regulatory"
  >("forward");

  // Search & Filter State
  const [lotSearch, setLotSearch] = useState("LOT-2026-SAL-082");
  const [backwardSearch, setBackwardSearch] = useState("CUST-001");
  const [backwardType, setBackwardType] = useState<"customer_id" | "order_number" | "delivery_id" | "invoice_number" | "lot_id">("customer_id");

  // Data State
  const [forwardData, setForwardData] = useState<ForwardTraceabilityResult | null>(null);
  const [backwardData, setBackwardData] = useState<BackwardTraceabilityResult | null>(null);
  const [massBalance, setMassBalance] = useState<LotMassBalance | null>(null);
  const [exceptions, setExceptions] = useState<DetailedException[]>([]);
  const [recalls, setRecalls] = useState<RecallCase[]>([]);
  const [selectedRecall, setSelectedRecall] = useState<RecallCase | null>(null);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Modals state
  const [isQuarantineModalOpen, setIsQuarantineModalOpen] = useState(false);
  const [isReleaseModalOpen, setIsReleaseModalOpen] = useState(false);
  const [isNewRecallModalOpen, setIsNewRecallModalOpen] = useState(false);
  const [isRecoveryModalOpen, setIsRecoveryModalOpen] = useState(false);
  const [isCloseRecallModalOpen, setIsCloseRecallModalOpen] = useState(false);

  // Form states
  const [quarantineReason, setQuarantineReason] = useState("");
  const [quarantineBin, setQuarantineBin] = useState("QUAR-ZONE-01");
  const [releaseReason, setReleaseReason] = useState("");
  const [releaseBin, setReleaseBin] = useState("CHILL-A1-01");

  // Recovery Form
  const [recoveryCustomer, setRecoveryCustomer] = useState("");
  const [recoveryCases, setRecoveryCases] = useState("10");
  const [recoveryWeight, setRecoveryWeight] = useState("12.5");
  const [recoverySeal, setRecoverySeal] = useState("SEAL-QA-9901");
  const [recoveryTemp, setRecoveryTemp] = useState("2.2");

  // Closure Form
  const [closureNotes, setClosureNotes] = useState("");

  // Load initial data
  useEffect(() => {
    loadForwardTrace(lotSearch);
    loadMassBalance(lotSearch);
    loadExceptions();
    loadRecalls();
  }, []);

  async function loadForwardTrace(lotId: string) {
    if (!lotId) return;
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await fetch(`/api/v1/exceptions-recall/trace/forward?lot_id=${encodeURIComponent(lotId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Failed to load forward traceability");
      setForwardData(data.result);
      setMassBalance(data.result.mass_balance);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadBackwardTrace() {
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await fetch(`/api/v1/exceptions-recall/trace/backward?${backwardType}=${encodeURIComponent(backwardSearch)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Failed to load backward traceability");
      setBackwardData(data.result);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadMassBalance(lotId: string) {
    if (!lotId) return;
    try {
      const res = await fetch(`/api/v1/exceptions-recall/mass-balance?lot_id=${encodeURIComponent(lotId)}`);
      const data = await res.json();
      if (res.ok) {
        setMassBalance(data.mass_balance);
      }
    } catch (err) {
      // ignore
    }
  }

  async function loadExceptions() {
    try {
      const res = await fetch(`/api/v1/exceptions-recall/exceptions`);
      const data = await res.json();
      if (res.ok && data.exceptions) {
        setExceptions(data.exceptions);
      }
    } catch (err) {
      // ignore
    }
  }

  async function loadRecalls() {
    try {
      const res = await fetch(`/api/v1/exceptions-recall/recalls`);
      const data = await res.json();
      if (res.ok && data.recalls) {
        setRecalls(data.recalls);
        if (data.recalls.length > 0) {
          loadSingleRecall(data.recalls[0].id);
        }
      }
    } catch (err) {
      // ignore
    }
  }

  async function loadSingleRecall(id: string) {
    try {
      const res = await fetch(`/api/v1/exceptions-recall/recalls/${id}`);
      const data = await res.json();
      if (res.ok && data.recall) {
        setSelectedRecall(data.recall);
      }
    } catch (err) {
      // ignore
    }
  }

  // Handle Quarantine Action
  async function handleQuarantineHold() {
    if (!quarantineReason) {
      setErrorMsg("Quarantine hold reason is mandatory.");
      return;
    }
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await fetch("/api/v1/exceptions-recall/quarantine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lot_id: lotSearch,
          reason: quarantineReason,
          quarantine_bin_code: quarantineBin,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Failed to quarantine lot");
      setSuccessMsg(data.message || `Lot ${lotSearch} placed on quarantine hold`);
      setIsQuarantineModalOpen(false);
      setQuarantineReason("");
      loadForwardTrace(lotSearch);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Handle Release Action
  async function handleReleaseQuarantine() {
    if (!releaseReason) {
      setErrorMsg("Quarantine release justification is mandatory.");
      return;
    }
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await fetch("/api/v1/exceptions-recall/quarantine/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lot_id: lotSearch,
          reason: releaseReason,
          target_bin_code: releaseBin,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Failed to release lot");
      setSuccessMsg(data.message || `Lot ${lotSearch} released from quarantine`);
      setIsReleaseModalOpen(false);
      setReleaseReason("");
      loadForwardTrace(lotSearch);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Handle Approve Recall
  async function handleApproveRecall(recallId: string) {
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await fetch(`/api/v1/exceptions-recall/recalls/${recallId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Failed to approve recall");
      setSuccessMsg(data.message);
      loadSingleRecall(recallId);
      loadRecalls();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Handle Customer Notification
  async function handleNotifyCustomer(recallId: string, customerId: string) {
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await fetch(`/api/v1/exceptions-recall/recalls/${recallId}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: customerId, channel: "email" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Failed to notify customer");
      setSuccessMsg(data.message);
      loadSingleRecall(recallId);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Handle Recovery Log
  async function handleRecordRecovery(recallId: string) {
    if (!recoveryCustomer || Number(recoveryCases) <= 0) {
      setErrorMsg("Select customer and specify valid recovered cases.");
      return;
    }
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await fetch(`/api/v1/exceptions-recall/recalls/${recallId}/recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: recoveryCustomer,
          recovered_cases: Number(recoveryCases),
          recovered_weight_kg: Number(recoveryWeight),
          seal_number: recoverySeal,
          temp_c: Number(recoveryTemp),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Failed to record recovery");
      setSuccessMsg(data.message);
      setIsRecoveryModalOpen(false);
      loadSingleRecall(recallId);
      loadRecalls();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Handle Recall Closure
  async function handleCloseRecall(recallId: string) {
    if (!closureNotes || closureNotes.length < 10) {
      setErrorMsg("Formal closure justification of at least 10 characters is mandatory.");
      return;
    }
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await fetch(`/api/v1/exceptions-recall/recalls/${recallId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closure_notes: closureNotes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Failed to close recall");
      setSuccessMsg(data.message);
      setIsCloseRecallModalOpen(false);
      setClosureNotes("");
      loadSingleRecall(recallId);
      loadRecalls();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Messages */}
      {errorMsg && (
        <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-xs hover:underline">Dismiss</button>
        </div>
      )}

      {successMsg && (
        <div className="flex items-center justify-between rounded-lg border border-marine-ocean/60 bg-marine-steel/10 p-3 text-sm text-marine-mid">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-xs hover:underline">Dismiss</button>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-red-500" />
            Traceability & Recall
            <ViewOnlyBadge modifyPermissions={["traceability:quarantine", "recalls.manage", "quality.inspect", "quality.decide"]} />
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Trace products from suppliers and batches to warehouse locations and customers. Quarantine affected stock and manage recalls, recovery and corrective actions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsQuarantineModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-500 hover:bg-amber-500/20"
          >
            <Lock className="h-3.5 w-3.5" />
            Quarantine Hold
          </button>
          <button
            onClick={() => setIsReleaseModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-marine-ocean/60 bg-marine-steel/10 px-3 py-1.5 text-xs font-semibold text-marine-mid hover:bg-marine-steel/20"
          >
            <Unlock className="h-3.5 w-3.5" />
            Release Hold
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex overflow-x-auto border-b border-border text-sm">
        <button
          onClick={() => setActiveTab("forward")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-medium transition-colors whitespace-nowrap ${
            activeTab === "forward" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <ArrowRight className="h-4 w-4" />
          Forward Traceability (Supplier ➔ Customer)
        </button>
        <button
          onClick={() => {
            setActiveTab("backward");
            if (!backwardData) loadBackwardTrace();
          }}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-medium transition-colors whitespace-nowrap ${
            activeTab === "backward" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <ArrowLeft className="h-4 w-4" />
          Backward Traceability (Customer ➔ Supplier)
        </button>
        <button
          onClick={() => setActiveTab("mass_balance")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-medium transition-colors whitespace-nowrap ${
            activeTab === "mass_balance" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Scale className="h-4 w-4" />
          Mass Balance
        </button>
        <button
          onClick={() => setActiveTab("exceptions")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-medium transition-colors whitespace-nowrap ${
            activeTab === "exceptions" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileWarning className="h-4 w-4" />
          Quality Exceptions ({exceptions.length})
        </button>
        <button
          onClick={() => setActiveTab("recalls")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-medium transition-colors whitespace-nowrap ${
            activeTab === "recalls" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Ban className="h-4 w-4" />
          Product Recalls ({recalls.length})
        </button>
      </div>

      {/* TAB 1: FORWARD TRACEABILITY */}
      {activeTab === "forward" && (
        <div className="space-y-6">
          {/* Quick Lot Picker Bar */}
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/60 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 flex-1">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={lotSearch}
                onChange={(e) => setLotSearch(e.target.value)}
                placeholder="Enter internal lot or batch ID (e.g. LOT-2026-SAL-082)..."
                className="w-full bg-transparent text-sm focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Quick pick:</span>
              <button
                onClick={() => { setLotSearch("LOT-2026-SAL-082"); loadForwardTrace("LOT-2026-SAL-082"); }}
                className="rounded border border-border px-2 py-0.5 text-xs hover:bg-accent"
              >
                Salmon (082)
              </button>
              <button
                onClick={() => { setLotSearch("LOT-2026-BUR-019"); loadForwardTrace("LOT-2026-BUR-019"); }}
                className="rounded border border-border px-2 py-0.5 text-xs hover:bg-accent"
              >
                Burrata (019)
              </button>
              <button
                onClick={() => { setLotSearch("LOT-2026-BFL-044"); loadForwardTrace("LOT-2026-BFL-044"); }}
                className="rounded border border-border px-2 py-0.5 text-xs hover:bg-accent"
              >
                Beef (044)
              </button>
              <button
                onClick={() => loadForwardTrace(lotSearch)}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5"
              >
                <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
                Trace Lot
              </button>
            </div>
          </div>

          {forwardData && (
            <div className="grid gap-6 lg:grid-cols-3">
              {/* Left Column: Lot Master & Mass Balance Snapshot */}
              <div className="space-y-6 lg:col-span-1">
                {/* Lot Card */}
                <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Lot Profile</span>
                      <h2 className="text-base font-bold text-foreground mt-0.5">{forwardData.lot.internal_lot}</h2>
                      <p className="text-xs text-muted-foreground">{forwardData.lot.product_name}</p>
                    </div>
                    <Badge tone={forwardData.lot.quality_status === "quarantine" ? "danger" : "success"}>
                      {forwardData.lot.quality_status.toUpperCase()}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs border-t border-border pt-3">
                    <div>
                      <span className="text-muted-foreground">SKU</span>
                      <p className="font-semibold">{forwardData.lot.sku}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Supplier Batch</span>
                      <p className="font-semibold">{forwardData.lot.supplier_lot}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Current Location</span>
                      <p className="font-semibold">{forwardData.lot.current_location} ({forwardData.lot.current_zone})</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Expiry Date</span>
                      <p className="font-semibold text-amber-500">{forwardData.lot.expiry_date}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Warehouse Stock</span>
                      <p className="font-semibold text-foreground">{forwardData.lot.quantity_cases} cases</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Catch Weight</span>
                      <p className="font-semibold">{forwardData.lot.catch_weight_kg ? `${forwardData.lot.catch_weight_kg} kg` : "Standard"}</p>
                    </div>
                  </div>
                </div>

                {/* Mass Balance Card */}
                {forwardData.mass_balance && (
                  <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        <Scale className="h-4 w-4 text-primary" />
                        Mass Balance Audit
                      </div>
                      <Badge tone={forwardData.mass_balance.reconciliation_status === "balanced" ? "success" : "danger"}>
                        {forwardData.mass_balance.reconciliation_status === "balanced" ? "BALANCED (0 VAR)" : "FLAGGED VARIANCE"}
                      </Badge>
                    </div>

                    <div className="space-y-2 text-xs border-t border-border pt-3">
                      <div className="flex justify-between py-1 border-b border-border/50">
                        <span className="text-muted-foreground">Received Quantity:</span>
                        <span className="font-bold">{forwardData.mass_balance.received_cases} cases ({forwardData.mass_balance.received_weight_kg} kg)</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-border/50">
                        <span className="text-muted-foreground">Warehouse Physical:</span>
                        <span>{forwardData.mass_balance.current_physical_cases} cases</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-border/50">
                        <span className="text-muted-foreground">Customer Delivered:</span>
                        <span>{forwardData.mass_balance.delivered_cases} cases</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-border/50">
                        <span className="text-muted-foreground">Recovered Returns:</span>
                        <span>{forwardData.mass_balance.returned_cases} cases</span>
                      </div>
                      <div className="flex justify-between py-1 font-bold text-foreground">
                        <span>Unaccounted Discrepancy:</span>
                        <span className={forwardData.mass_balance.unaccounted_variance_cases === 0 ? "text-marine-mid" : "text-red-500"}>
                          {forwardData.mass_balance.unaccounted_variance_cases} cases ({forwardData.mass_balance.unaccounted_variance_weight_kg} kg)
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Chronological Traceability Timeline */}
              <div className="space-y-4 lg:col-span-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary" />
                    Chronological Traceability Journey (Supplier ➔ Consumer)
                  </h3>
                  <span className="text-xs text-muted-foreground">{forwardData.timeline.length} verified lifecycle checkpoints</span>
                </div>

                <div className="relative pl-6 space-y-6 before:absolute before:bottom-2 before:left-2.5 before:top-2 before:w-0.5 before:bg-border">
                  {forwardData.timeline.map((event, idx) => (
                    <div key={idx} className="relative group">
                      {/* Node Bullet */}
                      <div
                        className={`absolute -left-6 top-1 h-3 w-3 rounded-full border-2 bg-background transition-transform group-hover:scale-125 ${
                          event.status === "blocked"
                            ? "border-red-500 bg-red-500"
                            : event.status === "flagged"
                            ? "border-amber-500 bg-amber-500"
                            : "border-primary bg-primary"
                        }`}
                      />
                      <div className="rounded-xl border border-border bg-card p-4 space-y-2 hover:border-border/80 transition-colors">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            {event.stage.replace(/_/g, " ")} • {event.reference}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {new Date(event.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <h4 className="text-sm font-semibold text-foreground">{event.title}</h4>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {event.location && <span>📍 {event.location}</span>}
                          <span>👤 {event.actor}</span>
                        </div>
                        {event.details && (
                          <div className="mt-2 rounded bg-muted/40 p-2 text-xs font-mono text-muted-foreground">
                            {JSON.stringify(event.details, null, 2)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: BACKWARD TRACEABILITY */}
      {activeTab === "backward" && (
        <div className="space-y-6">
          {/* Backward Search Box */}
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/60 p-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase text-muted-foreground">Search by:</span>
              <select
                value={backwardType}
                onChange={(e) => setBackwardType(e.target.value as any)}
                className="rounded border border-border bg-background px-2.5 py-1 text-xs font-medium focus:outline-none"
              >
                <option value="customer_id">Customer ID (e.g. CUST-001)</option>
                <option value="order_number">Order Number (e.g. SO-2026-9841)</option>
                <option value="delivery_id">Delivery ID (e.g. DEL-2026-0301)</option>
                <option value="invoice_number">Invoice Number (e.g. INV-2026-8412)</option>
                <option value="lot_id">Batch / Lot ID</option>
              </select>
            </div>
            <div className="flex items-center gap-2 flex-1">
              <input
                type="text"
                value={backwardSearch}
                onChange={(e) => setBackwardSearch(e.target.value)}
                placeholder="Enter identifier..."
                className="w-full bg-transparent text-sm focus:outline-none border-b border-border px-2 py-1"
              />
              <button
                onClick={loadBackwardTrace}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5"
              >
                <Search className="h-3.5 w-3.5" /> Trace Backward
              </button>
            </div>
          </div>

          {backwardData && (
            <div className="space-y-6">
              {/* Origin Suppliers Discovered */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" />
                  Origin Suppliers & Inbound Purchase Orders
                </h3>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {backwardData.suppliers.map((s, idx) => (
                    <div key={idx} className="rounded-lg border border-border p-3 text-xs space-y-1.5">
                      <div className="flex items-center justify-between font-bold text-foreground">
                        <span>{s.supplier_name}</span>
                        <Badge tone="info">{s.origin_country}</Badge>
                      </div>
                      <p className="text-muted-foreground">Product: <strong>{s.product_name}</strong> ({s.sku})</p>
                      <p className="text-muted-foreground">Supplier Batch: <strong>{s.supplier_batch}</strong></p>
                      <p className="text-muted-foreground">Internal Lot: <strong>{s.internal_lot}</strong></p>
                      <p className="text-muted-foreground">PO: <strong>{s.purchase_order_number}</strong> • Rec: {s.received_date}</p>
                      <p className="text-muted-foreground">Arrival Temp: <strong>{s.receiving_temperature_c}°C</strong></p>
                    </div>
                  ))}
                </div>
              </div>

              {/* CRITICAL: Other Affected Customers Receiving Same Lots */}
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-red-500 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    Other Affected Customers Receiving Same Batches ({backwardData.other_affected_customers.length})
                  </h3>
                  <span className="text-xs text-muted-foreground">Contagion boundary mapping</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-2">Customer</th>
                        <th className="py-2">Order #</th>
                        <th className="py-2">Delivery Date</th>
                        <th className="py-2">Batch / Lot</th>
                        <th className="py-2">Cases</th>
                        <th className="py-2">Weight (kg)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backwardData.other_affected_customers.map((c, idx) => (
                        <tr key={idx} className="border-b border-border/40 hover:bg-accent/40">
                          <td className="py-2.5 font-semibold text-foreground">{c.customer_name}</td>
                          <td className="py-2.5 text-muted-foreground">{c.order_number}</td>
                          <td className="py-2.5 text-muted-foreground">{c.delivered_date}</td>
                          <td className="py-2.5 font-mono text-amber-500">{c.affected_lot}</td>
                          <td className="py-2.5 font-bold">{c.delivered_cases}</td>
                          <td className="py-2.5 text-muted-foreground">{c.delivered_weight_kg}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Current Physical Warehouse Stock for these lots */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" />
                  Remaining Warehouse Stock Locations for these Lots
                </h3>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  {backwardData.current_physical_locations.map((loc, idx) => (
                    <div key={idx} className="rounded-lg border border-border p-3 text-xs space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-foreground">{loc.bin_code}</span>
                        <Badge tone={loc.quality_status === "quarantine" ? "danger" : "success"}>
                          {loc.quality_status.toUpperCase()}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground">{loc.warehouse} / {loc.zone_code}</p>
                      <p className="text-muted-foreground">Lot: <strong className="font-mono">{loc.lot_id}</strong></p>
                      <p className="text-foreground font-semibold">{loc.quantity_cases} cases ({loc.weight_kg} kg)</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: MASS BALANCE RECONCILIATION */}
      {activeTab === "mass_balance" && (
        <div className="space-y-6">
          {massBalance && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-border bg-card p-4 space-y-1">
                  <span className="text-xs text-muted-foreground">Inbound Received</span>
                  <p className="text-2xl font-bold text-foreground">{massBalance.received_cases} <span className="text-xs font-normal text-muted-foreground">cases</span></p>
                  <p className="text-xs text-muted-foreground">{massBalance.received_weight_kg} kg catch weight</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4 space-y-1">
                  <span className="text-xs text-muted-foreground">Warehouse Physical Stock</span>
                  <p className="text-2xl font-bold text-foreground">{massBalance.current_physical_cases} <span className="text-xs font-normal text-muted-foreground">cases</span></p>
                  <p className="text-xs text-muted-foreground">{massBalance.current_physical_weight_kg} kg on-hand</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4 space-y-1">
                  <span className="text-xs text-muted-foreground">Delivered to Customers</span>
                  <p className="text-2xl font-bold text-marine-mid">{massBalance.delivered_cases} <span className="text-xs font-normal text-muted-foreground">cases</span></p>
                  <p className="text-xs text-muted-foreground">{massBalance.delivered_weight_kg} kg customer PODs</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4 space-y-1">
                  <span className="text-xs text-muted-foreground">Unaccounted Variance</span>
                  <p className={`text-2xl font-bold ${massBalance.unaccounted_variance_cases === 0 ? "text-marine-mid" : "text-red-500"}`}>
                    {massBalance.unaccounted_variance_cases} <span className="text-xs font-normal text-muted-foreground">cases</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{massBalance.unaccounted_variance_weight_kg} kg ({massBalance.variance_percentage}%)</p>
                </div>
              </div>

              {/* Formula & Breakdown Table */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                    <Scale className="h-4 w-4 text-primary" />
                    Mass Balance Equation Breakdown
                  </h3>
                  <Badge tone={massBalance.reconciliation_status === "balanced" ? "success" : "danger"}>
                    {massBalance.reconciliation_status === "balanced" ? "VERIFIED BALANCED" : "AUDIT VARIANCE DETECTED"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Formula: <code>Received = Physical On-Hand + Customer Delivered + Inbound Rejected + Net Adjustments - Customer Returns</code>
                </p>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-2">Inventory Pipeline Stage</th>
                        <th className="py-2">Cases</th>
                        <th className="py-2">Weight (kg)</th>
                        <th className="py-2">Operational Verification</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      <tr>
                        <td className="py-2 font-medium">Inbound Receipt (Gross)</td>
                        <td className="py-2 font-bold">{massBalance.received_cases}</td>
                        <td className="py-2">{massBalance.received_weight_kg}</td>
                        <td className="py-2 text-marine-mid">Gate arrival scale & ASN match</td>
                      </tr>
                      <tr>
                        <td className="py-2 font-medium">Inbound Rejected at Gate</td>
                        <td className="py-2 font-bold text-red-500">{massBalance.rejected_cases}</td>
                        <td className="py-2 text-red-500">{massBalance.rejected_weight_kg}</td>
                        <td className="py-2 text-muted-foreground">QA inspection quarantine</td>
                      </tr>
                      <tr>
                        <td className="py-2 font-medium">Current Physical Stock (Warehouse)</td>
                        <td className="py-2 font-bold text-foreground">{massBalance.current_physical_cases}</td>
                        <td className="py-2">{massBalance.current_physical_weight_kg}</td>
                        <td className="py-2 text-muted-foreground">WMS Bin placements verified</td>
                      </tr>
                      <tr>
                        <td className="py-2 font-medium">Customer Deliveries Confirmed</td>
                        <td className="py-2 font-bold text-foreground">{massBalance.delivered_cases}</td>
                        <td className="py-2">{massBalance.delivered_weight_kg}</td>
                        <td className="py-2 text-muted-foreground">Driver POD signed manifests</td>
                      </tr>
                      <tr>
                        <td className="py-2 font-medium">Returned Goods Recovered</td>
                        <td className="py-2 font-bold text-amber-500">{massBalance.returned_cases}</td>
                        <td className="py-2 text-amber-500">{massBalance.returned_weight_kg}</td>
                        <td className="py-2 text-muted-foreground">Reverse logistics intake into quarantine</td>
                      </tr>
                      <tr className="bg-muted/30 font-bold">
                        <td className="py-2 text-foreground">Total Accounted Inventory</td>
                        <td className="py-2">{massBalance.current_physical_cases + massBalance.delivered_cases + massBalance.rejected_cases - massBalance.returned_cases}</td>
                        <td className="py-2">{Math.round((massBalance.current_physical_weight_kg + massBalance.delivered_weight_kg + massBalance.rejected_weight_kg - massBalance.returned_weight_kg) * 100) / 100}</td>
                        <td className="py-2 text-marine-mid">100% trace complete</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: QUALITY EXCEPTIONS */}
      {activeTab === "exceptions" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">Active Quality Non-Conformances & Incidents</h3>
            <span className="text-xs text-muted-foreground">{exceptions.length} recorded events</span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {exceptions.map((exp) => (
              <div key={exp.id} className="rounded-xl border border-border bg-card p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-xs font-mono font-bold text-muted-foreground">{exp.exception_number}</span>
                    <h4 className="text-sm font-bold text-foreground mt-0.5">{exp.exception_type.replace(/_/g, " ").toUpperCase()}</h4>
                    <p className="text-xs text-muted-foreground">{exp.product_name} (Lot: {exp.internal_lot})</p>
                  </div>
                  <Badge tone={exp.severity === "critical" ? "danger" : "warning"}>
                    {exp.severity.toUpperCase()}
                  </Badge>
                </div>

                <div className="space-y-1.5 text-xs border-t border-border pt-3">
                  <p><strong>Actual Reading:</strong> <span className="text-red-400 font-mono">{exp.actual_reading}</span> (Expected: {exp.expected_limits})</p>
                  <p><strong>Food Safety Impact:</strong> {exp.food_safety_impact}</p>
                  <p><strong>Containment:</strong> {exp.containment_actions || "Under initial containment"}</p>
                  {exp.resolution && <p><strong>Resolution:</strong> {exp.resolution}</p>}
                </div>

                <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
                  <span>Inspector: {exp.responsible_person}</span>
                  <Badge tone={exp.status === "resolved" ? "success" : "info"}>{exp.status.toUpperCase()}</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 5: PRODUCT RECALLS LIFECYCLE */}
      {activeTab === "recalls" && (
        <div className="space-y-6">
          {selectedRecall && (
            <div className="space-y-6">
              {/* Recall Status Bar */}
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge tone="danger">{selectedRecall.classification.replace(/_/g, " ").toUpperCase()}</Badge>
                      <span className="text-xs font-mono font-bold text-muted-foreground">{selectedRecall.recall_number}</span>
                    </div>
                    <h2 className="text-base font-bold text-foreground mt-1">{selectedRecall.title}</h2>
                    <p className="text-xs text-muted-foreground">Affected Lot: <strong>{selectedRecall.affected_lot}</strong> • {selectedRecall.product_name}</p>
                  </div>

                  {/* Action Buttons based on status */}
                  <div className="flex items-center gap-2">
                    {selectedRecall.status === "draft" || selectedRecall.status === "under_investigation" ? (
                      <Can permission="recalls.manage" mode="hide">
                        <button
                          onClick={() => handleApproveRecall(selectedRecall.id)}
                          className="rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-red-700 shadow"
                        >
                          Approve & Activate Recall
                        </button>
                      </Can>
                    ) : selectedRecall.status !== "closed" ? (
                      <>
                        <button
                          onClick={() => {
                            if (selectedRecall.affected_customers && selectedRecall.affected_customers.length > 0) {
                              setRecoveryCustomer(selectedRecall.affected_customers[0].customer_id);
                            }
                            setIsRecoveryModalOpen(true);
                          }}
                          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5"
                        >
                          <Truck className="h-3.5 w-3.5" /> Log Goods Recovery
                        </button>
                        <button
                          onClick={() => setIsCloseRecallModalOpen(true)}
                          className="rounded-lg border border-marine-ocean/60 bg-marine-steel/10 px-3 py-1.5 text-xs font-bold text-marine-mid hover:bg-marine-steel/20"
                        >
                          Verify & Close Recall
                        </button>
                      </>
                    ) : (
                      <Badge tone="success">RECALL CLOSED & VERIFIED</Badge>
                    )}
                  </div>
                </div>

                {/* KPI Metrics */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 border-t border-red-500/20 pt-3 text-xs">
                  <div>
                    <span className="text-muted-foreground">Total Affected Stock</span>
                    <p className="text-base font-bold text-foreground">{selectedRecall.total_affected_cases} cases</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Recovered to Warehouse</span>
                    <p className="text-base font-bold text-marine-mid">{selectedRecall.recovered_cases} cases</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Recovery Effectiveness</span>
                    <p className="text-base font-bold text-amber-500">{selectedRecall.recovery_percentage}%</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Affected Customers</span>
                    <p className="text-base font-bold text-foreground">{selectedRecall.affected_customers_count} accounts</p>
                  </div>
                </div>
              </div>

              {/* Affected Customers Table & Dispatch Notification */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                    <Mail className="h-4 w-4 text-primary" />
                    Affected Customer Accounts & Reverse Logistics Actions
                  </h3>
                  <span className="text-xs text-muted-foreground">Formal notification audit</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-2">Customer Account</th>
                        <th className="py-2">Order #</th>
                        <th className="py-2">Delivered Date</th>
                        <th className="py-2">Delivered</th>
                        <th className="py-2">Recovered</th>
                        <th className="py-2">Remaining</th>
                        <th className="py-2">Notice Status</th>
                        <th className="py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {selectedRecall.affected_customers && selectedRecall.affected_customers.map((c) => (
                        <tr key={c.id} className="hover:bg-accent/40">
                          <td className="py-2.5 font-bold text-foreground">{c.customer_name}</td>
                          <td className="py-2.5 text-muted-foreground">{c.order_number}</td>
                          <td className="py-2.5 text-muted-foreground">{c.delivered_date}</td>
                          <td className="py-2.5 font-semibold">{c.delivered_cases} cases</td>
                          <td className="py-2.5 font-semibold text-marine-mid">{c.recovered_cases} cases</td>
                          <td className="py-2.5 font-bold text-amber-500">{c.remaining_unrecovered_cases} cases</td>
                          <td className="py-2.5">
                            <Badge tone={c.notification_status === "acknowledged" ? "success" : c.notification_status === "sent" ? "info" : "neutral"}>
                              {c.notification_status.toUpperCase()}
                            </Badge>
                          </td>
                          <td className="py-2.5 text-right">
                            {c.notification_status === "pending" ? (
                              <Can permission="recalls.manage" mode="disable">
                                <button
                                  onClick={() => handleNotifyCustomer(selectedRecall.id, c.customer_id)}
                                  className="rounded bg-primary/20 text-primary border border-primary/40 px-2.5 py-1 text-[11px] font-semibold hover:bg-primary/30"
                                >
                                  Send Notice
                                </button>
                              </Can>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">Notified</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: QUARANTINE HOLD */}
      {isQuarantineModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <Lock className="h-4 w-4 text-amber-500" />
                Initiate Warehouse Quarantine Hold
              </h3>
              <button onClick={() => setIsQuarantineModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Immediately blocks lot <strong>{lotSearch}</strong> from sales order allocations, pick wave generations, and dispatch manifests across all warehouse operations.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-muted-foreground font-semibold">Reason for Hold</label>
                <textarea
                  value={quarantineReason}
                  onChange={(e) => setQuarantineReason(e.target.value)}
                  placeholder="Detail food safety concern, customer complaint, or packaging defect..."
                  className="w-full mt-1 rounded border border-border bg-background p-2 focus:outline-none"
                  rows={3}
                />
              </div>
              <div>
                <label className="text-muted-foreground font-semibold">Destination Quarantine Bin</label>
                <input
                  type="text"
                  value={quarantineBin}
                  onChange={(e) => setQuarantineBin(e.target.value)}
                  className="w-full mt-1 rounded border border-border bg-background p-2 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setIsQuarantineModalOpen(false)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <Can permission="traceability:quarantine" mode="disable">
                <button
                  onClick={handleQuarantineHold}
                  className="rounded-lg bg-amber-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-amber-700"
                >
                  Apply Quarantine Hold
                </button>
              </Can>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: RELEASE QUARANTINE */}
      {isReleaseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <Unlock className="h-4 w-4 text-marine-mid" />
                Release Lot to Available Stock
              </h3>
              <button onClick={() => setIsReleaseModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Formally certifies that lab tests, reinspection, or corrective actions have passed. Restores lot <strong>{lotSearch}</strong> to active inventory.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-muted-foreground font-semibold">Release Justification & Lab Ref</label>
                <textarea
                  value={releaseReason}
                  onChange={(e) => setReleaseReason(e.target.value)}
                  placeholder="Reference negative lab certificates, QA reinspection number..."
                  className="w-full mt-1 rounded border border-border bg-background p-2 focus:outline-none"
                  rows={3}
                />
              </div>
              <div>
                <label className="text-muted-foreground font-semibold">Target Warehouse Bin</label>
                <input
                  type="text"
                  value={releaseBin}
                  onChange={(e) => setReleaseBin(e.target.value)}
                  className="w-full mt-1 rounded border border-border bg-background p-2 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setIsReleaseModalOpen(false)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <Can permission="traceability:quarantine" mode="disable">
                <button
                  onClick={handleReleaseQuarantine}
                  className="rounded-lg bg-marine-steel px-4 py-1.5 text-xs font-bold text-white hover:bg-marine-steelLight"
                >
                  Sign & Release Stock
                </button>
              </Can>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: LOG RECOVERY */}
      {isRecoveryModalOpen && selectedRecall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <Truck className="h-4 w-4 text-primary" />
                Log Returned Goods Intake
              </h3>
              <button onClick={() => setIsRecoveryModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Record physical reception of recalled batch <strong>{selectedRecall.affected_lot}</strong> from customer reverse logistics.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-muted-foreground font-semibold">Returning Customer</label>
                <select
                  value={recoveryCustomer}
                  onChange={(e) => setRecoveryCustomer(e.target.value)}
                  className="w-full mt-1 rounded border border-border bg-background p-2 focus:outline-none"
                >
                  {selectedRecall.affected_customers && selectedRecall.affected_customers.map((c) => (
                    <option key={c.id} value={c.customer_id}>
                      {c.customer_name} ({c.delivered_cases} delivered, {c.remaining_unrecovered_cases} remaining)
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-muted-foreground font-semibold">Recovered Cases</label>
                  <input
                    type="number"
                    value={recoveryCases}
                    onChange={(e) => setRecoveryCases(e.target.value)}
                    className="w-full mt-1 rounded border border-border bg-background p-2 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground font-semibold">Catch Weight (kg)</label>
                  <input
                    type="number"
                    value={recoveryWeight}
                    onChange={(e) => setRecoveryWeight(e.target.value)}
                    className="w-full mt-1 rounded border border-border bg-background p-2 focus:outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-muted-foreground font-semibold">Tamper Seal #</label>
                  <input
                    type="text"
                    value={recoverySeal}
                    onChange={(e) => setRecoverySeal(e.target.value)}
                    className="w-full mt-1 rounded border border-border bg-background p-2 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-muted-foreground font-semibold">Intake Temp (°C)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={recoveryTemp}
                    onChange={(e) => setRecoveryTemp(e.target.value)}
                    className="w-full mt-1 rounded border border-border bg-background p-2 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setIsRecoveryModalOpen(false)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <Can permission="traceability:quarantine" mode="disable">
                <button
                  onClick={() => handleRecordRecovery(selectedRecall.id)}
                  className="rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90"
                >
                  Verify & Intake to Quarantine
                </button>
              </Can>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: CLOSE RECALL */}
      {isCloseRecallModalOpen && selectedRecall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-marine-mid" />
                Formal Recall Closure Sign-off
              </h3>
              <button onClick={() => setIsCloseRecallModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Closing a recall certifies that 100% of distributed batch <strong>{selectedRecall.affected_lot}</strong> has been reconciled or accounted for, and all corrective actions are verified.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-muted-foreground font-semibold">Closure Justification & Regulatory Summary</label>
                <textarea
                  value={closureNotes}
                  onChange={(e) => setClosureNotes(e.target.value)}
                  placeholder="Detail final mass-balance reconciliation, destruction certificate reference, and health authority notification..."
                  className="w-full mt-1 rounded border border-border bg-background p-2 focus:outline-none"
                  rows={4}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setIsCloseRecallModalOpen(false)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <Can permission="recalls.manage" mode="disable">
                <button
                  onClick={() => handleCloseRecall(selectedRecall.id)}
                  className="rounded-lg bg-marine-steel px-4 py-1.5 text-xs font-bold text-white hover:bg-marine-steelLight"
                >
                  Formally Sign & Close Recall
                </button>
              </Can>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
