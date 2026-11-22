import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { listPutawayHistory } from "@/server/services/putaway.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "putaway.read");
    const url = new URL(req.url);
    const result = listPutawayHistory(actor, {
      warehouse: url.searchParams.get("warehouse"),
      lot: url.searchParams.get("lot"),
      sku: url.searchParams.get("sku"),
      bin_code: url.searchParams.get("bin_code")
    });
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
