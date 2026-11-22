import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { getCapaDetail, updateCapa } from "@/server/services/quality-gate.service";

export async function GET(req: NextRequest, context: { params: { id: string } }) {
  try {
    const actor = authorizeRequest(req, "quality.read");
    const capa = getCapaDetail(actor, context.params.id);
    return NextResponse.json({ capa });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, context: { params: { id: string } }) {
  try {
    const actor = authorizeRequest(req, "quality.capa");
    const body = await parseJsonBody<Parameters<typeof updateCapa>[2]>(req);
    return await withIdempotency(req, `/api/v1/quality/capas/${context.params.id}`, body, async () => {
      const capa = updateCapa(actor, context.params.id, body);
      return {
        status: 200,
        body: { capa }
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
