/**
 * Self-service password reset — expiring, single-purpose tokens emailed to
 * the account owner. Reuses the same HMAC-token pattern as invitations.
 * The public endpoint never reveals whether an email address has an account.
 */
import crypto from "node:crypto";
import { getDb, withTransaction } from "@/server/db/connection";
import { ApiError } from "@/server/core/http";
import { hashPassword, revokeAllUserRefreshTokens } from "@/server/security/crypto";
import { sendMail, smtpConfigured } from "@/server/services/mail.service";
import { recordAuditEvent } from "@/server/security/auth";

const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "ascentra-erp-dev-hmac-secret-key-2026-ChangeInProd";
const HMAC_PURPOSE = "ascentra:password-reset:";
const TTL_MINUTES = 60;
const RATE_WINDOW_SQL = "datetime('now', '-1 hour')";
const RATE_LIMIT = 3;

function tokenHash(token: string): string {
  return crypto.createHmac("sha256", AUTH_SECRET).update(`${HMAC_PURPOSE}${token}`).digest("hex");
}

function expiryFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
}

export async function requestPasswordReset(
  email: string,
  meta: { ip?: string } = {}
): Promise<{ ok: true }> {
  const normalized = (email ?? "").trim().toLowerCase();
  // Always succeed outwardly — never leak whether the account exists.
  if (!normalized || !normalized.includes("@")) return { ok: true };

  const db = getDb();
  const ip = (meta.ip ?? "").trim() || null;
  // Rate limit: at most 3 reset tokens per hour per email address.
  const recentEmail = db
    .prepare(
      `SELECT COUNT(*) as c FROM password_reset_tokens prt JOIN users u ON u.id = prt.user_id
       WHERE lower(u.email) = ? AND prt.created_at >= ${RATE_WINDOW_SQL}`
    )
    .get(normalized) as { c: number };
  if ((recentEmail?.c ?? 0) >= RATE_LIMIT) {
    return { ok: true };
  }

  const target = db
    .prepare("SELECT id, email, name, active FROM users WHERE lower(email) = ?")
    .get(normalized) as { id: string; email: string; name: string; active: number } | undefined;
  if (!target || !target.active) return { ok: true };

  const rawToken = crypto.randomBytes(32).toString("base64url");
  const hash = tokenHash(rawToken);
  const expires = expiryFromNow(TTL_MINUTES);
  withTransaction((tx) => {
    tx.prepare(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, status, expires_at)
       VALUES (?, ?, ?, 'pending', ?)`
    ).run(`PRT-${Date.now().toString().slice(-6)}${crypto.randomInt(10, 99)}`, target.id, hash, expires);
  });

  recordAuditEvent({
    actor: { id: target.id, email: target.email, name: target.name, role: "self_service", roles: ["self_service"] } as any,
    action: "auth.password_reset_requested",
    entityType: "User",
    entityId: target.id,
    after: { email: target.email },
    ipAddress: ip ?? undefined,
  });

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
  const url = `${baseUrl}/reset-password?token=${rawToken}`;
  if (smtpConfigured()) {
    await sendMail({
      to: target.email,
      subject: "Reset your Ascentra ERP password",
      text: [
        `Hi ${target.name},`,
        ``,
        `We received a request to reset the password for your Ascentra ERP account (${target.email}).`,
        `Open this link within ${TTL_MINUTES} minutes to choose a new password:`,
        ``,
        url,
        ``,
        `If you did not request this, you can ignore this email — your password remains unchanged.`,
        ``,
        `Ascentra Global Ltd`,
      ].join("\n"),
    });
  } else {
    console.warn(`[password-reset] SMTP not configured — reset link for ${target.email}: ${url}`);
  }
  return { ok: true };
}

export function resetPasswordWithToken(
  token: string,
  newPassword: string
): { updated: boolean } {
  if (!newPassword || newPassword.length < 8) {
    throw new ApiError(400, "WEAK_PASSWORD", "Password must be at least 8 characters long.");
  }
  const hash = tokenHash((token ?? "").trim());
  const db = getDb();
  const row = db
    .prepare(
      `SELECT prt.id, prt.user_id, prt.expires_at, prt.status, u.email, u.name
       FROM password_reset_tokens prt JOIN users u ON u.id = prt.user_id
       WHERE prt.token_hash = ?`
    )
    .get(hash) as
    | { id: string; user_id: string; expires_at: string; status: string; email: string; name: string }
    | undefined;
  if (!row || row.status !== "pending" || Date.parse(String(row.expires_at).replace(" ", "T") + "Z") <= Date.now()) {
    throw new ApiError(400, "INVALID_TOKEN", "This reset link is invalid or has expired. Please request a new one.");
  }

  withTransaction((tx) => {
    tx.prepare("UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?").run(
      hashPassword(newPassword),
      row.user_id
    );
    tx.prepare("UPDATE password_reset_tokens SET status = 'used', used_at = datetime('now') WHERE id = ?").run(row.id);
    tx.prepare("UPDATE password_reset_tokens SET status = 'expired' WHERE user_id = ? AND status = 'pending' AND id <> ?").run(row.user_id, row.id);
  });
  revokeAllUserRefreshTokens(row.user_id);

  recordAuditEvent({
    actor: { id: row.user_id, email: row.email, name: row.name, role: "self_service", roles: ["self_service"] } as any,
    action: "auth.password_reset",
    entityType: "User",
    entityId: row.user_id,
    after: { email: row.email },
  });
  return { updated: true };
}
