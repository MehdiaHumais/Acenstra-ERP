import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { getDashboardOverview, markAlertsRead } from "@/server/services/finance-analytics.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "dashboard:read");
    return NextResponse.json(getDashboardOverview(actor));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "dashboard:read");
    const body = await parseJsonBody<{ alert_ids?: string[] }>(req);
    const result = markAlertsRead(actor, body.alert_ids);
    return NextResponse.json({
      ...result,
      overview: getDashboardOverview(actor)
    });
  } catch (err) {
    return handleApiError(err);
  }
}
