import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { getCustomerOrder } from "@/server/services/customer-order.service";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const actor = authorizeRequest(req, "orders.read");
    const order = getCustomerOrder(actor, params.id);
    return NextResponse.json(order);
  } catch (err) {
    return handleApiError(err);
  }
}
