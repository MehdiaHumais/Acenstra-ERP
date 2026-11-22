import { NextRequest, NextResponse } from "next/server";
import {
  authorizeRequest,
  handleApiError,
  parseJsonBody
} from "@/server/core/http";
import {
  listProductBarcodes,
  addBarcodeForProduct,
  removeBarcode
} from "@/server/services/product-barcode.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "products:read");
    const sku = new URL(req.url).searchParams.get("sku") || undefined;
    return NextResponse.json({ barcodes: listProductBarcodes(actor, sku) });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "products:write");
    const body = await parseJsonBody<{
      product_sku: string;
      barcode: string;
      format?: string;
      is_primary?: boolean;
    }>(req);
    const created = addBarcodeForProduct(actor, body);
    return NextResponse.json({ barcode: created }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "products:write");
    const barcodeId = new URL(req.url).searchParams.get("id") || "";
    return NextResponse.json(removeBarcode(actor, barcodeId));
  } catch (err) {
    return handleApiError(err);
  }
}
