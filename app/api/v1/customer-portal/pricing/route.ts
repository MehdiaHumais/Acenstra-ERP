import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { resolveProductPricing } from "@/server/services/customer-order.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "products.read");
    const { searchParams } = new URL(req.url);

    const sku = searchParams.get("sku");
    if (!sku) {
      return NextResponse.json({ error: "SKU parameter is required" }, { status: 400 });
    }

    let customerId = searchParams.get("customer_id") || undefined;
    if (actor.role === "store_vendor" || actor.role === "store_user") {
      customerId = actor.store_id || undefined;
    }
    if (!customerId) {
      return NextResponse.json({ error: "Customer ID is required" }, { status: 400 });
    }

    const quantity = Number(searchParams.get("quantity")) || 1;
    const targetDate = searchParams.get("target_date") || undefined;

    const pricing = resolveProductPricing(actor, {
      customer_id: customerId,
      sku,
      quantity,
      target_date: targetDate
    });

    return NextResponse.json(pricing);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "products.read");
    const body = await parseJsonBody<{
      customer_id?: string;
      sku: string;
      quantity?: number;
      target_date?: string;
    }>(req);

    let customerId = body.customer_id;
    if (actor.role === "store_vendor" || actor.role === "store_user") {
      customerId = actor.store_id || undefined;
    }
    if (!customerId) {
      return NextResponse.json({ error: "Customer ID is required" }, { status: 400 });
    }

    const pricing = resolveProductPricing(actor, {
      customer_id: customerId,
      sku: body.sku,
      quantity: body.quantity || 1,
      target_date: body.target_date
    });

    return NextResponse.json(pricing);
  } catch (err) {
    return handleApiError(err);
  }
}
