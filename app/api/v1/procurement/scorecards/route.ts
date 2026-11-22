import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { listSupplierScorecards } from "@/server/services/procurement.service";

export async function GET(req: NextRequest) {
  try {
    authorizeRequest(req, "suppliers:read");
    return NextResponse.json({ scorecards: listSupplierScorecards() });
  } catch (err) {
    return handleApiError(err);
  }
}
