"use client";

import { useEffect, useState } from "react";
import { BarcodeMatchStrip } from "@/components/barcode-match-strip";
import { Badge, SectionHeader, Surface, statusTone } from "@/components/ui";
import { Can, ViewOnlyBadge } from "@/components/access-gate";
import { titleCase } from "@/lib/format";
import {
  INBOUND_DOCUMENT_TYPES,
  INBOUND_QUALITY_CHECK_TYPES,
  INBOUND_SHIPMENT_STATUSES,
  inboundStatusTone,
  type InboundShipment,
  type InboundShipmentDetail
} from "@/lib/inbound";
import type { Product, Supplier } from "@/lib/types";
import type { PurchaseOrderRecord } from "@/server/services/master-data.service";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileCheck2,
  History,
  PackageCheck,
  Plus,
  Scale,
  Search,
  ShieldAlert,
  Thermometer,
  Trash2,
  Truck,
  Upload,
  XCircle
} from "lucide-react";

interface InboundWorkbenchProps {
  initialShipments: InboundShipment[];
  suppliers?: Supplier[];
  products?: Product[];
  purchaseOrders?: PurchaseOrderRecord[];
}

interface ReceivingBatchDraft {
  supplier_batch: string;
  internal_lot: string;
  manufacture_date: string;
  expiry_date: string;
  origin: string;
  quantity: string;
  unit: string;
  storage: string;
}

interface ReceivingItemDraft {
  sku: string;
  product_name: string;
  ordered_qty: number;
  ordered_uom: string;
  received_qty: string;
  accepted_qty: string;
  rejected_qty: string;
  damaged_qty: string;
  packages: string;
  expected_weight: string;
  actual_weight: string;
  weight_uom: string;
  weight_tolerance_pct: string;
  scale_reference: string;
  notes: string;
  batches: ReceivingBatchDraft[];
}

const WAREHOUSE_OPTIONS = ["Milan Cold Hub", "Rome Hub", "Turin Distribution Center", "Bologna Hub"];
const BIN_OPTIONS = ["Receiving Dock", "COLD-A1", "COLD-A2", "FROZEN-F1", "AMBIENT-B1", "Quarantine"];

