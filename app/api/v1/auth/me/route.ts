import { NextRequest, NextResponse } from "next/server";
import { ApiError, handleApiError, parseJsonBody } from "@/server/core/http";
import { getDb } from "@/server/db/connection";
import { getEffectiveAuthorization, getSessionUser, recordAuditEvent, requireAuthenticatedUser } from "@/server/security/auth";

export async function GET(req: NextRequest) {
  try {
    const user = getSessionUser(req);
    if (!user) {
      return NextResponse.json(
        {
          authenticated: false,
          user: null,
          permissions: []
        },
        { status: 401 }
      );
    }

    return NextResponse.json({
      authenticated: true,
      user,
      permissions:
        user.permissions ??
        getEffectiveAuthorization({ id: user.id, role: user.role, roles: user.roles }).permissions,
      scopes: user.scopes ?? null,
      is_super_admin: user.role === "super_admin" || Boolean(user.permissions?.includes("*"))
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * Update your own profile (name) — the self-service settings page.
 * Passwords are handled separately via POST /api/v1/auth/change-password.
 */
export async function PATCH(req: NextRequest) {
  try {
    const actor = requireAuthenticatedUser(req);
    const body = await parseJsonBody<{ name?: string }>(req);
    const name = String(body?.name ?? "").trim();
    if (!name) {
      throw new ApiError(400, "VALIDATION_ERROR", "Name is required.");
    }
    const db = getDb();
    db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, actor.id);
    recordAuditEvent({
      actor,
      action: "auth.profile_updated",
      entityType: "User",
      entityId: actor.id,
      before: { name: actor.name },
      after: { name }
    });
    const user = getSessionUser(req);
    return NextResponse.json({
      authenticated: true,
      user,
      permissions: user?.permissions ?? [],
      is_super_admin: user?.role === "super_admin" || Boolean(user?.permissions?.includes("*"))
    });
  } catch (err) {
    return handleApiError(err);
  }
}
