"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, Flag, Search } from "lucide-react";
import { Badge, ProgressBar, statusTone } from "@/components/ui";
import { money, number, percent, titleCase } from "@/lib/format";
import type { StorePerformance } from "@/lib/types";

export function StoreTable({ stores }: { stores: StorePerformance[] }) {
  const router = useRouter();
  const [items, setItems] = useState<StorePerformance[]>(stores);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [feedback, setFeedback] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter((store) => {
      const statusMatch = status === "all" || store.status === status;
      const queryMatch =
        !term ||
        store.name.toLowerCase().includes(term) ||
        store.code.toLowerCase().includes(term) ||
        store.city.toLowerCase().includes(term);
      return statusMatch && queryMatch;
    });
  }, [items, query, status]);

  const notify = (message: string) => {
    setFeedback(message);
    window.setTimeout(() => setFeedback(null), 3500);
  };

  const toggleFlag = async (store: StorePerformance) => {
    const nextStatus = store.status === "watch" ? "active" : "watch";
    try {
      const res = await fetch("/api/v1/stores/summary", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: store.code,
          status: nextStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify(data?.error?.message ?? "Unable to update store status.");
        return;
      }
      if (Array.isArray(data?.summary?.stores)) {
        setItems(data.summary.stores as StorePerformance[]);
      } else {
        setItems((current) => current.map((item) => (item.id === store.id ? { ...item, status: nextStatus } : item)));
      }
      notify(`${store.name} marked ${nextStatus}.`);
      router.refresh();
    } catch {
      notify("Network error while updating store status.");
    }
  };

  const exportCsv = () => {
    const header = ["Code", "Store", "City", "Purchases 30d EUR", "Orders", "Est. consumption kg", "Waste %", "Trend %", "Status"];
    const rows = items.map((store) => [
      store.code,
      store.name,
      store.city,
      (store.purchases_30d_cents / 100).toFixed(2),
      store.orders_30d,
      store.estimated_consumption_kg,
      store.waste_pct,
      store.trend_pct,
      store.status,
    ]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "ascentra-store-performance.csv";
    link.click();
    URL.revokeObjectURL(url);
    notify("Store performance exported as CSV.");
  };

  return (
    <div>
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative w-full sm:max-w-xs">
          <span className="sr-only">Search stores</span>
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search store, code or city"
            className="input pl-9"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter stores by status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="watch">Watch</option>
            <option value="paused">Paused</option>
          </select>
          <span className="text-xs text-muted-foreground">{filtered.length} stores</span>
          <button type="button" className="btn btn-secondary" onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        </div>
      </div>

      {feedback && (
        <div className="flex items-center gap-2 border-b border-marine-ocean/60 bg-marine-ocean/20 px-4 py-2 text-[11px] font-medium text-marine-mid/90">
          <CheckCircle2 className="h-3.5 w-3.5" /> {feedback}
        </div>
      )}

      <div className="table-shell">
        <table className="data-table min-w-[1120px]">
          <thead>
            <tr>
              <th>Store</th>
              <th>City</th>
              <th className="text-right">Purchases 30d</th>
              <th className="text-right">Orders</th>
              <th className="text-right">Est. consumption</th>
              <th>Waste</th>
              <th>Trend</th>
              <th>Top product</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((store) => (
              <tr key={store.id}>
                <td data-label="Store">
                  <p className="font-medium">{store.name}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">{store.code}</p>
                </td>
                <td data-label="City">{store.city}</td>
                <td data-label="Purchases 30d" className="whitespace-nowrap text-right font-medium">{money(store.purchases_30d_cents)}</td>
                <td data-label="Orders" className="text-right">{store.orders_30d}</td>
                <td data-label="Est. consumption" className="text-right">{number(store.estimated_consumption_kg)} kg</td>
                <td data-label="Waste">
                  <div className="flex items-center gap-2">
                    <ProgressBar
                      value={store.waste_pct * 10}
                      tone={store.waste_pct > 5 ? "critical" : store.waste_pct > 3 ? "warning" : "ok"}
                      className="w-16"
                    />
                    <span className="text-[11px]">{percent(store.waste_pct)}</span>
                  </div>
                </td>
                <td data-label="Trend" className={store.trend_pct >= 0 ? "text-[11px] font-semibold text-marine-mid" : "text-[11px] font-semibold text-red-600"}>
                  {store.trend_pct >= 0 ? "+" : ""}
                  {percent(store.trend_pct)}
                </td>
                <td data-label="Top product" className="text-[11px]">{store.top_product}</td>
                <td data-label="Status">
                  <Badge tone={statusTone(store.status)} dot>{titleCase(store.status)}</Badge>
                </td>
                <td data-label="Action">
                  <button
                    type="button"
                    className={`btn btn-sm ${store.status === "watch" ? "btn-secondary" : "btn-ghost"}`}
                    onClick={() => toggleFlag(store)}
                  >
                    <Flag className="h-3 w-3" /> {store.status === "watch" ? "Clear flag" : "Flag"}
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
                  No stores match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
