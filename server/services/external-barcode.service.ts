/**
 * External barcode product lookup.
 *
 * The Ascentra product registry (`product_barcodes` + `products`) remains the
 * ONLY authoritative catalog. External providers discover product information
 * for barcodes the ERP does not know yet. External data is ALWAYS confirmed
 * by a human before it becomes a product — nothing is created from external
 * data automatically.
 *
 * Default provider: Open Food Facts (https://world.openfoodfacts.org)
 *   - API v3.6 read endpoint: /api/v3.6/product/<barcode>.json
 *   - Requires no auth for reads, but a custom User-Agent is required and we
 *     identify as `Ascentra-ERP/<version> (ascentra.it)`.
 *   - Rate limit: 15 req/min/IP → we cache successes (10 min) and misses (1 min).
 *   - License: ODbL — attribution required, shown in the UI ("Source:
 *     Open Food Facts").
 *
 * Staging for testing: EXTERNAL_BARCODE_PROVIDER_BASE=https://world.openfoodfacts.net
 *   (basic auth off:off via EXTERNAL_BARCODE_PROVIDER_KEY=Basic b2ZmOmkK)
 *
 * Env configuration:
 *   EXTERNAL_BARCODE_PROVIDER        "openfoodfacts" (default) | "openfoodfacts-staging" | "custom"
 *   EXTERNAL_BARCODE_PROVIDER_BASE   override base URL (e.g. custom mirror)
 *   EXTERNAL_BARCODE_PROVIDER_KEY    optional bearer/basic token header
 *   EXTERNAL_BARCODE_CACHE_SECONDS   success TTL (default 600)
 *   EXTERNAL_BARCODE_MISS_SECONDS    miss TTL (default 60)
 *   EXTERNAL_BARCODE_DISABLED        if "true", external lookups are entirely skipped
 */

export interface ExternalProductPreview {
  barcode: string;
  name: string | null;
  brand: string | null;
  category: string | null;
  description: string | null;
  quantity: string;
  serving_size: string | null;
  ingredients: string | null;
  image_url: string | null;
  countries: string | null;
  source: string;
  sourceLabel: string;
  sourceUrl: string;
  attribution: string;
}

export type ExternalLookupStatus =
  | "disabled"
  | "found"
  | "not_found"
  | "unavailable"
  | "malformed";

export interface ExternalLookupResult {
  status: ExternalLookupStatus;
  provider: string;
  preview: ExternalProductPreview | null;
  /** Human-facing reason for an unavailable/malformed outcome (safe to show). */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
interface CacheEntry {
  expires: number;
  result: ExternalLookupResult;
}
const cache = new Map<string, CacheEntry>();
let lastSweep = 0;

function sweep(): void {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, entry] of cache) {
    if (entry.expires <= now) cache.delete(key);
  }
}

function cacheTtlMs(kind: "hit" | "miss"): number {
  const secs = Number(process.env[kind === "hit" ? "EXTERNAL_BARCODE_CACHE_SECONDS" : "EXTERNAL_BARCODE_MISS_SECONDS"] ?? (kind === "hit" ? 600 : 60));
  return Math.max(1, secs) * 1000;
}

export function externalBarcodeCacheStats(): { size: number; hits: number; misses: number } {
  return { size: cache.size, hits: cacheHits, misses: cacheMisses };
}

let cacheHits = 0;
let cacheMisses = 0;

function cacheGet(key: string): ExternalLookupResult | null {
  sweep();
  const hit = cache.get(key);
  if (!hit) {
    cacheMisses += 1;
    return null;
  }
  cacheHits += 1;
  return hit.result;
}

function cacheSet(key: string, result: ExternalLookupResult): void {
  sweep();
  cache.set(key, { expires: Date.now() + cacheTtlMs(result.status === "found" ? "hit" : "miss"), result });
}

export function clearExternalBarcodeCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Provider helpers
// ---------------------------------------------------------------------------
const MY_UA = "Ascentra-ERP/1.0 (ascentra.it)";
const REQUEST_TIMEOUT_MS = 3500;
const MAX_RETRIES = 1;

