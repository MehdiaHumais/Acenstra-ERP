/**
 * Pure mapping helpers for the Add Product barcode-photo flow.
 * External catalogue data is treated as an unverified preview: only fields
 * actually returned by the provider are populated. ERP-specific commercial
 * fields are deliberately left for the user to complete.
 */
import { PRODUCT_CATEGORIES } from "@/lib/product-master";
import { canonicalBarcodeFormat } from "@/lib/barcode-decode";

export interface ExternalProductPreviewLike {
  name?: string | null;
  brand?: string | null;
  category?: string | null;
  description?: string | null;
  quantity?: string | null;
  serving_size?: string | null;
  ingredients?: string | null;
  image_url?: string | null;
  countries?: string | null;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  attribution?: string | null;
}

export interface BarcodeProductDraft {
  sku?: string;
  name?: string;
  brand?: string;
  category?: string;
  description?: string;
  origin?: string;
  baseUom?: string;
  unitWeightKg?: string;
  barcode: string;
  barcodeFormat: string;
  imageUrl?: string;
  imageSource?: string;
  externalSourceLabel?: string;
  externalSourceUrl?: string;
}

function clean(value: unknown, max = 400): string {
  return String(value ?? "")
    .replace(/[\x00-\x1F\x7F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function normalizeExternalCategory(raw: unknown): string | undefined {
  const value = clean(raw, 120).toLowerCase();
  if (!value) return undefined;
  if (PRODUCT_CATEGORIES.some((category) => category.toLowerCase() === value)) {
    return PRODUCT_CATEGORIES.find((category) => category.toLowerCase() === value);
  }
  if (/frozen|ice cream/.test(value)) return "Frozen";
  if (/seafood|fish|salmon|shrimp|octopus/.test(value)) return "Seafood";
  if (/dairy|cheese|yogurt|milk|butter|cream/.test(value)) return "Dairy";
  if (/meat|beef|pork|chicken|lamb/.test(value)) return "Meat";
  if (/charcuterie|salami|ham|prosciutto/.test(value)) return "Charcuterie";
  if (/bread|bakery|pastry|biscuit|cake/.test(value)) return "Bakery";
  if (/pasta|rice|cereal|flour|grain/.test(value)) return "Pasta & Bakery";
  if (/fruit|vegetable|fresh produce|salad/.test(value)) return "Produce";
  if (/oil|sauce|spread|chocolate|snack|drink|beverage|coffee|tea|pantry|tinned/.test(value)) {
    return "Pantry";
  }
  return "Ambient";
}

/** Extract a weight/volume from Open Food Facts' free-text `quantity` field.
 *  Only a parseable value is returned — nothing is guessed. */
export function parseExternalQuantity(raw: unknown):
  | { value: string; baseUom: "kg" | "g" | "L" | "ml"; weightKg?: string }
  | undefined {
  const match = clean(raw, 80).match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml)\b/i);
  if (!match) return undefined;
  const amount = Number(match[1].replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const unit = match[2].toUpperCase() === "L" ? "L" : match[2].toLowerCase() as "kg" | "g" | "ml";
  if (unit === "kg") return { value: String(amount), baseUom: "kg", weightKg: String(amount) };
  if (unit === "g") return { value: String(amount), baseUom: "g", weightKg: String(amount / 1000) };
  return { value: String(amount), baseUom: unit };
}

export function suggestExternalSku(barcode: string): string {
  const suffix = clean(barcode, 128).replace(/[^A-Z0-9]/gi, "").slice(-10).toUpperCase() || "BARCODE";
  return `EXT-${suffix}`;
}

export function mapExternalProductToDraft(
  preview: ExternalProductPreviewLike | null | undefined,
  barcode: string,
  format?: unknown,
): BarcodeProductDraft {
  const safeBarcode = clean(barcode, 128).toUpperCase();
  const draft: BarcodeProductDraft = {
    barcode: safeBarcode,
    barcodeFormat: canonicalBarcodeFormat(format),
  };
  if (!preview) return draft;

  const name = clean(preview.name, 200);
  const brand = clean(preview.brand, 120);
  const category = normalizeExternalCategory(preview.category);
  const quantity = parseExternalQuantity(preview.quantity);
  const ingredients = clean(preview.ingredients, 400);
  const servingSize = clean(preview.serving_size, 120);
  const countries = clean(preview.countries, 120);
  const descriptionParts = [
    ingredients ? `Ingredients: ${ingredients}` : "",
    servingSize ? `Serving: ${servingSize}` : "",
  ].filter(Boolean);

  if (name) draft.name = name;
  if (brand) draft.brand = brand;
  if (category) draft.category = category;
  if (descriptionParts.length) draft.description = descriptionParts.join(" · ").slice(0, 400);
  if (countries) draft.origin = countries.split(/[,/]/)[0].trim().slice(0, 80);
  if (quantity) {
    draft.baseUom = quantity.baseUom;
    if (quantity.weightKg) draft.unitWeightKg = quantity.weightKg;
  }
  if (preview.image_url && /^(https?:|data:image\/)/i.test(String(preview.image_url))) {
    draft.imageUrl = String(preview.image_url).slice(0, 1_500_000);
    draft.imageSource = clean(preview.attribution ?? preview.sourceLabel, 120) || "External catalogue";
  }
  if (preview.sourceLabel) draft.externalSourceLabel = clean(preview.sourceLabel, 120);
  if (preview.sourceUrl && /^https?:\/\//i.test(String(preview.sourceUrl))) {
    draft.externalSourceUrl = String(preview.sourceUrl).slice(0, 500);
  }
  draft.sku = suggestExternalSku(safeBarcode);
  return draft;
}
