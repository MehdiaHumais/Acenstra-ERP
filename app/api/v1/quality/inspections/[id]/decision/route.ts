import { NextRequest } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { decideInspection } from "@/server/services/quality-gate.service";

export async function POST(req: NextRequest, context: { params: { id: string } }) {
  try {
    const actor = authorizeRequest(req, "quality.decide");
    const body = await parseJsonBody<Parameters<typeof decideInspection>[2]>(req);
    return await withIdempotency(req, `/api/v1/quality/inspections/${context.params.id}/decision`, body, async () => {
      const inspection = decideInspection(actor, context.params.id, body);
      return {
        status: 200,
        body: { inspection }
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
