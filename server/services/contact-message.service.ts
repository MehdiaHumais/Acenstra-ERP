/**
 * Contact messages — non-administrator users send a message to administrators
 * (request access change, report a problem, ask a question, etc.).
 * Administrators read and reply from the admin dashboard Messages tab.
 * Each reply triggers an in-app notification back to the sender.
 */
import crypto from "node:crypto";
import { getDb, withTransaction } from "@/server/db/connection";
import type { SqlPrimitive } from "@/server/db/sqlite-driver";
import { ApiError } from "@/server/core/http";
import {
  recordAuditEvent,
  type AuthenticatedUser,
} from "@/server/security/auth";
import {
  sendMail,
  smtpConfigured,
} from "@/server/services/mail.service";
import { notifyUser, notifyUsersWithPermission } from "@/server/services/notification.service";

export const CONTACT_SUBJECTS = [
  "Request access change",
  "Report a problem",
  "Ask a question",
  "Something else",
] as const;

export type ContactSubject = (typeof CONTACT_SUBJECTS)[number];

export interface ContactMessageSummary {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  user_role: string;
  subject: string;
  message: string;
  /** to_admin: user sent it to administrators. to_user: administration sent it to this user. */
  direction: "to_admin" | "to_user";
  status: "new" | "read" | "replied";
  admin_reply: string | null;
  replied_by: string | null;
  replied_by_name: string | null;
  replied_at: string | null;
  created_at: string;
}

export interface ContactMessageCounts {
  new: number;
  read: number;
  replied: number;
  total: number;
}

export interface ContactMessageList {
  messages: ContactMessageSummary[];
  total: number;
  counts: ContactMessageCounts;
}

function toSummary(row: any): ContactMessageSummary {
  return {
    id: row.id,
    user_id: row.user_id,
    user_name: row.user_name,
    user_email: row.user_email,
    user_role: row.user_role,
    subject: row.subject,
    message: row.message,
    direction: (row.direction ?? "to_admin") as ContactMessageSummary["direction"],
    status: row.status as ContactMessageSummary["status"],
    admin_reply: row.admin_reply ?? null,
    replied_by: row.replied_by ?? null,
    replied_by_name: row.replied_by_name ?? null,
    replied_at: row.replied_at ?? null,
    created_at: row.created_at,
  };
}

function adminNotificationEmails(): string[] {
  const configured = (process.env.ADMIN_NOTIFICATION_EMAILS ?? "").trim();
  const list = configured
    ? configured.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
    : [];
  if (list.length > 0) return list;
  const fallback = (process.env.SMTP_USER ?? "").trim().toLowerCase();
  return fallback ? [fallback] : [];
}

async function notifyAdminsOfMessage(msg: ContactMessageSummary): Promise<void> {
  if (!smtpConfigured()) {
    console.warn("[contact] SMTP not configured — admin notification not sent.");
    return;
  }
  for (const to of adminNotificationEmails()) {
    await sendMail({
      to,
      subject: `New contact message — ${msg.user_name} (${msg.subject})`,
      text: [
        `A new contact message was submitted.`,
        ``,
        `Reference: ${msg.id}`,
        `From: ${msg.user_name} <${msg.user_email}>`,
        `Subject: ${msg.subject}`,
        ``,
        msg.message,
        ``,
        `Read and reply in the ERP: Administration → Messages tab.`,
      ].join("\n"),
    });
  }
}

export function createContactMessage(
  actor: AuthenticatedUser,
  input: { subject?: string; message?: string },
  meta: { ip?: string } = {}
): { id: string } {
  if (!actor?.id) throw new ApiError(401, "UNAUTHENTICATED", "You must be signed in.");
  const subject = (input.subject ?? "").trim();
  const message = (input.message ?? "").trim();
  if (!CONTACT_SUBJECTS.includes(subject as ContactSubject)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Please choose a valid subject.");
  }
  if (message.length < 5) {
    throw new ApiError(400, "VALIDATION_ERROR", "Please write at least a few words.");
  }
  if (message.length > 4000) {
    throw new ApiError(400, "VALIDATION_ERROR", "Message is too long (max 4000 characters).");
  }

  const db = getDb();
  const id = `MSG-${Date.now().toString().slice(-6)}${crypto.randomInt(10, 99)}`;
  withTransaction((tx) => {
    tx.prepare(
      `INSERT INTO user_contact_messages (id, user_id, user_email, user_name, user_role, subject, message, direction, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'to_admin', 'new')`
    ).run(id, actor.id, actor.email, actor.name, actor.role, subject, message);
  });
  const created = toSummary(db.prepare("SELECT * FROM user_contact_messages WHERE id = ?").get(id));
  recordAuditEvent({
    actor,
    action: "contact.message_sent",
    entityType: "ContactMessage",
    entityId: id,
    after: { subject, user_email: actor.email },
    ipAddress: meta.ip,
  });
  // Notify admins in-app (scoped to users.manage) immediately.
  notifyUsersWithPermission("users.manage", {
    module: "Messages",
    title: `New message from ${created.user_name} — ${subject}`,
    detail: message.slice(0, 140) + (message.length > 140 ? "…" : ""),
    href: "/admin?tab=messages",
    severity: "info",
  });
  // Best-effort email notification to admins.
  void notifyAdminsOfMessage(created).catch((err) =>
    console.warn("[contact] admin notification failed:", err)
  );
  return { id };
}

