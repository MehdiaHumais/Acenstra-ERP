import { NextRequest, NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/server/core/http";
import { requirePermission } from "@/server/security/auth";
import {
  createAccessRole,
  listAccessRoles
} from "@/server/services/access-control.service";

export async function GET(req: NextRequest) {
  try {
    const actor = requirePermission(req, "roles.read");
    return NextResponse.json({ roles: listAccessRoles(actor) });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = requirePermission(req, "roles.manage");
    const body = await parseJsonBody<{
      code?: string;
      name?: string;
      description?: string;
      base_role?: string;
      permissions?: string[];
    }>(req);
    const role = createAccessRole(actor, body);
    return NextResponse.json(role, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
