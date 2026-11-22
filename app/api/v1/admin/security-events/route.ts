import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/server/core/http";
import { requirePermission } from "@/server/security/auth";
import { listSecurityEvents } from "@/server/services/access-control.service";

export async function GET(req: NextRequest) {
  try {
    const actor = requirePermission(req, "audit.security.read");
    const url = new URL(req.url);
    return NextResponse.json(
      listSecurityEvents(actor, {
        limit: parseInt(url.searchParams.get("limit") || "50", 10),
        offset: parseInt(url.searchParams.get("offset") || "0", 10),
        action: url.searchParams.get("action") || undefined,
        actor: url.searchParams.get("actor") || undefined
      })
    );
  } catch (err) {
    return handleApiError(err);
  }
}
