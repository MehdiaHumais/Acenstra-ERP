import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { generateProductDemandForecasts } from "@/server/services/management-ai.service";

export async function GET(req: NextRequest) {
  try {
    const user = authorizeRequest(req, "reports.executive.read");
    const { searchParams } = new URL(req.url);
    const lookbackDays = searchParams.get("lookback_days") ? parseInt(searchParams.get("lookback_days")!, 10) : 30;
    const horizonDays = searchParams.get("horizon_days") ? parseInt(searchParams.get("horizon_days")!, 10) : 14;

    const forecasts = await generateProductDemandForecasts(lookbackDays, horizonDays, user);
    return NextResponse.json({ forecasts });
  } catch (err) {
    return handleApiError(err);
  }
}
