// @ts-nocheck
// Smoke-tested admin approval end-to-end, then cleaned up.
const BASE_URL = "http://127.0.0.1:3001";

async function main() {
  const login = await fetch(`${BASE_URL}/api/v1/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email: "elena.conti@ascentra.it", password: "Ascentra!2026" }),
  });
  if (!login.ok) {
    console.error("login failed", login.status, await login.text());
    process.exit(1);
  }
  const setCookie = login.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(",").map((c: string) => c.split(";")[0]).join("; ");
  console.log("login ok (cookie collected)");

  const listRes = await fetch(`${BASE_URL}/api/v1/admin/access-requests?status=pending&limit=5`, {
    headers: { Cookie: cookie },
  });
  const list = await listRes.json();
  console.log("pending list status", listRes.status, "count", list.requests?.length ?? "n/a");
  const target = (list.requests ?? []).find((r: any) => r.email === "smoke.test@example.com");
  if (!target) {
    console.error("smoke request not found in pending list");
    process.exit(1);
  }
  console.log("found request", target.id, "for", target.email);

  const approveRes = await fetch(`${BASE_URL}/api/v1/admin/access-requests/${target.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ action: "approve", roles: ["picker"], notes: "Smoke-test approval — will be removed." }),
  });
  const approve = await approveRes.json();
  console.log("approve", approveRes.status, JSON.stringify({
    temporary_password: approve.temporary_password ? "<returned>" : null,
    created_user_id: approve.created_user_id,
    status: approve.request?.status,
    email_delivery: approve.email_delivery,
  }));
  if (!approve.temporary_password) process.exit(1);

  const userRes = await fetch(`${BASE_URL}/api/v1/admin/users?search=smoke.test@example.com`, {
    headers: { Cookie: cookie },
  });
  const users = await userRes.json();
  const smokeUser = (users.users ?? []).find((u: any) => u.email === "smoke.test@example.com");
  console.log("created user visible to admin list:", smokeUser ? `${smokeUser.id} role=${smokeUser.role}` : "MISSING");

  const delRes = await fetch(`${BASE_URL}/api/v1/admin/users/${approve.created_user_id}`, {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
  console.log("delete smoke user", delRes.status);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
