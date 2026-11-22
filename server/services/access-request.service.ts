/**
 * Public access requests — visitors ask for ERP access; an authorized admin
 * reviews and approves or rejects them.
 *
 * Design notes:
 *  - Submitting a request never creates or activates an account.
 *  - The applicant's requested role is a *preference*; the admin chooses the
 *    actual ERP role at approval time (never super_admin — public requests
 *    can never grant super_admin, even to a super_admin actor by mistake).
 *  - Approval reuses the existing invitation flow (email + expiring token),
 *    so the applicant sets their own password and is forced to change it.
 *  - Every decision is audited; duplicate pending requests are rejected.
 *  - Notifications go to the applicant + the admin mailbox. If SMTP is not
 *    configured, the state transitions still happen and are logged.
 */
import crypto from "node:crypto";
import { getDb, withTransaction } from "@/server/db/connection";
import type { SqlPrimitive } from "@/server/db/sqlite-driver";
import { ApiError } from "@/server/core/http";
import {
  sendMail,
  smtpConfigured,
  buildAccessApprovedEmail,
} from "@/server/services/mail.service";
import { createManualUser } from "@/server/services/user-onboarding.service";
import { notifyUsersWithPermission } from "@/server/services/notification.service";
import {
  normalizeRole,
  recordAuditEvent,
  type AuthenticatedUser,
} from "@/server/security/auth";

export type AccessRequestStatus = "pending" | "additional_info" | "approved" | "rejected";
export const ACCESS_REQUEST_STATUSES: AccessRequestStatus[] = [
  "pending",
  "additional_info",
  "approved",
  "rejected",
];

export interface AccessRequestSummary {
  id: string;
  name: string;
  email: string;
  company: string;
  phone: string | null;
  requested_role: string;
  reason: string;
  additional_info: string | null;
  status: AccessRequestStatus;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  invitation_id: string | null;
  created_user_id: string | null;
  created_at: string;
}

export interface AccessRequestCounts {
  pending: number;
  additional_info: number;
  approved: number;
  rejected: number;
  total: number;
}

export interface AccessRequestList {
  requests: AccessRequestSummary[];
  total: number;
  counts: AccessRequestCounts;
}

function toSummary(row: any): AccessRequestSummary {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    company: row.company,
    phone: row.phone ?? null,
    requested_role: row.requested_role,
    reason: row.reason,
    additional_info: row.additional_info ?? null,
    status: row.status as AccessRequestStatus,
    review_notes: row.review_notes ?? null,
    reviewed_by: row.reviewed_by ?? null,
    reviewed_by_name: row.reviewed_by_name ?? null,
    reviewed_at: row.reviewed_at ?? null,
    invitation_id: row.invitation_id ?? null,
    created_user_id: row.created_user_id ?? null,
    created_at: row.created_at,
  };
}

function getRequestOrThrow(id: string): AccessRequestSummary {
  const db = getDb();
  const row = db.prepare("SELECT * FROM user_access_requests WHERE id = ?").get(id) as any | undefined;
  if (!row) throw new ApiError(404, "ACCESS_REQUEST_NOT_FOUND", "That access request was not found.");
  return toSummary(row);
}

function effectiveCounts(): AccessRequestCounts {
  const db = getDb();
  const counts = { pending: 0, additional_info: 0, approved: 0, rejected: 0, total: 0 };
  const rows = db
    .prepare("SELECT status, COUNT(*) as c FROM user_access_requests GROUP BY status")
    .all() as Array<{ status: string; c: number }>;
  for (const row of rows) {
    const key = row.status as AccessRequestStatus;
    if (key in counts) {
      (counts as any)[key] = row.c;
      counts.total += row.c;
    }
  }
  return counts;
}

const RATE_WINDOW_SQL = "datetime('now', '-1 hour')";
const RATE_LIMIT = 3;

function adminNotificationEmails(): string[] {
  const configured = (process.env.ADMIN_NOTIFICATION_EMAILS ?? "").trim();
  const list = configured
    ? configured.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
    : [];
  if (list.length > 0) return list;
  const fallback = (process.env.SMTP_USER ?? "").trim().toLowerCase();
  return fallback ? [fallback] : [];
}