function providerBase(): string {
  const override = process.env.EXTERNAL_BARCODE_PROVIDER_BASE?.trim();
  if (override) return override.replace(/\/$/, "");
  const provider = (process.env.EXTERNAL_BARCODE_PROVIDER ?? "openfoodfacts").trim();
  if (provider === "openfoodfacts-staging") return "https://world.openfoodfacts.net";
  return "https://world.openfoodfacts.org";
}

function providerId(): string {
  return (process.env.EXTERNAL_BARCODE_PROVIDER ?? "openfoodfacts").trim() || "openfoodfacts";
}

export function externalLookupEnabled(): boolean {
  return process.env.EXTERNAL_BARCODE_DISABLED !== "true";
}

export function externalProviderName(): string {
  const override = process.env.EXTERNAL_BARCODE_PROVIDER_BASE?.trim();
  if (override) return "custom";
  return providerId();
}

export function attributionText(): string {
  return "Source: Open Food Facts — openfoodfacts.org (ODbL)";
}

function pickString(obj: unknown, keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** Open Food Facts sometimes leaves product_name empty but fills a localized
 *  variant (product_name_it, product_name_en, generic_name_it, ...). Accept any
 *  of them before declaring an otherwise usable record malformed. */
function pickLocalizedName(product: Record<string, unknown>): string | null {
  const preferred = [
    "product_name",
    "product_name_en",
    "product_name_it",
    "generic_name",
    "generic_name_en",
    "generic_name_it",
    "name"
  ];
  for (const key of preferred) {
    const value = sanitizeText(pickString(product, [key]), 200);
    if (value) return value;
  }
  for (const [key, raw] of Object.entries(product)) {
    if (!/^(product_name|generic_name|name)(?:_[a-z]{2,3})?$/i.test(key)) continue;
    const value = sanitizeText(typeof raw === "string" ? raw : null, 200);
    if (value) return value;
  }
  return null;
}

function pickTag(tags: unknown, lang: string): string | null {
  if (!Array.isArray(tags)) return null;
  const pref = `${lang}:`;
  const hit = tags.find((t) => typeof t === "string" && t.startsWith(pref));
  if (typeof hit === "string") return hit.slice(pref.length).replace(/_/g, " ");
  const first = tags.find((t) => typeof t === "string" && t.includes(":"));
  if (typeof first === "string") return first.slice(first.indexOf(":") + 1).replace(/_/g, " ");
  return null;
}

function sanitizeText(value: string | null, max = 400): string | null {
  if (!value) return null;
  // Strip control characters; collapse whitespace
  const clean = value.replace(/[\x00-\x1F\x7F]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.slice(0, max);
}

async function fetchWithTimeout(url: string, headers: Record<string, string>): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeExternalBarcode(raw: unknown): string {
  return String(raw ?? "").replace(/\s/g, "").trim();
}

async function callProvider(barcode: string): Promise<ExternalLookupResult> {
  const provider = externalProviderName();
  const base = providerBase();
  const cacheKey = `${provider}:${barcode}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const isCustom = provider === "custom";
  const url = isCustom && base.includes("{barcode}")
    ? base.replace("{barcode}", encodeURIComponent(barcode))
    : `${base}/api/v3.6/product/${encodeURIComponent(barcode)}.json`;

  const headers: Record<string, string> = {
    "User-Agent": MY_UA,
    Accept: "application/json",
  };
  const key = process.env.EXTERNAL_BARCODE_PROVIDER_KEY?.trim();
  if (key) {
    headers.Authorization = key.toLowerCase().startsWith("basic ") || key.toLowerCase().startsWith("bearer ")
      ? key
      : `Bearer ${key}`;
  }

  // One retry for 429 / 5xx / network errors (never 4xx — fix the request instead)
  let lastFailure: { status: number | null; reason: string } | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let step: { ok: boolean; status: number; body: unknown };
    try {
      step = await fetchWithTimeout(url, headers);
    } catch {
      lastFailure = { status: null, reason: "network" };
      if (attempt === MAX_RETRIES) break;
      await new Promise((resolve) => setTimeout(resolve, 800 + Math.floor(Math.random() * 400)));
      continue;
    }
    if (step.status === 200 && step.body && typeof step.body === "object") {
      const result = parseProductPayload(provider, barcode, step.body, cacheKey);
      return result;
    }
    // Open Food Facts v3 signals an unknown barcode with HTTP 404 (+ result.id product_not_found) —
    // that is a legitimate "not found" answer, not an outage. Cache it like a miss and never retry.
    if (step.status === 404) {
      const out: ExternalLookupResult = {
        status: "not_found",
        provider,
        preview: null,
        reason: "Product not found in the external database.",
      };
      cacheSet(cacheKey, out);
      return out;
    }
    const retriable = step.status === 429 || (step.status >= 500 && step.status < 600);
    lastFailure = { status: step.status, reason: retriable ? "upstream" : "client" };
    if (!retriable) break;
    if (attempt === MAX_RETRIES) break;
    const retryAfter = step.status === 429 ? 1500 : 800;
    await new Promise((resolve) => setTimeout(resolve, retryAfter));
  }

  const reason = lastFailure === null || lastFailure.status === null
    ? "The external product database did not respond. Check your internet connection and retry."
    : `The external product database returned HTTP ${lastFailure.status}. Please retry later.`;
  const out: ExternalLookupResult = {
    status: "unavailable",
    provider,
    preview: null,
    reason,
  };
  cacheSet(cacheKey, out);
  return out;
}

function parseProductPayload(provider: string, barcode: string, payload: unknown, cacheKey: string): ExternalLookupResult {
  // v2/v3 envelope: { status: 0|1|"success"|"failure", product?: {...} }
  const root = payload as Record<string, unknown>;
  const statusFlag = root?.status;
  const found = statusFlag === 1 || statusFlag === "success" || Boolean(root?.product);
  const product = (root?.product ?? null) as Record<string, unknown> | null;
  if (!found || !product) {
    const out: ExternalLookupResult = {
      status: "not_found",
      provider,
      preview: null,
      reason: "Product not found in the external database.",
    };
    cacheSet(cacheKey, out);
    return out;
  }
  const name = pickLocalizedName(product);
  if (!name) {
    const out: ExternalLookupResult = {
      status: "malformed",
      provider,
      preview: null,
      reason: "The external record has no product name in any supported language. Enter the name yourself or associate this barcode with an existing product.",
    };
    cacheSet(cacheKey, out);
    return out;
  }
  const image =
    pickString(product, ["image_front_url", "image_url", "image_small_url"]);
  const preview: ExternalProductPreview = {
    barcode,
    name,
    brand: sanitizeText(pickString(product, ["brands", "brand"]), 120),
    category: sanitizeText(pickTag(product.categories_tags, "en") ?? pickString(product, ["categories", "category"]), 120),
    description: sanitizeText(pickString(product, ["generic_name", "product_name"]), 400),
    quantity: sanitizeText(pickString(product, ["quantity", "product_quantity"]), 60) ?? "—",
    serving_size: sanitizeText(pickString(product, ["serving_size"]), 60),
    ingredients: sanitizeText(pickString(product, ["ingredients_text", "ingredients_text_en"]), 400),
    image_url: image && /^https?:\/\//i.test(image) ? image : null,
    countries: sanitizeText(pickString(product, ["countries", "countries_tags"]), 120),
    source: provider,
    sourceLabel: provider === "custom" ? "Custom external catalogue" : "Open Food Facts",
    sourceUrl: provider === "custom" ? "" : "https://world.openfoodfacts.org",
    attribution: provider === "custom"
      ? "External provider — review terms of use"
      : "Contains Open Food Facts data — openfoodfacts.org (ODbL). Attribution required.",
  };
  const out: ExternalLookupResult = { status: "found", provider, preview };
  cacheSet(cacheKey, out);
  return out;
}

export async function externalBarcodeLookup(
  barcode: string,
): Promise<ExternalLookupResult> {
  if (!externalLookupEnabled()) {
    return {
      status: "disabled",
      provider: externalProviderName(),
      preview: null,
      reason: "External lookup is disabled on this deployment.",
    };
  }
  const normalized = normalizeExternalBarcode(barcode);
  return callProvider(normalized);
}

// Kept for backwards compatibility with older imports.
export function externalBarcodeLookupEnabled(): boolean {
  return externalLookupEnabled();
}
