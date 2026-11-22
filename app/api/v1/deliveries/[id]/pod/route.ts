import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { captureProofOfDelivery } from "@/server/services/loading-delivery.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = authorizeRequest(req, "deliveries:update");
    const { id } = await params;
    const body = await parseJsonBody<{
      order_id?: string;
      order_number?: string;
      customer_id?: string;
      customer_name?: string;
      recipient_name: string;
      recipient_role?: string;
      signature_data: string;
      photo_url?: string;
      delivered_cases: number;
      accepted_cases: number;
      rejected_cases?: number;
      delivery_notes?: string;
    }>(req);

    return await withIdempotency(req, `/api/v1/deliveries/${id}/pod`, body, () => {
      const pod = captureProofOfDelivery(actor, {
        delivery_id: id,
        ...body,
      });
      return { status: 201, body: { pod } };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
