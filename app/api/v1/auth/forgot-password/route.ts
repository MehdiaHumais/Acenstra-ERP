import { NextRequest, NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/server/core/http";
import { requestPasswordReset } from "@/server/services/password-reset.service";

export const runtime = "nodejs";

/** Public, unauthenticated. Always returns a generic success response. */
export async function POST(req: NextRequest) {
  try {
    const body = await parseJsonBody<{ email?: string }>(req);
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip")?.trim() ||
      "127.0.0.1";
    const result = await requestPasswordReset(body.email ?? "", { ip });
    return NextResponse.json({
      ok: true,
      message: "If an account exists for that email address, a password reset link is on its way.",
    });
  } catch (err) {
    return handleApiError(err);
  }
}
