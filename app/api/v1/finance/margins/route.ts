import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { getDeliveredMarginReport } from "@/server/services/finance.service";
import type { DeliveredMarginReport } from "@/lib/types";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "finance:read");
    const { searchParams } = new URL(req.url);
    const dimension = (searchParams.get("dimension") || "product") as DeliveredMarginReport["dimension"];

    const report = getDeliveredMarginReport(actor, dimension);
    return NextResponse.json({ dimension, report, count: report.length });
  } catch (err) {
    return handleApiError(err);
  }
}
