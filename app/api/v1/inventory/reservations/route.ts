import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, authorizeRequestAnyOf, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import {
  createStockReservation,
  listStockReservations
} from "@/server/services/stock-intelligence.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "inventory:read");
    const sp = req.nextUrl.searchParams;
    const items = listStockReservations(actor, {
      warehouse: sp.get("warehouse"),
      status: sp.get("status"),
      order_number: sp.get("order_number"),
      sku: sp.get("sku"),
      lot: sp.get("lot")
    });
    const allEvents = items.flatMap((r) => r.events || []);
    return NextResponse.json({ items, reservations: items, events: allEvents });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequestAnyOf(req, ["inventory.reserve", "inventory:adjust", "orders:write", "orders:credit_override"]);
    const body = await parseJsonBody<{
      order_id?: string | null;
      order_number?: string | null;
      order_line_id?: string | null;
      customer_id?: string | null;
      customer_name?: string | null;
      customer_segment?: string | null;
      sku: string;
      internal_lot?: string | null;
      requested_cases: number;
      warehouse?: string | null;
      delivery_date?: string | null;
      order_min_remaining_days?: number | null;
      allow_partial?: boolean;
      ttl_hours?: number;
    }>(req);

    return await withIdempotency(req, "/api/v1/inventory/reservations", body, () => {
      const result = createStockReservation(actor, body);
      return { status: 201, body: result };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
