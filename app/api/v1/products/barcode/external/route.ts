import { NextRequest, NextResponse } from "next/server";
import {
  authorizeRequest,
  handleApiError,
  parseJsonBody
} from "@/server/core/http";
import {
  registerExternalProduct,
  type ExternalProductInput
} from "@/server/services/external-product.service";

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "products:write");
    const body = await parseJsonBody<ExternalProductInput>(req);
    const result = registerExternalProduct(actor, body ?? ({} as ExternalProductInput));
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
