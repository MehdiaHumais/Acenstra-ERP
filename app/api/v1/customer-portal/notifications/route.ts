import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { listCustomerNotifications } from "@/server/services/customer-order.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "orders.read");
    const { searchParams } = new URL(req.url);

    let customerId = searchParams.get("customer_id") || undefined;
    if (actor.role === "store_vendor" || actor.role === "store_user") {
      customerId = actor.store_id || undefined;
    }

    return NextResponse.json(
      listCustomerNotifications(actor, {
        customer_id: customerId,
        unread_only: searchParams.get("unread") === "true",
        limit: Number(searchParams.get("limit")) || 50,
        offset: Number(searchParams.get("offset")) || 0
      })
    );
  } catch (err) {
    return handleApiError(err);
  }
}
