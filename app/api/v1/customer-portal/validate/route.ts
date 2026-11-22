import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { validateCustomerOrder } from "@/server/services/customer-order.service";

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "orders.read");
    const body = await parseJsonBody<{
      customer_id?: string;
      delivery_date: string;
      warehouse?: string;
      lines: Array<{ sku: string; cases: number; uom?: string }>;
    }>(req);

    let customerId = body.customer_id;
    if (actor.role === "store_vendor" || actor.role === "store_user") {
      customerId = actor.store_id || undefined;
    }

    const evaluation = validateCustomerOrder(actor, {
      customer_id: customerId,
      delivery_date: body.delivery_date,
      warehouse: body.warehouse,
      lines: body.lines || []
    });

    return NextResponse.json(evaluation);
  } catch (err) {
    return handleApiError(err);
  }
}
