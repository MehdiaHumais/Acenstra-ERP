import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { recordDeliveryException } from "@/server/services/loading-delivery.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = authorizeRequest(req, "deliveries:update");
    const { id } = await params;
    const body = await parseJsonBody<{
      order_id?: string;
      order_number?: string;
      exception_type:
        | "customer_unavailable"
        | "delivery_refused"
        | "damaged_goods"
        | "missing_quantity"
        | "temperature_excursion"
        | "incorrect_product"
        | "access_issue"
        | "partial_delivery";
      severity?: "low" | "medium" | "high" | "critical";
      reason: string;
      affected_sku?: string;
      affected_lot?: string;
      affected_cases?: number;
      photo_url?: string;
      customer_acknowledged?: boolean;
      follow_up_action?: "return_to_warehouse" | "redeliver" | "credit_note" | "dispose" | "quarantine";
      resolution_notes?: string;
    }>(req);

    return await withIdempotency(req, `/api/v1/deliveries/${id}/exception`, body, () => {
      const exception = recordDeliveryException(actor, {
        delivery_id: id,
        ...body,
      });
      return { status: 201, body: { exception } };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
