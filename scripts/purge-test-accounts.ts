// @ts-nocheck
import { getDb, withTransaction } from "@/server/db/connection";

getDb();
const db = getDb();

// These two fixed-id accounts were re-inserted into the live database by the
// test suite (it opened the live SQLite file). The admin already deleted them
// twice (13:32 Nov 17). Remove them for good.
const IDS = ["USR-TEST-REFRESH", "USR-LOCKOUT"];
const now = new Date().toISOString();

withTransaction((tx) => {
  for (const id of IDS) {
    const row = tx.prepare("SELECT id, email, name FROM users WHERE id = ?").get(id) as { id: string; email: string; name: string } | undefined;
    if (!row) {
      console.log(`${id}: not present, skipping`);
      continue;
    }
    tx.prepare("DELETE FROM user_roles WHERE user_id = ?").run(id);
    tx.prepare("DELETE FROM user_permissions WHERE user_id = ?").run(id);
    tx.prepare("DELETE FROM user_scopes WHERE user_id = ?").run(id);
    tx.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").run(id);
    tx.prepare("DELETE FROM user_sessions WHERE user_id = ?").run(id);
    tx.prepare("DELETE FROM user_credentials WHERE user_id = ?").run(id);
    tx.prepare("DELETE FROM users WHERE id = ?").run(id);
    tx.prepare(
      `INSERT INTO audit_events (id, actor_id, actor_email, actor_role, action, entity_type, entity_id, before_json, after_json, created_at)
       VALUES (?, 'SYSTEM-PURGE', 'system@ascentra.local', 'system', 'admin.user_deleted', 'User', ?, ?, ?, ?)`
    ).run(
      `PURGE-${id}-${now.replace(/[^0-9]/g, "").slice(0, 14)}`,
      id,
      JSON.stringify({ email: row.email, name: row.name, via: "fixed-id test account leaked by npm test into live DB" }),
      JSON.stringify({ deleted: true, purged: true }),
      now
    );
    console.log(`purged ${row.email} (${row.name}) [${id}]`);
  }
});
const total = (db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }).c;
console.log("TOTAL USERS:", total);
