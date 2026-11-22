// @ts-nocheck
const base = "http://127.0.0.1:3001";

async function main() {
  const login = await fetch(`${base}/api/v1/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email: "elena.conti@ascentra.it", password: "Ascentra!2026" }),
  });
  const cookie = login.headers.getSetCookie ? login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") : "";
  console.log("login status:", login.status);

  const usersRes = await fetch(`${base}/api/v1/admin/users?limit=20`, { headers: { Cookie: cookie } });
  const users = await usersRes.json();
  console.log("users status:", usersRes.status, "count:", users.users?.length ?? "n/a");
  if (users.users) for (const u of users.users) console.log("  -", u.id, u.email, u.role);

  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
