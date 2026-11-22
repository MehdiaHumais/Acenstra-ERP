import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { listAuditEvents } from "@/server/security/auth";

export async function GET(req: NextRequest) {
  try {
    authorizeRequest(req, "audit:read");
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Math.min(200, Math.max(1, Number(limitParam))) : 50;
    return NextResponse.json(listAuditEvents(limit));
  } catch (err) {
    return handleApiError(err);
  }
}
