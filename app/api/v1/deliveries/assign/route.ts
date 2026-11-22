import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { assignVehicleAndDriver } from "@/server/services/loading-delivery.service";

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "deliveries:update");
    const body = await parseJsonBody<{
      delivery_id: string;
      vehicle_id: string;
      driver_id: string;
      override_capacity_check?: boolean;
    }>(req);

    return await withIdempotency(req, "/api/v1/deliveries/assign", body, () => {
      const delivery = assignVehicleAndDriver(actor, body);
      return { status: 200, body: { delivery } };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
