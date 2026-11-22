import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { verifyDocument } from "@/server/services/inbound.service";

export async function POST(req: NextRequest, { params }: { params: { id: string; docId: string } }) {
  try {
    const actor = authorizeRequest(req, "inbound.documents");
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const doc = verifyDocument(actor, params.id, params.docId, body);
    return NextResponse.json({ document: doc });
  } catch (err) {
    return handleApiError(err);
  }
}
