import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ascentra-extbarcode-test-"));
process.env.SQLITE_DB_PATH = path.join(tmpDir, "ext-barcode.sqlite");
process.env.SEED_DEMO_DATA = "true";
process.env.EXTERNAL_BARCODE_CACHE_SECONDS = "600";
process.env.EXTERNAL_BARCODE_MISS_SECONDS = "60";

import { getDb } from "@/server/db/connection";
import { ensureRbacConfig } from "@/server/security/auth";
import type { AuthenticatedUser } from "@/server/security/auth";
import { hashPassword } from "@/server/security/crypto";
import {
  externalBarcodeLookup,
  externalLookupEnabled,
  clearExternalBarcodeCache,
} from "@/server/services/external-barcode.service";
import {
  registerExternalProduct,
} from "@/server/services/external-product.service";
import {
  lookupBarcode,
  listProductBarcodes,
  removeBarcode,
} from "@/server/services/product-barcode.service";

const superAdmin: AuthenticatedUser = {
  id: "USR-EXT-ADMIN",
  email: "ext-admin@example.com",
  name: "External Barcode Admin",
  role: "super_admin",
};

const ORIGINAL_FETCH = globalThis.fetch;

before(() => {
  ensureRbacConfig();
});

after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

function withFetch<T>(mock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>, fn: () => Promise<T>): Promise<T> {
  globalThis.fetch = mock as typeof globalThis.fetch;
  return fn();
}

const OFF_SUCCESS = {
  code: "3017620422003",
  status: "success",
  status_verbose: "product found",
  product: {
    product_name: "Nutella",
    generic_name: "Chocolate hazelnut spread",
    brands: "Ferrero",
    quantity: "400 g",
    categories_tags: ["en:spreads", "en:breakfasts"],
    image_front_url: "https://images.example.test/nutella-front.jpg",
    ingredients_text: "Sugar, palm oil, hazelnuts (13%)",
  },
};

describe("External barcode lookup — Open Food Facts", () => {
  it("is enabled by default", () => {
    assert.equal(externalLookupEnabled(), true);
  });

  it("parses a successful OFF response into a normalized preview", async () => {
    clearExternalBarcodeCache();
    const result = await withFetch(
      async () => new Response(JSON.stringify(OFF_SUCCESS), { status: 200, headers: { "content-type": "application/json" } }),
      () => externalBarcodeLookup("3017620422003")
    );
    assert.equal(result.status, "found");
    assert.ok(result.preview);
    assert.equal(result.preview?.name, "Nutella");
    assert.equal(result.preview?.brand, "Ferrero");
    assert.equal(result.preview?.category, "spreads");
    assert.equal(result.preview?.quantity, "400 g");
    assert.equal(result.preview?.image_url, "https://images.example.test/nutella-front.jpg");
    assert.equal(result.preview?.sourceLabel, "Open Food Facts");
    assert.ok(result.preview?.attribution.includes("Open Food Facts"));
  });

  it("uses a localized Open Food Facts name when product_name is empty", async () => {
    clearExternalBarcodeCache();
    const localized = {
      status: "success",
      product: {
        product_name: "",
        product_name_it: "Passata di pomodoro",
        brands: "Mutti",
        quantity: "700 g",
      },
    };
    const result = await withFetch(
      async () => new Response(JSON.stringify(localized), { status: 200, headers: { "content-type": "application/json" } }),
      () => externalBarcodeLookup("8056172900017")
    );
    assert.equal(result.status, "found");
    assert.equal(result.preview?.name, "Passata di pomodoro");
    assert.equal(result.preview?.brand, "Mutti");
  });

  it("returns not_found when OFF reports status 0", async () => {
    clearExternalBarcodeCache();
    const result = await withFetch(
      async () => new Response(JSON.stringify({ status: 0, status_verbose: "product_not_found" }), { status: 200 }),
      () => externalBarcodeLookup("9999999999999")
    );
    assert.equal(result.status, "not_found");
    assert.equal(result.preview, null);
  });

  it("returns not_found when OFF v3.6 answers HTTP 404 (real-world shape)", async () => {
    clearExternalBarcodeCache();
    const off404 = {
      code: "8961100311002",
      result: { id: "product_not_found", name: "Product not found" },
    };
    const result = await withFetch(
      async () => new Response(JSON.stringify(off404), { status: 404 }),
      () => externalBarcodeLookup("8961100311002")
    );
    assert.equal(result.status, "not_found");
    assert.equal(result.preview, null);
  });

  it("returns unavailable on network failure", async () => {
    clearExternalBarcodeCache();
    const result = await withFetch(
      async () => { throw new Error("ECONNRESET"); },
      () => externalBarcodeLookup("8888888888883")
    );
    assert.equal(result.status, "unavailable");
    assert.equal(result.preview, null);
  });

  it("returns unavailable when the provider is down (5xx)", async () => {
    clearExternalBarcodeCache();
    const result = await withFetch(
      async () => new Response("upstream exploded", { status: 503 }),
      () => externalBarcodeLookup("7777777777772")
    );
    assert.equal(result.status, "unavailable");
  });

  it("returns malformed when the payload has no usable name", async () => {
    clearExternalBarcodeCache();
    const result = await withFetch(
      async () => new Response(JSON.stringify({ status: "success", product: { brands: "Unnamed Ltd" } }), { status: 200 }),
      () => externalBarcodeLookup("6666666666668")
    );
    assert.equal(result.status, "malformed");
    assert.equal(result.preview, null);
  });

  it("caches successful responses and does not re-hit the network", async () => {
    clearExternalBarcodeCache();
    let calls = 0;
    const mock = async () => {
      calls += 1;
      return new Response(JSON.stringify(OFF_SUCCESS), { status: 200 });
    };
    globalThis.fetch = mock as unknown as typeof globalThis.fetch;
    await externalBarcodeLookup("3017620422003");
    await externalBarcodeLookup("3017620422003");
    assert.equal(calls, 1);
  });
});

