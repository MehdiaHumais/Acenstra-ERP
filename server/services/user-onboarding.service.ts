import crypto from "node:crypto";
import {
  sendMail,
  buildInvitationEmail,
  smtpConfigured,
  type MailFailure
} from "@/server/services/mail.service";
import { getDb, withTransaction } from "@/server/db/connection";
import type { SqlPrimitive } from "@/server/db/sqlite-driver";
import { ApiError } from "@/server/core/http";
import {
  AuthenticatedUser,
  recordAuditEvent,
  normalizeRole
} from "@/server/security/auth";
import { hashPassword } from "@/server/security/crypto";

const INVITE_TTL_HOURS = 72;
const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "ascentra-erp-dev-hmac-secret-key-2026-ChangeInProd";
const INVITE_HMAC_PURPOSE = "ascentra:user-invite:";

export type InvitationStatus = "pending" | "expired" | "revoked" | "accepted";
export interface InvitationSummary {
  id: string;
  email: string;
  name: string;
  roles: string[];
  warehouse: string | null;
  store_id: string | null;
  status: InvitationStatus;
  invited_by: string | null;
  invited_by_name: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_user_id: string | null;
}

interface InvitationRow {
  id: string;
  email: string;
  name: string;
  roles_json: string;
  warehouse: string | null;
  store_id: string | null;
  scopes_json: string;
  token_hash: string;
  status: string;
  invited_by: string | null;
  invited_by_name: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  created_user_id: string | null;
}

function isSuperAdmin(actor: AuthenticatedUser): boolean {
  return actor.role === "super_admin" || Boolean(actor.permissions?.includes("*"));
}

function assertRoleAssignable(actor: AuthenticatedUser, roleCode: string): void {
  const db = getDb();
  const role = db.prepare("SELECT code, protected, active FROM roles WHERE code = ?").get(roleCode) as
    | { code: string; protected: number; active: number }
    | undefined;
  if (!role) throw new ApiError(400, "ROLE_NOT_FOUND", `Role '${roleCode}' does not exist.`);
  if (!role.active) throw new ApiError(400, "ROLE_INACTIVE", `Role '${roleCode}' is deactivated and cannot be assigned.`);
  if (isSuperAdmin(actor)) return;
  if (roleCode === "super_admin" || role.protected) {
    throw new ApiError(403, "PRIVILEGE_ESCALATION", "Only a Super Admin may assign this role.");
  }
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function tokenHash(token: string): string {
  return crypto.createHmac("sha256", AUTH_SECRET).update(`${INVITE_HMAC_PURPOSE}${token}`).digest("hex");
}

function expiryFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
}

function parseJsonArray(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

function effectiveStatus(row: InvitationRow): InvitationStatus {
  if (row.status === "accepted") return "accepted";
  if (row.status === "revoked") return "revoked";
  if (Date.parse(String(row.expires_at).replace(" ", "T") + "Z") <= Date.now()) return "expired";
  return "pending";
}

function toSummary(row: InvitationRow): InvitationSummary {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    roles: parseJsonArray(row.roles_json),
    warehouse: row.warehouse,
    store_id: row.store_id,
    status: effectiveStatus(row),
    invited_by: row.invited_by,
    invited_by_name: row.invited_by_name,
    created_at: row.created_at,
    expires_at: row.expires_at,
    accepted_at: row.accepted_at,
    revoked_at: row.revoked_at,
    created_user_id: row.created_user_id
  };
}

export interface InvitationInput {
  name: string;
  email: string;
  roles?: string[];
  role?: string;
  warehouse?: string;
  store_id?: string | null;
  scopes?: Partial<Record<"warehouse" | "store" | "customer" | "company" | "supplier" | "delivery" | "task", string[]>>;
  email_subject?: string;
  email_intro?: string;
}

export interface InvitationCreated {
  invitation: InvitationSummary;
  /** Raw link — shown exactly once, never stored server-side. */
  invite_url: string | null;
  email_delivery: "smtp_sent" | "send_failed" | "smtp_not_configured";
  /** Sanitized reason when delivery failed — safe to show to an administrator. */
  email_error?: MailFailure | null;
}

