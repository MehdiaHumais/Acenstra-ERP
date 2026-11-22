"use client";

import { useState, useEffect, useTransition } from "react";
import {
  Banknote,
  ReceiptText,
  FileCheck2,
  Percent,
  Plus,
  RefreshCw,
  Download,
  Send,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Layers,
  ArrowRight,
  ShieldCheck,
  Search,
  Scale,
  CreditCard,
  Building,
  Upload,
  Clock,
  ExternalLink,
} from "lucide-react";
import { Badge, statusTone } from "@/components/ui";
import { Can } from "@/components/access-gate";
import type {
  DetailedInvoice,
  PaymentRecord,
  BankStatement,
  LandedCostAllocation,
  DeliveredMarginReport,
  InvoiceLine,
} from "@/lib/types";

export function FinanceWorkbench() {
  const [invoices, setInvoices] = useState<DetailedInvoice[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [statements, setStatements] = useState<BankStatement[]>([]);
  const [landedCosts, setLandedCosts] = useState<LandedCostAllocation[]>([]);
  const [marginReports, setMarginReports] = useState<DeliveredMarginReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "invoices" | "sdi" | "payments" | "reconciliation" | "margins">("overview");
  const [marginDimension, setMarginDimension] = useState<"product" | "customer" | "order" | "delivery">("product");

  // Selection states
  const [selectedInvoice, setSelectedInvoice] = useState<DetailedInvoice | null>(null);
  const [selectedStatement, setSelectedStatement] = useState<BankStatement | null>(null);

  // Modals
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [creditNoteModalOpen, setCreditNoteModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [statementModalOpen, setStatementModalOpen] = useState(false);
  const [landedCostModalOpen, setLandedCostModalOpen] = useState(false);
  const [xmlModalOpen, setXmlModalOpen] = useState(false);

  // Form states
  const [genDeliveryId, setGenDeliveryId] = useState("");
  const [genPaymentTerms, setGenPaymentTerms] = useState("Net 30");
  const [genNotes, setGenNotes] = useState("");

  const [cnReason, setCnReason] = useState("Commercial goodwill discount / minor package scuff");
  const [cnAmount, setCnAmount] = useState("");

  const [payCustomerId, setPayCustomerId] = useState("CUST-B2B-01");
  const [payAmount, setPayAmount] = useState("4842.00");
  const [payMethod, setPayMethod] = useState("bank_transfer");
  const [payReference, setPayReference] = useState("");

  const [csvContent, setCsvContent] = useState(
`Data,Importo,Descrizione,Beneficiario,Riferimento
2026-03-01,6290.00,BONIFICO SEPA INV-2026-8410 OSTERIA FRANCESCANA,Osteria Francescana Group,TRX-BNK-99101
2026-03-02,1924.00,BONIFICO SALDO FATTURA SO-2026-9847,Trattoria Trippa Milano,TRX-BNK-99102
2026-03-03,4842.00,BONIFICO RISTORANTE CRACCO INV-2026-8412,Ristorante Cracco Galleria,TRX-BNK-99103
2026-03-04,1500.00,BONIFICO ACCONTO DA CLIENTE CATERING,Cliente Non Identificato,TRX-BNK-99104`
  );
  const [stmtFilename, setStmtFilename] = useState("banca_intesa_estratto_conto_marzo.csv");

  const [lcFreight, setLcFreight] = useState("450.00");
  const [lcDuty, setLcDuty] = useState("180.00");
  const [lcInsurance, setLcInsurance] = useState("95.00");
  const [lcHandling, setLcHandling] = useState("125.00");
  const [lcMethod, setLcMethod] = useState<"weight" | "value" | "quantity">("weight");

  const [feedback, setFeedback] = useState<{ message: string; isError?: boolean } | null>(null);

  const notify = (message: string, isError = false) => {
    setFeedback({ message, isError });
    window.setTimeout(() => setFeedback(null), 4500);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [invRes, payRes, stmtRes, lcRes, marginRes] = await Promise.all([
        fetch("/api/v1/finance/invoices"),
        fetch("/api/v1/finance/payments"),
        fetch("/api/v1/finance/reconciliation/statements"),
        fetch("/api/v1/finance/landed-cost"),
        fetch(`/api/v1/finance/margins?dimension=${marginDimension}`),
      ]);

      const [invJson, payJson, stmtJson, lcJson, marginJson] = await Promise.all([
        invRes.json(),
        payRes.json(),
        stmtRes.json(),
        lcRes.json(),
        marginRes.json(),
      ]);

      const invList = invJson.invoices || [];
      setInvoices(invList);
      if (invList.length > 0 && !selectedInvoice) {
        setSelectedInvoice(invList[0]);
      }

      setPayments(payJson.payments || []);
      const stmtList = stmtJson.statements || [];
      setStatements(stmtList);
      if (stmtList.length > 0 && !selectedStatement) {
        setSelectedStatement(stmtList[0]);
      }

      setLandedCosts(lcJson.allocations || []);
      setMarginReports(marginJson.report || []);
    } catch (err: any) {
      notify(err.message, true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [marginDimension]);

  // Actions
  const handleGenerateInvoice = async () => {
    if (!genDeliveryId.trim()) {
      notify("Please provide a Delivery Reference or ID.", true);
      return;
    }
    try {
      const res = await fetch("/api/v1/finance/invoices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `gen-inv-${genDeliveryId}-${Date.now()}`,
        },
        body: JSON.stringify({
          delivery_id: genDeliveryId.trim(),
          payment_terms: genPaymentTerms,
          notes: genNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to generate invoice");
      notify(`Invoice ${data.invoice.invoice_number} created successfully!`);
      setGenerateModalOpen(false);
      setGenDeliveryId("");
      loadData();
    } catch (err: any) {
      notify(err.message, true);
    }
  };

  const handleCreateCreditNote = async () => {
    if (!selectedInvoice) return;
    try {
      const amountCents = cnAmount ? Math.round(parseFloat(cnAmount) * 100) : undefined;
      const res = await fetch(`/api/v1/finance/invoices/${selectedInvoice.id}/credit-note`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `cn-${selectedInvoice.id}-${Date.now()}`,
        },
        body: JSON.stringify({
          reason: cnReason,
          amount_cents: amountCents,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to create credit note");
      notify(`Credit note ${data.credit_note.invoice_number} created!`);
      setCreditNoteModalOpen(false);
      loadData();
    } catch (err: any) {
      notify(err.message, true);
    }
  };

  const handleGenerateXml = async (inv: DetailedInvoice) => {
    try {
      const res = await fetch(`/api/v1/finance/sdi/${inv.id}/generate-xml`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `xml-${inv.id}-${Date.now()}`,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "XML generation failed");
      notify(data.message);
      loadData();
    } catch (err: any) {
      notify(err.message, true);
    }
  };

  const handleTransmitSdi = async (inv: DetailedInvoice) => {
    try {
      const res = await fetch(`/api/v1/finance/sdi/${inv.id}/transmit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `tx-${inv.id}-${Date.now()}`,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "SDI transmission failed");
      notify(data.message);
      loadData();
    } catch (err: any) {
      notify(err.message, true);
    }
  };

  const handleRecordPayment = async () => {
    try {
      const amountCents = Math.round(parseFloat(payAmount) * 100);
      const res = await fetch("/api/v1/finance/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `pay-${payCustomerId}-${Date.now()}`,
        },
        body: JSON.stringify({
          customer_id: payCustomerId,
          amount_cents: amountCents,
          payment_method: payMethod,
          reference: payReference || `SEPA-TRX-${Date.now().toString().slice(-6)}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Payment recording failed");
      notify(data.message);
      setPaymentModalOpen(false);
      loadData();
    } catch (err: any) {
      notify(err.message, true);
    }
  };

  const handleImportStatement = async () => {
    try {
      const res = await fetch("/api/v1/finance/reconciliation/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `stmt-${Date.now()}`,
        },
        body: JSON.stringify({
          filename: stmtFilename,
          csv_content: csvContent,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Statement import failed");
      notify(data.message);
      setStatementModalOpen(false);
      loadData();
    } catch (err: any) {
      notify(err.message, true);
    }
  };

  const handleManualReconcile = async (lineId: string, invoiceId?: string, action: "match" | "ignore" = "match") => {
    try {
      const res = await fetch("/api/v1/finance/reconciliation/match", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `recon-${lineId}-${Date.now()}`,
        },
        body: JSON.stringify({
          statement_line_id: lineId,
          invoice_id: invoiceId,
          action,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Manual reconciliation failed");
      notify(data.message);
      loadData();
    } catch (err: any) {
      notify(err.message, true);
    }
  };

  const handleAllocateLandedCost = async () => {
    try {
      const res = await fetch("/api/v1/finance/landed-cost", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `lc-${Date.now()}`,
        },
        body: JSON.stringify({
          po_id: "PO-2026-1001",
          allocation_method: lcMethod,
          freight_cents: Math.round(parseFloat(lcFreight) * 100),
          customs_duty_cents: Math.round(parseFloat(lcDuty) * 100),
          insurance_cents: Math.round(parseFloat(lcInsurance) * 100),
          handling_cents: Math.round(parseFloat(lcHandling) * 100),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Landed cost allocation failed");
      notify(data.message);
      setLandedCostModalOpen(false);
      loadData();
    } catch (err: any) {
      notify(err.message, true);
    }
  };

  // Calculations
  const totalReceivables = invoices.reduce((acc, i) => acc + i.amount_cents, 0);
  const totalCollected = invoices.reduce((acc, i) => acc + i.paid_cents, 0);
  const totalOutstanding = totalReceivables - totalCollected;
  const overdueCount = invoices.filter((i) => i.status === "overdue").length;
  const sdiAcceptedCount = invoices.filter((i) => i.sdi_status === "accepted").length;

  return (
    <div className="space-y-6">
      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`flex items-center gap-2 rounded-xl p-3.5 text-xs font-semibold ${
            feedback.isError
              ? "border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
              : "border border-marine-ocean/60 bg-marine-steel/10 text-marine-mid dark:text-marine-mid"
          }`}
        >
          {feedback.isError ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
          {feedback.message}
        </div>
      )}

      {/* Control Tower Header */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-bold text-primary uppercase">
              Module 10
            </span>
            <span className="text-xs font-medium text-muted-foreground">Accounting, E-Invoicing & Reconciliation</span>
          </div>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-foreground">Finance Control Center</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Customer invoicing, FatturaPA XML SDI compliance, multi-invoice payment allocation, bank reconciliation, landed cost & delivered margin.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => loadData()}
            className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </button>
          <button
            onClick={() => setGenerateModalOpen(true)}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Generate Invoice
          </button>
          <button
            onClick={() => setPaymentModalOpen(true)}
            className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
          >
            <CreditCard className="mr-1.5 h-3.5 w-3.5" /> Record Payment
          </button>
          <button
            onClick={() => setStatementModalOpen(true)}
            className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" /> Import Bank CSV
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-semibold uppercase tracking-wider">Total Invoiced</span>
            <Banknote className="h-4 w-4 text-primary" />
          </div>
          <p className="mt-2 text-2xl font-bold">€{(totalReceivables / 100).toLocaleString("it-IT", { minimumFractionDigits: 2 })}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{invoices.length} total customer invoices</p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-semibold uppercase tracking-wider">Outstanding</span>
            <Clock className="h-4 w-4 text-amber-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-amber-600 dark:text-amber-400">
            €{(totalOutstanding / 100).toLocaleString("it-IT", { minimumFractionDigits: 2 })}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">{overdueCount} overdue receivables</p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-semibold uppercase tracking-wider">SDI Transmission</span>
            <FileCheck2 className="h-4 w-4 text-marine-mid" />
          </div>
          <p className="mt-2 text-2xl font-bold text-marine-mid dark:text-marine-mid">
            {sdiAcceptedCount} / {invoices.length}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">FatturaPA B2B e-invoices accepted</p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-semibold uppercase tracking-wider">Avg Delivered Margin</span>
            <Percent className="h-4 w-4 text-primary" />
          </div>
          <p className="mt-2 text-2xl font-bold">28.4%</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Based on verified landed + route costs</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border text-sm font-medium">
        <button
          onClick={() => setActiveTab("overview")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "overview"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Layers className="h-4 w-4" /> Overview & Ageing
        </button>
        <button
          onClick={() => setActiveTab("invoices")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "invoices"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <ReceiptText className="h-4 w-4" /> Invoices & Credit Notes ({invoices.length})
        </button>
        <button
          onClick={() => setActiveTab("sdi")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "sdi"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileCheck2 className="h-4 w-4" /> Italy E-Invoicing (FatturaPA / SDI)
        </button>
        <button
          onClick={() => setActiveTab("payments")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "payments"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <CreditCard className="h-4 w-4" /> Payments & Allocations ({payments.length})
        </button>
        <button
          onClick={() => setActiveTab("reconciliation")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "reconciliation"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Building className="h-4 w-4" /> Bank Statement Reconciliation
        </button>
        <button
          onClick={() => setActiveTab("margins")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 transition-colors ${
            activeTab === "margins"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Scale className="h-4 w-4" /> Landed Cost & Delivered Margins
        </button>
      </div>

      {/* TAB 1: OVERVIEW & AGEING */}
      {activeTab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-4 rounded-xl border border-border bg-surface p-5 lg:col-span-2">
            <h3 className="text-base font-bold">Recent Customer Invoices</h3>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50 text-muted-foreground uppercase text-[10px] font-semibold">
                  <tr>
                    <th className="px-3 py-2.5">Invoice #</th>
                    <th className="px-3 py-2.5">Customer</th>
                    <th className="px-3 py-2.5">Order</th>
                    <th className="px-3 py-2.5">Total Amount</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">SDI Status</th>
                    <th className="px-3 py-2.5">Due Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invoices.slice(0, 6).map((inv) => (
                    <tr
                      key={inv.id}
                      onClick={() => {
                        setSelectedInvoice(inv);
                        setActiveTab("invoices");
                      }}
                      className="cursor-pointer hover:bg-muted/30"
                    >
                      <td className="px-3 py-2 font-mono font-bold text-primary">{inv.invoice_number}</td>
                      <td className="px-3 py-2 font-medium">{inv.customer}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">{inv.order_number}</td>
                      <td className="px-3 py-2 font-semibold">
                        €{(inv.amount_cents / 100).toFixed(2)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={statusTone(inv.status)} dot>
                          {inv.status.replace(/_/g, " ")}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={statusTone(inv.sdi_status)}>
                          {inv.sdi_status.replace(/_/g, " ")}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{inv.due_date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-4 rounded-xl border border-border bg-surface p-5">
            <h3 className="text-base font-bold">Receivables Ageing Schedule</h3>
            <div className="space-y-3 text-xs">
              <div>
                <div className="flex justify-between font-medium">
                  <span>Current (0 - 30 Days)</span>
                  <span className="font-bold">€{(totalCollected / 100).toFixed(2)}</span>
                </div>
                <div className="mt-1 h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-marine-steel rounded-full" style={{ width: "65%" }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between font-medium">
                  <span>31 - 60 Days Overdue</span>
                  <span className="font-bold text-amber-600">€4,120.00</span>
                </div>
                <div className="mt-1 h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-amber-500 rounded-full" style={{ width: "20%" }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between font-medium">
                  <span>60+ Days Overdue</span>
                  <span className="font-bold text-red-600">€8,950.00</span>
                </div>
                <div className="mt-1 h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-red-500 rounded-full" style={{ width: "15%" }} />
                </div>
              </div>

              <div className="border-t border-border pt-3">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Trade Payables (AP):</span>
                  <span className="font-semibold">€24,800.00</span>
                </div>
                <div className="mt-1 flex justify-between text-xs">
                  <span className="text-muted-foreground">DSO (Days Sales Outstanding):</span>
                  <span className="font-semibold text-primary">28 Days</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: INVOICES & DETAIL */}
      {activeTab === "invoices" && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Invoice List */}
          <div className="space-y-3 lg:col-span-1">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Invoices & Credit Notes
              </h3>
              <Badge tone="info">{invoices.length} documents</Badge>
            </div>

            <div className="space-y-2.5 max-h-[700px] overflow-y-auto">
              {invoices.map((inv) => (
                <div
                  key={inv.id}
                  onClick={() => setSelectedInvoice(inv)}
                  className={`cursor-pointer rounded-xl border p-3.5 transition-all ${
                    selectedInvoice?.id === inv.id
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border/80 bg-surface hover:border-border"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-primary">
                      {inv.invoice_number}
                    </span>
                    <Badge tone={statusTone(inv.status)} dot>
                      {inv.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <h4 className="mt-1 text-xs font-bold text-foreground">{inv.customer}</h4>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Order: {inv.order_number}</span>
                    <span className="font-bold text-foreground">
                      €{(inv.amount_cents / 100).toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground border-t border-border/40 pt-1.5">
                    <span>Due: {inv.due_date}</span>
                    <Badge tone={statusTone(inv.sdi_status)}>SDI: {inv.sdi_status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Invoice Details */}
          <div className="lg:col-span-2">
            {selectedInvoice ? (
              <div className="rounded-xl border border-border bg-surface p-5 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-bold">{selectedInvoice.invoice_number}</h3>
                      <Badge tone={statusTone(selectedInvoice.status)} dot>
                        {selectedInvoice.status.replace(/_/g, " ")}
                      </Badge>
                      {selectedInvoice.is_credit_note && (
                        <Badge tone="warning">TD04 Credit Note</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Customer: {selectedInvoice.customer} • P.IVA: {selectedInvoice.customer_piva || "08923410961"}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Can permission="finance:sdi" mode="disable">
                      <button
                        onClick={() => handleGenerateXml(selectedInvoice)}
                        className="inline-flex items-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
                      >
                        <FileText className="mr-1.5 h-3.5 w-3.5" /> Generate FatturaPA XML
                      </button>
                    </Can>
                    <Can permission="finance:sdi" mode="disable">
                      <button
                        onClick={() => handleTransmitSdi(selectedInvoice)}
                        className="inline-flex items-center rounded-lg bg-marine-steel px-3 py-1.5 text-xs font-semibold text-white hover:bg-marine-steel"
                      >
                        <Send className="mr-1.5 h-3.5 w-3.5" /> Transmit to SDI
                      </button>
                    </Can>
                    <button
                      onClick={() => setCreditNoteModalOpen(true)}
                      className="inline-flex items-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
                    >
                      Create Credit Note
                    </button>
                  </div>
                </div>

                {/* Fiscal & Document Meta */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">Subtotal</span>
                    <p className="font-bold text-foreground">€{(selectedInvoice.subtotal_cents / 100).toFixed(2)}</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">VAT (IVA 10%)</span>
                    <p className="font-bold text-foreground">€{(selectedInvoice.tax_cents / 100).toFixed(2)}</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">Total Amount</span>
                    <p className="font-bold text-foreground text-sm">€{(selectedInvoice.amount_cents / 100).toFixed(2)}</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
                    <span className="text-[10px] text-muted-foreground uppercase font-semibold">Paid Amount</span>
                    <p className="font-bold text-marine-mid">€{(selectedInvoice.paid_cents / 100).toFixed(2)}</p>
                  </div>
                </div>

                {/* Lines Table */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Invoiced Items (Catch-Weights & Taxes)
                  </h4>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted/50 text-muted-foreground uppercase text-[10px] font-semibold">
                        <tr>
                          <th className="px-3 py-2">Item</th>
                          <th className="px-3 py-2">SKU</th>
                          <th className="px-3 py-2">Cases</th>
                          <th className="px-3 py-2">Catch Wt (kg)</th>
                          <th className="px-3 py-2">Unit Price</th>
                          <th className="px-3 py-2">VAT %</th>
                          <th className="px-3 py-2 text-right">Line Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {selectedInvoice.lines && selectedInvoice.lines.length > 0 ? (
                          selectedInvoice.lines.map((l) => (
                            <tr key={l.id}>
                              <td className="px-3 py-2 font-medium">{l.product_name}</td>
                              <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{l.sku}</td>
                              <td className="px-3 py-2 font-semibold">{l.cases_delivered}</td>
                              <td className="px-3 py-2">{l.catch_weight_kg > 0 ? `${l.catch_weight_kg.toFixed(1)} kg` : "—"}</td>
                              <td className="px-3 py-2 font-mono">€{(l.unit_price_cents / 100).toFixed(2)}</td>
                              <td className="px-3 py-2">{l.tax_rate_pct}%</td>
                              <td className="px-3 py-2 font-bold font-mono text-right">€{(l.total_cents / 100).toFixed(2)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={7} className="p-4 text-center text-muted-foreground">
                              No line items available.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* SDI Status Card */}
                <div className="rounded-xl border border-border/70 bg-muted/10 p-4 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Italian E-Invoicing SDI Status</span>
                    <Badge tone={statusTone(selectedInvoice.sdi_status)}>{selectedInvoice.sdi_status}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                    <div>SDI Identifier: <span className="font-mono font-semibold text-foreground">{selectedInvoice.sdi_reference || "Pending"}</span></div>
                    <div>Recipient Code: <span className="font-mono font-semibold text-foreground">{selectedInvoice.customer_sdi_code || "SUBM70N"}</span></div>
                    <div>Version: <span className="font-semibold text-foreground">v{selectedInvoice.sdi_version}</span></div>
                    <div>Format: <span className="font-semibold text-foreground">FatturaPA v1.2.2 (FPR12)</span></div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-center text-xs text-muted-foreground">Select an invoice to view details.</p>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: ITALIAN E-INVOICING (FATTURAPA / SDI) */}
      {activeTab === "sdi" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold">Italy SDI E-Invoicing Transmission Engine</h3>
                <p className="text-xs text-muted-foreground">
                  FatturaPA v1.2.2 structured XML generation, Agenzia delle Entrate technical validation, and SDI Intermediary gateway handoff.
                </p>
              </div>
              <Badge tone="ok">Intermediary Provider: Aruba SDI B2B Gateway (Configurable)</Badge>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50 text-muted-foreground uppercase text-[10px] font-semibold">
                  <tr>
                    <th className="px-3 py-2.5">Invoice #</th>
                    <th className="px-3 py-2.5">Customer & P.IVA</th>
                    <th className="px-3 py-2.5">SDI Code</th>
                    <th className="px-3 py-2.5">Amount</th>
                    <th className="px-3 py-2.5">SDI Status</th>
                    <th className="px-3 py-2.5">SDI Reference</th>
                    <th className="px-3 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="px-3 py-2 font-mono font-bold text-primary">{inv.invoice_number}</td>
                      <td className="px-3 py-2">
                        <div className="font-semibold">{inv.customer}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">P.IVA: {inv.customer_piva || "08923410961"}</div>
                      </td>
                      <td className="px-3 py-2 font-mono">{inv.customer_sdi_code || "SUBM70N"}</td>
                      <td className="px-3 py-2 font-mono font-semibold">€{(inv.amount_cents / 100).toFixed(2)}</td>
                      <td className="px-3 py-2">
                        <Badge tone={statusTone(inv.sdi_status)} dot>
                          {inv.sdi_status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 font-mono text-muted-foreground text-[11px]">{inv.sdi_reference || "Not Assigned"}</td>
                      <td className="px-3 py-2 text-right space-x-2">
                        <Can permission="finance:sdi" mode="disable">
                          <button
                            onClick={() => {
                              setSelectedInvoice(inv);
                              handleGenerateXml(inv);
                            }}
                            className="rounded border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted"
                          >
                            Verify XML
                          </button>
                        </Can>
                        <Can permission="finance:sdi" mode="disable">
                          <button
                            onClick={() => handleTransmitSdi(inv)}
                            className="rounded bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                          >
                            Transmit
                          </button>
                        </Can>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: PAYMENTS & ALLOCATIONS */}
      {activeTab === "payments" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Customer Payments & Multi-Invoice Allocations</h3>
            <button
              onClick={() => setPaymentModalOpen(true)}
              className="inline-flex items-center rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Record Payment
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/50 text-muted-foreground uppercase text-[10px] font-semibold">
                <tr>
                  <th className="px-3 py-2.5">Payment ID</th>
                  <th className="px-3 py-2.5">Reference</th>
                  <th className="px-3 py-2.5">Method</th>
                  <th className="px-3 py-2.5">Amount</th>
                  <th className="px-3 py-2.5">Unallocated</th>
                  <th className="px-3 py-2.5">Allocations</th>
                  <th className="px-3 py-2.5">Recorded By</th>
                  <th className="px-3 py-2.5">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2 font-mono font-bold text-primary">{p.id}</td>
                    <td className="px-3 py-2 font-mono">{p.reference}</td>
                    <td className="px-3 py-2 capitalize">{p.payment_method?.replace(/_/g, " ") || "Bank Transfer"}</td>
                    <td className="px-3 py-2 font-bold font-mono">€{(p.amount_cents / 100).toFixed(2)}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">€{(p.unallocated_cents / 100).toFixed(2)}</td>
                    <td className="px-3 py-2">
                      {p.allocations && p.allocations.length > 0 ? (
                        p.allocations.map((a) => (
                          <span key={a.id} className="inline-block rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-mono mr-1">
                            {a.invoice_number || a.invoice_id}: €{(a.allocated_cents / 100).toFixed(2)}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted-foreground">Direct invoice allocation</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{p.recorded_by}</td>
                    <td className="px-3 py-2 text-muted-foreground">{p.paid_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 5: BANK RECONCILIATION */}
      {activeTab === "reconciliation" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold">Bank Statement Automated Reconciliation</h3>
              <p className="text-xs text-muted-foreground">
                Import CSV bank statements with SHA-256 deduplication and 3-tier matching engine.
              </p>
            </div>
            <button
              onClick={() => setStatementModalOpen(true)}
              className="inline-flex items-center rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Upload className="mr-1.5 h-3.5 w-3.5" /> Import Bank Statement
            </button>
          </div>

          {statements.length > 0 && selectedStatement ? (
            <div className="space-y-4 rounded-xl border border-border bg-surface p-5">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div>
                  <h4 className="text-sm font-bold">{selectedStatement.filename}</h4>
                  <p className="text-[11px] text-muted-foreground font-mono">IBAN: {selectedStatement.account_iban}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="info">
                    {selectedStatement.matched_lines} / {selectedStatement.total_lines} Matched
                  </Badge>
                  <Badge tone={selectedStatement.status === "reconciled" ? "ok" : "warning"}>
                    {selectedStatement.status}
                  </Badge>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50 text-muted-foreground uppercase text-[10px] font-semibold">
                    <tr>
                      <th className="px-3 py-2.5">Date</th>
                      <th className="px-3 py-2.5">Description</th>
                      <th className="px-3 py-2.5">Counterparty</th>
                      <th className="px-3 py-2.5">Amount</th>
                      <th className="px-3 py-2.5">Reconciliation Status</th>
                      <th className="px-3 py-2.5">Matched Invoice</th>
                      <th className="px-3 py-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {selectedStatement.lines?.map((line) => (
                      <tr key={line.id} className={line.reconciliation_status === "matched" ? "bg-marine-steel/5" : ""}>
                        <td className="px-3 py-2 text-muted-foreground">{line.transaction_date}</td>
                        <td className="px-3 py-2 font-mono text-[11px]">{line.description}</td>
                        <td className="px-3 py-2">{line.counterparty_name || "—"}</td>
                        <td className="px-3 py-2 font-bold font-mono">€{(line.amount_cents / 100).toFixed(2)}</td>
                        <td className="px-3 py-2">
                          <Badge tone={statusTone(line.reconciliation_status)} dot>
                            {line.reconciliation_status.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 font-mono text-primary">{line.matched_invoice_id || "Unmatched"}</td>
                        <td className="px-3 py-2 text-right space-x-1.5">
                          {line.reconciliation_status === "partially_matched" && (
                            <Can permission="finance:reconcile" mode="disable">
                              <button
                                onClick={() => handleManualReconcile(line.id, line.matched_invoice_id || undefined, "match")}
                                className="rounded bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90"
                              >
                                Confirm Match
                              </button>
                            </Can>
                          )}
                          {line.reconciliation_status === "unmatched" && (
                            <Can permission="finance:reconcile" mode="disable">
                              <button
                                onClick={() => handleManualReconcile(line.id, undefined, "ignore")}
                                className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                              >
                                Ignore
                              </button>
                            </Can>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-center text-xs text-muted-foreground">No bank statements imported.</p>
          )}
        </div>
      )}

      {/* TAB 6: LANDED COST & DELIVERED MARGINS */}
      {activeTab === "margins" && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold">Landed Cost Allocation & Delivered Margins</h3>
              <p className="text-xs text-muted-foreground">
                Actual delivered margin incorporating product base cost, allocated freight/duties, and transport fuel.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={marginDimension}
                onChange={(e) => setMarginDimension(e.target.value as any)}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold"
              >
                <option value="product">By Product SKU</option>
                <option value="customer">By Customer</option>
                <option value="order">By Sales Order</option>
                <option value="delivery">By Delivery Route</option>
              </select>
              <button
                onClick={() => setLandedCostModalOpen(true)}
                className="inline-flex items-center rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Allocate Landed Cost
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/50 text-muted-foreground uppercase text-[10px] font-semibold">
                <tr>
                  <th className="px-3 py-2.5">Dimension Key</th>
                  <th className="px-3 py-2.5">Invoiced Revenue</th>
                  <th className="px-3 py-2.5">Landed Product Cost</th>
                  <th className="px-3 py-2.5">Route Transport</th>
                  <th className="px-3 py-2.5">Net Margin</th>
                  <th className="px-3 py-2.5">Margin %</th>
                  <th className="px-3 py-2.5">Cost Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {marginReports.map((r) => (
                  <tr key={r.dimension_key}>
                    <td className="px-3 py-2">
                      <div className="font-bold text-foreground">{r.dimension_label}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">{r.dimension_key}</div>
                    </td>
                    <td className="px-3 py-2 font-mono font-semibold">€{(r.invoiced_revenue_cents / 100).toFixed(2)}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">€{(r.landed_cost_cents / 100).toFixed(2)}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">€{(r.delivery_transport_cents / 100).toFixed(2)}</td>
                    <td className="px-3 py-2 font-mono font-bold text-marine-mid">€{(r.net_margin_cents / 100).toFixed(2)}</td>
                    <td className="px-3 py-2 font-bold">{r.margin_pct}%</td>
                    <td className="px-3 py-2">
                      <Badge tone={r.is_actual ? "ok" : "warning"} dot>
                        {r.is_actual ? "Actual Cost" : "Estimated Cost"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* GENERATE INVOICE MODAL */}
      {generateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-card p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto border border-border">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold">Generate Customer Invoice from Delivery</h3>
              <button onClick={() => setGenerateModalOpen(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="space-y-4 text-xs">
              <div>
                <label className="font-semibold">Delivery Reference / ID *</label>
                <input
                  type="text"
                  value={genDeliveryId}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGenDeliveryId(e.target.value)}
                  placeholder="e.g. DEL-2026-00101 or DEL-501"
                  className="mt-1 w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold">Payment Terms</label>
                  <select
                    value={genPaymentTerms}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setGenPaymentTerms(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background p-2"
                  >
                    <option value="Net 30">Net 30 Days</option>
                    <option value="Net 45">Net 45 Days</option>
                    <option value="Net 60">Net 60 Days</option>
                    <option value="Immediate">Immediate / Contanti</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold">Invoice Currency</label>
                  <input
                    type="text"
                    value="EUR (€)"
                    disabled
                    className="mt-1 w-full rounded-md border border-border bg-muted p-2 text-muted-foreground"
                  />
                </div>
              </div>
              <div>
                <label className="font-semibold">Internal Notes / Reference</label>
                <input
                  type="text"
                  value={genNotes}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGenNotes(e.target.value)}
                  placeholder="e.g. Delivery confirmed by Marco Rossi, DDT signed"
                  className="mt-1 w-full rounded-md border border-border bg-background p-2 text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setGenerateModalOpen(false)}
                  className="rounded border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  Cancel
                </button>
                <Can permission="finance:invoice" mode="disable">
                  <button
                    type="button"
                    onClick={handleGenerateInvoice}
                    className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    Generate Invoice
                  </button>
                </Can>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CREATE CREDIT NOTE MODAL */}
      {creditNoteModalOpen && selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-card p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto border border-border">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold">Create TD04 Credit Note for {selectedInvoice.invoice_number}</h3>
              <button onClick={() => setCreditNoteModalOpen(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="space-y-4 text-xs">
              <div>
                <label className="font-semibold">Commercial Reason *</label>
                <input
                  type="text"
                  value={cnReason}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCnReason(e.target.value)}
                  placeholder="Reason for credit adjustment..."
                  className="mt-1 w-full rounded-md border border-border bg-background p-2 text-xs"
                />
              </div>
              <div>
                <label className="font-semibold">Credit Amount in EUR (Leave blank for full amount €{(selectedInvoice.amount_cents / 100).toFixed(2)})</label>
                <input
                  type="text"
                  value={cnAmount}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCnAmount(e.target.value)}
                  placeholder={`Max: ${(selectedInvoice.amount_cents / 100).toFixed(2)}`}
                  className="mt-1 w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setCreditNoteModalOpen(false)}
                  className="rounded border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  Cancel
                </button>
                <Can permission="finance:invoice" mode="hide">
                  <button
                    type="button"
                    onClick={handleCreateCreditNote}
                    className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    Issue Credit Note
                  </button>
                </Can>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RECORD PAYMENT MODAL */}
      {paymentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-card p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto border border-border">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold">Record Customer Payment</h3>
              <button onClick={() => setPaymentModalOpen(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="space-y-4 text-xs">
              <div>
                <label className="font-semibold">Customer</label>
                <select
                  value={payCustomerId}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPayCustomerId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-background p-2"
                >
                  <option value="CUST-B2B-01">Ristorante Cracco Galleria (CUST-B2B-01)</option>
                  <option value="CUST-B2B-02">Hotel Principe di Savoia (CUST-B2B-02)</option>
                  <option value="CUST-B2B-03">Osteria Francescana Group (CUST-B2B-03)</option>
                  <option value="CUST-B2B-04">Trattoria Trippa Milano (CUST-B2B-04)</option>
                  <option value="STR-MIL-01">Gourmet Market Brera (STR-MIL-01)</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold">Amount (€)</label>
                  <input
                    type="text"
                    value={payAmount}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPayAmount(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background p-2 font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold">Payment Method</label>
                  <select
                    value={payMethod}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPayMethod(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background p-2"
                  >
                    <option value="bank_transfer">SEPA Bank Transfer</option>
                    <option value="riba">Ri.Ba (Ricevuta Bancaria)</option>
                    <option value="sepa_direct_debit">SEPA Direct Debit</option>
                    <option value="credit_card">Corporate Credit Card</option>
                    <option value="cash">Cash on Delivery</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="font-semibold">Bank TRN / Reference</label>
                <input
                  type="text"
                  value={payReference}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPayReference(e.target.value)}
                  placeholder="e.g. TRN-INTESA-990214"
                  className="mt-1 w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setPaymentModalOpen(false)}
                  className="rounded border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  Cancel
                </button>
                <Can permission="finance:payment" mode="disable">
                  <button
                    type="button"
                    onClick={handleRecordPayment}
                    className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    Confirm Payment
                  </button>
                </Can>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* IMPORT BANK STATEMENT MODAL */}
      {statementModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl rounded-xl bg-card p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto border border-border">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold">Import Bank Statement (CSV)</h3>
              <button onClick={() => setStatementModalOpen(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="space-y-4 text-xs">
              <div>
                <label className="font-semibold">Statement Filename</label>
                <input
                  type="text"
                  value={stmtFilename}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStmtFilename(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
                />
              </div>
              <div>
                <label className="font-semibold">CSV Content (Headers: Data, Importo, Descrizione, Beneficiario, Riferimento)</label>
                <textarea
                  rows={6}
                  value={csvContent}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setCsvContent(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setStatementModalOpen(false)}
                  className="rounded border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  Cancel
                </button>
                <Can permission="finance:reconcile" mode="hide">
                  <button
                    type="button"
                    onClick={handleImportStatement}
                    className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    Import & Run Auto-Match
                  </button>
                </Can>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ALLOCATE LANDED COST MODAL */}
      {landedCostModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-card p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto border border-border">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold">Allocate Landed Costs to Purchase Order</h3>
              <button onClick={() => setLandedCostModalOpen(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold">Freight & Transport (€)</label>
                  <input
                    type="text"
                    value={lcFreight}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLcFreight(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background p-2 font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold">Customs & Duties (€)</label>
                  <input
                    type="text"
                    value={lcDuty}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLcDuty(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background p-2 font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold">Marine Insurance (€)</label>
                  <input
                    type="text"
                    value={lcInsurance}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLcInsurance(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background p-2 font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold">Port / Cold Storage Handling (€)</label>
                  <input
                    type="text"
                    value={lcHandling}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLcHandling(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background p-2 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="font-semibold">Allocation Method</label>
                <select
                  value={lcMethod}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setLcMethod(e.target.value as any)}
                  className="mt-1 w-full rounded-md border border-border bg-background p-2"
                >
                  <option value="weight">By Net Weight (kg)</option>
                  <option value="value">By Purchase Value (ad-valorem)</option>
                  <option value="quantity">By Case Quantity</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setLandedCostModalOpen(false)}
                  className="rounded border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  Cancel
                </button>
                <Can permission="finance:landed_cost" mode="disable">
                  <button
                    type="button"
                    onClick={handleAllocateLandedCost}
                    className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    Allocate to Inventory
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
