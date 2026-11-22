// @ts-nocheck
import { getDb } from "@/server/db/connection";

getDb();
const db = getDb();
const rows = db.prepare(
  `SELECT created_at, action, entity_id, actor_email, before_json FROM audit_events
   WHERE action IN ('admin.user_deleted','admin.user_soft_deleted')
   ORDER BY created_at DESC LIMIT 30`
).all() as Array<{ created_at: string; action: string; entity_id: string; actor_email: string; before_json: string | null }>;
for (const r of rows) {
  let email = r.entity_id;
  try { email = (JSON.parse(r.before_json ?? "{}") as any).email ?? r.entity_id; } catch {}
  console.log(`${r.created_at}  ${r.action}  ${r.entity_id}  ${email}  by ${r.actor_email}`);
}
console.log("TOTAL user-delete events:", (db.prepare("SELECT COUNT(*) c FROM audit_events WHERE action IN ('admin.user_deleted','admin.user_soft_deleted')").get() as any).c);
