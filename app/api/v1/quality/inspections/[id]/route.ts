import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { getInspectionDetail, updateInspection } from "@/server/services/quality-gate.service";

export async function GET(req: NextRequest, context: { params: { id: string } }) {
  try {
    const actor = authorizeRequest(req, "quality.read");
    const detail = getInspectionDetail(actor, context.params.id);
    return NextResponse.json({ inspection: detail });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, context: { params: { id: string } }) {
  try {
    const actor = authorizeRequest(req, "quality.inspect");
    const body = await parseJsonBody<Parameters<typeof updateInspection>[2]>(req);
    return await withIdempotency(req, `/api/v1/quality/inspections/${context.params.id}`, body, async () => {
      const inspection = updateInspection(actor, context.params.id, body);
      return {
        status: 200,
        body: { inspection }
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
