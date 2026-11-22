import { NextRequest, NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/server/core/http";
import {
  acceptInvitation,
  getInvitationByToken
} from "@/server/services/user-onboarding.service";

// Best-effort per-IP throttle — the token has 256 bits of entropy, but the
// endpoint is still public and unauthenticated.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 30;
const attempts = new Map<string, { count: number; resetAt: number }>();

function throttled(ip: string): boolean {
  const now = Date.now();
  const bucket = attempts.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_ATTEMPTS;
}

export async function GET(req: NextRequest) {
  try {
    const token = new URL(req.url).searchParams.get("token") ?? "";
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    if (throttled(ip)) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many attempts. Try again later." } },
        { status: 429 }
      );
    }
    const invitation = getInvitationByToken(token);
    if (!invitation || invitation.status !== "pending") {
      return NextResponse.json(
        { error: { code: "INVALID_TOKEN", message: "This invitation is invalid, expired or revoked." } },
        { status: 404 }
      );
    }
    return NextResponse.json({
      name: invitation.name,
      email: invitation.email,
      roles: invitation.roles,
      status: invitation.status
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    if (throttled(ip)) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many attempts. Try again later." } },
        { status: 429 }
      );
    }
    const body = await parseJsonBody<{ token?: string; password?: string }>(req);
    const result = acceptInvitation(String(body?.token ?? ""), String(body?.password ?? ""));
    return NextResponse.json({ accepted: true, user: result }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
