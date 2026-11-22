"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  Filter,
  History,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Thermometer,
  XCircle
} from "lucide-react";
import { Badge, Surface as Card } from "@/components/ui";
import { Can } from "@/components/access-gate";
import type {
  CapaStatus,
  CheckResultStatus,
  HaccpCheckpointTemplate,
  QualityCapa,
  QualityDashboardMetrics,
  QualityException,
  QualityHistorySummary,
  QualityInspection,
  QualityInspectionDetail
} from "@/lib/quality-gate";

type ActiveTab = "inspections" | "haccp" | "decisions" | "exceptions" | "capa" | "history";

function statusTone(status: string): "ok" | "warning" | "critical" | "info" | "neutral" {
  const s = (status || "").toLowerCase();
  if (s === "released" || s === "pass" || s === "closed" || s === "resolved") return "ok";
  if (s === "partially_released" || s === "in progress" || s === "pending verification" || s === "capa_assigned") return "info";
  if (s === "pending" || s === "on_hold" || s === "investigating" || s === "open") return "warning";
  if (s === "rejected" || s === "quarantined" || s === "fail" || s === "critical") return "critical";
  return "neutral";
}

export function QualityGateWorkbench() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("inspections");
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const [metrics, setMetrics] = useState<QualityDashboardMetrics>({
    pending_inspections: 0,
    goods_on_hold_cases: 0,
    released_cases: 0,
    rejected_cases: 0,
    quarantined_cases: 0,
    failed_haccp_checkpoints: 0,
    open_quality_exceptions: 0,
    overdue_capas: 0,
    total_capas_open: 0
  });

  const [inspections, setInspections] = useState<QualityInspection[]>([]);
  const [inspectionsTotal, setInspectionsTotal] = useState(0);
  const [selectedInspection, setSelectedInspection] = useState<QualityInspectionDetail | null>(null);
  const [templates, setTemplates] = useState<HaccpCheckpointTemplate[]>([]);
  const [exceptions, setExceptions] = useState<QualityException[]>([]);
  const [capas, setCapas] = useState<QualityCapa[]>([]);
  const [historyData, setHistoryData] = useState<QualityHistorySummary | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [warehouseFilter, setWarehouseFilter] = useState("ALL");
  const [page, setPage] = useState(1);

  // New Inspection Modal State
  const [showNewInspection, setShowNewInspection] = useState(false);
  const [newInspForm, setNewInspForm] = useState({
    shipment_reference: "",
    asn_reference: "",
    purchase_order_id: "",
    supplier_name: "Nordic Fjord Seafood AS",
    sku: "SKU-SAL-001",
    product_name: "Norwegian Atlantic Salmon Fillet (Trim D)",
    supplier_batch: "",
    internal_lot: "",
    warehouse: "Milan Cold Hub",
    receiving_location: "RCV-STAGE-01",
    received_qty: "40",
    actual_weight_kg: "200",
    manufacture_date: new Date().toISOString().slice(0, 10),
    expiry_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    temp_reading_c: "1.4",
    visual_inspection: "pass" as CheckResultStatus,
    packaging_condition: "pass" as CheckResultStatus,
    product_condition: "pass" as CheckResultStatus,
    freshness_status: "pass" as CheckResultStatus,
    labelling_status: "pass" as CheckResultStatus,
    traceability_verified: true,
    certificates_verified: true,
    evidence_title: "Receiving Dock Inspection Photo",
    evidence_url: "/evidence/receiving-dock-check.jpg",
    notes: ""
  });

  // HACCP Recording Form State
  const [haccpForm, setHaccpForm] = useState({
    template_id: "HCT-01",
    actual_numeric: "1.6",
    actual_text: "Intact vacuum seal, clean ice pack",
    status: "pass" as "pass" | "fail",
    evidence_title: "Probe Thermometer Reading Photo",
    evidence_url: "/evidence/haccp-probe.jpg",
    notes: ""
  });

  // Custom HACCP Template Form State
  const [newTemplateForm, setNewTemplateForm] = useState({
    code: "",
    checkpoint_name: "",
    description: "",
    ccp_classification: "CCP-2",
    measurement_type: "numeric" as "temperature" | "numeric" | "boolean" | "condition",
    min_limit: "",
    max_limit: "",
    unit: "°C",
    expected_text: ""
  });

  // Decision Form State
  const [decisionForm, setDecisionForm] = useState({
    decision: "released" as "on_hold" | "released" | "partially_released" | "rejected" | "quarantined",
    accepted_qty: "0",
    held_qty: "0",
    rejected_qty: "0",
    quarantined_qty: "0",
    target_location: "CHILL-A1-01",
    reason: "",
    override_resolved_haccp: false
  });

  // Exception Resolution State
  const [selectedException, setSelectedException] = useState<QualityException | null>(null);
  const [exceptionUpdateForm, setExceptionUpdateForm] = useState({
    status: "investigating" as QualityException["status"],
    investigation_notes: "",
    resolution: "",
    evidence_title: "",
    evidence_url: ""
  });

  // CAPA Form State
  const [showNewCapa, setShowNewCapa] = useState(false);
  const [selectedCapa, setSelectedCapa] = useState<QualityCapa | null>(null);
  const [newCapaForm, setNewCapaForm] = useState({
    exception_id: "",
    inspection_id: "",
    supplier_name: "Nordic Fjord Seafood AS",
    sku: "SKU-SAL-001",
    internal_lot: "",
    warehouse: "Milan Cold Hub",
    problem_description: "",
    root_cause: "",
    containment_action: "",
    corrective_action: "",
    preventive_action: "",
    assigned_to_name: "Giulia Romano",
    target_completion_date: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10)
  });

  const [capaUpdateForm, setCapaUpdateForm] = useState({
    status: "In Progress" as CapaStatus,
    root_cause: "",
    containment_action: "",
    corrective_action: "",
    preventive_action: "",
    verification_notes: "",
    effectiveness_review: ""
  });

  // History Search State
  const [historyFilter, setHistoryFilter] = useState({
    lot: "",
    supplier_id: "",
    sku: ""
  });

  const loadInspectionDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/v1/quality/inspections/${encodeURIComponent(id)}`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      if (data.inspection) {
        const insp: QualityInspectionDetail = data.inspection;
        setSelectedInspection(insp);
        setDecisionForm({
          decision: insp.status === "pending" ? "released" : insp.status,
          accepted_qty: String(insp.accepted_qty > 0 ? insp.accepted_qty : insp.status === "pending" ? insp.received_qty : 0),
          held_qty: String(insp.held_qty || 0),
          rejected_qty: String(insp.rejected_qty || 0),
          quarantined_qty: String(insp.quarantined_qty || 0),
          target_location: insp.receiving_location || "CHILL-A1-01",
          reason: insp.decision_reason || "",
          override_resolved_haccp: false
        });
      }
    } catch {
      // ignore
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (warehouseFilter !== "ALL") params.set("warehouse", warehouseFilter);
      params.set("page", String(page));
      params.set("page_size", "20");

      const [dashRes, inspRes] = await Promise.all([
        fetch(`/api/v1/quality/dashboard${warehouseFilter !== "ALL" ? `?warehouse=${encodeURIComponent(warehouseFilter)}` : ""}`, {
          credentials: "include"
        }),
        fetch(`/api/v1/quality/inspections?${params.toString()}`, { credentials: "include" })
      ]);

      if (dashRes.ok) {
        const dash = await dashRes.json();
        if (dash.metrics) setMetrics(dash.metrics);
        if (dash.haccp_templates) setTemplates(dash.haccp_templates);
        if (dash.exceptions) setExceptions(dash.exceptions);
        if (dash.capas) setCapas(dash.capas);
      }

      if (inspRes.ok) {
        const inspData = await inspRes.json();
        setInspections(inspData.items || []);
        setInspectionsTotal(inspData.total || 0);
        if (inspData.metrics) setMetrics(inspData.metrics);
        if (!selectedInspection && inspData.items && inspData.items.length > 0) {
          await loadInspectionDetail(inspData.items[0].id);
        } else if (selectedInspection) {
          await loadInspectionDetail(selectedInspection.id);
        }
      }
    } catch (err) {
      setBanner({ type: "error", text: err instanceof Error ? err.message : "Failed to load Quality Gate data." });
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter, warehouseFilter, page, selectedInspection, loadInspectionDetail]);

  useEffect(() => {
    void loadDashboard();
  }, [statusFilter, warehouseFilter, page]);

  async function handleCreateInspection(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    try {
      const res = await fetch("/api/v1/quality/inspections", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `insp-create-${Date.now()}`
        },
        credentials: "include",
        body: JSON.stringify({
          ...newInspForm,
          received_qty: Number(newInspForm.received_qty),
          actual_weight_kg: newInspForm.actual_weight_kg ? Number(newInspForm.actual_weight_kg) : null,
          temp_reading_c: newInspForm.temp_reading_c !== "" ? Number(newInspForm.temp_reading_c) : null,
          weight_verified: true,
          quantity_verified: true,
          evidence: newInspForm.evidence_title
            ? [{ title: newInspForm.evidence_title, file_type: "photo", file_url: newInspForm.evidence_url }]
            : []
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Failed to create inspection.");
      }
      setShowNewInspection(false);
      setSelectedInspection(data.inspection);
      setBanner({
        type: "ok",
        text: `Created receiving inspection ${data.inspection.inspection_number} for lot ${data.inspection.internal_lot} (${data.inspection.status}).`
      });
      await loadDashboard();
    } catch (err) {
      setBanner({ type: "error", text: err instanceof Error ? err.message : "Failed to create inspection." });
    }
  }

  async function handleUpdateInspectionChecklist(patch: Record<string, unknown>) {
    if (!selectedInspection) return;
    setBanner(null);
    try {
      const res = await fetch(`/api/v1/quality/inspections/${encodeURIComponent(selectedInspection.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `insp-upd-${Date.now()}`
        },
        credentials: "include",
        body: JSON.stringify(patch)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Failed to update inspection.");
      }
      setSelectedInspection(data.inspection);
      setBanner({ type: "ok", text: `Updated inspection ${data.inspection.inspection_number}.` });
      await loadDashboard();
    } catch (err) {
      setBanner({ type: "error", text: err instanceof Error ? err.message : "Failed to update inspection." });
    }
  }

  async function handleRecordHaccp(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedInspection) {
      setBanner({ type: "error", text: "Select an inspection first before recording a HACCP checkpoint." });
      return;
    }
    setBanner(null);
    try {
      const res = await fetch(`/api/v1/quality/inspections/${encodeURIComponent(selectedInspection.id)}/haccp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `haccp-rec-${Date.now()}`
        },
        credentials: "include",
        body: JSON.stringify({
          template_id: haccpForm.template_id,
          actual_numeric: haccpForm.actual_numeric !== "" ? Number(haccpForm.actual_numeric) : null,
          actual_text: haccpForm.actual_text,
          status: haccpForm.status,
          notes: haccpForm.notes,
          evidence: haccpForm.evidence_title
            ? [{ title: haccpForm.evidence_title, file_type: "photo", file_url: haccpForm.evidence_url }]
            : []
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Failed to record HACCP reading.");
      }
      setSelectedInspection(data.inspection);
      setBanner({
        type: data.reading.status === "fail" ? "error" : "ok",
        text:
          data.reading.status === "fail"
            ? `HACCP Checkpoint ${data.reading.checkpoint_code} FAILED! Lot ${data.inspection.internal_lot} automatically blocked on QA Hold and Exception ${data.exception_created?.exception_number || ""} created.`
            : `HACCP Checkpoint ${data.reading.checkpoint_code} recorded as PASS.`
      });
      await loadDashboard();
    } catch (err) {
      setBanner({ type: "error", text: err instanceof Error ? err.message : "Failed to record HACCP reading." });
    }
  }

  async function handleCreateTemplate(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    try {
      const res = await fetch("/api/v1/quality/haccp-templates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `tpl-create-${Date.now()}`
        },
        credentials: "include",
        body: JSON.stringify({
          ...newTemplateForm,
          min_limit: newTemplateForm.min_limit !== "" ? Number(newTemplateForm.min_limit) : null,
          max_limit: newTemplateForm.max_limit !== "" ? Number(newTemplateForm.max_limit) : null
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || "Failed to create HACCP template.");
      setBanner({ type: "ok", text: `Created configurable HACCP template ${data.template.code}.` });
      setNewTemplateForm({
        code: "",
        checkpoint_name: "",
        description: "",
        ccp_classification: "CCP-2",
        measurement_type: "numeric",
        min_limit: "",
        max_limit: "",
        unit: "°C",
        expected_text: ""
      });
      await loadDashboard();
    } catch (err) {
      setBanner({ type: "error", text: err instanceof Error ? err.message : "Failed to create HACCP template." });
    }
  }

  async function handleSubmitDecision(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedInspection) return;
    setBanner(null);
    try {
      const res = await fetch(`/api/v1/quality/inspections/${encodeURIComponent(selectedInspection.id)}/decision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `qg-dec-${selectedInspection.id}-${Date.now()}`
        },
        credentials: "include",
        body: JSON.stringify({
          decision: decisionForm.decision,
          accepted_qty: Number(decisionForm.accepted_qty),
          held_qty: Number(decisionForm.held_qty),
          rejected_qty: Number(decisionForm.rejected_qty),
          quarantined_qty: Number(decisionForm.quarantined_qty),
          target_location: decisionForm.target_location,
          reason: decisionForm.reason,
          override_resolved_haccp: decisionForm.override_resolved_haccp
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Quality Gate decision failed.");
      }
      setSelectedInspection(data.inspection);
      setBanner({
        type: "ok",
        text: `Quality decision '${data.inspection.status}' applied to lot ${data.inspection.internal_lot}: Accepted=${data.inspection.accepted_qty}, Held=${data.inspection.held_qty}, Rejected=${data.inspection.rejected_qty}, Quarantined=${data.inspection.quarantined_qty}.`
      });
      await loadDashboard();
    } catch (err) {
      setBanner({ type: "error", text: err instanceof Error ? err.message : "Failed to apply decision." });
    }
  }

  async function handleUpdateException(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedException) return;
    setBanner(null);
    try {
      const res = await fetch(`/api/v1/quality/exceptions/${encodeURIComponent(selectedException.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `exc-upd-${Date.now()}`
        },
        credentials: "include",
        body: JSON.stringify({
          status: exceptionUpdateForm.status,
          investigation_notes: exceptionUpdateForm.investigation_notes,
          resolution: exceptionUpdateForm.resolution,
          evidence: exceptionUpdateForm.evidence_title
            ? [{ title: exceptionUpdateForm.evidence_title, file_type: "document", file_url: exceptionUpdateForm.evidence_url || "/evidence/investigation.pdf" }]
            : undefined
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || "Failed to update exception.");
      setSelectedException(data.exception);
      setBanner({ type: "ok", text: `Exception ${data.exception.exception_number} updated (${data.exception.status}).` });
      await loadDashboard();
    } catch (err) {
      setBanner({ type: "error", text: err instanceof Error ? err.message : "Failed to update exception." });
    }
  }

  async function handleCreateCapa(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    try {
      const res = await fetch("/api/v1/quality/capas", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `capa-create-${Date.now()}`
        },
        credentials: "include",
        body: JSON.stringify(newCapaForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || "Failed to create CAPA.");
      setShowNewCapa(false);
      setSelectedCapa(data.capa);
      setBanner({ type: "ok", text: `Created CAPA ${data.capa.capa_number} assigned to ${data.capa.assigned_to_name}.` });
      await loadDashboard();
    } catch (err) {
      setBanner({ type: "error", text: err instanceof Error ? err.message : "Failed to create CAPA." });
    }
  }

  async function handleUpdateCapa(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCapa) return;
    setBanner(null);
    try {
      const res = await fetch(`/api/v1/quality/capas/${encodeURIComponent(selectedCapa.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `capa-upd-${Date.now()}`
        },
        credentials: "include",
        body: JSON.stringify(capaUpdateForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || "Failed to update CAPA.");
      setSelectedCapa(data.capa);
      setBanner({ type: "ok", text: `CAPA ${data.capa.capa_number} updated to status '${data.capa.status}'.` });
      await loadDashboard();
    } catch (err) {
      setBanner({ type: "error", text: err instanceof Error ? err.message : "Failed to update CAPA." });
    }
  }

  async function handleSearchHistory(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setBanner(null);
    try {
      const params = new URLSearchParams();
      if (historyFilter.lot.trim()) params.set("lot", historyFilter.lot.trim());
      if (historyFilter.supplier_id.trim()) params.set("supplier_id", historyFilter.supplier_id.trim());
      if (historyFilter.sku.trim()) params.set("sku", historyFilter.sku.trim());
      const res = await fetch(`/api/v1/quality/history?${params.toString()}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || "Failed to load quality history.");
      setHistoryData(data);
    } catch (err) {
      setBanner({ type: "error", text: err instanceof Error ? err.message : "Failed to load quality history." });
    }
  }

  return (
    <div className="space-y-6">
      {/* Top KPI Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Card className="p-3.5">
          <div className="flex items-center justify-between text-xs text-marine-mid/55">
            <span>Pending Inspections</span>
            <ClipboardCheck className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-marine-navy">{metrics.pending_inspections}</div>
          <div className="mt-0.5 text-[11px] text-marine-mid/55">Awaiting QA sign-off</div>
        </Card>

        <Card className="p-3.5">
          <div className="flex items-center justify-between text-xs text-marine-mid/55">
            <span>Goods On Hold</span>
            <Lock className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-amber-700">{metrics.goods_on_hold_cases}</div>
          <div className="mt-0.5 text-[11px] text-marine-mid/55">Cases blocked from FEFO</div>
        </Card>

        <Card className="p-3.5">
          <div className="flex items-center justify-between text-xs text-marine-mid/55">
            <span>Released Quantities</span>
            <CheckCircle2 className="h-4 w-4 text-marine-mid" />
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-marine-mid">{metrics.released_cases}</div>
          <div className="mt-0.5 text-[11px] text-marine-mid/55">QA-approved cases</div>
        </Card>

        <Card className="p-3.5">
          <div className="flex items-center justify-between text-xs text-marine-mid/55">
            <span>Rejected / Quar.</span>
            <XCircle className="h-4 w-4 text-rose-600" />
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-rose-700">
            {metrics.rejected_cases} / {metrics.quarantined_cases}
          </div>
          <div className="mt-0.5 text-[11px] text-marine-mid/55">Rejected / Quarantined cases</div>
        </Card>

        <Card className="p-3.5">
          <div className="flex items-center justify-between text-xs text-marine-mid/55">
            <span>Failed HACCP</span>
            <Thermometer className="h-4 w-4 text-rose-600" />
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-rose-700">{metrics.failed_haccp_checkpoints}</div>
          <div className="mt-0.5 text-[11px] text-marine-mid/55">CCP / limit violations</div>
        </Card>

        <Card className="p-3.5">
          <div className="flex items-center justify-between text-xs text-marine-mid/55">
            <span>Open Exceptions</span>
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-amber-700">{metrics.open_quality_exceptions}</div>
          <div className="mt-0.5 text-[11px] text-marine-mid/55">Active excursions</div>
        </Card>

        <Card className="p-3.5">
          <div className="flex items-center justify-between text-xs text-marine-mid/55">
            <span>Overdue CAPAs</span>
            <ShieldAlert className="h-4 w-4 text-rose-600" />
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-rose-700">
            {metrics.overdue_capas}{" "}
            <span className="text-xs font-normal text-marine-mid/55">({metrics.total_capas_open} open)</span>
          </div>
          <div className="mt-0.5 text-[11px] text-marine-mid/55">Past target completion</div>
        </Card>
      </div>

      {banner && (
        <div
          className={`flex items-center justify-between rounded-lg border px-4 py-3 text-sm ${
            banner.type === "ok"
              ? "border-marine-ocean/60 bg-marine-ocean/20 text-marine-navy"
              : "border-rose-200 bg-rose-50 text-rose-900"
          }`}
        >
          <span>{banner.text}</span>
          <button onClick={() => setBanner(null)} className="ml-4 text-xs font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Module Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-marine-ocean/60 pb-3">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: "inspections", label: "1. Receiving Inspections", icon: ClipboardCheck },
              { id: "haccp", label: "2. HACCP Checkpoints", icon: Thermometer },
              { id: "decisions", label: "3. Hold / Release / Reject Gate", icon: ShieldCheck },
              { id: "exceptions", label: `4. Excursion Exceptions (${exceptions.length})`, icon: AlertTriangle },
              { id: "capa", label: `5. CAPA Management (${capas.length})`, icon: FileCheck2 },
              { id: "history", label: "6. Lot & Supplier Quality History", icon: History }
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id === "history" && !historyData) {
                    void handleSearchHistory();
                  }
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition ${
                  activeTab === tab.id
                    ? "bg-slate-900 text-white shadow-sm"
                    : "bg-white text-marine-mid/80 hover:bg-black/[0.04] border border-marine-ocean/60"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNewInspection(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-marine-steel px-3 py-2 text-xs font-medium text-white hover:bg-marine-steelLight"
          >
            <Plus className="h-3.5 w-3.5" />
            New Receiving Inspection
          </button>
          <button
            onClick={() => void loadDashboard()}
            className="inline-flex items-center gap-1 rounded-lg border border-marine-ocean/60 bg-white px-2.5 py-2 text-xs text-marine-mid/80 hover:bg-marine-ocean/15"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* New Receiving Inspection Modal */}
      {showNewInspection && (
        <Card className="border-marine-ocean/60 bg-marine-ocean/20/40 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-marine-navy">Register Incoming Receiving Quality Inspection</h3>
            <button onClick={() => setShowNewInspection(false)} className="text-xs text-marine-mid/55 hover:text-marine-mid/90">
              Cancel
            </button>
          </div>
          <form onSubmit={handleCreateInspection} className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-marine-mid/80">SKU *</label>
              <input
                required
                value={newInspForm.sku}
                onChange={(e) => setNewInspForm({ ...newInspForm, sku: e.target.value })}
                className="mt-1 w-full rounded-md border border-marine-ocean/70 px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-marine-mid/80">Product Name</label>
              <input
                value={newInspForm.product_name}
                onChange={(e) => setNewInspForm({ ...newInspForm, product_name: e.target.value })}
                className="mt-1 w-full rounded-md border border-marine-ocean/70 px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-marine-mid/80">Supplier Batch *</label>
              <input
                required
                placeholder="e.g. SUP-B-2026-88"
                value={newInspForm.supplier_batch}
                onChange={(e) => setNewInspForm({ ...newInspForm, supplier_batch: e.target.value })}
                className="mt-1 w-full rounded-md border border-marine-ocean/70 px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-marine-mid/80">Internal Lot *</label>
              <input
                required
                placeholder="e.g. LOT-2026-SAL-901"
                value={newInspForm.internal_lot}
                onChange={(e) => setNewInspForm({ ...newInspForm, internal_lot: e.target.value })}
                className="mt-1 w-full rounded-md border border-marine-ocean/70 px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-marine-mid/80">Shipment / ASN Reference</label>
              <input
                placeholder="IB-2026-101 / ASN-99"
                value={newInspForm.shipment_reference}
                onChange={(e) => setNewInspForm({ ...newInspForm, shipment_reference: e.target.value })}
                className="mt-1 w-full rounded-md border border-marine-ocean/70 px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-marine-mid/80">Purchase Order</label>
              <input
                placeholder="PO-2026-0841"
                value={newInspForm.purchase_order_id}
                onChange={(e) => setNewInspForm({ ...newInspForm, purchase_order_id: e.target.value })}
                className="mt-1 w-full rounded-md border border-marine-ocean/70 px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-marine-mid/80">Supplier</label>
              <input
                value={newInspForm.supplier_name}
                onChange={(e) => setNewInspForm({ ...newInspForm, supplier_name: e.target.value })}
                className="mt-1 w-full rounded-md border border-marine-ocean/70 px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-marine-mid/80">Warehouse & Location</label>
              <div className="mt-1 flex gap-1">
                <input
                  value={newInspForm.warehouse}
                  onChange={(e) => setNewInspForm({ ...newInspForm, warehouse: e.target.value })}
                  className="w-2/3 rounded-md border border-marine-ocean/70 px-2 py-1.5 text-xs"
                />
                <input
                  value={newInspForm.receiving_location}
                  onChange={(e) => setNewInspForm({ ...newInspForm, receiving_location: e.target.value })}
                  className="w-1/3 rounded-md border border-marine-ocean/70 px-2 py-1.5 text-xs"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-marine-mid/80">Received Qty (cases) *</label>
              <input
                type="number"
                required
                min="1"
                value={newInspForm.received_qty}
                onChange={(e) => setNewInspForm({ ...newInspForm, received_qty: e.target.value })}
                className="mt-1 w-full rounded-md border border-marine-ocean/70 px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-marine-mid/80">Measured Temp (°C)</label>
              <input
                type="number"
                step="0.1"
                value={newInspForm.temp_reading_c}
                onChange={(e) => setNewInspForm({ ...newInspForm, temp_reading_c: e.target.value })}
                className="mt-1 w-full rounded-md border border-marine-ocean/70 px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-marine-mid/80">Manufacture Date</label>
              <input
                type="date"
                value={newInspForm.manufacture_date}
                onChange={(e) => setNewInspForm({ ...newInspForm, manufacture_date: e.target.value })}
                className="mt-1 w-full rounded-md border border-marine-ocean/70 px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-marine-mid/80">Expiry Date *</label>
              <input
                type="date"
                required
                value={newInspForm.expiry_date}
                onChange={(e) => setNewInspForm({ ...newInspForm, expiry_date: e.target.value })}
                className="mt-1 w-full rounded-md border border-marine-ocean/70 px-2.5 py-1.5 text-xs"
              />
            </div>
            <div className="sm:col-span-3 lg:col-span-4 flex justify-end gap-2 pt-2">
              <Can permission="quality.inspect" mode="disable">
                <button
                  type="submit"
                  className="rounded-lg bg-marine-steel px-4 py-2 text-xs font-semibold text-white hover:bg-marine-steelLight"
                >
                  Create Receiving Inspection
                </button>
              </Can>
            </div>
          </form>
        </Card>
      )}

      {/* TAB 1: RECEIVING INSPECTIONS */}
      {activeTab === "inspections" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-7">
            <Card className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    placeholder="Search lot, SKU, supplier, PO, shipment..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void loadDashboard()}
                    className="w-full rounded-lg border border-marine-ocean/60 pl-8 pr-3 py-1.5 text-xs"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Filter className="h-3.5 w-3.5 text-slate-400" />
                  <select
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value);
                      setPage(1);
                    }}
                    className="rounded-lg border border-marine-ocean/60 px-2.5 py-1.5 text-xs"
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="pending">Pending</option>
                    <option value="on_hold">On Hold</option>
                    <option value="released">Released</option>
                    <option value="partially_released">Partially Released</option>
                    <option value="rejected">Rejected</option>
                    <option value="quarantined">Quarantined</option>
                  </select>
                  <button
                    onClick={() => void loadDashboard()}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
                  >
                    Search
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-marine-ocean/60 text-[11px] uppercase text-marine-mid/55">
                      <th className="py-2 pr-2">Inspection / Lot</th>
                      <th className="py-2 pr-2">Product & Supplier</th>
                      <th className="py-2 pr-2">Temp</th>
                      <th className="py-2 pr-2">Qty Split</th>
                      <th className="py-2">Decision Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {inspections.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-marine-mid/55">
                          No receiving inspections match the current filters.
                        </td>
                      </tr>
                    ) : (
                      inspections.map((insp) => {
                        const isSelected = selectedInspection?.id === insp.id;
                        return (
                          <tr
                            key={insp.id}
                            onClick={() => void loadInspectionDetail(insp.id)}
                            className={`cursor-pointer transition ${
                              isSelected ? "bg-slate-900/5 font-medium" : "hover:bg-marine-ocean/15"
                            }`}
                          >
                            <td className="py-2.5 pr-2">
                              <div className="font-semibold text-marine-navy">{insp.inspection_number}</div>
                              <div className="text-[11px] text-marine-mid/55">
                                Lot: <span className="font-mono">{insp.internal_lot}</span>
                              </div>
                            </td>
                            <td className="py-2.5 pr-2">
                              <div className="text-marine-navy">{insp.product_name}</div>
                              <div className="text-[11px] text-marine-mid/55">
                                {insp.sku} · {insp.supplier_name}
                              </div>
                            </td>
                            <td className="py-2.5 pr-2">
                              {insp.temp_reading_c !== null ? (
                                <span
                                  className={
                                    insp.temp_status === "fail"
                                      ? "font-semibold text-rose-700"
                                      : "text-marine-mid"
                                  }
                                >
                                  {insp.temp_reading_c}°C
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                              <div className="text-[10px] text-slate-400">
                                Limit: {insp.temp_min_c ?? 0}..{insp.temp_max_c ?? 4}°C
                              </div>
                            </td>
                            <td className="py-2.5 pr-2 text-[11px]">
                              <div>Rcv: {insp.received_qty}</div>
                              <div className="text-marine-mid/55">
                                Rel: {insp.accepted_qty} | Hold: {insp.held_qty} | Rej: {insp.rejected_qty}
                              </div>
                            </td>
                            <td className="py-2.5">
                              <Badge tone={statusTone(insp.status)}>{insp.status.replace("_", " ")}</Badge>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-marine-mid/55">
                <span>
                  Showing {inspections.length} of {inspectionsTotal} inspections
                </span>
                <div className="flex gap-1.5">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded border border-marine-ocean/60 px-2.5 py-1 disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    disabled={page * 20 >= inspectionsTotal}
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded border border-marine-ocean/60 px-2.5 py-1 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </Card>
          </div>

          {/* Inspection Detail & Checklist */}
          <div className="space-y-4 lg:col-span-5">
            {selectedInspection ? (
              <Card className="p-4 space-y-4">
                <div className="flex items-start justify-between border-b border-slate-100 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-marine-navy">
                        {selectedInspection.inspection_number}
                      </h3>
                      <Badge tone={statusTone(selectedInspection.status)}>
                        {selectedInspection.status.replace("_", " ")}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-marine-mid/55">
                      {selectedInspection.product_name} ({selectedInspection.sku}) · Lot{" "}
                      <span className="font-mono font-medium text-marine-mid/90">{selectedInspection.internal_lot}</span>
                    </p>
                  </div>
                  <div className="text-right text-[11px] text-marine-mid/55">
                    <div>Warehouse: {selectedInspection.warehouse}</div>
                    <div>Bin: {selectedInspection.receiving_location}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 rounded-lg bg-marine-ocean/15 p-3 text-xs">
                  <div>
                    <span className="text-marine-mid/55">Supplier:</span>{" "}
                    <span className="font-medium text-marine-navy">{selectedInspection.supplier_name}</span>
                  </div>
                  <div>
                    <span className="text-marine-mid/55">Supplier Batch:</span>{" "}
                    <span className="font-mono text-marine-navy">{selectedInspection.supplier_batch}</span>
                  </div>
                  <div>
                    <span className="text-marine-mid/55">PO / ASN:</span>{" "}
                    <span className="font-medium text-marine-navy">
                      {selectedInspection.purchase_order_id || "—"} / {selectedInspection.asn_reference || "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-marine-mid/55">Expiry Date:</span>{" "}
                    <span className="font-medium text-marine-navy">{selectedInspection.expiry_date}</span>
                  </div>
                  <div>
                    <span className="text-marine-mid/55">Temp Measured:</span>{" "}
                    <span className="font-semibold">
                      {selectedInspection.temp_reading_c !== null ? `${selectedInspection.temp_reading_c}°C` : "Pending"}{" "}
                      (Allowed {selectedInspection.temp_min_c}..{selectedInspection.temp_max_c}°C)
                    </span>
                  </div>
                  <div>
                    <span className="text-marine-mid/55">Inspector:</span>{" "}
                    <span className="font-medium text-marine-navy">{selectedInspection.inspector_name || "Pending"}</span>
                  </div>
                </div>

                {/* Physical & Hygiene Inspection Controls */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-marine-mid/90">Receiving Quality Checklist</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {(
                      [
                        { key: "visual_inspection", label: "Visual Inspection" },
                        { key: "packaging_condition", label: "Packaging Condition" },
                        { key: "product_condition", label: "Product Condition" },
                        { key: "freshness_status", label: "Freshness & Odor" },
                        { key: "labelling_status", label: "Labelling & Lot Code" }
                      ] as const
                    ).map((field) => (
                      <div key={field.key} className="flex items-center justify-between rounded border border-marine-ocean/60 px-2.5 py-1.5">
                        <span className="text-marine-mid/80">{field.label}</span>
                        <Can permission="quality.inspect" mode="disable">
                          <select
                            value={selectedInspection[field.key]}
                            onChange={(e) => void handleUpdateInspectionChecklist({ [field.key]: e.target.value })}
                            className="rounded border border-marine-ocean/60 px-1.5 py-0.5 text-xs font-medium"
                          >
                            <option value="pending">Pending</option>
                            <option value="pass">Pass</option>
                            <option value="fail">Fail</option>
                          </select>
                        </Can>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Evidence & Certificates */}
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-marine-mid/90">
                    Required Certificates & Supporting Evidence ({selectedInspection.evidence.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedInspection.required_certificates.map((cert) => (
                      <span
                        key={cert}
                        className="inline-flex items-center gap-1 rounded-full bg-marine-ocean/20 px-2.5 py-0.5 text-[11px] font-medium text-marine-mid/90 border border-marine-ocean/60"
                      >
                        <CheckCircle2 className="h-3 w-3" /> {cert}
                      </span>
                    ))}
                  </div>
                  {selectedInspection.evidence.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {selectedInspection.evidence.map((ev) => (
                        <div key={ev.id} className="flex items-center justify-between rounded bg-marine-ocean/15 px-2.5 py-1.5 text-[11px]">
                          <span className="font-medium text-marine-mid/90">{ev.title} ({ev.file_type})</span>
                          <span className="font-mono text-marine-mid/55">{ev.file_url}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
                  <button
                    onClick={() => setActiveTab("haccp")}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
                  >
                    Record HACCP Checkpoints ({selectedInspection.haccp_readings.length})
                  </button>
                  <button
                    onClick={() => setActiveTab("decisions")}
                    className="rounded-lg bg-marine-steel px-3 py-1.5 text-xs font-medium text-white"
                  >
                    Open Hold / Release Gate
                  </button>
                </div>
              </Card>
            ) : (
              <Card className="p-8 text-center text-xs text-marine-mid/55">
                Select an inspection from the list to view or record quality details.
              </Card>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: CONFIGURABLE HACCP CHECKPOINTS */}
      {activeTab === "haccp" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-6">
            <Card className="p-4 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-marine-navy">Record HACCP Checkpoint Reading</h3>
                <p className="text-xs text-marine-mid/55">
                  {selectedInspection
                    ? `Target Inspection: ${selectedInspection.inspection_number} · ${selectedInspection.product_name} (${selectedInspection.sku}) · Product Temp Limits: ${selectedInspection.temp_min_c}..${selectedInspection.temp_max_c}°C`
                    : "Select an inspection in Tab 1 first."}
                </p>
              </div>

              <form onSubmit={handleRecordHaccp} className="space-y-3 text-xs">
                <div>
                  <label className="block font-medium text-marine-mid/80">HACCP Checkpoint Template *</label>
                  <select
                    value={haccpForm.template_id}
                    onChange={(e) => setHaccpForm({ ...haccpForm, template_id: e.target.value })}
                    className="mt-1 w-full rounded-md border border-marine-ocean/70 px-2.5 py-2 text-xs"
                  >
                    {templates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        [{tpl.code}] {tpl.checkpoint_name} ({tpl.ccp_classification}) — Limits:{" "}
                        {tpl.min_limit !== null ? `${tpl.min_limit}..${tpl.max_limit} ${tpl.unit || ""}` : tpl.expected_text}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-marine-mid/80">Actual Numeric Value (if applicable)</label>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="e.g. 1.5 or 7.8"
                      value={haccpForm.actual_numeric}
                      onChange={(e) => setHaccpForm({ ...haccpForm, actual_numeric: e.target.value })}
                      className="mt-1 w-full rounded-md border border-marine-ocean/70 px-2.5 py-1.5"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-marine-mid/80">Pass / Fail Assessment</label>
                    <select
                      value={haccpForm.status}
                      onChange={(e) => setHaccpForm({ ...haccpForm, status: e.target.value as "pass" | "fail" })}
                      className="mt-1 w-full rounded-md border border-marine-ocean/70 px-2.5 py-1.5"
                    >
                      <option value="pass">PASS (Within Critical Limits)</option>
                      <option value="fail">FAIL (Critical Limit Violation — Auto Block Stock)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block font-medium text-marine-mid/80">Observed Condition / Notes</label>
                  <input
                    value={haccpForm.actual_text}
                    onChange={(e) => setHaccpForm({ ...haccpForm, actual_text: e.target.value })}
                    className="mt-1 w-full rounded-md border border-marine-ocean/70 px-2.5 py-1.5"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-marine-mid/80">Evidence Title</label>
                    <input
                      value={haccpForm.evidence_title}
                      onChange={(e) => setHaccpForm({ ...haccpForm, evidence_title: e.target.value })}
                      className="mt-1 w-full rounded-md border border-marine-ocean/70 px-2.5 py-1.5"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-marine-mid/80">Evidence Photo / Document URL</label>
                    <input
                      value={haccpForm.evidence_url}
                      onChange={(e) => setHaccpForm({ ...haccpForm, evidence_url: e.target.value })}
                      className="mt-1 w-full rounded-md border border-marine-ocean/70 px-2.5 py-1.5"
                    />
                  </div>
                </div>

                <Can permission="quality.inspect" mode="disable">
                  <button
                    type="submit"
                    className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    Record Immutable HACCP Reading
                  </button>
                </Can>
              </form>

              {/* Recorded Readings List */}
              <div className="border-t border-slate-100 pt-3">
                <h4 className="mb-2 text-xs font-semibold text-marine-mid/90">
                  Immutable HACCP Readings for {selectedInspection?.inspection_number || "Selected Inspection"}
                </h4>
                {selectedInspection?.haccp_readings && selectedInspection.haccp_readings.length > 0 ? (
                  <div className="space-y-2">
                    {selectedInspection.haccp_readings.map((r) => (
                      <div key={r.id} className="rounded-lg border border-marine-ocean/60 p-2.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-marine-navy">
                            {r.checkpoint_code} · {r.checkpoint_name} ({r.ccp_classification})
                          </span>
                          <Badge tone={statusTone(r.status)}>
                            {r.status.toUpperCase()} {r.critical_violation ? "· CCP VIOLATION" : ""}
                          </Badge>
                        </div>
                        <div className="mt-1 text-marine-navy/65">
                          Measured:{" "}
                          <span className="font-semibold">
                            {r.actual_numeric !== null ? `${r.actual_numeric}${r.unit || ""}` : r.actual_text}
                          </span>{" "}
                          | Acceptable:{" "}
                          {r.min_limit !== null ? `${r.min_limit}..${r.max_limit}${r.unit || ""}` : r.expected_text}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-400">
                          Inspector: {r.inspector_name} · {r.recorded_at} · Immutable Audit Record
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-marine-mid/55">No HACCP readings recorded yet for this inspection.</p>
                )}
              </div>
            </Card>
          </div>

          <div className="space-y-4 lg:col-span-6">
            <Card className="p-4 space-y-4">
              <h3 className="text-sm font-semibold text-marine-navy">Configurable HACCP Templates</h3>
              <div className="space-y-2">
                {templates.map((tpl) => (
                  <div key={tpl.id} className="rounded-lg border border-marine-ocean/60 p-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-marine-navy">
                        {tpl.code} — {tpl.checkpoint_name}
                      </span>
                      <Badge tone={tpl.is_ccp ? "critical" : "info"}>{tpl.ccp_classification}</Badge>
                    </div>
                    <p className="mt-0.5 text-marine-navy/65">{tpl.description}</p>
                    <div className="mt-1 text-[11px] text-marine-mid/55">
                      Type: {tpl.measurement_type} | Default Limits:{" "}
                      {tpl.min_limit !== null ? `${tpl.min_limit} to ${tpl.max_limit} ${tpl.unit || ""}` : tpl.expected_text}
                    </div>
                  </div>
                ))}
              </div>

              <form onSubmit={handleCreateTemplate} className="border-t border-marine-ocean/60 pt-3 space-y-2.5 text-xs">
                <div className="font-semibold text-marine-mid/90">Add Custom HACCP Checkpoint Template</div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    required
                    placeholder="Code (e.g. CCP-4-METAL)"
                    value={newTemplateForm.code}
                    onChange={(e) => setNewTemplateForm({ ...newTemplateForm, code: e.target.value })}
                    className="rounded border border-marine-ocean/70 px-2.5 py-1.5"
                  />
                  <input
                    required
                    placeholder="Checkpoint Name"
                    value={newTemplateForm.checkpoint_name}
                    onChange={(e) => setNewTemplateForm({ ...newTemplateForm, checkpoint_name: e.target.value })}
                    className="rounded border border-marine-ocean/70 px-2.5 py-1.5"
                  />
                  <input
                    placeholder="Min Limit"
                    type="number"
                    step="0.1"
                    value={newTemplateForm.min_limit}
                    onChange={(e) => setNewTemplateForm({ ...newTemplateForm, min_limit: e.target.value })}
                    className="rounded border border-marine-ocean/70 px-2.5 py-1.5"
                  />
                  <input
                    placeholder="Max Limit"
                    type="number"
                    step="0.1"
                    value={newTemplateForm.max_limit}
                    onChange={(e) => setNewTemplateForm({ ...newTemplateForm, max_limit: e.target.value })}
                    className="rounded border border-marine-ocean/70 px-2.5 py-1.5"
                  />
                </div>
                <Can permission="quality.inspect" mode="disable">
                  <button
                    type="submit"
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
                  >
                    Save Template
                  </button>
                </Can>
              </form>
            </Card>
          </div>
        </div>
      )}

      {/* TAB 3: HOLD / RELEASE / REJECT / QUARANTINE DECISION GATE */}
      {activeTab === "decisions" && (
        <Card className="p-5 max-w-3xl">
          {selectedInspection ? (
            <form onSubmit={handleSubmitDecision} className="space-y-4 text-xs">
              <div className="flex items-center justify-between border-b border-marine-ocean/60 pb-3">
                <div>
                  <h3 className="text-sm font-semibold text-marine-navy">
                    Quality Gate Disposition — {selectedInspection.inspection_number}
                  </h3>
                  <p className="text-marine-mid/55">
                    Lot <span className="font-mono font-semibold">{selectedInspection.internal_lot}</span> ·{" "}
                    {selectedInspection.product_name} · Total Received:{" "}
                    <span className="font-semibold text-marine-navy">
                      {selectedInspection.received_qty} {selectedInspection.uom}
                    </span>
                  </p>
                </div>
                <Badge tone={statusTone(selectedInspection.status)}>
                  Current: {selectedInspection.status.replace("_", " ")}
                </Badge>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block font-medium text-marine-mid/80">Primary Quality Decision *</label>
                  <select
                    value={decisionForm.decision}
                    onChange={(e) => {
                      const d = e.target.value as typeof decisionForm.decision;
                      const total = selectedInspection.received_qty;
                      setDecisionForm({
                        ...decisionForm,
                        decision: d,
                        accepted_qty: d === "released" ? String(total) : d === "partially_released" ? String(Math.floor(total / 2)) : "0",
                        held_qty: d === "on_hold" ? String(total) : "0",
                        rejected_qty: d === "rejected" ? String(total) : d === "partially_released" ? String(total - Math.floor(total / 2)) : "0",
                        quarantined_qty: d === "quarantined" ? String(total) : "0"
                      });
                    }}
                    className="mt-1 w-full rounded-md border border-marine-ocean/70 px-2.5 py-2 text-xs font-medium"
                  >
                    <option value="released">Released (Approve Full Batch for FEFO Stock)</option>
                    <option value="partially_released">Partially Released (Split Accepted / Held / Rejected)</option>
                    <option value="on_hold">On Hold (Block Temporarily Pending Investigation)</option>
                    <option value="quarantined">Quarantined (Isolate in Quarantine Cage)</option>
                    <option value="rejected">Rejected (Fail Inspection — Block Permanently)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-marine-mid/80">Target Storage / Isolation Bin *</label>
                  <input
                    required
                    value={decisionForm.target_location}
                    onChange={(e) => setDecisionForm({ ...decisionForm, target_location: e.target.value })}
                    className="mt-1 w-full rounded-md border border-marine-ocean/70 px-2.5 py-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 rounded-lg bg-marine-ocean/15 p-3 border border-marine-ocean/60">
                <div>
                  <label className="block font-semibold text-marine-mid/90">Accepted / Released Qty</label>
                  <input
                    type="number"
                    min="0"
                    max={selectedInspection.received_qty}
                    value={decisionForm.accepted_qty}
                    onChange={(e) => setDecisionForm({ ...decisionForm, accepted_qty: e.target.value })}
                    className="mt-1 w-full rounded border border-marine-ocean/70 bg-white px-2.5 py-1.5 font-semibold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-amber-800">On Hold Qty</label>
                  <input
                    type="number"
                    min="0"
                    max={selectedInspection.received_qty}
                    value={decisionForm.held_qty}
                    onChange={(e) => setDecisionForm({ ...decisionForm, held_qty: e.target.value })}
                    className="mt-1 w-full rounded border border-amber-300 bg-white px-2.5 py-1.5 font-semibold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-rose-800">Rejected Qty</label>
                  <input
                    type="number"
                    min="0"
                    max={selectedInspection.received_qty}
                    value={decisionForm.rejected_qty}
                    onChange={(e) => setDecisionForm({ ...decisionForm, rejected_qty: e.target.value })}
                    className="mt-1 w-full rounded border border-rose-300 bg-white px-2.5 py-1.5 font-semibold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-purple-800">Quarantined Qty</label>
                  <input
                    type="number"
                    min="0"
                    max={selectedInspection.received_qty}
                    value={decisionForm.quarantined_qty}
                    onChange={(e) => setDecisionForm({ ...decisionForm, quarantined_qty: e.target.value })}
                    className="mt-1 w-full rounded border border-purple-300 bg-white px-2.5 py-1.5 font-semibold"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-marine-mid/80">
                  Mandatory QA Decision Reason & Disposition Justification *
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="Provide detailed QA justification for releasing, holding, quarantining, or rejecting these goods..."
                  value={decisionForm.reason}
                  onChange={(e) => setDecisionForm({ ...decisionForm, reason: e.target.value })}
                  className="mt-1 w-full rounded-md border border-marine-ocean/70 p-2.5"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-[11px] text-marine-mid/55">
                  Requires QA Decision Authority (`quality.decide`). Ordinary warehouse roles cannot bypass this gate.
                </span>
                <Can permission="quality.decide" mode="disable">
                  <button
                    type="submit"
                    className="rounded-lg bg-marine-steel px-5 py-2 text-xs font-semibold text-white hover:bg-marine-steelLight"
                  >
                    Execute Quality Gate Decision
                  </button>
                </Can>
              </div>
            </form>
          ) : (
            <p className="text-xs text-marine-mid/55">Select an inspection first.</p>
          )}
        </Card>
      )}

      {/* TAB 4: EXCURSION EVIDENCE & EXCEPTION MANAGEMENT */}
      {activeTab === "exceptions" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-3 lg:col-span-7">
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-marine-navy">
                Quality Exceptions & Cold-Chain Excursions ({exceptions.length})
              </h3>
              <div className="space-y-2.5">
                {exceptions.length === 0 ? (
                  <p className="py-6 text-center text-xs text-marine-mid/55">No quality exceptions recorded.</p>
                ) : (
                  exceptions.map((exc) => (
                    <div
                      key={exc.id}
                      onClick={() => {
                        setSelectedException(exc);
                        setExceptionUpdateForm({
                          status: exc.status,
                          investigation_notes: exc.investigation_notes || "",
                          resolution: exc.resolution || "",
                          evidence_title: "",
                          evidence_url: ""
                        });
                      }}
                      className={`cursor-pointer rounded-lg border p-3 text-xs transition ${
                        selectedException?.id === exc.id
                          ? "border-slate-900 bg-slate-900/5"
                          : "border-marine-ocean/60 hover:bg-marine-ocean/15"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-marine-navy">
                          {exc.exception_number} · {exc.product_name} (Lot {exc.internal_lot})
                        </span>
                        <div className="flex gap-1.5">
                          <Badge tone={statusTone(exc.severity)}>{exc.severity.toUpperCase()}</Badge>
                          <Badge tone={statusTone(exc.status)}>{exc.status}</Badge>
                        </div>
                      </div>
                      <div className="mt-1 text-marine-mid/80">
                        Expected: <span className="font-medium">{exc.expected_limits}</span> | Actual:{" "}
                        <span className="font-semibold text-rose-700">{exc.actual_reading}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-marine-navy/65">{exc.food_safety_impact}</p>
                      <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
                        <span>
                          Location: {exc.warehouse} ({exc.location}) · Responsible: {exc.responsible_person}
                        </span>
                        <span>{exc.detected_at.slice(0, 19).replace("T", " ")}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>

          <div className="space-y-4 lg:col-span-5">
            {selectedException ? (
              <Card className="p-4 space-y-4 text-xs">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                  <div>
                    <h4 className="text-sm font-semibold text-marine-navy">{selectedException.exception_number}</h4>
                    <p className="text-marine-mid/55">
                      Lot {selectedException.internal_lot} · {selectedException.exception_type.replace("_", " ")}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setNewCapaForm({
                        ...newCapaForm,
                        exception_id: selectedException.id,
                        inspection_id: selectedException.inspection_id || "",
                        supplier_name: selectedException.supplier_name || "Approved Supplier",
                        sku: selectedException.sku,
                        internal_lot: selectedException.internal_lot,
                        warehouse: selectedException.warehouse,
                        problem_description: `${selectedException.exception_number}: ${selectedException.actual_reading} vs expected ${selectedException.expected_limits}`
                      });
                      setShowNewCapa(true);
                      setActiveTab("capa");
                    }}
                    className="rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-800"
                  >
                    + Raise Linked CAPA
                  </button>
                </div>

                <form onSubmit={handleUpdateException} className="space-y-3">
                  <div>
                    <label className="block font-medium text-marine-mid/80">Exception Status</label>
                    <select
                      value={exceptionUpdateForm.status}
                      onChange={(e) =>
                        setExceptionUpdateForm({
                          ...exceptionUpdateForm,
                          status: e.target.value as QualityException["status"]
                        })
                      }
                      className="mt-1 w-full rounded border border-marine-ocean/70 px-2.5 py-1.5"
                    >
                      <option value="open">Open</option>
                      <option value="investigating">Investigating</option>
                      <option value="capa_assigned">CAPA Assigned</option>
                      <option value="resolved">Resolved</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-medium text-marine-mid/80">Investigation Notes</label>
                    <textarea
                      rows={2}
                      value={exceptionUpdateForm.investigation_notes}
                      onChange={(e) =>
                        setExceptionUpdateForm({ ...exceptionUpdateForm, investigation_notes: e.target.value })
                      }
                      className="mt-1 w-full rounded border border-marine-ocean/70 p-2"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-marine-mid/80">
                      Documented Resolution (Required for Resolved / Closed)
                    </label>
                    <textarea
                      rows={2}
                      value={exceptionUpdateForm.resolution}
                      onChange={(e) => setExceptionUpdateForm({ ...exceptionUpdateForm, resolution: e.target.value })}
                      className="mt-1 w-full rounded border border-marine-ocean/70 p-2"
                    />
                  </div>

                  <Can anyOf={["quality.inspect", "quality.decide"]} mode="disable">
                    <button
                      type="submit"
                      className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800"
                    >
                      Save Exception Investigation
                    </button>
                  </Can>
                </form>
              </Card>
            ) : (
              <Card className="p-8 text-center text-xs text-marine-mid/55">
                Select a quality exception to inspect excursion evidence, record investigation notes, or raise a CAPA.
              </Card>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: CAPA MANAGEMENT & VERIFICATION */}
      {activeTab === "capa" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowNewCapa((v) => !v)}
              className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white"
            >
              {showNewCapa ? "Close CAPA Form" : "+ Create New CAPA"}
            </button>
          </div>

          {showNewCapa && (
            <Card className="p-4 border-marine-ocean/70 bg-marine-ocean/15">
              <h3 className="mb-3 text-sm font-semibold text-marine-navy">Create Corrective & Preventive Action (CAPA)</h3>
              <form onSubmit={handleCreateCapa} className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
                <div>
                  <label className="block font-medium text-marine-mid/80">Affected Lot</label>
                  <input
                    value={newCapaForm.internal_lot}
                    onChange={(e) => setNewCapaForm({ ...newCapaForm, internal_lot: e.target.value })}
                    className="mt-1 w-full rounded border border-marine-ocean/70 px-2.5 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-marine-mid/80">Assigned Responsible Person *</label>
                  <input
                    required
                    value={newCapaForm.assigned_to_name}
                    onChange={(e) => setNewCapaForm({ ...newCapaForm, assigned_to_name: e.target.value })}
                    className="mt-1 w-full rounded border border-marine-ocean/70 px-2.5 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-marine-mid/80">Target Completion Date *</label>
                  <input
                    type="date"
                    required
                    value={newCapaForm.target_completion_date}
                    onChange={(e) => setNewCapaForm({ ...newCapaForm, target_completion_date: e.target.value })}
                    className="mt-1 w-full rounded border border-marine-ocean/70 px-2.5 py-1.5"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block font-medium text-marine-mid/80">Problem Description *</label>
                  <input
                    required
                    value={newCapaForm.problem_description}
                    onChange={(e) => setNewCapaForm({ ...newCapaForm, problem_description: e.target.value })}
                    className="mt-1 w-full rounded border border-marine-ocean/70 px-2.5 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-marine-mid/80">Root Cause Analysis</label>
                  <textarea
                    rows={2}
                    value={newCapaForm.root_cause}
                    onChange={(e) => setNewCapaForm({ ...newCapaForm, root_cause: e.target.value })}
                    className="mt-1 w-full rounded border border-marine-ocean/70 p-2"
                  />
                </div>
                <div>
                  <label className="block font-medium text-marine-mid/80">Corrective Action</label>
                  <textarea
                    rows={2}
                    value={newCapaForm.corrective_action}
                    onChange={(e) => setNewCapaForm({ ...newCapaForm, corrective_action: e.target.value })}
                    className="mt-1 w-full rounded border border-marine-ocean/70 p-2"
                  />
                </div>
                <div>
                  <label className="block font-medium text-marine-mid/80">Preventive Action</label>
                  <textarea
                    rows={2}
                    value={newCapaForm.preventive_action}
                    onChange={(e) => setNewCapaForm({ ...newCapaForm, preventive_action: e.target.value })}
                    className="mt-1 w-full rounded border border-marine-ocean/70 p-2"
                  />
                </div>
                <div className="sm:col-span-3 flex justify-end">
                  <Can permission="quality.capa" mode="disable">
                    <button type="submit" className="rounded-lg bg-marine-steel px-4 py-2 font-semibold text-white">
                      Create CAPA
                    </button>
                  </Can>
                </div>
              </form>
            </Card>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="space-y-2.5 lg:col-span-7">
              <Card className="p-4">
                <h3 className="mb-3 text-sm font-semibold text-marine-navy">CAPA Register ({capas.length})</h3>
                {capas.length === 0 ? (
                  <p className="py-6 text-center text-xs text-marine-mid/55">No CAPAs registered yet.</p>
                ) : (
                  <div className="space-y-2">
                    {capas.map((c) => (
                      <div
                        key={c.id}
                        onClick={() => {
                          setSelectedCapa(c);
                          setCapaUpdateForm({
                            status: c.status,
                            root_cause: c.root_cause || "",
                            containment_action: c.containment_action || "",
                            corrective_action: c.corrective_action || "",
                            preventive_action: c.preventive_action || "",
                            verification_notes: c.verification_notes || "",
                            effectiveness_review: c.effectiveness_review || ""
                          });
                        }}
                        className={`cursor-pointer rounded-lg border p-3 text-xs ${
                          selectedCapa?.id === c.id
                            ? "border-slate-900 bg-slate-900/5"
                            : "border-marine-ocean/60 hover:bg-marine-ocean/15"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-marine-navy">
                            {c.capa_number} · Lot {c.internal_lot || "N/A"}
                          </span>
                          <div className="flex gap-1.5">
                            {c.is_overdue && <Badge tone="critical">OVERDUE</Badge>}
                            <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                          </div>
                        </div>
                        <p className="mt-1 text-marine-mid/80">{c.problem_description}</p>
                        <div className="mt-1 text-[11px] text-marine-mid/55">
                          Assigned: {c.assigned_to_name} · Target Date: {c.target_completion_date}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            <div className="lg:col-span-5">
              {selectedCapa ? (
                <Card className="p-4 space-y-3 text-xs">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <h4 className="text-sm font-semibold text-marine-navy">
                      Update & Verify {selectedCapa.capa_number}
                    </h4>
                    <Badge tone={statusTone(selectedCapa.status)}>{selectedCapa.status}</Badge>
                  </div>
                  <form onSubmit={handleUpdateCapa} className="space-y-2.5">
                    <div>
                      <label className="block font-medium text-marine-mid/80">Workflow Status</label>
                      <select
                        value={capaUpdateForm.status}
                        onChange={(e) => setCapaUpdateForm({ ...capaUpdateForm, status: e.target.value as CapaStatus })}
                        className="mt-1 w-full rounded border border-marine-ocean/70 px-2.5 py-1.5"
                      >
                        <option value="Open">Open</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Pending Verification">Pending Verification</option>
                        <option value="Closed">Closed (Requires Root Cause + Actions + Verification)</option>
                        <option value="Rejected">Rejected</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-marine-mid/80">Root Cause Analysis *</label>
                      <textarea
                        rows={2}
                        value={capaUpdateForm.root_cause}
                        onChange={(e) => setCapaUpdateForm({ ...capaUpdateForm, root_cause: e.target.value })}
                        className="mt-1 w-full rounded border border-marine-ocean/70 p-2"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-marine-mid/80">Immediate Containment Action</label>
                      <input
                        value={capaUpdateForm.containment_action}
                        onChange={(e) => setCapaUpdateForm({ ...capaUpdateForm, containment_action: e.target.value })}
                        className="mt-1 w-full rounded border border-marine-ocean/70 px-2.5 py-1.5"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-marine-mid/80">Corrective Action *</label>
                      <textarea
                        rows={2}
                        value={capaUpdateForm.corrective_action}
                        onChange={(e) => setCapaUpdateForm({ ...capaUpdateForm, corrective_action: e.target.value })}
                        className="mt-1 w-full rounded border border-marine-ocean/70 p-2"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-marine-mid/80">Preventive Action *</label>
                      <textarea
                        rows={2}
                        value={capaUpdateForm.preventive_action}
                        onChange={(e) => setCapaUpdateForm({ ...capaUpdateForm, preventive_action: e.target.value })}
                        className="mt-1 w-full rounded border border-marine-ocean/70 p-2"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-marine-mid/80">
                        Verification & Effectiveness Review (Required before Closure) *
                      </label>
                      <textarea
                        rows={2}
                        value={capaUpdateForm.effectiveness_review}
                        onChange={(e) =>
                          setCapaUpdateForm({
                            ...capaUpdateForm,
                            effectiveness_review: e.target.value,
                            verification_notes: e.target.value
                          })
                        }
                        className="mt-1 w-full rounded border border-marine-ocean/70 p-2"
                      />
                    </div>
                    <Can permission="quality.capa" mode="disable">
                      <button
                        type="submit"
                        className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-800"
                      >
                        Save & Verify CAPA
                      </button>
                    </Can>
                  </form>
                </Card>
              ) : (
                <Card className="p-8 text-center text-xs text-marine-mid/55">
                  Select a CAPA from the list to update root cause, corrective/preventive actions, and effectiveness verification.
                </Card>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: LOT & SUPPLIER QUALITY HISTORY */}
      {activeTab === "history" && (
        <div className="space-y-4">
          <Card className="p-4">
            <form onSubmit={handleSearchHistory} className="flex flex-wrap items-end gap-3 text-xs">
              <div>
                <label className="block font-medium text-marine-mid/80">Internal Lot / Batch</label>
                <input
                  placeholder="e.g. LOT-2026-SAL-01"
                  value={historyFilter.lot}
                  onChange={(e) => setHistoryFilter({ ...historyFilter, lot: e.target.value })}
                  className="mt-1 rounded border border-marine-ocean/70 px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="block font-medium text-marine-mid/80">Supplier Name / ID</label>
                <input
                  placeholder="e.g. Nordic Fjord"
                  value={historyFilter.supplier_id}
                  onChange={(e) => setHistoryFilter({ ...historyFilter, supplier_id: e.target.value })}
                  className="mt-1 rounded border border-marine-ocean/70 px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="block font-medium text-marine-mid/80">SKU</label>
                <input
                  placeholder="e.g. SKU-SAL-001"
                  value={historyFilter.sku}
                  onChange={(e) => setHistoryFilter({ ...historyFilter, sku: e.target.value })}
                  className="mt-1 rounded border border-marine-ocean/70 px-2.5 py-1.5"
                />
              </div>
              <button type="submit" className="rounded-lg bg-slate-900 px-4 py-1.5 font-semibold text-white">
                Query Quality Genealogy
              </button>
            </form>
          </Card>

          {historyData && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Card className="p-3.5 text-xs">
                <div className="text-marine-mid/55">Inspections Analyzed</div>
                <div className="mt-1 text-xl font-semibold">{historyData.stats.total_inspections}</div>
              </Card>
              <Card className="p-3.5 text-xs">
                <div className="text-marine-mid/55">HACCP Pass Rate</div>
                <div className="mt-1 text-xl font-semibold text-marine-mid">
                  {historyData.stats.haccp_pass_rate_pct}%
                </div>
              </Card>
              <Card className="p-3.5 text-xs">
                <div className="text-marine-mid/55">Recurring Exceptions</div>
                <div className="mt-1 text-xl font-semibold text-amber-700">
                  {historyData.stats.recurring_exception_count}
                </div>
              </Card>
              <Card className="p-3.5 text-xs">
                <div className="text-marine-mid/55">Open CAPAs</div>
                <div className="mt-1 text-xl font-semibold text-rose-700">{historyData.stats.open_capa_count}</div>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
