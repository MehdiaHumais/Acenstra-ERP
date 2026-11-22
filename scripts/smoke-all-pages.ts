// @ts-nocheck
const base = "http://127.0.0.1:3001";
const pages = [
  "/",
  "/orders", "/portal", "/stores", "/products", "/suppliers", "/inbound",
  "/inventory", "/putaway", "/warehouse", "/warehouse/picking", "/quality",
  "/traceability", "/deliveries", "/finance", "/stores",
  "/management", "/analytics", "/settings", "/proposal",
  "/admin", "/contact", "/change-password",
];

async function main() {
  const login = await fetch(`${base}/api/v1/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email: "elena.conti@ascentra.it", password: "Ascentra!2026" }),
  });
  if (!login.ok) throw new Error("login failed");
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

  for (const page of pages) {
    const res = await fetch(`${base}${page}`, { headers: { Cookie: cookie }, redirect: "manual" });
    const buf = await res.arrayBuffer();
    const chunk = Buffer.from(buf).toString("utf8");
    const isError = /__next_error__|application\/ld\+json|Exception|ECONNREFUSED|not found|ParseError/i.test(chunk);
    console.log(`${page.padEnd(24)} ${res.status}${isError ? "  ⚠ contains error text" : ""}`);
  }
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
