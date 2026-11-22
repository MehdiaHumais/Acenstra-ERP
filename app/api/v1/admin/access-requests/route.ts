import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/server/core/http";
import { requirePermission } from "@/server/security/auth";
import { listAccessRequests } from "@/server/services/access-request.service";

export async function GET(req: NextRequest) {
  try {
    const actor = requirePermission(req, "users.read");
    const url = new URL(req.url);
    const result = listAccessRequests(actor, {
      search: url.searchParams.get("search") || undefined,
      status: url.searchParams.get("status") || undefined,
      limit: parseInt(url.searchParams.get("limit") || "50", 10),
      offset: parseInt(url.searchParams.get("offset") || "0", 10),
    });
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
