// @ts-nocheck
import { getDb } from "@/server/db/connection";

getDb();
const db = getDb();

console.log("=== audit row count: ", (db.prepare("SELECT COUNT(*) c FROM audit_events").get() as any).c);
console.log("=== purge rows: ", (db.prepare("SELECT COUNT(*) c FROM audit_events WHERE id LIKE 'PURGE-%'").get() as any).c);
console.log("=== my soft-delete audits still present: ", (db.prepare("SELECT COUNT(*) c FROM audit_events WHERE action IN ('admin.user_soft_deleted','admin.user_deleted')").get() as any).c);
const recent = db.prepare(
  `SELECT created_at, action, entity_id, actor_email FROM audit_events ORDER BY created_at DESC LIMIT 25`
).all() as any[];
for (const r of recent) console.log(`${r.created_at}  ${r.action}  ${r.entity_id}  by ${r.actor_email}`);
