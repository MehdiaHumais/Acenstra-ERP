import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { listLots, postCycleCount } from "@/server/services/inventory-fefo.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "inventory:read");
    return NextResponse.json(listLots(actor));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "inventory:adjust");
    const body = await parseJsonBody<{
      batch_id: string;
      counted_cases: number;
      reason?: string;
    }>(req);

    return await withIdempotency(req, "/api/v1/inventory/lots", body, () => {
      const result = postCycleCount(actor, {
        batch_id: body.batch_id,
        counted_cases: Number(body.counted_cases),
        reason: body.reason
      });
      return { status: 200, body: result };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
