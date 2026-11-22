// @ts-nocheck
import { getDb, withTransaction } from "@/server/db/connection";

getDb();
const db = getDb();
const rows = db.prepare("SELECT id, email, name FROM user_access_requests").all() as Array<{ id: string; email: string; name: string }>;
if (rows.length === 0) {
  console.log("Queue already empty.");
  process.exit(0);
}
for (const r of rows) console.log(`${r.id}  ${r.email}  (${r.name})`);
withTransaction((tx) => {
  for (const r of rows) {
    tx.prepare("DELETE FROM user_access_requests WHERE id = ?").run(r.id);
  }
});
console.log("Purged", rows.length, "test access request(s). Remaining:", (db.prepare("SELECT COUNT(*) c FROM user_access_requests").get() as any).c);
