import {
  getDb,
  withTransaction
} from "@/server/db/connection";
import { ApiError } from "@/server/core/http";
import { notifyUsersWithPermission } from "@/server/services/notification.service";
import {
  AuthenticatedUser,
  assertPermission,
  recordAuditEvent,
  requireMutationAuthorization,
} from "@/server/security/auth";
import {
  BASE_UOMS,
  PACK_UOMS,
  TEMPERATURE_PROFILES,
  certificateStatus,
  formatQty,
  isCatchWeightCategory,
  temperatureProfileFor,
} from "@/lib/product-master";
import type {
  Product,
  ProductCertificate,
  ProductDetail,
  ProductPrice,
  ProductSupplierLink,
} from "@/lib/types";

function numericId(rawId: string, fallback: number): number {
  const digits = rawId.replace(/\D/g, "");
  if (digits.length > 0) {
    return Number(digits.slice(-6)) || fallback;
  }
  return fallback;
}

function stringOr(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

/** Accept only small embedded image data URLs or ordinary http(s) URLs. */
function sanitizeImageUrl(value: unknown, fallback = ""): string {
  const raw = stringOr(value, fallback);
  if (!raw) return "";
  if (raw.length > 1_500_000) return "";
  if (/^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i.test(raw)) return raw;
  if (/^https?:\/\/[^\s]+$/i.test(raw)) return raw.slice(0, 2000);
  return "";
}

function numberOr(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item).trim()).filter(Boolean)
      : [];
  } catch {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function deriveAllergens(category: string): string[] {
  const map: Record<string, string[]> = {
    Seafood: ["Fish", "Crustaceans", "Molluscs"],
    Dairy: ["Milk"],
    Bakery: ["Cereals containing gluten"],
    "Pasta & Bakery": ["Cereals containing gluten", "Eggs"],
    Charcuterie: ["Milk", "Mustard", "Sulphites"],
    Pantry: ["Cereals containing gluten", "Sulphites"],
  };
  return map[category] ?? [];
}

function normaliseStatus(value: string): Product["status"] {
  return value === "hold" || value === "discontinued" ? value : "active";
}

// Legacy rows store a short zone such as "chilled" or "frozen" instead of the
// full profile label. Normalise it so the UI always shows a consistent profile.
function normaliseTemperatureProfile(value: string): string {
  const raw = value.trim();
  if (!raw) return "Chilled 0–4°C";
  if (TEMPERATURE_PROFILES.some((profile) => profile.label === raw)) return raw;
  const lower = raw.toLowerCase();
  if (lower.includes("frozen") || lower.includes("freeze")) return "Frozen -18°C";
  if (lower.includes("ambient")) return "Ambient 12–24°C";
  return "Chilled 0–4°C";
}

function mapProduct(row: Record<string, unknown>, index: number): Product {
  const category = stringOr(row.category, "Produce");
  const shelfLifeDays = Math.max(1, numberOr(row.shelf_life_days, 1));
  const storedAllergens = parseStringArray(row.allergens_json);
  const catchWeight =
    row.catch_weight === null || row.catch_weight === undefined
      ? isCatchWeightCategory(category)
      : Number(row.catch_weight) === 1;
  const legacyUom = stringOr(row.uom);
  const baseUom = stringOr(
    row.base_uom,
    (BASE_UOMS as readonly string[]).includes(legacyUom)
      ? legacyUom
      : catchWeight
        ? "kg"
        : "each",
  );
  const packUom = stringOr(
    row.pack_uom,
    (PACK_UOMS as readonly string[]).includes(legacyUom) ? legacyUom : "Case",
  );
  const unitsPerCase = Math.max(1, Math.round(numberOr(row.units_per_case, 1)));
  const unitWeightKg = Math.max(0, numberOr(row.unit_weight_kg, 0));
  const caseWeightKg = Math.max(
    0,
    numberOr(row.case_weight_kg, unitWeightKg > 0 ? unitWeightKg * unitsPerCase : 0),
  );
  const tempProfile = normaliseTemperatureProfile(
    stringOr(row.temp_zone, "Chilled 0–4°C"),
  );
  const profile = temperatureProfileFor(tempProfile);

  return {
    id: numericId(stringOr(row.id, String(index + 1)), index + 1),
    sku: stringOr(row.sku),
    name: stringOr(row.name),
    category,
    unit: catchWeight ? "kg" : "case",
    pack_size: stringOr(row.uom, `${packUom} (${formatQty(caseWeightKg)} ${baseUom})`),
    temperature_profile: tempProfile,
    shelf_life_days: shelfLifeDays,
    min_shelf_life_days: Math.max(
      1,
      Math.round(
        numberOr(
          row.min_shelf_life_days,
          Math.max(2, Math.floor(shelfLifeDays * 0.4)),
        ),
      ),
    ),
    catch_weight: catchWeight,
    allergens: storedAllergens.length ? storedAllergens : deriveAllergens(category),
    unit_price_cents: Math.max(0, Math.round(numberOr(row.unit_price_cents, 0))),
    supplier_name: stringOr(row.supplier_name, "Unassigned"),
    status: normaliseStatus(stringOr(row.status, "active")),
    description: stringOr(row.description),
    brand: stringOr(row.brand),
    origin: stringOr(row.origin),
    hs_code: stringOr(row.hs_code),
    base_uom: baseUom,
    pack_uom: packUom,
    units_per_case: unitsPerCase,
    unit_weight_kg: unitWeightKg,
    case_weight_kg: caseWeightKg,
    catch_weight_min_kg: nullableNumber(row.catch_weight_min_kg) ?? undefined,
    catch_weight_max_kg: nullableNumber(row.catch_weight_max_kg) ?? undefined,
    tare_weight_kg: nullableNumber(row.tare_weight_kg) ?? undefined,
    may_contain: parseStringArray(row.may_contain_json),
    handling: parseStringArray(row.handling_json),
    diet_flags: parseStringArray(row.diet_flags_json),
    temp_min_c: nullableNumber(row.temp_min_c) ?? profile.minC,
    temp_max_c: nullableNumber(row.temp_max_c) ?? profile.maxC,
    cost_price_cents: nullableNumber(row.cost_price_cents) ?? undefined,
    vat_rate_pct: numberOr(row.vat_rate_pct, 4),
    currency: stringOr(row.currency, "EUR"),
    supplier_id: stringOr(row.supplier_id) || undefined,
    supplier_sku: stringOr(row.supplier_sku) || undefined,
    image_url: sanitizeImageUrl(row.image_url) || undefined,
    image_source: stringOr(row.image_source) || undefined,
    certificate_count: Math.max(0, Math.round(numberOr(row.certificate_count, 0))),
    expiring_certificate_count: Math.max(
      0,
      Math.round(numberOr(row.expiring_certificate_count, 0)),
    ),
  };
}

export function listProducts(): Product[] {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT
        p.*,
        COALESCE(SUM(CASE WHEN l.quality_status = 'released' THEN l.quantity_cases ELSE 0 END), 0) AS computed_stock_cases,
        (SELECT COUNT(*) FROM product_certificates c WHERE c.sku = p.sku) AS certificate_count,
        (SELECT COUNT(*) FROM product_certificates c
          WHERE c.sku = p.sku
            AND date(c.valid_to) >= date('now')
            AND date(c.valid_to) <= date('now', '+30 day')) AS expiring_certificate_count
      FROM products p
      LEFT JOIN inventory_lots l ON l.sku = p.sku
      GROUP BY p.id
      ORDER BY p.sku ASC
    `,
    )
    .all<Record<string, unknown>>();

  return rows.map((row, index) => mapProduct(row, index));
}

function mapPrice(row: Record<string, unknown>): ProductPrice {
  const effectiveFrom = stringOr(row.effective_from);
  const effectiveTo = stringOr(row.effective_to) || null;
  const today = new Date().toISOString().slice(0, 10);
  const status: ProductPrice["status"] =
    effectiveTo && effectiveTo < today
      ? "expired"
      : effectiveFrom > today
        ? "scheduled"
        : "active";

  return {
    id: stringOr(row.id),
    price_type: (stringOr(row.price_type, "list") as ProductPrice["price_type"]) ?? "list",
    amount_cents: Math.max(0, Math.round(numberOr(row.amount_cents, 0))),
    currency: stringOr(row.currency, "EUR"),
    uom: stringOr(row.uom, "case"),
    customer_segment: stringOr(row.customer_segment) || null,
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
    status,
  };
}

function mapCertificate(row: Record<string, unknown>): ProductCertificate {
  const validTo = stringOr(row.valid_to);
  return {
    id: stringOr(row.id),
    certificate_type: stringOr(row.certificate_type, "HACCP"),
    certificate_number: stringOr(row.certificate_number),
    issuer: stringOr(row.issuer),
    valid_from: stringOr(row.valid_from),
    valid_to: validTo,
    status: certificateStatus(validTo),
    document_reference: stringOr(row.document_reference) || null,
    notes: stringOr(row.notes) || null,
  };
}

function mapSupplierLink(row: Record<string, unknown>): ProductSupplierLink {
  const status = stringOr(row.status, "approved");
  return {
    supplier_id: stringOr(row.supplier_id),
    supplier_name: stringOr(row.supplier_name, "Unassigned"),
    supplier_sku: stringOr(row.supplier_sku) || null,
    is_primary: Number(row.is_primary) === 1,
    lead_time_days: Math.max(0, Math.round(numberOr(row.lead_time_days, 0))),
    moq_cases: Math.max(1, Math.round(numberOr(row.moq_cases, 1))),
    cost_price_cents: Math.max(0, Math.round(numberOr(row.cost_price_cents, 0))),
    status:
      status === "review" || status === "blocked"
        ? status
        : "approved",
  };
}

export function getProductDetail(sku: string): ProductDetail {
  const product = listProducts().find(
    (item) => item.sku.toLowerCase() === sku.trim().toLowerCase(),
  );
  if (!product) {
    throw new ApiError(404, "PRODUCT_NOT_FOUND", `Product '${sku}' was not found.`);
  }

  const db = getDb();
  const prices = db
    .prepare(
      `SELECT * FROM product_prices WHERE lower(sku) = lower(?) ORDER BY effective_from DESC, created_at DESC`,
    )
    .all<Record<string, unknown>>(product.sku)
    .map(mapPrice);
  const certificates = db
    .prepare(
      `SELECT * FROM product_certificates WHERE lower(sku) = lower(?) ORDER BY valid_to ASC, certificate_type ASC`,
    )
    .all<Record<string, unknown>>(product.sku)
    .map(mapCertificate);
  const suppliers = db
    .prepare(
      `SELECT * FROM product_suppliers WHERE lower(sku) = lower(?) ORDER BY is_primary DESC, supplier_name ASC`,
    )
    .all<Record<string, unknown>>(product.sku)
    .map(mapSupplierLink);

  return { ...product, prices, certificates, suppliers };
}

export interface ProductCertificateInput {
  certificate_type: string;
  certificate_number: string;
  issuer: string;
  valid_from: string;
  valid_to: string;
  document_reference?: string;
  notes?: string;
}

export interface ProductWriteInput {
  sku?: string;
  name?: string;
  category?: string;
  origin?: string;
  description?: string;
  brand?: string;
  hs_code?: string;
  status?: string;
  base_uom?: string;
  pack_uom?: string;
  uom?: string;
  units_per_case?: number;
  unit_weight_kg?: number;
  case_weight_kg?: number;
  catch_weight?: boolean;
  catch_weight_min_kg?: number;
  catch_weight_max_kg?: number;
  tare_weight_kg?: number;
  allergens?: string[];
  may_contain?: string[];
  handling?: string[];
  diet_flags?: string[];
  temp_zone?: string;
  temperature_profile?: string;
  temp_min_c?: number;
  temp_max_c?: number;
  shelf_life_days?: number;
  min_shelf_life_days?: number;
  unit_price_cents?: number;
  cost_price_cents?: number;
  vat_rate_pct?: number;
  currency?: string;
  supplier?: string;
  supplier_name?: string;
  supplier_id?: string;
  supplier_sku?: string;
  lead_time_days?: number;
  moq_cases?: number;
  image_url?: string;
  image_source?: string;
  certificates?: ProductCertificateInput[];
}

interface NormalisedProduct {
  sku: string;
  name: string;
  category: string;
  origin: string;
  description: string;
  brand: string;
  hsCode: string;
  status: Product["status"];
  baseUom: string;
  packUom: string;
  legacyUom: string;
  unitsPerCase: number;
  unitWeightKg: number;
  caseWeightKg: number;
  catchWeight: boolean;
  catchMin: number;
  catchMax: number;
  tare: number;
  allergens: string[];
  mayContain: string[];
  handling: string[];
  dietFlags: string[];
  tempZone: string;
  tempMin: number;
  tempMax: number;
  shelfLifeDays: number;
  minShelfLifeDays: number;
  unitPriceCents: number;
  costPriceCents: number;
  vatRatePct: number;
  currency: string;
  supplierName: string;
  supplierId: string;
  supplierSku: string;
  leadTimeDays: number;
  moqCases: number;
  imageUrl: string;
  imageSource: string;
}

function normaliseProduct(
  input: ProductWriteInput,
  existing?: ProductDetail,
): NormalisedProduct {
  const category = stringOr(input.category, existing?.category ?? "Produce");
  const name = stringOr(input.name, existing?.name ?? "");
  const sku = stringOr(input.sku, existing?.sku ?? "").toUpperCase();
  const baseUom = stringOr(input.base_uom, existing?.base_uom ?? "kg");
  const packUom = stringOr(input.pack_uom, existing?.pack_uom ?? "Case");
  const unitsPerCase = Math.max(
    1,
    Math.round(numberOr(input.units_per_case, existing?.units_per_case ?? 1)),
  );
  const unitWeightKg = Math.max(
    0,
    numberOr(input.unit_weight_kg, existing?.unit_weight_kg ?? 0),
  );
  const caseWeightKg = Math.max(
    0,
    numberOr(
      input.case_weight_kg,
      existing?.case_weight_kg ?? unitWeightKg * unitsPerCase,
    ),
  );
  const catchWeight =
    input.catch_weight ??
    existing?.catch_weight ??
    isCatchWeightCategory(category);
  const catchMin = catchWeight
    ? Math.max(0, numberOr(input.catch_weight_min_kg, existing?.catch_weight_min_kg ?? 0))
    : 0;
  const catchMax = catchWeight
    ? Math.max(
        catchMin,
        numberOr(input.catch_weight_max_kg, existing?.catch_weight_max_kg ?? catchMin),
      )
    : 0;
  const tare = Math.max(0, numberOr(input.tare_weight_kg, existing?.tare_weight_kg ?? 0));

  const tempZone = stringOr(
    input.temperature_profile,
    stringOr(input.temp_zone, existing?.temperature_profile ?? "Chilled 0–4°C"),
  );
  const profile = temperatureProfileFor(tempZone);
  const tempMin = numberOr(input.temp_min_c, existing?.temp_min_c ?? profile.minC);
  const tempMax = numberOr(input.temp_max_c, existing?.temp_max_c ?? profile.maxC);

  const shelfLifeDays = Math.max(
    1,
    Math.round(numberOr(input.shelf_life_days, existing?.shelf_life_days ?? 14)),
  );
  const minShelfLifeDays = Math.min(
    shelfLifeDays,
    Math.max(
      1,
      Math.round(
        numberOr(
          input.min_shelf_life_days,
          existing?.min_shelf_life_days ?? Math.max(1, Math.floor(shelfLifeDays * 0.4)),
        ),
      ),
    ),
  );

  const unitPriceCents = Math.max(
    0,
    Math.round(numberOr(input.unit_price_cents, existing?.unit_price_cents ?? 0)),
  );
  const costPriceCents = Math.max(
    0,
    Math.round(numberOr(input.cost_price_cents, existing?.cost_price_cents ?? 0)),
  );

  return {
    sku,
    name,
    category,
    origin: stringOr(input.origin, existing?.origin ?? "Italy"),
    description: stringOr(input.description, existing?.description ?? ""),
    brand: stringOr(input.brand, existing?.brand ?? ""),
    hsCode: stringOr(input.hs_code, existing?.hs_code ?? ""),
    status: normaliseStatus(stringOr(input.status, existing?.status ?? "active")),
    baseUom,
    packUom,
    legacyUom:
      caseWeightKg > 0
        ? `${packUom} (${formatQty(caseWeightKg)} ${baseUom})`
        : packUom,
    unitsPerCase,
    unitWeightKg,
    caseWeightKg,
    catchWeight,
    catchMin,
    catchMax,
    tare,
    allergens: uniqueStrings(input.allergens ?? existing?.allergens ?? []),
    mayContain: uniqueStrings(input.may_contain ?? existing?.may_contain ?? []),
    handling: uniqueStrings(input.handling ?? existing?.handling ?? []),
    dietFlags: uniqueStrings(input.diet_flags ?? existing?.diet_flags ?? []),
    tempZone,
    tempMin,
    tempMax,
    shelfLifeDays,
    minShelfLifeDays,
    unitPriceCents,
    costPriceCents,
    vatRatePct: Math.max(0, numberOr(input.vat_rate_pct, existing?.vat_rate_pct ?? 4)),
    currency: stringOr(input.currency, existing?.currency ?? "EUR").toUpperCase(),
    supplierName:
      stringOr(
        input.supplier_name,
        stringOr(input.supplier, existing?.supplier_name ?? ""),
      ) || "Unassigned",
    supplierId: stringOr(input.supplier_id, existing?.supplier_id ?? ""),
    supplierSku: stringOr(input.supplier_sku, existing?.supplier_sku ?? ""),
    leadTimeDays: Math.max(
      1,
      Math.round(numberOr(input.lead_time_days, 2)),
    ),
    moqCases: Math.max(1, Math.round(numberOr(input.moq_cases, 1))),
    imageUrl: sanitizeImageUrl(input.image_url, existing?.image_url ?? ""),
    imageSource: stringOr(input.image_source, existing?.image_source ?? "").slice(0, 120),
  };
}

function assertValidProduct(product: NormalisedProduct): void {
  if (!product.sku || !product.name) {
    throw new ApiError(422, "VALIDATION_ERROR", "Product SKU and name are required.");
  }
  if (!/^[A-Z0-9][A-Z0-9._-]{1,47}$/.test(product.sku)) {
    throw new ApiError(
      422,
      "INVALID_SKU",
      "SKU must be 2–48 characters using letters, numbers, dots, dashes or underscores.",
    );
  }
  if (product.tempMin >= product.tempMax) {
    throw new ApiError(
      422,
      "INVALID_TEMPERATURE_PROFILE",
      "Minimum storage temperature must be below the maximum.",
    );
  }
  if (product.catchWeight && product.catchMax < product.catchMin) {
    throw new ApiError(
      422,
      "INVALID_CATCH_WEIGHT",
      "Catch-weight maximum must be greater than or equal to the minimum.",
    );
  }
  if (product.catchWeight && product.catchMin > 0 && product.catchMax <= 0) {
    throw new ApiError(
      422,
      "INVALID_CATCH_WEIGHT",
      "Catch-weight maximum must be greater than zero.",
    );
  }
}

function ensureSupplier(
  db: ReturnType<typeof getDb>,
  product: NormalisedProduct,
): string | null {
  if (!product.supplierName || product.supplierName === "Unassigned") {
    return null;
  }

  const byId = product.supplierId
    ? db
        .prepare(`SELECT id FROM suppliers WHERE id = ?`)
        .get<{ id: string }>(product.supplierId)
    : undefined;
  const byName = db
    .prepare(`SELECT id FROM suppliers WHERE lower(name) = lower(?)`)
    .get<{ id: string }>(product.supplierName);
  const existing = byId ?? byName;

  if (existing) return existing.id;

  const newId = `SUP-${Date.now().toString(36).toUpperCase()}-${Math.floor(
    Math.random() * 900 + 100,
  )}`;
  db.prepare(
    `
    INSERT INTO suppliers (
      id, name, country, region, categories_json, lead_time_days,
      otif_pct, quality_score, open_pos_count, payment_terms, certifications_json, status
    ) VALUES (?, ?, 'Italy', 'Italy', ?, ?, 98.0, 96.0, 0, 'Net 30', '["IFS Food","HACCP"]', 'approved')
  `,
  ).run(
    newId,
    product.supplierName,
    JSON.stringify([product.category]),
    product.leadTimeDays,
  );
  return newId;
}

function upsertSupplierLink(
  db: ReturnType<typeof getDb>,
  sku: string,
  product: NormalisedProduct,
  supplierId: string | null,
): void {
  if (!supplierId) return;
  db.prepare(
    `
    INSERT INTO product_suppliers (
      id, sku, supplier_id, supplier_name, supplier_sku, is_primary,
      lead_time_days, moq_cases, cost_price_cents, status
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'approved')
    ON CONFLICT(sku, supplier_id) DO UPDATE SET
      supplier_name = excluded.supplier_name,
      supplier_sku = excluded.supplier_sku,
      is_primary = 1,
      lead_time_days = excluded.lead_time_days,
      moq_cases = excluded.moq_cases,
      cost_price_cents = excluded.cost_price_cents
  `,
  ).run(
    `PSUP-${Date.now().toString(36).toUpperCase()}`,
    sku,
    supplierId,
    product.supplierName,
    product.supplierSku || null,
    product.leadTimeDays,
    product.moqCases,
    product.costPriceCents,
  );
  db.prepare(
    `UPDATE product_suppliers SET is_primary = 0 WHERE lower(sku) = lower(?) AND supplier_id <> ?`,
  ).run(sku, supplierId);
}

function insertPrice(
  db: ReturnType<typeof getDb>,
  actor: AuthenticatedUser,
  sku: string,
  input: {
    price_type: ProductPrice["price_type"];
    amount_cents: number;
    currency: string;
    uom: string;
    customer_segment?: string | null;
    effective_from?: string;
    effective_to?: string | null;
  },
): void {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(
    `
    INSERT INTO product_prices (
      id, sku, price_type, amount_cents, currency, uom, customer_segment,
      effective_from, effective_to, status, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `,
  ).run(
    `PRC-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`,
    sku,
    input.price_type,
    input.amount_cents,
    input.currency,
    input.uom,
    input.customer_segment || null,
    input.effective_from || today,
    input.effective_to || null,
    actor.email,
  );
}

function insertCertificate(
  db: ReturnType<typeof getDb>,
  actor: AuthenticatedUser,
  sku: string,
  input: ProductCertificateInput,
): void {
  const certificateType = stringOr(input.certificate_type);
  const certificateNumber = stringOr(input.certificate_number);
  const issuer = stringOr(input.issuer);
  const validFrom = stringOr(input.valid_from);
  const validTo = stringOr(input.valid_to);

  if (!certificateType || !certificateNumber || !issuer || !validFrom || !validTo) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Certificate type, number, issuer, valid-from and valid-to are required.",
    );
  }
  if (validTo < validFrom) {
    throw new ApiError(
      422,
      "INVALID_CERTIFICATE_DATES",
      "Certificate valid-to date must be on or after the valid-from date.",
    );
  }

  db.prepare(
    `
    INSERT INTO product_certificates (
      id, sku, certificate_type, certificate_number, issuer, valid_from,
      valid_to, status, document_reference, notes, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    `CERT-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`,
    sku,
    certificateType,
    certificateNumber,
    issuer,
    validFrom,
    validTo,
    certificateStatus(validTo),
    stringOr(input.document_reference) || null,
    stringOr(input.notes) || null,
    actor.email,
  );
}

export function createProduct(
  actor: AuthenticatedUser,
  input: ProductWriteInput,
): ProductDetail {
  assertPermission(actor, "products:write");
  requireMutationAuthorization(actor, "create product");

  const product = normaliseProduct(input);
  assertValidProduct(product);

  const db = getDb();
  const exists = db
    .prepare(`SELECT id FROM products WHERE upper(sku) = ?`)
    .get<{ id: string }>(product.sku);
  if (exists) {
    throw new ApiError(
      409,
      "DUPLICATE_SKU",
      `Product SKU '${product.sku}' already exists.`,
    );
  }

  const id = `PRD-${Date.now()}`;

  withTransaction(() => {
    const supplierId = ensureSupplier(db, product);

    db.prepare(
      `
      INSERT INTO products (
        id, sku, name, category, origin, uom, temp_zone, shelf_life_days,
        stock_cases, reorder_point_cases, unit_price_cents, vat_rate_pct,
        supplier_name, status, description, brand, hs_code, base_uom, pack_uom,
        units_per_case, unit_weight_kg, case_weight_kg, catch_weight,
        catch_weight_min_kg, catch_weight_max_kg, tare_weight_kg, allergens_json,
        may_contain_json, handling_json, diet_flags_json, temp_min_c, temp_max_c,
        min_shelf_life_days, cost_price_cents, currency, supplier_id, supplier_sku,
        image_url, image_source
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, 0, 25, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `,
    ).run(
      id,
      product.sku,
      product.name,
      product.category,
      product.origin,
      product.legacyUom,
      product.tempZone,
      product.shelfLifeDays,
      product.unitPriceCents,
      product.vatRatePct,
      product.supplierName,
      product.status,
      product.description,
      product.brand,
      product.hsCode,
      product.baseUom,
      product.packUom,
      product.unitsPerCase,
      product.unitWeightKg,
      product.caseWeightKg,
      product.catchWeight ? 1 : 0,
      product.catchMin,
      product.catchMax,
      product.tare,
      JSON.stringify(product.allergens),
      JSON.stringify(product.mayContain),
      JSON.stringify(product.handling),
      JSON.stringify(product.dietFlags),
      product.tempMin,
      product.tempMax,
      product.minShelfLifeDays,
      product.costPriceCents,
      product.currency,
      supplierId,
      product.supplierSku || null,
      product.imageUrl || null,
      product.imageSource || null,
    );

    upsertSupplierLink(db, product.sku, product, supplierId);

    if (product.unitPriceCents > 0) {
      insertPrice(db, actor, product.sku, {
        price_type: "list",
        amount_cents: product.unitPriceCents,
        currency: product.currency,
        uom: product.packUom,
      });
    }
    if (product.costPriceCents > 0) {
      insertPrice(db, actor, product.sku, {
        price_type: "cost",
        amount_cents: product.costPriceCents,
        currency: product.currency,
        uom: product.packUom,
      });
    }

    for (const certificate of input.certificates ?? []) {
      insertCertificate(db, actor, product.sku, certificate);
    }

    recordAuditEvent({
      actor,
      action: "master_data.product_created",
      entityType: "Product",
      entityId: product.sku,
      after: {
        sku: product.sku,
        name: product.name,
        category: product.category,
        catchWeight: product.catchWeight,
        allergens: product.allergens,
        temperature: { minC: product.tempMin, maxC: product.tempMax },
        shelfLifeDays: product.shelfLifeDays,
        unitPriceCents: product.unitPriceCents,
        supplier: product.supplierName,
        certificates: (input.certificates ?? []).length,
      },
    });
  });

  // Notify administrators that a new product was registered in the catalog.
  notifyUsersWithPermission("users.manage", {
    module: "Catalog",
    title: `New product — ${product.sku} · ${product.name}`,
    detail: `Registered by ${actor.name}. Category ${product.category} · ${product.supplierName}.`,
    href: "/products",
    severity: "info",
  });

  return getProductDetail(product.sku);
}

/**
 * "Delete" for a product is a soft delete: the SKU is kept for order/stock/audit
 * history and its status is flipped to "discontinued" (hidden from new orders,
 * FEFO allocation and barcode assignment). Hard-deleting would destroy history.
 */
export function discontinueProduct(
  actor: AuthenticatedUser,
  sku: string,
  reason?: string,
): ProductDetail {
  assertPermission(actor, "products:write");
  requireMutationAuthorization(actor, "delete product");

  const existing = getProductDetail(sku);
  if (existing.status === "discontinued") {
    // Idempotent: already deleted is a no-op success.
    return existing;
  }

  const updated = updateProduct(actor, sku, { status: "discontinued" });
  recordAuditEvent({
    actor,
    action: "master_data.product_discontinued",
    entityType: "Product",
    entityId: existing.sku,
    before: { status: existing.status, name: existing.name },
    after: { status: "discontinued", reason: reason?.slice(0, 500) ?? null },
  });
  return updated;
}

export function updateProduct(
  actor: AuthenticatedUser,
  sku: string,
  input: ProductWriteInput,
): ProductDetail {
  assertPermission(actor, "products:write");
  requireMutationAuthorization(actor, "update product");

  const existing = getProductDetail(sku);
  const product = normaliseProduct(input, existing);
  assertValidProduct(product);

  const db = getDb();

  withTransaction(() => {
    const supplierId = ensureSupplier(db, product);

    db.prepare(
      `
      UPDATE products SET
        name = ?, category = ?, origin = ?, uom = ?, temp_zone = ?,
        shelf_life_days = ?, unit_price_cents = ?, vat_rate_pct = ?,
        supplier_name = ?, status = ?, description = ?, brand = ?, hs_code = ?,
        base_uom = ?, pack_uom = ?, units_per_case = ?, unit_weight_kg = ?,
        case_weight_kg = ?, catch_weight = ?, catch_weight_min_kg = ?,
        catch_weight_max_kg = ?, tare_weight_kg = ?, allergens_json = ?,
        may_contain_json = ?, handling_json = ?, diet_flags_json = ?,
        temp_min_c = ?, temp_max_c = ?, min_shelf_life_days = ?,
        cost_price_cents = ?, currency = ?, supplier_id = ?, supplier_sku = ?,
        image_url = ?, image_source = ?
      WHERE sku = ?
    `,
    ).run(
      product.name,
      product.category,
      product.origin,
      product.legacyUom,
      product.tempZone,
      product.shelfLifeDays,
      product.unitPriceCents,
      product.vatRatePct,
      product.supplierName,
      product.status,
      product.description,
      product.brand,
      product.hsCode,
      product.baseUom,
      product.packUom,
      product.unitsPerCase,
      product.unitWeightKg,
      product.caseWeightKg,
      product.catchWeight ? 1 : 0,
      product.catchMin,
      product.catchMax,
      product.tare,
      JSON.stringify(product.allergens),
      JSON.stringify(product.mayContain),
      JSON.stringify(product.handling),
      JSON.stringify(product.dietFlags),
      product.tempMin,
      product.tempMax,
      product.minShelfLifeDays,
      product.costPriceCents,
      product.currency,
      supplierId,
      product.supplierSku || null,
      product.imageUrl || null,
      product.imageSource || null,
      existing.sku,
    );

    upsertSupplierLink(db, existing.sku, product, supplierId);

    recordAuditEvent({
      actor,
      action: "master_data.product_updated",
      entityType: "Product",
      entityId: existing.sku,
      before: {
        name: existing.name,
        category: existing.category,
        status: existing.status,
        unitPriceCents: existing.unit_price_cents,
        catchWeight: existing.catch_weight,
        allergens: existing.allergens,
      },
      after: {
        name: product.name,
        category: product.category,
        status: product.status,
        unitPriceCents: product.unitPriceCents,
        catchWeight: product.catchWeight,
        allergens: product.allergens,
      },
    });
  });

  return getProductDetail(existing.sku);
}

export function addProductCertificate(
  actor: AuthenticatedUser,
  sku: string,
  input: ProductCertificateInput,
): ProductCertificate {
  assertPermission(actor, "products:write");
  requireMutationAuthorization(actor, "add product certificate");
  const product = getProductDetail(sku);
  const db = getDb();

  return withTransaction(() => {
    insertCertificate(db, actor, product.sku, input);
    const created = db
      .prepare(
        `SELECT * FROM product_certificates WHERE sku = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get<Record<string, unknown>>(product.sku);
    if (!created) {
      throw new ApiError(500, "CERTIFICATE_CREATE_FAILED", "Unable to store certificate.");
    }
    recordAuditEvent({
      actor,
      action: "master_data.product_certificate_added",
      entityType: "ProductCertificate",
      entityId: stringOr(created.id),
      after: {
        sku: product.sku,
        type: input.certificate_type,
        number: input.certificate_number,
        valid_to: input.valid_to,
      },
    });
    return mapCertificate(created);
  });
}

export function deleteProductCertificate(
  actor: AuthenticatedUser,
  sku: string,
  certificateId: string,
): { deleted: boolean; id: string } {
  assertPermission(actor, "products:write");
  requireMutationAuthorization(actor, "remove product certificate");
  const product = getProductDetail(sku);
  const db = getDb();
  const certificate = db
    .prepare(
      `SELECT * FROM product_certificates WHERE id = ? AND lower(sku) = lower(?)`,
    )
    .get<Record<string, unknown>>(certificateId, product.sku);
  if (!certificate) {
    throw new ApiError(404, "CERTIFICATE_NOT_FOUND", "Certificate was not found.");
  }

  withTransaction(() => {
    db.prepare(`DELETE FROM product_certificates WHERE id = ?`).run(certificateId);
    recordAuditEvent({
      actor,
      action: "master_data.product_certificate_removed",
      entityType: "ProductCertificate",
      entityId: certificateId,
      before: {
        sku: product.sku,
        type: stringOr(certificate.certificate_type),
        number: stringOr(certificate.certificate_number),
      },
    });
  });

  return { deleted: true, id: certificateId };
}

export interface ProductPriceInput {
  price_type?: ProductPrice["price_type"];
  amount_cents: number;
  currency?: string;
  uom?: string;
  customer_segment?: string | null;
  effective_from?: string;
  effective_to?: string | null;
}

export function addProductPrice(
  actor: AuthenticatedUser,
  sku: string,
  input: ProductPriceInput,
): ProductPrice {
  assertPermission(actor, "products:write");
  requireMutationAuthorization(actor, "add product price");
  const product = getProductDetail(sku);
  const rawAmount = Number(input.amount_cents);
  if (!Number.isFinite(rawAmount) || rawAmount < 0) {
    throw new ApiError(422, "VALIDATION_ERROR", "A valid price amount is required.");
  }
  const amount = Math.round(rawAmount);
  if (input.effective_to && input.effective_from && input.effective_to < input.effective_from) {
    throw new ApiError(
      422,
      "INVALID_PRICE_DATES",
      "Price effective-to date must be on or after the effective-from date.",
    );
  }

  const db = getDb();
  return withTransaction(() => {
    insertPrice(db, actor, product.sku, {
      price_type: input.price_type ?? "contract",
      amount_cents: amount,
      currency: stringOr(input.currency, product.currency ?? "EUR").toUpperCase(),
      uom: stringOr(input.uom, product.pack_uom ?? "case"),
      customer_segment: input.customer_segment,
      effective_from: input.effective_from,
      effective_to: input.effective_to,
    });
    const created = db
      .prepare(
        `SELECT * FROM product_prices WHERE sku = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get<Record<string, unknown>>(product.sku);
    if (!created) {
      throw new ApiError(500, "PRICE_CREATE_FAILED", "Unable to store price.");
    }
    recordAuditEvent({
      actor,
      action: "master_data.product_price_added",
      entityType: "ProductPrice",
      entityId: stringOr(created.id),
      after: {
        sku: product.sku,
        price_type: input.price_type ?? "contract",
        amount_cents: amount,
        currency: stringOr(input.currency, product.currency ?? "EUR"),
      },
    });
    return mapPrice(created);
  });
}

export function deleteProductPrice(
  actor: AuthenticatedUser,
  sku: string,
  priceId: string,
): { deleted: boolean; id: string } {
  assertPermission(actor, "products:write");
  requireMutationAuthorization(actor, "remove product price");
  const product = getProductDetail(sku);
  const db = getDb();
  const price = db
    .prepare(`SELECT * FROM product_prices WHERE id = ? AND lower(sku) = lower(?)`)
    .get<Record<string, unknown>>(priceId, product.sku);
  if (!price) {
    throw new ApiError(404, "PRICE_NOT_FOUND", "Price record was not found.");
  }

  withTransaction(() => {
    db.prepare(`DELETE FROM product_prices WHERE id = ?`).run(priceId);
    recordAuditEvent({
      actor,
      action: "master_data.product_price_removed",
      entityType: "ProductPrice",
      entityId: priceId,
      before: {
        sku: product.sku,
        price_type: stringOr(price.price_type),
        amount_cents: numberOr(price.amount_cents, 0),
      },
    });
  });

  return { deleted: true, id: priceId };
}
