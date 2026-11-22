/**
 * Scoped in-app notifications — one row per recipient.
 *
 * Fanout helpers target only users whose effective authorization grants the
 * given permission, so e.g. access-request alerts reach administrators and
 * no one else. Notifications respect the same RBAC as the rest of the app.
 */
import crypto from "node:crypto";
import { getDb } from "@/server/db/connection";
import { getEffectiveAuthorization, type AuthenticatedUser } from "@/server/security/auth";

export type NotificationSeverity = "critical" | "warning" | "info";

export interface NotificationSummary {
  id: string;
  severity: NotificationSeverity;
  module: string;
  title: string;
  detail: string;
  href: string | null;
  is_read: boolean;
  created_at: string;
}

interface NotificationPayload {
  module: string;
  title: string;
  detail: string;
  href?: string | null;
  severity?: NotificationSeverity;
}

function insertNotification(userId: string, payload: NotificationPayload): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO notifications (id, user_id, severity, module, title, detail, href)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `NTF-${Date.now().toString().slice(-6)}${crypto.randomInt(100, 999)}`,
    userId,
    payload.severity ?? "info",
    payload.module,
    payload.title,
    payload.detail,
    payload.href ?? null
  );
}

/** Notify every active user whose effective authorization includes `permission`. Returns count. */
export function notifyUsersWithPermission(permission: string, payload: NotificationPayload): number {
  const db = getDb();
  const active = db
    .prepare("SELECT id, email, name, role, warehouse, store_id FROM users WHERE active = 1")
    .all() as Array<{ id: string; email: string; name: string; role: string; warehouse: string | null; store_id: string | null }>;
  let count = 0;
  for (const user of active) {
    try {
      const effective = getEffectiveAuthorization({
        id: user.id,
        role: user.role,
        warehouse: user.warehouse,
        store_id: user.store_id,
      });
      const granted = effective.permissions;
      if (granted.includes("*") || granted.includes(permission)) {
        insertNotification(user.id, payload);
        count += 1;
      }
    } catch (err) {
      console.warn(`[notifications] failed to evaluate permissions for user ${user.id}:`, (err as Error).message);
    }
  }
  return count;
}

/** Notify a single user — used when the admin replies to their message. */
export function notifyUser(userId: string, payload: NotificationPayload): void {
  insertNotification(userId, payload);
}

export interface MyNotifications {
  unread_count: number;
  notifications: NotificationSummary[];
}

/** List the current user's notifications (latest 30). */
export function listMyNotifications(actor: AuthenticatedUser): MyNotifications {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, severity, module, title, detail, href, is_read, created_at
       FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`
    )
    .all(actor.id) as Array<{
    id: string;
    severity: NotificationSeverity;
    module: string;
    title: string;
    detail: string;
    href: string | null;
    is_read: number;
    created_at: string;
  }>;
  const unreadRow = db
    .prepare("SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0")
    .get(actor.id) as { c: number };
  return {
    unread_count: unreadRow.c,
    notifications: rows.map((row) => ({
      id: row.id,
      severity: row.severity,
      module: row.module,
      title: row.title,
      detail: row.detail,
      href: row.href ?? null,
      is_read: Boolean(row.is_read),
      created_at: row.created_at,
    })),
  };
}

/** Mark the current user's notifications as read (all, or the given ids). */
export function markNotificationsRead(actor: AuthenticatedUser, ids?: string[]): number {
  const db = getDb();
  if (ids && ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    const result = db
      .prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id IN (${placeholders})`)
      .run(actor.id, ...ids);
    return Number(result.changes ?? 0);
  }
  const result = db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?").run(actor.id);
  return Number(result.changes ?? 0);
}