export async function createInvitation(actor: AuthenticatedUser, input: InvitationInput): Promise<InvitationCreated> {
  const name = (input.name || "").trim();
  const email = (input.email || "").trim().toLowerCase();
  if (!name) throw new ApiError(400, "VALIDATION_ERROR", "Full name is required.");
  if (!email || !email.includes("@")) throw new ApiError(400, "VALIDATION_ERROR", "A valid email address is required.");

  const db = getDb();
  const requestedRoles = (input.roles?.length ? input.roles : [input.role || "picker"]).map((r) => normalizeRole(r));
  const roleSet = Array.from(new Set(requestedRoles));
  for (const roleCode of roleSet) assertRoleAssignable(actor, roleCode);
  const primaryRole = roleSet[0];

  const existingUser = db.prepare("SELECT id FROM users WHERE lower(email) = ?").get(email);
  if (existingUser) throw new ApiError(409, "EMAIL_EXISTS", "A user with this email already exists.");

  const row = db
    .prepare("SELECT id FROM user_invitations WHERE lower(email) = ? AND status = 'pending' AND expires_at > datetime('now')")
    .get(email) as { id: string } | undefined;
  if (row) throw new ApiError(409, "INVITATION_PENDING", "A pending invitation for this email already exists. Revoke it first.");

  const id = `INV-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
  const token = generateToken();
  db.prepare(
    `INSERT INTO user_invitations (id, email, name, roles_json, warehouse, store_id, scopes_json, token_hash, status, invited_by, invited_by_name, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
  ).run(
    id,
    email,
    name,
    JSON.stringify(roleSet),
    (input.warehouse || "Milan Cold Hub").trim(),
    input.store_id ?? null,
    JSON.stringify(scopesInput(input.scopes, input.warehouse || "Milan Cold Hub", input.store_id ?? null)),
    tokenHash(token),
    actor.id,
    actor.name ?? actor.email,
    expiryFromNow(INVITE_TTL_HOURS)
  );

  recordAuditEvent({
    actor,
    action: "admin.invitation_created",
    entityType: "Invitation",
    entityId: id,
    after: { email, name, roles: roleSet, warehouse: input.warehouse ?? "Milan Cold Hub", store_id: input.store_id ?? null }
  });

  const inviteUrl = `${publicBaseUrl()}/invite/${token}`;
  const delivery = await deliverInvitationEmail(email, name, inviteUrl, input.email_subject, input.email_intro);
  return {
    invitation: toSummary(db.prepare("SELECT * FROM user_invitations WHERE id = ?").get(id) as unknown as InvitationRow),
    invite_url: inviteUrl,
    email_delivery: delivery.status,
    email_error: delivery.failure ?? null
  };
}

/** Sends the branded invitation email via SMTP. Returns honest delivery status. */
async function deliverInvitationEmail(
  email: string,
  name: string,
  inviteUrl: string,
  subject?: string,
  intro?: string
): Promise<{
  status: "smtp_sent" | "send_failed" | "smtp_not_configured";
  failure?: MailFailure;
}> {
  if (!smtpConfigured()) {
    console.error("[user-onboarding] SMTP not configured — invitation NOT emailed; link is returned to the admin only.");
    return { status: "smtp_not_configured" };
  }
  const message = buildInvitationEmail({ name, email, inviteUrl, subject, intro });
  const result = await sendMail(message);
  return { status: result.sent ? "smtp_sent" : "send_failed", failure: result.failure };
}

