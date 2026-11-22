// @ts-nocheck
import { getDb, withTransaction } from "@/server/db/connection";

getDb();
const db = getDb();
const rows = db.prepare("SELECT id FROM user_contact_messages WHERE subject = 'Ask a question' AND message = 'Smoke test — admin console check from my account.'").all() as Array<{ id: string }>;
withTransaction((tx) => {
  for (const r of rows) {
    tx.prepare("DELETE FROM notifications WHERE title LIKE '%Ask a question%'").run();
    tx.prepare("DELETE FROM user_contact_messages WHERE id = ?").run(r.id);
    console.log(`removed ${r.id}`);
  }
});
console.log("remaining contact messages:", (db.prepare("SELECT COUNT(*) c FROM user_contact_messages").get() as any).c, "· notifications:", (db.prepare("SELECT COUNT(*) c FROM notifications").get() as any).c);
