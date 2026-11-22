// @ts-nocheck
const base = "http://127.0.0.1:3001";

async function main() {
  const login = await fetch(`${base}/api/v1/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email: "elena.conti@ascentra.it", password: "Ascentra!2026" }),
  });
  if (!login.ok) {
    console.error("login failed", login.status);
    process.exit(1);
  }
  const getSetCookie = login.headers.getSetCookie ? login.headers.getSetCookie() : [];
  const cookie = getSetCookie.map((c) => c.split(";")[0]).join("; ");
  console.log("cookie parts:", getSetCookie.length);

  for (const path of ["/admin?tab=requests", "/admin?tab=messages", "/admin?tab=access", "/admin", "/contact"]) {
    const res = await fetch(`${base}${path}`, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    console.log(`${path} -> ${res.status}`);
  }
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
