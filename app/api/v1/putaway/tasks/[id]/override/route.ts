import { NextRequest } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { overrideStorageRecommendation } from "@/server/services/putaway.service";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = authorizeRequest(req, "putaway.override");
    const { id } = await context.params;
    const body = await parseJsonBody<Parameters<typeof overrideStorageRecommendation>[2]>(req);
    return await withIdempotency(req, `/api/v1/putaway/tasks/${id}/override`, body, async () => {
      const detail = overrideStorageRecommendation(actor, id, body);
      return {
        status: 200,
        body: detail
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