function defaultExpiryDate(days = 45): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function InboundWorkbench({
  initialShipments,
  suppliers = [],
  products = [],
  purchaseOrders = []
}: InboundWorkbenchProps) {
  const [shipments, setShipments] = useState<InboundShipment[]>(initialShipments || []);
  const [total, setTotal] = useState<number>(initialShipments?.length || 0);
  const [page, setPage] = useState<number>(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(initialShipments?.[0]?.id || null);
  const [detail, setDetail] = useState<InboundShipmentDetail | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"overview" | "receiving" | "temperature" | "documents" | "quality" | "history">("overview");
  const [highlightSku, setHighlightSku] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [receivingSaving, setReceivingSaving] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Create shipment state
  const [createForm, setCreateForm] = useState({
    shipment_ref: "",
    po_id: "",
    po_number: "",
    supplier_id: suppliers[0] ? `SUP-${String(suppliers[0].id).padStart(3, "0")}` : "",
    supplier_name: suppliers[0]?.name || "",
    asn_reference: "",
    carrier: "",
    vehicle_reg: "",
    driver_name: "",
    driver_phone: "",
    expected_arrival: todayStr(),
    origin_warehouse: "",
    destination_warehouse: "Milan Cold Hub",
    transport_notes: "",
    items: [
      {
        sku: products[0]?.sku || "SKU-ATLANT-001",
        product_name: products[0]?.name || "Atlantic Salmon Fillet",
        ordered_qty: "10",
        ordered_uom: "case",
        notes: ""
      }
    ]
  });

  // Arrival form state
  const [arrivalForm, setArrivalForm] = useState({
    actual_arrival: "",
    status: "arrived",
    transport_notes: ""
  });

  // Temperature form state
  const [tempForm, setTempForm] = useState({
    sku: "",
    temp_c: "",
    unit: "C",
    min_c: "0",
    max_c: "4",
    verified_by: "",
    notes: "",
    evidence_ref: ""
  });

  // Receiving items & batches draft state
  const [receivingDrafts, setReceivingDrafts] = useState<ReceivingItemDraft[]>([]);

  // Document upload form state
  const [docForm, setDocForm] = useState({
    doc_type: "coa",
    sku: "",
    reference_number: "",
    issuer: "",
    issue_date: todayStr(),
    expiry_date: defaultExpiryDate(180),
    file_name: "",
    mime_type: "application/pdf",
    content_base64: ""
  });
  const [docReviewNotes, setDocReviewNotes] = useState<Record<string, string>>({});

  // Quality check form state
  const [qcForm, setQcForm] = useState({
    item_id: "",
    check_type: "visual",
    result: "pass",
    notes: "",
    evidence: ""
  });

  // Decision form state
  const [decisionForm, setDecisionForm] = useState({
    bin: "COLD-A1",
    quarantine_bin: "Quarantine",
    reason: "",
    batchAcceptedQty: {} as Record<string, string>
  });

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
    }
  }, [selectedId]);

  function initReceivingDrafts(d: InboundShipmentDetail) {
    const itemsSource =
      d.items.length > 0
        ? d.items
        : [
            {
              id: "new-item",
              shipment_id: d.shipment.id,
              sku: products[0]?.sku || "SKU-ATLANT-001",
              product_name: products[0]?.name || "Atlantic Salmon Fillet",
              ordered_qty: 10,
              ordered_uom: "case",
              received_qty: 10,
              accepted_qty: 0,
              rejected_qty: 0,
              damaged_qty: 0,
              actual_weight: null,
              expected_weight: null,
              weight_uom: "kg",
              weight_variance_pct: null,
              weight_discrepancy_status: null,
              scale_reference: null,
              weight_tolerance_pct: 5,
              packages: 10,
              notes: null,
              discrepancy_status: null,
              created_at: "",
              updated_at: ""
            }
          ];

    const drafts: ReceivingItemDraft[] = itemsSource.map((it) => {
      const prod = products.find((p) => p.sku === it.sku);
      const unitW = prod?.case_weight_kg || prod?.unit_weight_kg || 5;
      const ordered = Number(it.ordered_qty || 0);
      const recv = it.received_qty > 0 ? it.received_qty : ordered;
      const defaultExpectedW =
        it.expected_weight !== null && it.expected_weight !== undefined
          ? String(it.expected_weight)
          : prod?.catch_weight
            ? String(Math.round(ordered * unitW * 100) / 100)
            : "";

      return {
        sku: it.sku,
        product_name: it.product_name,
        ordered_qty: ordered,
        ordered_uom: it.ordered_uom || "case",
        received_qty: String(recv),
        accepted_qty: String(it.accepted_qty || recv),
        rejected_qty: String(it.rejected_qty || 0),
        damaged_qty: String(it.damaged_qty || 0),
        packages: String(it.packages || recv),
        expected_weight: defaultExpectedW,
        actual_weight: it.actual_weight !== null && it.actual_weight !== undefined ? String(it.actual_weight) : defaultExpectedW,
        weight_uom: it.weight_uom || "kg",
        weight_tolerance_pct: it.weight_tolerance_pct !== null && it.weight_tolerance_pct !== undefined ? String(it.weight_tolerance_pct) : "5",
        scale_reference: it.scale_reference || "",
        notes: it.notes || "",
        batches: [
          {
            supplier_batch: `SB-${it.sku.slice(-4)}-${Math.floor(100 + Math.random() * 900)}`,
            internal_lot: `LOT-${new Date().getFullYear()}-${it.sku.replace(/[^A-Z0-9]/g, "").slice(-6)}-${Math.floor(100 + Math.random() * 900)}`,
            manufacture_date: todayStr(),
            expiry_date: defaultExpiryDate(prod?.shelf_life_days || 30),
            origin: prod?.origin || "Italy",
            quantity: String(recv),
            unit: it.ordered_uom || "case",
            storage: prod?.temperature_profile || "Chilled 0-4C"
          }
        ]
      };
    });
    setReceivingDrafts(drafts);

    const qtyMap: Record<string, string> = {};
    for (const b of d.batches) {
      if (b.status === "received") {
        qtyMap[b.id] = String(b.quantity);
      }
    }
    setDecisionForm((prev) => ({ ...prev, batchAcceptedQty: qtyMap }));
  }

  async function refresh(nextPage = page) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (supplierFilter) params.set("supplier", supplierFilter);
      if (warehouseFilter) params.set("destination", warehouseFilter);
      if (searchQuery) params.set("search", searchQuery);
      params.set("page", String(nextPage));
      params.set("limit", "25");

      const res = await fetch(`/api/v1/inbound/shipments?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message || "Failed to load shipments");
        return;
      }
      setShipments(data.shipments || []);
      setTotal(Number(data.total || 0));
      setPage(Number(data.page || 1));
    } catch {
      setError("Failed to load shipments");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id: string) {
    setSelectedId(id);
    setLoading(true);
    setError(null);
    try {
      const [detailRes, histRes] = await Promise.all([
        fetch(`/api/v1/inbound/shipments/${id}`),
        fetch(`/api/v1/inbound/shipments/${id}/history`)
      ]);
      const data = await detailRes.json();
      if (!detailRes.ok) {
        setError(data?.error?.message || "Failed to load shipment detail");
        return;
      }
      setDetail(data);
      initReceivingDrafts(data);
      setArrivalForm({
        actual_arrival: data.shipment?.actual_arrival || new Date().toISOString().slice(0, 16),
        status: data.shipment?.status === "expected" ? "arrived" : data.shipment?.status || "arrived",
        transport_notes: data.shipment?.transport_notes || ""
      });
      if (histRes.ok) {
        const histData = await histRes.json();
        setHistory(histData.history || []);
      }
    } catch {
      setError("Failed to load shipment details");
    } finally {
      setLoading(false);
    }
  }

  function handleSelectPO(poId: string) {
    const po = purchaseOrders.find((p) => p.id === poId);
    if (!po) {
      setCreateForm((prev) => ({ ...prev, po_id: "", po_number: "" }));
      return;
    }
    setCreateForm((prev) => ({
      ...prev,
      po_id: po.id,
      po_number: po.po_number,
      supplier_id: po.supplier_id,
      supplier_name: po.supplier_name,
      asn_reference: po.asn_reference || prev.asn_reference,
      carrier: po.asn_carrier || prev.carrier,
      expected_arrival: po.asn_eta || po.expected_date || prev.expected_arrival,
      items: [
        {
          sku: po.sku,
          product_name: po.product_name,
          ordered_qty: String(po.ordered_cases),
          ordered_uom: "case",
          notes: `Linked to ${po.po_number}`
        }
      ]
    }));
  }

  async function createShipment() {
    setError(null);
    setMessage(null);
    const payload = {
      shipment_ref: createForm.shipment_ref || undefined,
      po_id: createForm.po_id || undefined,
      po_number: createForm.po_number || undefined,
      supplier_id: createForm.supplier_id || undefined,
      supplier_name: createForm.supplier_name,
      asn_reference: createForm.asn_reference || undefined,
      carrier: createForm.carrier || undefined,
      vehicle_reg: createForm.vehicle_reg || undefined,
      driver_name: createForm.driver_name || undefined,
      driver_phone: createForm.driver_phone || undefined,
      expected_arrival: createForm.expected_arrival || undefined,
      origin_warehouse: createForm.origin_warehouse || undefined,
      destination_warehouse: createForm.destination_warehouse,
      transport_notes: createForm.transport_notes || undefined,
      items: createForm.items.map((it) => ({
        sku: it.sku,
        product_name: it.product_name || it.sku,
        ordered_qty: Number(it.ordered_qty || 0),
        ordered_uom: it.ordered_uom || "case",
        notes: it.notes || undefined
      }))
    };

    const res = await fetch("/api/v1/inbound/shipments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `create-ib-${Date.now()}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message || "Failed to create shipment");
      return;
    }
    const createdId = data?.shipment?.id || data?.shipment?.shipment?.id;
    setMessage(`Inbound shipment ${data?.shipment?.shipment_ref || ""} registered.`);
    setShowCreateForm(false);
    await refresh(1);
    if (createdId) {
      await loadDetail(createdId);
    }
  }

  async function recordArrival() {
    if (!selectedId) return;
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/v1/inbound/shipments/${selectedId}/arrival`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actual_arrival: arrivalForm.actual_arrival || new Date().toISOString(),
        status: arrivalForm.status,
        transport_notes: arrivalForm.transport_notes || undefined
      })
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message || "Failed to record arrival");
      return;
    }
    setDetail(data);
    setMessage(`Shipment status updated to ${titleCase(arrivalForm.status)}.`);
    await refresh();
  }

  async function addTemp() {
    if (!selectedId) return;
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/v1/inbound/shipments/${selectedId}/temperature-logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku: tempForm.sku || undefined,
        temp_c: Number(tempForm.temp_c),
        min_c: Number(tempForm.min_c),
        max_c: Number(tempForm.max_c),
        unit: tempForm.unit,
        verified_by: tempForm.verified_by || undefined,
        notes: tempForm.notes || undefined,
        evidence_ref: tempForm.evidence_ref || undefined
      })
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message || "Failed to record temperature reading");
      return;
    }
    await loadDetail(selectedId);
    setMessage(
      data?.temperature_log?.excursion
        ? "Temperature recorded — EXCURSION FLAGGED!"
        : "Temperature reading recorded within range."
    );
  }

  async function submitReceiving() {
    if (!selectedId || receivingSaving) return;
    setReceivingSaving(true);
    setError(null);
    setMessage(null);
    const items = receivingDrafts.map((it) => ({
      sku: it.sku,
      product_name: it.product_name,
      ordered_qty: Number(it.ordered_qty),
      ordered_uom: it.ordered_uom || "case",
      received_qty: Number(it.received_qty || 0),
      accepted_qty: Number(it.accepted_qty || 0),
      rejected_qty: Number(it.rejected_qty || 0),
      damaged_qty: Number(it.damaged_qty || 0),
      packages: Number(it.packages || 0),
      expected_weight: it.expected_weight !== "" ? Number(it.expected_weight) : undefined,
      actual_weight: it.actual_weight !== "" ? Number(it.actual_weight) : undefined,
      weight_uom: it.weight_uom || "kg",
      weight_tolerance_pct: it.weight_tolerance_pct !== "" ? Number(it.weight_tolerance_pct) : undefined,
      scale_reference: it.scale_reference || undefined,
      notes: it.notes || undefined,
      batches: it.batches.map((b) => ({
        supplier_batch: b.supplier_batch,
        internal_lot: b.internal_lot,
        manufacture_date: b.manufacture_date || undefined,
        expiry_date: b.expiry_date,
        origin: b.origin || undefined,
        quantity: Number(b.quantity || 0),
        unit: b.unit || "case",
        storage: b.storage || undefined
      }))
    }));

    const body = JSON.stringify({ items });
    try {
      const res = await fetch(`/api/v1/inbound/shipments/${selectedId}/receiving`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `recv-${selectedId}-${djb2(body)}`
        },
        body
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message || "Failed to record goods receiving");
        return;
      }
      await loadDetail(selectedId);
      await refresh();
      setMessage("Goods receiving, catch-weights, and supplier batches verified.");
    } finally {
      setReceivingSaving(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      setDocForm((prev) => ({
        ...prev,
        file_name: file.name,
        mime_type: file.type || "application/pdf",
        content_base64: base64
      }));
    };
    reader.readAsDataURL(file);
  }

  async function uploadDocument() {
    if (!selectedId) return;
    setError(null);
    setMessage(null);
    const contentBase64 =
      docForm.content_base64 ||
      (typeof window !== "undefined" ? window.btoa(`Certificate ${docForm.reference_number || docForm.doc_type}`) : "");
    const fileName = docForm.file_name || `${docForm.doc_type}-${Date.now()}.pdf`;

    const res = await fetch(`/api/v1/inbound/shipments/${selectedId}/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        doc_type: docForm.doc_type,
        sku: docForm.sku || undefined,
        reference_number: docForm.reference_number || undefined,
        issuer: docForm.issuer || undefined,
        issue_date: docForm.issue_date || undefined,
        expiry_date: docForm.expiry_date || undefined,
        file_name: fileName,
        mime_type: docForm.mime_type || "application/pdf",
        content_base64: contentBase64
      })
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message || "Document upload failed");
      return;
    }
    await loadDetail(selectedId);
    setMessage(`Document ${fileName} uploaded (Pending Review).`);
  }

  async function verifyDoc(docId: string, status: "verified" | "rejected" | "expired") {
    if (!selectedId) return;
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/v1/inbound/shipments/${selectedId}/documents/${docId}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        review_notes: docReviewNotes[docId] || `Marked as ${status}`
      })
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message || "Document verification failed");
      return;
    }
    await loadDetail(selectedId);
    setMessage(`Document status updated to ${titleCase(status)}.`);
  }

  async function submitQualityCheck() {
    if (!selectedId) return;
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/v1/inbound/shipments/${selectedId}/quality-checks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item_id: qcForm.item_id || undefined,
        check_type: qcForm.check_type,
        result: qcForm.result,
        notes: qcForm.notes || undefined,
        evidence: qcForm.evidence || undefined
      })
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message || "Quality check failed");
      return;
    }
    await loadDetail(selectedId);
    setMessage(`Quality check (${titleCase(qcForm.check_type)}) recorded: ${titleCase(qcForm.result)}.`);
  }

  async function acceptShipmentDecision() {
    if (!selectedId || !detail) return;
    setError(null);
    setMessage(null);
    const receivedBatches = detail.batches.filter((b) => b.status === "received");
    const accepted = receivedBatches.map((b) => ({
      batch_id: b.id,
      accepted_qty:
        decisionForm.batchAcceptedQty[b.id] !== undefined
          ? Number(decisionForm.batchAcceptedQty[b.id])
          : b.quantity
    }));

    const res = await fetch(`/api/v1/inbound/shipments/${selectedId}/accept`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `acc-${selectedId}-${Date.now()}`
      },
      body: JSON.stringify({
        accepted,
        bin: decisionForm.bin || "Receiving Dock"
      })
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message || "Failed to accept shipment");
      return;
    }
    await loadDetail(selectedId);
    await refresh();
    setMessage(`Stock accepted into ${decisionForm.bin} and released for FEFO allocation.`);
  }

  async function quarantineShipmentDecision() {
    if (!selectedId) return;
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/v1/inbound/shipments/${selectedId}/quarantine`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `quar-${selectedId}-${Date.now()}`
      },
      body: JSON.stringify({
        bin: decisionForm.quarantine_bin || "Quarantine",
        reason: decisionForm.reason || "Quarantined pending QA investigation"
      })
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message || "Failed to quarantine shipment");
      return;
    }
    await loadDetail(selectedId);
    await refresh();
    setMessage(`Shipment quarantined in ${decisionForm.quarantine_bin} (blocked from picking).`);
  }

  async function rejectShipmentDecision() {
    if (!selectedId) return;
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/v1/inbound/shipments/${selectedId}/reject`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `rej-${selectedId}-${Date.now()}`
      },
      body: JSON.stringify({
        reason: decisionForm.reason || "Rejected during inbound quality inspection"
      })
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message || "Failed to reject shipment");
      return;
    }
    await loadDetail(selectedId);
    await refresh();
    setMessage("Shipment rejected. Stock excluded from sellable inventory.");
  }

  const exc = detail?.exceptions;
  const hasExceptions =
    exc &&
    (exc.temp_excursions > 0 ||
      exc.expired_documents > 0 ||
      exc.rejected_documents > 0 ||
      exc.qty_discrepancies > 0 ||
      exc.weight_discrepancies > 0 ||
      exc.failed_quality_checks > 0);

  return (
    <div className="space-y-4">
      {/* Top Filter & Action Bar */}
      <Surface className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                className="input w-full pl-9"
                placeholder="Search ref, supplier, PO#, ASN..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && refresh(1)}
              />
            </div>
            <select
              className="input w-auto"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
              }}
            >
              <option value="">All statuses</option>
              {INBOUND_SHIPMENT_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {titleCase(st)}
                </option>
              ))}
            </select>
            <select
              className="input w-auto"
              value={warehouseFilter}
              onChange={(e) => setWarehouseFilter(e.target.value)}
            >
              <option value="">All warehouses</option>
              {WAREHOUSE_OPTIONS.map((wh) => (
                <option key={wh} value={wh}>
                  {wh}
                </option>
              ))}
            </select>
            <button onClick={() => refresh(1)} className="btn btn-secondary">
              Filter
            </button>
          </div>
          <button
            onClick={() => setShowCreateForm((v) => !v)}
            className="btn btn-primary inline-flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            {showCreateForm ? "Close form" : "Register expected shipment"}
          </button>
        </div>

        {/* Create Expected Shipment Drawer */}
        {showCreateForm && (
          <div className="mt-4 rounded-xl border border-border bg-muted/20 p-4">
            <SectionHeader
              title="Register expected inbound shipment"
              description="Link an approved Purchase Order or enter supplier, transport, and expected line items."
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Link Purchase Order (optional)</label>
                <select
                  className="input mt-1 w-full"
                  value={createForm.po_id}
                  onChange={(e) => handleSelectPO(e.target.value)}
                >
                  <option value="">— Manual / Unlinked —</option>
                  {purchaseOrders.map((po) => (
                    <option key={po.id} value={po.id}>
                      {po.po_number} · {po.supplier_name} ({po.sku})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Shipment reference (auto if blank)</label>
                <input
                  className="input mt-1 w-full"
                  placeholder="IB-2026-XXXX"
                  value={createForm.shipment_ref}
                  onChange={(e) => setCreateForm({ ...createForm, shipment_ref: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Supplier name *</label>
                <input
                  className="input mt-1 w-full"
                  placeholder="Supplier name"
                  value={createForm.supplier_name}
                  onChange={(e) => setCreateForm({ ...createForm, supplier_name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Destination warehouse *</label>
                <select
                  className="input mt-1 w-full"
                  value={createForm.destination_warehouse}
                  onChange={(e) => setCreateForm({ ...createForm, destination_warehouse: e.target.value })}
                >
                  {WAREHOUSE_OPTIONS.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">ASN / Delivery note ref</label>
                <input
                  className="input mt-1 w-full"
                  placeholder="ASN-2026-101"
                  value={createForm.asn_reference}
                  onChange={(e) => setCreateForm({ ...createForm, asn_reference: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Carrier / Haulier</label>
                <input
                  className="input mt-1 w-full"
                  placeholder="Alpine Cold Logistics"
                  value={createForm.carrier}
                  onChange={(e) => setCreateForm({ ...createForm, carrier: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Vehicle / Trailer reg</label>
                <input
                  className="input mt-1 w-full"
                  placeholder="MI-8842-CL"
                  value={createForm.vehicle_reg}
                  onChange={(e) => setCreateForm({ ...createForm, vehicle_reg: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Driver name & phone</label>
                <div className="mt-1 flex gap-1.5">
                  <input
                    className="input w-1/2"
                    placeholder="Driver name"
                    value={createForm.driver_name}
                    onChange={(e) => setCreateForm({ ...createForm, driver_name: e.target.value })}
                  />
                  <input
                    className="input w-1/2"
                    placeholder="Phone"
                    value={createForm.driver_phone}
                    onChange={(e) => setCreateForm({ ...createForm, driver_phone: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Expected arrival</label>
                <input
                  type="date"
                  className="input mt-1 w-full"
                  value={createForm.expected_arrival}
                  onChange={(e) => setCreateForm({ ...createForm, expected_arrival: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="text-xs font-medium text-muted-foreground">Transport notes</label>
                <input
                  className="input mt-1 w-full"
                  placeholder="Dual-zone reefer, seal number, dock gate instructions..."
                  value={createForm.transport_notes}
                  onChange={(e) => setCreateForm({ ...createForm, transport_notes: e.target.value })}
                />
              </div>
            </div>

            {/* Line Items */}
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Expected Line Items
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setCreateForm((prev) => ({
                      ...prev,
                      items: [
                        ...prev.items,
                        { sku: "", product_name: "", ordered_qty: "5", ordered_uom: "case", notes: "" }
                      ]
                    }))
                  }
                  className="btn btn-secondary text-xs"
                >
                  + Add line item
                </button>
              </div>
              <div className="mt-2 space-y-2">
                {createForm.items.map((item, idx) => (
                  <div key={idx} className="grid gap-2 sm:grid-cols-5">
                    <input
                      className="input"
                      placeholder="SKU *"
                      value={item.sku}
                      onChange={(e) => {
                        const sku = e.target.value;
                        const match = products.find((p) => p.sku === sku);
                        const copy = [...createForm.items];
                        copy[idx] = { ...copy[idx], sku, product_name: match?.name || copy[idx].product_name };
                        setCreateForm({ ...createForm, items: copy });
                      }}
                    />
                    <input
                      className="input sm:col-span-2"
                      placeholder="Product name"
                      value={item.product_name}
                      onChange={(e) => {
                        const copy = [...createForm.items];
                        copy[idx] = { ...copy[idx], product_name: e.target.value };
                        setCreateForm({ ...createForm, items: copy });
                      }}
                    />
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        className="input w-2/3"
                        placeholder="Ordered qty"
                        value={item.ordered_qty}
                        onChange={(e) => {
                          const copy = [...createForm.items];
                          copy[idx] = { ...copy[idx], ordered_qty: e.target.value };
                          setCreateForm({ ...createForm, items: copy });
                        }}
                      />
                      <input
                        className="input w-1/3"
                        placeholder="UOM"
                        value={item.ordered_uom}
                        onChange={(e) => {
                          const copy = [...createForm.items];
                          copy[idx] = { ...copy[idx], ordered_uom: e.target.value };
                          setCreateForm({ ...createForm, items: copy });
                        }}
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        className="input flex-1"
                        placeholder="Line notes"
                        value={item.notes}
                        onChange={(e) => {
                          const copy = [...createForm.items];
                          copy[idx] = { ...copy[idx], notes: e.target.value };
                          setCreateForm({ ...createForm, items: copy });
                        }}
                      />
                      {createForm.items.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setCreateForm({
                              ...createForm,
                              items: createForm.items.filter((_, i) => i !== idx)
                            })
                          }
                          className="btn btn-secondary px-2"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreateForm(false)} className="btn btn-secondary">
                Cancel
              </button>
              <Can permission="inbound.manage" mode="disable">
                <button type="button" onClick={createShipment} className="btn btn-primary">
                  Register shipment
                </button>
              </Can>
            </div>
          </div>
        )}
      </Surface>

      {/* Main Split View */}
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        {/* Left Queue */}
        <Surface className="p-4">
          <SectionHeader
            title="Inbound shipments"
            description={`${total || shipments.length} shipment(s) matching filter`}
            action={
              <ViewOnlyBadge
                modifyPermissions={[
                  "inbound.manage",
                  "inbound.arrival",
                  "inbound.receive",
                  "inbound.temperature",
                  "inbound.quality",
                  "inbound.documents",
                  "inbound.decision",
                  "inbound.driver_update"
                ]}
              />
            }
          />
          {loading && <p className="mt-2 text-xs text-muted-foreground">Loading shipments...</p>}
          {shipments.length === 0 && !loading && (
            <p className="mt-4 text-xs text-muted-foreground">No inbound shipments registered yet.</p>
          )}
          <div className="mt-3 max-h-[680px] space-y-2 overflow-y-auto pr-1">
            {shipments.map((s) => (
              <button
                key={s.id}
                onClick={() => loadDetail(s.id)}
                className={`w-full rounded-xl border p-3 text-left transition ${
                  selectedId === s.id
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border hover:border-primary/40 hover:bg-muted/30"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm">{s.shipment_ref}</span>
                  <Badge tone={inboundStatusTone(s.status)}>{titleCase(s.status)}</Badge>
                </div>
                <p className="mt-1 truncate text-xs font-medium text-foreground">{s.supplier_name}</p>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-1 text-[11px] text-muted-foreground">
                  <span>→ {s.destination_warehouse}</span>
                  {s.po_number && <span className="font-mono">{s.po_number}</span>}
                  {s.expected_arrival && <span>ETA: {s.expected_arrival.slice(0, 10)}</span>}
                </div>
              </button>
            ))}
          </div>
        </Surface>

        {/* Right Detail Workbench */}
        <Surface className="p-4">
          {error && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600">
              <XCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {message && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-marine-ocean/60 bg-marine-steel/10 px-3 py-2 text-sm text-marine-mid">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{message}</span>
            </div>
          )}

          {!detail ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center text-center text-muted-foreground">
              <Truck className="mb-2 h-8 w-8 opacity-40" />
              <p className="text-sm font-medium">Select an inbound shipment or register a new expected arrival</p>
              <p className="mt-1 text-xs">
                Inspect transport temperature logs, verify quantities and catch-weights, upload certificates, and release stock.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Shipment Header */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">{detail.shipment.shipment_ref}</h2>
                    <Badge tone={inboundStatusTone(detail.shipment.status)}>
                      {titleCase(detail.shipment.status)}
                    </Badge>
                    {detail.shipment.po_number && (
                      <Badge tone="info">PO: {detail.shipment.po_number}</Badge>
                    )}
                    {detail.shipment.asn_reference && (
                      <Badge tone="neutral">ASN: {detail.shipment.asn_reference}</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <strong className="text-foreground">{detail.shipment.supplier_name}</strong> →{" "}
                    <strong className="text-foreground">{detail.shipment.destination_warehouse}</strong>
                    {detail.shipment.carrier ? ` · Carrier: ${detail.shipment.carrier}` : ""}
                    {detail.shipment.vehicle_reg ? ` (${detail.shipment.vehicle_reg})` : ""}
                    {detail.shipment.driver_name ? ` · Driver: ${detail.shipment.driver_name}` : ""}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>Expected: {detail.shipment.expected_arrival || "—"}</div>
                  <div>Actual arrival: {detail.shipment.actual_arrival || "Not arrived"}</div>
                </div>
              </div>

              {/* Exception Alerts Banner */}
              {hasExceptions && exc && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                  <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>Active Receiving Exceptions & Compliance Flags</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {exc.temp_excursions > 0 && (
                      <Badge tone="critical">{exc.temp_excursions} Temperature Excursion(s)</Badge>
                    )}
                    {exc.expired_documents > 0 && (
                      <Badge tone="critical">{exc.expired_documents} Expired Certificate(s)</Badge>
                    )}
                    {exc.rejected_documents > 0 && (
                      <Badge tone="critical">{exc.rejected_documents} Rejected Document(s)</Badge>
                    )}
                    {exc.qty_discrepancies > 0 && (
                      <Badge tone="warning">{exc.qty_discrepancies} Quantity Discrepancy</Badge>
                    )}
                    {exc.weight_discrepancies > 0 && (
                      <Badge tone="warning">{exc.weight_discrepancies} Catch-Weight Variance</Badge>
                    )}
                    {exc.failed_quality_checks > 0 && (
                      <Badge tone="critical">{exc.failed_quality_checks} Failed Quality Check(s)</Badge>
                    )}
                  </div>
                </div>
              )}

              {/* Navigation Tabs */}
              <div className="flex flex-wrap gap-1.5 border-b border-border pb-2">
                {[
                  { id: "overview", label: "1. Arrival & Overview", icon: Truck },
                  { id: "temperature", label: `2. Temperature (${detail.temperature_logs.length})`, icon: Thermometer },
                  { id: "receiving", label: `3. Receive, Batches & Weight (${detail.batches.length})`, icon: Scale },
                  { id: "documents", label: `4. Certificates (${detail.documents.length})`, icon: FileCheck2 },
                  { id: "quality", label: `5. Quality & Decision (${detail.quality_checks.length})`, icon: ClipboardCheck },
                  { id: "history", label: `6. Audit Trail (${history.length})`, icon: History }
                ].map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as any)}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                        activeTab === tab.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50 text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* TAB 1: OVERVIEW & ARRIVAL */}
              {activeTab === "overview" && (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-xl border border-border p-3">
                      <SectionHeader
                        title="Confirm Arrival & Dock Status"
                        description="Record vehicle arrival timestamp and update unloading state."
                      />
                      <div className="mt-2 space-y-2">
                        <div>
                          <label className="text-xs text-muted-foreground">Actual arrival timestamp</label>
                          <input
                            className="input mt-1 w-full"
                            placeholder="YYYY-MM-DDTHH:mm:ssZ"
                            value={arrivalForm.actual_arrival}
                            onChange={(e) => setArrivalForm({ ...arrivalForm, actual_arrival: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Shipment status</label>
                          <select
                            className="input mt-1 w-full"
                            value={arrivalForm.status}
                            onChange={(e) => setArrivalForm({ ...arrivalForm, status: e.target.value })}
                          >
                            <option value="confirmed">Confirmed</option>
                            <option value="in_transit">In Transit</option>
                            <option value="arrived">Arrived at Dock</option>
                            <option value="unloading">Unloading</option>
                            <option value="under_inspection">Under Inspection</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Dock / Transport notes</label>
                          <input
                            className="input mt-1 w-full"
                            placeholder="Seal intact, dock door #3..."
                            value={arrivalForm.transport_notes}
                            onChange={(e) => setArrivalForm({ ...arrivalForm, transport_notes: e.target.value })}
                          />
                        </div>
                        <Can anyOf={["inbound.arrival", "inbound.driver_update"]} mode="disable">
                          <button onClick={recordArrival} className="btn btn-primary w-full">
                            Update arrival & status
                          </button>
                        </Can>
                      </div>
                    </div>

                    <div className="rounded-xl border border-border p-3">
                      <SectionHeader title="Shipment Summary" description="Key compliance & receiving metrics" />
                      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-lg bg-muted/40 p-2">
                          <dt className="text-muted-foreground">Line Items</dt>
                          <dd className="mt-0.5 text-sm font-semibold">{detail.items.length}</dd>
                        </div>
                        <div className="rounded-lg bg-muted/40 p-2">
                          <dt className="text-muted-foreground">Verified Batches</dt>
                          <dd className="mt-0.5 text-sm font-semibold">{detail.batches.length}</dd>
                        </div>
                        <div className="rounded-lg bg-muted/40 p-2">
                          <dt className="text-muted-foreground">Temp Readings</dt>
                          <dd className="mt-0.5 text-sm font-semibold">
                            {detail.temperature_logs.length}{" "}
                            {exc?.temp_excursions ? `(${exc.temp_excursions} excursion)` : "(OK)"}
                          </dd>
                        </div>
                        <div className="rounded-lg bg-muted/40 p-2">
                          <dt className="text-muted-foreground">Certificates</dt>
                          <dd className="mt-0.5 text-sm font-semibold">
                            {detail.documents.length === 0 ? "Missing" : `${detail.documents.length} uploaded`}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>

                  {/* Items Summary Table */}
                  <div>
                    <SectionHeader title="Line Items & Discrepancy Status" />
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border text-left text-muted-foreground">
                            <th className="py-2">SKU</th>
                            <th>Product</th>
                            <th>Ordered</th>
                            <th>Received</th>
                            <th>Accepted</th>
                            <th>Rejected / Damaged</th>
                            <th>Qty Status</th>
                            <th>Weight (Actual / Exp)</th>
                            <th>Weight Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.items.map((it) => (
                            <tr key={it.id} className="border-b border-border/60">
                              <td className="py-2 font-mono font-medium">{it.sku}</td>
                              <td>{it.product_name}</td>
                              <td>
                                {it.ordered_qty} {it.ordered_uom || "case"}
                              </td>
                              <td>{it.received_qty}</td>
                              <td className="font-semibold text-marine-mid">{it.accepted_qty}</td>
                              <td className="text-amber-600">
                                {it.rejected_qty} / {it.damaged_qty}
                              </td>
                              <td>
                                {it.discrepancy_status ? (
                                  <Badge
                                    tone={
                                      it.discrepancy_status === "match"
                                        ? "ok"
                                        : it.discrepancy_status === "missing"
                                          ? "critical"
                                          : "warning"
                                    }
                                  >
                                    {titleCase(it.discrepancy_status)}
                                  </Badge>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td>
                                {it.actual_weight !== null
                                  ? `${it.actual_weight} / ${it.expected_weight ?? "—"} ${it.weight_uom || "kg"} (${it.weight_variance_pct ?? 0}%)`
                                  : "—"}
                              </td>
                              <td>
                                {it.weight_discrepancy_status ? (
                                  <Badge
                                    tone={it.weight_discrepancy_status === "within_tolerance" ? "ok" : "warning"}
                                  >
                                    {titleCase(it.weight_discrepancy_status)}
                                  </Badge>
                                ) : (
                                  "—"
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

              {/* TAB 2: TEMPERATURE MONITORING */}
              {activeTab === "temperature" && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border p-3">
                    <SectionHeader
                      title="Record Transport / Arrival Temperature"
                      description="Compare probe or data-logger reading against cold-chain limits. Out-of-range readings automatically flag an excursion."
                    />
                    <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                      <div>
                        <label className="text-xs text-muted-foreground">Temperature</label>
                        <input
                          type="number"
                          step="0.1"
                          className="input mt-1 w-full"
                          placeholder="e.g. 2.4"
                          value={tempForm.temp_c}
                          onChange={(e) => setTempForm({ ...tempForm, temp_c: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Unit</label>
                        <select
                          className="input mt-1 w-full"
                          value={tempForm.unit}
                          onChange={(e) => setTempForm({ ...tempForm, unit: e.target.value })}
                        >
                          <option value="C">°C (Celsius)</option>
                          <option value="F">°F (Fahrenheit)</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Min allowed (°C)</label>
                        <input
                          type="number"
                          step="0.1"
                          className="input mt-1 w-full"
                          value={tempForm.min_c}
                          onChange={(e) => setTempForm({ ...tempForm, min_c: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Max allowed (°C)</label>
                        <input
                          type="number"
                          step="0.1"
                          className="input mt-1 w-full"
                          value={tempForm.max_c}
                          onChange={(e) => setTempForm({ ...tempForm, max_c: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Verified by</label>
                        <input
                          className="input mt-1 w-full"
                          placeholder="QA / Dock verifier"
                          value={tempForm.verified_by}
                          onChange={(e) => setTempForm({ ...tempForm, verified_by: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Notes / Probe ID</label>
                        <input
                          className="input mt-1 w-full"
                          placeholder="Probe #2 / Tailgate"
                          value={tempForm.notes}
                          onChange={(e) => setTempForm({ ...tempForm, notes: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex gap-1.5 text-xs">
                        <button
                          type="button"
                          onClick={() => setTempForm({ ...tempForm, min_c: "0", max_c: "4" })}
                          className="btn btn-secondary text-xs"
                        >
                          Preset: Chilled (0..4°C)
                        </button>
                        <button
                          type="button"
                          onClick={() => setTempForm({ ...tempForm, min_c: "-25", max_c: "-18" })}
                          className="btn btn-secondary text-xs"
                        >
                          Preset: Frozen (-25..-18°C)
                        </button>
                        <button
                          type="button"
                          onClick={() => setTempForm({ ...tempForm, min_c: "10", max_c: "22" })}
                          className="btn btn-secondary text-xs"
                        >
                          Preset: Ambient (10..22°C)
                        </button>
                      </div>
                      <Can anyOf={["inbound.temperature", "inbound.driver_update"]} mode="disable">
                        <button onClick={addTemp} className="btn btn-primary">
                          Record temperature reading
                        </button>
                      </Can>
                    </div>
                  </div>

                  <SectionHeader title="Temperature Log History" />
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="py-2">Recorded At</th>
                          <th>Reading (°C)</th>
                          <th>Allowed Range</th>
                          <th>Status</th>
                          <th>Recorded By</th>
                          <th>Verified By</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.temperature_logs.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-4 text-center text-muted-foreground">
                              No temperature readings recorded yet.
                            </td>
                          </tr>
                        ) : (
                          detail.temperature_logs.map((t) => (
                            <tr key={t.id} className="border-b border-border/60">
                              <td className="py-2">{t.recorded_at.slice(0, 19).replace("T", " ")}</td>
                              <td className="font-semibold">{t.temp_c} °C</td>
                              <td>
                                {t.min_c} °C to {t.max_c} °C
                              </td>
                              <td>
                                <Badge tone={t.excursion ? "critical" : "ok"}>
                                  {t.excursion ? "Excursion" : "In Range"}
                                </Badge>
                              </td>
                              <td>{t.recorded_by}</td>
                              <td>{t.verified_by || "—"}</td>
                              <td>{t.notes || "—"}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 3: GOODS RECEIVING, CATCH-WEIGHT & SUPPLIER BATCHES */}
              {activeTab === "receiving" && (
                <div className="space-y-4">
                  <SectionHeader
                    title="Verify Received Quantities, Catch-Weights & Supplier Batches"
                    description="Record actual quantities, scale weights, and batch/lot numbers with manufacture & expiry dates."
                  />

                  {/* Quick barcode match for the reviewer — resolves the product and validates it is on the shipment */}
                  <BarcodeMatchStrip
                    operation="receiving"
                    referenceId={detail?.shipment?.id ?? null}
                    lotHint={(() => {
                      const first = receivingDrafts.flatMap((d) => d.batches)[0];
                      if (!first) return null;
                      const lot = first.internal_lot?.trim() || first.supplier_batch?.trim();
                      if (!lot && !first.expiry_date) return null;
                      return `${lot || "?"}${first.expiry_date ? ` · exp ${first.expiry_date}` : ""}`;
                    })()}
                    onMatch={(sku) => setHighlightSku(sku)}
                  />

                  {receivingDrafts.map((draft, itemIdx) => {
                    const expW = Number(draft.expected_weight || 0);
                    const actW = Number(draft.actual_weight || 0);
                    const variancePct =
                      expW > 0 && actW > 0 ? Math.round(((actW - expW) / expW) * 10000) / 100 : null;

                    return (
                      <div key={itemIdx} className={`rounded-xl border p-3 space-y-3 transition-colors ${highlightSku && draft.sku === highlightSku ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border"}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <span className="font-mono text-xs font-semibold">{draft.sku}</span>{" "}
                            <span className="text-sm font-medium">{draft.product_name}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            Ordered: <strong>{draft.ordered_qty}</strong> {draft.ordered_uom}
                          </span>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                          <div>
                            <label className="text-[11px] text-muted-foreground">Received Qty</label>
                            <input
                              type="number"
                              className="input mt-0.5 w-full"
                              value={draft.received_qty}
                              onChange={(e) => {
                                const copy = [...receivingDrafts];
                                copy[itemIdx] = { ...copy[itemIdx], received_qty: e.target.value };
                                setReceivingDrafts(copy);
                              }}
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-muted-foreground">Damaged Qty</label>
                            <input
                              type="number"
                              className="input mt-0.5 w-full"
                              value={draft.damaged_qty}
                              onChange={(e) => {
                                const copy = [...receivingDrafts];
                                copy[itemIdx] = { ...copy[itemIdx], damaged_qty: e.target.value };
                                setReceivingDrafts(copy);
                              }}
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-muted-foreground">Packages / Pallets</label>
                            <input
                              type="number"
                              className="input mt-0.5 w-full"
                              value={draft.packages}
                              onChange={(e) => {
                                const copy = [...receivingDrafts];
                                copy[itemIdx] = { ...copy[itemIdx], packages: e.target.value };
                                setReceivingDrafts(copy);
                              }}
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-muted-foreground">Expected Weight (kg)</label>
                            <input
                              type="number"
                              step="0.01"
                              className="input mt-0.5 w-full"
                              value={draft.expected_weight}
                              onChange={(e) => {
                                const copy = [...receivingDrafts];
                                copy[itemIdx] = { ...copy[itemIdx], expected_weight: e.target.value };
                                setReceivingDrafts(copy);
                              }}
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-muted-foreground">Actual Scale Weight (kg)</label>
                            <input
                              type="number"
                              step="0.01"
                              className="input mt-0.5 w-full"
                              value={draft.actual_weight}
                              onChange={(e) => {
                                const copy = [...receivingDrafts];
                                copy[itemIdx] = { ...copy[itemIdx], actual_weight: e.target.value };
                                setReceivingDrafts(copy);
                              }}
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-muted-foreground">
                              Tolerance % {variancePct !== null ? `(Var: ${variancePct}%)` : ""}
                            </label>
                            <input
                              type="number"
                              step="0.1"
                              className="input mt-0.5 w-full"
                              value={draft.weight_tolerance_pct}
                              onChange={(e) => {
                                const copy = [...receivingDrafts];
                                copy[itemIdx] = { ...copy[itemIdx], weight_tolerance_pct: e.target.value };
                                setReceivingDrafts(copy);
                              }}
                            />
                          </div>
                        </div>

                        {/* Supplier Batch / Lot Entries */}
                        <div className="border-t border-border/60 pt-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-muted-foreground">
                              Supplier Batches & Traceable Lots
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const copy = [...receivingDrafts];
                                copy[itemIdx].batches.push({
                                  supplier_batch: `SB-${Date.now().toString().slice(-4)}`,
                                  internal_lot: `LOT-${Date.now().toString().slice(-6)}`,
                                  manufacture_date: todayStr(),
                                  expiry_date: defaultExpiryDate(30),
                                  origin: "Italy",
                                  quantity: "1",
                                  unit: draft.ordered_uom || "case",
                                  storage: "Chilled 0-4C"
                                });
                                setReceivingDrafts(copy);
                              }}
                              className="btn btn-secondary text-xs"
                            >
                              + Split into another batch
                            </button>
                          </div>

                          <div className="mt-2 space-y-2">
                            {draft.batches.map((b, bIdx) => (
                              <div key={bIdx} className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                                <div>
                                  <label className="text-[11px] text-muted-foreground">Supplier Batch *</label>
                                  <input
                                    className="input mt-0.5 w-full"
                                    value={b.supplier_batch}
                                    onChange={(e) => {
                                      const copy = [...receivingDrafts];
                                      copy[itemIdx].batches[bIdx].supplier_batch = e.target.value;
                                      setReceivingDrafts(copy);
                                    }}
                                  />
                                </div>
                                <div>
                                  <label className="text-[11px] text-muted-foreground">Internal Lot # *</label>
                                  <input
                                    className="input mt-0.5 w-full"
                                    value={b.internal_lot}
                                    onChange={(e) => {
                                      const copy = [...receivingDrafts];
                                      copy[itemIdx].batches[bIdx].internal_lot = e.target.value;
                                      setReceivingDrafts(copy);
                                    }}
                                  />
                                </div>
                                <div>
                                  <label className="text-[11px] text-muted-foreground">Mfg Date</label>
                                  <input
                                    type="date"
                                    className="input mt-0.5 w-full"
                                    value={b.manufacture_date}
                                    onChange={(e) => {
                                      const copy = [...receivingDrafts];
                                      copy[itemIdx].batches[bIdx].manufacture_date = e.target.value;
                                      setReceivingDrafts(copy);
                                    }}
                                  />
                                </div>
                                <div>
                                  <label className="text-[11px] text-muted-foreground">Expiry / Use-By Date *</label>
                                  <input
                                    type="date"
                                    className="input mt-0.5 w-full"
                                    value={b.expiry_date}
                                    onChange={(e) => {
                                      const copy = [...receivingDrafts];
                                      copy[itemIdx].batches[bIdx].expiry_date = e.target.value;
                                      setReceivingDrafts(copy);
                                    }}
                                  />
                                </div>
                                <div>
                                  <label className="text-[11px] text-muted-foreground">Batch Qty ({b.unit})</label>
                                  <input
                                    type="number"
                                    className="input mt-0.5 w-full"
                                    value={b.quantity}
                                    onChange={(e) => {
                                      const copy = [...receivingDrafts];
                                      copy[itemIdx].batches[bIdx].quantity = e.target.value;
                                      setReceivingDrafts(copy);
                                    }}
                                  />
                                </div>
                                <div>
                                  <label className="text-[11px] text-muted-foreground">Origin Country</label>
                                  <input
                                    className="input mt-0.5 w-full"
                                    value={b.origin}
                                    onChange={(e) => {
                                      const copy = [...receivingDrafts];
                                      copy[itemIdx].batches[bIdx].origin = e.target.value;
                                      setReceivingDrafts(copy);
                                    }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  <div className="flex justify-end">
                    <Can permission="inbound.receive" mode="disable">
                      <button onClick={submitReceiving} className="btn btn-primary" disabled={receivingSaving}>
                        {receivingSaving ? "Saving…" : "Verify & Save Goods Receiving + Batches"}
                      </button>
                    </Can>
                  </div>

                  {/* Existing Batches Table */}
                  <SectionHeader title="Recorded Supplier Batches & Internal Lots" />
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="py-2">Internal Lot</th>
                          <th>Supplier Batch</th>
                          <th>SKU</th>
                          <th>Mfg Date</th>
                          <th>Expiry Date</th>
                          <th>Origin</th>
                          <th>Received Qty</th>
                          <th>Accepted</th>
                          <th>Rejected / Quar.</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.batches.length === 0 ? (
                          <tr>
                            <td colSpan={10} className="py-4 text-center text-muted-foreground">
                              No batches recorded yet. Submit the receiving form above to register batches.
                            </td>
                          </tr>
                        ) : (
                          detail.batches.map((b) => (
                            <tr key={b.id} className="border-b border-border/60">
                              <td className="py-2 font-mono font-semibold">{b.internal_lot}</td>
                              <td className="font-mono">{b.supplier_batch}</td>
                              <td>{b.sku}</td>
                              <td>{b.manufacture_date || "—"}</td>
                              <td>{b.expiry_date}</td>
                              <td>{b.origin || "—"}</td>
                              <td>
                                {b.quantity} {b.unit}
                              </td>
                              <td className="text-marine-mid">{b.accepted_qty}</td>
                              <td className="text-amber-600">
                                {b.rejected_qty} / {b.quarantined_qty}
                              </td>
                              <td>
                                <Badge tone={inboundStatusTone(b.status)}>{titleCase(b.status)}</Badge>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 4: QUALITY CERTIFICATES & DOCUMENTATION */}
              {activeTab === "documents" && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border p-3">
                    <SectionHeader
                      title="Upload Quality Certificate / Compliance Document"
                      description="Attach Certificate of Analysis (COA), Health/Veterinary Certificate, Temperature Report, or Delivery Note. Uploaded documents start in Pending Review."
                    />
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <label className="text-xs text-muted-foreground">Document Type *</label>
                        <select
                          className="input mt-1 w-full"
                          value={docForm.doc_type}
                          onChange={(e) => setDocForm({ ...docForm, doc_type: e.target.value })}
                        >
                          {INBOUND_DOCUMENT_TYPES.map((dt) => (
                            <option key={dt} value={dt}>
                              {titleCase(dt)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Certificate / Ref #</label>
                        <input
                          className="input mt-1 w-full"
                          placeholder="COA-2026-8891"
                          value={docForm.reference_number}
                          onChange={(e) => setDocForm({ ...docForm, reference_number: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Issuing Authority / Lab</label>
                        <input
                          className="input mt-1 w-full"
                          placeholder="Eurofins Food Testing"
                          value={docForm.issuer}
                          onChange={(e) => setDocForm({ ...docForm, issuer: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Expiry / Valid Until</label>
                        <input
                          type="date"
                          className="input mt-1 w-full"
                          value={docForm.expiry_date}
                          onChange={(e) => setDocForm({ ...docForm, expiry_date: e.target.value })}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="text-xs text-muted-foreground">Attach PDF / Image (max 5 MB)</label>
                        <input
                          type="file"
                          accept=".pdf,.png,.jpg,.jpeg,.txt"
                          onChange={handleFileChange}
                          className="input mt-1 w-full text-xs"
                        />
                      </div>
                      <div className="sm:col-span-2 flex items-end justify-end">
                        <Can permission="inbound.documents" mode="disable">
                          <button onClick={uploadDocument} className="btn btn-primary inline-flex items-center gap-1.5">
                            <Upload className="h-4 w-4" />
                            Upload certificate
                          </button>
                        </Can>
                      </div>
                    </div>
                  </div>

                  <SectionHeader title="Attached Certificates & Verification Status" />
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="py-2">Type</th>
                          <th>Ref #</th>
                          <th>Issuer</th>
                          <th>Expiry</th>
                          <th>File</th>
                          <th>Status</th>
                          <th>Verified By</th>
                          <th>Review / Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.documents.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="py-4 text-center text-amber-600">
                              Missing certificates — no quality or compliance documents uploaded for this shipment yet.
                            </td>
                          </tr>
                        ) : (
                          detail.documents.map((d) => (
                            <tr key={d.id} className="border-b border-border/60">
                              <td className="py-2 font-medium">{titleCase(d.doc_type)}</td>
                              <td className="font-mono">{d.reference_number || "—"}</td>
                              <td>{d.issuer || "—"}</td>
                              <td>{d.expiry_date || "—"}</td>
                              <td>
                                <Can anyOf={["inbound.documents", "inbound.quality", "inbound.decision"]} mode="hide">
                                  <a
                                    href={`/api/v1/inbound/shipments/${detail.shipment.id}/documents/${d.id}/download`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-primary underline"
                                  >
                                    <Download className="h-3 w-3" />
                                    {d.file_name}
                                  </a>
                                </Can>
                              </td>
                              <td>
                                <Badge
                                  tone={
                                    d.status === "verified"
                                      ? "ok"
                                      : d.status === "rejected" || d.status === "expired"
                                        ? "critical"
                                        : "warning"
                                  }
                                >
                                  {titleCase(d.status)}
                                </Badge>
                              </td>
                              <td>{d.verified_by || "—"}</td>
                              <td>
                                <div className="flex flex-wrap items-center gap-1">
                                  <Can permission="inbound.documents" mode="disable">
                                    <button
                                      onClick={() => verifyDoc(d.id, "verified")}
                                      className="btn btn-secondary px-2 py-1 text-[11px]"
                                    >
                                      Verify
                                    </button>
                                  </Can>
                                  <Can permission="inbound.documents" mode="disable">
                                    <button
                                      onClick={() => verifyDoc(d.id, "rejected")}
                                      className="btn btn-secondary px-2 py-1 text-[11px]"
                                    >
                                      Reject
                                    </button>
                                  </Can>
                                  <Can permission="inbound.documents" mode="disable">
                                    <button
                                      onClick={() => verifyDoc(d.id, "expired")}
                                      className="btn btn-secondary px-2 py-1 text-[11px]"
                                    >
                                      Mark Expired
                                    </button>
                                  </Can>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 5: QUALITY INSPECTION & RECEIVING DECISION */}
              {activeTab === "quality" && (
                <div className="space-y-4">
                  <div className="grid gap-4 lg:grid-cols-2">
                    {/* Record Quality Check */}
                    <div className="rounded-xl border border-border p-3">
                      <SectionHeader
                        title="Record Quality Inspection Check"
                        description="Inspect visual appearance, packaging, temperature, catch-weight, batch expiry, and certificates."
                      />
                      <div className="mt-3 space-y-2">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <label className="text-xs text-muted-foreground">Inspection Check Type</label>
                            <select
                              className="input mt-1 w-full"
                              value={qcForm.check_type}
                              onChange={(e) => setQcForm({ ...qcForm, check_type: e.target.value })}
                            >
                              {INBOUND_QUALITY_CHECK_TYPES.map((ct) => (
                                <option key={ct} value={ct}>
                                  {titleCase(ct)}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Inspection Result</label>
                            <select
                              className="input mt-1 w-full"
                              value={qcForm.result}
                              onChange={(e) => setQcForm({ ...qcForm, result: e.target.value })}
                            >
                              <option value="pass">Pass (Approved)</option>
                              <option value="conditional_pass">Conditional Pass</option>
                              <option value="fail">Fail (Non-Conforming)</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Inspector Notes & Corrective Action</label>
                          <input
                            className="input mt-1 w-full"
                            placeholder="Packaging intact, sensory check normal..."
                            value={qcForm.notes}
                            onChange={(e) => setQcForm({ ...qcForm, notes: e.target.value })}
                          />
                        </div>
                        <Can permission="inbound.quality" mode="disable">
                          <button onClick={submitQualityCheck} className="btn btn-primary w-full">
                            Record quality inspection
                          </button>
                        </Can>
                      </div>
                    </div>

                    {/* Final Receiving Decision */}
                    <div className="rounded-xl border border-border p-3">
                      <SectionHeader
                        title="Receiving Decision & Inventory Disposition"
                        description="Accept stock into sellable FEFO inventory, partially accept by adjusting batch quantities, quarantine, or reject."
                      />
                      <div className="mt-3 space-y-2">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <label className="text-xs text-muted-foreground">Target Storage Bin (Accept)</label>
                            <select
                              className="input mt-1 w-full"
                              value={decisionForm.bin}
                              onChange={(e) => setDecisionForm({ ...decisionForm, bin: e.target.value })}
                            >
                              {BIN_OPTIONS.map((b) => (
                                <option key={b} value={b}>
                                  {b}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Quarantine Bin</label>
                            <input
                              className="input mt-1 w-full"
                              value={decisionForm.quarantine_bin}
                              onChange={(e) => setDecisionForm({ ...decisionForm, quarantine_bin: e.target.value })}
                            />
                          </div>
                        </div>

                        {/* Per-Batch Accepted Qty Override for Partial Acceptance */}
                        {detail.batches.filter((b) => b.status === "received").length > 0 && (
                          <div className="rounded-lg bg-muted/30 p-2 text-xs">
                            <div className="font-medium text-muted-foreground">
                              Batch Acceptance Quantities (reduce for Partial Acceptance):
                            </div>
                            <div className="mt-1.5 space-y-1">
                              {detail.batches
                                .filter((b) => b.status === "received")
                                .map((b) => (
                                  <div key={b.id} className="flex items-center justify-between gap-2">
                                    <span className="font-mono">
                                      {b.internal_lot} ({b.sku} · recv {b.quantity})
                                    </span>
                                    <input
                                      type="number"
                                      min={0}
                                      max={b.quantity}
                                      className="input w-24 py-1 text-right text-xs"
                                      value={decisionForm.batchAcceptedQty[b.id] ?? String(b.quantity)}
                                      onChange={(e) =>
                                        setDecisionForm((prev) => ({
                                          ...prev,
                                          batchAcceptedQty: { ...prev.batchAcceptedQty, [b.id]: e.target.value }
                                        }))
                                      }
                                    />
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}

                        <div>
                          <label className="text-xs text-muted-foreground">
                            Decision Reason (required for Quarantine / Reject)
                          </label>
                          <input
                            className="input mt-1 w-full"
                            placeholder="Reason for partial acceptance, quarantine, or rejection..."
                            value={decisionForm.reason}
                            onChange={(e) => setDecisionForm({ ...decisionForm, reason: e.target.value })}
                          />
                        </div>

                        <div className="flex flex-wrap gap-2 pt-1">
                          <Can permission="inbound.decision" mode="disable">
                            <button onClick={acceptShipmentDecision} className="btn btn-primary flex-1">
                              Accept into FEFO Stock
                            </button>
                          </Can>
                          <Can permission="inbound.decision" mode="hide">
                            <button onClick={quarantineShipmentDecision} className="btn btn-secondary">
                              Quarantine Stock
                            </button>
                          </Can>
                          <Can permission="inbound.decision" mode="disable">
                            <button onClick={rejectShipmentDecision} className="btn btn-danger">
                              Reject Shipment
                            </button>
                          </Can>
                        </div>
                      </div>
                    </div>
                  </div>

                  <SectionHeader title="Quality Inspection Log" />
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="py-2">Check Type</th>
                          <th>Result</th>
                          <th>Inspector</th>
                          <th>Performed At</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.quality_checks.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-4 text-center text-muted-foreground">
                              No quality checks recorded yet.
                            </td>
                          </tr>
                        ) : (
                          detail.quality_checks.map((qc) => (
                            <tr key={qc.id} className="border-b border-border/60">
                              <td className="py-2 font-medium">{titleCase(qc.check_type)}</td>
                              <td>
                                <Badge
                                  tone={
                                    qc.result === "pass"
                                      ? "ok"
                                      : qc.result === "conditional_pass"
                                        ? "warning"
                                        : "critical"
                                  }
                                >
                                  {titleCase(qc.result)}
                                </Badge>
                              </td>
                              <td>{qc.performed_by}</td>
                              <td>{qc.performed_at.slice(0, 19).replace("T", " ")}</td>
                              <td>{qc.notes || "—"}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 6: AUDIT TRAIL */}
              {activeTab === "history" && (
                <div className="space-y-3">
                  <SectionHeader
                    title="Inbound Receiving Audit Trail"
                    description="Immutable log of shipment registration, arrival, temperature logs, batch verification, certificates, quality checks, and stock disposition."
                  />
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="py-2">Timestamp</th>
                          <th>Action</th>
                          <th>Actor</th>
                          <th>Role</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-4 text-center text-muted-foreground">
                              No audit events found for this shipment.
                            </td>
                          </tr>
                        ) : (
                          history.map((ev: any) => (
                            <tr key={ev.id} className="border-b border-border/60">
                              <td className="py-2 font-mono">{String(ev.created_at).slice(0, 19).replace("T", " ")}</td>
                              <td className="font-medium">{ev.action}</td>
                              <td>{ev.actor_email}</td>
                              <td>{titleCase(String(ev.actor_role || ""))}</td>
                              <td className="max-w-md truncate font-mono text-[11px] text-muted-foreground">
                                {ev.after_json || "—"}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </Surface>
      </div>
    </div>
  );
}
