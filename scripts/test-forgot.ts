// @ts-nocheck
const base = "http://127.0.0.1:3001";

async function main() {
  const target = process.argv[2] || "elena.conti@ascentra.it";
  const res = await fetch(`${base}/api/v1/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: target }),
  });
  const body = await res.json();
  console.log("POST forgot-password ->", res.status, JSON.stringify(body));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
