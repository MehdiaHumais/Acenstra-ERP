// Shared product-master reference data and helpers used by both the API layer
// and the product master UI. Keep this file free of server-only imports.

export const EU_ALLERGENS = [
  "Celery",
  "Cereals containing gluten",
  "Crustaceans",
  "Eggs",
  "Fish",
  "Lupin",
  "Milk",
  "Molluscs",
  "Mustard",
  "Nuts",
  "Peanuts",
  "Sesame",
  "Soybeans",
  "Sulphites",
] as const;

export const HANDLING_ATTRIBUTES = [
  "Keep refrigerated",
  "Keep frozen",
  "Keep dry",
  "Protect from light",
  "Do not refreeze",
  "Fragile / handle with care",
  "Stack limit 4",
  "Food-contact approved",
  "HACCP controlled",
  "Segregate from raw meat",
  "Temperature logged",
  "Allergen segregated",
] as const;

export const DIET_FLAGS = [
  "Vegetarian",
  "Vegan",
  "Gluten free",
  "Lactose free",
  "Halal",
  "Kosher",
  "Organic",
  "No added sugar",
  "Sustainably sourced",
] as const;

export const CERTIFICATE_TYPES = [
  "MSC",
  "ASC",
  "Organic EU",
  "IFS Food",
  "BRCGS",
  "HACCP",
  "GlobalG.A.P.",
  "ISO 22000",
  "DOP",
  "IGP",
  "Halal",
  "Kosher",
  "Gluten Free",
  "Rainforest Alliance",
  "Fairtrade",
] as const;

export const PRICE_TYPES = ["list", "cost", "contract", "promotional"] as const;

export const PRODUCT_CATEGORIES = [
  "Produce",
  "Dairy",
  "Meat",
  "Seafood",
  "Bakery",
  "Pasta & Bakery",
  "Charcuterie",
  "Pantry",
  "Ambient",
  "Frozen",
] as const;

export const BASE_UOMS = ["kg", "g", "L", "ml", "each"] as const;

export const PACK_UOMS = ["Case", "Tray", "Crate", "Piece", "Bag", "Box", "Pallet"] as const;

export const CURRENCIES = ["EUR", "GBP", "USD"] as const;

export interface TemperatureProfile {
  label: string;
  minC: number;
  maxC: number;
}

export const TEMPERATURE_PROFILES: TemperatureProfile[] = [
  { label: "Ambient 12–24°C", minC: 12, maxC: 24 },
  { label: "Chilled 0–4°C", minC: 0, maxC: 4 },
  { label: "Chilled -1–2°C", minC: -1, maxC: 2 },
  { label: "Chilled 2–6°C", minC: 2, maxC: 6 },
  { label: "Frozen -18°C", minC: -22, maxC: -18 },
  { label: "Deep freeze -22°C", minC: -25, maxC: -22 },
];

export const CATCH_WEIGHT_CATEGORIES = ["Seafood", "Meat", "Dairy", "Charcuterie"];

export function isCatchWeightCategory(category: string): boolean {
  return CATCH_WEIGHT_CATEGORIES.includes(category);
}

export function temperatureProfileFor(label: string): TemperatureProfile {
  return TEMPERATURE_PROFILES.find((profile) => profile.label === label) ?? TEMPERATURE_PROFILES[1];
}

export function certificateStatus(validTo: string): "valid" | "expiring" | "expired" | "pending" {
  if (!validTo) return "pending";
  const today = new Date().toISOString().slice(0, 10);
  const warningDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  if (validTo < today) return "expired";
  if (validTo <= warningDate) return "expiring";
  return "valid";
}

export function describePack(
  packUom: string,
  unitsPerCase: number,
  unitWeightKg: number,
  baseUom: string,
): string {
  const unitLabel = unitWeightKg > 0 ? `${formatQty(unitWeightKg)} ${baseUom}` : baseUom;
  if (unitsPerCase > 1) {
    return `1 ${packUom || "Case"} = ${unitsPerCase} × ${unitLabel}`;
  }
  return `1 ${packUom || "Case"} = ${unitLabel}`;
}

export function formatQty(value: number): string {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 3 }).format(value);
}
