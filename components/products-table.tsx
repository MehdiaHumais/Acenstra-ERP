"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  CheckCircle2,
  Download,
  FileCheck2,
  Image as ImageIcon,
  Link2,
  Loader2,
  PackageSearch,
  Pencil,
  Plus,
  RotateCcw,
  ScanLine,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
  XCircle,
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
import {
  decodeBarcodeFromFile,
  decodeBarcodeFromCanvas,
  validateDecodedBarcode,
  type BarcodeDecodeResult,
} from "@/lib/barcode-decode";
import {
  mapExternalProductToDraft,
  type ExternalProductPreviewLike,
} from "@/lib/product-barcode-draft";
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
  barcode: string;
  barcodeFormat: string;
  imageUrl: string;
  imageSource: string;
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
  barcode: "",
  barcodeFormat: "",
  imageUrl: "",
  imageSource: "",
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
    barcode: "",
    barcodeFormat: "",
    imageUrl: product.image_url ?? "",
    imageSource: product.image_source ?? "",
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
    <section className="border-t border-border px-4 py-4 first:border-t-0 sm:px-5">
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

  // Barcode photo flow — deliberately scoped to the Add Product form. It uses
  // the same ZXing decoder, lookup endpoint and barcode registry as the
  // existing Scan & Barcodes workbench.
  const barcodeVideoRef = useRef<HTMLVideoElement | null>(null);
  const barcodeStreamRef = useRef<MediaStream | null>(null);
  const [barcodeCaptureOpen, setBarcodeCaptureOpen] = useState(false);
  const [barcodeCameraActive, setBarcodeCameraActive] = useState(false);
  const [barcodeBusy, setBarcodeBusy] = useState(false);
  const [barcodeMessage, setBarcodeMessage] = useState<{
    tone: "idle" | "ok" | "error" | "warning" | "external";
    text: string;
  } | null>(null);
  // A captured frame is held here until the user explicitly confirms it. The
  // camera is stopped at capture time, so nothing is applied by accident.
  const [pendingBarcodeCapture, setPendingBarcodeCapture] = useState<{
    result: BarcodeDecodeResult;
    warning: string | null;
  } | null>(null);
  const [barcodeLookupState, setBarcodeLookupState] = useState<
    | "idle"
    | "looking"
    | "internal-found"
    | "external-found"
    | "not-found"
    | "unavailable"
    | "error"
  >("idle");
  const [existingProduct, setExistingProduct] = useState<Product | null>(null);
  const [externalPreview, setExternalPreview] = useState<ExternalProductPreviewLike | null>(null);
  const [associateSku, setAssociateSku] = useState("");
  const [associateBusy, setAssociateBusy] = useState(false);

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

  const resetBarcodeFlow = () => {
    stopBarcodeCamera();
    setBarcodeCaptureOpen(false);
    setBarcodeBusy(false);
    setBarcodeMessage(null);
    setPendingBarcodeCapture(null);
    setBarcodeLookupState("idle");
    setExistingProduct(null);
    setExternalPreview(null);
    setAssociateSku("");
    setAssociateBusy(false);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    resetBarcodeFlow();
    setFormOpen(true);
  };

  const openEdit = (product: Product) => {
    setEditing(product);
    setForm(productToForm(product));
    resetBarcodeFlow();
    setSelectedSku(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    if (saving) return;
    setFormOpen(false);
    setEditing(null);
    resetBarcodeFlow();
  };

  function stopBarcodeTracks() {
    const stream = barcodeStreamRef.current;
    stream?.getTracks().forEach((track) => track.stop());
    if (barcodeVideoRef.current) barcodeVideoRef.current.srcObject = null;
    barcodeStreamRef.current = null;
  }

  function stopBarcodeCamera() {
    stopBarcodeTracks();
    setBarcodeCameraActive(false);
  }

  // Attach the stream after the video element mounts, and always stop tracks
  // when the camera panel or form is closed.
  useEffect(() => {
    if (!barcodeCameraActive || !barcodeCaptureOpen) return;
    const video = barcodeVideoRef.current;
    const stream = barcodeStreamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
  }, [barcodeCameraActive, barcodeCaptureOpen]);

  useEffect(() => () => stopBarcodeTracks(), []);

  // A catalogue tab change must never leave a stream running or an unreviewed
  // frame waiting to be applied to a different product.
  useEffect(() => {
    stopBarcodeTracks();
    setBarcodeCameraActive(false);
    setBarcodeCaptureOpen(false);
    setPendingBarcodeCapture(null);
    setBarcodeBusy(false);
  }, [productTab]);

  async function startBarcodeCamera() {
    setBarcodeMessage(null);
    setPendingBarcodeCapture(null);
    // Never stack streams if a retry is triggered while one is already live.
    stopBarcodeTracks();
    setBarcodeCameraActive(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setBarcodeMessage({
        tone: "error",
        text: "Camera is not available in this browser. Upload a barcode photo or enter the number manually.",
      });
      return;
    }
    if (!window.isSecureContext && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      setBarcodeMessage({
        tone: "error",
        text: "Camera access requires HTTPS. Upload a barcode photo or enter the number manually instead.",
      });
      return;
    }
    setBarcodeCaptureOpen(true);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      barcodeStreamRef.current = media;
      setBarcodeCameraActive(true);
      setBarcodeMessage({
        tone: "idle",
        text: "Rear camera active. Fill the frame with the barcode, then take the photo.",
      });
    } catch (error) {
      const denied = (error as DOMException)?.name === "NotAllowedError";
      setBarcodeMessage({
        tone: "error",
        text: denied
          ? "Camera permission was denied. Allow camera access, upload a barcode photo, or enter the number manually."
          : "Camera could not start. Upload a barcode photo or enter the number manually.",
      });
    }
  }

  async function runBarcodeLookup(rawBarcode: string, format?: string): Promise<boolean> {
    const candidate = validateDecodedBarcode(rawBarcode, format);
    if (!candidate.ok) {
      setBarcodeLookupState("error");
      setExistingProduct(null);
      setBarcodeMessage({ tone: "error", text: candidate.error });
      return false;
    }
    setBarcodeLookupState("looking");
    setBarcodeMessage({ tone: "idle", text: `Looking up ${candidate.barcode}…` });
    try {
      const res = await fetch("/api/v1/products/barcode/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No `operation`: product master users should not need warehouse scan rights.
        body: JSON.stringify({ barcode: candidate.barcode, format: candidate.format }),
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBarcodeLookupState("error");
        setExistingProduct(null);
        setBarcodeMessage({
          tone: "error",
          text: body?.error?.message ?? "The barcode could not be validated.",
        });
        return false;
      }
      setForm((current) => ({
        ...current,
        barcode: candidate.barcode,
        barcodeFormat: candidate.format,
      }));

      if (body?.found && body?.product) {
        setBarcodeLookupState("internal-found");
        setExistingProduct(body.product as Product);
        setExternalPreview(null);
        setBarcodeMessage({
          tone: "warning",
          text: `Already in Ascentra: ${body.product.sku} — ${body.product.name}. Duplicate creation is blocked.`,
        });
        return false;
      }

      setExistingProduct(null);
      const preview =
        body?.external && typeof body.external === "object"
          ? (body.external as ExternalProductPreviewLike)
          : null;
      setExternalPreview(preview);
      const status = String(body?.external_status ?? "disabled");
      if (status === "found" && preview) {
        setBarcodeLookupState("external-found");
        if (!editing) {
          const draft = mapExternalProductToDraft(preview, candidate.barcode, candidate.format);
          setForm((current) => ({
            ...current,
            ...draft,
            sku: current.sku.trim() ? current.sku : draft.sku ?? current.sku,
            name: draft.name ?? current.name,
            category: draft.category ?? current.category,
          }));
          setBarcodeMessage({
            tone: "external",
            text: `${preview.attribution ?? "External catalogue"} preview loaded — review every field before creating. Commercial ERP fields still need your values.`,
          });
        } else {
          // Never overwrite verified ERP data while editing an existing product.
          setBarcodeMessage({
            tone: "external",
            text: "External preview only — existing product fields are not overwritten. Use Manage Barcodes to add this code to this product.",
          });
        }
        return true;
      }

      if (status === "not_found") {
        setBarcodeLookupState("not-found");
        setBarcodeMessage({
          tone: "warning",
          text: `Barcode ${candidate.barcode} is not in Ascentra or the external catalogue. You can still create the product manually or associate the barcode with an existing product.`,
        });
        return true;
      }

      setBarcodeLookupState("unavailable");
      setBarcodeMessage({
        tone: "warning",
        text:
          typeof body?.external_reason === "string" && body.external_reason
            ? `${body.external_reason} You can retry or continue with manual entry.`
            : "External product database is unavailable. You can retry or continue with manual entry.",
      });
      return true;
    } catch {
      setBarcodeLookupState("error");
      setExistingProduct(null);
      setBarcodeMessage({ tone: "error", text: "Network error while looking up the barcode." });
      return false;
    }
  }

  async function applyDecodedBarcode(decoded: BarcodeDecodeResult, warning?: string | null) {
    const candidate = validateDecodedBarcode(decoded.barcode, decoded.format);
    if (!candidate.ok) {
      setBarcodeMessage({ tone: "error", text: candidate.error });
      return;
    }
    setForm((current) => ({
      ...current,
      barcode: candidate.barcode,
      barcodeFormat: candidate.format,
    }));
    setExistingProduct(null);
    setExternalPreview(null);
    setBarcodeCaptureOpen(false);
    stopBarcodeCamera();
    if (warning) setBarcodeMessage({ tone: "warning", text: `${warning} Detected ${candidate.barcode}.` });
    await runBarcodeLookup(candidate.barcode, candidate.format);
  }

  async function captureBarcodePhoto() {
    const video = barcodeVideoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setBarcodeMessage({ tone: "error", text: "Camera preview is not ready. Try again." });
      return;
    }
    setBarcodeBusy(true);
    setBarcodeMessage({ tone: "idle", text: "Reading barcode from the photo…" });
    try {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const decoded = await decodeBarcodeFromCanvas(canvas);
      if (!decoded.ok) {
        setBarcodeMessage({ tone: "error", text: `${decoded.error} Retake with even lighting and no glare.` });
        return;
      }
      // Freeze the frame: stop the camera first, then hold the decode for review.
      stopBarcodeCamera();
      setBarcodeCaptureOpen(false);
      setPendingBarcodeCapture({ result: decoded.result, warning: decoded.warning });
      setBarcodeMessage({
        tone: "idle",
        text: "Photo captured. Check the detected barcode, then confirm or retake.",
      });
    } catch {
      setBarcodeMessage({ tone: "error", text: "Could not read that photo. Retake or use manual entry." });
    } finally {
      setBarcodeBusy(false);
    }
  }

  function retakeBarcodePhoto() {
    setPendingBarcodeCapture(null);
    setBarcodeMessage(null);
    void startBarcodeCamera();
  }

  async function confirmBarcodeCapture() {
    if (!pendingBarcodeCapture) return;
    const { result, warning } = pendingBarcodeCapture;
    setPendingBarcodeCapture(null);
    // Keep the single existing apply path (lookup payload, duplicate guard,
    // external preview and form updates all live here).
    await applyDecodedBarcode(result, warning);
  }

  async function handleBarcodePhotoUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPendingBarcodeCapture(null);
    setBarcodeBusy(true);
    setBarcodeMessage({ tone: "idle", text: "Reading barcode from the uploaded photo…" });
    try {
      const decoded = await decodeBarcodeFromFile(file);
      if (!decoded.ok) {
        setBarcodeMessage({ tone: "error", text: decoded.error });
        return;
      }
      await applyDecodedBarcode(decoded.result, decoded.warning);
    } finally {
      setBarcodeBusy(false);
    }
  }

  async function handleProductPhotoUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      notify("Product photo must be a JPG, PNG or WebP image.");
      return;
    }
    if (file.size > 1_500_000) {
      notify("Product photo is too large. Use an image under 1.5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setForm((current) => ({
        ...current,
        imageUrl: reader.result as string,
        imageSource: "Manual upload",
      }));
    };
    reader.onerror = () => notify("Could not read the product photo.");
    reader.readAsDataURL(file);
  }

  async function associateDecodedBarcode() {
    if (!form.barcode || !associateSku) return;
    setAssociateBusy(true);
    try {
      const res = await fetch("/api/v1/products/barcode/external", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          mode: "associate",
          barcode: form.barcode,
          format: form.barcodeFormat || undefined,
          confirmed_external: true,
          associate_to_sku: associateSku,
          source: externalPreview?.attribution ?? "Manual barcode association",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBarcodeMessage({
          tone: "error",
          text: body?.error?.message ?? "Could not associate the barcode.",
        });
        return;
      }
      notify(`Barcode ${form.barcode} associated with ${associateSku}.`);
      setBarcodeLookupState("internal-found");
      setExistingProduct(body.product as Product);
      router.refresh();
    } catch {
      setBarcodeMessage({ tone: "error", text: "Network error while associating the barcode." });
    } finally {
      setAssociateBusy(false);
    }
  }

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
    if (form.barcode) {
      if (barcodeLookupState === "internal-found") {
        setBarcodeMessage({
          tone: "warning",
          text: "This barcode already belongs to an Ascentra product. Open or edit that product instead of creating a duplicate.",
        });
        return;
      }
      // A manually typed barcode may not have been looked up yet. Re-check
      // before the create so an existing product is never duplicated.
      if (barcodeLookupState === "idle" || barcodeLookupState === "looking") {
        const allowed = await runBarcodeLookup(form.barcode, form.barcodeFormat);
        if (!allowed) return;
      }
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
        image_url: form.imageUrl || null,
        image_source: form.imageSource || null,
        // The product API registers this barcode in the same transaction as the
        // product row, so a duplicate barcode rolls the whole create back.
        ...(form.barcode && !editing
          ? { barcode: form.barcode, barcode_format: form.barcodeFormat || undefined }
          : {}),
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
      <div className="scrollbar-thin flex gap-1 overflow-x-auto whitespace-nowrap border-b border-border px-3 pt-3 sm:px-4">
        <button
          type="button"
          onClick={() => setProductTab("active")}
          className={cn(
            "flex shrink-0 items-center gap-2 rounded-t-lg px-3 py-2 text-xs font-semibold transition-all sm:px-4",
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
            "flex shrink-0 items-center gap-2 rounded-t-lg px-3 py-2 text-xs font-semibold transition-all sm:px-4",
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
            className="h-9 rounded-lg border border-input bg-background px-2 text-xs outline-none sm:h-8"
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
            className="flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl sm:max-h-[90vh] sm:rounded-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5 sm:py-4">
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
                title="Product photo & barcode"
                description="Product photo and barcode photo are separate actions. Barcode decoding uses ZXing, never general image recognition."
              >
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-xl border border-border bg-muted/20 p-3">
                    <div className="flex items-center gap-2">
                      <ImageIcon className="h-4 w-4 text-primary" />
                      <div>
                        <p className="text-xs font-semibold">Product photo</p>
                        <p className="text-[10px] text-muted-foreground">
                          Upload the packaging/product image for this ERP record.
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 flex h-24 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-background">
                      {form.imageUrl ? (
                        <img
                          src={form.imageUrl}
                          alt="Product preview"
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <span className="text-[11px] text-muted-foreground">No product photo</span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <label className="btn btn-secondary btn-sm cursor-pointer justify-center gap-1.5">
                        <Upload className="h-3.5 w-3.5" /> Upload product photo
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="sr-only"
                          data-testid="product-photo-upload"
                          onChange={handleProductPhotoUpload}
                        />
                      </label>
                      {form.imageUrl && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() =>
                            setForm((current) => ({ ...current, imageUrl: "", imageSource: "" }))
                          }
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    {form.imageSource && (
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        Image source: {form.imageSource}
                      </p>
                    )}
                  </div>

                  <div className="rounded-xl border border-border bg-muted/20 p-3">
                    <div className="flex items-center gap-2">
                      <ScanLine className="h-4 w-4 text-primary" />
                      <div>
                        <p className="text-xs font-semibold">Barcode photo</p>
                        <p className="text-[10px] text-muted-foreground">
                          Take a photo or upload one; the decoded number is checked in Ascentra first.
                        </p>
                      </div>
                    </div>

                    <div className="mt-2 flex gap-2">
                      <input
                        value={form.barcode}
                        onChange={(event) => {
                          setForm((current) => ({
                            ...current,
                            barcode: event.target.value.toUpperCase(),
                            barcodeFormat: "",
                          }));
                          setPendingBarcodeCapture(null);
                          setBarcodeLookupState("idle");
                          setExistingProduct(null);
                          setExternalPreview(null);
                        }}
                        placeholder="Detected or manual barcode"
                        aria-label="Barcode number"
                        data-testid="barcode-manual"
                        className="input font-mono"
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm shrink-0"
                        disabled={!form.barcode.trim() || barcodeLookupState === "looking"}
                        onClick={() => void runBarcodeLookup(form.barcode, form.barcodeFormat)}
                        data-testid="barcode-lookup"
                      >
                        {barcodeLookupState === "looking" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <PackageSearch className="h-3.5 w-3.5" />
                        )}
                        Lookup
                      </button>
                    </div>

                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm min-h-11 w-full justify-center gap-1.5 sm:w-auto"
                        onClick={() => {
                          if (barcodeCameraActive) {
                            stopBarcodeCamera();
                            setBarcodeCaptureOpen(false);
                          } else if (barcodeCaptureOpen) {
                            stopBarcodeTracks();
                            setBarcodeCaptureOpen(false);
                            setBarcodeMessage(null);
                          } else {
                            void startBarcodeCamera();
                          }
                        }}
                        data-testid="take-barcode-photo"
                      >
                        <Camera className="h-3.5 w-3.5" />
                        {barcodeCameraActive ? "Stop camera" : barcodeCaptureOpen ? "Close camera" : "Take Barcode Photo"}
                      </button>
                      <label className="btn btn-secondary btn-sm min-h-11 w-full cursor-pointer justify-center gap-1.5 sm:w-auto">
                        {barcodeBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                        Upload barcode photo
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="sr-only"
                          data-testid="barcode-photo-upload"
                          onChange={handleBarcodePhotoUpload}
                        />
                      </label>
                    </div>

                    {barcodeCaptureOpen && (
                      <div className="mt-2 overflow-hidden rounded-lg border border-border bg-black">
                        <div className="relative flex max-h-[45dvh] items-center justify-center">
                          <video
                            ref={barcodeVideoRef}
                            autoPlay
                            muted
                            playsInline
                            className="block max-h-[45dvh] w-full object-contain"
                          />
                          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                            <div className="h-20 w-3/4 rounded border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] sm:h-24" />
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 p-2 sm:flex-row">
                          {barcodeCameraActive ? (
                            <button
                              type="button"
                              className="btn btn-primary min-h-11 w-full justify-center sm:w-auto"
                              disabled={barcodeBusy}
                              onClick={() => void captureBarcodePhoto()}
                              data-testid="capture-barcode-photo"
                            >
                              {barcodeBusy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Camera className="h-4 w-4" />
                              )}
                              {barcodeBusy ? "Reading…" : "Capture barcode"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-secondary min-h-11 w-full justify-center sm:w-auto"
                              onClick={() => void startBarcodeCamera()}
                            >
                              Camera not ready — try again
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-secondary min-h-11 w-full justify-center sm:w-auto"
                            onClick={() => {
                              stopBarcodeCamera();
                              setBarcodeCaptureOpen(false);
                              setBarcodeMessage(null);
                            }}
                          >
                            <X className="h-4 w-4" /> Close camera
                          </button>
                        </div>
                      </div>
                    )}

                    {!barcodeCaptureOpen && pendingBarcodeCapture && (
                      <div className="mt-2 rounded-lg border border-primary/40 bg-primary/5 p-2 text-[11px] leading-4">
                        <p className="font-semibold text-foreground">Photo captured — review before applying</p>
                        <p className="mt-1 text-muted-foreground">
                          Detected barcode:{" "}
                          <strong className="font-mono text-foreground" data-testid="pending-barcode">
                            {pendingBarcodeCapture.result.barcode}
                          </strong>
                          {pendingBarcodeCapture.result.format
                            ? ` · ${pendingBarcodeCapture.result.format}`
                            : ""}
                        </p>
                        {pendingBarcodeCapture.warning && (
                          <p className="mt-1 text-amber-800">{pendingBarcodeCapture.warning}</p>
                        )}
                        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                          <button
                            type="button"
                            className="btn btn-secondary min-h-11 w-full justify-center gap-1.5 sm:w-auto"
                            onClick={retakeBarcodePhoto}
                            data-testid="retake-barcode-photo"
                          >
                            <RotateCcw className="h-3.5 w-3.5" /> Retake photo
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary min-h-11 w-full justify-center gap-1.5 sm:w-auto"
                            onClick={() => void confirmBarcodeCapture()}
                            data-testid="confirm-barcode-photo"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Confirm &amp; look up
                          </button>
                        </div>
                      </div>
                    )}

                    {form.barcode && (
                      <p className="mt-2 rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground">
                        Detected barcode: <strong className="font-mono" data-testid="barcode-detected">{form.barcode}</strong>
                        {form.barcodeFormat ? ` · ${form.barcodeFormat}` : ""}
                      </p>
                    )}

                    {barcodeMessage && (
                      <div
                        className={cn(
                          "mt-2 flex items-start gap-2 rounded-lg border px-2 py-1.5 text-[11px] leading-4",
                          barcodeMessage.tone === "ok" && "border-emerald-200 bg-emerald-50 text-emerald-900",
                          barcodeMessage.tone === "error" && "border-red-200 bg-red-50 text-red-800",
                          barcodeMessage.tone === "warning" && "border-amber-200 bg-amber-50 text-amber-900",
                          barcodeMessage.tone === "external" && "border-sky-200 bg-sky-50 text-sky-900",
                          barcodeMessage.tone === "idle" && "border-border bg-background text-muted-foreground",
                        )}
                      >
                        {barcodeMessage.tone === "error" ? (
                          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        )}
                        <span>{barcodeMessage.text}</span>
                      </div>
                    )}

                    {barcodeLookupState === "internal-found" && existingProduct && (
                      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
                        <p className="font-semibold">
                          {existingProduct.sku} — {existingProduct.name}
                        </p>
                        <p className="mt-0.5">No duplicate will be created for this barcode.</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            data-testid="open-existing-product"
                            onClick={() => openDetail(existingProduct)}
                          >
                            Open product
                          </button>
                          <Can permission="products:write" mode="hide">
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => openEdit(existingProduct)}
                            >
                              <Pencil className="h-3 w-3" /> Edit product
                            </button>
                          </Can>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              setForm((current) => ({ ...current, barcode: "", barcodeFormat: "" }));
                              setBarcodeLookupState("idle");
                              setExistingProduct(null);
                              setExternalPreview(null);
                            }}
                          >
                            Create different product
                          </button>
                        </div>
                      </div>
                    )}

                    {barcodeLookupState === "external-found" && externalPreview && (
                      <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50 p-2 text-[11px] text-sky-900">
                        <div className="flex items-start gap-2">
                          {externalPreview.image_url && (
                            <img
                              src={externalPreview.image_url}
                              alt={externalPreview.name ?? "External product"}
                              className="h-16 w-16 shrink-0 rounded border border-sky-200 bg-white object-contain"
                              onError={(event) => {
                                (event.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                          )}
                          <div className="min-w-0">
                            <p className="font-semibold">External preview — unverified ERP data</p>
                            <p>{externalPreview.name ?? "Unnamed catalogue record"}</p>
                            {externalPreview.brand && <p>Brand: {externalPreview.brand}</p>}
                            {externalPreview.quantity && <p>Pack: {externalPreview.quantity}</p>}
                            {externalPreview.sourceUrl && (
                              <a
                                href={externalPreview.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="underline"
                              >
                                {externalPreview.attribution ?? "View source"}
                              </a>
                            )}
                          </div>
                        </div>
                        {externalPreview.image_url && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm mt-2"
                            onClick={() =>
                              setForm((current) => ({
                                ...current,
                                imageUrl: String(externalPreview.image_url),
                                imageSource: externalPreview.attribution ?? "External catalogue",
                              }))
                            }
                          >
                            Use external image as product photo
                          </button>
                        )}
                      </div>
                    )}

                    {(barcodeLookupState === "not-found" ||
                      barcodeLookupState === "unavailable" ||
                      barcodeLookupState === "error") && (
                      <div className="mt-2 rounded-lg border border-border bg-background p-2 text-[11px]">
                        <p className="font-semibold">Associate barcode with an existing product</p>
                        <div className="mt-1.5 flex gap-2">
                          <select
                            value={associateSku}
                            onChange={(event) => setAssociateSku(event.target.value)}
                            className="input"
                            aria-label="Associate barcode with product"
                          >
                            <option value="">Choose product…</option>
                            {items.map((product) => (
                              <option key={product.sku} value={product.sku}>
                                {product.sku} — {product.name}
                              </option>
                            ))}
                          </select>
                          <Can permission="products:write" mode="disable">
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm shrink-0"
                              disabled={associateBusy || !associateSku}
                              data-testid="associate-barcode"
                              onClick={() => void associateDecodedBarcode()}
                            >
                              <Link2 className="h-3.5 w-3.5" /> Associate
                            </button>
                          </Can>
                        </div>
                      </div>
                    )}
                  </div>
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

            <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-muted/20 px-4 py-3 sm:px-5">
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
            className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl sm:max-h-[88vh] sm:rounded-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5 sm:py-4">
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
              {detail.image_url && (
                <img
                  src={detail.image_url}
                  alt={`${detail.name} product photo`}
                  className="h-16 w-16 shrink-0 rounded-lg border border-border bg-white object-contain"
                />
              )}
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
