import { NextRequest } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { confirmPutawayPlacement } from "@/server/services/putaway.service";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = authorizeRequest(req, "putaway.execute");
    const { id } = await context.params;
    const body = await parseJsonBody<Parameters<typeof confirmPutawayPlacement>[2]>(req);
    return await withIdempotency(req, `/api/v1/putaway/tasks/${id}/confirm`, body, async () => {
      const result = confirmPutawayPlacement(actor, id, body);
      return {
        status: 200,
        body: result
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
