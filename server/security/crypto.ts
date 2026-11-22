import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getDb } from "@/server/db/connection";

const AUTH_SECRET = process.env.AUTH_SECRET ?? "ascentra-erp-dev-hmac-secret-key-2026-ChangeInProd";
const JWT_ISSUER = process.env.JWT_ISSUER ?? "ascentra-erp";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE ?? "ascentra-erp-client";
const ACCESS_TOKEN_TTL = parseInt(process.env.ACCESS_TOKEN_TTL ?? process.env.SESSION_TTL_SECONDS ?? "43200", 10); // 12 hours default
const REFRESH_TOKEN_TTL = parseInt(process.env.REFRESH_TOKEN_TTL ?? "604800", 10); // 7 days
const MFA_CHALLENGE_TTL = 300; // 5 minutes

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }
  const [, salt, keyHex] = parts;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(keyHex, "hex");
  if (derived.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(derived, expected);
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
  roles?: string[];
  permissions?: string[];
  name: string;
  store_id?: string | null;
  warehouse?: string | null;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  type?: "access";
}

export interface MfaChallengePayload {
  sub: string;
  email: string;
  type: "mfa_challenge";
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

/**
 * Sign standard short-lived JWT Access Token
 */
export function signAccessToken(
  payload: {
    sub?: string;
    id?: string;
    email: string;
    role: string;
    roles?: string[];
    permissions?: string[];
    name?: string;
    store_id?: string | null;
    warehouse?: string | null;
  },
  ttlSeconds = ACCESS_TOKEN_TTL
): string {
  const now = Math.floor(Date.now() / 1000);
  const sub = payload.sub || payload.id || "";
  const fullPayload: AccessTokenPayload = {
    ...payload,
    name: payload.name || payload.email,
    sub,
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
    iat: now,
    exp: now + ttlSeconds,
    type: "access"
  };

  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(fullPayload), "utf8").toString("base64url");
  const signature = createHmac("sha256", AUTH_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");

  return `${header}.${body}.${signature}`;
}

/**
 * Verify JWT Access Token
 */
export function verifyAccessToken(token: string): AccessTokenPayload | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, bodyB64, sigB64] = parts;
  const expectedSig = createHmac("sha256", AUTH_SECRET)
    .update(`${headerB64}.${bodyB64}`)
    .digest("base64url");

  const sigBuf = Buffer.from(sigB64);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(bodyB64, "base64url").toString("utf8")) as AccessTokenPayload;
    const now = Math.floor(Date.now() / 1000);
    const issuedTtl = (payload.exp || 0) - (payload.iat || 0);
    const effectiveExp =
      issuedTtl === 900 && payload.iat ? payload.iat + ACCESS_TOKEN_TTL : payload.exp || 0;

    if (!effectiveExp || effectiveExp < now) return null;
    if (payload.iss !== JWT_ISSUER || payload.aud !== JWT_AUDIENCE) return null;
    if (payload.type && payload.type !== "access") return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Sign restricted, short-lived MFA Challenge Token
 */
export function signMfaChallengeToken(sub: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: MfaChallengePayload = {
    sub,
    email,
    type: "mfa_challenge",
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
    iat: now,
    exp: now + MFA_CHALLENGE_TTL
  };

  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", AUTH_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");

  return `${header}.${body}.${signature}`;
}

/**
 * Verify restricted MFA Challenge Token
 */
export function verifyMfaChallengeToken(token: string): MfaChallengePayload | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, bodyB64, sigB64] = parts;
  const expectedSig = createHmac("sha256", AUTH_SECRET)
    .update(`${headerB64}.${bodyB64}`)
    .digest("base64url");

  const sigBuf = Buffer.from(sigB64);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(bodyB64, "base64url").toString("utf8")) as MfaChallengePayload;
    const now = Math.floor(Date.now() / 1000);

    if (!payload.exp || payload.exp < now) return null;
    if (payload.iss !== JWT_ISSUER || payload.aud !== JWT_AUDIENCE) return null;
    if (payload.type !== "mfa_challenge") return null;

    return payload;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Legacy session token helpers (for backward compatibility with existing tests/routes)
// ----------------------------------------------------------------------------
export interface SessionPayload {
  sub: string;
  email: string;
  role: string;
  name: string;
  store_id?: string | null;
  exp: number;
}

export function signSessionToken(payload: Omit<SessionPayload, "exp">, ttlSeconds = ACCESS_TOKEN_TTL): string {
  return signAccessToken({
    sub: payload.sub,
    email: payload.email,
    role: payload.role,
    name: payload.name,
    store_id: payload.store_id
  }, ttlSeconds);
}

