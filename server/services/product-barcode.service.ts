import crypto from "node:crypto";
import { getDb, withTransaction } from "@/server/db/connection";
import { ApiError } from "@/server/core/http";
import {
  AuthenticatedUser,
  assertPermission,
  hasPermission,
  recordAuditEvent,
  requireMutationAuthorization
} from "@/server/security/auth";
import {
  listProducts
} from "@/server/services/product-master.service";
import type { Product } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ProductBarcodeRecord {
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

export interface BarcodeLookupResult {
  barcode: string;
  found: boolean;
  product: Product | null;
  format?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function normalizeBarcode(raw: unknown): string {
  // Keep the full payload (including CODE-128 / QR content) — only strip
  // human-ish separators. Uppercasing is applied for stable comparisons.
  const cleaned = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s\-_.]+/g, "");
  return cleaned;
}

interface EANValidation {
  valid: boolean;
  reason?: string;
}

function eanChecksum(barcode: string, weights: number[]): EANValidation {
  const digits = barcode.split("").map(Number);
  const check = digits[digits.length - 1];
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    sum += body[i] * weights[i];
  }
  const expected = (10 - (sum % 10)) % 10;
  return check === expected
    ? { valid: true }
    : { valid: false, reason: `Check digit ${check} invalid; expected ${expected}.` };
}

function alternatingWeights(length: number): number[] {
  const weights = new Array<number>(length).fill(1);
  for (let i = 1; i < weights.length; i += 2) weights[i] = 3;
  return weights;
}

/** Normalise a format label to one of the supported canonical names. */
function normalizeFormatName(format: unknown): string {
  const f = String(format ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s\-_]+/g, "");
  switch (f) {
    case "EAN13": return "EAN-13";
    case "EAN8": return "EAN-8";
    case "UPCA": return "UPC-A";
    case "UPCE": return "UPC-E";
    case "CODE39": return "CODE39";
    case "CODE128": return "CODE128";
    case "QR": return "QR";
    default: return "CODE128";
  }
}

/**
 * Check digit validation, applied ONLY to the formats that carry one.
 *   EAN-13 / UPC-A → alternating 1/3 weights (EAN-13 maths is the same family)
 *   EAN-8           → alternating 3/1 weights starting from the left
 *   CODE-128 / CODE-39 / QR / UPC-E → NO checksum rule (their integrity is handled
 *     by the symbol's own ECC/check character, not by a payload check digit)
 * When no format hint is given, digit-only codes of 8/12/13 length are still
 * validated so a mistyped retail code is caught at the scanner either way.
 */
function validateChecksum(barcode: string, format?: string): EANValidation {
  if (format === undefined || format === null) {
    // No format hint — validate known digit shapes only; anything else passes through.
    if (/^[0-9]{8}$/.test(barcode)) {
      return eanChecksum(barcode, [3, 1, 3, 1, 3, 1, 3]);
    }
    if (/^[0-9]{12}$/.test(barcode) || /^[0-9]{13}$/.test(barcode)) {
      return eanChecksum(barcode, alternatingWeights(barcode.length - 1));
    }
    return { valid: true };
  }
  const fmt = normalizeFormatName(format);
  if (fmt === "CODE128" || fmt === "CODE39" || fmt === "QR" || fmt === "UPC-E") {
    return { valid: true };
  }
  if (fmt === "EAN-8") {
    if (!/^[0-9]{8}$/.test(barcode)) {
      return { valid: false, reason: "EAN-8 must be exactly 8 digits." };
    }
    return eanChecksum(barcode, [3, 1, 3, 1, 3, 1, 3]);
  }
  if (fmt === "EAN-13") {
    if (!/^[0-9]{13}$/.test(barcode)) {
      return { valid: false, reason: "EAN-13 must be exactly 13 digits." };
    }
    return eanChecksum(barcode, alternatingWeights(12));
  }
  if (fmt === "UPC-A") {
    if (!/^[0-9]{12}$/.test(barcode)) {
      return { valid: false, reason: "UPC-A must be exactly 12 digits." };
    }
    return eanChecksum(barcode, alternatingWeights(11));
  }
  return { valid: true };
}

