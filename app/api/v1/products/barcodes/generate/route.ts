import { NextRequest, NextResponse } from "next/server";
import {
  authorizeRequest,
  handleApiError,
  parseJsonBody
} from "@/server/core/http";
import { generateInternalBarcode } from "@/server/services/product-barcode.service";

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "products:write");
    const body = await parseJsonBody<{ product_sku?: string }>(req);
    const sku = String(body?.product_sku ?? "").trim();
    if (!sku) {
      return NextResponse.json(
        { error: { code: "SKU_REQUIRED", message: "product_sku is required." } },
        { status: 400 }
      );
    }
    const created = generateInternalBarcode(actor, { product_sku: sku });
    return NextResponse.json({ barcode: created }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