describe("External product registration — create & associate", () => {
  it("creates a brand-new product from an externally confirmed barcode", () => {
    const result = registerExternalProduct(superAdmin as any, {
      mode: "create",
      barcode: "EXT-TEST-99887766",
      confirmed_external: true,
      name: "External Hazelnut Spread 750 g",
      brand: "ExampleBrand",
      category: "Ambient",
      unit_price_cents: 1100,
      shelf_life_days: 365,
      sku: "SKU-EXT-SPR-001",
      source: "Open Food Facts — openfoodfacts.org (ODbL)",
    });
    assert.equal(result.product.sku, "SKU-EXT-SPR-001");
    assert.equal(result.barcode.barcode, "EXTTEST99887766");
    assert.equal(result.barcode.format, "CODE128"); // non-digit → CODE128
    assert.equal(result.barcode.is_primary, true);

    const found = lookupBarcode(superAdmin as any, "EXT-TEST-99887766");
    assert.equal(found.found, true);
    assert.equal(found.product?.sku, "SKU-EXT-SPR-001");
  });

  it("rejects duplicate barcode assignments even with confirmed data", () => {
    assert.throws(
      () =>
        registerExternalProduct(superAdmin as any, {
          mode: "create",
          barcode: "EXT-TEST-99887766",
          confirmed_external: true,
          name: "Second product with the same code",
          brand: "ExampleBrand",
          category: "Ambient",
          sku: "SKU-EXT-SPR-002",
        }),
      /BARCODE_DUPLICATE|already assigned/i
    );
  });

  it("rejects duplicate by name+brand to prevent re-creating the same product", () => {
    assert.throws(
      () =>
        registerExternalProduct(superAdmin as any, {
          mode: "create",
          barcode: "EXT-TEST-11223344",
          confirmed_external: true,
          name: "External Hazelnut Spread 750 g",
          brand: "ExampleBrand",
          category: "Ambient",
          sku: "SKU-EXT-SPR-003",
        }),
      /DUPLICATE_PRODUCT|already exists/i
    );
  });

  it("associates the barcode to an existing product without duplicating it", () => {
    const result = registerExternalProduct(superAdmin as any, {
      mode: "associate",
      barcode: "EXT-TEST-55443322",
      confirmed_external: true,
      associate_to_sku: "SKU-SAL-001",
      source: "Open Food Facts",
    });
    assert.equal(result.barcode.sku, "SKU-SAL-001");
    assert.equal(result.product.sku, "SKU-SAL-001");
    const unchanged = lookupBarcode(superAdmin as any, "EXT-TEST-55443322");
    assert.equal(unchanged.product?.sku, "SKU-SAL-001");

  });

  it("creates an audit record for every external registration", () => {
    const rows = getDb()
      .prepare("SELECT COUNT(*) as c FROM audit_events WHERE action IN ('product.created_from_external', 'product.barcode_associated_external')")
      .get() as { c: number };
    assert.ok(rows.c >= 2);
  });
});
