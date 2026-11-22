/**
 * Registers a product discovered via an external catalogue as an authoritative
 * Ascentra record — only after explicit human confirmation. The caller (UI)
 * must pass confirmed_external: true; the server re-validates everything.
 *
 * Two modes:
 *  - "create"    — create a brand-new Ascentra product and register the barcode
 *  - "associate" — register the barcode against an existing product
 */
import { getDb } from "@/server/db/connection";
import { ApiError } from "@/server/core/http";
import { recordAuditEvent, type AuthenticatedUser } from "@/server/security/auth";
import {
  createProduct,
  getProductDetail,
  type ProductWriteInput
} from "@/server/services/product-master.service";
import type { ProductDetail } from "@/lib/types";
import {
  normalizeBarcode,
  addBarcodeForProduct,
  type ProductBarcodeRecord
} from "@/server/services/product-barcode.service";

export interface ExternalProductInput {
  mode: "create" | "associate";
  barcode: string;
  confirmed_external?: boolean;
  name?: string;
  brand?: string | null;
  category?: string | null;
  quantity?: string | null;
  ingredients?: string | null;
  image_url?: string | null;
  source?: string | null;
  sku?: string;
  associate_to_sku?: string;
  unit_price_cents?: number;
  vat_rate_pct?: number;
  shelf_life_days?: number;
  min_shelf_life_days?: number;
  temp_zone?: string;
  origin?: string | null;
  force?: boolean;
}

export interface ExternalProductResult {
  product: ProductDetail;
  barcode: ProductBarcodeRecord;
}

const SKU_SAFE = /^[A-Z0-9][A-Z0-9._-]{1,47}$/;

function detectFormat(barcode: string): string {
  if (/^[0-9]{8}$/.test(barcode)) return "EAN-8";
  if (/^[0-9]{12}$/.test(barcode)) return "UPC-A";
  if (/^[0-9]{13}$/.test(barcode)) return "EAN-13";
  return "CODE128";
}
function sanitizeText(value: unknown, max = 400): string | null {
  const s = String(value ?? "").replace(/[\x00-\x1F\x7F]+/g, " ").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}
function sanitizeNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function registerExternalProduct(
  actor: AuthenticatedUser,
  input: ExternalProductInput
): ExternalProductResult {
  if (input.confirmed_external !== true) {
    throw new ApiError(
      400,
      "CONFIRMATION_REQUIRED",
      "This action registers externally sourced data — the user must review and explicitly confirm it first."
    );
  }

  const barcode = normalizeBarcode(input.barcode);
  if (!barcode) throw new ApiError(400, "BARCODE_REQUIRED", "A barcode value is required.");
  if (barcode.length < 8 || barcode.length > 128) {
    throw new ApiError(400, "BARCODE_INVALID", "Barcode must be 8–128 characters long.");
  }

  const db = getDb();

  const dup = db
    .prepare(
      `SELECT b.id, p.sku AS owner_sku FROM product_barcodes b
       JOIN products p ON p.id = b.product_id WHERE b.barcode = ?`
    )
    .get(barcode) as { id: string; owner_sku: string } | undefined;
  if (dup) {
    throw new ApiError(
      409,
      "BARCODE_DUPLICATE",
      `Barcode '${barcode}' is already assigned to ${dup.owner_sku}.`
    );
  }

  const source = sanitizeText(input.source, 120) ?? "external";
  const format = detectFormat(barcode);

  // ------------------------------------------------------------------
  if (input.mode === "associate") {
    const sku = String(input.associate_to_sku ?? "").trim().toUpperCase();
    if (!sku) throw new ApiError(400, "SKU_REQUIRED", "associate_to_sku is required for associate mode.");
    const productRow = db.prepare("SELECT id FROM products WHERE upper(sku) = ?").get(sku);
    if (!productRow) {
      throw new ApiError(404, "PRODUCT_NOT_FOUND", `Product '${sku}' not found.`);
    }
    const created = addBarcodeForProduct(actor, { product_sku: sku, barcode, format, is_primary: false });
    recordAuditEvent({
      actor,
      action: "product.barcode_associated_external",
      entityType: "ProductBarcode",
      entityId: created.id,
      after: { barcode, sku, source, format }
    });
    return { product: getProductDetail(sku), barcode: created };
  }

  if (input.mode !== "create") {
    throw new ApiError(400, "MODE_REQUIRED", "mode must be 'create' or 'associate'.");
  }

  const name = sanitizeText(input.name, 200);
  if (!name) throw new ApiError(400, "VALIDATION_ERROR", "A product name is required.");

  if (!input.force) {
    const dupName = db
      .prepare(
        `SELECT sku, name FROM products WHERE lower(name) = lower(?)
         AND lower(COALESCE(brand,'')) = lower(COALESCE(?,'')) LIMIT 1`
      )
      .get(name, sanitizeText(input.brand, 120) ?? "") as
      | { sku: string; name: string }
      | undefined;
    if (dupName) {
      throw new ApiError(
        409,
        "DUPLICATE_PRODUCT",
        `A product already exists with this name and brand: ${dupName.sku} — ${dupName.name}. Associate the barcode to it instead.`,
        { existing_sku: dupName.sku }
      );
    }
  }

  const sku = sanitizeText(input.sku, 48) ??
    `EXT-${barcode.slice(-10).replace(/[^A-Z0-9]/gi, "").toUpperCase()}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
  if (!SKU_SAFE.test(sku)) {
    throw new ApiError(422, "INVALID_SKU", "SKU must be 2–48 characters using letters, numbers, dots, dashes or underscores.");
  }

  const category = sanitizeText(input.category, 80) ?? "Ambient";
  const writeInput: ProductWriteInput = {
    sku,
    name,
    category,
    brand: sanitizeText(input.brand, 120) ?? "",
    origin: sanitizeText(input.origin, 80) ?? "Italy",
    description: sanitizeText(input.ingredients ?? input.name, 400) ?? "",
    status: "active",
    base_uom: "kg",
    pack_uom: "Case",
    units_per_case: 1,
    unit_weight_kg: 1,
    catch_weight: false,
    shelf_life_days: sanitizeNum(input.shelf_life_days, 1, 3650, 30),
    min_shelf_life_days: sanitizeNum(input.min_shelf_life_days, 1, 3650, 30),
    temp_zone: sanitizeText(input.temp_zone, 60) ?? "Ambient (+14°C to +20°C)",
    unit_price_cents: sanitizeNum(input.unit_price_cents, 0, 100_000_00, 0),
    vat_rate_pct: sanitizeNum(input.vat_rate_pct, 0, 100, 4),
    currency: "EUR"
  };

  const product = createProduct(actor, writeInput);
  const createdBarcode = addBarcodeForProduct(actor, {
    product_sku: product.sku,
    barcode,
    format,
    is_primary: true
  });

  recordAuditEvent({
    actor,
    action: "product.created_from_external",
    entityType: "Product",
    entityId: product.sku,
    after: {
      sku: product.sku,
      name: product.name,
      barcode,
      format,
      source
    }
  });

  return { product, barcode: createdBarcode };
}
