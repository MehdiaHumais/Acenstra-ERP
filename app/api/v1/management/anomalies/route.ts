import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { detectOperationalAnomalies } from "@/server/services/management-ai.service";

export async function GET(req: NextRequest) {
  try {
    const user = authorizeRequest(req, "dashboard:read");
    const anomalies = await detectOperationalAnomalies(user);
    return NextResponse.json({ anomalies });
  } catch (err) {
    return handleApiError(err);
  }
}
