// @ts-nocheck
const base = "http://127.0.0.1:3001";

async function main() {
  const login = await fetch(`${base}/api/v1/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email: "elena.conti@ascentra.it", password: "Ascentra!2026" }),
  });
  const cookie = login.headers.getSetCookie ? login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") : "";

  const listRes = await fetch(`${base}/api/v1/admin/contact-messages?limit=50`, { headers: { Cookie: cookie } });
  const list = await listRes.json();
  const junk = (list.messages ?? []).filter((m: any) =>
    (m.subject === "Smoke verify — new composer" || m.subject === "Bin location — Burrata reserve") && m.direction === "to_user"
  );
  console.log("junk to delete:", junk.map((m: any) => m.id + ": " + m.subject).join(" | ") || "(none)");
  for (const m of junk) {
    const res = await fetch(`${base}/api/v1/admin/contact-messages/${m.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ action: "delete" }),
    });
    console.log("delete", m.id, "->", res.status);
  }
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
