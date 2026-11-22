// @ts-nocheck
const base = "http://127.0.0.1:3001";

async function main() {
  const login = await fetch(`${base}/api/v1/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email: "elena.conti@ascentra.it", password: "Ascentra!2026" }),
  });
  if (!login.ok) throw new Error("login failed");
  const cookie = login.headers.getSetCookie ? login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") : "";

  // 1) Create a throwaway manual user (stand-in for admin creating one)
  const createRes = await fetch(`${base}/api/v1/admin/users/manual`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name: "Smoke Tempuser", email: `smoke-tempuser-${Date.now()}@example.com`, roles: ["picker"], warehouse: "Milan Cold Hub" }),
  });
  const created = await createRes.json();
  console.log("manual create ->", createRes.status, JSON.stringify({ id: created.id, email: created.email }));

  // 2) Admin resets the password via the new endpoint
  const resetRes = await fetch(`${base}/api/v1/admin/users/${created.id}/reset-password`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  const reset = await resetRes.json();
  console.log("reset-password ->", resetRes.status, JSON.stringify({ must_change_password: reset.must_change_password, has_temp: Boolean(reset.temporary_password) }));

  // 3) The reset temp password must authenticate
  const verify = await fetch(`${base}/api/v1/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email: created.email, password: reset.temporary_password }),
  });
  const verifyBody = await verify.json();
  console.log("login with temp password ->", verify.status, "must_change_password:", verifyBody?.user?.must_change_password);

  // 4) Old password must NOT work anymore
  const oldCheck = await fetch(`${base}/api/v1/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email: created.email, password: created.temporary_password }),
  });
  console.log("old password ->", oldCheck.status, "(should be 401)");

  // 5) Cleanup — delete the throwaway user
  const del = await fetch(`${base}/api/v1/admin/users/${created.id}`, {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
  console.log("delete smoke user ->", del.status);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
