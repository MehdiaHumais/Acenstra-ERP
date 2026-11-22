import { NextRequest, NextResponse } from "next/server";
import { handleApiError, ApiError } from "@/server/core/http";
import { getSessionUser, ROLE_PERMISSIONS } from "@/server/security/auth";

export async function GET(req: NextRequest) {
  try {
    const user = getSessionUser(req);
    if (!user) {
      throw new ApiError(401, "UNAUTHORIZED", "Authentication required.");
    }

    const permissions = ROLE_PERMISSIONS[user.role] ?? [];

    return NextResponse.json({
      user_id: user.id,
      email: user.email,
      role: user.role,
      roles: user.roles ?? [user.role],
      permissions,
      warehouse: user.warehouse,
      store_id: user.store_id
    });
  } catch (err) {
    return handleApiError(err);
  }
}
