import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "barcode-test-"));
process.env.SQLITE_DB_PATH = path.join(tmpDir, "barcode.sqlite");
process.env.SEED_DEMO_DATA = "true";

import { getDb, withTransaction } from "@/server/db/connection";
import {
  listProductBarcodes,
  lookupBarcode,
  addBarcodeForProduct,
  removeBarcode,
  recordScanEvent,
  generateInternalBarcode
} from "@/server/services/product-barcode.service";
import { getEffectiveAuthorization } from "@/server/security/auth";
import { createProduct } from "@/server/services/product-master.service";

const superAdminActor = {
  id: "USR-ADMIN-BC",
  email: "bc-admin@example.com",
  name: "Barcode Admin",
  role: "super_admin" as const
};

const vendorActor = {
  id: "USR-VENDOR-BC",
  email: "bc-vendor@example.com",
  name: "Barcode Vendor",
  role: "store_vendor" as const,
  store_id: "STR-MIL-01"
};

describe("Product barcodes — seeded lookup", () => {
  it("resolves seeded EAN-13 barcode to the Norwegian salmon product", () => {
    const result = lookupBarcode(superAdminActor as any, "8056593285012");
    assert.equal(result.found, true);
    assert.equal(result.product?.sku, "SKU-SAL-001");
  });

  it("returns found=false for an unknown barcode", () => {
    const result = lookupBarcode(superAdminActor as any, "0000000000000");
    assert.equal(result.found, false);
    assert.equal(result.product, null);
  });

  it("normalizes whitespace and dashes before lookup", () => {
    const result = lookupBarcode(superAdminActor as any, " 8056-5932-85012 ");
    assert.equal(result.found, true);
    assert.equal(result.product?.sku, "SKU-SAL-001");
  });
});

describe("Product barcodes — list", () => {
  it("lists seeded barcodes for a SKU in primary-first order", () => {
    const rows = listProductBarcodes(superAdminActor as any, "SKU-SAL-001");
    assert.ok(rows.length >= 1);
    assert.equal(rows[0].sku, "SKU-SAL-001");
    assert.equal(rows[0].barcode, "8056593285012");
    assert.equal(rows[0].format, "EAN-13");
    assert.equal(rows[0].is_primary, true);
  });

  it("lists barcodes across products for scanning workflows", () => {
    const rows = listProductBarcodes(superAdminActor as any);
    assert.equal(rows.length, 8);
    assert.ok(rows.some((r) => r.sku === "SKU-BUR-004"));
  });
});

describe("Product barcodes — management", () => {
  it("requires products:write to add a barcode", () => {
    assert.throws(() => addBarcodeForProduct(vendorActor as any, { product_sku: "SKU-SAL-001", barcode: "1111111111111" }), /FORBIDDEN|not authorized/i);
  });

  it("rejects duplicate barcode assignments with a clear error", () => {
    assert.throws(
      () => addBarcodeForProduct(superAdminActor as any, { product_sku: "SKU-BUR-004", barcode: "8056593285012" }),
      /BARCODE_DUPLICATE|already assigned/i
    );
  });

  it("adds and then removes a barcode", () => {
    const created = addBarcodeForProduct(superAdminActor as any, { product_sku: "SKU-SAL-001", barcode: "5555555555550", format: "EAN-13" });
    assert.equal(created.sku, "SKU-SAL-001");
    assert.equal(created.barcode, "5555555555550");

    const removed = removeBarcode(superAdminActor as any, created.id);
    assert.equal(removed.removed, true);

    const check = lookupBarcode(superAdminActor as any, "5555555555550");
    assert.equal(check.found, false);
  });

  it("requires a recognized product to attach a barcode", () => {
    assert.throws(() => addBarcodeForProduct(superAdminActor as any, { product_sku: "SKU-DOES-NOT-EXIST", barcode: "6666666666666" }), /not found/i);
  });
});

