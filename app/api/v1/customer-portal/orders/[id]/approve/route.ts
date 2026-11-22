import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { approveCreditException } from "@/server/services/customer-order.service";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const actor = authorizeRequest(req, "orders:credit_override");
    const body = await parseJsonBody<{ reason: string; notes?: string }>(req);
    const order = approveCreditException(actor, params.id, body);
    return NextResponse.json(order);
  } catch (err) {
    return handleApiError(err);
  }
}
