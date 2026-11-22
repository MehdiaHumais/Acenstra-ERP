import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { getLotBatchDetail } from "@/server/services/stock-intelligence.service";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = authorizeRequest(req, "inventory:read");
    const { id } = await context.params;
    return NextResponse.json(getLotBatchDetail(actor, decodeURIComponent(id)));
  } catch (err) {
    return handleApiError(err);
  }
}
