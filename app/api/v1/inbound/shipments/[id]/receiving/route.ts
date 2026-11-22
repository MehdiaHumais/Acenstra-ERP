import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { receiveGoods } from "@/server/services/inbound.service";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = authorizeRequest(req, "inbound.receive");
    const body = await parseJsonBody<Record<string, unknown>>(req);
    return await withIdempotency(req, `/api/v1/inbound/shipments/${params.id}/receiving`, body, async () => {
      const detail = receiveGoods(actor, params.id, body);
      return { body: detail };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
