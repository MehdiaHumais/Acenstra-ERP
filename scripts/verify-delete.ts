// @ts-nocheck
const base = "http://127.0.0.1:3001";

async function main() {
  const login = await fetch(`${base}/api/v1/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email: "elena.conti@ascentra.it", password: "Ascentra!2026" }),
  });
  const cookie = login.headers.getSetCookie ? login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") : "";

  const msgs = await fetch(`${base}/api/v1/admin/contact-messages?limit=20`, { headers: { Cookie: cookie } });
  const parsed = await msgs.json();
  console.log("messages status:", msgs.status);
  for (const m of parsed.messages ?? []) {
    console.log(" -", m.id, m.direction, m.status, "to/from:", m.user_email, "· subject:", m.subject);
  }

  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
