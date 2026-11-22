import { NextRequest, NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/server/core/http";
import { authenticateUser, ROLE_PERMISSIONS } from "@/server/security/auth";

export async function POST(req: NextRequest) {
  try {
    const body = await parseJsonBody<{
      email?: string;
      password?: string;
    }>(req);

    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "AscentraClient";

    const result = authenticateUser(
      body.email || "",
      body.password || "",
      ip,
      userAgent
    );

    if (result.mfaRequired) {
      return NextResponse.json({
        mfa_required: true,
        mfa_token: result.mfaToken,
        user: result.user
      });
    }

    const res = NextResponse.json({
      authenticated: true,
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      user: result.user,
      must_change_password: Boolean((result.user as { must_change_password?: boolean }).must_change_password),
      permissions: ROLE_PERMISSIONS[result.user.role] ?? []
    });

    if (result.accessToken) {
      res.cookies.set("ascentra_session", result.accessToken, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 12
      });
    }

    if (result.refreshToken) {
      res.cookies.set("ascentra_refresh", result.refreshToken, {
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
