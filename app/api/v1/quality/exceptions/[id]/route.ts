import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, authorizeRequestAnyOf, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { getExceptionDetail, updateException } from "@/server/services/quality-gate.service";

export async function GET(req: NextRequest, context: { params: { id: string } }) {
  try {
    const actor = authorizeRequest(req, "quality.read");
    const exception = getExceptionDetail(actor, context.params.id);
    return NextResponse.json({ exception });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, context: { params: { id: string } }) {
  try {
    const actor = authorizeRequestAnyOf(req, ["quality.inspect", "quality.decide"]);
    const body = await parseJsonBody<Parameters<typeof updateException>[2]>(req);
    return await withIdempotency(req, `/api/v1/quality/exceptions/${context.params.id}`, body, async () => {
      const exception = updateException(actor, context.params.id, body);
      return {
        status: 200,
        body: { exception }
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
