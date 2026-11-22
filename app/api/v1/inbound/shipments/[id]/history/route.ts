import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { getHistory } from "@/server/services/inbound.service";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = authorizeRequest(req, "inbound.read");
    const history = getHistory(actor, params.id);
    return NextResponse.json({ history });
  } catch (err) {
    return handleApiError(err);
  }
}
