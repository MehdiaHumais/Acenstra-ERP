import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import {
  createPickWave,
  listEligibleOrdersForWave,
  listPickWaves,
  WaveStrategy
} from "@/server/services/picking-packing.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "warehouse:read");
    const { searchParams } = new URL(req.url);

    // If query mode is 'eligible_orders', return orders ready for wave generation
    if (searchParams.get("mode") === "eligible_orders") {
      const orders = listEligibleOrdersForWave(actor, {
        warehouse: searchParams.get("warehouse") || undefined,
        scheduled_delivery_date: searchParams.get("delivery_date") || undefined,
        route_code: searchParams.get("route_code") || undefined
      });
      return NextResponse.json({ orders });
    }

    const waves = listPickWaves(actor, {
      warehouse: searchParams.get("warehouse") || undefined,
      status: searchParams.get("status") || undefined,
      priority: searchParams.get("priority") || undefined,
      assigned_picker_id: searchParams.get("picker_id") || undefined,
      limit: Number(searchParams.get("limit")) || 50,
      offset: Number(searchParams.get("offset")) || 0
    });

    const includeEligible = searchParams.get("include_eligible") === "true";
    const eligibleOrders = includeEligible
      ? listEligibleOrdersForWave(actor, {
          warehouse: searchParams.get("warehouse") || undefined,
          scheduled_delivery_date: searchParams.get("delivery_date") || undefined,
          route_code: searchParams.get("route_code") || undefined
        })
      : undefined;

    return NextResponse.json({
      waves,
      ...(eligibleOrders !== undefined ? { eligible_orders: eligibleOrders } : {})
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "warehouse:update");
    const body = await parseJsonBody<{
      warehouse: string;
      strategy?: WaveStrategy;
      priority?: "urgent" | "high" | "normal" | "low";
      zone?: string;
      order_ids: string[];
      scheduled_delivery_date?: string;
      assigned_picker_id?: string;
      assigned_picker_name?: string;
      notes?: string;
    }>(req);

    return await withIdempotency(req, "/api/v1/picking/waves", body, () => {
      const wave = createPickWave(actor, body);
      return { status: 201, body: wave };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
