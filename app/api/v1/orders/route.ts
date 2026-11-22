import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import type { SalesOrder } from "@/lib/types";
import {
  cancelOrder,
  createOrder,
  deleteOrder,
  listOrders,
  releaseOrderCredit,
  transitionOrderStatus,
  updateOrder
} from "@/server/services/orders-warehouse.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "orders:read");
    return NextResponse.json(listOrders(actor));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "orders:write");
    const body = await parseJsonBody<{
      customer?: string;
      customerName?: string;
      customer_name?: string;
      customer_type?: SalesOrder["customer_type"];
      segment?: string;
      channel?: "b2b_portal" | "sales_rep" | "edi" | "phone";
      delivery_date?: string;
      deliveryDate?: string;
      warehouse?: string;
      sku?: string;
      product_name?: string;
      unit_price_cents?: number;
      cases?: number;
      quantityCases?: number;
      quantity_kg?: number;
      total_cents?: number;
      lines?: Array<{
        sku: string;
        quantityCases?: number;
        cases?: number;
        product_name?: string;
        unit_price_cents?: number;
      }>;
    }>(req);

    const firstLine = body.lines?.[0];
    const customer = (body.customer || body.customerName || body.customer_name || "").trim();
    const sku = body.sku || firstLine?.sku || "SKU-SAL-001";
    const cases = body.cases || body.quantityCases || firstLine?.quantityCases || firstLine?.cases || 1;
    const delivery_date = body.delivery_date || body.deliveryDate;

    return await withIdempotency(req, "/api/v1/orders", body, () => {
      const order = createOrder(actor, {
        ...body,
        customer,
        customer_name: customer,
        sku,
        cases,
        delivery_date
      });
      return {
        status: 201,
        body: {
          ...order,
          order_number: order.number,
          orderNumber: order.number
        }
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    authorizeRequest(req); // rate-limit + authentication, per-action permission enforced below
    const body = await parseJsonBody<{
      order_id: string | number;
      action: "release_credit" | "advance" | "cancel" | "edit" | "delete";
      reason?: string;
      customer?: string;
      customer_name?: string;
      customer_type?: SalesOrder["customer_type"];
      sku?: string;
      quantity_kg?: number;
      cases?: number;
      promised_at?: string;
      delivery_date?: string;
      status?: SalesOrder["status"];
    }>(req);

    const actor =
      body.action === "release_credit"
        ? authorizeRequest(req, "orders:credit_override")
        : authorizeRequest(req, "orders:write");

    if (body.action === "release_credit") {
      const updated = releaseOrderCredit(actor, body.order_id, body.reason);
      return NextResponse.json(updated);
    }

    if (body.action === "cancel") {
      const updated = cancelOrder(actor, body.order_id, body.reason);
      return NextResponse.json(updated);
    }

    if (body.action === "edit") {
      const updated = updateOrder(actor, body.order_id, body);
      return NextResponse.json(updated);
    }

    if (body.action === "delete") {
      const deleted = deleteOrder(actor, body.order_id);
      return NextResponse.json(deleted);
    }

    const updated = transitionOrderStatus(actor, body.order_id);
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "orders:write");
    const orderId =
      req.nextUrl.searchParams.get("order_id") ??
      ((await parseJsonBody<{ order_id: string | number }>(req).catch(() => ({ order_id: "" }))).order_id);
    const deleted = deleteOrder(actor, orderId);
    return NextResponse.json(deleted);
  } catch (err) {
    return handleApiError(err);
  }
}
