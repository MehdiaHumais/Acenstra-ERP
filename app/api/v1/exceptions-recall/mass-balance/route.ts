import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { calculateLotMassBalance } from "@/server/services/exceptions-recall.service";

export async function GET(req: NextRequest) {
  try {
    authorizeRequest(req, "traceability:read");
    const { searchParams } = new URL(req.url);
    const lotId = searchParams.get("lot_id");
    const warehouse = searchParams.get("warehouse") || undefined;

    if (!lotId) {
      return NextResponse.json({ error: "lot_id query parameter is required" }, { status: 400 });
    }

    const massBalance = calculateLotMassBalance(lotId, warehouse);
    return NextResponse.json({ mass_balance: massBalance });
  } catch (err) {
    return handleApiError(err);
  }
}
