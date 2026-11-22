"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Download,
  FileCheck2,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { Badge, statusTone } from "@/components/ui";
import { Can } from "@/components/access-gate";
import { cn, money, number, titleCase } from "@/lib/format";
import { TablePagination, TableToolbar } from "@/components/data-table";
import {
  BASE_UOMS,
  CERTIFICATE_TYPES,
  CURRENCIES,
  DIET_FLAGS,
  EU_ALLERGENS,
  HANDLING_ATTRIBUTES,
  PACK_UOMS,
  PRICE_TYPES,
  PRODUCT_CATEGORIES,
  TEMPERATURE_PROFILES,
  describePack,
  isCatchWeightCategory,
  temperatureProfileFor,
} from "@/lib/product-master";
import type {
  Product,
  ProductCertificate,
  ProductDetail,
  ProductPrice,
  Supplier,
} from "@/lib/types";

interface CertificateDraft {
  type: string;
  number: string;
  issuer: string;
  validFrom: string;
  validTo: string;
}

interface ProductForm {
  sku: string;
  name: string;
  category: string;
  brand: string;
  origin: string;
  description: string;
  hsCode: string;
  status: string;
  baseUom: string;
  packUom: string;
  unitsPerCase: string;
  unitWeightKg: string;
  caseWeightKg: string;
  catchWeight: boolean;
  catchMinKg: string;
  catchMaxKg: string;
  tareKg: string;
  allergens: string[];
  mayContain: string[];
  handling: string[];
  dietFlags: string[];
  tempZone: string;
  tempMinC: string;
  tempMaxC: string;
  shelfLifeDays: string;
  minShelfLifeDays: string;
  supplier: string;
  supplierSku: string;
  leadTimeDays: string;
  moqCases: string;
  costPrice: string;
  listPrice: string;
  vatRate: string;
  currency: string;
  certificates: CertificateDraft[];
}

const today = () => new Date().toISOString().slice(0, 10);

function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

const emptyCertificate: CertificateDraft = {
  type: "HACCP",
  number: "",
  issuer: "",
  validFrom: today(),
  validTo: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
};

const emptyForm: ProductForm = {
  sku: "",
  name: "",
  category: "Produce",
  brand: "",
  origin: "Italy",
  description: "",
  hsCode: "",
  status: "active",
  baseUom: "kg",
  packUom: "Case",
  unitsPerCase: "1",
  unitWeightKg: "5",
  caseWeightKg: "5",
  catchWeight: false,
  catchMinKg: "",
  catchMaxKg: "",
  tareKg: "0",
  allergens: [],
  mayContain: [],
  handling: ["Keep refrigerated"],
  dietFlags: [],
  tempZone: "Chilled 0–4°C",
  tempMinC: "0",
  tempMaxC: "4",
  shelfLifeDays: "14",
  minShelfLifeDays: "5",
  supplier: "",
  supplierSku: "",
  leadTimeDays: "2",
  moqCases: "1",
  costPrice: "7.50",
  listPrice: "10.00",
  vatRate: "4",
  currency: "EUR",
  certificates: [],
};

function productToForm(product: Product): ProductForm {
  return {
    sku: product.sku,
    name: product.name,
    category: product.category,
    brand: product.brand ?? "",
    origin: product.origin ?? "",
    description: product.description ?? "",
    hsCode: product.hs_code ?? "",
    status: product.status,
    baseUom: product.base_uom ?? (product.catch_weight ? "kg" : "case"),
    packUom: product.pack_uom ?? "Case",
    unitsPerCase: String(product.units_per_case ?? 1),
    unitWeightKg: String(product.unit_weight_kg ?? 0),
    caseWeightKg: String(product.case_weight_kg ?? 0),
    catchWeight: product.catch_weight,
    catchMinKg:
      product.catch_weight_min_kg != null ? String(product.catch_weight_min_kg) : "",
    catchMaxKg:
      product.catch_weight_max_kg != null ? String(product.catch_weight_max_kg) : "",
    tareKg: String(product.tare_weight_kg ?? 0),
    allergens: product.allergens,
    mayContain: product.may_contain ?? [],
    handling: product.handling ?? [],
    dietFlags: product.diet_flags ?? [],
    tempZone: product.temperature_profile,
    tempMinC: String(product.temp_min_c ?? temperatureProfileFor(product.temperature_profile).minC),
    tempMaxC: String(product.temp_max_c ?? temperatureProfileFor(product.temperature_profile).maxC),
    shelfLifeDays: String(product.shelf_life_days),
    minShelfLifeDays: String(product.min_shelf_life_days),
    supplier: product.supplier_name === "Unassigned" ? "" : product.supplier_name,
    supplierSku: product.supplier_sku ?? "",
    leadTimeDays: "2",
    moqCases: "1",
    costPrice:
      product.cost_price_cents != null
        ? (product.cost_price_cents / 100).toFixed(2)
        : "",
    listPrice: (product.unit_price_cents / 100).toFixed(2),
    vatRate: String(product.vat_rate_pct ?? 4),
    currency: product.currency ?? "EUR",
    certificates: [],
  };
}

