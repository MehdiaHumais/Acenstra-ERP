"use client";

import { useState } from "react";
import {
  Banknote,
  FileCheck2,
  Percent,
  Receipt,
  ReceiptText,
} from "lucide-react";
import { FinanceRegister } from "@/components/finance-register";
import { FinanceWorkbench } from "@/components/finance-workbench";
import { PageHeading } from "@/components/page-heading";
import { ViewOnlyBadge } from "@/components/access-gate";
import { Badge, KpiCard, ProgressBar, SectionHeader, StatRow, Surface } from "@/components/ui";
import { cn, compactMoney, money, percent } from "@/lib/format";
import type { FinanceSummary } from "@/lib/types";

export type FinanceHubTab = "workbench" | "register";

export function FinanceSdiHub({
  finance,
  defaultTab = "workbench",
}: {
  finance: FinanceSummary;
  defaultTab?: FinanceHubTab;
}) {
  const [activeTab, setActiveTab] = useState<FinanceHubTab>(defaultTab);

  const outstanding = finance.revenue_cents - finance.collected_cents;
  const maximumAgeing = Math.max(1, ...finance.ageing.map((bucket) => bucket.amount_cents));
  const sdiQueued = finance.invoices.filter((invoice) => invoice.sdi_status === "queued").length;
  const sdiNotSent = finance.invoices.filter((invoice) => invoice.sdi_status === "not_sent").length;
  const sdiGenerated = finance.invoices.filter((invoice) => invoice.sdi_status !== "not_sent").length;
  const sdiAccepted = finance.invoices.filter((invoice) => invoice.sdi_status === "accepted").length;
  const sdiRejected = finance.invoices.filter((invoice) => invoice.sdi_status === "rejected").length;

  return (
    <div className="space-y-5">
      <PageHeading
        eyebrow="Step 10 · Invoicing, FatturaPA / SdI, Reconciliation & Margins"
        title="Finance & SdI"
        description="Generate invoices from delivered quantities, prepare FatturaPA XML for Italy's SdI integration, record payments, reconcile bank transactions and calculate margins using actual costs."
        meta="Immutable financial snapshots · FatturaPA v1.2.2 validated · Maker-checker bank reconciliation"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ViewOnlyBadge modifyPermissions={["finance:invoice", "finance:payment", "finance:sdi", "finance:reconcile"]} />
            <Badge tone="warning" dot>
              {finance.sdi_pending} queued for SdI
            </Badge>
            <Badge tone="info">{finance.invoices.length} invoices</Badge>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Month revenue"
          value={compactMoney(finance.revenue_cents)}
          change={`${compactMoney(finance.collected_cents)} collected`}
          trend="up"
          icon={<Banknote className="h-4 w-4" />}
        />
        <KpiCard
          label="Outstanding"
          value={compactMoney(outstanding)}
          change={`${compactMoney(finance.overdue_cents)} overdue`}
          trend="down"
          tone="warning"
          icon={<ReceiptText className="h-4 w-4" />}
        />
        <KpiCard
          label="Gross margin"
          value={percent(finance.gross_margin_pct)}
          change="Includes landed and delivery cost"
          trend="up"
          icon={<Percent className="h-4 w-4" />}
        />
        <KpiCard
          label="SdI accepted"
          value={`${sdiAccepted}/${finance.invoices.length}`}
          change={`${sdiQueued} queued · ${sdiNotSent} not sent`}
          trend="flat"
          icon={<FileCheck2 className="h-4 w-4" />}
        />
      </div>

      {/* Unified Switcher */}
      <div className="flex flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap rounded-xl border border-border bg-card p-1.5 shadow-sm [-webkit-overflow-scrolling:touch] sm:flex-wrap">
        <button
          type="button"
          onClick={() => setActiveTab("workbench")}
          className={cn(
            "flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all",
            activeTab === "workbench"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Receipt className="h-3.5 w-3.5" />
          Invoicing<span className="hidden sm:inline">, FatturaPA XML, Payments, Bank Recon & Margins</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("register")}
          className={cn(
            "flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all",
            activeTab === "register"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <ReceiptText className="h-3.5 w-3.5" />
          Receivables Register<span className="hidden sm:inline"> & Ageing Summary</span>
          <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px]">
            {finance.invoices.length}
          </span>
        </button>
      </div>

      {activeTab === "workbench" && <FinanceWorkbench />}

      {activeTab === "register" && (
        <div className="grid gap-5 xl:grid-cols-3">
          <Surface className="xl:col-span-2">
            <SectionHeader
              eyebrow="Receivables"
              title="Invoice register"
              description="Payment matching links bank transactions to invoices; unmatched cash enters a controlled exceptions queue."
              action={<Badge tone="info">{finance.invoices.length} invoices</Badge>}
            />
            <FinanceRegister invoices={finance.invoices} />
          </Surface>

          <div className="space-y-5">
            <Surface>
              <SectionHeader eyebrow="Ageing" title="Receivables ageing" />
              <div className="space-y-3 p-5">
                {finance.ageing.length === 0 && (
                  <p className="py-2 text-center text-xs text-muted-foreground">
                    No receivables outstanding.
                  </p>
                )}
                {finance.ageing.map((bucket) => (
                  <div key={bucket.bucket}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{bucket.bucket}</span>
                      <span className="font-semibold">{money(bucket.amount_cents)}</span>
                    </div>
                    <div className="mt-1.5">
                      <ProgressBar
                        value={(bucket.amount_cents / maximumAgeing) * 100}
                        tone={
                          bucket.bucket === "60+ days"
                            ? "critical"
                            : bucket.bucket === "31–60 days"
                              ? "warning"
                              : "ok"
                        }
                      />
                    </div>
                  </div>
                ))}
                <div className="pt-2">
                  <StatRow label="Trade payables" value={money(finance.ap_cents)} />
                </div>
              </div>
            </Surface>

            <Surface>
              <SectionHeader eyebrow="Italy compliance" title="SdI handoff" />
              <div className="space-y-3 p-5 text-[11px] leading-5 text-muted-foreground">
                <p>
                  Operational invoice data is mapped to the Italian e-invoice schema and handed to
                  an approved SdI provider. The platform stores the provider reference and status.
                </p>
                <StatRow label="Generated XML" value={String(sdiGenerated)} />
                <StatRow label="Provider accepted" value={String(sdiAccepted)} tone="ok" />
                <StatRow
                  label="Rejected"
                  value={String(sdiRejected)}
                  tone={sdiRejected ? "critical" : "ok"}
                />
              </div>
            </Surface>
          </div>
        </div>
      )}
    </div>
  );
}
