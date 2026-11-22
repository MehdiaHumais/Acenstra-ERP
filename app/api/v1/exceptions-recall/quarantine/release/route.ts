import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { releaseQuarantineLot } from "@/server/services/exceptions-recall.service";

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "traceability:quarantine");
    const body = await parseJsonBody<{
      lot_id: string;
      warehouse?: string;
      reason: string;
      target_bin_code?: string;
    }>(req);

    return await withIdempotency(req, "/api/v1/exceptions-recall/quarantine/release", body, () => {
      const result = releaseQuarantineLot(body, actor);
      return {
        status: 200,
        body: {
          message: `Lot ${result.lot_id} released from quarantine to available inventory in ${result.quarantine_bin_code}`,
          result,
        },
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
