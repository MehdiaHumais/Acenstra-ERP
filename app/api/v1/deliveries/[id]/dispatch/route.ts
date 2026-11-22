import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { dispatchDelivery } from "@/server/services/loading-delivery.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = authorizeRequest(req, "deliveries:update");
    const { id } = await params;
    const body = await parseJsonBody<{
      departure_time?: string;
      odometer_km?: number;
    }>(req).catch(() => ({}));

    return await withIdempotency(req, `/api/v1/deliveries/${id}/dispatch`, body, () => {
      const delivery = dispatchDelivery(actor, id, body);
      return { status: 200, body: { delivery } };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
