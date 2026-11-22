import { NextRequest, NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/server/core/http";
import { requirePermission } from "@/server/security/auth";
import { getAccessUser, updateAccessUser } from "@/server/services/access-control.service";
import { generateTemporaryPassword } from "@/server/services/user-onboarding.service";

// POST — reset a user's password to a one-time temporary password (requires users.manage).
// Returns the password exactly once; the user is forced to set their own on next sign-in.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = requirePermission(req, "users.manage");
    const temporaryPassword = generateTemporaryPassword();
    const updated = updateAccessUser(actor, params.id, { password: temporaryPassword });
    return NextResponse.json({
      id: updated.id,
      email: updated.email,
      temporary_password: temporaryPassword,
      must_change_password: true,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
