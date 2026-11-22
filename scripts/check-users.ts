// @ts-nocheck
import { getDb } from "@/server/db/connection";

getDb();
const db = getDb();
const emails = [
  "delete-test@example.com",
  "lockout.test@ascentra.it",
  "ui.delete.roundtrip@example.com",
  "ui.modal.test@example.com",
];
for (const e of emails) {
  const u = db.prepare("SELECT id, email, name, active FROM users WHERE lower(email) = ?").get(e) as any;
  console.log(e, "->", u ? `EXISTS id=${u.id} active=${u.active} (${u.name})` : "gone");
}
const count = db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number };
console.log("TOTAL USERS:", count.c);
const seedUsers = db
  .prepare("SELECT id, email FROM users WHERE id IN ('USR-LOCKOUT','USR-TEST-REFRESH','USR-ADMIN','USR-PICK')")
  .all() as any[];
console.log("fixed-id users present:", JSON.stringify(seedUsers));
