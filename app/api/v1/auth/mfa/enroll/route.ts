import { NextRequest, NextResponse } from "next/server";
import { handleApiError, ApiError } from "@/server/core/http";
import { enrollMfa, getSessionUser } from "@/server/security/auth";

export async function POST(req: NextRequest) {
  try {
    const user = getSessionUser(req);
    if (!user) {
      throw new ApiError(401, "UNAUTHORIZED", "Please log in to configure MFA.");
    }

    const { secret, uri, backupCodes } = enrollMfa(user);

    return NextResponse.json({
      secret,
      uri,
      backup_codes: backupCodes,
      message: "Scan the QR code or enter the secret into your authenticator app, then verify with a 6-digit code."
    });
  } catch (err) {
    return handleApiError(err);
  }
}
