// @ts-nocheck
import { getDb, withTransaction } from "@/server/db/connection";

getDb();
const db = getDb();

// Tombstones from the previous soft-delete behaviour: admin clicked Trash
// (audit action admin.user_soft_deleted), the row survived with its email
// reserved forever. Purge them so the accounts are really gone.
const tombstones = db
  .prepare(
    `SELECT u.id, u.email, u.name
     FROM users u
     WHERE u.active = 0
       AND NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id)
       AND EXISTS (SELECT 1 FROM audit_events a WHERE a.action = 'admin.user_soft_deleted' AND a.entity_id = u.id)`
  )
  .all() as Array<{ id: string; email: string; name: string }>;

if (tombstones.length === 0) {
  console.log("No soft-delete tombstones found — nothing to purge.");
  process.exit(0);
}

const now = new Date().toISOString();
withTransaction((tx) => {
  for (const t of tombstones) {
    tx.prepare("DELETE FROM user_roles WHERE user_id = ?").run(t.id);
    tx.prepare("DELETE FROM user_permissions WHERE user_id = ?").run(t.id);
    tx.prepare("DELETE FROM user_scopes WHERE user_id = ?").run(t.id);
    tx.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").run(t.id);
    tx.prepare("DELETE FROM user_sessions WHERE user_id = ?").run(t.id);
    tx.prepare("DELETE FROM user_credentials WHERE user_id = ?").run(t.id);
    tx.prepare("DELETE FROM users WHERE id = ?").run(t.id);
    tx.prepare(
      `INSERT INTO audit_events (id, actor_id, actor_email, actor_role, action, entity_type, entity_id, before_json, after_json, created_at)
       VALUES (?, 'SYSTEM-PURGE', 'system@ascentra.local', 'system', 'admin.user_deleted', 'User', ?, ?, ?, ?)`
    ).run(
      `PURGE-${t.id}-${now.replace(/[^0-9]/g, "").slice(0, 14)}`,
      t.id,
      JSON.stringify({ email: t.email, name: t.name, via: "admin.user_soft_deleted (tombstone purge)" }),
      JSON.stringify({ deleted: true, purged: true }),
      now
    );
    console.log(`purged ${t.email} (${t.name}) [${t.id}]`);
  }
});
console.log(`Purged ${tombstones.length} tombstone account(s). Emails are free for re-use.`);
