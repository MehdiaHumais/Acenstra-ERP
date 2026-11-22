"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Badge, statusTone } from "@/components/ui";
import { TablePagination, TableToolbar } from "@/components/data-table";
import { Can } from "@/components/access-gate";
import { dateTime, money, number, titleCase } from "@/lib/format";
import type { Product, SalesOrder } from "@/lib/types";

const statuses = ["all", "draft", "confirmed", "picking", "dispatched", "delivered", "cancelled"];
const editableStatuses: SalesOrder["status"][] = [
  "draft",
  "confirmed",
  "picking",
  "dispatched",
  "delivered",
  "cancelled",
];
const nextStatus: Record<string, SalesOrder["status"] | null> = {
  draft: "confirmed",
  confirmed: "picking",
  picking: "dispatched",
  dispatched: "delivered",
  delivered: null,
  cancelled: null,
};

function blankForm(products: Product[]) {
  return {
    customer: "",
    type: "restaurant" as SalesOrder["customer_type"],
    productId: String(products[0]?.id ?? ""),
    productName: "Atlantic Salmon Fillet",
    unitPrice: "18.90",
    quantity: "10",
  };
}

type EditOrderForm = {
  orderNumber: string;
  customer: string;
  type: SalesOrder["customer_type"];
  sku: string;
  quantity: string;
  status: SalesOrder["status"];
};

