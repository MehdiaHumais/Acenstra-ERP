import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { recordRecallRecovery } from "@/server/services/exceptions-recall.service";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const actor = authorizeRequest(req, "traceability:quarantine");
    const { id } = await Promise.resolve(params);
    const body = await parseJsonBody<any>(req);

    return await withIdempotency(req, `/api/v1/exceptions-recall/recalls/${id}/recover`, body, () => {
      const recoveryLog = recordRecallRecovery(id, body, actor);
      return {
        status: 200,
        body: {
          message: `Recorded recovery of ${recoveryLog.recovered_cases} cases from ${recoveryLog.customer_name}`,
          recovery_log: recoveryLog,
        },
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
