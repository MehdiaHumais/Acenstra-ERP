import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, withIdempotency } from "@/server/core/http";
import { approveRecall } from "@/server/services/exceptions-recall.service";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const actor = authorizeRequest(req, "recalls.manage");
    const { id } = await Promise.resolve(params);

    return await withIdempotency(req, `/api/v1/exceptions-recall/recalls/${id}/approve`, {}, () => {
      const recall = approveRecall(id, actor);
      return {
        status: 200,
        body: {
          message: `Recall ${recall.recall_number} approved and activated for customer notification & recovery`,
          recall,
        },
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
