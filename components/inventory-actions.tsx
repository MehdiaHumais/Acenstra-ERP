"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ClipboardList, Download, X } from "lucide-react";
import { Can } from "@/components/access-gate";
import { number } from "@/lib/format";
import type { Lot } from "@/lib/types";

export function InventoryActions({ lots }: { lots: Lot[] }) {
  const router = useRouter();
  const [countOpen, setCountOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [lotId, setLotId] = useState(String(lots[0]?.id ?? 1));
  const [counted, setCounted] = useState("");

  const notify = (message: string) => {
    setFeedback(message);
    window.setTimeout(() => setFeedback(null), 4500);
  };

  const exportStock = () => {
    const header = ["Batch", "SKU", "Product", "Warehouse", "Location", "Zone", "Expires", "Days remaining", "Remaining kg", "Temperature", "Quality", "FEFO rank"];
    const rows = lots.map((lot) => [
      lot.batch_code,
      lot.sku,
      lot.product_name,
      lot.warehouse,
      lot.location,
      lot.zone,
      lot.expires_on,
      lot.days_remaining,
      lot.remaining_kg,
      lot.temperature_status,
      lot.quality_status,
      lot.fefo_rank,
    ]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "ascentra-stock-ledger.csv";
    link.click();
    URL.revokeObjectURL(url);
    notify("Stock ledger exported as CSV.");
  };

  const submitCount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const lot = lots.find((item) => String(item.id) === lotId) ?? lots[0];
    const quantityKg = Number(counted);
    if (!lot || Number.isNaN(quantityKg) || quantityKg < 0) return;
    const countedCases = Math.round(quantityKg / 5);
    const variance = Math.round((quantityKg - lot.remaining_kg) * 10) / 10;

    try {
      const res = await fetch("/api/v1/inventory/lots", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `cnt-${lot.batch_code}-${Date.now()}`,
        },
        body: JSON.stringify({
          batch_id: lot.batch_code,
          counted_cases: countedCases,
          reason: `Physical cycle count (${quantityKg} kg counted)`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify(data?.error?.message ?? "Unable to post cycle count.");
        return;
      }
      notify(
        `Cycle count persisted for ${lot.batch_code}: ${number(quantityKg, 1)} kg (${countedCases} cases) counted, variance ${variance > 0 ? "+" : ""}${number(variance, 1)} kg.`,
      );
      setCountOpen(false);
      setCounted("");
      router.refresh();
    } catch {
      notify("Network error while posting cycle count.");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Can permission="exports.run" mode="disable">
        <button type="button" className="btn btn-secondary" onClick={exportStock}>
          <Download className="h-3.5 w-3.5" /> Export stock
        </button>
      </Can>
      <Can permission="inventory:adjust" mode="disable">
        <button type="button" className="btn btn-primary" onClick={() => setCountOpen(true)}>
          <ClipboardList className="h-3.5 w-3.5" /> Cycle count
        </button>
      </Can>

      {feedback && (
        <div className="fixed bottom-5 right-5 z-[80] max-w-sm rounded-xl border border-marine-ocean/60 bg-white px-4 py-3 text-xs font-medium text-marine-mid/90 shadow-xl">
          <span className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {feedback}
          </span>
        </div>
      )}

      {countOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={submitCount} className="w-full max-w-md rounded-xl border border-border bg-card text-left shadow-xl">
            <div className="flex items-start justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold">Post cycle count</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Counted quantity is compared to the stock ledger and any variance is logged.
                </p>
              </div>
              <button type="button" aria-label="Close" className="btn btn-ghost btn-sm" onClick={() => setCountOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <label className="block">
                <span className="field-label">Lot</span>
                <select
                  value={lotId}
                  onChange={(event) => setLotId(event.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none"
                >
                  {lots.map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.batch_code} · {lot.product_name} · {lot.location}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="field-label">Counted quantity (kg)</span>
                <input
                  type="number"
                  required
                  min="0"
                  step="0.1"
                  value={counted}
                  onChange={(event) => setCounted(event.target.value)}
                  placeholder="e.g. 268.4"
                  className="input mt-1"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button type="button" className="btn btn-secondary" onClick={() => setCountOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Post count
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