describe("Product barcodes — format-aware checksums", () => {
  it("validates EAN-8 with the correct 3/1 weights", () => {
    const ok = lookupBarcode(superAdminActor as any, "96385074"); // valid EAN-8 check digit 4
    assert.equal(ok.found, false); // passes validation, simply unknown
    assert.throws(
      () => lookupBarcode(superAdminActor as any, "96385075"), // bad EAN-8 check digit
      /BARCODE_CHECKSUM_MISMATCH|checksum mismatch/i
    );
  });

  it("validates UPC-A 12-digit codes with 3/1 weights", () => {
    const ok = lookupBarcode(superAdminActor as any, "036000291452"); // valid UPC-A (check digit 2)
    assert.equal(ok.found, false);
    assert.throws(
      () => lookupBarcode(superAdminActor as any, "036000291453"), // bad UPC-A check digit
      /BARCODE_CHECKSUM_MISMATCH|checksum mismatch/i
    );
  });

  it("rejects an 8-digit code submitted as EAN-13 (format mismatch)", () => {
    assert.throws(
      () =>
        addBarcodeForProduct(superAdminActor as any, {
          product_sku: "SKU-SAL-001",
          barcode: "96385074",
          format: "EAN-13"
        }),
      /must be exactly 13 digits|CHECKSUM_MISMATCH/i
    );
  });

  it("does not apply EAN checksum rules to CODE-128 alphanumeric payloads", () => {
    const created = addBarcodeForProduct(superAdminActor as any, {
      product_sku: "SKU-SAL-001",
      barcode: "CASEBOX42",
      format: "CODE128"
    });
    assert.equal(created.format, "CODE128");
    const removed = removeBarcode(superAdminActor as any, created.id);
    assert.equal(removed.removed, true);
  });

  it("returns found=false for unknown non-digit payloads without checksum rejection", () => {
    const result = lookupBarcode(superAdminActor as any, "SOMEWHATE-UNKNOWNOPEN");
    assert.equal(result.found, false);
  });
});

describe("Product barcodes — multiple barcodes per product", () => {
  it("assigns two barcodes to one SKU and resolves both to it", () => {
    const a = addBarcodeForProduct(superAdminActor as any, { product_sku: "SKU-BUR-004", barcode: "7777777777772", format: "EAN-13" });
    const b = addBarcodeForProduct(superAdminActor as any, { product_sku: "SKU-BUR-004", barcode: "8888888888888", format: "EAN-13" });
    try {
      const lookA = lookupBarcode(superAdminActor as any, "7777777777772");
      const lookB = lookupBarcode(superAdminActor as any, "8888888888888");
      assert.equal(lookA.product?.sku, "SKU-BUR-004");
      assert.equal(lookB.product?.sku, "SKU-BUR-004");
      const list = listProductBarcodes(superAdminActor as any, "SKU-BUR-004");
      const mine = list.filter((r) => [a.id, b.id].includes(r.id));
      assert.equal(mine.length, 2);
    } finally {
      removeBarcode(superAdminActor as any, a.id);
      removeBarcode(superAdminActor as any, b.id);
    }
  });
});

describe("Product barcodes — internal generation", () => {
  it("generates a unique internal CODE128 code that scans back to the product", () => {
    const created = generateInternalBarcode(superAdminActor as any, { product_sku: "SKU-OCT-018" });
    try {
      assert.equal(created.format, "CODE128");
      assert.match(created.barcode, /^ASC[0-9]{9}$/);
      assert.equal(created.sku, "SKU-OCT-018");
      const lookup = lookupBarcode(superAdminActor as any, created.barcode);
      assert.equal(lookup.found, true);
      assert.equal(lookup.product?.sku, "SKU-OCT-018");
    } finally {
      removeBarcode(superAdminActor as any, created.id);
    }
  });

  it("generates unique codes across repeated calls", () => {
    const a = generateInternalBarcode(superAdminActor as any, { product_sku: "SKU-PRO-021" });
    const b = generateInternalBarcode(superAdminActor as any, { product_sku: "SKU-PRO-021" });
    try {
      assert.notEqual(a.barcode, b.barcode);
    } finally {
      removeBarcode(superAdminActor as any, a.id);
      removeBarcode(superAdminActor as any, b.id);
    }
  });

  it("does not steal the primary flag from an existing primary barcode", () => {
    const created = generateInternalBarcode(superAdminActor as any, { product_sku: "SKU-SAL-001" });
    try {
      assert.equal(created.is_primary, false); // SKU-SAL-001 already has seeded primary
    } finally {
      removeBarcode(superAdminActor as any, created.id);
    }
  });
});

