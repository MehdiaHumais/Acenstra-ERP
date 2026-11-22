import { NextRequest, NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/server/core/http";
import { requirePermission } from "@/server/security/auth";
import {
  createManualUser,
  type ManualCreateInput
} from "@/server/services/user-onboarding.service";

export async function POST(req: NextRequest) {
  try {
    const actor = requirePermission(req, "users.manage");
    const body = await parseJsonBody<ManualCreateInput>(req);
    const created = createManualUser(actor, body);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
