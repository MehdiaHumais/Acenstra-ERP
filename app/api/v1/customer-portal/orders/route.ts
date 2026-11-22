import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { listCustomerOrders, submitCustomerOrder } from "@/server/services/customer-order.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "orders.read");
    const { searchParams } = new URL(req.url);

    let customerId = searchParams.get("customer_id") || undefined;
    if (actor.role === "store_vendor" || actor.role === "store_user") {
      customerId = actor.store_id || undefined;
    }

    const status = searchParams.get("status") || undefined;
    const search = searchParams.get("search") || undefined;
    const limit = Number(searchParams.get("limit")) || 50;
    const offset = Number(searchParams.get("offset")) || 0;

    const orders = listCustomerOrders(actor, {
      customer_id: customerId,
      status,
      search,
      limit,
      offset
    });

    return NextResponse.json(orders);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "orders.manage");
    const body = await parseJsonBody<{
      customer_id?: string;
      channel?: "b2b_portal" | "sales_rep" | "edi" | "phone";
      po_reference?: string;
      delivery_date: string;
      delivery_address?: string;
      delivery_notes?: string;
      warehouse?: string;
      allow_backorders?: boolean;
      lines: Array<{ sku: string; cases: number; uom?: string; notes?: string }>;
    }>(req);

    let customerId = body.customer_id;
    if (actor.role === "store_vendor" || actor.role === "store_user") {
      customerId = actor.store_id || undefined;
    }

    return await withIdempotency(req, "/api/v1/customer-portal/orders", body, () => {
      const order = submitCustomerOrder(actor, {
        ...body,
        customer_id: customerId
      });
      return { status: 201, body: order };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
