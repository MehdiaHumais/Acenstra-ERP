import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { closeRecall } from "@/server/services/exceptions-recall.service";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const actor = authorizeRequest(req, "recalls.manage");
    const { id } = await Promise.resolve(params);
    const body = await parseJsonBody<{ closure_notes: string }>(req);

    return await withIdempotency(req, `/api/v1/exceptions-recall/recalls/${id}/close`, body, () => {
      const recall = closeRecall(id, body.closure_notes, actor);
      return {
        status: 200,
        body: {
          message: `Product recall ${recall.recall_number} has been formally closed and verified`,
          recall,
        },
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
