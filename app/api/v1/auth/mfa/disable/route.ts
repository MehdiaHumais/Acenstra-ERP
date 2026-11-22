import { NextRequest, NextResponse } from "next/server";
import { handleApiError, parseJsonBody, ApiError } from "@/server/core/http";
import { disableMfa, getSessionUser } from "@/server/security/auth";

export async function POST(req: NextRequest) {
  try {
    const user = getSessionUser(req);
    if (!user) {
      throw new ApiError(401, "UNAUTHORIZED", "Please log in to manage MFA settings.");
    }

    const body = await parseJsonBody<{ password?: string; code?: string }>(req);
    const secretInput = body.password || body.code;
    if (!secretInput) {
      throw new ApiError(400, "CONFIRMATION_REQUIRED", "Password or current TOTP code is required to disable MFA.");
    }

    disableMfa(user, secretInput);

    return NextResponse.json({
      success: true,
      message: "Two-factor authentication has been disabled."
    });
  } catch (err) {
    return handleApiError(err);
  }
}
