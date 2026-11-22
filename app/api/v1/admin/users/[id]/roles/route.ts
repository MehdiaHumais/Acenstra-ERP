import { NextRequest, NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/server/core/http";
import { requirePermission } from "@/server/security/auth";
import { updateAccessUser, UpdateUserInput } from "@/server/services/access-control.service";

/**
 * Role/scope assignment for an account. Delegates to the access-control service
 * so Super Admin protection, last-admin safeguards, privilege-escalation guards,
 * scope persistence and session revocation are all enforced in one place.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = requirePermission(req, "roles.manage");
    const body = await parseJsonBody<UpdateUserInput & { role?: string }>(req);

    const roles =
      body.roles && body.roles.length > 0
        ? body.roles
        : body.role
          ? [body.role]
          : undefined;

    const updated = updateAccessUser(actor, params.id, {
      roles,
      primary_role: body.primary_role ?? body.role,
      warehouse: body.warehouse,
      store_id: body.store_id,
      active: body.active,
      scopes: body.scopes,
      permissions: body.permissions
    });

    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}
