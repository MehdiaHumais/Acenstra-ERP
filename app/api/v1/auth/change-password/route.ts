import { NextRequest, NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/server/core/http";
import { requireAuthenticatedUser } from "@/server/security/auth";
import { recordAuditEvent } from "@/server/security/auth";
import { hashPassword, revokeAllUserRefreshTokens, verifyPassword } from "@/server/security/crypto";
import { getDb, withTransaction } from "@/server/db/connection";
import { ApiError } from "@/server/core/http";

export async function POST(req: NextRequest) {
  try {
    const actor = requireAuthenticatedUser(req);
    const body = await parseJsonBody<{ currentPassword?: string; newPassword?: string }>(req);
    const currentPassword = String(body?.currentPassword ?? "");
    const newPassword = String(body?.newPassword ?? "");

    if (newPassword.length < 8) {
      throw new ApiError(400, "WEAK_PASSWORD", "New password must be at least 8 characters long.");
    }

    const db = getDb();
    const row = db
      .prepare("SELECT password_hash FROM users WHERE id = ?")
      .get(actor.id) as { password_hash: string } | undefined;
    if (!row) throw new ApiError(404, "USER_NOT_FOUND", "Account not found.");
    if (!verifyPassword(currentPassword, row.password_hash)) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Current password is incorrect.");
    }

    withTransaction((tx) => {
      tx.prepare(
        "UPDATE users SET password_hash = ?, must_change_password = 0, failed_attempts = 0, locked_until = NULL WHERE id = ?"
      ).run(hashPassword(newPassword), actor.id);
    });
    revokeAllUserRefreshTokens(actor.id);

    recordAuditEvent({
      actor,
      action: "auth.password_changed",
      entityType: "User",
      entityId: actor.id
    });

    return NextResponse.json({ changed: true });
  } catch (err) {
    return handleApiError(err);
  }
}
