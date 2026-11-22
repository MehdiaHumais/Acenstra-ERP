// @ts-nocheck
import { getDb } from "@/server/db/connection";

getDb();
const db = getDb();
const rows = db
  .prepare(
    `SELECT u.id, u.email, u.name, u.active,
       (SELECT COUNT(*) FROM user_roles r WHERE r.user_id = u.id) AS roles,
       (SELECT COUNT(*) FROM audit_events a WHERE a.action = 'admin.user_soft_deleted' AND a.entity_id = u.id) AS soft_delete_audits
     FROM users u
     ORDER BY u.active ASC, u.email ASC`
  )
  .all() as Array<{ id: string; email: string; name: string; active: number; roles: number; soft_delete_audits: number }>;

for (const r of rows) {
  console.log(`${r.active === 0 ? "DEACT" : "ACTIVE"} roles=${r.roles} softDelAudits=${r.soft_delete_audits}  ${r.email}  (${r.name})  [${r.id}]`);
}
console.log("TOTAL USERS:", rows.length);
