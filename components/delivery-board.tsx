"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BadgeCheck, Search, Truck, X } from "lucide-react";
import { Badge, statusTone } from "@/components/ui";
import { Can } from "@/components/access-gate";
import { dateTime, titleCase } from "@/lib/format";
import type { Delivery } from "@/lib/types";

const statusFilters = ["all", "planned", "loading", "in_transit", "delivered", "exception"];

export function DeliveryBoard({ deliveries }: { deliveries: Delivery[] }) {
  const router = useRouter();
  const [items, setItems] = useState<Delivery[]>(deliveries);
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [exceptionFor, setExceptionFor] = useState<Delivery | null>(null);
  const [reason, setReason] = useState("Customer refused delivery");

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter((delivery) => {
      const statusMatch = status === "all" || delivery.status === status;
      const queryMatch =
        !term ||
        delivery.number.toLowerCase().includes(term) ||
        delivery.customer_name.toLowerCase().includes(term) ||
        delivery.driver.toLowerCase().includes(term);
      return statusMatch && queryMatch;
    });
  }, [items, status, query]);

  const live = {
    delivered: items.filter((item) => item.status === "delivered").length,
    exceptions: items.filter((item) => item.exception).length,
    pods: items.filter((item) => item.pod_signed).length,
  };

  const notify = (message: string) => {
    setFeedback(message);
    window.setTimeout(() => setFeedback(null), 3500);
  };

  const applyDeliveryAction = async (
    delivery: Delivery,
    action: "start_load" | "dispatch" | "capture_pod" | "resolve" | "record_exception",
    message: string,
    exceptionReason?: string
  ) => {
    try {
      const res = await fetch("/api/v1/deliveries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delivery_id: delivery.number,
          action,
          reason: exceptionReason,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify(data?.error?.message ?? "Unable to update delivery.");
        return;
      }
      if (Array.isArray(data?.deliveries)) {
        setItems(data.deliveries as Delivery[]);
      } else if (data?.delivery) {
        const updated = data.delivery as Delivery;
        setItems((current) => current.map((d) => (d.number === updated.number ? updated : d)));
      }
      notify(message);
      router.refresh();
    } catch {
      notify("Network error while updating delivery.");
    }
  };

  const startLoad = (delivery: Delivery) =>
    applyDeliveryAction(delivery, "start_load", `${delivery.number} load check started.`);

  const dispatch = (delivery: Delivery) =>
    applyDeliveryAction(delivery, "dispatch", `${delivery.number} departed. Driver app synced.`);

  const capturePod = (delivery: Delivery) =>
    applyDeliveryAction(delivery, "capture_pod", `${delivery.number} delivered with signed POD · invoice issued.`);

  const resolve = (delivery: Delivery) =>
    applyDeliveryAction(delivery, "resolve", `${delivery.number} exception resolved. Investigation logged.`);

  const submitException = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!exceptionFor) return;
    const target = exceptionFor;
    setExceptionFor(null);
    applyDeliveryAction(target, "record_exception", `Exception recorded for ${target.number}.`, reason);
  };

  return (
    <div>
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative w-full sm:max-w-xs">
          <span className="sr-only">Search deliveries</span>
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search delivery, customer or driver"
            className="input pl-9"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none"
          >
            {statusFilters.map((item) => (
              <option key={item} value={item}>
                {titleCase(item)}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            {live.delivered} delivered · {live.pods} PODs · {live.exceptions} exceptions
          </span>
        </div>
      </div>

      {feedback && (
        <div className="flex items-center gap-2 border-b border-marine-ocean/60 bg-marine-ocean/20 px-4 py-2 text-[11px] font-medium text-marine-mid/90">
          <BadgeCheck className="h-3.5 w-3.5" /> {feedback}
        </div>
      )}

      <div className="table-shell">
        <table className="data-table min-w-[1100px]">
          <thead>
            <tr>
              <th>Delivery / Order</th>
              <th>Customer</th>
              <th>Route</th>
              <th>Driver / Vehicle</th>
              <th>Planned</th>
              <th>Temp.</th>
              <th>POD</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((delivery) => (
              <tr key={delivery.id}>
                <td data-label="Delivery / Order">
                  <p className="font-mono text-[11px] font-semibold">{delivery.number}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{delivery.order_number}</p>
                </td>
                <td data-label="Customer" className="font-medium">{delivery.customer_name}</td>
                <td data-label="Route">{delivery.route}</td>
                <td data-label="Driver / Vehicle">
                  <p>{delivery.driver}</p>
                  <p className="text-[10px] text-muted-foreground">{delivery.vehicle}</p>
                </td>
                <td data-label="Planned" className="whitespace-nowrap text-[11px]">{dateTime(delivery.planned_at)}</td>
                <td data-label="Temp.">
                  <span className={delivery.temperature_c > 4 ? "font-semibold text-red-600" : "font-medium"}>
                    {delivery.temperature_c.toFixed(1)}°C
                  </span>
                </td>
                <td data-label="POD">
                  <Badge tone={delivery.pod_signed ? "ok" : "neutral"}>
                    {delivery.pod_signed ? "Signed" : "Pending"}
                  </Badge>
                </td>
                <td data-label="Status">
                  <Badge tone={statusTone(delivery.status)} dot>{titleCase(delivery.status)}</Badge>
                </td>
                <td data-label="Actions">
                  <div className="flex flex-wrap gap-1.5">
                    {delivery.status === "planned" && (
                      <Can permission="deliveries:update" mode="disable">
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => startLoad(delivery)}>
                          <Truck className="h-3 w-3" /> Start load
                        </button>
                      </Can>
                    )}
                    {delivery.status === "loading" && (
                      <Can permission="deliveries:update" mode="disable">
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => dispatch(delivery)}>
                          <Truck className="h-3 w-3" /> Dispatch
                        </button>
                      </Can>
                    )}
                    {delivery.status === "in_transit" && (
                      <Can permission="deliveries:update" mode="disable">
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => capturePod(delivery)}>
                          <BadgeCheck className="h-3 w-3" /> Capture POD
                        </button>
                      </Can>
                    )}
                    {delivery.status === "exception" && (
                      <Can permission="deliveries:update" mode="disable">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => resolve(delivery)}>
                          Resolve
                        </button>
                      </Can>
                    )}
                    {delivery.status !== "delivered" && delivery.status !== "exception" && (
                      <Can permission="deliveries:update" mode="disable">
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => setExceptionFor(delivery)}>
                          <AlertTriangle className="h-3 w-3" /> Exception
                        </button>
                      </Can>
                    )}
                    {delivery.status === "delivered" && (
                      <span className="text-[10px] font-medium text-muted-foreground">Closed</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                  No deliveries match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {live.exceptions > 0 && (
        <div className="border-t border-border bg-red-50/60 px-5 py-4">
          <p className="text-xs font-semibold text-red-700">Open exception evidence</p>
          <ul className="mt-2 space-y-1 text-[11px] text-red-700/90">
            {items
              .filter((delivery) => delivery.exception)
              .map((delivery) => (
                <li key={delivery.id}>
                  <span className="font-mono font-semibold">{delivery.number}</span> · {delivery.exception}
                </li>
              ))}
          </ul>
        </div>
      )}

      {exceptionFor && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
          <form
            onSubmit={submitException}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delivery-exception-title"
            className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl sm:max-w-md sm:rounded-xl"
          >
            <div className="flex items-start justify-between border-b border-border px-4 pb-4 pt-4 sm:px-5 sm:pt-5">
              <div>
                <h2 id="delivery-exception-title" className="text-sm font-semibold">Record delivery exception</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {exceptionFor.number} · {exceptionFor.customer_name}
                </p>
              </div>
              <button type="button" aria-label="Close" className="btn btn-ghost btn-sm min-h-11 min-w-11 justify-center sm:min-h-0 sm:min-w-0" onClick={() => setExceptionFor(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              <label className="block">
                <span className="field-label">Reason code</span>
                <select value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none">
                  <option>Customer refused delivery</option>
                  <option>Temperature excursion on arrival</option>
                  <option>Short quantity against manifest</option>
                  <option>Damaged packaging</option>
                  <option>Site access unavailable</option>
                </select>
              </label>
              <p className="mt-3 rounded-lg bg-muted/50 p-3 text-[11px] leading-5 text-muted-foreground">
                Exceptions create an evidence record and trigger a credit-note review. Photo and signature capture
                would be attached by the driver app in production.
              </p>
            </div>
            <div className="sticky bottom-0 z-10 flex justify-end gap-2 border-t border-border bg-card px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pb-3">
              <button type="button" className="btn btn-secondary min-h-11 sm:min-h-0" onClick={() => setExceptionFor(null)}>
                Cancel
              </button>
              <Can permission="deliveries:update" mode="disable">
                <button type="submit" className="btn btn-danger min-h-11 sm:min-h-0">
                  Record exception
                </button>
              </Can>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
