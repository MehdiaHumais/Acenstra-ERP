"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, FilePlus2, PackageCheck, X } from "lucide-react";
import { percent } from "@/lib/format";
import type { Product, Supplier } from "@/lib/types";
import { Can } from "@/components/access-gate";

export function SupplierActions({
  suppliers,
  products,
}: {
  suppliers: Supplier[];
  products: Product[];
}) {
  const router = useRouter();
  const [rfqOpen, setRfqOpen] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [supplierForm, setSupplierForm] = useState({
    name: "",
    country: "Italy",
    region: "Lombardia",
    category: "Produce",
    leadTimeDays: "2",
  });
  const [form, setForm] = useState({
    supplierId: String(suppliers[0]?.id ?? ""),
    productId: String(products[0]?.id ?? ""),
    quantity: "100",
    neededBy: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
  });

  const notify = (message: string) => {
    setFeedback(message);
    window.setTimeout(() => setFeedback(null), 4500);
  };

  const submitSupplier = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supplierForm.name.trim()) {
      notify("Please enter a supplier name.");
      return;
    }

    try {
      const res = await fetch("/api/v1/suppliers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `sup-${Date.now()}`,
        },
        body: JSON.stringify({
          action: "create_supplier",
          name: supplierForm.name.trim(),
          country: supplierForm.country,
          region: supplierForm.region,
          category: supplierForm.category,
          lead_time_days: Number(supplierForm.leadTimeDays) || 2,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify(data?.error?.message ?? "Unable to add supplier.");
        return;
      }
      notify(`Supplier "${supplierForm.name.trim()}" added successfully.`);
      setSupplierOpen(false);
      setSupplierForm({
        name: "",
        country: "Italy",
        region: "Lombardia",
        category: "Produce",
        leadTimeDays: "2",
      });
      router.refresh();
    } catch {
      notify("Network error while adding supplier.");
    }
  };

  const submitRfq = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const supplier = suppliers.find((item) => String(item.id) === form.supplierId) ?? suppliers[0];
    const product = products.find((item) => String(item.id) === form.productId) ?? products[0];
    const cases = Math.max(1, Math.round((Number(form.quantity) || 100) / 5));

    try {
      const res = await fetch("/api/v1/suppliers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `rfq-${Date.now()}`,
        },
        body: JSON.stringify({
          action: "create_po",
          supplier_id: supplier?.code ?? supplier?.name,
          sku: product?.sku,
          cases,
          expected_date: form.neededBy,
          mode: "po",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify(data?.error?.message ?? "Unable to submit RFQ/PO.");
        return;
      }
      const poNumber = data?.purchase_order?.po_number ?? "PO";
      notify(
        `${poNumber} issued to ${supplier?.name ?? "supplier"} for ${form.quantity} kg (${cases} cases) of ${product?.name ?? "product"} (expected ${form.neededBy}).`,
      );
      setRfqOpen(false);
      router.refresh();
    } catch {
      notify("Network error while submitting RFQ/PO.");
    }
  };

  const exportScorecard = () => {
    const header = ["Code", "Supplier", "Country", "Category", "OTD %", "Quality", "Lead time days", "Open orders", "Price variance %", "Status"];
    const rows = suppliers.map((supplier) => [
      supplier.code,
      supplier.name,
      supplier.country,
      supplier.category,
      supplier.on_time_rate,
      supplier.quality_score,
      supplier.lead_time_days,
      supplier.open_orders,
      supplier.price_variance,
      supplier.status,
    ]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "ascentra-supplier-scorecard.csv";
    link.click();
    URL.revokeObjectURL(url);
    notify("Supplier scorecard exported as CSV.");
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Can permission="suppliers:read" mode="disable">
          <button type="button" className="btn btn-secondary" onClick={exportScorecard}>
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        </Can>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setSupplierOpen(true)}
        >
          <FilePlus2 className="h-3.5 w-3.5" /> + Add supplier
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={suppliers.length === 0 || products.length === 0}
          title={
            suppliers.length === 0 || products.length === 0
              ? "Add a supplier and product before raising an RFQ"
              : "Raise a request for quotation"
          }
          onClick={() => setRfqOpen(true)}
        >
          <FilePlus2 className="h-3.5 w-3.5" /> New RFQ
        </button>
      </div>

      {feedback && (
        <div className="fixed bottom-5 right-5 z-[80] max-w-sm rounded-xl border border-marine-ocean/60 bg-white px-4 py-3 text-xs font-medium text-marine-mid/90 shadow-xl">
          <span className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {feedback}
          </span>
        </div>
      )}

      {supplierOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={submitSupplier} className="w-full max-w-md rounded-xl border border-border bg-card text-left shadow-xl">
            <div className="flex items-start justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold">Add food supplier</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Register a producer or distributor for procurement and traceability.
                </p>
              </div>
              <button type="button" aria-label="Close" className="btn btn-ghost btn-sm" onClick={() => setSupplierOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <label className="block">
                <span className="field-label">Supplier company name *</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. Azienda Agricola BioVerde"
                  value={supplierForm.name}
                  onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
                  className="input mt-1"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="field-label">Category</span>
                  <select
                    value={supplierForm.category}
                    onChange={(e) => setSupplierForm({ ...supplierForm, category: e.target.value })}
                    className="input mt-1"
                  >
                    <option value="Produce">Produce / Fruit & Veg</option>
                    <option value="Dairy & Cheese">Dairy & Cheese</option>
                    <option value="Meat & Charcuterie">Meat & Charcuterie</option>
                    <option value="Bakery & Pasta">Bakery & Pasta</option>
                    <option value="Beverages & Wine">Beverages & Wine</option>
                    <option value="Frozen">Frozen Foods</option>
                    <option value="Dry Goods">Dry Goods & Pantry</option>
                  </select>
                </label>
                <label className="block">
                  <span className="field-label">Lead time (days)</span>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={supplierForm.leadTimeDays}
                    onChange={(e) => setSupplierForm({ ...supplierForm, leadTimeDays: e.target.value })}
                    className="input mt-1"
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="field-label">Region</span>
                  <input
                    type="text"
                    placeholder="e.g. Emilia-Romagna"
                    value={supplierForm.region}
                    onChange={(e) => setSupplierForm({ ...supplierForm, region: e.target.value })}
                    className="input mt-1"
                  />
                </label>
                <label className="block">
                  <span className="field-label">Country</span>
                  <input
                    type="text"
                    placeholder="e.g. Italy"
                    value={supplierForm.country}
                    onChange={(e) => setSupplierForm({ ...supplierForm, country: e.target.value })}
                    className="input mt-1"
                  />
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button type="button" className="btn btn-secondary" onClick={() => setSupplierOpen(false)}>
                Cancel
              </button>
              <Can permission="suppliers:write" mode="disable">
                <button type="submit" className="btn btn-primary">
                  Save supplier
                </button>
              </Can>
            </div>
          </form>
        </div>
      )}

      {rfqOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={submitRfq} className="w-full max-w-md rounded-xl border border-border bg-card text-left shadow-xl">
            <div className="flex items-start justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold">Request for quotation</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  RFQ records the target price, quality evidence and required date.
                </p>
              </div>
              <button type="button" aria-label="Close" className="btn btn-ghost btn-sm" onClick={() => setRfqOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <label className="block">
                <span className="field-label">Supplier</span>
                <select
                  value={form.supplierId}
                  onChange={(event) => setForm({ ...form, supplierId: event.target.value })}
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none"
                >
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name} · OTD {percent(supplier.on_time_rate)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="field-label">Product</span>
                <select
                  value={form.productId}
                  onChange={(event) => setForm({ ...form, productId: event.target.value })}
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none"
                >
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} · {product.sku}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="field-label">Quantity (kg)</span>
                  <input
                    type="number"
                    min="1"
                    value={form.quantity}
                    onChange={(event) => setForm({ ...form, quantity: event.target.value })}
                    className="input mt-1"
                  />
                </label>
                <label className="block">
                  <span className="field-label">Needed by</span>
                  <input
                    type="date"
                    value={form.neededBy}
                    onChange={(event) => setForm({ ...form, neededBy: event.target.value })}
                    className="input mt-1"
                  />
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button type="button" className="btn btn-secondary" onClick={() => setRfqOpen(false)}>
                Cancel
              </button>
              <Can permission="suppliers:write" mode="disable">
                <button type="submit" className="btn btn-primary">
                  Send RFQ
                </button>
              </Can>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

export function ReceivePoButton({ poNumber, status }: { poNumber: string; status: string }) {
  const router = useRouter();
  const [received, setReceived] = useState(status === "received");
  const [loading, setLoading] = useState(false);

  if (received) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-marine-mid">
        <CheckCircle2 className="h-3.5 w-3.5" /> Received
      </span>
    );
  }

  const handleReceive = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/suppliers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `rcv-${poNumber}`,
        },
        body: JSON.stringify({
          action: "receive_po",
          po_number: poNumber,
          temp_c: 2.3,
        }),
      });
      if (res.ok) {
        setReceived(true);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Can permission="procurement:receive" mode="disable">
      <button
        type="button"
        disabled={loading}
        onClick={handleReceive}
        className="btn btn-secondary btn-sm"
      >
        <PackageCheck className="h-3.5 w-3.5" /> {loading ? "Receiving..." : "Receive PO"}
      </button>
    </Can>
  );
}
