import { NextRequest, NextResponse } from "next/server";
import { handleApiError, parseJsonBody, ApiError } from "@/server/core/http";
import { rotateRefreshToken, signAccessToken } from "@/server/security/crypto";
import { getDb } from "@/server/db/connection";
import { normalizeRole, ROLE_PERMISSIONS, AuthenticatedUser } from "@/server/security/auth";

export async function POST(req: NextRequest) {
  try {
    let rawToken = req.cookies.get("ascentra_refresh")?.value;
    if (!rawToken) {
      const body = await parseJsonBody<{ refresh_token?: string }>(req).catch(() => null);
      rawToken = body?.refresh_token;
    }

    if (!rawToken) {
      throw new ApiError(401, "REFRESH_TOKEN_REQUIRED", "No refresh token provided.");
    }

    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "AscentraClient";

    const { rawToken: nextRefreshToken, userId } = rotateRefreshToken(rawToken, ip, userAgent);

    const db = getDb();
    const userRow = db
      .prepare("SELECT id, email, name, role, store_id, warehouse, active FROM users WHERE id = ?")
      .get(userId) as
      | {
          id: string;
          email: string;
          name: string;
          role: string;
          store_id: string | null;
          warehouse: string | null;
          active: number;
        }
      | undefined;

    if (!userRow || !userRow.active) {
      throw new ApiError(403, "ACCOUNT_INACTIVE", "Account is no longer active.");
    }

    const normalizedRole = normalizeRole(userRow.role);
    const user: AuthenticatedUser = {
      id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      role: normalizedRole,
      roles: [normalizedRole],
      store_id: userRow.store_id,
      warehouse: userRow.warehouse
    };

    const nextAccessToken = signAccessToken({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      roles: user.roles,
      store_id: user.store_id,
      warehouse: user.warehouse
    });

    const res = NextResponse.json({
      access_token: nextAccessToken,
      refresh_token: nextRefreshToken,
      user,
      permissions: ROLE_PERMISSIONS[user.role] ?? []
    });

    res.cookies.set("ascentra_session", nextAccessToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 15
    });

    res.cookies.set("ascentra_refresh", nextRefreshToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7
    });

    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
