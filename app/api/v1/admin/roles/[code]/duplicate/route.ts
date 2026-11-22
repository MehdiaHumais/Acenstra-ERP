import { NextRequest, NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/server/core/http";
import { requirePermission } from "@/server/security/auth";
import { duplicateAccessRole } from "@/server/services/access-control.service";

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  try {
    const actor = requirePermission(req, "roles.manage");
    const body = await parseJsonBody<{ name?: string; code?: string }>(req);
    const role = duplicateAccessRole(actor, params.code, body);
    return NextResponse.json(role, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
