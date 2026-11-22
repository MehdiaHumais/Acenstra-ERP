// @ts-nocheck
import { getDb } from "@/server/db/connection";

const base = "http://127.0.0.1:3001";
const stamp = Date.now();
const testEmail = `qa.lifecycle.${stamp}@ascentra.local`;
const inviteEmail = `qa.invite.${stamp}@ascentra.local`;
const password = "QaTest!2026";

function cookieFrom(res) {
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
function ok(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  return cond;
}

async function main() {
  const results = [];

  // 0. Admin login
  const adminLogin = await fetch(`${base}/api/v1/auth`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email: "elena.conti@ascentra.it", password: "Ascentra!2026" }),
  });
  const adminCookie = cookieFrom(adminLogin);
  results.push(ok("admin login", adminLogin.ok, `HTTP ${adminLogin.status}`));
  if (!adminLogin.ok) throw new Error("cannot continue without admin");

  // 1. Create a disposable user
  const createRes = await fetch(`${base}/api/v1/admin/users`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ name: "QA Lifecycle", email: testEmail, password, role: "picker" }),
  });
  const created = await createRes.json().catch(() => ({}));
  results.push(ok("create test user", createRes.ok, `HTTP ${createRes.status} ${created?.id ?? ""}`));
  const userId = created?.id;

  // 2. Log in as the disposable user (captures the session cookie that would
  //    still be open in a browser tab elsewhere).
  const userLogin = await fetch(`${base}/api/v1/auth`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email: testEmail, password }),
  });
  const userCookie = cookieFrom(userLogin);
  results.push(ok("test user login", userLogin.ok, `HTTP ${userLogin.status}`));

  // 3. Send a contact message as the user, then check the admin bell payload
  //    already contains it (client polling is what removes the reload need).
  const msgRes = await fetch(`${base}/api/v1/contact`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: userCookie },
    body: JSON.stringify({ subject: "Ask a question", message: `Lifecycle test ${stamp}` }),
  });
  results.push(ok("user sends contact message", msgRes.ok, `HTTP ${msgRes.status}`));

  const adminNotes = await fetch(`${base}/api/v1/notifications`, { headers: { Cookie: adminCookie } });
  const notesBody = await adminNotes.json().catch(() => ({}));
  const hasLiveNote = (notesBody?.notifications ?? []).some(
    (n) => JSON.stringify(n).includes(String(stamp)) || /contact|message/i.test(`${n.module} ${n.title}`)
  );
  results.push(ok("admin bell payload has new message (pollable)", hasLiveNote, `${(notesBody?.notifications ?? []).length} notifications`));

  // 4. Admin hard-deletes the user.
  const delRes = await fetch(`${base}/api/v1/admin/users/${userId}`, { method: "DELETE", headers: { Cookie: adminCookie } });
  results.push(ok("admin deletes user", delRes.ok, `HTTP ${delRes.status}`));

  // 5. The old session must be dead with an explicit ACCOUNT_DELETED code.
  const staleSession = await fetch(`${base}/api/v1/notifications`, { headers: { Cookie: userCookie } });
  const staleBody = await staleSession.json().catch(() => ({}));
  results.push(ok(
    "old session rejected",
    staleSession.status === 401 && staleBody?.error?.code === "ACCOUNT_DELETED",
    `HTTP ${staleSession.status} ${staleBody?.error?.code ?? ""}`
  ));

  // 6. A fresh login attempt says the account was deleted (not bad password).
  const relogin = await fetch(`${base}/api/v1/auth`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email: testEmail, password }),
  });
  const reloginBody = await relogin.json().catch(() => ({}));
  results.push(ok(
    "login says account deleted",
    relogin.status === 403 && reloginBody?.error?.code === "ACCOUNT_DELETED",
    `HTTP ${relogin.status} ${reloginBody?.error?.code ?? ""}`
  ));

  // 7. Email is reusable: create a new account with the same address.
  const reCreate = await fetch(`${base}/api/v1/admin/users`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ name: "QA Reuse", email: testEmail, password, role: "picker" }),
  });
  const reCreated = await reCreate.json().catch(() => ({}));
  results.push(ok("email reusable after delete", reCreate.ok, `HTTP ${reCreate.status} ${reCreated?.id ?? ""}`));

  // 8. Login now succeeds again (tombstone must not block the new account).
  const reLogin = await fetch(`${base}/api/v1/auth`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email: testEmail, password }),
  });
  results.push(ok("reissued account can log in", reLogin.ok, `HTTP ${reLogin.status}`));

  // 9. Accepted invitations are now deletable.
  const invRes = await fetch(`${base}/api/v1/admin/invitations`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ name: "QA Invite", email: inviteEmail, roles: ["picker"] }),
  });
  const invBody = await invRes.json().catch(() => ({}));
  const invId = invBody?.invitation?.id;
  results.push(ok("create invitation", invRes.ok && Boolean(invId), `HTTP ${invRes.status}`));

  const db = getDb();
  if (invId) {
    db.prepare("UPDATE user_invitations SET status = 'accepted', accepted_at = datetime('now') WHERE id = ?").run(invId);
    const delInv = await fetch(`${base}/api/v1/admin/invitations/${invId}`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ action: "delete" }),
    });
    const delInvBody = await delInv.json().catch(() => ({}));
    const stillThere = db.prepare("SELECT id FROM user_invitations WHERE id = ?").get(invId);
    results.push(ok(
      "accepted invitation deletable",
      delInv.ok && !stillThere,
      `HTTP ${delInv.status} ${delInvBody?.error?.code ?? ""}`
    ));
  }

  // Cleanup: remove the two disposable accounts + tombstones + any invite.
  for (const row of db.prepare("SELECT id FROM users WHERE lower(email) IN (?, ?)").all(testEmail, inviteEmail)) {
    await fetch(`${base}/api/v1/admin/users/${row.id}`, { method: "DELETE", headers: { Cookie: adminCookie } }).catch(() => null);
  }
  db.prepare("DELETE FROM deleted_accounts WHERE lower(email) IN (?, ?)").run(testEmail, inviteEmail);
  db.prepare("DELETE FROM user_invitations WHERE lower(email) IN (?, ?)").run(testEmail, inviteEmail);

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
