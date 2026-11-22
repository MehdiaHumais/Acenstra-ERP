import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { quarantineLot } from "@/server/services/exceptions-recall.service";

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "traceability:quarantine");
    const body = await parseJsonBody<{
      lot_id: string;
      warehouse?: string;
      reason: string;
      action_type?: any;
      recall_id?: string;
      exception_id?: string;
      quarantine_bin_code?: string;
    }>(req);

    return await withIdempotency(req, "/api/v1/exceptions-recall/quarantine", body, () => {
      const result = quarantineLot(body, actor);
      return {
        status: 200,
        body: {
          message: `Lot ${result.lot_id} placed on quarantine hold successfully in ${result.quarantine_bin_code}`,
          result,
        },
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
