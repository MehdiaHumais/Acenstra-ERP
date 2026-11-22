// @ts-nocheck
import { getDb } from "@/server/db/connection";

getDb();
const db = getDb();
const rows = db.prepare("SELECT id, email, name, role, active FROM users ORDER BY email").all() as any[];
for (const r of rows) console.log(`${r.active ? "A" : "D"}  ${r.id}  ${r.email}  (${r.role})  ${r.name}`);
console.log("TOTAL:", rows.length);
