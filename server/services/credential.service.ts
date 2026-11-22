import crypto from "node:crypto";
import QRCode from "qrcode";
import { getDb } from "@/server/db/connection";
import { ApiError } from "@/server/core/http";
import {
  AuthenticatedUser,
  authenticateUser,
  normalizeRole,
  recordAuditEvent
} from "@/server/security/auth";

const SERVER_SECRET =
  process.env.AUTH_SECRET ?? "ascentra-erp-dev-hmac-secret-key-2026-ChangeInProd";

// ---------------------------------------------------------------------------
// Credential hashing
// ---------------------------------------------------------------------------
function hashCredential(secret: string): string {
  return crypto.createHmac("sha256", SERVER_SECRET).update(`ascentra:credential:${secret}`).digest("hex");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type CredentialStatus = "active" | "inactive" | "revoked" | "expired";

export interface CredentialSummary {
  id: string;
  user_id: string;
  type: string;
  label: string;
  status: CredentialStatus;
  secret_hint: string;
  created_at: string;
  created_by: string | null;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface CredentialIssueResult {
  credential: CredentialSummary;
  /** Shown exactly once, never persisted, never logged. */
  secret: string;
  /** Data URI (or raw SVG) with the QR encoding pointing to the secret. */
  qr_data_uri: string;
  qr_svg: string;
}

interface CredentialRow {
  id: string;
  user_id: string;
  type: string;
  credential_hash: string;
  secret_hint: string;
  label: string;
  status: string;
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

function toSummary(row: CredentialRow): CredentialSummary {
  return {
    id: row.id,
    user_id: row.user_id,
    type: row.type,
    label: row.label,
    status: (row.status as CredentialStatus) ?? "active",
    secret_hint: row.secret_hint,
    created_at: row.created_at,
    created_by: row.created_by ?? null,
    last_used_at: row.last_used_at ?? null,
    expires_at: row.expires_at ?? null,
    revoked_at: row.revoked_at ?? null
  };
}

function userExists(db: ReturnType<typeof getDb>, userId: string) {
  const row = db
    .prepare("SELECT id, email, name, role, active FROM users WHERE id = ?")
    .get(userId) as
    | { id: string; email: string; name: string; role: string; active: number }
    | undefined;
  if (!row) {
    throw new ApiError(404, "USER_NOT_FOUND", `User '${userId}' not found.`);
  }
  return row;
}

// ---------------------------------------------------------------------------
// Administration helpers (require users.manage at the route layer)
// ---------------------------------------------------------------------------
export function listUserCredentials(
  actor: AuthenticatedUser,
  userId: string
): CredentialSummary[] {
  const db = getDb();
  userExists(db, userId);
  const rows = db
    .prepare(
      `SELECT * FROM user_credentials WHERE user_id = ?
       ORDER BY datetime(created_at) DESC, rowid DESC`
    )
    .all(userId) as unknown as CredentialRow[];
  return rows.map(toSummary);
}

/**
 * Issue (or re-issue) a personal access credential for a user.
 * Any previously active credentials for the user are revoked first — exactly
 * one active credential exists at any time.
 *
 * The plain secret is returned to the caller exactly once (so the QR can be
 * rendered) and is never persisted or logged.
 */
export async function issueUserCredential(
  actor: AuthenticatedUser,
  userId: string,
  label = "Personal Access Card"
): Promise<CredentialIssueResult> {
  const db = getDb();
  const target = userExists(db, userId);
  const previous = db
    .prepare("SELECT * FROM user_credentials WHERE user_id = ? AND status = 'active'")
    .all(userId) as unknown as CredentialRow[];

  const id = crypto.randomUUID();
  const secret = `ASC1-${crypto.randomBytes(24).toString("base64url")}`;
  const nowIso = new Date().toISOString();

  withTransactionSqlite(db, () => {
    for (const p of previous) {
      db.prepare(
        `UPDATE user_credentials SET status = 'revoked', revoked_at = ?, revoked_by = ?
         WHERE id = ?`
      ).run(nowIso, actor.email, p.id);
    }

    db.prepare(
      `INSERT INTO user_credentials
         (id, user_id, type, credential_hash, secret_hint, label, status, created_by, created_at)
       VALUES (?, ?, 'qr', ?, ?, ?, 'active', ?, ?)`
    ).run(
      id,
      userId,
      hashCredential(secret),
      secret.slice(-6),
      label,
      actor.email,
      nowIso
    );
  });

  recordAuditEvent({
    actor,
    action: previous.length > 0 ? "credential.regenerate" : "credential.generated",
    entityType: "UserCredential",
    entityId: id,
    after: { user_id: userId, label, revoked_previous: previous.length },
    ipAddress: undefined
  });

  const payload = secret;
  const svg = (await QRCode.toString(payload, {
    type: "svg",
    margin: 1,
    width: 240,
    color: { dark: "#061222", light: "#ffffff" }
  })) as unknown as string;
  const dataUri = (await QRCode.toDataURL(payload, {
    margin: 1,
    width: 240,
    color: { dark: "#061222", light: "#ffffff" }
  })) as unknown as string;

  return {
    credential: {
      id,
      user_id: userId,
      type: "qr",
      label,
      status: "active",
      secret_hint: secret.slice(-6),
      created_at: nowIso,
      created_by: actor.email,
      last_used_at: null,
      expires_at: null,
      revoked_at: null
    },
    secret,
    qr_data_uri: dataUri,
    qr_svg: svg
  };
}

export function revokeUserCredential(
  actor: AuthenticatedUser,
  userId: string,
  credentialId?: string
): { revoked: number } {
  const db = getDb();
  userExists(db, userId);
  const nowIso = new Date().toISOString();
  const result = credentialId
    ? db
        .prepare(
          `UPDATE user_credentials SET status = 'revoked', revoked_at = ?, revoked_by = ?
           WHERE id = ? AND user_id = ?`
        )
        .run(nowIso, actor.email, credentialId, userId)
    : db
        .prepare(
          `UPDATE user_credentials SET status = 'revoked', revoked_at = ?, revoked_by = ?
           WHERE user_id = ? AND status IN ('active', 'inactive')`
        )
        .run(nowIso, actor.email, userId);

  recordAuditEvent({
    actor,
    action: "credential.revoked",
    entityType: "UserCredential",
    entityId: credentialId ?? userId,
    after: { user_id: userId, count: result.changes }
  });

  return { revoked: Number(result.changes ?? 0) };
}

export function setUserCredentialStatus(
  actor: AuthenticatedUser,
  userId: string,
  credentialId: string,
  status: "active" | "inactive"
): CredentialSummary {
  const db = getDb();
  userExists(db, userId);
  if (status === "active") {
    const row = db
      .prepare("SELECT * FROM user_credentials WHERE id = ? AND user_id = ?")
      .get(credentialId, userId) as unknown as CredentialRow | undefined;
    if (!row) throw new ApiError(404, "CREDENTIAL_NOT_FOUND", "Credential not found.");
    if (row.status === "expired") {
      throw new ApiError(409, "CREDENTIAL_EXPIRED", "An expired credential cannot be reactivated.");
    }
    if (row.status === "revoked") {
      throw new ApiError(409, "CREDENTIAL_REVOKED", "A revoked credential cannot be reactivated.");
    }
  }

  db.prepare(
    `UPDATE user_credentials SET status = ?, revoked_at = NULL, revoked_by = NULL
     WHERE id = ? AND user_id = ?`
  ).run(status, credentialId, userId);

  const row = db
    .prepare("SELECT * FROM user_credentials WHERE id = ? AND user_id = ?")
    .get(credentialId, userId) as unknown as CredentialRow;

  recordAuditEvent({
    actor,
    action: status === "active" ? "credential.activated" : "credential.deactivated",
    entityType: "UserCredential",
    entityId: credentialId,
    after: { user_id: userId, status }
  });

  return toSummary(row);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function withTransactionSqlite(db: ReturnType<typeof getDb>, fn: () => void) {
  db.exec("BEGIN IMMEDIATE");
  try {
    fn();
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function lookupActiveCredential(secret: string):
  | (CredentialRow & { email: string; name: string; role: string; active: number })
  | undefined {
  if (!secret || typeof secret !== "string" || secret.length < 16) return undefined;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT c.*, u.active, u.email, u.name, u.role
       FROM user_credentials c
       JOIN users u ON u.id = c.user_id
       WHERE c.credential_hash = ?`
    )
    .get(hashCredential(secret)) as
    | (CredentialRow & { email: string; name: string; role: string; active: number })
    | undefined;
  if (!row) return undefined;
  // Expiry enforcement
  if (row.status === "active" && row.expires_at && Date.parse(String(row.expires_at).replace(" ", "T") + "Z") <= Date.now()) {
    db.prepare(
      `UPDATE user_credentials SET status = 'expired' WHERE id = ?`
    ).run(row.id);
    row.status = "expired";
  }
  return row;
}

export function identifyBarcodeCredential(
  secret: string,
  ipAddress = "127.0.0.1",
  userAgent = "AscentraScanner"
) {
  const row = lookupActiveCredential(secret);
  if (!row) {
    recordAuditEvent({
      actor: { id: "anon", email: "anon@unidentified", name: "Unknown", role: "anonymous" },
      action: "credential.identify_failed",
      entityType: "UserCredential",
      entityId: "unknown",
      ipAddress
    });
    throw new ApiError(401, "CREDENTIAL_INVALID", "Barcode not recognized or clock mismatch.");
  }

  if (!row.active) {
    recordAuditEvent({
      actor: { id: row.user_id, email: row.email, name: row.name, role: normalizeRole(row.role) },
      action: "credential.account_disabled",
      entityType: "UserCredential",
      entityId: row.id,
      ipAddress
    });
    throw new ApiError(403, "ACCOUNT_DISABLED", "Your account is disabled. Please contact your administrator.");
  }

  if (row.status !== "active") {
    recordAuditEvent({
      actor: { id: row.user_id, email: row.email, name: row.name, role: normalizeRole(row.role) },
      action: "credential.identify_denied",
      entityType: "UserCredential",
      entityId: row.id,
      after: { status: row.status },
      ipAddress
    });
    const message =
      row.status === "revoked"
        ? "This credential has been revoked. Please contact your administrator."
        : row.status === "expired"
          ? "This credential has expired. Please generate a new one."
          : "This credential is temporarily deactivated. Please contact your administrator.";
    throw new ApiError(403, `CREDENTIAL_${row.status.toUpperCase()}`, message);
  }

  // Success — update last_used_at (not in audit payload, never logged)
  const db = getDb();
  db.prepare("UPDATE user_credentials SET last_used_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    row.id
  );

  recordAuditEvent({
    actor: { id: row.user_id, email: row.email, name: row.name, role: normalizeRole(row.role) },
    action: "credential.identified",
    entityType: "UserCredential",
    entityId: row.id,
    ipAddress
  });

  return {
    user_id: row.user_id,
    email: row.email,
    name: row.name,
    role: normalizeRole(row.role)
  };
}

/**
 * Identify + authenticate with a password. Reuses the standard
 * authenticateUser flow (lockout, attempts, MFA, active checks).
 */
export function authenticateWithBarcode(
  secret: string,
  password: string,
  ipAddress = "127.0.0.1",
  userAgent = "AscentraScanner"
) {
  const identified = identifyBarcodeCredential(secret, ipAddress, userAgent);
  return authenticateUser(identified.email, password, ipAddress, userAgent);
}
