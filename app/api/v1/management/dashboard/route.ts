import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { getCeoDashboardKpis } from "@/server/services/management-ai.service";

export async function GET(req: NextRequest) {
  try {
    const user = authorizeRequest(req, "dashboard:read");
    const kpis = await getCeoDashboardKpis(user);
    return NextResponse.json({ kpis });
  } catch (err) {
    return handleApiError(err);
  }
}
