"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import {
  Barcode,
  Camera,
  CheckCircle2,
  Loader2,
  PackageSearch,
  Printer,
  QrCode,
  RotateCcw,
  ScanLine,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { Badge, SectionHeader, Surface, statusTone } from "@/components/ui";
import { money, number, titleCase } from "@/lib/format";
import type { Product } from "@/lib/types";

import {
  assessImageQuality,
  decodeBarcodeFromFile as decodeBarcodePhotoFile,
  decodeCanvas,
  type BarcodeDecodeResult,
} from "@/lib/barcode-decode";

interface BarcodeRow {
  id: string;
  product_id: string;
  product_sku: string;
  product_name: string;
  sku: string;
  barcode: string;
  format: string;
  is_primary: boolean;
  created_at: string;
}

type ScanState =
  | { status: "idle"; message: string }
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

interface ProductBarcodeLookupProps {
  products: Product[];
}

export function BarcodeWorkbench({ products }: ProductBarcodeLookupProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"scan" | "barcodes" | "labels">("scan");

  // Scan tab state
  const [barcode, setBarcode] = useState("");
  const [matched, setMatched] = useState<Product | null>(null);
  const [format, setFormat] = useState<string | null>(null);
  const [scanState, setScanState] = useState<ScanState>({
    status: "idle",
    message: "Ready — scan a product barcode or type one to look it up."
  });
  const [scanning, setScanning] = useState(false);
  const [photoMode, setPhotoMode] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  // Captured frames wait here for an explicit Confirm before any lookup runs.
  const [pendingPhoto, setPendingPhoto] = useState<{
    result: BarcodeDecodeResult;
    warning: string | null;
  } | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [lastFailedCode, setLastFailedCode] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Barcodes tab state
  const [barcodes, setBarcodes] = useState<BarcodeRow[]>([]);
  const [barcodeListLoading, setBarcodeListLoading] = useState(false);
  const [addSku, setAddSku] = useState("");
  const [addCode, setAddCode] = useState("");
  const [addFormat, setAddFormat] = useState("EAN-13");
  const [addFeedback, setAddFeedback] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [externalPreview, setExternalPreview] = useState<{
    barcode: string;
    name: string | null;
    brand: string | null;
    category: string | null;
    description: string | null;
    quantity: string;
    ingredients: string | null;
    image_url: string | null;
    source: string;
    sourceLabel: string;
    sourceUrl: string;
    attribution: string;
  } | null>(null);
  const [externalStatus, setExternalStatus] = useState<"disabled" | "found" | "not_found" | "unavailable" | "malformed" | null>(null);
  const [externalReason, setExternalReason] = useState<string | null>(null);
  const [associateSku, setAssociateSku] = useState("");
  const [externalBusy, setExternalBusy] = useState(false);
  const [externalDone, setExternalDone] = useState<string | null>(null);
  const [nameEdit, setNameEdit] = useState("");
  const [brandEdit, setBrandEdit] = useState("");
  const [categoryEdit, setCategoryEdit] = useState("");
  const [shelfLifeEdit, setShelfLifeEdit] = useState("30");
  const [priceEdit, setPriceEdit] = useState("0.00");
  const [vatEdit, setVatEdit] = useState("10");

  // Labels tab state
  const [labelSku, setLabelSku] = useState("");
  const [labelCount, setLabelCount] = useState(12);

  const productOptions = products
    .filter((p) => p.status === "active")
    .map((p) => ({ value: p.sku, label: `${p.sku} — ${p.name}` }));

  const labelProduct = products.find((p) => p.sku === labelSku) ?? null;
  const labelBarcode = barcodes.find((b) => b.sku === labelSku)?.barcode ?? null;

  // Load barcode list once when the Manage/Print tab is open
  useEffect(() => {
    if (activeTab === "scan") return;
    let cancelled = false;
    setBarcodeListLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/v1/products/barcodes", { credentials: "include" });
        const body = await res.json().catch(() => ({}));
        if (!cancelled) setBarcodes(Array.isArray(body.barcodes) ? body.barcodes : []);
      } catch {
        if (!cancelled) setBarcodes([]);
      } finally {
        if (!cancelled) setBarcodeListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  const submitLookup = async (code?: unknown, formatHint?: string | null) => {
    const explicit = typeof code === "string" ? code : undefined;
    const value = (explicit ?? barcode).trim();
    if (!value) {
      setScanState({ status: "error", message: "Enter or scan a barcode first." });
      return;
    }
    const hint = formatHint ?? format ?? undefined;
    try {
      const res = await fetch("/api/v1/products/barcode/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          barcode: value,
          operation: "lookup",
          ...(hint ? { format: hint } : {})
        }),
        credentials: "include"
      });
      const body = await res.json().catch(() => ({}));
      if (body?.found && body?.product) {
        setLastFailedCode(null);
        setExternalPreview(null);
        setExternalStatus(null);
        setExternalReason(null);
        setMatched(body.product);
        setFormat(typeof body.format === "string" ? body.format : null);
        setScanState({
          status: "ok",
          message: `${body.product.sku} — ${body.product.name}`
        });
        setBarcode("");
        return;
      }
      setMatched(null);
      setFormat(null);
      setLastFailedCode(value);
      const ext = body?.external && typeof body.external === "object" ? body.external : null;
      setExternalPreview(ext);
      setExternalStatus((body?.external_status as typeof externalStatus) ?? null);
      setExternalReason(typeof body?.external_reason === "string" ? body.external_reason : null);
      setNameEdit(typeof ext?.name === "string" ? ext.name : "");
      setBrandEdit(typeof ext?.brand === "string" ? ext.brand : "");
      setCategoryEdit(typeof ext?.category === "string" ? ext.category : "");
      setShelfLifeEdit("30");
      setPriceEdit("0.00");
      setVatEdit("10");
      setScanState({ status: "error", message: body?.message ?? `Barcode ${value} not found.` });
    } catch {
      setMatched(null);
      setScanState({ status: "error", message: "Network error resolving barcode." });
    }
  };

  const createFromExternal = async () => {
    if (!lastFailedCode) return;
    setExternalBusy(true);
    setExternalDone(null);
    try {
      const price = Math.round((Number(priceEdit) || 0) * 100);
      const res = await fetch("/api/v1/products/barcode/external", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          mode: "create",
          barcode: lastFailedCode,
          confirmed_external: true,
          name: nameEdit.trim(),
          brand: brandEdit.trim() || null,
          category: categoryEdit.trim() || "Ambient",
          quantity: externalPreview?.quantity ?? null,
          ingredients: externalPreview?.ingredients ?? null,
          image_url: externalPreview?.image_url ?? null,
          source: externalPreview?.attribution ?? "external",
          unit_price_cents: price,
          vat_rate_pct: Number(vatEdit) || 10,
          shelf_life_days: Number(shelfLifeEdit) || 30
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body?.error?.code === "DUPLICATE_PRODUCT" && body?.error?.details?.existing_sku) {
          setExternalDone(`A product already exists as ${body.error.details.existing_sku} — associate the barcode to it instead.`);
          return;
        }
        setExternalDone(body?.error?.message ?? "Could not create the product.");
        return;
      }
      setExternalDone(`Created ${body?.product?.sku} — ${body?.product?.name}. Barcode ${body?.barcode?.barcode} registered.`);
      void submitLookup(lastFailedCode);
      router.refresh();
    } catch {
      setExternalDone("Network error while creating the product.");
    } finally {
      setExternalBusy(false);
    }
  };

  const associateToExisting = async () => {
    if (!lastFailedCode || !associateSku) return;
    setExternalBusy(true);
    setExternalDone(null);
    try {
      const res = await fetch("/api/v1/products/barcode/external", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          mode: "associate",
          barcode: lastFailedCode,
          confirmed_external: true,
          associate_to_sku: associateSku,
          source: externalPreview?.attribution ?? "external"
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setExternalDone(body?.error?.message ?? "Could not associate the barcode.");
        return;
      }
      setExternalDone(`Barcode ${lastFailedCode} associated with ${associateSku}.`);
      void submitLookup(lastFailedCode);
      router.refresh();
    } catch {
      setExternalDone("Network error while associating the barcode.");
    } finally {
      setExternalBusy(false);
    }
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // USB scanner: sends the code followed by Enter
    if (event.key === "Enter") {
      event.preventDefault();
      submitLookup();
    }
  };

  // Camera scanning loop — rear camera by default.
  // ZXing MultiFormatReader decodes EAN-13/8, UPC-A/E, Code-128/39, ITF and QR codes —
  // real retail product packaging carries 1-D barcodes, not QR codes.
  useEffect(() => {
    if (!scanning) return;
    let raf = 0;
    let stopped = false;
    let lastAttempt = 0;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const tick = async () => {
      const video = videoRef.current;
      // Throttle to ~6 decode attempts per second and cap resolution for speed.
      if (!stopped && video && video.readyState >= 2 && ctx && Date.now() - lastAttempt > 150) {
        lastAttempt = Date.now();
        const scale = Math.min(1, 1024 / Math.max(1, video.videoWidth || 1024));
        canvas.width = Math.max(1, Math.round((video.videoWidth || 1024) * scale));
        canvas.height = Math.max(1, Math.round((video.videoHeight || 576) * scale));
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
          const result = await decodeCanvas(ctx, canvas.width, canvas.height, false);
          if (result) {
            setBarcode(result.barcode);
            setFormat(result.format);
            stopCamera();
            setScanState({ status: "ok", message: "Barcode detected — press Enter or click Lookup." });
            return;
          }
        } catch {
          // No code in frame — keep scanning.
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  // Decode barcodes directly from an uploaded image — same shared ZXing pipeline
  // as the Add Product photo flow and the camera loop.
  const decodeBarcodeFromFile = async (
    file: File,
  ): Promise<{ text: string; format: string } | { error: string }> => {
    const decoded = await decodeBarcodePhotoFile(file);
    if (!decoded.ok) return { error: decoded.error };
    return { text: decoded.result.barcode, format: decoded.result.format };
  };

  const handleBarcodeImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-uploading the same file
    if (!file) return;
    setImageBusy(true);
    setCameraError(null);
    setPendingPhoto(null);
    setScanState({ status: "idle", message: "Reading barcode from image…" });
    try {
      const decoded = await decodeBarcodeFromFile(file);
      if ("error" in decoded) {
        setScanState({ status: "error", message: decoded.error });
        return;
      }
      setBarcode(decoded.text);
      setFormat(decoded.format);
      setScanState({ status: "ok", message: `Barcode detected in image — ${decoded.text}` });
      void submitLookup(decoded.text, decoded.format);
    } catch {
      setScanState({ status: "error", message: "Could not process that image. Try a JPG or PNG photo of the barcode." });
    } finally {
      setImageBusy(false);
    }
  };

  const stopCamera = () => {
    const stream = streamRef.current;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    streamRef.current = null;
    setScanning(false);
    setPhotoMode(false);
    setPhotoBusy(false);
    setPendingPhoto(null);
  };

  const startCamera = async (mode: "live" | "photo") => {
    setCameraError(null);
    setPhotoMessage(null);
    setPendingPhoto(null);
    // Recover cleanly if a previous stream was left attached (e.g. a retake).
    const existing = streamRef.current;
    existing?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    streamRef.current = null;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera is not available in this browser. Upload a barcode photo or enter the number manually.");
      return;
    }
    if (!window.isSecureContext && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      setCameraError("Camera access requires HTTPS. Upload a barcode photo or enter the number manually.");
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      streamRef.current = media;
      if (videoRef.current) {
        videoRef.current.srcObject = media;
        await videoRef.current.play().catch(() => undefined);
      }
      setScanning(mode === "live");
      setPhotoMode(mode === "photo");
    } catch (err: any) {
      stopCamera();
      setCameraError(
        err?.name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera access, upload a barcode photo, or enter the number manually."
          : "Camera could not start. Upload a barcode photo or enter the number manually."
      );
    }
  };

  // Capture a still barcode photo instead of the continuous live-scan loop.
  // This uses the exhaustive photo strategy (all rotations + both binarizers).
  const captureBarcodePhoto = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setPhotoMessage("Camera preview is not ready. Try again.");
      return;
    }
    setPhotoBusy(true);
    setPhotoMessage("Reading barcode from the photo…");
    try {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const warning = assessImageQuality(ctx, canvas.width, canvas.height);
      const result = await decodeCanvas(ctx, canvas.width, canvas.height, true);
      if (!result) {
        setPhotoMessage(
          warning
            ? `No barcode detected. ${warning}`
            : "No barcode detected. Retake with even lighting and no glare."
        );
        return;
      }
      // Freeze the frame first: stop the stream, then hold the decoded result
      // for an explicit Retake / Confirm decision.
      stopCamera();
      setPendingPhoto({ result, warning });
      setPhotoMessage(
        warning
          ? `${warning} Photo captured — confirm to look up ${result.barcode}.`
          : `Photo captured — confirm to look up ${result.barcode}.`
      );
    } catch {
      setPhotoMessage("Could not read that photo. Retake or use manual entry.");
    } finally {
      setPhotoBusy(false);
    }
  };

  const retakeBarcodePhoto = () => {
    setPendingPhoto(null);
    setPhotoMessage(null);
    void startCamera("photo");
  };

  const confirmBarcodePhoto = () => {
    if (!pendingPhoto) return;
    const { result, warning } = pendingPhoto;
    setPendingPhoto(null);
    setBarcode(result.barcode);
    setFormat(result.format);
    setPhotoMessage(
      warning ? `${warning} Looking up ${result.barcode}.` : `Looking up ${result.barcode}.`
    );
    // submitLookup preserves `operation: "lookup"` in the lookup payload.
    void submitLookup(result.barcode, result.format);
  };

  // Never leave a camera stream running when the tab changes or the page unmounts.
  useEffect(() => {
    if (activeTab !== "scan") stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => () => stopCamera(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const generateInternalCode = async () => {
    const sku = addSku;
    if (!sku || generating) return;
    setGenerating(true);
    setAddError(null);
    setAddFeedback(null);
    try {
      const res = await fetch("/api/v1/products/barcodes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ product_sku: sku })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddError(body?.error?.message ?? "Could not generate an internal barcode.");
        return;
      }
      setAddFeedback(
        `Internal code ${body?.barcode?.barcode} assigned to ${body?.barcode?.sku}. Print it from the Label Printing tab and stick it on the pack.`
      );
      const refresh = await fetch("/api/v1/products/barcodes", { credentials: "include" });
      const listBody = await refresh.json().catch(() => ({}));
      setBarcodes(Array.isArray(listBody.barcodes) ? listBody.barcodes : []);
    } catch {
      setAddError("Could not generate an internal barcode.");
    } finally {
      setGenerating(false);
    }
  };

  const addBarcode = async () => {
    setAddError(null);
    setAddFeedback(null);
    const code = addCode.trim().toUpperCase().replace(/[\s\-_.]+/g, "");
    if (!code || !addSku) {
      setAddError("Choose a product and enter a barcode value.");
      return;
    }
    try {
      const res = await fetch("/api/v1/products/barcodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_sku: addSku, barcode: code, format: addFormat, is_primary: true }),
        credentials: "include"
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddError(body?.error?.message ?? "Unable to add barcode.");
        return;
      }
      setBarcodes((prev) => [...prev, body.barcode].sort((a, b) => a.product_sku.localeCompare(b.product_sku)));
      setAddCode("");
      setAddFeedback(`Barcode ${code} assigned to ${addSku}.`);
    } catch {
      setAddError("Network error while adding barcode.");
    }
  };

  const removeBarcode = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/products/barcodes?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include"
      });
      if (!res.ok) return;
      setBarcodes((prev) => prev.filter((b) => b.id !== id));
    } catch {
      /* silent */
    }
  };

  const renderStatus = () => {
    if (scanState.status === "ok") {
      return (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <span>{scanState.message}</span>
        </div>
      );
    }
    if (scanState.status === "error") {
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            <XCircle className="h-4 w-4 shrink-0 text-red-600" />
            <span>{scanState.message}</span>
          </div>
          {lastFailedCode && externalStatus && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-[11px] leading-4 text-sky-900">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-800">
                External preview — confirm before creating
              </p>

              {externalStatus === "found" && externalPreview ? (
                <>
                  <div className="mt-2 flex gap-3">
                    {externalPreview.image_url && (
                      <img
                        src={externalPreview.image_url}
                        alt={externalPreview.name ?? "External product"}
                        loading="lazy"
                        className="h-24 w-24 shrink-0 rounded-lg border border-sky-200 bg-white object-contain"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-bold">{externalPreview.name}</div>
                      <div>{externalPreview.brand ? `Brand: ${externalPreview.brand}` : "Brand unknown"}</div>
                      <div>Pack: {externalPreview.quantity}</div>
                      {externalPreview.description && <p className="mt-1 line-clamp-2 text-sky-800">{externalPreview.description}</p>}
                      <p className="mt-1">
                        <a href={externalPreview.sourceUrl || undefined} target="_blank" rel="noreferrer" className="text-[10px] font-semibold underline">
                          {externalPreview.attribution}
                        </a>
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <label className="block sm:col-span-2">
                      <span className="field-label">Product name *</span>
                      <input value={nameEdit} onChange={(e) => setNameEdit(e.target.value)} className="input mt-0.5" placeholder="External name — edit if wrong" />
                    </label>
                    <label className="block">
                      <span className="field-label">Brand</span>
                      <input value={brandEdit} onChange={(e) => setBrandEdit(e.target.value)} className="input mt-0.5" placeholder="e.g. Ferrero" />
                    </label>
                    <label className="block">
                      <span className="field-label">Category</span>
                      <input value={categoryEdit} onChange={(e) => setCategoryEdit(e.target.value)} list="catalog-categories" className="input mt-0.5" placeholder="Pick or type a category" />
                      <datalist id="catalog-categories">
                        {Array.from(new Set(products.map((p) => p.category))).map((c) => <option key={c} value={c} />)}
                      </datalist>
                    </label>
                    <label className="block">
                      <span className="field-label">Shelf life (days)</span>
                      <input type="number" min={1} value={shelfLifeEdit} onChange={(e) => setShelfLifeEdit(e.target.value)} className="input mt-0.5" />
                    </label>
                    <label className="block">
                      <span className="field-label">Unit price (€)</span>
                      <input type="number" min={0} step="0.01" value={priceEdit} onChange={(e) => setPriceEdit(e.target.value)} className="input mt-0.5" />
                    </label>
                    <label className="block">
                      <span className="field-label">VAT %</span>
                      <input type="number" min={0} max={100} value={vatEdit} onChange={(e) => setVatEdit(e.target.value)} className="input mt-0.5" />
                    </label>
                    <div className="flex items-end">
                      <button type="button" onClick={createFromExternal} disabled={externalBusy || !nameEdit.trim()} className="btn btn-primary btn-sm w-full justify-center">
                        {externalBusy ? "Saving…" : "Create product & register barcode"}
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 border-t border-sky-200 pt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-800">Or associate with an existing product</p>
                    <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <select value={associateSku} onChange={(e) => setAssociateSku(e.target.value)} className="input flex-1">
                        <option value="">Choose product…</option>
                        {productOptions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                      </select>
                      <button type="button" onClick={associateToExisting} disabled={externalBusy || !associateSku} className="btn btn-secondary btn-sm shrink-0">
                        Associate
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 text-[10px] text-sky-800">Nothing is stored until you click a button above. External data stays external until you approve it.</p>
                </>
              ) : (
                <>
                  <p className="mt-2 font-semibold">
                    {externalStatus === "not_found" && "Product not found in external database."}
                    {externalStatus === "unavailable" && (externalReason ?? "External service unavailable — try again later.")}
                    {externalStatus === "malformed" && (externalReason ?? "The external record has no usable product name.")}
                    {externalStatus === "disabled" && "External lookup is disabled on this deployment."}
                  </p>
                  <p className="mt-1 text-[10px] text-sky-800">You can still register this barcode manually once you created the product yourself.</p>
                  <button type="button" onClick={() => { setAddCode(lastFailedCode); setAddError(null); setAddFeedback(null); setActiveTab("barcodes"); }} className="btn btn-secondary btn-sm mt-2 w-full justify-center gap-1.5">
                    <Barcode className="h-3.5 w-3.5" /> Associate {lastFailedCode} with an existing product →
                  </button>
                </>
              )}
              {externalDone && <p className="mt-2 rounded border border-sky-200 bg-white px-2 py-1 text-[10px] text-sky-900">{externalDone}</p>}
            </div>
          )}
        </div>
      );
    }
    return <p className="text-xs text-muted-foreground">{scanState.message}</p>;
  };

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex flex-wrap gap-2">
        {[
          { id: "scan", label: "Scan & Lookup", icon: ScanLine },
          { id: "barcodes", label: "Manage Barcodes", icon: Barcode },
          { id: "labels", label: "Label Printing", icon: Printer }
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id as typeof activeTab)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground data-[active=true]:border-primary data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
            data-active={activeTab === t.id ? "true" : "false"}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {/* ========== Scan & Lookup ========== */}
      {activeTab === "scan" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Surface className="p-4 sm:p-5">
            <SectionHeader
              eyebrow="Live scan"
              title="Product barcode"
              description="Scanner, live camera, barcode photo or manual entry — looks up the product directly from the ERP database."
              action={<Badge tone="ok" dot>Scanner ready</Badge>}
            />
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="field-label">Barcode value</span>
                <div className="flex gap-2">
                  <input
                    value={barcode}
                    onChange={(e) => {
                      setBarcode(e.target.value);
                      setFormat(null);
                      setPendingPhoto(null);
                      setLastFailedCode(null);
                      setExternalPreview(null);
                      setExternalStatus(null);
                      setExternalReason(null);
                      setMatched(null);
                    }}
                    onKeyDown={handleInputKeyDown}
                    autoFocus
                    placeholder="Scan or type a barcode…"
                    className="input font-mono tracking-wider"
                    aria-label="Barcode"
                  />
                  <button type="button" onClick={() => submitLookup()} className="btn btn-primary shrink-0 gap-1.5">
                    <PackageSearch className="h-4 w-4" /> Lookup
                  </button>
                </div>
              </label>

              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={scanning ? stopCamera : () => void startCamera("live")}
                  className="btn btn-secondary min-h-11 w-full justify-center gap-2 py-2"
                  data-testid="live-camera-scan"
                >
                  <ScanLine className="h-4 w-4" /> {scanning ? "Stop camera" : "Use camera to scan"}
                </button>
                <button
                  type="button"
                  onClick={photoMode ? stopCamera : () => void startCamera("photo")}
                  className="btn btn-primary min-h-11 w-full justify-center gap-2 py-2"
                  data-testid="take-barcode-photo"
                >
                  <Camera className="h-4 w-4" /> {photoMode ? "Close camera" : "Take Barcode Photo"}
                </button>
              </div>

              <label className="btn btn-secondary min-h-11 w-full cursor-pointer justify-center gap-2 py-2">
                {imageBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {imageBusy ? "Reading image…" : "Upload barcode photo"}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  data-testid="barcode-photo-upload"
                  onChange={handleBarcodeImageUpload}
                />
              </label>

              {cameraError && <p className="text-xs text-amber-800">{cameraError}</p>}
              {photoMessage && <p className="text-xs text-muted-foreground">{photoMessage}</p>}

              <div className={scanning || photoMode ? "overflow-hidden rounded-xl border border-border bg-black" : "hidden"}>
                <div className="relative flex max-h-[45dvh] items-center justify-center">
                  <video
                    ref={videoRef}
                    autoPlay
                    muted
                    playsInline
                    className="block max-h-[45dvh] w-full object-contain"
                  />
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="h-24 w-3/4 max-w-md rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] sm:h-28" />
                  </div>
                </div>
                {photoMode && (
                  <div className="flex flex-col gap-2 p-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => void captureBarcodePhoto()}
                      disabled={photoBusy}
                      className="btn btn-primary min-h-11 w-full justify-center sm:w-auto"
                      data-testid="capture-barcode-photo"
                    >
                      {photoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                      {photoBusy ? "Reading…" : "Capture barcode photo"}
                    </button>
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="btn btn-secondary min-h-11 w-full justify-center sm:w-auto"
                    >
                      <X className="h-4 w-4" /> Close camera
                    </button>
                  </div>
                )}
              </div>

              {!photoMode && !scanning && pendingPhoto && (
                <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 text-xs">
                  <p className="font-semibold text-foreground">Photo captured — review before lookup</p>
                  <p className="mt-1 text-muted-foreground">
                    Detected barcode:{" "}
                    <strong className="font-mono text-foreground" data-testid="pending-photo-barcode">
                      {pendingPhoto.result.barcode}
                    </strong>
                    {` · ${pendingPhoto.result.format}`}
                  </p>
                  {pendingPhoto.warning && (
                    <p className="mt-1 text-amber-800">{pendingPhoto.warning}</p>
                  )}
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={retakeBarcodePhoto}
                      className="btn btn-secondary min-h-11 w-full justify-center gap-1.5 sm:w-auto"
                      data-testid="retake-barcode-photo"
                    >
                      <RotateCcw className="h-4 w-4" /> Retake photo
                    </button>
                    <button
                      type="button"
                      onClick={confirmBarcodePhoto}
                      className="btn btn-primary min-h-11 w-full justify-center gap-1.5 sm:w-auto"
                      data-testid="confirm-barcode-photo"
                    >
                      <CheckCircle2 className="h-4 w-4" /> Confirm &amp; look up
                    </button>
                  </div>
                </div>
              )}

              <div className="min-h-[2rem]">{renderStatus()}</div>
            </div>
          </Surface>

          <Surface className="p-4 sm:p-5">
            <SectionHeader eyebrow="Result" title={matched ? matched.name : "Scan to identify"} />
            {matched ? (
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div>
                    <p className="text-lg font-bold text-foreground">{matched.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{matched.sku} · {format ?? "CODE128"}</p>
                  </div>
                  <Badge tone={statusTone(matched.status)} dot>{matched.status}</Badge>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3">
                  <FieldItem label="Category" value={matched.category} />
                  <FieldItem label="Origin" value={matched.origin ?? "—"} />
                  <FieldItem label="Unit" value={matched.unit} />
                  <FieldItem label="Pack size" value={matched.pack_size} />
                  <FieldItem label="Temp profile" value={matched.temperature_profile} />
                  <FieldItem label="Shelf life" value={`${matched.shelf_life_days} days`} />
                  <FieldItem label="Unit price" value={`€${(matched.unit_price_cents / 100).toFixed(2)}`} />
                  <FieldItem label="VAT" value={`${matched.vat_rate_pct ?? 0}%`} />
                  <FieldItem label="Lot certificates" value={String(matched.certificate_count ?? 0)} />
                  <FieldItem label="Expiring in 30d" value={String(matched.expiring_certificate_count ?? 0)} />
                </dl>
              </div>
            ) : (
              <div className="mt-4 flex h-48 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <QrCode className="h-10 w-10 text-muted-foreground/50" />
                <p>No product identified yet.</p>
                <p className="max-w-[260px] text-xs">Scan a salmon, burrata or any seeded product barcode to see its details here.</p>
              </div>
            )}
          </Surface>
        </div>
      )}

      {/* ========== Manage Barcodes ========== */}
      {activeTab === "barcodes" && (
        <Surface className="p-4 sm:p-5">
          <SectionHeader
            eyebrow="Barcode associations"
            title="Product barcodes"
            description="Each barcode resolves to exactly one product. Duplicate assignments are rejected."
            action={
              <button
                type="button"
                onClick={() => { setBarcodeListLoading(true); fetch("/api/v1/products/barcodes", { credentials: "include" }).then(async (r) => { const b = await r.json().catch(() => ({})); setBarcodes(Array.isArray(b.barcodes) ? b.barcodes : []); }).finally(() => setBarcodeListLoading(false)); }}
                className="btn btn-secondary btn-sm"
              >
                Refresh
              </button>
            }
          />
          <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
            One product can carry several barcodes — e.g. the supplier case code and the retail unit code.
            Assign extras to the same product the same way; every code resolves to its product, and the
            primary flag is used as the default when printing labels.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <label className="md:col-span-1">
              <span className="field-label">Product</span>
              <select value={addSku} onChange={(e) => setAddSku(e.target.value)} className="input mt-1">
                <option value="">Select product…</option>
                {productOptions.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </label>
            <label className="md:col-span-2">
              <span className="field-label">Barcode</span>
              <input value={addCode} onChange={(e) => setAddCode(e.target.value)} placeholder="e.g. 8056593285012" className="input mt-1 font-mono tracking-wider" />
            </label>
            <label>
              <span className="field-label">Format</span>
              <select value={addFormat} onChange={(e) => setAddFormat(e.target.value)} className="input mt-1">
                {["EAN-13", "EAN-8", "UPC-A", "UPC-E", "CODE128", "CODE39", "QR"].map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </label>
          </div>

          {addError && <p className="mt-2 text-xs text-red-700">{addError}</p>}
          {addFeedback && <p className="mt-2 text-xs font-medium text-emerald-800">{addFeedback}</p>}
          <button type="button" onClick={addBarcode} className="btn btn-primary mt-2 gap-2">
            Assign barcode
          </button>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span>Product has no barcode printed?</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm gap-1.5"
              disabled={!addSku || generating}
              onClick={generateInternalCode}
              title={addSku ? `Generate a unique internal code for ${addSku}` : "Pick a product first"}
            >
              <QrCode className="h-3.5 w-3.5" /> {generating ? "Generating…" : "Generate internal code"}
            </button>
          </div>

          <div className="scrollbar-thin mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th><th>SKU</th><th>Barcode</th><th>Format</th><th>Primary</th><th></th>
                </tr>
              </thead>
              <tbody>
                {barcodeListLoading && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
                )}
                {!barcodeListLoading && barcodes.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No barcodes yet. Use the lookup tab or Add-one-above.</td></tr>
                )}
                {barcodes.map((b) => (
                  <tr key={b.id}>
                    <td className="font-medium">{b.product_name}</td>
                    <td className="font-mono text-xs">{b.sku}</td>
                    <td className="font-mono text-xs">{b.barcode}</td>
                    <td><Badge tone="brand">{b.format}</Badge></td>
                    <td>{b.is_primary ? "Primary" : ""}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => removeBarcode(b.id)}
                        aria-label="Remove barcode"
                        className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Surface>
      )}

      {/* ========== Label printing ========== */}
      {activeTab === "labels" && (
        <Surface className="p-4 sm:p-5">
          <SectionHeader
            eyebrow="Print"
            title="Label printer"
            description="Generate scannable product labels for your printer. Requires a primary barcode assigned to the product."
          />

          <div className="mt-4 grid gap-3 sm:grid-cols-2 print:hidden">
            <label>
              <span className="field-label">Product</span>
              <select value={labelSku} onChange={(e) => setLabelSku(e.target.value)} className="input mt-1">
                <option value="">Select product…</option>
                {productOptions.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="field-label">Copies</span>
              <input type="number" min={1} max={200} value={labelCount} onChange={(e) => setLabelCount(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} className="input mt-1" />
            </label>
          </div>

          <div className="mt-4 flex items-center gap-3 print:hidden">
            <button type="button" onClick={() => window.print()} disabled={!labelProduct || !labelBarcode} className="btn btn-primary gap-2">
              <Printer className="h-4 w-4" /> Print labels
            </button>
            {labelProduct && !labelBarcode && (
              <p className="text-xs text-amber-800">No barcode assigned to this SKU — use Manage Barcodes first.</p>
            )}
          </div>

          {labelProduct && labelBarcode && (
            <div className="barcode-print-sheet mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: labelCount }).map((_, i) => (
                <LabelPrintTile key={i} product={labelProduct} barcode={labelBarcode} format={barcodes.find((b) => b.sku === labelSku)?.format ?? "CODE128"} />
              ))}
            </div>
          )}
        </Surface>
      )}
    </div>
  );
}

function FieldItem({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={mono ? "mt-0.5 font-mono text-sm text-foreground" : "mt-0.5 text-sm text-foreground"}>{value}</dd>
    </div>
  );
}

function LabelPrintTile({ product, barcode, format }: { product: Product; barcode: string; format: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [svg, setSvg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    QRCode.toString(barcode, { type: "svg", margin: 0, width: 200, color: { dark: "#061222", light: "#ffffff" } })
      .then((markup) => {
        if (!cancelled) setSvg(markup as unknown as string);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [barcode]);

  return (
    <div
      ref={ref}
      className="print-break-inside-avoid flex h-28 w-full flex-col items-center justify-between rounded-lg border-2 border-foreground bg-white p-2 text-center text-black"
    >
      <p className="text-[9px] font-black uppercase tracking-wider">{product.name.slice(0, 42)}</p>
      <div
        className="h-12 w-full flex items-center justify-center [&>svg]:h-full [&>svg]:w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="w-full">
        <p className="font-mono text-[10px] font-bold tracking-[0.2em]">{barcode}</p>
        <p className="text-[8px] font-semibold text-black/60">{format} · {product.sku}</p>
      </div>
    </div>
  );
}
