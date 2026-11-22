import { NextRequest, NextResponse } from "next/server";
import { handleApiError, parseJsonBody, ApiError } from "@/server/core/http";
import { getSessionUser, verifyMfaEnrollment } from "@/server/security/auth";

export async function POST(req: NextRequest) {
  try {
    const user = getSessionUser(req);
    if (!user) {
      throw new ApiError(401, "UNAUTHORIZED", "Please log in to verify MFA enrollment.");
    }

    const body = await parseJsonBody<{ code?: string }>(req);
    if (!body.code) {
      throw new ApiError(400, "CODE_REQUIRED", "6-digit TOTP authentication code is required.");
    }

    verifyMfaEnrollment(user, body.code);

    return NextResponse.json({
      success: true,
      message: "Two-factor authentication has been successfully activated on your account."
    });
  } catch (err) {
    return handleApiError(err);
  }
}
