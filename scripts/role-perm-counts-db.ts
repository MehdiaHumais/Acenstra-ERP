// @ts-nocheck
import { getDb } from "@/server/db/connection";

getDb();
const db = getDb();
const roles = db.prepare(
  `SELECT r.code, r.name, r.is_system, r.active,
          (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_code = r.code) AS perm_count
     FROM roles r ORDER BY perm_count ASC, r.code ASC`
).all() as Array<{ code: string; name: string; is_system: number; active: number; perm_count: number }>;

console.log("ROLE (db, live)".padEnd(40), "perms  active  system");
for (const r of roles) {
  console.log(`${r.code} (${r.name})`.padEnd(40), String(r.perm_count).padStart(4), String(r.active).padStart(6), "      ", r.is_system ? "system" : "custom");
}
