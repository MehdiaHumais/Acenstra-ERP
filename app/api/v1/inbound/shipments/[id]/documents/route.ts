import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { addDocument, getShipmentDetail } from "@/server/services/inbound.service";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = authorizeRequest(req, "inbound.read");
    const detail = getShipmentDetail(actor, params.id);
    return NextResponse.json({ documents: detail.documents });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = authorizeRequest(req, "inbound.documents");
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const doc = addDocument(actor, params.id, body);
    return NextResponse.json({ document: doc }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
