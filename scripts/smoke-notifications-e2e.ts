// @ts-nocheck
const base = "http://127.0.0.1:3001";

async function main() {
  // 1) Public submit with an email that already has an account (elena.conti@ascentra.it)
  const dup = await fetch(`${base}/api/v1/access-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Mara Bocellari",
      email: "elena.conti@ascentra.it",
      company: "ContiFoods",
      requested_role: "Driver",
      reason: "Requesting an account that is already mine.",
    }),
  });
  console.log("existing-email submit ->", dup.status, JSON.stringify(await dup.json().catch(() => null)));

  // 2) Login as elena.conti to access /api/v1/notifications and /api/v1/contact
  const login = await fetch(`${base}/api/v1/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email: "elena.conti@ascentra.it", password: "Ascentra!2026" }),
  });
  if (!login.ok) {
    console.log("login failed", login.status);
    process.exit(1);
  }
  const setCookie = login.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(",").map((c: string) => c.split(";")[0]).join("; ");

  // 3) Sign-in user submits a contact message
  const sent = await fetch(`${base}/api/v1/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ subject: "Ask a question", message: "Smoke test — admin console check from my account." }),
  });
  const sentBody = await sent.json();
  console.log("contact submit ->", sent.status, JSON.stringify(sentBody));

  // 4) Verify the message is visible to admins and in my own list
  const mine = await fetch(`${base}/api/v1/contact`, { headers: { Cookie: cookie } });
  console.log("my messages ->", mine.status, "count:", (await mine.json())?.messages?.length);

  // 5) Notifications for this user (admin gets the 'new contact message' fanout)
  const notif = await fetch(`${base}/api/v1/notifications`, { headers: { Cookie: cookie } });
  console.log("notifications ->", notif.status, JSON.stringify(await notif.json()));

  // 6) Cleanup: reply to the smoke message through admin API, verify sender gets notified
  const replyTarget = (await (await fetch(`${base}/api/v1/admin/contact-messages?status=new&limit=5`, { headers: { Cookie: cookie } })).json())?.messages?.find((m: any) => m.subject === "Ask a question");
  if (replyTarget) {
    const reply = await fetch(`${base}/api/v1/admin/contact-messages/${replyTarget.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ action: "reply", reply: "Smoke test: noted — no action required." }),
    });
    console.log("admin reply ->", reply.status, (await reply.json())?.status);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
