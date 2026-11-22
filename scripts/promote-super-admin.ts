// @ts-nocheck
/**
 * Creates (or promotes) the Super Admin account for a given email.
 *
 *   node --import tsx scripts/promote-super-admin.ts [email] [password]
 *
 * Defaults: britsyncuk@gmail.com / Ascentra!2026
 * Idempotent: re-running on an existing account just re-applies the role and
 * password. Requires a running server on 127.0.0.1:3001.
 */
const base = process.env.ASCENTRA_BASE_URL ?? "http://127.0.0.1:3001";
const targetEmail = (process.argv[2] ?? "britsyncuk@gmail.com").trim().toLowerCase();
const targetPassword = process.argv[3] ?? "Ascentra!2026";
const targetName = "Super Admin";

const ADMIN_EMAIL = process.env.ASCENTRA_ADMIN_EMAIL ?? "elena.conti@ascentra.it";
const ADMIN_PASSWORD = process.env.ASCENTRA_ADMIN_PASSWORD ?? "Ascentra!2026";

function cookieFrom(res) {
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

function ok(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  return cond;
}

async function main() {
  const results = [];

  const login = await fetch(`${base}/api/v1/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const loginBody = await login.json().catch(() => ({}));
  const adminCookie = cookieFrom(login);
  results.push(ok("operator login", login.ok, `HTTP ${login.status} ${loginBody?.user?.role ?? ""}`));
  if (!login.ok) throw new Error("Cannot continue without an operator session.");

  // 1. Look for the account.
  const search = await fetch(
    `${base}/api/v1/admin/users?search=${encodeURIComponent(targetEmail)}&limit=50`,
    { headers: { Cookie: adminCookie } },
  );
  const searchBody = await search.json().catch(() => ({}));
  const existing = (searchBody?.users ?? []).find(
    (u) => String(u.email).toLowerCase() === targetEmail,
  );

  let userId = existing?.id;

  if (existing) {
    console.log(`Found existing account ${userId} (roles: ${(existing.roles ?? []).join(", ") || existing.role}).`);
    const patch = await fetch(`${base}/api/v1/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        roles: ["super_admin"],
        primary_role: "super_admin",
        active: true,
        password: targetPassword,
      }),
    });
    const patchBody = await patch.json().catch(() => ({}));
    results.push(ok("promote to super_admin", patch.ok, `HTTP ${patch.status} ${patchBody?.error?.code ?? ""}`));
  } else {
    console.log("No account for that email — creating a new Super Admin.");
    const create = await fetch(`${base}/api/v1/admin/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        name: targetName,
        email: targetEmail,
        password: targetPassword,
        roles: ["super_admin"],
        warehouse: "Milan Cold Hub",
      }),
    });
    const createBody = await create.json().catch(() => ({}));
    userId = createBody?.id;
    results.push(
      ok("create super_admin", create.ok, `HTTP ${create.status} ${createBody?.error?.code ?? ""} ${userId ?? ""}`),
    );
  }

  // 2. Confirm the stored record.
  const detail = await fetch(`${base}/api/v1/admin/users/${userId}`, { headers: { Cookie: adminCookie } });
  const detailBody = await detail.json().catch(() => ({}));
  const roles = detailBody?.roles ?? [];
  results.push(
    ok(
      "account has super_admin role",
      detail.ok && roles.includes("super_admin") && detailBody?.role === "super_admin",
      `roles=${JSON.stringify(roles)} primary=${detailBody?.role ?? "?"} active=${detailBody?.active}`,
    ),
  );

  // 3. Prove the new account can actually sign in and is a Super Admin.
  const userLogin = await fetch(`${base}/api/v1/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email: targetEmail, password: targetPassword }),
  });
  const userBody = await userLogin.json().catch(() => ({}));
  const userCookie = cookieFrom(userLogin);
  results.push(
    ok("new account login", userLogin.ok, `HTTP ${userLogin.status} role=${userBody?.user?.role ?? "?"}`),
  );

  const perms = await fetch(`${base}/api/v1/auth`, { headers: { Cookie: userCookie } });
  const permsBody = await perms.json().catch(() => ({}));
  const permissionList = permsBody?.permissions ?? permsBody?.user?.permissions ?? [];
  results.push(
    ok(
      "resolves as super_admin with full access",
      perms.ok &&
        permsBody?.user?.role === "super_admin" &&
        (permissionList.includes("*") || permissionList.includes("users.manage")),
      `${permissionList.includes("*") ? "wildcard *" : `${permissionList.length} permissions`}`,
    ),
  );

  const adminCheck = await fetch(`${base}/api/v1/admin/users?limit=1`, { headers: { Cookie: userCookie } });
  results.push(ok("can call admin API", adminCheck.ok, `HTTP ${adminCheck.status}`));

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  console.log(`Login: ${targetEmail} / ${targetPassword}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
