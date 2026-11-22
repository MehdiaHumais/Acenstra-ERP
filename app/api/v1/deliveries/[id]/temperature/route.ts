import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { recordTransportTemperature } from "@/server/services/loading-delivery.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = authorizeRequest(req, "deliveries:update");
    const { id } = await params;
    const body = await parseJsonBody<{
      compartment: "chilled" | "frozen" | "ambient";
      stage: "pre_loading" | "post_loading" | "in_transit" | "arrival" | "delivery";
      actual_temp_c: number;
      notes?: string;
    }>(req);

    return await withIdempotency(req, `/api/v1/deliveries/${id}/temperature`, body, () => {
      const log = recordTransportTemperature(actor, {
        delivery_id: id,
        compartment: body.compartment,
        stage: body.stage,
        actual_temp_c: body.actual_temp_c,
        notes: body.notes,
      });
      return { status: 201, body: { log } };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
