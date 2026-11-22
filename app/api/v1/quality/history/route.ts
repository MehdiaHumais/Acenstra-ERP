import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { getQualityHistory } from "@/server/services/quality-gate.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "quality.read");
    const url = new URL(req.url);
    const history = getQualityHistory(actor, {
      lot: url.searchParams.get("lot"),
      supplier_id: url.searchParams.get("supplier_id"),
      sku: url.searchParams.get("sku"),
      warehouse: url.searchParams.get("warehouse")
    });
    return NextResponse.json(history);
  } catch (err) {
    return handleApiError(err);
  }
}
