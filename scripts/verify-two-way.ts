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

  // 1) Admin sends a message to a regular user (smoke test target)
  const settingsRes = await fetch(`${base}/api/v1/admin/users?limit=20`, {
    headers: { Cookie: cookie },
  });
  const settings = await settingsRes.json();
  const pietro = (settings.users ?? []).find((u) => u.email === "alihamas21280811@gmail.com");
  if (!pietro) {
    console.error("picker not found");
    process.exit(1);
  }
  console.log("target:", pietro.id, pietro.email);

  const compose = await fetch(`${base}/api/v1/admin/contact-messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ action: "compose", user_id: pietro.id, subject: "Smoke test — bin location", message: "Pietro — bin 04 is reserved for Burrata this week. — Elena" }),
  });
  const composed = await compose.json();
  console.log("compose ->", compose.status, composed?.id ?? JSON.stringify(composed));

  // 2) Verify the message appears in the admin list with direction=to_user
  const listRes = await fetch(`${base}/api/v1/admin/contact-messages?direction=to_user&limit=5`, {
    headers: { Cookie: cookie },
  });
  const list = await listRes.json();
  const found = (list.messages ?? []).find((m) => m.id === composed.id);
  console.log("admin sees it:", found ? `yes — direction=${found.direction} status=${found.status}` : "NO");

  // 3) Log in as picker and read the message
  const pickerLogin = await fetch(`${base}/api/v1/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email: "alihamas21280811@gmail.com", password: "Ascentra!2026" }),
  });
  if (!pickerLogin.ok) {
    console.error("picker login failed");
    // still delete the test message
    await fetch(`${base}/api/v1/admin/contact-messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ action: "delete", id: composed.id }),
    });
    process.exit(1);
  }
  const pickerCookie = pickerLogin.headers.getSetCookie ? pickerLogin.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") : "";
  const mineRes = await fetch(`${base}/api/v1/contact`, { headers: { Cookie: pickerCookie } });
  const mine = await mineRes.json();
  const mineMsg = (mine.messages ?? []).find((m) => m.id === composed.id);
  console.log("picker inbox shows it:", mineMsg ? `yes — direction=${mineMsg.direction} status=${mineMsg.status}` : "NO");

  // 4) Admin deletes the message (using the admin API)
  const delRes = await fetch(`${base}/api/v1/admin/contact-messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ action: "delete", id: composed.id }),
  });
  console.log("admin delete ->", delRes.status);

  const afterRes = await fetch(`${base}/api/v1/admin/contact-messages?limit=50`, {
    headers: { Cookie: cookie },
  });
  const after = await afterRes.json();
  const stillThere = (after.messages ?? []).some((m) => m.id === composed.id);
  console.log("still present after delete:", stillThere ? "YES (bug)" : "no");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