export function OrdersTable({ orders, products }: { orders: SalesOrder[]; products: Product[] }) {
  const router = useRouter();
  const [items, setItems] = useState<SalesOrder[]>(orders);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(() => blankForm(products));
  const [editingOrder, setEditingOrder] = useState<EditOrderForm | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter((order) => {
      const statusMatch = status === "all" || order.status === status;
      const queryMatch =
        !term ||
        order.number.toLowerCase().includes(term) ||
        order.customer_name.toLowerCase().includes(term);
      return statusMatch && queryMatch;
    });
  }, [items, query, status]);

  useEffect(() => {
    setPage(1);
  }, [query, status]);

  const pagedFiltered = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  );

  const selectedOrder =
    selectedOrderId === null ? null : items.find((order) => order.id === selectedOrderId) ?? null;
  const selectedTarget = selectedOrder ? nextStatus[selectedOrder.status] : null;

  // Close the detail popup on Escape and lock page scrolling while it is open.
  useEffect(() => {
    if (!selectedOrder) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedOrderId(null);
    };
    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedOrder]);

  const notify = (message: string) => {
    setFeedback(message);
    window.setTimeout(() => setFeedback(null), 4000);
  };

  const replaceOrderInState = (updated: SalesOrder, message: string) => {
    setItems((current) =>
      current.map((order) => (order.id === updated.id || order.number === updated.number ? updated : order))
    );
    notify(message);
    router.refresh();
  };

  const openEditModal = (order: SalesOrder) => {
    setSelectedOrderId(null);
    const firstLine = order.lines[0];
    setEditingOrder({
      orderNumber: order.number,
      customer: order.customer_name,
      type: order.customer_type,
      sku: firstLine?.sku ?? products[0]?.sku ?? "SKU-SAL-001",
      quantity: String(firstLine?.quantity_kg ?? 10),
      status: order.status,
    });
  };

  const submitEditOrder = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingOrder) return;
    try {
      const res = await fetch("/api/v1/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: editingOrder.orderNumber,
          action: "edit",
          customer_name: editingOrder.customer.trim() || "Customer",
          customer_type: editingOrder.type,
          sku: editingOrder.sku,
          quantity_kg: Math.max(1, Number(editingOrder.quantity) || 1),
          status: editingOrder.status,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify(data?.error?.message ?? "Unable to update order.");
        return;
      }
      const updated = data as SalesOrder;
      setEditingOrder(null);
      replaceOrderInState(updated, `${updated.number} updated & FEFO allocation recalculated.`);
    } catch {
      notify("Network error while updating order.");
    }
  };

  const removeOrder = async (order: SalesOrder) => {
    try {
      const res = await fetch(`/api/v1/orders?order_id=${encodeURIComponent(order.number)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        notify(data?.error?.message ?? "Unable to delete order.");
        return;
      }
      setItems((current) =>
        current.filter((item) => item.id !== order.id && item.number !== order.number)
      );
      if (selectedOrderId === order.id) {
        setSelectedOrderId(null);
      }
      notify(`${order.number} deleted and any reserved FEFO stock released.`);
      router.refresh();
    } catch {
      notify("Network error while deleting order.");
    }
  };

  const advance = async (order: SalesOrder) => {
    const target = nextStatus[order.status];
    if (!target) return;
    try {
      const res = await fetch("/api/v1/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: order.number, action: "advance" }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify(data?.error?.message ?? "Unable to advance order status.");
        return;
      }
      replaceOrderInState(data as SalesOrder, `${order.number} moved to ${titleCase((data as SalesOrder).status)}.`);
    } catch {
      notify("Network error while advancing order.");
    }
  };

  const approveCredit = async (order: SalesOrder) => {
    try {
      const res = await fetch("/api/v1/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: order.number,
          action: "release_credit",
          reason: "Finance maker-checker credit release via Orders console",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify(data?.error?.message ?? "Unable to release credit hold.");
        return;
      }
      replaceOrderInState(data as SalesOrder, `Credit released for ${order.number}. Order confirmed & audited.`);
    } catch {
      notify("Network error while releasing credit hold.");
    }
  };

  const cancelOrder = async (order: SalesOrder) => {
    try {
      const res = await fetch("/api/v1/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: order.number,
          action: "cancel",
          reason: "Cancelled from Orders management table",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify(data?.error?.message ?? "Unable to cancel order.");
        return;
      }
      replaceOrderInState(data as SalesOrder, `${order.number} cancelled. FEFO reservation released & audit recorded.`);
    } catch {
      notify("Network error while cancelling order.");
    }
  };

  const createOrder = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const product = products.find((item) => String(item.id) === form.productId) ?? products[0];
    const quantityKg = Math.max(1, Number(form.quantity) || 1);
    const cases = Math.max(1, Math.round(quantityKg / 5));
    const unitPriceCents = product ? product.unit_price_cents : Math.round(Number(form.unitPrice || 18.9) * 100);
    const sku =
      product?.sku ??
      `SKU-${(form.productName || "PROD").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "FOOD"}-001`;
    const productName = product?.name ?? form.productName.trim() ?? "Atlantic Salmon Fillet";

    try {
      const res = await fetch("/api/v1/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `ord-${Date.now()}`,
        },
        body: JSON.stringify({
          customer: form.customer.trim() || "New customer",
          customer_type: form.type,
          sku,
          product_name: productName,
          unit_price_cents: unitPriceCents,
          cases,
          quantity_kg: quantityKg,
          total_cents: Math.round(quantityKg * unitPriceCents),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify(data?.error?.message ?? "Unable to create order.");
        return;
      }
      const created = data as SalesOrder;
      setItems((current) => [created, ...current]);
      setCreating(false);
      setForm(blankForm(products));
      setSelectedOrderId(created.id);
      notify(
        `${created.number} persisted (${titleCase(created.status)}) · FEFO batch ${created.lines[0]?.batch_code ?? "allocated"}.`
      );
      router.refresh();
    } catch {
      notify("Network error while creating order.");
    }
  };

  return (
    <div>
      <TableToolbar
        count={filtered.length}
        countLabel="orders"
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search order or customer"
        filters={
          <select
            id="order-status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-8 rounded-lg border border-input bg-background px-2 text-xs outline-none"
          >
            {statuses.map((item) => (
              <option key={item} value={item}>
                {titleCase(item)}
              </option>
            ))}
          </select>
        }
        action={
          <button
            type="button"
            className="btn btn-primary btn-sm"
            title="Create a sales order"
            onClick={() => setCreating(true)}
          >
            <Plus className="h-3.5 w-3.5" /> New order
          </button>
        }
      />

      {products.length === 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-sky-200 bg-sky-50 px-4 py-2.5 text-xs text-sky-900">
          <div className="flex items-center gap-2">
            <span className="font-semibold">Catalog note:</span>
            <span>Your product catalog currently has 0 items. You can create an order directly with your item name, or add products in advance.</span>
          </div>
          <a href="/products" className="font-semibold text-sky-800 underline hover:text-sky-950">
            Go to Products &rarr;
          </a>
        </div>
      )}

      {feedback && (
        <div className="flex items-center gap-2 border-b border-marine-ocean/60 bg-marine-ocean/20 px-4 py-2 text-[11px] font-medium text-marine-mid/90">
          <CheckCircle2 className="h-3.5 w-3.5" /> {feedback}
        </div>
      )}

      <div className="table-shell">
        <table className="data-table min-w-[1060px]">
          <thead>
            <tr>
              <th>Order / Customer</th>
              <th>Channel</th>
              <th>Ordered</th>
              <th>Promised</th>
              <th>Lines</th>
              <th className="text-right">Value</th>
              <th>Credit</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pagedFiltered.map((order) => (
              <tr
                key={order.id}
                className="cursor-pointer"
                onClick={() => setSelectedOrderId(order.id)}
                title={`Open details for ${order.number}`}
              >
                <td data-label="Order / Customer">
                  <p className="font-mono text-[11px] font-semibold">{order.number}</p>
                  <p className="mt-0.5 font-medium">{order.customer_name}</p>
                </td>
                <td data-label="Channel">
                  <Badge tone={order.customer_type === "store" ? "info" : "neutral"}>
                    {titleCase(order.customer_type)}
                  </Badge>
                </td>
                <td data-label="Ordered" className="whitespace-nowrap text-[11px]">{dateTime(order.ordered_at)}</td>
                <td data-label="Promised" className="whitespace-nowrap text-[11px]">{dateTime(order.promised_at)}</td>
                <td data-label="Lines">{order.lines.length}</td>
                <td data-label="Value" className="whitespace-nowrap text-right font-medium">{money(order.total_cents)}</td>
                <td data-label="Credit">
                  <Badge tone={statusTone(order.credit_status)} dot>
                    {titleCase(order.credit_status)}
                  </Badge>
                </td>
                <td data-label="Status">
                  <Badge tone={statusTone(order.status)} dot>
                    {titleCase(order.status)}
                  </Badge>
                </td>
                <td
                  data-label="Actions"
                  className="whitespace-nowrap text-right"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="inline-flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => openEditModal(order)}
                      title={`Edit ${order.number}`}
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                    <Can permission="orders:write" mode="hide">
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => removeOrder(order)}
                        title={`Delete ${order.number}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </Can>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                  No orders match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <TablePagination
        page={page}
        pageSize={pageSize}
        total={filtered.length}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
      />

      {selectedOrder && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          role="presentation"
          onClick={() => setSelectedOrderId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-detail-title"
            className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl sm:max-h-[88vh] sm:rounded-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="order-detail-title" className="font-mono text-sm font-semibold">
                    {selectedOrder.number}
                  </h2>
                  <Badge tone={statusTone(selectedOrder.status)} dot>
                    {titleCase(selectedOrder.status)}
                  </Badge>
                  <Badge tone={statusTone(selectedOrder.credit_status)} dot>
                    Credit {titleCase(selectedOrder.credit_status)}
                  </Badge>
                </div>
                <p className="mt-1 break-words text-sm font-medium">{selectedOrder.customer_name}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Order details, FEFO batch allocation and fulfilment status
                </p>
              </div>
              <button
                type="button"
                aria-label="Close order details"
                className="btn btn-ghost btn-sm shrink-0"
                onClick={() => setSelectedOrderId(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Ordered", value: dateTime(selectedOrder.ordered_at) },
                  { label: "Promised", value: dateTime(selectedOrder.promised_at) },
                  { label: "Channel", value: titleCase(selectedOrder.customer_type) },
                  { label: "Order value", value: money(selectedOrder.total_cents) },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="min-w-0 rounded-lg border border-border bg-muted/30 px-3 py-2"
                  >
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      {stat.label}
                    </dt>
                    <dd className="mt-0.5 break-words text-xs font-medium sm:text-sm">{stat.value}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Order lines ({selectedOrder.lines.length})
                  </h3>
                  <span className="text-[11px] text-muted-foreground">FEFO-allocated batches</span>
                </div>

                <div className="mt-2 overflow-hidden rounded-xl border border-border">
                  <div className="hidden grid-cols-12 gap-2 bg-muted/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:grid">
                    <span className="col-span-5">Product</span>
                    <span className="col-span-2">FEFO batch</span>
                    <span className="col-span-2 text-right">Quantity</span>
                    <span className="col-span-3 text-right">Line value</span>
                  </div>
                  {selectedOrder.lines.map((line, index) => (
                    <div
                      key={`${selectedOrder.id}-${line.sku}-${index}`}
                      className="grid grid-cols-1 gap-2 border-t border-border/70 px-3 py-3 text-sm sm:grid-cols-12 sm:items-center"
                    >
                      <div className="min-w-0 sm:col-span-5">
                        <p className="break-words font-medium">{line.product_name}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">{line.sku}</p>
                      </div>
                      <div className="min-w-0 sm:col-span-2">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:hidden">
                          FEFO batch{" "}
                        </span>
                        <span className="font-mono text-[11px]">{line.batch_code}</span>
                      </div>
                      <div className="min-w-0 sm:col-span-2 sm:text-right">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:hidden">
                          Quantity{" "}
                        </span>
                        <span>{number(line.quantity_kg, 1)} kg</span>
                        <span className="block text-[10px] text-muted-foreground">
                          {money(line.unit_price_cents, true)}/kg
                        </span>
                      </div>
                      <div className="min-w-0 sm:col-span-3 sm:text-right">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:hidden">
                          Line value{" "}
                        </span>
                        <span className="font-medium">
                          {money(Math.round(line.quantity_kg * line.unit_price_cents))}
                        </span>
                      </div>
                    </div>
                  ))}
                  {selectedOrder.lines.length === 0 && (
                    <p className="border-t border-border/70 px-3 py-6 text-center text-sm text-muted-foreground">
                      No lines recorded for this order.
                    </p>
                  )}
                  <div className="flex items-center justify-between border-t border-border bg-muted/40 px-3 py-2.5 text-sm font-semibold">
                    <span>Order total</span>
                    <span>{money(selectedOrder.total_cents)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/20 px-5 py-3">
              {selectedOrder.credit_status !== "clear" && selectedOrder.status !== "cancelled" && (
                <Can permission="orders:credit_override" mode="hide">
                  <button type="button" className="btn btn-primary" onClick={() => approveCredit(selectedOrder)}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Approve credit & confirm
                  </button>
                </Can>
              )}
              {selectedTarget && selectedOrder.credit_status === "clear" && (
                <Can permission="orders:write" mode="disable">
                  <button type="button" className="btn btn-secondary" onClick={() => advance(selectedOrder)}>
                    Advance to {titleCase(selectedTarget)}
                  </button>
                </Can>
              )}
              <button type="button" className="btn btn-secondary" onClick={() => openEditModal(selectedOrder)}>
                <Pencil className="h-3.5 w-3.5" /> Edit order
              </button>
              {selectedOrder.status !== "cancelled" && selectedOrder.status !== "delivered" && (
                <Can permission="orders:write" mode="disable">
                  <button type="button" className="btn btn-secondary" onClick={() => cancelOrder(selectedOrder)}>
                    <X className="h-3.5 w-3.5" /> Cancel order
                  </button>
                </Can>
              )}
              <Can permission="orders:write" mode="hide">
                <button type="button" className="btn btn-danger" onClick={() => removeOrder(selectedOrder)}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete order
                </button>
              </Can>
              <button type="button" className="btn btn-ghost ml-auto" onClick={() => setSelectedOrderId(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {creating && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={createOrder}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-order-title"
            className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 id="create-order-title" className="text-sm font-semibold">Create customer order</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Draft order · contract price and FEFO stock checked on confirm
                </p>
              </div>
              <button type="button" aria-label="Close" className="btn btn-ghost btn-sm" onClick={() => setCreating(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <label className="block">
                <span className="field-label">Customer</span>
                <input
                  required
                  value={form.customer}
                  onChange={(event) => setForm({ ...form, customer: event.target.value })}
                  placeholder="e.g. Corner Bistro"
                  className="input mt-1"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="field-label">Channel</span>
                  <select
                    value={form.type}
                    onChange={(event) => setForm({ ...form, type: event.target.value as SalesOrder["customer_type"] })}
                    className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none"
                  >
                    <option value="restaurant">Restaurant</option>
                    <option value="store">Franchise store</option>
                    <option value="wholesale">Wholesale</option>
                  </select>
                </label>
                <label className="block">
                  <span className="field-label">Quantity (kg)</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={form.quantity}
                    onChange={(event) => setForm({ ...form, quantity: event.target.value })}
                    className="input mt-1"
                  />
                </label>
              </div>
              {products.length > 0 ? (
                <label className="block">
                  <span className="field-label">Product</span>
                  <select
                    value={form.productId}
                    onChange={(event) => setForm({ ...form, productId: event.target.value })}
                    className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none"
                  >
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name} · {money(product.unit_price_cents)}/{product.unit}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="space-y-3 rounded-lg border border-border/80 bg-muted/30 p-3">
                  <label className="block">
                    <span className="field-label">Product / Food item name *</span>
                    <input
                      required
                      type="text"
                      placeholder="e.g. Atlantic Salmon Fillet"
                      value={form.productName}
                      onChange={(event) => setForm({ ...form, productName: event.target.value })}
                      className="input mt-1"
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">Unit price (€/kg) *</span>
                    <input
                      required
                      type="number"
                      step="0.01"
                      min="0.1"
                      placeholder="18.90"
                      value={form.unitPrice}
                      onChange={(event) => setForm({ ...form, unitPrice: event.target.value })}
                      className="input mt-1"
                    />
                  </label>
                  <p className="text-[11px] text-muted-foreground">
                    Item will automatically be registered in your Product Master Catalog.
                  </p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button type="button" className="btn btn-secondary" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <Can permission="orders:write" mode="disable">
                <button type="submit" className="btn btn-primary">
                  Create draft
                </button>
              </Can>
            </div>
          </form>
        </div>
      )}

      {editingOrder && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={submitEditOrder}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-order-title"
            className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 id="edit-order-title" className="text-sm font-semibold">Edit order · {editingOrder.orderNumber}</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Update customer, channel, product, quantity or status
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                className="btn btn-ghost btn-sm"
                onClick={() => setEditingOrder(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <label className="block">
                <span className="field-label">Customer</span>
                <input
                  required
                  value={editingOrder.customer}
                  onChange={(event) => setEditingOrder({ ...editingOrder, customer: event.target.value })}
                  className="input mt-1"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="field-label">Channel</span>
                  <select
                    value={editingOrder.type}
                    onChange={(event) =>
                      setEditingOrder({ ...editingOrder, type: event.target.value as SalesOrder["customer_type"] })
                    }
                    className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none"
                  >
                    <option value="restaurant">Restaurant</option>
                    <option value="store">Franchise store</option>
                    <option value="wholesale">Wholesale</option>
                  </select>
                </label>
                <label className="block">
                  <span className="field-label">Status</span>
                  <select
                    value={editingOrder.status}
                    onChange={(event) =>
                      setEditingOrder({ ...editingOrder, status: event.target.value as SalesOrder["status"] })
                    }
                    className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none"
                  >
                    {editableStatuses.map((s) => (
                      <option key={s} value={s}>
                        {titleCase(s)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="field-label">Product</span>
                  <select
                    value={editingOrder.sku}
                    onChange={(event) => setEditingOrder({ ...editingOrder, sku: event.target.value })}
                    className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none"
                  >
                    {products.map((product) => (
                      <option key={product.sku} value={product.sku}>
                        {product.name} ({product.sku})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="field-label">Quantity (kg)</span>
                  <input
                    type="number"
                    min="1"
                    step="0.5"
                    value={editingOrder.quantity}
                    onChange={(event) => setEditingOrder({ ...editingOrder, quantity: event.target.value })}
                    className="input mt-1"
                  />
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button type="button" className="btn btn-secondary" onClick={() => setEditingOrder(null)}>
                Cancel
              </button>
              <Can permission="orders:write" mode="disable">
                <button type="submit" className="btn btn-primary">
                  Save changes
                </button>
              </Can>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
