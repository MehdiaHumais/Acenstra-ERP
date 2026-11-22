import { NextRequest, NextResponse } from "next/server";
import {
  authorizeRequest,
  handleApiError,
  parseJsonBody,
} from "@/server/core/http";
import {
  getProductDetail,
  updateProduct,
  discontinueProduct,
  type ProductWriteInput,
} from "@/server/services/product-master.service";

export async function GET(
  req: NextRequest,
  context: { params: { sku: string } },
) {
  try {
    authorizeRequest(req, "products:read");
    return NextResponse.json(getProductDetail(decodeURIComponent(context.params.sku)));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: { sku: string } },
) {
  try {
    const actor = authorizeRequest(req, "products:write");
    const body = await parseJsonBody<ProductWriteInput>(req);
    const product = updateProduct(
      actor,
      decodeURIComponent(context.params.sku),
      body,
    );
    return NextResponse.json(product);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: { sku: string } },
) {
  try {
    const actor = authorizeRequest(req, "products:write");
    // Body is optional — DELETE requests are often sent without one.
    let reason: string | undefined;
    try {
      const body = (await req.json()) as { reason?: unknown };
      if (typeof body?.reason === "string") reason = body.reason;
    } catch {
      reason = undefined;
    }
    const product = discontinueProduct(
      actor,
      decodeURIComponent(context.params.sku),
      reason,
    );
    return NextResponse.json(product);
  } catch (err) {
    return handleApiError(err);
  }
}
