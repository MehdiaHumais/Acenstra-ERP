import { NextRequest, NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/server/core/http";
import { requirePermission } from "@/server/security/auth";
import {
  createInvitation,
  listInvitations,
  type InvitationInput
} from "@/server/services/user-onboarding.service";

export async function GET(req: NextRequest) {
  try {
    const actor = requirePermission(req, "users.read");
    const url = new URL(req.url);
    const result = listInvitations(actor, {
      search: url.searchParams.get("search") || undefined,
      status: url.searchParams.get("status") || undefined,
      limit: parseInt(url.searchParams.get("limit") || "50", 10),
      offset: parseInt(url.searchParams.get("offset") || "0", 10)
    });
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = requirePermission(req, "users.manage");
    const body = await parseJsonBody<InvitationInput>(req);
    const created = await createInvitation(actor, body);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
