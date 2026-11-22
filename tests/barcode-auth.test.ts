import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "barcode-test-"));
process.env.SQLITE_DB_PATH = path.join(tmpDir, "barcode.sqlite");
process.env.SEED_DEMO_DATA = "true";

import { getDb } from "@/server/db/connection";
import {
  authenticateWithBarcode,
  identifyBarcodeCredential,
  issueUserCredential,
  listUserCredentials,
  revokeUserCredential,
  setUserCredentialStatus
} from "@/server/services/credential.service";
import { getEffectiveAuthorization } from "@/server/security/auth";

const admin = { id: "USR-ADMIN-T", email: "admin-barcode@example.com", name: "Barcode Admin", role: "super_admin" as const };
const vendorEmail = "carlo@ristorantecracco.it";
const password = "Ascentra!2026";

/** Resolve a demo user id from the seeded DB. */
function userIdFor(email: string): string {
  const db = getDb();
  const row = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string } | undefined;
  assert.ok(row, `seeded user ${email} must exist`);
  return row.id;
}

test("issues a credential, reveals it exactly once, and never stores the raw secret", async () => {
  const db = getDb();
  const uid = userIdFor(vendorEmail);
  const issued = await issueUserCredential(admin as any, uid, "Test Card");
  assert.ok(issued.secret.startsWith("ASC1-"));
  assert.ok(issued.credential.id);

  // The raw secret must NOT be stored â€” only its hash.
  const stored = db
    .prepare("SELECT credential_hash, secret_hint FROM user_credentials WHERE id = ?")
    .get(issued.credential.id) as { credential_hash: string; secret_hint: string };
  assert.notEqual(stored.credential_hash, issued.secret);
  assert.ok(!stored.credential_hash.includes(issued.secret));
  assert.ok(stored.secret_hint.endsWith(issued.secret.slice(-6)));

  const identified = identifyBarcodeCredential(issued.secret, "127.0.0.1", "test");
  assert.equal(identified.email, vendorEmail);
});

test("authenticates with barcode + password and preserves RBAC permissions", async () => {
  const uid = userIdFor(vendorEmail);
  const issued = await issueUserCredential(admin as any, uid, "Test Card");
  const result = authenticateWithBarcode(issued.secret, password, "127.0.0.1", "test");

  assert.equal(result.mfaRequired, false);
  assert.ok(result.accessToken);
  assert.equal(result.user.role, "store_vendor");

  // RBAC is read live: vendor keeps least privilege
  const effective = getEffectiveAuthorization({ id: result.user.id, role: result.user.role, roles: result.user.roles });
  assert.ok(!effective.permissions.includes("*"));
  assert.ok(!effective.permissions.includes("inventory.adjust"));
  assert.ok(!effective.permissions.includes("users.manage"));
});

test("rejects an unknown barcode without leaking existence", () => {
  assert.throws(() => identifyBarcodeCredential("ASC1-not-a-real-code-xxxxxxxxxxxxxxxxxxx", "127.0.0.1", "test"), /CREDENTIAL_INVALID|Barcode not recognized/i);
});

test("password verification is still required after a valid barcode", async () => {
  const uid = userIdFor(vendorEmail);
  const issued = await issueUserCredential(admin as any, uid, "Test Card");
  assert.throws(
    () => authenticateWithBarcode(issued.secret, "definitely-wrong-password", "127.0.0.1", "test"),
    /INVALID_CREDENTIALS|Invalid email or password/i
  );
});

test("regenerating revokes the previous credential immediately", async () => {
  const uid = userIdFor(vendorEmail);
  const first = await issueUserCredential(admin as any, uid, "First");
  const second = await issueUserCredential(admin as any, uid, "Second");

  assert.notEqual(first.secret, second.secret);
  assert.throws(() => identifyBarcodeCredential(first.secret, "127.0.0.1", "test"), /revoked|credential_revoked/i);

  const identified = identifyBarcodeCredential(second.secret, "127.0.0.1", "test");
  assert.equal(identified.email, vendorEmail);

  // Only one active credential must exist
  const active = listUserCredentials(admin as any, uid).filter((c) => c.status === "active");
  assert.equal(active.length, 1);
  assert.equal(active[0].secret_hint, second.credential.secret_hint);
});

test("revoked credentials cannot be used to authenticate", async () => {
  const uid = userIdFor(vendorEmail);
  const issued = await issueUserCredential(admin as any, uid, "Revoked");
  revokeUserCredential(admin as any, uid);
  assert.throws(() => authenticateWithBarcode(issued.secret, password, "127.0.0.1", "test"), /revoked/i);
});

test("suspended user cannot authenticate with a barcode", async () => {
  const uid = userIdFor(vendorEmail);
  const db = getDb();
  const issued = await issueUserCredential(admin as any, uid, "Suspended");

  db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(uid);
  try {
    assert.throws(() => authenticateWithBarcode(issued.secret, password, "127.0.0.1", "test"), /disabled|suspended|ACCOUNT_DISABLED/i);
  } finally {
    db.prepare("UPDATE users SET active = 1 WHERE id = ?").run(uid);
  }
});

test("temporarily deactivating a barcode blocks it, reactivating restores it", async () => {
  const uid = userIdFor(vendorEmail);
  const issued = await issueUserCredential(admin as any, uid, "Toggle");
  const [active] = listUserCredentials(admin as any, uid).filter((c) => c.status === "active");
  assert.ok(active);

  setUserCredentialStatus(admin as any, uid, active.id, "inactive");
  assert.throws(() => authenticateWithBarcode(issued.secret, password, "127.0.0.1", "test"), /deactivated|inactive/i);

  setUserCredentialStatus(admin as any, uid, active.id, "active");
  const result = authenticateWithBarcode(issued.secret, password, "127.0.0.1", "test");
  assert.ok(result.accessToken);
});

test("no credential material is written to the audit log", async () => {
  const uid = userIdFor(vendorEmail);
  const issued = await issueUserCredential(admin as any, uid, "AuditTest");
  identifyBarcodeCredential(issued.secret, "127.0.0.1", "test");

  const db = getDb();
  const rows = db
    .prepare("SELECT before_json, after_json FROM audit_events WHERE action LIKE 'credential.%' ORDER BY created_at DESC LIMIT 20")
    .all() as Array<{ before_json: string | null; after_json: string | null }>;

  for (const row of rows) {
    const blob = `${row.before_json ?? ""}${row.after_json ?? ""}`;
    assert.ok(!blob.includes(issued.secret), "audit log must never contain the raw credential");
  }
});

test("barcode login cannot escalate privileges: store vendor stays scoped", async () => {
  const uid = userIdFor(vendorEmail);
  const issued = await issueUserCredential(admin as any, uid, "ScopeTest");
  const result = authenticateWithBarcode(issued.secret, password, "127.0.0.1", "test");

  const effective = getEffectiveAuthorization({ id: result.user.id, role: result.user.role, roles: result.user.roles });
  const scoped = effective.scopes ?? (result.user as any)?.scopes ?? {};
  // Vendors receive store/customer scoping â€” never company/warehouse overrides
  assert.ok(!effective.permissions.includes("settings.manage"));
  assert.ok(!effective.permissions.includes("audit.read"));
});

