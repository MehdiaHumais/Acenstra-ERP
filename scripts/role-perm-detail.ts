// @ts-nocheck
import { ROLE_PERMISSIONS } from "@/server/security/auth";

for (const role of ["anonymous", "store_staff", "driver", "store_vendor", "store_user"] as const) {
  const perms = (ROLE_PERMISSIONS as Record<string, string[]>)[role] ?? [];
  console.log(`\n=== ${role} (${perms.length}) ===`);
  for (const p of perms) console.log(`  - ${p}`);
}
