"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  Download,
  FilePlus2,
  PackageCheck,
  Plus,
  Trash2,
  X
} from "lucide-react";
import { Badge, ProgressBar, SectionHeader, Surface, statusTone } from "@/components/ui";
import { Can, ViewOnlyBadge } from "@/components/access-gate";
import { dateTime, money, percent, shortDate, titleCase } from "@/lib/format";
import {
  computeLandedCost,
  type ProcurementPurchaseOrder,
  type ProcurementQuotation,
  type ProcurementRfq,
  type SupplierScorecard
} from "@/lib/procurement";
import type { Product } from "@/lib/types";

function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function caseWeightKg(product: Product | undefined): number | null {
  if (!product) return null;
  if (product.case_weight_kg && product.case_weight_kg > 0) return product.case_weight_kg;
  if (product.unit_weight_kg && product.units_per_case) {
    return Math.round(product.unit_weight_kg * product.units_per_case * 100) / 100;
  }
  return null;
}

function gradeTone(grade: SupplierScorecard["grade"]): "ok" | "info" | "warning" | "critical" {
  if (grade === "A") return "ok";
  if (grade === "B") return "info";
  if (grade === "C") return "warning";
  return "critical";
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "The request could not be completed.");
  }
  return payload as T;
}

function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`my-4 w-full ${wide ? "max-w-5xl" : "max-w-2xl"} overflow-hidden rounded-xl border border-border bg-card text-left shadow-xl`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{subtitle}</p>}
          </div>
          <button type="button" aria-label="Close" className="btn btn-ghost btn-sm shrink-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  hint
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="field-label">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[10px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function ProcurementWorkbench({
  suppliers,
  products,
  rfqs,
  purchaseOrders
}: {
  suppliers: SupplierScorecard[];
  products: Product[];
  rfqs: ProcurementRfq[];
  purchaseOrders: ProcurementPurchaseOrder[];
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newRfqOpen, setNewRfqOpen] = useState(false);
  const [newPoOpen, setNewPoOpen] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [scorecardCode, setScorecardCode] = useState<string | null>(null);
  const [activeRfqId, setActiveRfqId] = useState<string | null>(null);
  const [activePoNumber, setActivePoNumber] = useState<string | null>(null);
  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const [showAsnForm, setShowAsnForm] = useState(false);

  const activeRfq = rfqs.find((rfq) => rfq.id === activeRfqId) ?? null;
  const activePo = purchaseOrders.find((po) => po.po_number === activePoNumber) ?? null;
  const scorecard = suppliers.find((supplier) => supplier.code === scorecardCode) ?? null;

  const defaultSupplier = suppliers[0]?.code ?? "";
  const defaultProduct = products[0];

  const [rfqForm, setRfqForm] = useState({
    sku: defaultProduct?.sku ?? "",
    quantity_cases: "100",
    needed_by: isoDate(7),
    incoterm: "DAP",
    destination: "Milan Cold Hub",
    notes: ""
  });

  const [quoteForm, setQuoteForm] = useState({
    supplier_id: defaultSupplier,
    unit_cost: "",
    freight: "0",
    duty_pct: "0",
    other: "0",
    lead_time_days: "2",
    valid_until: isoDate(14),
    incoterm: "DAP",
    notes: ""
  });

  const [awardForm, setAwardForm] = useState({
    asn_reference: "",
    asn_carrier: "",
    asn_eta: "",
    asn_notes: ""
  });

  const [poForm, setPoForm] = useState({
    supplier_id: defaultSupplier,
    sku: defaultProduct?.sku ?? "",
    cases: "100",
    unit_cost: "",
    freight: "0",
    duty_pct: "0",
    other: "0",
    expected_date: isoDate(7),
    incoterm: "DAP",
    asn_reference: "",
    asn_carrier: "",
    asn_eta: "",
    asn_notes: ""
  });

  const [supplierForm, setSupplierForm] = useState({
    name: "",
    country: "Italy",
    region: "Lombardia",
    category: "Produce",
    leadTimeDays: "2"
  });

  const [poActionForm, setPoActionForm] = useState({
    accepted_cases: "",
    temp_c: "2.4",
    expiry_date: "",
    asn_reference: "",
    asn_carrier: "",
    asn_eta: "",
    asn_notes: ""
  });

  const notify = (message: string) => {
    setError(null);
    setFeedback(message);
    window.setTimeout(() => setFeedback(null), 5000);
  };

  const fail = (message: string) => {
    setFeedback(null);
    setError(message);
    window.setTimeout(() => setError(null), 6500);
  };

  useEffect(() => {
    if (!activeRfqId) return;
    const rfq = rfqs.find((row) => row.id === activeRfqId);
    if (!rfq) return;
    setSelectedQuoteId(rfq.selected_quotation_id ?? rfq.recommended_quotation_id ?? "");
    setShowQuoteForm(rfq.quotations.length === 0);
  }, [activeRfqId]);

  useEffect(() => {
    if (!activePo) return;
    setPoActionForm({
      accepted_cases: String(activePo.ordered_cases),
      temp_c: "2.4",
      expiry_date: "",
      asn_reference: activePo.asn_reference ?? "",
      asn_carrier: activePo.asn_carrier ?? "",
      asn_eta: activePo.asn_eta ?? "",
      asn_notes: activePo.asn_notes ?? ""
    });
    setShowAsnForm(!activePo.asn_reference);
  }, [activePoNumber]);

  const rfqProduct = products.find((product) => product.sku === rfqForm.sku);
  const rfqCaseWeight = caseWeightKg(rfqProduct);

  const quotePreview = useMemo(() => {
    if (!activeRfq) return null;
    return computeLandedCost({
      quantity_cases: activeRfq.quantity_cases,
      unit_cost_cents: Math.round((Number(quoteForm.unit_cost) || 0) * 100),
      freight_cents: Math.round((Number(quoteForm.freight) || 0) * 100),
      duty_pct: Number(quoteForm.duty_pct) || 0,
      other_cents: Math.round((Number(quoteForm.other) || 0) * 100)
    });
  }, [activeRfq, quoteForm]);

  const poProduct = products.find((product) => product.sku === poForm.sku);
  const poPreview = useMemo(
    () =>
      computeLandedCost({
        quantity_cases: Number(poForm.cases) || 0,
        unit_cost_cents: Math.round((Number(poForm.unit_cost) || 0) * 100),
        freight_cents: Math.round((Number(poForm.freight) || 0) * 100),
        duty_pct: Number(poForm.duty_pct) || 0,
        other_cents: Math.round((Number(poForm.other) || 0) * 100)
      }),
    [poForm]
  );

  const openRfqModal = (rfq: ProcurementRfq) => {
    setNewRfqOpen(false);
    setNewPoOpen(false);
    setSupplierOpen(false);
    setScorecardCode(null);
    setActivePoNumber(null);
    setActiveRfqId(rfq.id);
    setShowQuoteForm(rfq.quotations.length === 0);
  };

  const openPoModal = (po: ProcurementPurchaseOrder) => {
    setActiveRfqId(null);
    setNewRfqOpen(false);
    setNewPoOpen(false);
    setSupplierOpen(false);
    setScorecardCode(null);
    setActivePoNumber(po.po_number);
  };

  const openSupplierModal = () => {
    setSupplierOpen(true);
    setNewRfqOpen(false);
    setNewPoOpen(false);
    setActiveRfqId(null);
    setActivePoNumber(null);
    setScorecardCode(null);
  };

  const openNewPo = () => {
    const product = products.find((row) => row.sku === poForm.sku) ?? defaultProduct;
    setPoForm((current) => ({
      ...current,
      unit_cost: product
        ? String((product.cost_price_cents ?? Math.round(product.unit_price_cents * 0.72)) / 100)
        : current.unit_cost
    }));
    setNewPoOpen(true);
    setNewRfqOpen(false);
    setSupplierOpen(false);
    setActiveRfqId(null);
    setActivePoNumber(null);
    setScorecardCode(null);
  };

  const exportScorecard = () => {
    const header = [
      "Code",
      "Supplier",
      "Grade",
      "Score",
      "Status",
      "On-time %",
      "Quality %",
      "Price variance %",
      "Lead time days",
      "Open orders",
      "Received orders",
      "Spend EUR",
      "Landed spend EUR",
      "Last PO"
    ];
    const rows = suppliers.map((supplier) => [
      supplier.code,
      supplier.name,
      supplier.grade,
      supplier.score,
      supplier.status,
      supplier.on_time_rate,
      supplier.quality_score,
      supplier.price_variance,
      supplier.lead_time_days,
      supplier.open_po_count,
      supplier.received_po_count,
      (supplier.spend_cents / 100).toFixed(2),
      (supplier.landed_spend_cents / 100).toFixed(2),
      supplier.last_po_at ?? ""
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "ascentra-supplier-scorecard.csv";
    link.click();
    URL.revokeObjectURL(url);
    notify("Supplier scorecard exported as CSV.");
  };

  const submitSupplier = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supplierForm.name.trim()) {
      fail("Please enter a supplier name.");
      return;
    }
    setBusy(true);
    try {
      await requestJson("/api/v1/suppliers", {
        method: "POST",
        headers: { "Idempotency-Key": `sup-${Date.now()}` },
        body: JSON.stringify({
          action: "create_supplier",
          name: supplierForm.name.trim(),
          country: supplierForm.country,
          region: supplierForm.region,
          category: supplierForm.category,
          lead_time_days: Number(supplierForm.leadTimeDays) || 2
        })
      });
      notify(`Supplier "${supplierForm.name.trim()}" added.`);
      setSupplierOpen(false);
      setSupplierForm({ name: "", country: "Italy", region: "Lombardia", category: "Produce", leadTimeDays: "2" });
      router.refresh();
    } catch (err) {
      fail(err instanceof Error ? err.message : "Unable to add supplier.");
    } finally {
      setBusy(false);
    }
  };

  const submitRfq = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!rfqForm.sku) {
      fail("Select a product before creating an RFQ.");
      return;
    }
    setBusy(true);
    try {
      const data = await requestJson<{ rfq: ProcurementRfq }>("/api/v1/procurement/rfqs", {
        method: "POST",
        headers: { "Idempotency-Key": `rfq-${Date.now()}` },
        body: JSON.stringify({
          sku: rfqForm.sku,
          quantity_cases: Number(rfqForm.quantity_cases) || 0,
          needed_by: rfqForm.needed_by,
          incoterm: rfqForm.incoterm,
          destination: rfqForm.destination,
          notes: rfqForm.notes
        })
      });
      notify(`${data.rfq.id} created for ${data.rfq.quantity_cases} cases. Add supplier quotations to compare landed cost.`);
      setNewRfqOpen(false);
      setActiveRfqId(data.rfq.id);
      setShowQuoteForm(true);
      setQuoteForm((current) => ({
        ...current,
        unit_cost: "",
        freight: "0",
        duty_pct: "0",
        other: "0",
        lead_time_days: String(suppliers[0]?.lead_time_days ?? 2),
        valid_until: isoDate(14),
        incoterm: rfqForm.incoterm
      }));
      router.refresh();
    } catch (err) {
      fail(err instanceof Error ? err.message : "Unable to create RFQ.");
    } finally {
      setBusy(false);
    }
  };

  const submitQuotation = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeRfq) return;
    const unitCost = Math.round((Number(quoteForm.unit_cost) || 0) * 100);
    if (unitCost <= 0) {
      fail("Enter the supplier's unit cost per case.");
      return;
    }
    setBusy(true);
    try {
      await requestJson(`/api/v1/procurement/rfqs/${encodeURIComponent(activeRfq.id)}/quotations`, {
        method: "POST",
        headers: { "Idempotency-Key": `qtn-${activeRfq.id}-${quoteForm.supplier_id}-${Date.now()}` },
        body: JSON.stringify({
          supplier_id: quoteForm.supplier_id,
          unit_cost_cents: unitCost,
          freight_cents: Math.round((Number(quoteForm.freight) || 0) * 100),
          duty_pct: Number(quoteForm.duty_pct) || 0,
          other_cents: Math.round((Number(quoteForm.other) || 0) * 100),
          lead_time_days: Number(quoteForm.lead_time_days) || 2,
          valid_until: quoteForm.valid_until || undefined,
          incoterm: quoteForm.incoterm,
          notes: quoteForm.notes
        })
      });
      notify(`Quotation recorded on ${activeRfq.id}. Comparison recalculated with landed cost.`);
      setShowQuoteForm(false);
      setQuoteForm((current) => ({ ...current, unit_cost: "", freight: "0", duty_pct: "0", other: "0", notes: "" }));
      router.refresh();
    } catch (err) {
      fail(err instanceof Error ? err.message : "Unable to record quotation.");
    } finally {
      setBusy(false);
    }
  };

  const removeQuotation = async (quotation: ProcurementQuotation) => {
    if (!activeRfq) return;
    if (!window.confirm(`Remove the quotation from ${quotation.supplier_name}?`)) return;
    setBusy(true);
    try {
      await requestJson(
        `/api/v1/procurement/rfqs/${encodeURIComponent(activeRfq.id)}/quotations/${encodeURIComponent(quotation.id)}`,
        { method: "DELETE" }
      );
      notify(`Quotation from ${quotation.supplier_name} removed.`);
      router.refresh();
    } catch (err) {
      fail(err instanceof Error ? err.message : "Unable to remove quotation.");
    } finally {
      setBusy(false);
    }
  };

  const awardQuotation = async () => {
    if (!activeRfq || !selectedQuoteId) {
      fail("Select a quotation to award.");
      return;
    }
    setBusy(true);
    try {
      const data = await requestJson<{ purchase_order: ProcurementPurchaseOrder }>(
        `/api/v1/procurement/rfqs/${encodeURIComponent(activeRfq.id)}/award`,
        {
          method: "POST",
          headers: { "Idempotency-Key": `award-${activeRfq.id}-${selectedQuoteId}` },
          body: JSON.stringify({
            quotation_id: selectedQuoteId,
            asn_reference: awardForm.asn_reference || undefined,
            asn_carrier: awardForm.asn_carrier || undefined,
            asn_eta: awardForm.asn_eta || undefined,
            asn_notes: awardForm.asn_notes || undefined
          })
        }
      );
      notify(
        `${data.purchase_order.po_number} raised as an approved PO at ${money(
          data.purchase_order.landed_cost_cents ?? data.purchase_order.total_cents
        )} expected landed cost.`
      );
      setAwardForm({ asn_reference: "", asn_carrier: "", asn_eta: "", asn_notes: "" });
      setActiveRfqId(null);
      setActivePoNumber(data.purchase_order.po_number);
      router.refresh();
    } catch (err) {
      fail(err instanceof Error ? err.message : "Unable to award RFQ.");
    } finally {
      setBusy(false);
    }
  };

  const submitDirectPo = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!poForm.sku || !poForm.supplier_id) {
      fail("Select a supplier and product.");
      return;
    }
    const unitCost = Math.round((Number(poForm.unit_cost) || 0) * 100);
    if (unitCost <= 0) {
      fail("Enter the agreed unit cost per case.");
      return;
    }
    setBusy(true);
    try {
      const data = await requestJson<{ purchase_order: ProcurementPurchaseOrder }>(
        "/api/v1/procurement/purchase-orders",
        {
          method: "POST",
          headers: { "Idempotency-Key": `po-${Date.now()}` },
          body: JSON.stringify({
            supplier_id: poForm.supplier_id,
            sku: poForm.sku,
            cases: Number(poForm.cases) || 0,
            expected_date: poForm.expected_date,
            unit_cost_cents: unitCost,
            freight_cents: Math.round((Number(poForm.freight) || 0) * 100),
            duty_pct: Number(poForm.duty_pct) || 0,
            other_cents: Math.round((Number(poForm.other) || 0) * 100),
            incoterm: poForm.incoterm,
            asn_reference: poForm.asn_reference || undefined,
            asn_carrier: poForm.asn_carrier || undefined,
            asn_eta: poForm.asn_eta || undefined,
            asn_notes: poForm.asn_notes || undefined
          })
        }
      );
      notify(
        `${data.purchase_order.po_number} raised as an approved PO. Expected landed cost ${money(
          data.purchase_order.landed_cost_cents ?? data.purchase_order.total_cents
        )}.`
      );
      setNewPoOpen(false);
      setActivePoNumber(data.purchase_order.po_number);
      router.refresh();
    } catch (err) {
      fail(err instanceof Error ? err.message : "Unable to raise purchase order.");
    } finally {
      setBusy(false);
    }
  };

  const approvePo = async () => {
    if (!activePo) return;
    setBusy(true);
    try {
      await requestJson(
        `/api/v1/procurement/purchase-orders/${encodeURIComponent(activePo.po_number)}/approve`,
        {
          method: "POST",
          headers: { "Idempotency-Key": `approve-${activePo.po_number}` },
          body: JSON.stringify({
            asn_reference: poActionForm.asn_reference || undefined,
            asn_carrier: poActionForm.asn_carrier || undefined,
            asn_eta: poActionForm.asn_eta || undefined,
            asn_notes: poActionForm.asn_notes || undefined
          })
        }
      );
      notify(`${activePo.po_number} approved and released for receiving.`);
      router.refresh();
    } catch (err) {
      fail(err instanceof Error ? err.message : "Unable to approve purchase order.");
    } finally {
      setBusy(false);
    }
  };

  const saveAsn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activePo) return;
    if (!poActionForm.asn_reference.trim()) {
      fail("Enter the supplier ASN reference.");
      return;
    }
    setBusy(true);
    try {
      await requestJson(
        `/api/v1/procurement/purchase-orders/${encodeURIComponent(activePo.po_number)}/asn`,
        {
          method: "POST",
          headers: { "Idempotency-Key": `asn-${activePo.po_number}-${Date.now()}` },
          body: JSON.stringify({
            asn_reference: poActionForm.asn_reference,
            asn_carrier: poActionForm.asn_carrier,
            asn_eta: poActionForm.asn_eta,
            asn_notes: poActionForm.asn_notes
          })
        }
      );
      notify(`ASN ${poActionForm.asn_reference} captured against ${activePo.po_number}.`);
      setShowAsnForm(false);
      router.refresh();
    } catch (err) {
      fail(err instanceof Error ? err.message : "Unable to capture ASN.");
    } finally {
      setBusy(false);
    }
  };

  const receivePo = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activePo) return;
    setBusy(true);
    try {
      await requestJson("/api/v1/suppliers", {
        method: "POST",
        headers: { "Idempotency-Key": `rcv-${activePo.po_number}-${Date.now()}` },
        body: JSON.stringify({
          action: "receive_po",
          po_number: activePo.po_number,
          temp_c: Number(poActionForm.temp_c) || 0,
          accepted_cases: Number(poActionForm.accepted_cases) || activePo.ordered_cases,
          expiry_date: poActionForm.expiry_date || undefined
        })
      });
      notify(`${activePo.po_number} received into the cold hub.`);
      router.refresh();
    } catch (err) {
      fail(err instanceof Error ? err.message : "Unable to receive purchase order.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2" data-testid="procurement-toolbar">
        <div className="flex flex-wrap items-center gap-2">
          <Can permission="exports.run" mode="hide">
            <button type="button" className="btn btn-secondary" onClick={exportScorecard} data-testid="export-scorecard">
              <Download className="h-3.5 w-3.5" /> Export scorecard
            </button>
          </Can>
          <button type="button" className="btn btn-secondary" onClick={openSupplierModal} data-testid="add-supplier">
            <FilePlus2 className="h-3.5 w-3.5" /> Add supplier
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={suppliers.length === 0 || products.length === 0}
            onClick={openNewPo}
            data-testid="raise-po"
          >
            <PackageCheck className="h-3.5 w-3.5" /> Raise PO
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={suppliers.length === 0 || products.length === 0}
            title={
              suppliers.length === 0 || products.length === 0
                ? "Add an approved supplier and product before raising an RFQ"
                : "Create a request for quotation"
            }
            onClick={() => {
              setNewRfqOpen(true);
              setActiveRfqId(null);
              setActivePoNumber(null);
            }}
            data-testid="new-rfq"
          >
            <FilePlus2 className="h-3.5 w-3.5" /> New RFQ
          </button>
        </div>
      </div>

      {feedback && (
        <div className="fixed bottom-5 right-5 z-[90] max-w-sm rounded-xl border border-marine-ocean/60 bg-white px-4 py-3 text-xs font-medium text-marine-mid/90 shadow-xl" data-testid="procurement-feedback">
          <span className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {feedback}
          </span>
        </div>
      )}
      {error && (
        <div className="fixed bottom-5 right-5 z-[90] max-w-sm rounded-xl border border-red-200 bg-white px-4 py-3 text-xs font-medium text-red-700 shadow-xl" data-testid="procurement-error">
          <span className="flex items-start gap-2">
            <X className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </span>
        </div>
      )}

      <Surface className="mb-5">
        <SectionHeader
          eyebrow="Supplier scorecards"
          title="Performance, price and quality evidence"
          description="Live scorecards combine on-time receipts, released quality and quoted price variance. Blocked or review suppliers cannot be awarded a purchase order."
        />
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {suppliers.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-8 text-center md:col-span-2 xl:col-span-3">
              <p className="text-sm font-medium">No suppliers yet</p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                Add an approved supplier to start building scorecards, RFQs and purchase orders.
              </p>
            </div>
          )}
          {suppliers.map((supplier) => (
            <button
              key={supplier.code}
              type="button"
              onClick={() => setScorecardCode(supplier.code)}
              className="rounded-xl border border-border bg-background p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/30"
              data-testid={`supplier-scorecard-${supplier.code}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="field-label">{supplier.code}</p>
                  <h3 className="mt-1 truncate text-sm font-semibold">{supplier.name}</h3>
                  <p className="truncate text-[11px] text-muted-foreground">{supplier.category} · {supplier.country}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone={gradeTone(supplier.grade)}>Grade {supplier.grade}</Badge>
                  <span className="text-[10px] text-muted-foreground">{supplier.score}/100</span>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                <div>
                  <div className="mb-1 flex justify-between text-[11px]">
                    <span className="text-muted-foreground">On-time delivery</span>
                    <span className="font-semibold">{percent(supplier.on_time_rate)}</span>
                  </div>
                  <ProgressBar value={supplier.on_time_rate} tone={supplier.on_time_rate >= 95 ? "ok" : "warning"} />
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Quality released</span>
                    <span className="font-semibold">{supplier.quality_score}/100</span>
                  </div>
                  <ProgressBar value={supplier.quality_score} tone="ok" />
                </div>
                <div className="grid grid-cols-3 gap-2 border-t border-border pt-3 text-[10px]">
                  <div>
                    <p className="text-muted-foreground">Open POs</p>
                    <p className="mt-0.5 text-xs font-semibold">{supplier.open_po_count}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Landed spend</p>
                    <p className="mt-0.5 text-xs font-semibold">{money(supplier.landed_spend_cents)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Price var.</p>
                    <p className={`mt-0.5 text-xs font-semibold ${supplier.price_variance > 0 ? "text-amber-700" : "text-marine-mid"}`}>
                      {supplier.price_variance > 0 ? "+" : ""}{supplier.price_variance.toFixed(1)}%
                    </p>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </Surface>

      <div className="mb-5 grid gap-5">
        <Surface>
          <SectionHeader
            eyebrow="RFQ and quotation comparison"
            title="Select on landed cost, not unit price"
            description="Compare goods, freight, duty and other costs per quotation before awarding an approved purchase order."
            action={
              <span className="inline-flex items-center gap-2">
                <ViewOnlyBadge modifyPermissions={["suppliers:write", "procurement:receive", "exports.run"]} />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={suppliers.length === 0 || products.length === 0}
                  onClick={() => setNewRfqOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" /> RFQ
                </button>
              </span>
            }
          />
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>RFQ / Product</th>
                  <th>Quantity</th>
                  <th>Quotes</th>
                  <th>Best landed</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rfqs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                      No RFQs yet. Create one to invite quotations and compare landed cost.
                    </td>
                  </tr>
                )}
                {rfqs.map((rfq) => (
                  <tr
                    key={rfq.id}
                    className="cursor-pointer"
                    onClick={() => openRfqModal(rfq)}
                    data-testid={`rfq-row-${rfq.id}`}
                  >
                    <td data-label="RFQ / Product">
                      <p className="font-mono text-[11px] font-semibold">{rfq.id}</p>
                      <p className="mt-0.5 font-medium">{rfq.product_name}</p>
                      <p className="text-[10px] text-muted-foreground">{rfq.sku}</p>
                    </td>
                    <td data-label="Quantity" className="text-[11px]">
                      {rfq.quantity_cases} cases
                      <p className="text-[10px] text-muted-foreground">by {shortDate(rfq.needed_by)}</p>
                    </td>
                    <td data-label="Quotes" className="text-[11px]">{rfq.quotations.length}</td>
                    <td data-label="Best landed" className="whitespace-nowrap text-[11px] font-semibold">
                      {rfq.best_landed_cost_cents !== null ? money(rfq.best_landed_cost_cents) : "—"}
                    </td>
                    <td data-label="Status">
                      <Badge tone={statusTone(rfq.status)} dot>{titleCase(rfq.status)}</Badge>
                    </td>
                    <td data-label="Action">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          openRfqModal(rfq);
                        }}
                      >
                        Compare <ArrowRight className="h-3 w-3" />
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
            eyebrow="Inbound pipeline"
            title="Purchase orders, approval and ASN"
            description="Landed cost includes freight, duty and other approved costs. ASN is captured only when the supplier provides one."
            action={
              <span className="inline-flex items-center gap-2">
                <ViewOnlyBadge modifyPermissions={["suppliers:write", "procurement:receive", "exports.run"]} />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={suppliers.length === 0 || products.length === 0}
                  onClick={openNewPo}
                >
                  <Plus className="h-3.5 w-3.5" /> PO
                </button>
              </span>
            }
          />
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>PO / Supplier</th>
                  <th>Status</th>
                  <th>Expected</th>
                  <th>ASN</th>
                  <th className="text-right">Landed</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {purchaseOrders.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                      No purchase orders yet. Award an RFQ or raise a PO from an approved supplier.
                    </td>
                  </tr>
                )}
                {purchaseOrders.map((po) => (
                  <tr
                    key={po.id}
                    className="cursor-pointer"
                    onClick={() => openPoModal(po)}
                    data-testid={`po-row-${po.po_number}`}
                  >
                    <td data-label="PO / Supplier">
                      <p className="font-mono text-[11px] font-semibold">{po.po_number}</p>
                      <p className="mt-0.5 font-medium">{po.supplier_name}</p>
                      <p className="text-[10px] text-muted-foreground">{po.product_name} · {po.ordered_cases} cases</p>
                    </td>
                    <td data-label="Status">
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={statusTone(po.status)} dot>{titleCase(po.status)}</Badge>
                        <Badge tone={statusTone(po.approval_status)}>{titleCase(po.approval_status)}</Badge>
                      </div>
                    </td>
                    <td data-label="Expected" className="whitespace-nowrap text-[11px]">{shortDate(po.expected_date)}</td>
                    <td data-label="ASN" className="text-[11px]">
                      {po.asn_reference ? (
                        <span className="font-mono">{po.asn_reference}</span>
                      ) : (
                        <span className="text-muted-foreground">Not provided</span>
                      )}
                    </td>
                    <td data-label="Landed" className="whitespace-nowrap text-right text-[11px] font-semibold">
                      {money(po.landed_cost_cents ?? po.total_cents)}
                    </td>
                    <td data-label="Action">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          openPoModal(po);
                        }}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Surface>
      </div>

      {newRfqOpen && (
        <Modal
          title="New request for quotation"
          subtitle="Define the requirement once, then record and compare supplier quotations on landed cost."
          onClose={() => setNewRfqOpen(false)}
        >
          <form onSubmit={submitRfq}>
            <div className="space-y-3 px-5 py-4">
              <Field label="Product *">
                <select
                  className="input"
                  value={rfqForm.sku}
                  onChange={(event) => setRfqForm({ ...rfqForm, sku: event.target.value })}
                  data-testid="rfq-product"
                >
                  {products.map((product) => (
                    <option key={product.sku} value={product.sku}>
                      {product.name} · {product.sku}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Quantity (cases) *" hint={rfqCaseWeight ? `≈ ${(Number(rfqForm.quantity_cases) * rfqCaseWeight).toFixed(0)} kg at ${rfqCaseWeight} kg/case` : undefined}>
                  <input
                    type="number"
                    min="1"
                    className="input"
                    value={rfqForm.quantity_cases}
                    onChange={(event) => setRfqForm({ ...rfqForm, quantity_cases: event.target.value })}
                    data-testid="rfq-quantity"
                  />
                </Field>
                <Field label="Needed by *">
                  <input
                    type="date"
                    className="input"
                    value={rfqForm.needed_by}
                    onChange={(event) => setRfqForm({ ...rfqForm, needed_by: event.target.value })}
                    data-testid="rfq-needed-by"
                  />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Incoterm">
                  <select
                    className="input"
                    value={rfqForm.incoterm}
                    onChange={(event) => setRfqForm({ ...rfqForm, incoterm: event.target.value })}
                  >
                    {["DAP", "DDP", "FCA", "FOB", "EXW", "CIF"].map((term) => (
                      <option key={term} value={term}>{term}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Destination">
                  <input
                    className="input"
                    value={rfqForm.destination}
                    onChange={(event) => setRfqForm({ ...rfqForm, destination: event.target.value })}
                  />
                </Field>
              </div>
              <Field label="Notes">
                <textarea
                  className="input min-h-[70px]"
                  value={rfqForm.notes}
                  onChange={(event) => setRfqForm({ ...rfqForm, notes: event.target.value })}
                  placeholder="Specification, packaging, certificate or delivery constraints"
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button type="button" className="btn btn-secondary" onClick={() => setNewRfqOpen(false)}>Cancel</button>
              <Can permission="suppliers:write" mode="disable">
                <button type="submit" className="btn btn-primary" disabled={busy} data-testid="submit-rfq">
                  {busy ? "Creating..." : "Create RFQ"}
                </button>
              </Can>
            </div>
          </form>
        </Modal>
      )}

      {newPoOpen && (
        <Modal
          title="Raise purchase order"
          subtitle="Record the agreed cost and expected landed cost. ASN can be added now or captured later."
          onClose={() => setNewPoOpen(false)}
          wide
        >
          <form onSubmit={submitDirectPo}>
            <div className="grid gap-4 px-5 py-4 lg:grid-cols-[1.4fr_1fr]">
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Approved supplier *">
                    <select
                      className="input"
                      value={poForm.supplier_id}
                      onChange={(event) => setPoForm({ ...poForm, supplier_id: event.target.value })}
                      data-testid="po-supplier"
                    >
                      {suppliers.map((supplier) => (
                        <option key={supplier.code} value={supplier.code} disabled={supplier.status !== "approved"}>
                          {supplier.name} · {titleCase(supplier.status)} · {supplier.grade}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Product *">
                    <select
                      className="input"
                      value={poForm.sku}
                      onChange={(event) => {
                        const product = products.find((row) => row.sku === event.target.value);
                        setPoForm({
                          ...poForm,
                          sku: event.target.value,
                          unit_cost: product
                            ? String((product.cost_price_cents ?? Math.round(product.unit_price_cents * 0.72)) / 100)
                            : poForm.unit_cost
                        });
                      }}
                      data-testid="po-product"
                    >
                      {products.map((product) => (
                        <option key={product.sku} value={product.sku}>{product.name} · {product.sku}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Cases *">
                    <input
                      type="number"
                      min="1"
                      className="input"
                      value={poForm.cases}
                      onChange={(event) => setPoForm({ ...poForm, cases: event.target.value })}
                      data-testid="po-cases"
                    />
                  </Field>
                  <Field label="Unit cost / case (€) *">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="input"
                      value={poForm.unit_cost}
                      onChange={(event) => setPoForm({ ...poForm, unit_cost: event.target.value })}
                      data-testid="po-unit-cost"
                    />
                  </Field>
                  <Field label="Expected date">
                    <input
                      type="date"
                      className="input"
                      value={poForm.expected_date}
                      onChange={(event) => setPoForm({ ...poForm, expected_date: event.target.value })}
                    />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label="Freight (€)">
                    <input type="number" min="0" step="0.01" className="input" value={poForm.freight} onChange={(event) => setPoForm({ ...poForm, freight: event.target.value })} />
                  </Field>
                  <Field label="Duty (%)">
                    <input type="number" min="0" step="0.1" className="input" value={poForm.duty_pct} onChange={(event) => setPoForm({ ...poForm, duty_pct: event.target.value })} />
                  </Field>
                  <Field label="Other (€)">
                    <input type="number" min="0" step="0.01" className="input" value={poForm.other} onChange={(event) => setPoForm({ ...poForm, other: event.target.value })} />
                  </Field>
                  <Field label="Incoterm">
                    <select className="input" value={poForm.incoterm} onChange={(event) => setPoForm({ ...poForm, incoterm: event.target.value })}>
                      {["DAP", "DDP", "FCA", "FOB", "EXW", "CIF"].map((term) => <option key={term} value={term}>{term}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Supplier ASN (optional)</p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <Field label="ASN reference">
                      <input className="input" value={poForm.asn_reference} onChange={(event) => setPoForm({ ...poForm, asn_reference: event.target.value })} placeholder="e.g. ASN-2026-1042" data-testid="po-asn" />
                    </Field>
                    <Field label="Carrier">
                      <input className="input" value={poForm.asn_carrier} onChange={(event) => setPoForm({ ...poForm, asn_carrier: event.target.value })} placeholder="e.g. FrigoTrans" />
                    </Field>
                    <Field label="ASN ETA">
                      <input type="date" className="input" value={poForm.asn_eta} onChange={(event) => setPoForm({ ...poForm, asn_eta: event.target.value })} />
                    </Field>
                    <Field label="ASN notes">
                      <input className="input" value={poForm.asn_notes} onChange={(event) => setPoForm({ ...poForm, asn_notes: event.target.value })} placeholder="Pallet count, dock slot" />
                    </Field>
                  </div>
                </div>
              </div>
              <aside className="rounded-xl border border-border bg-muted/30 p-4">
                <p className="field-label">Expected landed cost</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight">{money(poPreview.landed_cost_cents)}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{money(poPreview.unit_landed_cost_cents)} per case</p>
                <dl className="mt-4 space-y-2 text-[11px]">
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Goods value</dt><dd className="font-medium">{money(poPreview.goods_cents)}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Freight</dt><dd className="font-medium">{money(poPreview.freight_cents)}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Duty</dt><dd className="font-medium">{money(poPreview.duty_cents)}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Other</dt><dd className="font-medium">{money(poPreview.other_cents)}</dd></div>
                </dl>
                {poProduct && (
                  <p className="mt-4 border-t border-border pt-3 text-[10px] leading-5 text-muted-foreground">
                    {poProduct.name} · {poForm.cases} cases
                    {caseWeightKg(poProduct) ? ` · ${(Number(poForm.cases) * (caseWeightKg(poProduct) ?? 0)).toFixed(0)} kg estimated` : ""}
                  </p>
                )}
              </aside>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button type="button" className="btn btn-secondary" onClick={() => setNewPoOpen(false)}>Cancel</button>
              <Can permission="suppliers:write" mode="disable">
                <button type="submit" className="btn btn-primary" disabled={busy} data-testid="submit-po">
                  {busy ? "Raising..." : "Raise approved PO"}
                </button>
              </Can>
            </div>
          </form>
        </Modal>
      )}

      {supplierOpen && (
        <Modal
          title="Add food supplier"
          subtitle="Register a producer or distributor for procurement, scorecards and traceability."
          onClose={() => setSupplierOpen(false)}
        >
          <form onSubmit={submitSupplier}>
            <div className="space-y-3 px-5 py-4">
              <Field label="Supplier company name *">
                <input
                  type="text"
                  required
                  className="input"
                  placeholder="e.g. Azienda Agricola BioVerde"
                  value={supplierForm.name}
                  onChange={(event) => setSupplierForm({ ...supplierForm, name: event.target.value })}
                  data-testid="supplier-name"
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Category">
                  <select className="input" value={supplierForm.category} onChange={(event) => setSupplierForm({ ...supplierForm, category: event.target.value })}>
                    {["Produce", "Dairy & Cheese", "Meat & Charcuterie", "Bakery & Pasta", "Beverages & Wine", "Frozen", "Dry Goods"].map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Lead time (days)">
                  <input type="number" min="1" max="60" className="input" value={supplierForm.leadTimeDays} onChange={(event) => setSupplierForm({ ...supplierForm, leadTimeDays: event.target.value })} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Region">
                  <input className="input" value={supplierForm.region} onChange={(event) => setSupplierForm({ ...supplierForm, region: event.target.value })} />
                </Field>
                <Field label="Country">
                  <input className="input" value={supplierForm.country} onChange={(event) => setSupplierForm({ ...supplierForm, country: event.target.value })} />
                </Field>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button type="button" className="btn btn-secondary" onClick={() => setSupplierOpen(false)}>Cancel</button>
              <Can permission="suppliers:write" mode="disable">
                <button type="submit" className="btn btn-primary" disabled={busy} data-testid="submit-supplier">Save supplier</button>
              </Can>
            </div>
          </form>
        </Modal>
      )}

      {scorecard && (
        <Modal
          title={`${scorecard.name} scorecard`}
          subtitle={`${scorecard.code} · ${scorecard.category} · ${scorecard.country}`}
          onClose={() => setScorecardCode(null)}
          wide
        >
          <div className="space-y-4 px-5 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={gradeTone(scorecard.grade)}>Grade {scorecard.grade}</Badge>
              <Badge tone={statusTone(scorecard.status)} dot>{titleCase(scorecard.status)}</Badge>
              <span className="text-sm font-semibold">{scorecard.score}/100 composite score</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-border p-3">
                <p className="field-label">On-time receipts</p>
                <p className="mt-1 text-lg font-semibold">{percent(scorecard.on_time_rate)}</p>
                <p className="text-[10px] text-muted-foreground">{scorecard.on_time_receipts} on time · {scorecard.late_receipts} late</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="field-label">Quality released</p>
                <p className="mt-1 text-lg font-semibold">{scorecard.quality_score}/100</p>
                <p className="text-[10px] text-muted-foreground">{scorecard.rejected_receipts} receipt(s) with rejects or hold</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="field-label">Price variance</p>
                <p className={`mt-1 text-lg font-semibold ${scorecard.price_variance > 0 ? "text-amber-700" : "text-marine-mid"}`}>
                  {scorecard.price_variance > 0 ? "+" : ""}{scorecard.price_variance.toFixed(1)}%
                </p>
                <p className="text-[10px] text-muted-foreground">Against best quoted unit cost</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="field-label">Lead time</p>
                <p className="mt-1 text-lg font-semibold">{scorecard.avg_lead_time_days} days</p>
                <p className="text-[10px] text-muted-foreground">Last PO {scorecard.last_po_at ? shortDate(scorecard.last_po_at) : "—"}</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border p-4">
                <p className="field-label">Order history</p>
                <dl className="mt-3 space-y-2 text-xs">
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Purchase orders</dt><dd className="font-medium">{scorecard.po_count}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Open orders</dt><dd className="font-medium">{scorecard.open_po_count}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Received orders</dt><dd className="font-medium">{scorecard.received_po_count}</dd></div>
                </dl>
              </div>
              <div className="rounded-lg border border-border p-4">
                <p className="field-label">Spend</p>
                <dl className="mt-3 space-y-2 text-xs">
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Goods value</dt><dd className="font-medium">{money(scorecard.spend_cents)}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Landed spend</dt><dd className="font-medium">{money(scorecard.landed_spend_cents)}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Landed uplift</dt><dd className="font-medium">{scorecard.spend_cents ? percent(((scorecard.landed_spend_cents - scorecard.spend_cents) / scorecard.spend_cents) * 100) : "—"}</dd></div>
                </dl>
              </div>
            </div>
            <div>
              <p className="field-label">Recent purchase orders</p>
              <div className="mt-2 space-y-2">
                {purchaseOrders.filter((po) => po.supplier_id === scorecard.code).slice(0, 5).map((po) => (
                  <button
                    key={po.id}
                    type="button"
                    onClick={() => openPoModal(po)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-left text-[11px] hover:bg-muted/40"
                  >
                    <span className="min-w-0">
                      <span className="block font-mono font-semibold">{po.po_number}</span>
                      <span className="block truncate text-muted-foreground">{po.product_name} · {po.ordered_cases} cases</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-semibold">{money(po.landed_cost_cents ?? po.total_cents)}</span>
                      <span className="block text-muted-foreground">{titleCase(po.status)}</span>
                    </span>
                  </button>
                ))}
                {purchaseOrders.filter((po) => po.supplier_id === scorecard.code).length === 0 && (
                  <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
                    No purchase orders for this supplier yet.
                  </p>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {activeRfq && (
        <Modal
          title={`${activeRfq.id} · quotation comparison`}
          subtitle={`${activeRfq.product_name} · ${activeRfq.quantity_cases} cases · needed by ${shortDate(activeRfq.needed_by)} · ${activeRfq.incoterm}`}
          onClose={() => setActiveRfqId(null)}
          wide
        >
          <div className="space-y-4 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(activeRfq.status)} dot>{titleCase(activeRfq.status)}</Badge>
                <span className="text-[11px] text-muted-foreground">{activeRfq.quotations.length} quotation(s) · destination {activeRfq.destination}</span>
              </div>
              {activeRfq.status !== "awarded" && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowQuoteForm((value) => !value)} data-testid="toggle-quote-form">
                  <Plus className="h-3.5 w-3.5" /> {showQuoteForm ? "Hide quote form" : "Add quotation"}
                </button>
              )}
            </div>

            {activeRfq.notes && (
              <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px] leading-5 text-muted-foreground">{activeRfq.notes}</p>
            )}

            <div className="table-shell">
              <table className="data-table min-w-0">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th className="text-right">Unit / case</th>
                    <th>Cost build-up</th>
                    <th className="text-right">Landed</th>
                    <th>Lead / valid</th>
                    <th>Rank / action</th>
                  </tr>
                </thead>
                <tbody>
                  {activeRfq.quotations.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                        No quotations yet. Add at least two to compare landed cost.
                      </td>
                    </tr>
                  )}
                  {activeRfq.quotations.map((quotation) => {
                    const isSelected = selectedQuoteId === quotation.id;
                    return (
                      <tr
                        key={quotation.id}
                        className={isSelected ? "bg-primary/5" : undefined}
                        data-testid={`quote-row-${quotation.id}`}
                      >
                        <td data-label="Supplier">
                          <p className="font-medium">{quotation.supplier_name}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <Badge tone={statusTone(quotation.supplier_status)}>{titleCase(quotation.supplier_status)}</Badge>
                            {quotation.status === "selected" && <Badge tone="ok">Selected</Badge>}
                            {!quotation.eligible && quotation.eligible_reason && (
                              <Badge tone="warning">{quotation.eligible_reason}</Badge>
                            )}
                          </div>
                        </td>
                        <td data-label="Unit / case" className="whitespace-nowrap text-right text-[11px]">{money(quotation.unit_cost_cents)}</td>
                        <td data-label="Cost build-up" className="text-[10px] leading-4 text-muted-foreground">
                          <span className="block">Goods {money(quotation.goods_cents)}</span>
                          <span className="block">Freight {money(quotation.freight_cents)} · Duty {money(quotation.duty_cents)}</span>
                          <span className="block">Other {money(quotation.other_cents)}</span>
                        </td>
                        <td data-label="Landed" className="whitespace-nowrap text-right text-[11px]">
                          <span className="block font-semibold">{money(quotation.landed_cost_cents)}</span>
                          <span className="block text-[10px] text-muted-foreground">{money(quotation.unit_landed_cost_cents)} / case</span>
                        </td>
                        <td data-label="Lead / valid" className="whitespace-nowrap text-[11px]">
                          <span className="block">{quotation.lead_time_days} days</span>
                          <span className="block text-[10px] text-muted-foreground">to {quotation.valid_until ? shortDate(quotation.valid_until) : "no expiry"}</span>
                        </td>
                        <td data-label="Rank / action">
                          <div className="flex flex-wrap items-center gap-1">
                            {quotation.rank ? (
                              <Badge tone={quotation.rank === 1 ? "ok" : "neutral"}>
                                {quotation.rank === 1 ? "Best" : `#${quotation.rank}`}
                              </Badge>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">—</span>
                            )}
                            {activeRfq.status !== "awarded" && quotation.eligible && (
                              <button
                                type="button"
                                className={`btn btn-sm ${isSelected ? "btn-primary" : "btn-secondary"}`}
                                onClick={() => setSelectedQuoteId(quotation.id)}
                                data-testid={`select-quote-${quotation.id}`}
                              >
                                {isSelected ? "Selected" : "Select"}
                              </button>
                            )}
                            {activeRfq.status !== "awarded" && (
                              <Can permission="suppliers:write" mode="hide">
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm text-red-600"
                                  title="Remove quotation"
                                  onClick={() => removeQuotation(quotation)}
                                  disabled={busy}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </Can>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {showQuoteForm && activeRfq.status !== "awarded" && (
              <form onSubmit={submitQuotation} className="rounded-xl border border-border bg-muted/20 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold">Record supplier quotation</p>
                  <span className="text-[10px] text-muted-foreground">All amounts in EUR</span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Supplier">
                    <select
                      className="input"
                      value={quoteForm.supplier_id}
                      onChange={(event) => {
                        const supplier = suppliers.find((row) => row.code === event.target.value);
                        setQuoteForm({
                          ...quoteForm,
                          supplier_id: event.target.value,
                          lead_time_days: String(supplier?.lead_time_days ?? quoteForm.lead_time_days)
                        });
                      }}
                      data-testid="quote-supplier"
                    >
                      {suppliers.map((supplier) => (
                        <option key={supplier.code} value={supplier.code}>
                          {supplier.name} · {titleCase(supplier.status)} · {supplier.grade}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Unit cost / case (€) *">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="input"
                      value={quoteForm.unit_cost}
                      onChange={(event) => setQuoteForm({ ...quoteForm, unit_cost: event.target.value })}
                      data-testid="quote-unit-cost"
                    />
                  </Field>
                  <Field label="Freight (€)">
                    <input type="number" min="0" step="0.01" className="input" value={quoteForm.freight} onChange={(event) => setQuoteForm({ ...quoteForm, freight: event.target.value })} data-testid="quote-freight" />
                  </Field>
                  <Field label="Duty (%)">
                    <input type="number" min="0" step="0.1" className="input" value={quoteForm.duty_pct} onChange={(event) => setQuoteForm({ ...quoteForm, duty_pct: event.target.value })} data-testid="quote-duty" />
                  </Field>
                  <Field label="Other (€)">
                    <input type="number" min="0" step="0.01" className="input" value={quoteForm.other} onChange={(event) => setQuoteForm({ ...quoteForm, other: event.target.value })} data-testid="quote-other" />
                  </Field>
                  <Field label="Lead time (days)">
                    <input type="number" min="1" className="input" value={quoteForm.lead_time_days} onChange={(event) => setQuoteForm({ ...quoteForm, lead_time_days: event.target.value })} />
                  </Field>
                  <Field label="Valid until">
                    <input type="date" className="input" value={quoteForm.valid_until} onChange={(event) => setQuoteForm({ ...quoteForm, valid_until: event.target.value })} />
                  </Field>
                  <Field label="Incoterm">
                    <select className="input" value={quoteForm.incoterm} onChange={(event) => setQuoteForm({ ...quoteForm, incoterm: event.target.value })}>
                      {["DAP", "DDP", "FCA", "FOB", "EXW", "CIF"].map((term) => <option key={term} value={term}>{term}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Field label="Notes">
                      <input className="input" value={quoteForm.notes} onChange={(event) => setQuoteForm({ ...quoteForm, notes: event.target.value })} placeholder="Payment terms, packaging, certificates" />
                    </Field>
                  </div>
                  <div className="rounded-lg border border-border bg-background px-3 py-2 text-right">
                    <p className="text-[10px] text-muted-foreground">Preview landed</p>
                    <p className="text-sm font-semibold">{money(quotePreview?.landed_cost_cents ?? 0)}</p>
                    <p className="text-[10px] text-muted-foreground">{money(quotePreview?.unit_landed_cost_cents ?? 0)} / case</p>
                  </div>
                  <Can permission="suppliers:write" mode="disable">
                    <button type="submit" className="btn btn-primary" disabled={busy} data-testid="submit-quotation">
                      {busy ? "Saving..." : "Add quotation"}
                    </button>
                  </Can>
                </div>
              </form>
            )}

            {activeRfq.status !== "awarded" && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold">Award quotation and raise approved PO</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {selectedQuoteId
                        ? "The selected quotation becomes an approved purchase order with the landed cost locked in."
                        : "Select an eligible quotation above to award."}
                    </p>
                  </div>
                  <Can permission="suppliers:write" mode="disable">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || !selectedQuoteId}
                      onClick={awardQuotation}
                      data-testid="award-rfq"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Award & raise PO
                    </button>
                  </Can>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Supplier ASN (optional)">
                    <input className="input" value={awardForm.asn_reference} onChange={(event) => setAwardForm({ ...awardForm, asn_reference: event.target.value })} placeholder="ASN-2026-1042" data-testid="award-asn" />
                  </Field>
                  <Field label="Carrier">
                    <input className="input" value={awardForm.asn_carrier} onChange={(event) => setAwardForm({ ...awardForm, asn_carrier: event.target.value })} placeholder="FrigoTrans" />
                  </Field>
                  <Field label="ASN ETA">
                    <input type="date" className="input" value={awardForm.asn_eta} onChange={(event) => setAwardForm({ ...awardForm, asn_eta: event.target.value })} />
                  </Field>
                  <Field label="ASN notes">
                    <input className="input" value={awardForm.asn_notes} onChange={(event) => setAwardForm({ ...awardForm, asn_notes: event.target.value })} placeholder="Dock slot, pallets" />
                  </Field>
                </div>
              </div>
            )}

            {activeRfq.status === "awarded" && (
              <div className="rounded-xl border border-marine-ocean/60 bg-marine-ocean/20 p-4">
                <p className="text-xs font-semibold text-marine-navy">RFQ awarded</p>
                <p className="mt-1 text-[11px] leading-5 text-marine-mid/90">
                  {activeRfq.quotations.find((quote) => quote.status === "selected")?.supplier_name ?? "A supplier"} won on landed cost.
                  {" "}The purchase order is approved and available in the inbound pipeline.
                </p>
                {purchaseOrders.find((po) => po.rfq_id === activeRfq.id) && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm mt-3"
                    onClick={() => {
                      const po = purchaseOrders.find((row) => row.rfq_id === activeRfq.id);
                      if (po) openPoModal(po);
                    }}
                  >
                    Open {purchaseOrders.find((po) => po.rfq_id === activeRfq.id)?.po_number}
                  </button>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {activePo && (
        <Modal
          title={`${activePo.po_number} · purchase order`}
          subtitle={`${activePo.supplier_name} · ${activePo.product_name} · ${activePo.ordered_cases} cases`}
          onClose={() => setActivePoNumber(null)}
          wide
        >
          <div className="space-y-4 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={statusTone(activePo.status)} dot>{titleCase(activePo.status)}</Badge>
              <Badge tone={statusTone(activePo.approval_status)}>{titleCase(activePo.approval_status)}</Badge>
              {activePo.rfq_id && <Badge tone="info">RFQ {activePo.rfq_id}</Badge>}
              {activePo.asn_reference ? <Badge tone="ok">ASN captured</Badge> : <Badge tone="warning">ASN not provided</Badge>}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-border p-3">
                <p className="field-label">Goods value</p>
                <p className="mt-1 text-lg font-semibold">{money(activePo.total_cents)}</p>
                <p className="text-[10px] text-muted-foreground">{money(activePo.unit_cost_cents)} / case</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="field-label">Landed cost</p>
                <p className="mt-1 text-lg font-semibold">{money(activePo.landed_cost_cents ?? activePo.total_cents)}</p>
                <p className="text-[10px] text-muted-foreground">{money(activePo.unit_landed_cost_cents ?? activePo.unit_cost_cents)} / case</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="field-label">Expected</p>
                <p className="mt-1 text-lg font-semibold">{shortDate(activePo.expected_date)}</p>
                <p className="text-[10px] text-muted-foreground">{activePo.incoterm ?? "DAP"} · {activePo.received_cases} received</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="field-label">Approval</p>
                <p className="mt-1 text-sm font-semibold">{activePo.approved_by ?? "Pending approval"}</p>
                <p className="text-[10px] text-muted-foreground">{activePo.approved_at ? dateTime(activePo.approved_at) : "Not approved"}</p>
              </div>
            </div>

            <div className="rounded-lg border border-border p-4">
              <p className="field-label">Landed cost breakdown</p>
              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-5">
                <div><dt className="text-muted-foreground">Goods</dt><dd className="font-medium">{money(activePo.total_cents)}</dd></div>
                <div><dt className="text-muted-foreground">Freight</dt><dd className="font-medium">{money(activePo.freight_cents)}</dd></div>
                <div><dt className="text-muted-foreground">Duty</dt><dd className="font-medium">{money(activePo.duty_cents)}</dd></div>
                <div><dt className="text-muted-foreground">Other</dt><dd className="font-medium">{money(activePo.other_cents)}</dd></div>
                <div><dt className="text-muted-foreground">Landed total</dt><dd className="font-semibold">{money(activePo.landed_cost_cents ?? activePo.total_cents)}</dd></div>
              </dl>
            </div>

            {activePo.approval_status !== "approved" && activePo.status !== "received" && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-xs font-semibold text-amber-900">Approval required</p>
                <p className="mt-0.5 text-[11px] text-amber-800">
                  Goods cannot be received until this purchase order is approved. Supplier ASN can be attached now if already provided.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="ASN reference">
                    <input className="input" value={poActionForm.asn_reference} onChange={(event) => setPoActionForm({ ...poActionForm, asn_reference: event.target.value })} placeholder="Optional" />
                  </Field>
                  <Field label="Carrier">
                    <input className="input" value={poActionForm.asn_carrier} onChange={(event) => setPoActionForm({ ...poActionForm, asn_carrier: event.target.value })} />
                  </Field>
                  <Field label="ASN ETA">
                    <input type="date" className="input" value={poActionForm.asn_eta} onChange={(event) => setPoActionForm({ ...poActionForm, asn_eta: event.target.value })} />
                  </Field>
                  <Field label="ASN notes">
                    <input className="input" value={poActionForm.asn_notes} onChange={(event) => setPoActionForm({ ...poActionForm, asn_notes: event.target.value })} />
                  </Field>
                </div>
                <Can permission="suppliers:write" mode="disable">
                  <button type="button" className="btn btn-primary mt-3" onClick={approvePo} disabled={busy} data-testid="approve-po">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Approve purchase order
                  </button>
                </Can>
              </div>
            )}

            {activePo.status !== "received" && (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-border p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold">Supplier ASN</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {activePo.asn_reference
                          ? `${activePo.asn_reference}${activePo.asn_carrier ? ` · ${activePo.asn_carrier}` : ""}`
                          : "No ASN provided by the supplier yet."}
                      </p>
                    </div>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAsnForm((value) => !value)}>
                      {activePo.asn_reference ? "Update" : "Capture ASN"}
                    </button>
                  </div>
                  {activePo.asn_reference && (
                    <dl className="mt-3 space-y-2 text-[11px]">
                      <div className="flex justify-between gap-2"><dt className="text-muted-foreground">ETA</dt><dd className="font-medium">{activePo.asn_eta ? shortDate(activePo.asn_eta) : "—"}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Captured</dt><dd className="font-medium">{activePo.asn_captured_at ? dateTime(activePo.asn_captured_at) : "—"}</dd></div>
                      {activePo.asn_notes && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Notes</dt><dd className="text-right font-medium">{activePo.asn_notes}</dd></div>}
                    </dl>
                  )}
                  {showAsnForm && (
                    <form onSubmit={saveAsn} className="mt-3 space-y-3 border-t border-border pt-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="ASN reference *">
                          <input className="input" value={poActionForm.asn_reference} onChange={(event) => setPoActionForm({ ...poActionForm, asn_reference: event.target.value })} placeholder="ASN-2026-1042" data-testid="asn-reference" />
                        </Field>
                        <Field label="Carrier">
                          <input className="input" value={poActionForm.asn_carrier} onChange={(event) => setPoActionForm({ ...poActionForm, asn_carrier: event.target.value })} placeholder="FrigoTrans" />
                        </Field>
                        <Field label="ETA">
                          <input type="date" className="input" value={poActionForm.asn_eta} onChange={(event) => setPoActionForm({ ...poActionForm, asn_eta: event.target.value })} />
                        </Field>
                        <Field label="Notes">
                          <input className="input" value={poActionForm.asn_notes} onChange={(event) => setPoActionForm({ ...poActionForm, asn_notes: event.target.value })} placeholder="Pallet count, dock slot" />
                        </Field>
                      </div>
                      <Can permission="suppliers:write" mode="disable">
                        <button type="submit" className="btn btn-primary btn-sm" disabled={busy} data-testid="submit-asn">Save ASN</button>
                      </Can>
                    </form>
                  )}
                </div>

                <div className="rounded-xl border border-border p-4">
                  <p className="text-xs font-semibold">Goods receipt</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {activePo.approval_status === "approved"
                      ? "Record accepted cases, arrival temperature and expiry for FEFO."
                      : "Approve the PO before receiving goods."}
                  </p>
                  {activePo.approval_status === "approved" && (
                    <form onSubmit={receivePo} className="mt-3 space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Accepted cases">
                          <input type="number" min="1" className="input" value={poActionForm.accepted_cases} onChange={(event) => setPoActionForm({ ...poActionForm, accepted_cases: event.target.value })} data-testid="receive-cases" />
                        </Field>
                        <Field label="Temperature (°C)">
                          <input type="number" step="0.1" className="input" value={poActionForm.temp_c} onChange={(event) => setPoActionForm({ ...poActionForm, temp_c: event.target.value })} data-testid="receive-temp" />
                        </Field>
                      </div>
                      <Field label="Expiry date (optional)">
                        <input type="date" className="input" value={poActionForm.expiry_date} onChange={(event) => setPoActionForm({ ...poActionForm, expiry_date: event.target.value })} />
                      </Field>
                      <Can permission="procurement:receive" mode="disable">
                        <button type="submit" className="btn btn-secondary btn-sm" disabled={busy} data-testid="receive-po">
                          <PackageCheck className="h-3.5 w-3.5" /> Receive into cold hub
                        </button>
                      </Can>
                    </form>
                  )}
                </div>
              </div>
            )}

            {activePo.status === "received" && (
              <div className="rounded-xl border border-marine-ocean/60 bg-marine-ocean/20 p-4 text-[11px] leading-5 text-marine-mid/90">
                This purchase order has been received. {activePo.received_cases} of {activePo.ordered_cases} cases were accepted.
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