async function notifyAdmins(req: AccessRequestSummary): Promise<void> {
  if (!smtpConfigured()) {
    console.warn("[access-request] SMTP not configured — admin notification not sent.");
    return;
  }
  const recipients = adminNotificationEmails();
  if (recipients.length === 0) return;
  for (const to of recipients) {
    await sendMail({
      to,
      subject: `New ERP access request — ${req.name} (${req.company})`,
      text: [
        `A new access request was submitted to Ascentra ERP.`,
        ``,
        `Reference: ${req.id}`,
        `Name: ${req.name}`,
        `Email: ${req.email}`,
        `Company: ${req.company}`,
        `Requested role: ${req.requested_role}`,
        `Reason: ${req.reason}`,
        req.phone ? `Phone: ${req.phone}` : null,
        ``,
        `Review it in the ERP: Administration → Requests tab.`,
      ].filter(Boolean).join("\n") as string,
    });
  }
}

async function notifyApplicant(req: AccessRequestSummary, subject: string, body: string): Promise<"smtp_sent" | "send_failed" | "smtp_not_configured"> {
  if (!smtpConfigured()) {
    console.warn("[access-request] SMTP not configured — applicant notification not sent.");
    return "smtp_not_configured";
  }
  const result = await sendMail({ to: req.email, subject, text: body });
  return result.sent ? "smtp_sent" : "send_failed";
}

// ---------------------------------------------------------------------------
// Public submission
// ---------------------------------------------------------------------------
export interface AccessRequestInput {
  name?: string;
  email?: string;
  company?: string;
  requested_role?: string;
  reason?: string;
  phone?: string;
  additional_info?: string;
}

