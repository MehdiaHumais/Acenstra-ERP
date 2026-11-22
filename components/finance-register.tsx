"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, Send } from "lucide-react";
import { Badge, statusTone } from "@/components/ui";
import { money, percent, titleCase } from "@/lib/format";
import type { Invoice } from "@/lib/types";

export function FinanceRegister({ invoices }: { invoices: Invoice[] }) {
  const router = useRouter();
  const [items, setItems] = useState<Invoice[]>(invoices);
  const [feedback, setFeedback] = useState<string | null>(null);

  const notify = (message: string) => {
    setFeedback(message);
    window.setTimeout(() => setFeedback(null), 3500);
  };

  const applyFinanceAction = async (
    invoice: Invoice,
    action: "send_to_sdi" | "record_payment",
    message: string
  ) => {
    try {
      const res = await fetch("/api/v1/finance/summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `fin-${action}-${invoice.number}-${Date.now()}`,
        },
        body: JSON.stringify({
          action,
          invoice_id: invoice.number,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify(data?.error?.message ?? "Unable to process finance action.");
        return;
      }
      if (Array.isArray(data?.summary?.invoices)) {
        setItems(data.summary.invoices as Invoice[]);
      } else if (data?.invoice) {
        const updated = data.invoice as Invoice;
        setItems((current) => current.map((inv) => (inv.number === updated.number ? updated : inv)));
      }
      notify(message);
      router.refresh();
    } catch {
      notify("Network error while updating invoice.");
    }
  };

  const sendToSdi = (invoice: Invoice) =>
    applyFinanceAction(
      invoice,
      "send_to_sdi",
      `${invoice.number} transmitted via FatturaPA XML to Italy SdI · Status: Accepted.`
    );

  const recordPayment = (invoice: Invoice) =>
    applyFinanceAction(
      invoice,
      "record_payment",
      `SEPA payment recorded for ${invoice.number} · Customer exposure reduced.`
    );

  const exportCsv = () => {
    const header = ["Invoice", "Customer", "Order", "Total", "Paid", "Due", "Status", "SdI", "Margin %"];
    const rows = items.map((invoice) => [
      invoice.number,
      invoice.customer_name,
      invoice.order_number,
      (invoice.total_cents / 100).toFixed(2),
      (invoice.paid_cents / 100).toFixed(2),
      invoice.due_date,
      invoice.status,
      invoice.sdi_status,
      invoice.margin_pct.toFixed(1),
    ]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "ascentra-invoices.csv";
    link.click();
    URL.revokeObjectURL(url);
    notify("Invoice register exported as CSV.");
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <p className="text-[11px] font-medium text-muted-foreground">
          {items.filter((invoice) => invoice.status !== "paid").length} open ·{" "}
          {items.filter((invoice) => invoice.sdi_status !== "accepted").length} awaiting SdI
        </p>
        <button type="button" className="btn btn-secondary" onClick={exportCsv}>
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      {feedback && (
        <div className="flex items-center gap-2 border-b border-marine-ocean/60 bg-marine-ocean/20 px-4 py-2 text-[11px] font-medium text-marine-mid/90">
          <CheckCircle2 className="h-3.5 w-3.5" /> {feedback}
        </div>
      )}

      <div className="table-shell">
        <table className="data-table min-w-[1180px]">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Customer</th>
              <th>Order</th>
              <th className="text-right">Total</th>
              <th className="text-right">Paid</th>
              <th>Due</th>
              <th>Status</th>
              <th>SdI</th>
              <th className="text-right">Margin</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
                  No invoices yet. Invoices appear here once orders are delivered and billed.
                </td>
              </tr>
            )}
            {items.map((invoice) => (
              <tr key={invoice.id}>
                <td data-label="Invoice" className="font-mono text-[11px] font-semibold">{invoice.number}</td>
                <td data-label="Customer" className="font-medium">{invoice.customer_name}</td>
                <td data-label="Order" className="font-mono text-[10px] text-muted-foreground">{invoice.order_number}</td>
                <td data-label="Total" className="whitespace-nowrap text-right">{money(invoice.total_cents)}</td>
                <td data-label="Paid" className="whitespace-nowrap text-right">{money(invoice.paid_cents)}</td>
                <td data-label="Due" className="whitespace-nowrap text-[11px]">{invoice.due_date}</td>
                <td data-label="Status">
                  <Badge tone={statusTone(invoice.status)} dot>{titleCase(invoice.status)}</Badge>
                </td>
                <td data-label="SdI">
                  <Badge tone={statusTone(invoice.sdi_status)}>{titleCase(invoice.sdi_status)}</Badge>
                </td>
                <td data-label="Margin" className="text-right text-[11px] font-medium">{percent(invoice.margin_pct)}</td>
                <td data-label="Actions">
                  <div className="flex flex-wrap gap-1.5">
                    {invoice.sdi_status !== "accepted" && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => sendToSdi(invoice)}>
                        <Send className="h-3 w-3" /> Send SdI
                      </button>
                    )}
                    {invoice.status !== "paid" && (
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => recordPayment(invoice)}>
                        <CheckCircle2 className="h-3 w-3" /> Record payment
                      </button>
                    )}
                    {invoice.status === "paid" && invoice.sdi_status === "accepted" && (
                      <span className="text-[10px] font-medium text-muted-foreground">Settled</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