describe("Product barcodes — checksum validation", () => {
  it("rejects EAN-13 codes with an invalid check digit", () => {
    assert.throws(
      () => lookupBarcode(superAdminActor as any, "8056593287015"),
      /BARCODE_CHECKSUM_MISMATCH|checksum mismatch/i
    );
  });

  it("accepts EAN-13 codes with a valid check digit", () => {
    const result = lookupBarcode(superAdminActor as any, "8056593287016");
    assert.equal(result.found, true);
  });
});

describe("Product barcodes — scan events", () => {
  it("records a scan event with match result for an operational role", () => {
    const warehouseActor = {
      id: "USR-WH-BC", email: "bc-wh@example.com", name: "BC Warehouse", role: "warehouse_manager" as const, warehouse: "Milan Cold Hub"
    };
    const result = recordScanEvent(warehouseActor as any, {
      barcode: "8056593285012",
      operation: "pick",
      reference_id: "SO-2026-9841",
      quantity: 1,
      result: "matched",
      product_id: "PRD-01",
      product_sku: "SKU-SAL-001"
    });
    assert.ok(result.id);
  });

  it("rejects scan events from unauthorized store vendors", () => {
    assert.throws(
      () => recordScanEvent(vendorActor as any, { barcode: "8056593285012", operation: "pick", result: "matched" }),
      /SCAN_NOT_AUTHORIZED|not allowed/i
    );
  });

  it("dedupes identical scans from the same user within 3 seconds", () => {
    const warehouseActor = {
      id: "USR-WH-BC2", email: "bc-wh2@example.com", name: "BC Warehouse Dedupe", role: "warehouse_manager" as const, warehouse: "Milan Cold Hub"
    };
    const first = recordScanEvent(warehouseActor as any, {
      barcode: "8056593285012",
      operation: "cycle-count",
      reference_id: "CC-DEDUP-TEST",
      quantity: 1,
      result: "matched",
      product_id: "PRD-01",
      product_sku: "SKU-SAL-001"
    });
    const second = recordScanEvent(warehouseActor as any, {
      barcode: "8056593285012",
      operation: "cycle-count",
      reference_id: "CC-DEDUP-TEST",
      quantity: 1,
      result: "matched",
      product_id: "PRD-01",
      product_sku: "SKU-SAL-001"
    });
    assert.equal(second.id, first.id);
    assert.equal((second as any).deduplicated, true);
  });
});

describe("Product barcodes — add product atomicity", () => {
  it("rolls back a new product when its decoded barcode is already assigned", () => {
    const sku = "SKU-BARCODE-ROLLBACK";
    assert.throws(
      () =>
        withTransaction(() => {
          const created = createProduct(superAdminActor as any, {
            sku,
            name: "Barcode rollback probe",
            category: "Pantry",
          });
          addBarcodeForProduct(superAdminActor as any, {
            product_sku: created.sku,
            barcode: "8056593285012",
            format: "EAN-13",
            is_primary: true,
          });
        }),
      /already assigned/i,
    );
    const row = getDb()
      .prepare("SELECT id FROM products WHERE sku = ?")
      .get(sku);
    assert.equal(row, undefined);
  });

  it("accepts a decoded UPC-E barcode with its detected format", () => {
    const result = lookupBarcode(superAdminActor as any, "01234565", "UPC_E");
    assert.equal(result.barcode, "01234565");
    assert.equal(result.found, false);
  });
});