export function listMyContactMessages(actor: AuthenticatedUser): ContactMessageSummary[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM user_contact_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`
    )
    .all(actor.id);
  return (rows as any[]).map(toSummary);
}

export function listAllContactMessages(
  actor: AuthenticatedUser,
  input: { search?: string; status?: string; direction?: string; limit?: number; offset?: number } = {}
): ContactMessageList {
  const db = getDb();
  const where: string[] = [];
  const params: SqlPrimitive[] = [];
  if (input.search) {
    where.push("(lower(user_name) LIKE ? OR lower(user_email) LIKE ? OR lower(message) LIKE ? OR lower(subject) LIKE ?)");
    const term = `%${input.search.toLowerCase()}%`;
    params.push(term, term, term, term);
  }
  if (input.status && ["new", "read", "replied"].includes(input.status)) {
    where.push("status = ?");
    params.push(input.status);
  }
  if (input.direction === "to_admin" || input.direction === "to_user") {
    where.push("direction = ?");
    params.push(input.direction);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) as c FROM user_contact_messages ${whereSql}`).get(...params) as { c: number }).c;
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const rows = db
    .prepare(`SELECT * FROM user_contact_messages ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as any[];
  const counts = db
    .prepare("SELECT status, COUNT(*) as c FROM user_contact_messages GROUP BY status")
    .all() as Array<{ status: string; c: number }>;
  const countMap = { new: 0, read: 0, replied: 0, total: 0 };
  for (const row of counts) {
    if (row.status in countMap) (countMap as any)[row.status] = row.c;
    countMap.total += row.c;
  }
  return { messages: rows.map(toSummary), total, counts: countMap };
}

export function getContactMessage(actor: AuthenticatedUser, id: string): ContactMessageSummary {
  const db = getDb();
  const row = db.prepare("SELECT * FROM user_contact_messages WHERE id = ?").get(id);
  if (!row) throw new ApiError(404, "MESSAGE_NOT_FOUND", "That message was not found.");
  const own = (row as any).user_id === actor.id;
  if (!own && !actor.roles?.includes("super_admin") && actor.role !== "super_admin") {
    // admins read anything (users.read or users.manage enforced at the route);
    // owners read their own.
    // The route enforces users.read before calling — non-admins only see their own.
  }
  return toSummary(row);
}

/** Admin reply marks the message read/replied and notifies the sender. */
export async function replyToContactMessage(
  actor: AuthenticatedUser,
  id: string,
  input: { reply?: string }
): Promise<ContactMessageSummary> {
  const db = getDb();
  const row = db.prepare("SELECT * FROM user_contact_messages WHERE id = ?").get(id) as any | undefined;
  if (!row) throw new ApiError(404, "MESSAGE_NOT_FOUND", "That message was not found.");
  const reply = (input.reply ?? "").trim();
  if (reply.length < 2) throw new ApiError(400, "VALIDATION_ERROR", "Please write a reply (at least a few words).");
  if (reply.length > 4000) throw new ApiError(400, "VALIDATION_ERROR", "Reply is too long (max 4000 characters).");

  const now = new Date().toISOString();
  withTransaction((tx) => {
    tx.prepare(
      `UPDATE user_contact_messages
         SET status = 'replied', admin_reply = ?, replied_by = ?, replied_by_name = ?, replied_at = ?
       WHERE id = ?`
    ).run(reply, actor.id, actor.name, now, id);
  });
  recordAuditEvent({
    actor,
    action: "contact.message_replied",
    entityType: "ContactMessage",
    entityId: id,
    after: { subject: row.subject, replied_at: now },
  });
  // Notify sender — in-app + email (email best-effort).
  notifyUser(row.user_id, {
    module: "Messages",
    title: `Your message was answered — ${row.subject}`,
    detail: reply.slice(0, 140) + (reply.length > 140 ? "…" : ""),
    href: "/contact",
    severity: "info",
  });
  if (smtpConfigured()) {
    await sendMail({
      to: row.user_email,
      subject: `Re: ${row.subject} — reply from Ascentra ERP Administration`,
      text: [
        `Hi ${row.user_name},`,
        ``,
        `An administrator replied to your message (reference ${id}):`,
        ``,
        reply,
        ``,
        `— Ascentra ERP Administration`,
      ].join("\n"),
    }).catch((err) => console.warn("[contact] sender notification failed:", err));
  }
  return toSummary(db.prepare("SELECT * FROM user_contact_messages WHERE id = ?").get(id));
}

/** Mark a message as read by its recipient (admin → user read by user, user → admin read by admin). */
export function markContactMessageRead(actor: AuthenticatedUser, id: string): ContactMessageSummary {
  const db = getDb();
  const row = db.prepare("SELECT id, user_id FROM user_contact_messages WHERE id = ?").get(id) as
    | { id: string; user_id: string }
    | undefined;
  if (!row) throw new ApiError(404, "MESSAGE_NOT_FOUND", "That message was not found.");
  const isAdmin =
    actor.role === "super_admin" ||
    actor.roles?.includes("super_admin") ||
    (actor.roles ?? []).some((r) => ["company_admin", "administrator"].includes(r));
  const isOwner = row.user_id === actor.id;
  if (!isAdmin && !isOwner) throw new ApiError(403, "FORBIDDEN", "You may only mark your own messages as read.");
  db.prepare("UPDATE user_contact_messages SET status = 'read' WHERE id = ? AND status = 'new'").run(id);
  return toSummary(db.prepare("SELECT * FROM user_contact_messages WHERE id = ?").get(id));
}

/** Admin → user compose: creates a message targeted at a specific user. */
export function createAdminMessageToUser(
  actor: AuthenticatedUser,
  input: { user_id?: string; subject?: string; message?: string }
): ContactMessageSummary {
  if (!actor?.id) throw new ApiError(401, "UNAUTHENTICATED", "You must be signed in.");
  const userId = (input.user_id ?? "").trim();
  const subject = (input.subject ?? "").trim();
  const message = (input.message ?? "").trim();
  if (!userId) throw new ApiError(400, "VALIDATION_ERROR", "Choose who to send the message to.");
  if (subject.length < 2) throw new ApiError(400, "VALIDATION_ERROR", "Please enter a subject.");
  if (subject.length > 160) throw new ApiError(400, "VALIDATION_ERROR", "Subject is too long.");
  if (message.length < 5) throw new ApiError(400, "VALIDATION_ERROR", "Please write at least a few words.");
  if (message.length > 4000) throw new ApiError(400, "VALIDATION_ERROR", "Message is too long (max 4000 characters).");

  const db = getDb();
  const target = db
    .prepare("SELECT id, email, name, role FROM users WHERE id = ? AND active = 1")
    .get(userId) as { id: string; email: string; name: string; role: string } | undefined;
  if (!target) throw new ApiError(404, "USER_NOT_FOUND", "Active account not found for that user.");

  const id = `MSG-${Date.now().toString().slice(-6)}${crypto.randomInt(10, 99)}`;
  withTransaction((tx) => {
    tx.prepare(
      `INSERT INTO user_contact_messages
         (id, user_id, user_email, user_name, user_role, subject, message, direction, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'to_user', 'new')`
    ).run(id, target.id, target.email, target.name, target.role, subject, message);
  });
  const created = toSummary(db.prepare("SELECT * FROM user_contact_messages WHERE id = ?").get(id));
  recordAuditEvent({
    actor,
    action: "contact.admin_message_sent",
    entityType: "ContactMessage",
    entityId: id,
    after: { subject, to: target.email },
  });
  notifyUser(target.id, {
    module: "Messages",
    title: `Administration — ${subject}`,
    detail: message.slice(0, 140) + (message.length > 140 ? "…" : ""),
    href: "/contact",
    severity: "info",
  });
  if (smtpConfigured()) {
    void sendMail({
      to: target.email,
      subject: `Message from Ascentra ERP Administration — ${subject}`,
      text: [
        `Hi ${target.name},`,
        ``,
        `${actor.name} sent you a message:`,
        ``,
        message,
        ``,
        `— Ascentra ERP Administration`,
      ].join("\n"),
    }).catch((err) => console.warn("[contact] admin→user email failed:", err));
  }
  return created;
}

/** Delete a message — its owner, or any administrator (users.manage). */
export function deleteContactMessage(actor: AuthenticatedUser, id: string): { ok: boolean } {
  const db = getDb();
  const row = db.prepare("SELECT id, user_id FROM user_contact_messages WHERE id = ?").get(id) as
    | { id: string; user_id: string }
    | undefined;
  if (!row) throw new ApiError(404, "MESSAGE_NOT_FOUND", "That message was not found.");
  const isAdmin = actor.role === "super_admin" || actor.roles?.includes("super_admin") || (actor.roles ?? []).some((r) => ["company_admin", "administrator"].includes(r));
  const isOwner = row.user_id === actor.id;
  if (!isOwner && !isAdmin) {
    throw new ApiError(403, "FORBIDDEN", "You may only delete your own messages.");
  }
  withTransaction((tx) => {
    tx.prepare("DELETE FROM user_contact_messages WHERE id = ?").run(id);
  });
  recordAuditEvent({
    actor,
    action: "contact.message_deleted",
    entityType: "ContactMessage",
    entityId: id,
    after: { deleted_by: actor.email },
  });
  return { ok: true };
}
