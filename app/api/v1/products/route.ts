import { NextRequest, NextResponse } from "next/server";
import {
  authorizeRequest,
  handleApiError,
  parseJsonBody,
  withIdempotency,
} from "@/server/core/http";
import {
  createProduct,
  listProducts,
  type ProductWriteInput,
} from "@/server/services/product-master.service";

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
    const body = await parseJsonBody<ProductWriteInput>(req);

    return await withIdempotency(req, "/api/v1/products", body, () => {
      const product = createProduct(actor, body);
      return { status: 201, body: product };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
