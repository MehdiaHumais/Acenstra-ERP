import { NextRequest, NextResponse } from "next/server";
import {
  authorizeRequest,
  handleApiError,
  parseJsonBody,
  withIdempotency,
} from "@/server/core/http";
import { withTransaction } from "@/server/db/connection";
import { addBarcodeForProduct } from "@/server/services/product-barcode.service";
import {
  createProduct,
  listProducts,
  type ProductWriteInput,
} from "@/server/services/product-master.service";

type ProductCreateBody = ProductWriteInput & {
  barcode?: string;
  barcode_format?: string;
};

export async function GET(req: NextRequest) {
  try {
    authorizeRequest(req, "products:read");
    return NextResponse.json(listProducts());
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "products:write");
    const body = await parseJsonBody<ProductCreateBody>(req);

    return await withIdempotency(req, "/api/v1/products", body, () => {
      // A decoded barcode is registered in the same transaction as the product.
      // A duplicate barcode therefore fails the whole create — no orphan product
      // and never a second product for an existing barcode.
      const { barcode, barcode_format, ...writeInput } = body;
      const product = withTransaction(() => {
        const created = createProduct(actor, writeInput);
        const decodedBarcode = typeof barcode === "string" ? barcode.trim() : "";
        if (decodedBarcode) {
          addBarcodeForProduct(actor, {
            product_sku: created.sku,
            barcode: decodedBarcode,
            format: barcode_format,
            is_primary: true,
          });
        }
        return created;
      });
      return { status: 201, body: product };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
