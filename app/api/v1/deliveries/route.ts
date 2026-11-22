import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { listDeliveries, updateDelivery } from "@/server/services/deliveries-traceability.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "deliveries:read");
    return NextResponse.json(listDeliveries(actor));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "deliveries:update");
    const body = await parseJsonBody<{
      delivery_id: string;
      action: "start_load" | "dispatch" | "capture_pod" | "resolve" | "record_exception";
      reason?: string;
      temp_c?: number;
    }>(req);

    const updated = updateDelivery(actor, body);
    return NextResponse.json({
      delivery: updated,
      deliveries: listDeliveries(actor)
    });
  } catch (err) {
    return handleApiError(err);
  }
}
