import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { quarantineShipment } from "@/server/services/inbound.service";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = authorizeRequest(req, "inbound.decision");
    const body = await parseJsonBody<Record<string, unknown>>(req);
    return await withIdempotency(req, `/api/v1/inbound/shipments/${params.id}/quarantine`, body, async () => {
      const detail = quarantineShipment(actor, params.id, body);
      return { body: detail };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
