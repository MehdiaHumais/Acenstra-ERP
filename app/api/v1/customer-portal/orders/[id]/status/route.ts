import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import {
  transitionCustomerOrderStatus,
  OrderWorkflowStatus
} from "@/server/services/customer-order.service";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const actor = authorizeRequest(req, "orders.manage");
    const body = await parseJsonBody<{ to_status: OrderWorkflowStatus; reason?: string }>(req);
    const order = transitionCustomerOrderStatus(actor, params.id, body);
    return NextResponse.json(order);
  } catch (err) {
    return handleApiError(err);
  }
}
