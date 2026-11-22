import { NextRequest, NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/server/core/http";
import { requirePermission } from "@/server/security/auth";
import {
  resendInvitation,
  revokeInvitation,
  updateInvitation,
  deleteInvitation
} from "@/server/services/user-onboarding.service";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = requirePermission(req, "users.manage");
    const { id } = await context.params;
    const body = await parseJsonBody<{
      action?: string;
      name?: string;
      roles?: string[];
      warehouse?: string;
      store_id?: string | null;
    }>(req);
    switch (body?.action) {
      case "resend":
        return NextResponse.json(await resendInvitation(actor, id));
      case "revoke":
        return NextResponse.json(revokeInvitation(actor, id));
      case "update":
        return NextResponse.json(
          updateInvitation(actor, id, {
            name: body.name,
            roles: body.roles,
            warehouse: body.warehouse,
            store_id: body.store_id
          })
        );
      case "delete":
        return NextResponse.json(deleteInvitation(actor, id));
      default:
        return NextResponse.json(
          { error: { code: "INVALID_ACTION", message: "action must be 'resend', 'revoke', 'update' or 'delete'." } },
          { status: 400 }
        );
    }
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = requirePermission(req, "users.manage");
    const { id } = await context.params;
    return NextResponse.json(deleteInvitation(actor, id));
  } catch (err) {
    return handleApiError(err);
  }
}
