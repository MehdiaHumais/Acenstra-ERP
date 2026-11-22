import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { addQualityCheck } from "@/server/services/inbound.service";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = authorizeRequest(req, "inbound.quality");
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const qc = addQualityCheck(actor, params.id, body);
    return NextResponse.json({ quality_check: qc }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
