// @ts-nocheck
const base = "http://127.0.0.1:3001";
const codes = ["8964001234567", "8964002345678", "3017620422003", "8056593285012"];

function ean13ChecksumValid(code) {
  if (!/^\d{13}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = Number(code[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === Number(code[12]);
}

async function main() {
  const login = await fetch(`${base}/api/v1/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email: "elena.conti@ascentra.it", password: "Ascentra!2026" }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

  for (const code of codes) {
    console.log(`\n=== ${code} ===`);
    console.log(`  EAN-13 checksum valid: ${ean13ChecksumValid(code)}`);
    const res = await fetch(`${base}/api/v1/products/barcode/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ barcode: code }),
    });
    const body = await res.json().catch(() => ({}));
    console.log(`  API status: ${res.status}`);
    console.log(`  local found: ${body?.found}`);
    console.log(`  external status: ${body?.external_status ?? body?.external?.status ?? "n/a"}`);
    console.log(`  reason: ${body?.external_reason ?? body?.external?.reason ?? body?.error?.message ?? "n/a"}`);
    console.log(`  raw keys: ${Object.keys(body ?? {}).join(", ")}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
