import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import {
  listDeliveryPlans,
  generateDeliveryFromStagedOrders,
} from "@/server/services/loading-delivery.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "deliveries:read");
    const { searchParams } = new URL(req.url);

    const deliveries = listDeliveryPlans(actor, {
      warehouse: searchParams.get("warehouse") || undefined,
      status: searchParams.get("status") || undefined,
      route_code: searchParams.get("route_code") || undefined,
      driver_id: searchParams.get("driver_id") || undefined,
      date: searchParams.get("date") || undefined,
    });

    return NextResponse.json({ deliveries });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "deliveries:update");
    const body = await parseJsonBody<{
      order_ids: string[];
      route_code: string;
      delivery_date?: string;
      time_window_start?: string;
      time_window_end?: string;
      priority?: "low" | "normal" | "high" | "urgent";
      vehicle_id?: string;
      driver_id?: string;
      warehouse?: string;
    }>(req);

    return await withIdempotency(req, "/api/v1/deliveries/plan", body, () => {
      const delivery = generateDeliveryFromStagedOrders(actor, body);
      return { status: 201, body: { delivery } };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
