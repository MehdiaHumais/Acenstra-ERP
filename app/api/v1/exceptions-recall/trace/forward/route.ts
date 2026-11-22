import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { getForwardTraceability } from "@/server/services/exceptions-recall.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "traceability:read");
    const { searchParams } = new URL(req.url);
    const lotId = searchParams.get("lot_id");

    if (!lotId) {
      return NextResponse.json({ error: "lot_id query parameter is required" }, { status: 400 });
    }

    const result = getForwardTraceability(lotId, actor);
    return NextResponse.json({ result });
  } catch (err) {
    return handleApiError(err);
  }
}
