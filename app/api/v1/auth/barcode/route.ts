import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit, handleApiError, parseJsonBody } from "@/server/core/http";
import {
  identifyBarcodeCredential,
  authenticateWithBarcode
} from "@/server/services/credential.service";

/**
 * PUBLIC endpoint. Two actions:
 *   identify — step 1: scan credential, returns the user's public identity
 *   login    — step 2: scan credential + password, mints the normal session
 *
 * Both actions are rate limited to thwart automated scanning attacks, and the
 * credential is never logged anywhere.
 */
export async function POST(req: NextRequest) {
  try {
    enforceRateLimit(req, 10, 5 * 60_000);

    const body = await parseJsonBody<{
      action?: "identify" | "login";
      credential?: string;
      password?: string;
    }>(req);

    const action = body.action ?? "identify";
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "AscentraScanner";

    if (action !== "identify" && action !== "login") {
      return NextResponse.json(
        { error: { code: "INVALID_ACTION", message: "action must be identify or login." } },
        { status: 400 }
      );
    }

    const identified = identifyBarcodeCredential((body.credential || "").trim(), ip, userAgent);

    if (action === "identify") {
      return NextResponse.json({
        ok: true,
        identified: true,
        user: {
          id: identified.user_id,
          name: identified.name,
          role: identified.role
        },
        needs_password: true
      });
    }

    const result = authenticateWithBarcode((body.credential || "").trim(), body.password || "", ip, userAgent);

    if (result.mfaRequired) {
      return NextResponse.json({
        ok: false,
        mfa_required: true,
        mfa_token: result.mfaToken,
        user: {
          id: identified.user_id,
          name: identified.name,
          role: identified.role
        }
      });
    }

    const res = NextResponse.json({
      ok: true,
      authenticated: true,
      token: result.accessToken,
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      user: result.user,
      permissions: result.user.permissions ?? []
    });

    if (result.accessToken) {
      res.cookies.set("ascentra_session", result.accessToken, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 12 // 12 hours
      });
    }

    if (result.refreshToken) {
      res.cookies.set("ascentra_refresh", result.refreshToken, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7 // 7 days
      });
    }

    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
