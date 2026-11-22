// @ts-nocheck
import { getDb, withTransaction } from "@/server/db/connection";

getDb();
const db = getDb();
const rows = db
  .prepare("SELECT id, email, name FROM user_access_requests WHERE email = 'smoke.test@example.com'")
  .all() as Array<{ id: string; email: string; name: string }>;
withTransaction((tx) => {
  for (const r of rows) {
    tx.prepare("DELETE FROM user_access_requests WHERE id = ?").run(r.id);
    console.log(`removed smoke access request ${r.id} (${r.email})`);
  }
});
console.log("remaining requests:", (db.prepare("SELECT COUNT(*) c FROM user_access_requests").get() as any).c);
