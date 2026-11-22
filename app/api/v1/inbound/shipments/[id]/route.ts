import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { getShipmentDetail, updateShipment } from "@/server/services/inbound.service";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = authorizeRequest(req, "inbound.read");
    const detail = getShipmentDetail(actor, params.id);
    return NextResponse.json(detail);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = authorizeRequest(req, "inbound.manage");
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const detail = updateShipment(actor, params.id, body);
    return NextResponse.json(detail);
  } catch (err) {
    return handleApiError(err);
  }
}
