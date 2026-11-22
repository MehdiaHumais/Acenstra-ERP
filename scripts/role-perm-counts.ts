// @ts-nocheck
import { ROLE_PERMISSIONS } from "@/server/security/auth";

const rows = Object.entries(ROLE_PERMISSIONS)
  .map(([role, perms]) => ({ role, count: perms.length, perms }))
  .sort((a, b) => a.count - b.count);

for (const r of rows) {
  console.log(`${String(r.count).padStart(3)}  ${r.role}`);
}
console.log();
const [least] = rows;
console.log(`LEAST ACCESS: ${least.role} (${least.count} permission(s))`);
console.log(`permissions: ${JSON.stringify(least.perms)}`);