function publicBaseUrl(): string {
  return (process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
}

function scopesInput(
  scopes: InvitationInput["scopes"],
  warehouse: string,
  storeId: string | null
): Partial<Record<string, string[]>> {
  const out: Partial<Record<string, string[]>> = {};
  if (scopes) {
    for (const [key, values] of Object.entries(scopes)) {
      const cleaned = Array.from(new Set((values ?? []).map((v) => String(v).trim()).filter(Boolean)));
      if (cleaned.length > 0) out[key] = cleaned;
    }
  }
  if (!out.warehouse && warehouse && warehouse !== "All") out.warehouse = [warehouse];
  if (!out.store && storeId) {
    out.store = [storeId];
    out.customer = [storeId];
  }
  return out;
}

export function listInvitations(
  actor: AuthenticatedUser,
  input?: { search?: string; status?: string; limit?: number; offset?: number }
): { invitations: InvitationSummary[]; total: number } {
  const db = getDb();
  const where: string[] = [];
  const params: SqlPrimitive[] = [];
  if (input?.search) {
    where.push("(lower(email) LIKE ? OR lower(name) LIKE ?)");
    const like = `%${input.search.toLowerCase()}%`;
    params.push(like, like);
  }
  if (input?.status) {
    if (input.status === "expired") {
      where.push("status = 'pending' AND expires_at <= datetime('now')");
    } else if (input.status === "pending") {
      where.push("status = 'pending' AND expires_at > datetime('now')");
    } else {
      where.push("status = ?");
      params.push(input.status);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) as c FROM user_invitations ${whereSql}`).get(...params) as { c: number }).c;
  const limit = Math.min(Math.max(input?.limit ?? 50, 1), 200);
  const offset = Math.max(input?.offset ?? 0, 0);
  const rows = db
    .prepare(`SELECT * FROM user_invitations ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as unknown as InvitationRow[];
  return { invitations: rows.map(toSummary), total };
}

export async function resendInvitation(actor: AuthenticatedUser, id: string): Promise<InvitationCreated> {
  const db = getDb();
  const row = db.prepare("SELECT * FROM user_invitations WHERE id = ?").get(id) as unknown as InvitationRow | undefined;
  if (!row) throw new ApiError(404, "INVITATION_NOT_FOUND", "Invitation not found.");
  if (row.status !== "pending") throw new ApiError(409, "INVITATION_NOT_RESENDABLE", "Only pending invitations can be resent.");
  const token = generateToken();
  db.prepare("UPDATE user_invitations SET token_hash = ?, expires_at = ? WHERE id = ?").run(
    tokenHash(token),
    expiryFromNow(INVITE_TTL_HOURS),
    id
  );
  recordAuditEvent({
    actor,
    action: "admin.invitation_resent",
    entityType: "Invitation",
    entityId: id,
    after: { email: row.email }
  });
  const inviteUrl = `${publicBaseUrl()}/invite/${token}`;
  const delivery = await deliverInvitationEmail(row.email, row.name, inviteUrl);
  return {
    invitation: toSummary(db.prepare("SELECT * FROM user_invitations WHERE id = ?").get(id) as unknown as InvitationRow),
    invite_url: inviteUrl,
    email_delivery: delivery.status,
    email_error: delivery.failure ?? null
  };
}

export function revokeInvitation(actor: AuthenticatedUser, id: string): InvitationSummary {
  const db = getDb();
  const row = db.prepare("SELECT * FROM user_invitations WHERE id = ?").get(id) as unknown as InvitationRow | undefined;
  if (!row) throw new ApiError(404, "INVITATION_NOT_FOUND", "Invitation not found.");
  if (row.status === "revoked") return toSummary(row);
  if (row.status === "accepted") throw new ApiError(409, "INVITATION_ACCEPTED", "An accepted invitation cannot be revoked.");
  db.prepare("UPDATE user_invitations SET status = 'revoked', revoked_at = datetime('now'), revoked_by = ? WHERE id = ?").run(
    actor.email,
    id
  );
  recordAuditEvent({
    actor,
    action: "admin.invitation_revoked",
    entityType: "Invitation",
    entityId: id,
    after: { email: row.email }
  });
  return toSummary(db.prepare("SELECT * FROM user_invitations WHERE id = ?").get(id) as unknown as InvitationRow);
}

/** Edit pending invitation details. Email cannot change; only name, roles, warehouse, store. */
export function updateInvitation(
  actor: AuthenticatedUser,
  id: string,
  input: {
    name?: string;
    roles?: string[];
    warehouse?: string;
    store_id?: string | null;
  }
): InvitationSummary {
  const db = getDb();
  const row = db.prepare("SELECT * FROM user_invitations WHERE id = ?").get(id) as unknown as InvitationRow | undefined;
  if (!row) throw new ApiError(404, "INVITATION_NOT_FOUND", "Invitation not found.");
  if (row.status !== "pending") throw new ApiError(409, "INVITATION_NOT_EDITABLE", "Only pending invitations can be edited.");

  const name = input.name?.trim() || row.name;
  const roleSet = input.roles?.length
    ? Array.from(new Set(input.roles.map((r) => normalizeRole(r))))
    : parseJsonArray(row.roles_json).map((r) => normalizeRole(r));
  for (const code of roleSet) assertRoleAssignable(actor, code);
  const primaryRole = roleSet[0];

  const warehouse = input.warehouse?.trim() || row.warehouse || "Milan Cold Hub";
  const storeId = input.store_id === undefined ? row.store_id : input.store_id;
  const scopes = scopesInput(undefined, warehouse, storeId);

  db.prepare(
    `UPDATE user_invitations
       SET name = ?, roles_json = ?, warehouse = ?, store_id = ?, scopes_json = ?
     WHERE id = ?`
  ).run(
    name,
    JSON.stringify(roleSet),
    warehouse,
    storeId,
    JSON.stringify(scopes),
    id
  );

  recordAuditEvent({
    actor,
    action: "admin.invitation_updated",
    entityType: "Invitation",
    entityId: id,
    after: { email: row.email, name, roles: roleSet, warehouse, store_id: storeId }
  });

  return toSummary(db.prepare("SELECT * FROM user_invitations WHERE id = ?").get(id) as unknown as InvitationRow);
}

/**
 * Hard-delete an invitation, including accepted ones. Deleting the invitation
 * record never touches the account that was created from it — the user keeps
 * working normally. The audit event preserves the invitation history.
 */
export function deleteInvitation(actor: AuthenticatedUser, id: string): { deleted: boolean } {
  const db = getDb();
  const row = db.prepare("SELECT * FROM user_invitations WHERE id = ?").get(id) as unknown as InvitationRow | undefined;
  if (!row) return { deleted: true };
  db.prepare("DELETE FROM user_invitations WHERE id = ?").run(id);
  recordAuditEvent({
    actor,
    action: "admin.invitation_deleted",
    entityType: "Invitation",
    entityId: id,
    before: {
      email: row.email,
      name: row.name,
      status: row.status,
      created_user_id: row.created_user_id ?? null,
      accepted_at: row.accepted_at ?? null
    }
  });
  return { deleted: true };
}

export interface InvitationAcceptResult {
  id: string;
  email: string;
  name: string;
}

export function getInvitationByToken(token: string): InvitationSummary | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM user_invitations WHERE token_hash = ?")
    .get(tokenHash(String(token ?? ""))) as unknown as InvitationRow | undefined;
  if (!row) return null;
  const status = effectiveStatus(row);
  if (status !== "pending") return { ...toSummary(row), status };
  return toSummary(row);
}

export function acceptInvitation(token: string, password: string): InvitationAcceptResult {
  const cleanToken = String(token ?? "").trim();
  if (!cleanToken) throw new ApiError(400, "INVALID_TOKEN", "Invitation token is missing.");
  if (password.length < 8) throw new ApiError(400, "WEAK_PASSWORD", "Password must be at least 8 characters long.");

  const db = getDb();
  const row = db
    .prepare("SELECT * FROM user_invitations WHERE token_hash = ?")
    .get(tokenHash(cleanToken)) as unknown as InvitationRow | undefined;
  if (!row || effectiveStatus(row) !== "pending") {
    recordAuditEvent({
      actor: { id: "anonymous", email: "unknown", name: "Unknown", role: "anonymous" },
      action: "auth.invitation_accept_failed",
      entityType: "Invitation",
      entityId: row?.id ?? "none",
      after: { reason: row ? effectiveStatus(row) : "unknown_token" }
    });
    throw new ApiError(400, "INVALID_TOKEN", "This invitation is invalid, expired or revoked.");
  }

  const roles = parseJsonArray(row.roles_json).map((r) => normalizeRole(r));
  if (roles.length === 0) roles.push("picker");
  const primaryRole = roles[0];
  const existingUser = db.prepare("SELECT id FROM users WHERE lower(email) = ?").get(row.email.toLowerCase());
  if (existingUser) throw new ApiError(409, "EMAIL_EXISTS", "A user with this email already exists.");

  const userId = `USR-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
  const hash = hashPassword(password);
  const scopes = parseScopes(row.scopes_json);

  withTransaction((tx) => {
    tx.prepare(
      `INSERT INTO users (id, email, name, password_hash, role, store_id, warehouse, mfa_enabled, active, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 0)`
    ).run(userId, row.email.toLowerCase(), row.name, hash, primaryRole, row.store_id, row.warehouse || "Milan Cold Hub");
    const insertRole = tx.prepare(
      "INSERT OR IGNORE INTO user_roles (user_id, role_code, assigned_by) VALUES (?, ?, ?)"
    );
    for (const roleCode of roles) insertRole.run(userId, roleCode, row.invited_by ?? "invitation");
    const insertScope = tx.prepare(
      "INSERT OR IGNORE INTO user_scopes (id, user_id, scope_type, scope_value, created_by) VALUES (?, ?, ?, ?, ?)"
    );
    let seq = Date.now();
    for (const [scopeType, values] of Object.entries(scopes)) {
      if (!values) continue;
      for (const value of values) {
        seq += 1;
        insertScope.run(`SCP-${seq}`, userId, scopeType, value, row.invited_by ?? "invitation");
      }
    }
    tx.prepare(
      "UPDATE user_invitations SET status = 'accepted', accepted_at = datetime('now'), created_user_id = ? WHERE id = ?"
    ).run(userId, row.id);
  });

  recordAuditEvent({
    actor: { id: userId, email: row.email.toLowerCase(), name: row.name, role: primaryRole },
    action: "auth.invitation_accepted",
    entityType: "User",
    entityId: userId,
    after: { email: row.email.toLowerCase(), roles, created_by: row.invited_by }
  });

  return { id: userId, email: row.email.toLowerCase(), name: row.name };
}

function parseScopes(value: string | null): Record<string, string[]> {
  try {
    const parsed = JSON.parse(value ?? "{}");
    const out: Record<string, string[]> = {};
    for (const [key, values] of Object.entries(parsed)) {
      if (Array.isArray(values)) {
        const cleaned = Array.from(new Set(values.map((v) => String(v).trim()).filter(Boolean)));
        if (cleaned.length > 0) out[key] = cleaned;
      }
    }
    return out;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Manual account creation with a system-generated temporary password
// ---------------------------------------------------------------------------
export interface ManualCreateInput extends InvitationInput {}
export interface ManualCreateResult {
  id: string;
  email: string;
  name: string;
  temporary_password: string;
  must_change_password: true;
}

export function generateTemporaryPassword(): string {
  const groups = [
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "abcdefghijkmnpqrstuvwxyz",
    "23456789",
    "!@#$%&*+?"
  ];
  const pick = (set: string) => set[crypto.randomInt(0, set.length)];
  let out = groups.map(pick).join("");
  while (out.length < 16) out += pick(groups.join(""));
  return out.split("").sort(() => crypto.randomInt(0, 2) - 0.5).join("");
}

export function createManualUser(actor: AuthenticatedUser, input: ManualCreateInput): ManualCreateResult {
  const name = (input.name || "").trim();
  const email = (input.email || "").trim().toLowerCase();
  if (!name) throw new ApiError(400, "VALIDATION_ERROR", "Full name is required.");
  if (!email || !email.includes("@")) throw new ApiError(400, "VALIDATION_ERROR", "A valid email address is required.");

  const db = getDb();
  const requestedRoles = (input.roles?.length ? input.roles : [input.role || "picker"]).map((r) => normalizeRole(r));
  const roleSet = Array.from(new Set(requestedRoles));
  for (const roleCode of roleSet) assertRoleAssignable(actor, roleCode);
  const primaryRole = roleSet[0];

  const existingUser = db.prepare("SELECT id FROM users WHERE lower(email) = ?").get(email);
  if (existingUser) throw new ApiError(409, "EMAIL_EXISTS", "A user with this email already exists.");

  const id = `USR-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
  const temporaryPassword = generateTemporaryPassword();
  const hash = hashPassword(temporaryPassword);
  const warehouse = (input.warehouse || "Milan Cold Hub").trim();
  const scopes = scopesInput(input.scopes, warehouse, input.store_id ?? null);

  withTransaction((tx) => {
    tx.prepare(
      `INSERT INTO users (id, email, name, password_hash, role, store_id, warehouse, mfa_enabled, active, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 1)`
    ).run(id, email, name, hash, primaryRole, input.store_id ?? null, warehouse);
    const insertRole = tx.prepare(
      "INSERT OR IGNORE INTO user_roles (user_id, role_code, assigned_by) VALUES (?, ?, ?)"
    );
    for (const roleCode of roleSet) insertRole.run(id, roleCode, actor.email);
    const insertScope = tx.prepare(
      "INSERT OR IGNORE INTO user_scopes (id, user_id, scope_type, scope_value, created_by) VALUES (?, ?, ?, ?, ?)"
    );
    let seq = Date.now();
    for (const [scopeType, values] of Object.entries(scopes)) {
      if (!values) continue;
      for (const value of values) {
        seq += 1;
        insertScope.run(`SCP-${seq}`, id, scopeType, value, actor.email);
      }
    }
  });

  recordAuditEvent({
    actor,
    action: "admin.user_created_temporary",
    entityType: "User",
    entityId: id,
    after: { email, name, roles: roleSet, warehouse, store_id: input.store_id ?? null, must_change_password: true }
  });

  return { id, email, name, temporary_password: temporaryPassword, must_change_password: true };
}