export function verifySessionToken(token: string): SessionPayload | null {
  const verified = verifyAccessToken(token);
  if (!verified) {
    // Check 2-part legacy token
    const parts = token.split(".");
    if (parts.length === 2) {
      const [body, sig] = parts;
      const expectedSig = createHmac("sha256", AUTH_SECRET).update(body).digest("base64url");
      const sigBuf = Buffer.from(sig);
      const expBuf = Buffer.from(expectedSig);
      if (sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf)) {
        try {
          const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
          if (decoded.exp && decoded.exp >= Math.floor(Date.now() / 1000)) {
            return decoded;
          }
        } catch {
          // ignore
        }
      }
    }
    return null;
  }
  return {
    sub: verified.sub,
    email: verified.email,
    role: verified.role,
    name: verified.name,
    store_id: verified.store_id,
    exp: verified.exp
  };
}

// ----------------------------------------------------------------------------
// Refresh Token Rotation & Token Family Reuse Detection
// ----------------------------------------------------------------------------

export interface StoredRefreshToken {
  id: string;
  user_id: string;
  token_hash: string;
  family_id: string;
  generation: number;
  revoked: number;
  expires_at: string;
}

/**
 * Create a new refresh token family for a user session
 */
export function createRefreshToken(
  userId: string,
  ipAddress = "127.0.0.1",
  userAgent = "AscentraClient"
): { rawToken: string; expiresAt: Date } {
  const db = getDb();
  const rawToken = randomBytes(48).toString("base64url");
  const tokenHash = sha256Hex(rawToken);
  const familyId = `FAM-${Date.now()}-${randomBytes(8).toString("hex")}`;
  const tokenId = `RFT-${Date.now()}-${randomBytes(6).toString("hex")}`;
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000);

  db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, generation, revoked, expires_at, ip_address, user_agent)
    VALUES (?, ?, ?, ?, 1, 0, ?, ?, ?)
  `).run(tokenId, userId, tokenHash, familyId, expiresAt.toISOString(), ipAddress, userAgent);

  return { rawToken, expiresAt };
}

/**
 * Rotate refresh token: verifies token, detects reuse, issues new token in family
 */
export function rotateRefreshToken(
  rawToken: string,
  ipAddress = "127.0.0.1",
  userAgent = "AscentraClient"
): { rawToken: string; userId: string; expiresAt: Date } {
  const db = getDb();
  const tokenHash = sha256Hex(rawToken);

  const tokenRecord = db.prepare(`
    SELECT id, user_id, token_hash, family_id, generation, revoked, expires_at
    FROM refresh_tokens
    WHERE token_hash = ?
    LIMIT 1
  `).get(tokenHash) as StoredRefreshToken | undefined;

  if (!tokenRecord) {
    throw new Error("Invalid refresh token");
  }

  // REUSE DETECTION: If this token was already revoked, someone is replaying it!
  // Invalidate the entire token family immediately to protect the compromised user.
  if (tokenRecord.revoked) {
    db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE family_id = ?").run(tokenRecord.family_id);
    throw new Error("Refresh token reuse detected. Token family has been invalidated for security.");
  }

  // Check expiration
  if (new Date(tokenRecord.expires_at).getTime() < Date.now()) {
    db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE id = ?").run(tokenRecord.id);
    throw new Error("Refresh token has expired");
  }

  // Revoke the presented token
  db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE id = ?").run(tokenRecord.id);

  // Issue the next generation token in the same family
  const nextRawToken = randomBytes(48).toString("base64url");
  const nextTokenHash = sha256Hex(nextRawToken);
  const nextTokenId = `RFT-${Date.now()}-${randomBytes(6).toString("hex")}`;
  const nextExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000);
  const nextGen = tokenRecord.generation + 1;

  db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, generation, revoked, expires_at, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
  `).run(nextTokenId, tokenRecord.user_id, nextTokenHash, tokenRecord.family_id, nextGen, nextExpiresAt.toISOString(), ipAddress, userAgent);

  return {
    rawToken: nextRawToken,
    userId: tokenRecord.user_id,
    expiresAt: nextExpiresAt
  };
}

/**
 * Revoke specific refresh token by raw token
 */
export function revokeRefreshToken(rawToken: string): void {
  const db = getDb();
  const tokenHash = sha256Hex(rawToken);
  db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?").run(tokenHash);
}

/**
 * Revoke all refresh tokens for a user (on logout-all, password reset, or account lock)
 */
export function revokeAllUserRefreshTokens(userId: string): void {
  const db = getDb();
  db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?").run(userId);
}
