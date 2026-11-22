import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { cancelCustomerOrder } from "@/server/services/customer-order.service";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const actor = authorizeRequest(req, "orders.manage");
    const body = await parseJsonBody<{ reason?: string }>(req);
    const order = cancelCustomerOrder(actor, params.id, body.reason || "Customer requested cancellation");
    return NextResponse.json(order);
  } catch (err) {
    return handleApiError(err);
  }
}
