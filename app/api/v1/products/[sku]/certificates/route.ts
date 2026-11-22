import { NextRequest, NextResponse } from "next/server";
import {
  authorizeRequest,
  handleApiError,
  parseJsonBody,
  withIdempotency,
} from "@/server/core/http";
import {
  addProductCertificate,
  getProductDetail,
  type ProductCertificateInput,
} from "@/server/services/product-master.service";

export async function GET(
  req: NextRequest,
  context: { params: { sku: string } },
) {
  try {
    authorizeRequest(req, "products:read");
    const product = getProductDetail(decodeURIComponent(context.params.sku));
    return NextResponse.json(product.certificates);
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
    const body = await parseJsonBody<ProductCertificateInput>(req);
    return await withIdempotency(
      req,
      `/api/v1/products/${sku}/certificates`,
      body,
      () => {
        const certificate = addProductCertificate(actor, sku, body);
        return { status: 201, body: certificate };
      },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
