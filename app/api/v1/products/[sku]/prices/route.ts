import { NextRequest, NextResponse } from "next/server";
import {
  authorizeRequest,
  handleApiError,
  parseJsonBody,
  withIdempotency,
} from "@/server/core/http";
import {
  addProductPrice,
  getProductDetail,
  type ProductPriceInput,
} from "@/server/services/product-master.service";

export async function GET(
  req: NextRequest,
  context: { params: { sku: string } },
) {
  try {
    authorizeRequest(req, "products:read");
    const product = getProductDetail(decodeURIComponent(context.params.sku));
    return NextResponse.json(product.prices);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: { sku: string } },
) {
  try {
    const actor = authorizeRequest(req, "products:write");
    const sku = decodeURIComponent(context.params.sku);
    const body = await parseJsonBody<ProductPriceInput>(req);
    return await withIdempotency(
      req,
      `/api/v1/products/${sku}/prices`,
      body,
      () => {
        const price = addProductPrice(actor, sku, body);
        return { status: 201, body: price };
      },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