function suggestSku(form: ProductForm, count: number): string {
  const category = form.category.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase() || "PRD";
  const name = form.name.replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase() || "ITEM";
  const sequence = String(count + 101).padStart(3, "0");
  return `SKU-${category}-${name}-${sequence}`;
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border px-5 py-4 first:border-t-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-primary">
        {title}
      </h3>
      {description && <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function CheckboxGrid({
  options,
  selected,
  onChange,
}: {
  options: readonly string[];
  selected: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
      {options.map((option) => (
        <label key={option} className="flex items-start gap-2 text-xs leading-5">
          <input
            type="checkbox"
            checked={selected.includes(option)}
            onChange={() => onChange(option)}
            className="mt-1 h-3.5 w-3.5 shrink-0 rounded border-input"
          />
          <span className="min-w-0 break-words">{option}</span>
        </label>
      ))}
    </div>
  );
}

function TagList({
  values,
  tone,
  emptyLabel,
}: {
  values: string[];
  tone: "ok" | "warning" | "critical" | "neutral" | "info";
  emptyLabel: string;
}) {
  if (values.length === 0) {
    return <span className="text-[11px] text-muted-foreground">{emptyLabel}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((value) => (
        <Badge key={value} tone={tone}>
          {value}
        </Badge>
      ))}
    </div>
  );
}

export function ProductsTable({
  products,
  suppliers,
}: {
  products: Product[];
  suppliers: Supplier[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<Product[]>(products);
  // Keep the table in sync with the server-provided list (e.g. after a
  // product is created via the barcode scan flow and router.refresh() runs).
  useEffect(() => {
    setItems(products);
  }, [products]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [addingCertificate, setAddingCertificate] = useState(false);
  const [certificateDraft, setCertificateDraft] = useState<CertificateDraft>(emptyCertificate);
  const [addingPrice, setAddingPrice] = useState(false);
  const [priceDraft, setPriceDraft] = useState({
    priceType: "contract",
    amount: "",
    currency: "EUR",
    uom: "Case",
    segment: "",
    effectiveFrom: today(),
    effectiveTo: "",
  });

  const [productTab, setProductTab] = useState<"active" | "deleted">("active");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const activeProductCount = items.filter((p) => p.status !== "discontinued").length;
  const deletedProductCount = items.filter((p) => p.status === "discontinued").length;

  const categories = Array.from(new Set(items.map((product) => product.category))).sort();

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter((product) => {
      const categoryMatch = category === "all" || product.category === category;
      const queryMatch =
        !term ||
        product.name.toLowerCase().includes(term) ||
        product.sku.toLowerCase().includes(term) ||
        product.supplier_name.toLowerCase().includes(term) ||
        (product.brand ?? "").toLowerCase().includes(term);
      const statusMatch =
        productTab === "deleted"
          ? product.status === "discontinued"
          : product.status !== "discontinued";
      return categoryMatch && queryMatch && statusMatch;
    });
  }, [category, items, query, productTab]);

  useEffect(() => {
    setPage(1);
  }, [query, category, productTab]);

  const pagedFiltered = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  );

  const packSummary = describePack(
    form.packUom,
    Number(form.unitsPerCase) || 1,
    Number(form.unitWeightKg) || 0,
    form.baseUom,
  );
  const margin =
    Number(form.listPrice) > 0
      ? ((Number(form.listPrice) - Number(form.costPrice)) / Number(form.listPrice)) * 100
      : 0;

  const notify = (message: string) => {
    setFeedback(message);
    window.setTimeout(() => setFeedback(null), 4500);
  };

  useEffect(() => {
    if (!selectedSku) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedSku(null);
    };
    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedSku]);

  const loadDetail = async (sku: string): Promise<ProductDetail | null> => {
    const res = await fetch(`/api/v1/products/${encodeURIComponent(sku)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as ProductDetail;
  };

  const openDetail = async (product: Product) => {
    setSelectedSku(product.sku);
    setDetail({ ...product, prices: [], certificates: [], suppliers: [] });
    setAddingCertificate(false);
    setAddingPrice(false);
    setDetailLoading(true);
    try {
      const loaded = await loadDetail(product.sku);
      if (loaded) setDetail(loaded);
    } catch {
      notify("Unable to load the full product record.");
    } finally {
      setDetailLoading(false);
    }
  };

  const replaceInItems = (updated: ProductDetail) => {
    setItems((current) => {
      const exists = current.some((item) => item.sku === updated.sku);
      const { prices: _prices, certificates: _certificates, suppliers: _suppliers, ...product } =
        updated;
      return exists
        ? current.map((item) => (item.sku === updated.sku ? product : item))
        : [product, ...current];
    });
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setFormOpen(true);
  };

  const openEdit = (product: Product) => {
    setEditing(product);
    setForm(productToForm(product));
    setSelectedSku(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    if (saving) return;
    setFormOpen(false);
    setEditing(null);
  };

  // "Delete" is a soft delete — the product becomes "discontinued" so order,
  // stock and audit history stays intact; it is hidden from new work.
  const deleteProduct = async () => {
    if (!detail || deleting) return;
    const ok = window.confirm(
      `Delete ${detail.name} (${detail.sku})?\n\nThis product is referenced by order, stock and audit history, so it will be marked "discontinued": hidden from new orders, picking and barcode assignment, but kept in history.`
    );
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/products/${encodeURIComponent(detail.sku)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Deleted by user from product catalog" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify(data?.error?.message ?? "Unable to delete the product.");
        return;
      }
      const updated = data as ProductDetail;
      replaceInItems(updated);
      setDetail(updated);
      notify(`${updated.name} moved to Deleted products (history).`);
    } catch {
      notify("Unable to delete the product.");
    } finally {
      setDeleting(false);
    }
  };

  const submitForm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.name.trim()) {
      notify("Product name is required.");
      return;
    }
    const sku = form.sku.trim().toUpperCase();
    if (!sku) {
      notify("Generate or enter a SKU before saving.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        sku,
        name: form.name.trim(),
        category: form.category,
        brand: form.brand.trim(),
        origin: form.origin.trim(),
        description: form.description.trim(),
        hs_code: form.hsCode.trim(),
        status: form.status,
        base_uom: form.baseUom,
        pack_uom: form.packUom,
        units_per_case: Number(form.unitsPerCase) || 1,
        unit_weight_kg: Number(form.unitWeightKg) || 0,
        case_weight_kg: Number(form.caseWeightKg) || 0,
        catch_weight: form.catchWeight,
        catch_weight_min_kg: Number(form.catchMinKg) || 0,
        catch_weight_max_kg: Number(form.catchMaxKg) || 0,
        tare_weight_kg: Number(form.tareKg) || 0,
        allergens: form.allergens,
        may_contain: form.mayContain,
        handling: form.handling,
        diet_flags: form.dietFlags,
        temperature_profile: form.tempZone,
        temp_min_c: Number(form.tempMinC),
        temp_max_c: Number(form.tempMaxC),
        shelf_life_days: Number(form.shelfLifeDays) || 1,
        min_shelf_life_days: Number(form.minShelfLifeDays) || 1,
        supplier_name: form.supplier.trim(),
        supplier_sku: form.supplierSku.trim(),
        lead_time_days: Number(form.leadTimeDays) || 1,
        moq_cases: Number(form.moqCases) || 1,
        unit_price_cents: Math.round((Number(form.listPrice) || 0) * 100),
        cost_price_cents: Math.round((Number(form.costPrice) || 0) * 100),
        vat_rate_pct: Number(form.vatRate) || 0,
        currency: form.currency,
        certificates: editing
          ? []
          : form.certificates.filter(
              (certificate) =>
                certificate.type &&
                certificate.number.trim() &&
                certificate.issuer.trim() &&
                certificate.validFrom &&
                certificate.validTo,
            ),
      };

      const res = await fetch(
        editing ? `/api/v1/products/${encodeURIComponent(editing.sku)}` : "/api/v1/products",
        {
          method: editing ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            // Stable idempotency key — identical submissions are deduped server-side.
            "Idempotency-Key": `prd-${editing ? "edit" : "new"}-${sku}-${djb2(JSON.stringify(payload))}`,
          },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        notify(data?.error?.message ?? "Unable to save the product.");
        return;
      }
      const saved = data as ProductDetail;
      replaceInItems(saved);
      setFormOpen(false);
      setEditing(null);
      notify(
        editing
          ? `${saved.name} updated with the latest master data.`
          : `${saved.name} created with SKU ${saved.sku}.`,
      );
      router.refresh();
      await openDetail(saved);
    } catch {
      notify("Network error while saving the product.");
    } finally {
      setSaving(false);
    }
  };

  const submitCertificate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail) return;
    try {
      const res = await fetch(
        `/api/v1/products/${encodeURIComponent(detail.sku)}/certificates`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": `cert-${detail.sku}-${Date.now()}`,
          },
          body: JSON.stringify({
            certificate_type: certificateDraft.type,
            certificate_number: certificateDraft.number.trim(),
            issuer: certificateDraft.issuer.trim(),
            valid_from: certificateDraft.validFrom,
            valid_to: certificateDraft.validTo,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        notify(data?.error?.message ?? "Unable to add the certificate.");
        return;
      }
      const created = data as ProductCertificate;
      setDetail((current) =>
        current
          ? {
              ...current,
              certificates: [...current.certificates, created],
              certificate_count: (current.certificate_count ?? 0) + 1,
            }
          : current,
      );
      setItems((current) =>
        current.map((item) =>
          item.sku === detail.sku
            ? {
                ...item,
                certificate_count: (item.certificate_count ?? 0) + 1,
                expiring_certificate_count:
                  created.status === "expiring" || created.status === "expired"
                    ? (item.expiring_certificate_count ?? 0) + 1
                    : item.expiring_certificate_count,
              }
            : item,
        ),
      );
      setAddingCertificate(false);
      setCertificateDraft(emptyCertificate);
      notify(`${created.certificate_type} certificate added.`);
      router.refresh();
    } catch {
      notify("Network error while adding the certificate.");
    }
  };

  const removeCertificate = async (certificate: ProductCertificate) => {
    if (!detail) return;
    try {
      const res = await fetch(
        `/api/v1/products/${encodeURIComponent(detail.sku)}/certificates/${encodeURIComponent(certificate.id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        notify("Unable to remove the certificate.");
        return;
      }
      setDetail((current) =>
        current
          ? {
              ...current,
              certificates: current.certificates.filter((item) => item.id !== certificate.id),
              certificate_count: Math.max(0, (current.certificate_count ?? 1) - 1),
            }
          : current,
      );
      notify("Certificate removed.");
      router.refresh();
    } catch {
      notify("Network error while removing the certificate.");
    }
  };

  const submitPrice = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail) return;
    const amount = Number(priceDraft.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      notify("Enter a valid price amount.");
      return;
    }
    try {
      const res = await fetch(`/api/v1/products/${encodeURIComponent(detail.sku)}/prices`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `price-${detail.sku}-${Date.now()}`,
        },
        body: JSON.stringify({
          price_type: priceDraft.priceType,
          amount_cents: Math.round(amount * 100),
          currency: priceDraft.currency,
          uom: priceDraft.uom,
          customer_segment: priceDraft.segment.trim() || null,
          effective_from: priceDraft.effectiveFrom,
          effective_to: priceDraft.effectiveTo || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify(data?.error?.message ?? "Unable to add the price.");
        return;
      }
      const created = data as ProductPrice;
      setDetail((current) =>
        current ? { ...current, prices: [created, ...current.prices] } : current,
      );
      setAddingPrice(false);
      setPriceDraft({
        priceType: "contract",
        amount: "",
        currency: "EUR",
        uom: "Case",
        segment: "",
        effectiveFrom: today(),
        effectiveTo: "",
      });
      notify(`${titleCase(created.price_type)} price added.`);
      router.refresh();
    } catch {
      notify("Network error while adding the price.");
    }
  };

  const removePrice = async (price: ProductPrice) => {
    if (!detail) return;
    try {
      const res = await fetch(
        `/api/v1/products/${encodeURIComponent(detail.sku)}/prices/${encodeURIComponent(price.id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        notify("Unable to remove the price.");
        return;
      }
      setDetail((current) =>
        current
          ? { ...current, prices: current.prices.filter((item) => item.id !== price.id) }
          : current,
      );
      notify("Price removed.");
      router.refresh();
    } catch {
      notify("Network error while removing the price.");
    }
  };

  const exportCsv = () => {
    const header = [
      "SKU",
      "Product",
      "Category",
      "Brand",
      "Origin",
      "Base UOM",
      "Pack UOM",
      "Units per case",
      "Unit weight kg",
      "Case weight kg",
      "Catch weight",
      "Catch min kg",
      "Catch max kg",
      "Tare kg",
      "Allergens",
      "May contain",
      "Handling",
      "Diet flags",
      "Temperature profile",
      "Temp min C",
      "Temp max C",
      "Shelf life days",
      "Min shelf life on pick",
      "Supplier",
      "Supplier SKU",
      "List price",
      "Cost price",
      "VAT %",
      "Currency",
      "Certificates",
      "Status",
    ];
    const rows = items.map((product) => [
      product.sku,
      product.name,
      product.category,
      product.brand ?? "",
      product.origin ?? "",
      product.base_uom ?? "",
      product.pack_uom ?? "",
      product.units_per_case ?? "",
      product.unit_weight_kg ?? "",
      product.case_weight_kg ?? "",
      product.catch_weight ? "Yes" : "No",
      product.catch_weight_min_kg ?? "",
      product.catch_weight_max_kg ?? "",
      product.tare_weight_kg ?? "",
      product.allergens.join(" | "),
      (product.may_contain ?? []).join(" | "),
      (product.handling ?? []).join(" | "),
      (product.diet_flags ?? []).join(" | "),
      product.temperature_profile,
      product.temp_min_c ?? "",
      product.temp_max_c ?? "",
      product.shelf_life_days,
      product.min_shelf_life_days,
      product.supplier_name,
      product.supplier_sku ?? "",
      (product.unit_price_cents / 100).toFixed(2),
      product.cost_price_cents != null ? (product.cost_price_cents / 100).toFixed(2) : "",
      product.vat_rate_pct ?? "",
      product.currency ?? "EUR",
      product.certificate_count ?? 0,
      product.status,
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "ascentra-product-master.csv";
    link.click();
    URL.revokeObjectURL(url);
    notify("Product master exported as CSV.");
  };

  return (
    <div>
      <div className="flex gap-1 border-b border-border px-4 pt-3">
        <button
          type="button"
          onClick={() => setProductTab("active")}
          className={cn(
            "flex items-center gap-2 rounded-t-lg px-4 py-2 text-xs font-semibold transition-all",
            productTab === "active"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Active products
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold">
            {activeProductCount}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setProductTab("deleted")}
          className={cn(
            "flex items-center gap-2 rounded-t-lg px-4 py-2 text-xs font-semibold transition-all",
            productTab === "deleted"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Deleted products (history)
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold">
            {deletedProductCount}
          </span>
        </button>
      </div>
      <TableToolbar
        count={filtered.length}
        countLabel={productTab === "deleted" ? "deleted products" : "products"}
        search={query}
        onSearchChange={setQuery}
        searchPlaceholder="Search SKU, product, brand or supplier"
        filters={
          <select
            id="product-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="h-8 rounded-lg border border-input bg-background px-2 text-xs outline-none"
          >
            <option value="all">All categories</option>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        }
        action={
          <>
            <Can permission="exports.run" mode="hide">
              <button type="button" className="btn btn-secondary btn-sm" onClick={exportCsv}>
                <Download className="h-3.5 w-3.5" /> Export
              </button>
            </Can>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={openCreate}
              data-testid="new-product"
            >
              <Plus className="h-3.5 w-3.5" /> New product
            </button>
          </>
        }
      />

      {feedback && (
        <div className="flex items-center gap-2 border-b border-marine-ocean/60 bg-marine-ocean/20 px-4 py-2 text-[11px] font-medium text-marine-mid/90">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {feedback}
        </div>
      )}

      <div className="table-shell">
        <table className="data-table">
          <thead>
            <tr>
              <th>Product / SKU</th>
              <th>Category</th>
              <th>Pack / UOM</th>
              <th>Catch weight</th>
              <th>Shelf life & temperature</th>
              <th>Allergens</th>
              <th>Supplier</th>
              <th className="text-right">Price</th>
              <th>Certificates</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {pagedFiltered.map((product) => (
              <tr
                key={product.sku}
                className="cursor-pointer"
                tabIndex={0}
                data-testid={`product-row-${product.sku}`}
                aria-label={`Open ${product.name} product details`}
                onClick={() => openDetail(product)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openDetail(product);
                  }
                }}
              >
                <td data-label="Product / SKU">
                  <p className="font-medium">{product.name}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    {product.sku}
                    {product.brand ? ` · ${product.brand}` : ""}
                  </p>
                </td>
                <td data-label="Category">{product.category}</td>
                <td data-label="Pack / UOM">
                  <p>{product.pack_size}</p>
                  {(product.unit_weight_kg ?? 0) > 0 && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {product.units_per_case ?? 1} ×{" "}
                      {number(product.unit_weight_kg ?? 0, 2)} {product.base_uom ?? "kg"}
                    </p>
                  )}
                </td>
                <td data-label="Catch weight">
                  {product.catch_weight ? (
                    <div>
                      <p className="font-medium">Yes · measured</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {number(product.catch_weight_min_kg ?? 0, 2)}–
                        {number(product.catch_weight_max_kg ?? 0, 2)} kg target
                      </p>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">No</span>
                  )}
                </td>
                <td data-label="Shelf life & temperature">
                  <p>{product.shelf_life_days} days</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    min {product.min_shelf_life_days} on pick · {product.temperature_profile}
                  </p>
                </td>
                <td data-label="Allergens">
                  {product.allergens.length === 0 ? (
                    <span className="text-muted-foreground">None declared</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {product.allergens.slice(0, 3).map((allergen) => (
                        <Badge key={allergen} tone="warning">
                          {allergen}
                        </Badge>
                      ))}
                      {product.allergens.length > 3 && (
                        <Badge tone="neutral">+{product.allergens.length - 3}</Badge>
                      )}
                    </div>
                  )}
                </td>
                <td data-label="Supplier">
                  <p>{product.supplier_name}</p>
                  {product.supplier_sku && (
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      {product.supplier_sku}
                    </p>
                  )}
                </td>
                <td data-label="Price" className="whitespace-nowrap text-right font-medium">
                  {money(product.unit_price_cents, true)}
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    {product.cost_price_cents != null
                      ? `cost ${money(product.cost_price_cents, true)}`
                      : "cost not set"}
                  </span>
                </td>
                <td data-label="Certificates">
                  {product.certificate_count ? (
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge tone="ok">{product.certificate_count} on file</Badge>
                      {Boolean(product.expiring_certificate_count) && (
                        <Badge tone="warning">
                          {product.expiring_certificate_count} expiring
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </td>
                <td data-label="Status">
                  <Badge tone={statusTone(product.status)} dot>
                    {titleCase(product.status)}
                  </Badge>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
                  {productTab === "deleted"
                    ? "No deleted products. Deleted products appear here so the active catalogue stays clean."
                    : "No products match the current filters. Create a product to start the master catalogue."}
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

      {formOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          role="presentation"
          onClick={closeForm}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-form-title"
            onSubmit={submitForm}
            onClick={(event) => event.stopPropagation()}
            data-testid="product-form"
            className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl sm:max-h-[90vh] sm:rounded-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h2 id="product-form-title" className="text-sm font-semibold">
                  {editing ? `Edit ${editing.name}` : "Create product"}
                </h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  SKU, pack conversion, catch-weight rules, allergens, handling, shelf life,
                  temperature, supplier, prices and certificates.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close product form"
                className="btn btn-ghost btn-sm shrink-0"
                onClick={closeForm}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="scrollbar-thin flex-1 overflow-y-auto">
              <FormSection title="Identity" description="Commercial identity and customs data.">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block sm:col-span-2">
                    <span className="field-label">Product name *</span>
                    <input
                      required
                      value={form.name}
                      onChange={(event) => setForm({ ...form, name: event.target.value })}
                      placeholder="e.g. Fresh chicken breast"
                      data-testid="product-name"
                      className="input mt-1"
                    />
                  </label>
                  <div>
                    <span className="field-label">SKU *</span>
                    <div className="mt-1 flex gap-2">
                      <input
                        required
                        value={form.sku}
                        onChange={(event) =>
                          setForm({ ...form, sku: event.target.value.toUpperCase() })
                        }
                        placeholder="SKU-..."
                        disabled={Boolean(editing)}
                        data-testid="product-sku"
                        className="input font-mono disabled:opacity-70"
                      />
                      {!editing && (
                        <button
                          type="button"
                          className="btn btn-secondary shrink-0"
                          onClick={() => setForm({ ...form, sku: suggestSku(form, items.length) })}
                        >
                          Generate
                        </button>
                      )}
                    </div>
                  </div>
                  <label className="block">
                    <span className="field-label">Category</span>
                    <select
                      value={form.category}
                      onChange={(event) => {
                        const nextCategory = event.target.value;
                        setForm({
                          ...form,
                          category: nextCategory,
                          catchWeight:
                            form.catchWeight || isCatchWeightCategory(nextCategory),
                        });
                      }}
                      data-testid="product-category"
                      className="input mt-1"
                    >
                      {PRODUCT_CATEGORIES.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="field-label">Brand</span>
                    <input
                      value={form.brand}
                      onChange={(event) => setForm({ ...form, brand: event.target.value })}
                      placeholder="Own label or producer brand"
                      className="input mt-1"
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">Country of origin</span>
                    <input
                      value={form.origin}
                      onChange={(event) => setForm({ ...form, origin: event.target.value })}
                      placeholder="e.g. Italy"
                      className="input mt-1"
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">HS customs code</span>
                    <input
                      value={form.hsCode}
                      onChange={(event) => setForm({ ...form, hsCode: event.target.value })}
                      placeholder="e.g. 0302.14.00"
                      className="input mt-1"
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">Status</span>
                    <select
                      value={form.status}
                      onChange={(event) => setForm({ ...form, status: event.target.value })}
                      className="input mt-1"
                    >
                      <option value="active">Active</option>
                      <option value="hold">Hold</option>
                      <option value="discontinued">Discontinued</option>
                    </select>
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="field-label">Description</span>
                    <textarea
                      value={form.description}
                      onChange={(event) => setForm({ ...form, description: event.target.value })}
                      placeholder="Cut, grade, packaging and handling notes"
                      rows={2}
                      className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none"
                    />
                  </label>
                </div>
              </FormSection>

              <FormSection
                title="Pack and UOM conversion"
                description="Base unit, selling pack and the conversion used by receiving, picking and pricing."
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className="field-label">Base UOM</span>
                    <select
                      value={form.baseUom}
                      onChange={(event) => setForm({ ...form, baseUom: event.target.value })}
                      className="input mt-1"
                    >
                      {BASE_UOMS.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="field-label">Pack UOM</span>
                    <select
                      value={form.packUom}
                      onChange={(event) => setForm({ ...form, packUom: event.target.value })}
                      className="input mt-1"
                    >
                      {PACK_UOMS.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="field-label">Units per pack</span>
                    <input
                      type="number"
                      min="1"
                      value={form.unitsPerCase}
                      onChange={(event) => setForm({ ...form, unitsPerCase: event.target.value })}
                      data-testid="units-per-case"
                      className="input mt-1"
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">Unit weight ({form.baseUom})</span>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={form.unitWeightKg}
                      onChange={(event) => setForm({ ...form, unitWeightKg: event.target.value })}
                      data-testid="unit-weight"
                      className="input mt-1"
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">Pack weight ({form.baseUom})</span>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={form.caseWeightKg}
                      onChange={(event) => setForm({ ...form, caseWeightKg: event.target.value })}
                      data-testid="case-weight"
                      className="input mt-1"
                    />
                  </label>
                  <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs sm:col-span-3">
                    <span className="field-label">Conversion</span>
                    <p className="mt-1 font-medium">{packSummary}</p>
                  </div>
                </div>
              </FormSection>

              <FormSection
                title="Catch-weight rules"
                description="Catch-weight items are weighed at receipt and pick; prices are derived from the measured weight."
              >
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={form.catchWeight}
                    onChange={(event) => setForm({ ...form, catchWeight: event.target.checked })}
                    data-testid="catch-weight"
                    className="h-4 w-4 rounded border-input"
                  />
                  Catch-weight product (measured weight controls stock and price)
                </label>
                {form.catchWeight ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <label className="block">
                      <span className="field-label">Minimum weight (kg)</span>
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={form.catchMinKg}
                        onChange={(event) => setForm({ ...form, catchMinKg: event.target.value })}
                        data-testid="catch-min"
                        className="input mt-1"
                      />
                    </label>
                    <label className="block">
                      <span className="field-label">Maximum weight (kg)</span>
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={form.catchMaxKg}
                        onChange={(event) => setForm({ ...form, catchMaxKg: event.target.value })}
                        data-testid="catch-max"
                        className="input mt-1"
                      />
                    </label>
                    <label className="block">
                      <span className="field-label">Tare weight (kg)</span>
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={form.tareKg}
                        onChange={(event) => setForm({ ...form, tareKg: event.target.value })}
                        data-testid="tare-weight"
                        className="input mt-1"
                      />
                    </label>
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Fixed-pack item: stock is counted in packs and no weight capture is required.
                  </p>
                )}
              </FormSection>

              <FormSection
                title="Allergens and handling attributes"
                description="EU 14 allergens, may-contain declarations, handling controls and diet claims."
              >
                <div className="space-y-4">
                  <div>
                    <p className="field-label mb-2">Contains allergens</p>
                    <CheckboxGrid
                      options={EU_ALLERGENS}
                      selected={form.allergens}
                      onChange={(value) =>
                        setForm({ ...form, allergens: toggle(form.allergens, value) })
                      }
                    />
                  </div>
                  <div>
                    <p className="field-label mb-2">May contain</p>
                    <CheckboxGrid
                      options={EU_ALLERGENS}
                      selected={form.mayContain}
                      onChange={(value) =>
                        setForm({ ...form, mayContain: toggle(form.mayContain, value) })
                      }
                    />
                  </div>
                  <div>
                    <p className="field-label mb-2">Handling attributes</p>
                    <CheckboxGrid
                      options={HANDLING_ATTRIBUTES}
                      selected={form.handling}
                      onChange={(value) =>
                        setForm({ ...form, handling: toggle(form.handling, value) })
                      }
                    />
                  </div>
                  <div>
                    <p className="field-label mb-2">Diet and sourcing claims</p>
                    <CheckboxGrid
                      options={DIET_FLAGS}
                      selected={form.dietFlags}
                      onChange={(value) =>
                        setForm({ ...form, dietFlags: toggle(form.dietFlags, value) })
                      }
                    />
                  </div>
                </div>
              </FormSection>

              <FormSection
                title="Shelf life and temperature profile"
                description="Drives FEFO eligibility, minimum remaining shelf life on pick and cold-chain checks."
              >
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="block">
                    <span className="field-label">Shelf life (days)</span>
                    <input
                      type="number"
                      min="1"
                      value={form.shelfLifeDays}
                      onChange={(event) => setForm({ ...form, shelfLifeDays: event.target.value })}
                      data-testid="shelf-life"
                      className="input mt-1"
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">Minimum on pick (days)</span>
                    <input
                      type="number"
                      min="1"
                      value={form.minShelfLifeDays}
                      onChange={(event) =>
                        setForm({ ...form, minShelfLifeDays: event.target.value })
                      }
                      data-testid="min-shelf-life"
                      className="input mt-1"
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="field-label">Temperature profile</span>
                    <select
                      value={form.tempZone}
                      onChange={(event) => {
                        const profile = temperatureProfileFor(event.target.value);
                        setForm({
                          ...form,
                          tempZone: event.target.value,
                          tempMinC: String(profile.minC),
                          tempMaxC: String(profile.maxC),
                        });
                      }}
                      data-testid="temp-profile"
                      className="input mt-1"
                    >
                      {TEMPERATURE_PROFILES.map((profile) => (
                        <option key={profile.label}>{profile.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="field-label">Minimum °C</span>
                    <input
                      type="number"
                      step="0.1"
                      value={form.tempMinC}
                      onChange={(event) => setForm({ ...form, tempMinC: event.target.value })}
                      className="input mt-1"
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">Maximum °C</span>
                    <input
                      type="number"
                      step="0.1"
                      value={form.tempMaxC}
                      onChange={(event) => setForm({ ...form, tempMaxC: event.target.value })}
                      className="input mt-1"
                    />
                  </label>
                </div>
              </FormSection>

              <FormSection
                title="Supplier and pricing"
                description="Primary supplier, supplier SKU, lead time, MOQ, cost and selling price."
              >
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="block">
                    <span className="field-label">Primary supplier</span>
                    <input
                      value={form.supplier}
                      onChange={(event) => setForm({ ...form, supplier: event.target.value })}
                      placeholder="Supplier company name"
                      list="product-supplier-options"
                      data-testid="product-supplier"
                      className="input mt-1"
                    />
                    <datalist id="product-supplier-options">
                      {suppliers.map((supplier) => (
                        <option key={supplier.id} value={supplier.name} />
                      ))}
                    </datalist>
                  </label>
                  <label className="block">
                    <span className="field-label">Supplier SKU</span>
                    <input
                      value={form.supplierSku}
                      onChange={(event) => setForm({ ...form, supplierSku: event.target.value })}
                      placeholder="Supplier item reference"
                      data-testid="supplier-sku"
                      className="input mt-1 font-mono"
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">Lead time (days)</span>
                    <input
                      type="number"
                      min="1"
                      value={form.leadTimeDays}
                      onChange={(event) => setForm({ ...form, leadTimeDays: event.target.value })}
                      className="input mt-1"
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">MOQ (packs)</span>
                    <input
                      type="number"
                      min="1"
                      value={form.moqCases}
                      onChange={(event) => setForm({ ...form, moqCases: event.target.value })}
                      className="input mt-1"
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">Cost price</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.costPrice}
                      onChange={(event) => setForm({ ...form, costPrice: event.target.value })}
                      data-testid="cost-price"
                      className="input mt-1"
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">List price</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.listPrice}
                      onChange={(event) => setForm({ ...form, listPrice: event.target.value })}
                      data-testid="list-price"
                      className="input mt-1"
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">VAT %</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={form.vatRate}
                      onChange={(event) => setForm({ ...form, vatRate: event.target.value })}
                      className="input mt-1"
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">Currency</span>
                    <select
                      value={form.currency}
                      onChange={(event) => setForm({ ...form, currency: event.target.value })}
                      className="input mt-1"
                    >
                      {CURRENCIES.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
                    <span className="field-label">Gross margin</span>
                    <p className="mt-1 font-medium">
                      {Number.isFinite(margin) ? `${margin.toFixed(1)}%` : "—"}
                    </p>
                  </div>
                </div>
              </FormSection>

              <FormSection
                title="Certificates"
                description={
                  editing
                    ? "Certificates are managed from the product detail popup after saving."
                    : "Attach compliance and provenance certificates to this product."
                }
              >
                {editing ? (
                  <p className="text-[11px] text-muted-foreground">
                    Open the product detail popup to add or remove certificates.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {form.certificates.map((certificate, index) => (
                      <div
                        key={index}
                        className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-2 lg:grid-cols-5"
                      >
                        <label className="block">
                          <span className="field-label">Type</span>
                          <select
                            value={certificate.type}
                            onChange={(event) => {
                              const next = [...form.certificates];
                              next[index] = { ...certificate, type: event.target.value };
                              setForm({ ...form, certificates: next });
                            }}
                            className="input mt-1"
                          >
                            {CERTIFICATE_TYPES.map((item) => (
                              <option key={item}>{item}</option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="field-label">Number</span>
                          <input
                            value={certificate.number}
                            onChange={(event) => {
                              const next = [...form.certificates];
                              next[index] = { ...certificate, number: event.target.value };
                              setForm({ ...form, certificates: next });
                            }}
                            className="input mt-1"
                          />
                        </label>
                        <label className="block">
                          <span className="field-label">Issuer</span>
                          <input
                            value={certificate.issuer}
                            onChange={(event) => {
                              const next = [...form.certificates];
                              next[index] = { ...certificate, issuer: event.target.value };
                              setForm({ ...form, certificates: next });
                            }}
                            className="input mt-1"
                          />
                        </label>
                        <label className="block">
                          <span className="field-label">Valid from</span>
                          <input
                            type="date"
                            value={certificate.validFrom}
                            onChange={(event) => {
                              const next = [...form.certificates];
                              next[index] = { ...certificate, validFrom: event.target.value };
                              setForm({ ...form, certificates: next });
                            }}
                            className="input mt-1"
                          />
                        </label>
                        <div className="flex items-end gap-2">
                          <label className="block flex-1">
                            <span className="field-label">Valid to</span>
                            <input
                              type="date"
                              value={certificate.validTo}
                              onChange={(event) => {
                                const next = [...form.certificates];
                                next[index] = { ...certificate, validTo: event.target.value };
                                setForm({ ...form, certificates: next });
                              }}
                              className="input mt-1"
                            />
                          </label>
                          <button
                            type="button"
                            aria-label="Remove certificate row"
                            className="btn btn-ghost btn-sm mb-0.5"
                            onClick={() =>
                              setForm({
                                ...form,
                                certificates: form.certificates.filter(
                                  (_, position) => position !== index,
                                ),
                              })
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() =>
                        setForm({
                          ...form,
                          certificates: [...form.certificates, { ...emptyCertificate }],
                        })
                      }
                    >
                      <Plus className="h-3.5 w-3.5" /> Add certificate
                    </button>
                  </div>
                )}
              </FormSection>
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-muted/20 px-5 py-3">
              <button type="button" className="btn btn-secondary" onClick={closeForm}>
                Cancel
              </button>
              <Can permission="products:write" mode="disable">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving}
                  data-testid="submit-product"
                >
                  {saving ? "Saving..." : editing ? "Save changes" : "Create product"}
                </button>
              </Can>
            </div>
          </form>
        </div>
      )}

      {selectedSku && detail && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          role="presentation"
          onClick={() => setSelectedSku(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-detail-title"
            data-testid="product-detail"
            className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl sm:max-h-[88vh] sm:rounded-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="product-detail-title" className="min-w-0 break-words text-sm font-semibold">
                    {detail.name}
                  </h2>
                  <Badge tone={statusTone(detail.status)} dot>
                    {titleCase(detail.status)}
                  </Badge>
                  {detail.catch_weight && <Badge tone="info">Catch weight</Badge>}
                </div>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">{detail.sku}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {detail.brand ? `${detail.brand} · ` : ""}
                  {detail.category} · {detail.origin}
                  {detailLoading ? " · loading full record..." : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm gap-1.5"
                  onClick={() => openEdit(detail)}
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm gap-1.5"
                  onClick={deleteProduct}
                  disabled={deleting || detail.status === "discontinued"}
                  title={
                    detail.status === "discontinued"
                      ? "Already discontinued"
                      : "Discontinue product — history is preserved"
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" /> {deleting ? "Deleting…" : "Delete"}
                </button>
                <button
                  type="button"
                  aria-label="Close product details"
                  className="btn btn-ghost btn-sm shrink-0"
                  onClick={() => setSelectedSku(null)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  {
                    label: "Pack / UOM",
                    value:
                      (detail.unit_weight_kg ?? 0) > 0
                        ? describePack(
                            detail.pack_uom ?? "Case",
                            detail.units_per_case ?? 1,
                            detail.unit_weight_kg ?? 0,
                            detail.base_uom ?? "kg",
                          )
                        : detail.pack_size,
                  },
                  {
                    label: "Pack weight",
                    value:
                      (detail.case_weight_kg ?? 0) > 0
                        ? `${number(detail.case_weight_kg ?? 0, 2)} ${detail.base_uom ?? "kg"}`
                        : "Not set",
                  },
                  {
                    label: "Shelf life",
                    value: `${detail.shelf_life_days} days · min ${detail.min_shelf_life_days} on pick`,
                  },
                  {
                    label: "Temperature",
                    value: `${detail.temperature_profile} (${number(detail.temp_min_c ?? 0, 1)}°C to ${number(detail.temp_max_c ?? 0, 1)}°C)`,
                  },
                  { label: "Supplier", value: detail.supplier_name },
                  {
                    label: "Supplier SKU",
                    value: detail.supplier_sku ?? "Not set",
                  },
                  {
                    label: "List price",
                    value: `${money(detail.unit_price_cents, true)} · VAT ${number(detail.vat_rate_pct ?? 0, 1)}%`,
                  },
                  {
                    label: "Cost price",
                    value:
                      detail.cost_price_cents != null
                        ? money(detail.cost_price_cents, true)
                        : "Not set",
                  },
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

              {detail.description && (
                <p className="mt-3 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground">
                  {detail.description}
                </p>
              )}

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="field-label mb-1.5">Contains allergens</p>
                  <TagList values={detail.allergens} tone="warning" emptyLabel="None declared" />
                </div>
                <div>
                  <p className="field-label mb-1.5">May contain</p>
                  <TagList
                    values={detail.may_contain ?? []}
                    tone="neutral"
                    emptyLabel="No may-contain declaration"
                  />
                </div>
                <div>
                  <p className="field-label mb-1.5">Handling attributes</p>
                  <TagList
                    values={detail.handling ?? []}
                    tone="info"
                    emptyLabel="No handling attributes"
                  />
                </div>
                <div>
                  <p className="field-label mb-1.5">Diet and sourcing claims</p>
                  <TagList
                    values={detail.diet_flags ?? []}
                    tone="ok"
                    emptyLabel="No diet claims"
                  />
                </div>
              </div>

              {detail.catch_weight && (
                <div className="mt-4 rounded-xl border border-border bg-muted/20 px-3 py-2 text-xs">
                  <span className="field-label">Catch-weight rule</span>
                  <p className="mt-1 font-medium">
                    Target {number(detail.catch_weight_min_kg ?? 0, 2)}–
                    {number(detail.catch_weight_max_kg ?? 0, 2)} kg · tare{" "}
                    {number(detail.tare_weight_kg ?? 0, 2)} kg
                  </p>
                </div>
              )}

              <section className="mt-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5" /> Certificates (
                    {detail.certificates.length})
                  </h3>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setAddingCertificate((value) => !value)}
                    data-testid="add-certificate"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add certificate
                  </button>
                </div>

                {addingCertificate && (
                  <form
                    onSubmit={submitCertificate}
                    data-testid="certificate-form"
                    className="mt-2 grid gap-2 rounded-xl border border-border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-5"
                  >
                    <label className="block">
                      <span className="field-label">Type</span>
                      <select
                        value={certificateDraft.type}
                        onChange={(event) =>
                          setCertificateDraft({ ...certificateDraft, type: event.target.value })
                        }
                        className="input mt-1"
                      >
                        {CERTIFICATE_TYPES.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="field-label">Number</span>
                      <input
                        required
                        value={certificateDraft.number}
                        onChange={(event) =>
                          setCertificateDraft({ ...certificateDraft, number: event.target.value })
                        }
                        data-testid="certificate-number"
                        className="input mt-1"
                      />
                    </label>
                    <label className="block">
                      <span className="field-label">Issuer</span>
                      <input
                        required
                        value={certificateDraft.issuer}
                        onChange={(event) =>
                          setCertificateDraft({ ...certificateDraft, issuer: event.target.value })
                        }
                        data-testid="certificate-issuer"
                        className="input mt-1"
                      />
                    </label>
                    <label className="block">
                      <span className="field-label">Valid from</span>
                      <input
                        required
                        type="date"
                        value={certificateDraft.validFrom}
                        onChange={(event) =>
                          setCertificateDraft({
                            ...certificateDraft,
                            validFrom: event.target.value,
                          })
                        }
                        className="input mt-1"
                      />
                    </label>
                    <div className="flex items-end gap-2">
                      <label className="block flex-1">
                        <span className="field-label">Valid to</span>
                        <input
                          required
                          type="date"
                          value={certificateDraft.validTo}
                          onChange={(event) =>
                            setCertificateDraft({
                              ...certificateDraft,
                              validTo: event.target.value,
                            })
                          }
                          className="input mt-1"
                        />
                      </label>
                      <Can permission="products:write" mode="disable">
                        <button
                          type="submit"
                          className="btn btn-primary btn-sm mb-0.5"
                          data-testid="submit-certificate"
                        >
                          Save
                        </button>
                      </Can>
                    </div>
                  </form>
                )}

                <div className="mt-2 overflow-hidden rounded-xl border border-border">
                  <div className="hidden grid-cols-12 gap-2 bg-muted/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:grid">
                    <span className="col-span-5">Certificate</span>
                    <span className="col-span-3">Issuer</span>
                    <span className="col-span-2">Valid until</span>
                    <span className="col-span-2 text-right">Status</span>
                  </div>
                  {detail.certificates.map((certificate) => (
                    <div
                      key={certificate.id}
                      className="grid grid-cols-1 gap-1.5 border-t border-border/70 px-3 py-2.5 text-sm sm:grid-cols-12 sm:items-center"
                    >
                      <div className="min-w-0 sm:col-span-5">
                        <p className="break-words font-medium">{certificate.certificate_type}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">
                          {certificate.certificate_number}
                        </p>
                      </div>
                      <div className="min-w-0 text-xs sm:col-span-3">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:hidden">
                          Issuer{" "}
                        </span>
                        {certificate.issuer}
                      </div>
                      <div className="min-w-0 text-xs sm:col-span-2">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:hidden">
                          Valid until{" "}
                        </span>
                        {certificate.valid_to}
                      </div>
                      <div className="flex items-center justify-between gap-2 sm:col-span-2 sm:justify-end">
                        <Badge tone={statusTone(certificate.status)}>
                          {titleCase(certificate.status)}
                        </Badge>
                        <Can permission="products:write" mode="hide">
                          <button
                            type="button"
                            aria-label={`Remove ${certificate.certificate_type} certificate`}
                            className="btn btn-ghost btn-sm"
                            onClick={() => removeCertificate(certificate)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </Can>
                      </div>
                    </div>
                  ))}
                  {detail.certificates.length === 0 && (
                    <p className="border-t border-border/70 px-3 py-5 text-center text-sm text-muted-foreground">
                      No certificates on file for this product.
                    </p>
                  )}
                </div>
              </section>

              <section className="mt-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    <FileCheck2 className="h-3.5 w-3.5" /> Prices ({detail.prices.length})
                  </h3>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setAddingPrice((value) => !value)}
                    data-testid="add-price"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add price
                  </button>
                </div>

                {addingPrice && (
                  <form
                    onSubmit={submitPrice}
                    data-testid="price-form"
                    className="mt-2 grid gap-2 rounded-xl border border-border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-4"
                  >
                    <label className="block">
                      <span className="field-label">Price type</span>
                      <select
                        value={priceDraft.priceType}
                        onChange={(event) =>
                          setPriceDraft({ ...priceDraft, priceType: event.target.value })
                        }
                        className="input mt-1"
                      >
                        {PRICE_TYPES.map((item) => (
                          <option key={item} value={item}>
                            {titleCase(item)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="field-label">Amount</span>
                      <input
                        required
                        type="number"
                        min="0"
                        step="0.01"
                        value={priceDraft.amount}
                        onChange={(event) =>
                          setPriceDraft({ ...priceDraft, amount: event.target.value })
                        }
                        data-testid="price-amount"
                        className="input mt-1"
                      />
                    </label>
                    <label className="block">
                      <span className="field-label">Currency</span>
                      <select
                        value={priceDraft.currency}
                        onChange={(event) =>
                          setPriceDraft({ ...priceDraft, currency: event.target.value })
                        }
                        className="input mt-1"
                      >
                        {CURRENCIES.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="field-label">Per UOM</span>
                      <input
                        value={priceDraft.uom}
                        onChange={(event) =>
                          setPriceDraft({ ...priceDraft, uom: event.target.value })
                        }
                        className="input mt-1"
                      />
                    </label>
                    <label className="block">
                      <span className="field-label">Customer segment</span>
                      <input
                        value={priceDraft.segment}
                        onChange={(event) =>
                          setPriceDraft({ ...priceDraft, segment: event.target.value })
                        }
                        placeholder="Optional"
                        className="input mt-1"
                      />
                    </label>
                    <label className="block">
                      <span className="field-label">Effective from</span>
                      <input
                        type="date"
                        value={priceDraft.effectiveFrom}
                        onChange={(event) =>
                          setPriceDraft({ ...priceDraft, effectiveFrom: event.target.value })
                        }
                        className="input mt-1"
                      />
                    </label>
                    <label className="block">
                      <span className="field-label">Effective to</span>
                      <input
                        type="date"
                        value={priceDraft.effectiveTo}
                        onChange={(event) =>
                          setPriceDraft({ ...priceDraft, effectiveTo: event.target.value })
                        }
                        className="input mt-1"
                      />
                    </label>
                    <div className="flex items-end">
                      <Can permission="products:write" mode="disable">
                        <button
                          type="submit"
                          className="btn btn-primary w-full"
                          data-testid="submit-price"
                        >
                          Save price
                        </button>
                      </Can>
                    </div>
                  </form>
                )}

                <div className="mt-2 overflow-hidden rounded-xl border border-border">
                  <div className="hidden grid-cols-12 gap-2 bg-muted/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:grid">
                    <span className="col-span-2">Type</span>
                    <span className="col-span-3">Amount</span>
                    <span className="col-span-2">UOM</span>
                    <span className="col-span-3">Effective</span>
                    <span className="col-span-2 text-right">Status</span>
                  </div>
                  {detail.prices.map((price) => (
                    <div
                      key={price.id}
                      className="grid grid-cols-1 gap-1.5 border-t border-border/70 px-3 py-2.5 text-sm sm:grid-cols-12 sm:items-center"
                    >
                      <div className="text-xs sm:col-span-2">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:hidden">
                          Type{" "}
                        </span>
                        {titleCase(price.price_type)}
                      </div>
                      <div className="font-medium sm:col-span-3">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:hidden">
                          Amount{" "}
                        </span>
                        {money(price.amount_cents, true)} {price.currency}
                      </div>
                      <div className="text-xs sm:col-span-2">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:hidden">
                          UOM{" "}
                        </span>
                        {price.uom}
                        {price.customer_segment ? ` · ${price.customer_segment}` : ""}
                      </div>
                      <div className="text-xs sm:col-span-3">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:hidden">
                          Effective{" "}
                        </span>
                        {price.effective_from}
                        {price.effective_to ? ` → ${price.effective_to}` : " → open"}
                      </div>
                      <div className="flex items-center justify-between gap-2 sm:col-span-2 sm:justify-end">
                        <Badge tone={statusTone(price.status)}>{titleCase(price.status)}</Badge>
                        <Can permission="products:write" mode="hide">
                          <button
                            type="button"
                            aria-label={`Remove ${price.price_type} price`}
                            className="btn btn-ghost btn-sm"
                            onClick={() => removePrice(price)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </Can>
                      </div>
                    </div>
                  ))}
                  {detail.prices.length === 0 && (
                    <p className="border-t border-border/70 px-3 py-5 text-center text-sm text-muted-foreground">
                      No price records for this product.
                    </p>
                  )}
                </div>
              </section>

              <section className="mt-5">
                <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Supplier links ({detail.suppliers.length})
                </h3>
                <div className="mt-2 overflow-hidden rounded-xl border border-border">
                  <div className="hidden grid-cols-12 gap-2 bg-muted/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:grid">
                    <span className="col-span-4">Supplier</span>
                    <span className="col-span-2">Supplier SKU</span>
                    <span className="col-span-2">Lead time</span>
                    <span className="col-span-2">MOQ</span>
                    <span className="col-span-2 text-right">Cost</span>
                  </div>
                  {detail.suppliers.map((supplier) => (
                    <div
                      key={`${supplier.supplier_id}-${supplier.supplier_name}`}
                      className="grid grid-cols-1 gap-1.5 border-t border-border/70 px-3 py-2.5 text-sm sm:grid-cols-12 sm:items-center"
                    >
                      <div className="min-w-0 sm:col-span-4">
                        <p className="break-words font-medium">{supplier.supplier_name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {supplier.is_primary ? "Primary" : "Alternative"} ·{" "}
                          {titleCase(supplier.status)}
                        </p>
                      </div>
                      <div className="font-mono text-[11px] sm:col-span-2">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:hidden">
                          Supplier SKU{" "}
                        </span>
                        {supplier.supplier_sku ?? "—"}
                      </div>
                      <div className="text-xs sm:col-span-2">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:hidden">
                          Lead time{" "}
                        </span>
                        {supplier.lead_time_days} days
                      </div>
                      <div className="text-xs sm:col-span-2">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:hidden">
                          MOQ{" "}
                        </span>
                        {supplier.moq_cases} packs
                      </div>
                      <div className="text-xs font-medium sm:col-span-2 sm:text-right">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:hidden">
                          Cost{" "}
                        </span>
                        {money(supplier.cost_price_cents, true)}
                      </div>
                    </div>
                  ))}
                  {detail.suppliers.length === 0 && (
                    <p className="border-t border-border/70 px-3 py-5 text-center text-sm text-muted-foreground">
                      No supplier link recorded. Edit the product to set a primary supplier.
                    </p>
                  )}
                </div>
              </section>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/20 px-5 py-3">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setSelectedSku(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
