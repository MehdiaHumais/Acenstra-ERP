import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/server/db/connection";
import { sha256Hex } from "@/server/security/crypto";
import { assertPermission, AuthenticatedUser, hasPermission, Permission, requireAuthenticatedUser } from "@/server/security/auth";

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return this.statusCode;
  }
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function enforceRateLimit(req: NextRequest | Request, maxRequests = 120, windowMs = 60_000): void {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "127.0.0.1";
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > maxRequests) {
    throw new ApiError(429, "RATE_LIMIT_EXCEEDED", "Too many API requests. Please retry after a short delay.");
  }
}

export function applySecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

export function authorizeRequest(req: NextRequest | Request, permission?: Permission): AuthenticatedUser {
  enforceRateLimit(req);
  const user = requireAuthenticatedUser(req);
  if (permission) {
    assertPermission(user, permission);
  }
  return user;
}

/**
 * Like authorizeRequest, but any one of the given permissions satisfies the
 * requirement. Used for endpoints whose policy is "one of several acceptable
 * roles may perform this action" — mirrors the any-of checks the service
 * layer performs. `roles` optionally whitelists roles bypassing the
 * permission check (used where the service layer also grants role bypass).
 */
export function authorizeRequestAnyOf(
  req: NextRequest | Request,
  permissions: Permission[],
  roles: string[] = []
): AuthenticatedUser {
  enforceRateLimit(req);
  const user = requireAuthenticatedUser(req);
  const granted =
    permissions.some((permission) => hasPermission(user, permission)) || roles.includes(user.role);
  if (!granted) {
    throw new ApiError(
      403,
      "FORBIDDEN_INSUFFICIENT_ROLE",
      `Role '${user.role}' is not authorized for this action.`
    );
  }
  return user;
}

export async function withIdempotency<T>(
  req: NextRequest | Request,
  endpoint: string,
  payload: unknown,
  handler: () => Promise<{ status?: number; body: T }> | { status?: number; body: T }
): Promise<NextResponse> {
  const idempotencyKey =
    req.headers.get("idempotency-key")?.trim() || req.headers.get("x-idempotency-key")?.trim();

  if (!idempotencyKey) {
    const result = await handler();
    return NextResponse.json(result.body, { status: result.status ?? 200 });
  }

  const db = getDb();
  const payloadHash = sha256Hex(JSON.stringify(payload ?? {}));
  const compositeKey = `${endpoint}:${idempotencyKey}`;

  const existing = db
    .prepare("SELECT payload_hash, status_code, response_json FROM idempotency_records WHERE key = ?")
    .get(compositeKey) as
    | { payload_hash: string; status_code: number; response_json: string }
    | undefined;

  if (existing) {
    if (existing.payload_hash !== payloadHash) {
      throw new ApiError(
        409,
        "IDEMPOTENCY_KEY_CONFLICT",
        "Idempotency-Key was already used with a different request payload."
      );
    }
    return NextResponse.json(JSON.parse(existing.response_json), {
      status: existing.status_code,
      headers: { "X-Idempotent-Replay": "true" }
    });
  }

  const result = await handler();
  const statusCode = result.status ?? 200;
  db.prepare(
    "INSERT INTO idempotency_records (key, endpoint, payload_hash, status_code, response_json) VALUES (?, ?, ?, ?, ?)"
  ).run(compositeKey, endpoint, payloadHash, statusCode, JSON.stringify(result.body));

  return NextResponse.json(result.body, {
    status: statusCode,
    headers: { "X-Idempotent-Replay": "false" }
  });
}

export function handleApiError(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    const res = NextResponse.json(
      {
        error: {
          code: err.code,
          message: err.message,
          details: err.details ?? null
        }
      },
      { status: err.statusCode }
    );
    return applySecurityHeaders(res);
  }
  const message = process.env.NODE_ENV === "production"
    ? "An internal server error occurred."
    : err instanceof Error ? err.message : "Unexpected server error";
  const res = NextResponse.json(
    {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message
      }
    },
    { status: 500 }
  );
  return applySecurityHeaders(res);
}

export async function parseJsonBody<T>(req: NextRequest | Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}
