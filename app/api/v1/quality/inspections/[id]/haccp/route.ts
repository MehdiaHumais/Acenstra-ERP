import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import {
  getInspectionDetail,
  recordHaccpReading,
  rejectImmutableHaccpMutation
} from "@/server/services/quality-gate.service";

export async function GET(req: NextRequest, context: { params: { id: string } }) {
  try {
    const actor = authorizeRequest(req, "quality.inspect");
    const detail = getInspectionDetail(actor, context.params.id);
    return NextResponse.json({
      inspection_id: detail.id,
      haccp_readings: detail.haccp_readings
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest, context: { params: { id: string } }) {
  try {
    const actor = authorizeRequest(req, "quality.inspect");
    const body = await parseJsonBody<Parameters<typeof recordHaccpReading>[2]>(req);
    return await withIdempotency(req, `/api/v1/quality/inspections/${context.params.id}/haccp`, body, async () => {
      const result = recordHaccpReading(actor, context.params.id, body);
      return {
        status: 201,
        body: result
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, context: { params: { id: string } }) {
  try {
    const actor = authorizeRequest(req, "quality.inspect");
    rejectImmutableHaccpMutation(actor, context.params.id);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, context: { params: { id: string } }) {
  try {
    const actor = authorizeRequest(req, "quality.inspect");
    rejectImmutableHaccpMutation(actor, context.params.id);
  } catch (err) {
    return handleApiError(err);
  }
}