function validateBarcode(barcode: string, format?: string) {
  if (!barcode) {
    throw new ApiError(400, "BARCODE_REQUIRED", "A barcode value is required.");
  }
  if (barcode.length < 8 || barcode.length > 128) {
    throw new ApiError(400, "BARCODE_INVALID", "Barcode must be 8–128 characters long.");
  }
  const check = validateChecksum(barcode, format);
  if (!check.valid) {
    throw new ApiError(400, "BARCODE_CHECKSUM_MISMATCH", `Barcode checksum mismatch: ${check.reason}`);
  }
  return barcode;
}

const BARCODE_FORMATS = new Set([
  "EAN-13",
  "EAN-8",
  "UPC-A",
  "UPC-E",
  "CODE128",
  "CODE39",
  "QR",
]);

function normalizeFormat(format: unknown): string {
  const f = normalizeFormatName(format);
  return BARCODE_FORMATS.has(f) ? f : "CODE128";
}

interface BarcodeRow {
  id: string;
  product_id: string;
  barcode: string;
  format: string;
  is_primary: number;
  created_at: string;
}

function toRecord(row: BarcodeRow, sku: string, productName: string): ProductBarcodeRecord {
  return {
    id: row.id,
    product_id: row.product_id,
    product_sku: sku,
    product_name: productName,
    sku,
    barcode: row.barcode,
    format: row.format,
    is_primary: row.is_primary === 1,
    created_at: row.created_at
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export function listProductBarcodes(
  actor: AuthenticatedUser,
  productSku?: string
): ProductBarcodeRecord[] {
  assertPermission(actor, "products:read");
  const db = getDb();
  const rows = productSku
    ? (db
        .prepare(
          `SELECT b.id, b.product_id, b.barcode, b.format, b.is_primary, b.created_at,
                  p.sku, p.name AS product_name
           FROM product_barcodes b
           JOIN products p ON p.id = b.product_id
           WHERE p.sku = ?
           ORDER BY b.is_primary DESC, b.created_at ASC`
        )
        .all(productSku) as unknown as Array<BarcodeRow & { sku: string; product_name: string }>)
    : (db
        .prepare(
          `SELECT b.id, b.product_id, b.barcode, b.format, b.is_primary, b.created_at,
                  p.sku, p.name AS product_name
           FROM product_barcodes b
           JOIN products p ON p.id = b.product_id
           ORDER BY p.sku ASC, b.is_primary DESC, b.created_at ASC`
        )
        .all() as unknown as Array<BarcodeRow & { sku: string; product_name: string }>);

  return rows.map((row) => toRecord(row, row.sku, row.product_name));
}

export function lookupBarcode(
  actor: AuthenticatedUser,
  rawBarcode: unknown
): BarcodeLookupResult {
  assertPermission(actor, "products:read");
  const barcode = validateBarcode(normalizeBarcode(rawBarcode));
  const db = getDb();

  const row = db
    .prepare(
      `SELECT b.id AS barcode_id, b.format, p.sku
       FROM product_barcodes b
       JOIN products p ON p.id = b.product_id
       WHERE b.barcode = ?`
    )
    .get(barcode) as { barcode_id: string; format: string; sku: string } | undefined;

  if (!row) {
    return { barcode, found: false, product: null };
  }

  const product = listProducts().find((p: Product) => p.sku === row.sku) ?? null;
  return { barcode, found: Boolean(product), product, format: row.format };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
export function addBarcodeForProduct(
  actor: AuthenticatedUser,
  input: { product_sku: string; barcode: string; format?: string; is_primary?: boolean }
): ProductBarcodeRecord {
  assertPermission(actor, "products:write");
  requireMutationAuthorization(actor, "add barcode for product");

  const format = normalizeFormat(input.format);
  // Format-aware validation — an 8-digit code is rejected for EAN-13 etc.
  const barcode = validateBarcode(normalizeBarcode(input.barcode), format);
  const db = getDb();

  const product = db
    .prepare("SELECT id, sku, name FROM products WHERE sku = ?")
    .get(input.product_sku) as { id: string; sku: string; name: string } | undefined;

  if (!product) {
    throw new ApiError(404, "PRODUCT_NOT_FOUND", `Product '${input.product_sku}' not found.`);
  }

  const duplicate = db
    .prepare(
      `SELECT b.id, p.sku AS owner_sku
       FROM product_barcodes b JOIN products p ON p.id = b.product_id
       WHERE b.barcode = ?`
    )
    .get(barcode) as { id: string; owner_sku: string } | undefined;

  if (duplicate) {
    throw new ApiError(
      409,
      "BARCODE_DUPLICATE",
      `Barcode '${barcode}' is already assigned to ${duplicate.owner_sku}.`
    );
  }

  const isPrimary = !!input.is_primary;
  const id = crypto.randomUUID();

  const created = withTransaction(() => {
    if (isPrimary) {
      db.prepare("UPDATE product_barcodes SET is_primary = 0 WHERE product_id = ?").run(product.id);
    }
    db.prepare(
      `INSERT INTO product_barcodes (id, product_id, barcode, format, is_primary, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, product.id, barcode, format, isPrimary ? 1 : 0, actor.email);

    return db
      .prepare(
        `SELECT b.id, b.product_id, b.barcode, b.format, b.is_primary, b.created_at
         FROM product_barcodes b WHERE b.id = ?`
      )
      .get(id) as unknown as BarcodeRow;
  });

  recordAuditEvent({
    actor,
    action: "product.barcode_added",
    entityType: "ProductBarcode",
    entityId: created.id,
    after: { sku: product.sku, barcode, format, is_primary: isPrimary },
    ipAddress: "127.0.0.1"
  });

  return toRecord(created, product.sku, product.name);
}

/**
 * Generate a unique internal barcode for products that arrive with NO
 * manufacturer code (loose produce, own-brand, bulk). Format: ASC#########
 * (CODE-128 payload — internal labels only, NOT an EAN). Registered against
 * the product like any other barcode, so it scans everywhere the same way.
 * Set as primary automatically when the product has no barcodes yet.
 */
export function generateInternalBarcode(
  actor: AuthenticatedUser,
  input: { product_sku: string }
): ProductBarcodeRecord {
  assertPermission(actor, "products:write");
  requireMutationAuthorization(actor, "generate internal barcode");

  const db = getDb();
  const product = db
    .prepare("SELECT id, sku, name FROM products WHERE sku = ?")
    .get(input.product_sku) as { id: string; sku: string; name: string } | undefined;

  if (!product) {
    throw new ApiError(404, "PRODUCT_NOT_FOUND", `Product '${input.product_sku}' not found.`);
  }

  const created = withTransaction(() => {
    const hasPrimary = db
      .prepare("SELECT COUNT(*) as c FROM product_barcodes WHERE product_id = ? AND is_primary = 1")
      .get(product.id) as { c: number };

    const total = db.prepare("SELECT COUNT(*) as c FROM product_barcodes").get() as { c: number };
    let code = "";
    let seq = Number(total.c) + 1;
    for (let attempt = 0; attempt < 200; attempt++) {
      code = `ASC${String(seq).padStart(9, "0")}`;
      const exists = db
        .prepare("SELECT id FROM product_barcodes WHERE barcode = ?")
        .get(code);
      if (!exists) break;
      seq += 1;
    }

    const id = crypto.randomUUID();
    const makePrimary = Number(hasPrimary.c) === 0;
    if (makePrimary) {
      db.prepare("UPDATE product_barcodes SET is_primary = 0 WHERE product_id = ?").run(product.id);
    }
    db.prepare(
      `INSERT INTO product_barcodes (id, product_id, barcode, format, is_primary, created_by)
       VALUES (?, ?, ?, 'CODE128', ?, ?)`
    ).run(id, product.id, code, makePrimary ? 1 : 0, actor.email);

    return db
      .prepare(
        `SELECT b.id, b.product_id, b.barcode, b.format, b.is_primary, b.created_at
         FROM product_barcodes b WHERE b.id = ?`
      )
      .get(id) as unknown as BarcodeRow;
  });

  recordAuditEvent({
    actor,
    action: "product.barcode_generated",
    entityType: "ProductBarcode",
    entityId: created.id,
    after: { sku: product.sku, barcode: created.barcode, format: "CODE128" },
    ipAddress: "127.0.0.1"
  });

  return toRecord(created, product.sku, product.name);
}

export function removeBarcode(
  actor: AuthenticatedUser,
  barcodeId: string
): { removed: boolean } {
  assertPermission(actor, "products:write");
  requireMutationAuthorization(actor, "remove product barcode");
  const db = getDb();

  const row = db
    .prepare(
      `SELECT b.id, b.barcode, p.sku
       FROM product_barcodes b JOIN products p ON p.id = b.product_id
       WHERE b.id = ?`
    )
    .get(barcodeId) as { id: string; barcode: string; sku: string } | undefined;

  if (!row) {
    throw new ApiError(404, "BARCODE_NOT_FOUND", "Barcode not found.");
  }

  db.prepare("DELETE FROM product_barcodes WHERE id = ?").run(barcodeId);

  recordAuditEvent({
    actor,
    action: "product.barcode_removed",
    entityType: "ProductBarcode",
    entityId: barcodeId,
    before: { sku: row.sku, barcode: row.barcode },
    ipAddress: "127.0.0.1"
  });

  return { removed: true };
}

// ---------------------------------------------------------------------------
// Scan events (lightweight audit-style trail; FEFO/inventory transactions
// remain authoritative for quantity movements)
// ---------------------------------------------------------------------------
export interface ScanEventInput {
  barcode: string;
  operation: string;
  reference_id?: string | null;
  quantity?: number | null;
  result?: string;
  product_id?: string | null;
  product_sku?: string | null;
}

export function recordScanEvent(
  actor: AuthenticatedUser,
  input: ScanEventInput
): { id: string; deduplicated?: boolean } {
  const barcode = normalizeBarcode(input.barcode);
  const operation = String(input.operation ?? "scan").trim().slice(0, 64) || "scan";
  const result = String(input.result ?? "unknown").trim().slice(0, 32) || "unknown";

  const isAuthorized =
    hasPermission(actor, "warehouse:update") ||
    hasPermission(actor, "inventory:read") ||
    hasPermission(actor, "inventory.pick") ||
    hasPermission(actor, "putaway.execute") ||
    hasPermission(actor, "quality.inspect");

  if (!isAuthorized) {
    throw new ApiError(
      403,
      "SCAN_NOT_AUTHORIZED",
      "Your role is not allowed to record operational scans for this operation."
    );
  }

  const db = getDb();

  // Same user re-scanning the same code for the same reference within 3s is a
  // double-scan (double-click / camera re-fire) — dedupe instead of writing noise.
  const existing = db
    .prepare(
      `SELECT id FROM scan_events
        WHERE user_id = ? AND barcode = ? AND operation = ?
          AND IFNULL(reference_id, '') = IFNULL(?, '') AND result = ?
          AND created_at >= datetime('now', '-3 seconds')
        ORDER BY created_at DESC LIMIT 1`
    )
    .get(actor.id, barcode, operation, input.reference_id ?? null, result) as
    | { id: string }
    | undefined;
  if (existing) {
    return { id: existing.id, deduplicated: true };
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO scan_events
      (id, user_id, user_email, user_role, barcode, product_id, product_sku, operation, reference_id, quantity, result)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    actor.id,
    actor.email,
    actor.role,
    barcode,
    input.product_id ?? null,
    input.product_sku ?? null,
    operation,
    input.reference_id ?? null,
    input.quantity ?? null,
    result
  );

  return { id };
}
