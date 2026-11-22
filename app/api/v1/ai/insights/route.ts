import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { decideAiInsight, listAiInsights } from "@/server/services/finance-analytics.service";

export async function GET(req: NextRequest) {
  try {
    authorizeRequest(req, "ai:read");
    return NextResponse.json(listAiInsights());
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "ai:approve");
    const body = await parseJsonBody<{
      insight_id: string;
      decision: "approved" | "rejected";
      reason?: string;
    }>(req);

    const updated = decideAiInsight(actor, body);
    return NextResponse.json({
      insight: updated,
      insights: listAiInsights()
    });
  } catch (err) {
    return handleApiError(err);
  }
}
