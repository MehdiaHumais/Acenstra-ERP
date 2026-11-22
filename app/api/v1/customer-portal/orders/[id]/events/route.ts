import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { listCustomerOrderEvents } from "@/server/services/customer-order.service";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const actor = authorizeRequest(req, "orders.read");
    return NextResponse.json({ events: listCustomerOrderEvents(actor, params.id) });
  } catch (err) {
    return handleApiError(err);
  }
}
