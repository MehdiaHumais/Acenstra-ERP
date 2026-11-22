import { NextRequest, NextResponse } from "next/server";
import { handleApiError, parseJsonBody, ApiError } from "@/server/core/http";
import { completeMfaLogin, ROLE_PERMISSIONS } from "@/server/security/auth";

export async function POST(req: NextRequest) {
  try {
    const body = await parseJsonBody<{
      mfa_token?: string;
      recovery_code?: string;
    }>(req);

    if (!body.mfa_token || !body.recovery_code) {
      throw new ApiError(400, "MISSING_FIELDS", "Both mfa_token and recovery_code are required.");
    }

    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "AscentraClient";

    const { accessToken, refreshToken, user } = completeMfaLogin(
      body.mfa_token,
      body.recovery_code,
      ip,
      userAgent
    );

    const res = NextResponse.json({
      authenticated: true,
      access_token: accessToken,
      refresh_token: refreshToken,
      user,
      permissions: ROLE_PERMISSIONS[user.role] ?? []
    });

    res.cookies.set("ascentra_session", accessToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 15
    });

    if (refreshToken) {
      res.cookies.set("ascentra_refresh", refreshToken, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7
      });
    }

    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
