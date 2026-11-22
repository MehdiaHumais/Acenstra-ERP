import { NextRequest, NextResponse } from "next/server";
import { handleApiError, parseJsonBody, ApiError } from "@/server/core/http";
import { requirePermission } from "@/server/security/auth";
import {
  listAccessRoles,
  updateAccessRole
} from "@/server/services/access-control.service";

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  try {
    const actor = requirePermission(req, "roles.read");
    const role = listAccessRoles(actor).find((r) => r.code === params.code);
    if (!role) throw new ApiError(404, "ROLE_NOT_FOUND", "Role not found.");
    return NextResponse.json(role);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { code: string } }) {
  try {
    const actor = requirePermission(req, "roles.manage");
    const body = await parseJsonBody<{
      name?: string;
      description?: string;
      permissions?: string[];
      active?: boolean;
    }>(req);
    return NextResponse.json(updateAccessRole(actor, params.code, body));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { code: string } }) {
  try {
    const actor = requirePermission(req, "roles.manage");
    // Roles are deactivated rather than deleted so historical user assignments
    // and audit records stay intelligible. Deactivation is only permitted when
    // no user still holds the role (enforced in the service).
    return NextResponse.json(updateAccessRole(actor, params.code, { active: false }));
  } catch (err) {
    return handleApiError(err);
  }
}