export async function submitAccessRequest(
  input: AccessRequestInput,
  meta: { ip?: string } = {}
): Promise<{ id: string; status: AccessRequestStatus }> {
  const name = (input.name ?? "").trim();
  const email = (input.email ?? "").trim().toLowerCase();
  const company = (input.company ?? "").trim();
  const requestedRole = (input.requested_role ?? "").trim();
  const reason = (input.reason ?? "").trim();
  const phone = (input.phone ?? "").trim() || null;
  const additionalInfo = (input.additional_info ?? "").trim() || null;

  if (name.length < 2 || name.length > 120) {
    throw new ApiError(400, "VALIDATION_ERROR", "Please enter your full name.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
    throw new ApiError(400, "VALIDATION_ERROR", "Please enter a valid email address.");
  }
  if (company.length < 2 || company.length > 160) {
    throw new ApiError(400, "VALIDATION_ERROR", "Company or organization is required.");
  }
  if (requestedRole.length < 2 || requestedRole.length > 120) {
    throw new ApiError(400, "VALIDATION_ERROR", "Please select the position or role you are requesting.");
  }
  if (reason.length < 10 || reason.length > 2000) {
    throw new ApiError(400, "VALIDATION_ERROR", "Please explain why you need access (at least 10 characters).");
  }
  if (phone && phone.length > 40) {
    throw new ApiError(400, "VALIDATION_ERROR", "Phone number is too long.");
  }

  const db = getDb();
  const ip = (meta.ip ?? "").trim() || null;

  // An existing account always blocks a new request — no need to re-register.
  // The applicant must sign in or reset their password (or talk to their admin) instead.
  const existingAccount = db
    .prepare("SELECT id, active FROM users WHERE lower(email) = ?")
    .get(email) as { id: string; active: number } | undefined;
  if (existingAccount) {
    throw new ApiError(
      409,
      "EMAIL_EXISTS",
      "An account already exists for this email address. Please sign in or reset your password instead — a new access request is not needed."
    );
  }

  // Rate limiting: max 3 requests per hour per email or per IP.
  const recent = db
    .prepare(
      `SELECT COUNT(*) as c FROM user_access_requests
       WHERE (lower(email) = ? OR (? <> '' AND ip_address = ?)) AND created_at >= ${RATE_WINDOW_SQL}`
    )
    .get(email, ip ?? "", ip ?? "") as { c: number };
  if (recent.c >= RATE_LIMIT) {
    throw new ApiError(429, "RATE_LIMITED", "Too many requests. Please wait a while before trying again.");
  }

  // Duplicate pending request for the same email.
  const duplicate = db
    .prepare("SELECT id FROM user_access_requests WHERE lower(email) = ? AND status IN ('pending', 'additional_info')")
    .get(email) as { id: string } | undefined;
  if (duplicate) {
    throw new ApiError(409, "DUPLICATE_REQUEST", "An access request for this email address is already awaiting review.");
  }

  const id = `ARQ-${Date.now().toString().slice(-6)}${crypto.randomInt(10, 99)}`;
  withTransaction((tx) => {
    tx.prepare(
      `INSERT INTO user_access_requests
         (id, name, email, company, phone, requested_role, reason, additional_info, status, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).run(id, name, email, company, phone, requestedRole, reason, additionalInfo, ip);
  });

  const submitted = getRequestOrThrow(id);
  recordAuditEvent({
    actor: {
      id: "PUBLIC-REQUEST",
      email,
      name,
      role: "public_request",
      roles: ["public_request"],
    } as unknown as AuthenticatedUser,
    action: "access_request.submitted",
    entityType: "AccessRequest",
    entityId: id,
    after: { name, email, company, requested_role: requestedRole },
    ipAddress: ip ?? undefined,
  });

  await notifyApplicant(
    submitted,
    "We received your Ascentra ERP access request",
    [
      `Hi ${name},`,
      ``,
      `Thank you for your request for access to Ascentra ERP (reference ${id}).`,
      `Your request has been submitted and is awaiting review by an administrator.`,
      `We will contact you at this address once a decision has been made.`,
      ``,
      `Ascentra Global Ltd`,
    ].join("\n")
  );
  notifyUsersWithPermission("users.manage", {
    module: "Access Requests",
    title: `New access request — ${submitted.name} (${company})`,
    detail: `${requestedRole}: ${reason.slice(0, 140)}${reason.length > 140 ? "…" : ""}`,
    href: "/admin?tab=requests",
    severity: "info",
  });
  await notifyAdmins(submitted);

  return { id, status: submitted.status };
}

// ---------------------------------------------------------------------------
// Admin review
// ---------------------------------------------------------------------------
export interface ReviewInput {
  action: "approve" | "reject" | "info" | "resume";
  /** Actual ERP roles to grant — required for approve. Never super_admin. */
  roles?: string[];
  warehouse?: string;
  store_id?: string | null;
  notes?: string;
}

export function listAccessRequests(
  actor: AuthenticatedUser,
  input: { search?: string; status?: string; limit?: number; offset?: number } = {}
): AccessRequestList {
  const db = getDb();
  const where: string[] = [];
  const params: SqlPrimitive[] = [];
  if (input.search) {
    where.push("(lower(name) LIKE ? OR lower(email) LIKE ? OR lower(company) LIKE ? OR lower(requested_role) LIKE ?)");
    const term = `%${input.search.toLowerCase()}%`;
    params.push(term, term, term, term);
  }
  if (input.status && (ACCESS_REQUEST_STATUSES as string[]).includes(input.status)) {
    where.push("status = ?");
    params.push(input.status);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) as c FROM user_access_requests ${whereSql}`).get(...params) as { c: number }).c;
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const rows = db
    .prepare(`SELECT * FROM user_access_requests ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as any[];
  return { requests: rows.map(toSummary), total, counts: effectiveCounts() };
}

export function getAccessRequest(actor: AuthenticatedUser, id: string): AccessRequestSummary {
  return getRequestOrThrow(id);
}

export async function reviewAccessRequest(
  actor: AuthenticatedUser,
  id: string,
  input: ReviewInput
): Promise<{ request: AccessRequestSummary; temporary_password?: string; created_user_id?: string; email_delivery?: string }> {
  const before = getRequestOrThrow(id);
  if (before.status === "approved" || before.status === "rejected") {
    throw new ApiError(409, "REQUEST_ALREADY_DECIDED", "This request has already been decided.");
  }
  const action = input.action;
  const db = getDb();
  const actorEmail = actor.email;

  if (action === "approve") {
    const roles = (input.roles ?? []).map((r) => normalizeRole(r)).filter(Boolean);
    const unique = [...new Set(roles)];
    if (unique.length === 0) {
      throw new ApiError(400, "ROLE_REQUIRED", "Choose the actual ERP role to grant.");
    }
    if (unique.includes("super_admin")) {
      throw new ApiError(403, "PRIVILEGE_ESCALATION", "Public access requests can never grant Super Admin.");
    }
    for (const roleCode of unique) {
      const role = db.prepare("SELECT code, protected, active FROM roles WHERE code = ?").get(roleCode) as
        | { code: string; protected: number; active: number }
        | undefined;
      if (!role) throw new ApiError(400, "ROLE_NOT_FOUND", `Role '${roleCode}' does not exist.`);
      if (!role.active) throw new ApiError(400, "ROLE_INACTIVE", `Role '${roleCode}' is deactivated.`);
      if (role.protected && actor.role !== "super_admin" && !actor.roles?.includes("super_admin")) {
        throw new ApiError(403, "PRIVILEGE_ESCALATION", `Only a Super Admin may assign the '${role.code}' role.`);
      }
    }
    const warehouse = (input.warehouse ?? "Milan Cold Hub").trim() || "Milan Cold Hub";
    // Create the account immediately — the temporary password is shown once to
    // the admin, never emailed. The user is forced to set a new password on
    // first sign-in.
    let created;
    try {
      created = createManualUser(actor, {
        name: before.name,
        email: before.email,
        roles: unique,
        warehouse,
        store_id: input.store_id ?? null,
      });
    } catch (err) {
      throw err;
    }
    const now = new Date().toISOString();
    withTransaction((tx) => {
      tx.prepare(
        `UPDATE user_access_requests
           SET status = 'approved', review_notes = ?, reviewed_by = ?, reviewed_by_name = ?, reviewed_at = ?, invitation_id = NULL, created_user_id = ?
         WHERE id = ?`
      ).run((input.notes ?? "").trim() || null, actor.id, actor.name, now, created.id, id);
    });
    recordAuditEvent({
      actor,
      action: "access_request.approved",
      entityType: "AccessRequest",
      entityId: id,
      before: { status: before.status, requested_role: before.requested_role, email: before.email },
      after: { status: "approved", granted_roles: unique, created_user_id: created.id },
    });
    // Notify the applicant — approved email includes sign-in link + temporary password.
    const loginUrl = `${(process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3001").replace(/\/+$/, "")}/login`;
    const approved = buildAccessApprovedEmail({
      name: before.name,
      email: before.email,
      reference: id,
      role: unique.join(", "),
      temporaryPassword: created.temporary_password,
      loginUrl,
    });
    let emailDelivery: "smtp_sent" | "send_failed" | "smtp_not_configured";
    if (!smtpConfigured()) {
      console.warn("[access-request] SMTP not configured — approval email not sent.");
      emailDelivery = "smtp_not_configured";
    } else {
      const result = await sendMail(approved);
      emailDelivery = result.sent ? "smtp_sent" : "send_failed";
    }
    return {
      request: getRequestOrThrow(id),
      created_user_id: created.id,
      temporary_password: created.temporary_password,
      email_delivery: emailDelivery,
    };
  }

  if (action === "reject") {
    const notes = (input.notes ?? "").trim();
    if (notes.length > 0 && notes.length < 4) {
      throw new ApiError(400, "VALIDATION_ERROR", "Please provide a slightly longer reason (or leave it empty).");
    }
    const now = new Date().toISOString();
    withTransaction((tx) => {
      tx.prepare(
        `UPDATE user_access_requests
           SET status = 'rejected', review_notes = ?, reviewed_by = ?, reviewed_by_name = ?, reviewed_at = ?
         WHERE id = ?`
      ).run(notes || null, actor.id, actor.name, now, id);
    });
    recordAuditEvent({
      actor,
      action: "access_request.rejected",
      entityType: "AccessRequest",
      entityId: id,
      before: { status: before.status, requested_role: before.requested_role, email: before.email },
      after: { status: "rejected", notes: notes || null },
    });
    await notifyApplicant(
      getRequestOrThrow(id),
      "Your Ascentra ERP access request was not approved",
      [
        `Hi ${before.name},`,
        ``,
        `Thank you for your interest in Ascentra ERP (reference ${id}).`,
        `After review, we are unable to grant access at this time.`,
        notes ? `Reason: ${notes}` : null,
        ``,
        `If you believe this is a mistake, please reply to this email.`,
        ``,
        `Ascentra Global Ltd`,
      ].filter(Boolean).join("\n") as string
    );
    return { request: getRequestOrThrow(id) };
  }

  if (action === "info") {
    const notes = (input.notes ?? "").trim();
    if (notes.length < 4) {
      throw new ApiError(400, "VALIDATION_ERROR", "Please describe what information is required.");
    }
    const now = new Date().toISOString();
    withTransaction((tx) => {
      tx.prepare(
        `UPDATE user_access_requests
           SET status = 'additional_info', review_notes = ?, reviewed_by = ?, reviewed_by_name = ?, reviewed_at = ?
         WHERE id = ?`
      ).run(notes, actor.id, actor.name, now, id);
    });
    recordAuditEvent({
      actor,
      action: "access_request.info_requested",
      entityType: "AccessRequest",
      entityId: id,
      before: { status: before.status, email: before.email },
      after: { status: "additional_info", notes },
    });
    await notifyApplicant(
      getRequestOrThrow(id),
      "Ascentra ERP — more information needed for your access request",
      [
        `Hi ${before.name},`,
        ``,
        `We reviewed your access request (reference ${id}) and need a little more information before we can decide:`,
        ``,
        notes,
        ``,
        `Please reply to this email with the requested details. Do not share any passwords.`,
        ``,
        `Ascentra Global Ltd`,
      ].join("\n")
    );
    return { request: getRequestOrThrow(id) };
  }

  if (action === "resume") {
    if (before.status !== "additional_info") {
      throw new ApiError(400, "INVALID_STATE", "Only requests awaiting additional information can be resumed.");
    }
    withTransaction((tx) => {
      tx.prepare("UPDATE user_access_requests SET status = 'pending' WHERE id = ?").run(id);
    });
    recordAuditEvent({
      actor,
      action: "access_request.resumed",
      entityType: "AccessRequest",
      entityId: id,
      before: { status: before.status },
      after: { status: "pending" },
    });
    return { request: getRequestOrThrow(id) };
  }

  throw new ApiError(400, "INVALID_ACTION", "Unknown review action.");
}

/**
 * Deletes an access request entirely (admin housekeeping).
 *
 * Only the request row is removed — any account created from an approved
 * request is untouched. Deleting is allowed while the request is still open
 * (pending, awaiting more info, or approved). Terminal decisions are kept as
 * audit history.
 */
export function deleteAccessRequest(actor: AuthenticatedUser, id: string): { deleted: boolean } {
  const before = getRequestOrThrow(id);
  if (before.status === "rejected") {
    throw new ApiError(
      409,
      "REQUEST_DECIDED",
      "Rejected requests are audit history — leave them in the list."
    );
  }
  const db = getDb();
  db.prepare("DELETE FROM user_access_requests WHERE id = ?").run(id);
  recordAuditEvent({
    actor,
    action: "admin.access_request_deleted",
    entityType: "AccessRequest",
    entityId: id,
    before: {
      name: before.name,
      email: before.email,
      status: before.status,
      created_user_id: before.created_user_id,
    },
  });
  return { deleted: true };
}
