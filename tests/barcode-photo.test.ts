import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalBarcodeFormat,
  normalizeDecodedBarcode,
  validateDecodedBarcode,
} from "../lib/barcode-decode";
import {
  mapExternalProductToDraft,
  normalizeExternalCategory,
  parseExternalQuantity,
} from "../lib/product-barcode-draft";

test("decoded barcode formats are normalised to ERP format names", () => {
  assert.equal(canonicalBarcodeFormat("EAN_13"), "EAN-13");
  assert.equal(canonicalBarcodeFormat("EAN8"), "EAN-8");
  assert.equal(canonicalBarcodeFormat("UPC_A"), "UPC-A");
  assert.equal(canonicalBarcodeFormat("UPC_E"), "UPC-E");
  assert.equal(canonicalBarcodeFormat("CODE128"), "CODE128");
  assert.equal(canonicalBarcodeFormat(undefined), "CODE128");
});

test("decoded EAN, UPC and Code 128 values are validated before lookup", () => {
  assert.deepEqual(validateDecodedBarcode("8056593285012", "EAN_13"), {
    ok: true,
    barcode: "8056593285012",
    format: "EAN-13",
  });
  assert.equal(validateDecodedBarcode("8056593285013", "EAN_13").ok, false);
  assert.equal(validateDecodedBarcode("96385074", "EAN_8").ok, true);
  assert.equal(validateDecodedBarcode("96385075", "EAN_8").ok, false);
  assert.equal(validateDecodedBarcode("036000291452", "UPC_A").ok, true);
  assert.equal(validateDecodedBarcode("036000291453", "UPC_A").ok, false);
  assert.equal(validateDecodedBarcode("01234565", "UPC_E").ok, true);
  assert.equal(validateDecodedBarcode("ASC-2026-0001", "CODE128").ok, true);
  assert.equal(validateDecodedBarcode(" 8056 593 2850 12 ", "EAN_13").ok, true);
  assert.equal(normalizeDecodedBarcode(" 036-000291452 "), "036000291452");
});

test("external preview mapping only populates fields actually supplied", () => {
  const draft = mapExternalProductToDraft(
    {
      name: "Nutella Hazelnut Spread",
      brand: "Ferrero",
      category: "Spreads",
      quantity: "400 g",
      ingredients: "Sugar, hazelnuts, cocoa",
      image_url: "https://images.openfoodfacts.org/nutella.jpg",
      countries: "Italy, France",
      attribution: "Source: Open Food Facts — openfoodfacts.org (ODbL)",
      sourceUrl: "https://world.openfoodfacts.org/api/v3.6/product/8056593285012.json",
    },
    "8056593285012",
    "EAN_13",
  );

  assert.equal(draft.barcode, "8056593285012");
  assert.equal(draft.barcodeFormat, "EAN-13");
  assert.equal(draft.name, "Nutella Hazelnut Spread");
  assert.equal(draft.brand, "Ferrero");
  assert.equal(draft.category, "Pantry");
  assert.equal(draft.baseUom, "g");
  assert.equal(draft.unitWeightKg, "0.4");
  assert.equal(draft.origin, "Italy");
  assert.match(draft.description ?? "", /Ingredients: Sugar, hazelnuts, cocoa/);
  assert.equal(draft.imageSource, "Source: Open Food Facts — openfoodfacts.org (ODbL)");
  assert.match(draft.sku ?? "", /^EXT-/);
  // ERP commercial fields are never invented from catalogue data.
  assert.equal("costPrice" in draft, false);
  assert.equal("shelfLifeDays" in draft, false);
  assert.equal("vatRate" in draft, false);
});

test("missing external data stays missing and category normalisation is conservative", () => {
  const draft = mapExternalProductToDraft({ name: "Unknown item" }, "12345678", "EAN_8");
  assert.equal(draft.barcode, "12345678");
  assert.equal(draft.name, "Unknown item");
  assert.equal(draft.brand, undefined);
  assert.equal(draft.description, undefined);
  assert.equal(draft.imageUrl, undefined);
  assert.equal(draft.imageSource, undefined);
  assert.equal(draft.sku, "EXT-12345678");

  assert.equal(normalizeExternalCategory("Frozen foods"), "Frozen");
  assert.equal(normalizeExternalCategory("cheeses"), "Dairy");
  assert.equal(normalizeExternalCategory("something completely new"), "Ambient");
  assert.equal(normalizeExternalCategory(""), undefined);
  assert.equal(parseExternalQuantity("unknown"), undefined);
  assert.deepEqual(parseExternalQuantity("1.5 L"), { value: "1.5", baseUom: "L" });
});
