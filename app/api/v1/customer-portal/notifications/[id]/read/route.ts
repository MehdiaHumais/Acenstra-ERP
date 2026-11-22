import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { markCustomerNotificationRead } from "@/server/services/customer-order.service";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const actor = authorizeRequest(req, "orders.read");
    return NextResponse.json(markCustomerNotificationRead(actor, params.id));
  } catch (err) {
    return handleApiError(err);
  }
}
