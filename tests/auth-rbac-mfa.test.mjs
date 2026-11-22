import test from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  verifyAccessToken,
  signMfaChallengeToken,
  verifyMfaChallengeToken,
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken
} from "../server/security/crypto.js";
import {
  generateTotpSecret,
  generateTotpUri,
  calculateTotpCode,
  verifyTotpCode,
  encryptSecret,
  decryptSecret,
  generateRecoveryCodes,
  verifyAndBurnRecoveryCode
} from "../server/security/totp.js";
import {
  ROLE_PERMISSIONS,
  hasPermission,
  assertPermission,
  assertWarehouseScope,
  assertStoreVendorScope,
  assertDriverScope,
  normalizeRole,
  authenticateUser,
  completeMfaLogin,
  enrollMfa,
  verifyMfaEnrollment,
  disableMfa,
  recordAuditEvent,
  listAuditEvents
} from "../server/security/auth.js";
import { getDb } from "../server/db/connection.js";

// Ensure DB schema and migrations are initialized
const db = getDb();

test("1. Password Hashing and Timing-Safe Verification", () => {
  const plain = "AscentraSecurePass2026!";
  const hash = hashPassword(plain);

  assert.ok(hash.startsWith("scrypt:"), "Hash format should begin with scrypt:");
  assert.equal(verifyPassword(plain, hash), true, "Correct password must verify");
  assert.equal(verifyPassword("WrongPassword123", hash), false, "Wrong password must fail");
  assert.equal(verifyPassword(plain, "scrypt:invalid:hash"), false, "Corrupt hash must safely fail");
});

test("2. JWT Access Token Signing, Claims Validation, and Expiration", async () => {
  const payload = {
    sub: "USR-TEST-01",
    email: "test.admin@ascentra.it",
    name: "Test Administrator",
    role: "super_admin",
    roles: ["super_admin"],
    warehouse: "Milan Cold Hub",
    store_id: null
  };

  const token = signAccessToken(payload, 900);
  assert.ok(typeof token === "string" && token.split(".").length === 3, "JWT must be 3-segment token");

  const verified = verifyAccessToken(token);
  assert.ok(verified, "Valid token must verify");
  assert.equal(verified.sub, payload.sub);
  assert.equal(verified.email, payload.email);
  assert.equal(verified.role, payload.role);
  assert.equal(verified.iss, "ascentra-erp");
  assert.equal(verified.aud, "ascentra-erp-client");

  // Tampered token check
  const tampered = token.slice(0, -5) + "abcde";
  assert.equal(verifyAccessToken(tampered), null, "Tampered signature must be rejected");

  // Expired token check (1 second TTL)
  const expiredToken = signAccessToken(payload, -10);
  assert.equal(verifyAccessToken(expiredToken), null, "Expired token must be rejected");
});

test("3. Refresh Token Family Rotation and Reuse Detection", () => {
  const userId = "USR-ADMIN";
  const { rawToken: token1 } = createRefreshToken(userId, "127.0.0.1", "TestClient");
  assert.ok(token1, "Initial refresh token must be issued");

  // 1st rotation: Token 1 -> Token 2
  const { rawToken: token2, userId: userRotated } = rotateRefreshToken(token1);
  assert.equal(userRotated, userId);
  assert.notEqual(token1, token2, "Rotated token must be different from previous token");

  // 2nd rotation: Token 2 -> Token 3
  const { rawToken: token3 } = rotateRefreshToken(token2);
  assert.notEqual(token2, token3);

  // REUSE ATTACK SIMULATION: Re-submitting Token 1 (which was already rotated)
  assert.throws(
    () => rotateRefreshToken(token1),
    /reuse detected/i,
    "Replaying an already-rotated token must trigger reuse detection and invalidate family"
  );

  // Once family is invalidated, subsequent attempts with Token 3 must also fail
  assert.throws(
    () => rotateRefreshToken(token3),
    /reuse detected/i,
    "Compromised token family must reject all subsequent tokens"
  );
});

test("4. TOTP RFC 6238 Engine, Base32, and Recovery Codes", () => {
  const secret = generateTotpSecret(20);
  assert.ok(/^[A-Z2-7]+$/.test(secret), "Secret must be valid uppercase RFC 4648 Base32");

  const uri = generateTotpUri({ email: "marco.bellini@ascentra.it", secret, issuer: "Ascentra ERP" });
  assert.ok(uri.startsWith("otpauth://totp/"), "URI must begin with otpauth://totp/");
  assert.ok(uri.includes("secret=" + secret));

  // Current counter OTP
  const timeStep = 30;
  const currentCounter = Math.floor(Date.now() / 1000 / timeStep);
  const code = calculateTotpCode(secret, currentCounter);
  assert.equal(code.length, 6, "Code must be 6 decimal digits");

  // Verification tolerance
  assert.equal(verifyTotpCode(secret, code), true, "Current code must pass");
  assert.equal(verifyTotpCode(secret, "000000"), false, "Invalid code must fail");
  assert.equal(verifyTotpCode(secret, "abc"), false, "Non-digit input must fail gracefully");

  // Recovery codes generation & burning
  const { plaincodes, hashes } = generateRecoveryCodes(8);
  assert.equal(plaincodes.length, 8);
  assert.equal(hashes.length, 8);

  const usedCode = plaincodes[0];
  const burnResult = verifyAndBurnRecoveryCode(usedCode, hashes);
  assert.equal(burnResult.valid, true, "First use of recovery code must succeed");
  assert.equal(burnResult.remainingHashes.length, 7, "Remaining hashes must be decremented");

  // Reusing same recovery code must fail
  const reuseResult = verifyAndBurnRecoveryCode(usedCode, burnResult.remainingHashes);
  assert.equal(reuseResult.valid, false, "Reused recovery code must be rejected");
});

test("5. AES-256-GCM Secret Encryption at Rest", () => {
  const rawSecret = "JBSWY3DPEHPK3PXP";
  const encrypted = encryptSecret(rawSecret);

  assert.notEqual(rawSecret, encrypted);
  assert.equal(encrypted.split(":").length, 3, "Ciphertext must contain iv:authTag:data");

  const decrypted = decryptSecret(encrypted);
  assert.equal(decrypted, rawSecret, "Decrypted secret must match original plaintext");

  // Tampered ciphertext authentication check
  const tampered = encrypted.slice(0, -4) + "ffff";
  assert.throws(() => decryptSecret(tampered), /unsupported state or unable to authenticate data/i);
});

test("6. Account Lockout Protection after 5 Failed Logins", () => {
  const testEmail = "lockout.test@ascentra.it";
  const pass = "ValidPassword123!";
  const passHash = hashPassword(pass);

  db.prepare(`
    INSERT OR REPLACE INTO users (id, email, name, password_hash, role, failed_attempts, locked_until, active)
    VALUES ('USR-LOCKOUT', ?, 'Lockout Tester', ?, 'warehouse_manager', 0, NULL, 1)
  `).run(testEmail, passHash);

  // 4 incorrect attempts
  for (let i = 0; i < 4; i++) {
    assert.throws(
      () => authenticateUser(testEmail, "WrongPassword"),
      (err) => err.statusCode === 401
    );
  }

  // 5th incorrect attempt -> triggers 423 ACCOUNT_LOCKED
  assert.throws(
    () => authenticateUser(testEmail, "WrongPassword"),
    (err) => err.statusCode === 423 && /locked/i.test(err.message)
  );

  // Immediate subsequent attempt with correct password is still blocked
  assert.throws(
    () => authenticateUser(testEmail, pass),
    (err) => err.statusCode === 423
  );

  // Unlock account in DB
  db.prepare("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE email = ?").run(testEmail);

  // Now login succeeds
  const success = authenticateUser(testEmail, pass);
  assert.equal(success.mfaRequired, false);
  assert.ok(success.accessToken);
});

test("7. RBAC Matrix Verification for All 9 Enterprise Roles", () => {
  const roles = [
    "super_admin",
    "warehouse_manager",
    "picker",
    "driver",
    "finance",
    "sales",
    "qa",
    "store_vendor",
    "ceo"
  ];

  for (const role of roles) {
    const permissions = ROLE_PERMISSIONS[role];
    assert.ok(Array.isArray(permissions), `Role '${role}' must have an assigned permissions list`);
    assert.ok(permissions.length > 0, `Role '${role}' permissions cannot be empty`);
  }

  // 1. Super Admin has full permissions
  const superAdmin = { id: "1", email: "admin@test.it", name: "Admin", role: "super_admin" };
  assert.equal(hasPermission(superAdmin, "users.manage"), true);
  assert.equal(hasPermission(superAdmin, "inventory.adjust"), true);
  assert.equal(hasPermission(superAdmin, "invoices.manage"), true);

  // 2. CEO is read-only reports across modules, no direct stock adjust or payment record
  const ceo = { id: "2", email: "ceo@test.it", name: "CEO", role: "ceo" };
  assert.equal(hasPermission(ceo, "reports.executive.read"), true);
  assert.equal(hasPermission(ceo, "inventory.read"), true);
  assert.equal(hasPermission(ceo, "inventory.adjust"), false);
  assert.equal(hasPermission(ceo, "payments.record"), false);

  // 3. Finance has invoices and payments, but no inventory adjust or users manage
  const finance = { id: "3", email: "fin@test.it", name: "Finance", role: "finance" };
  assert.equal(hasPermission(finance, "invoices.manage"), true);
  assert.equal(hasPermission(finance, "payments.record"), true);
  assert.equal(hasPermission(finance, "inventory.adjust"), false);
  assert.equal(hasPermission(finance, "users.manage"), false);

  // 4. Warehouse Manager has inventory adjust & purchase orders, but no user admin
  const whMgr = { id: "4", email: "wh@test.it", name: "WH Mgr", role: "warehouse_manager" };
  assert.equal(hasPermission(whMgr, "inventory.adjust"), true);
  assert.equal(hasPermission(whMgr, "purchase_orders.manage"), true);
  assert.equal(hasPermission(whMgr, "users.manage"), false);

  // 5. Picker has inventory pick, but no inventory adjust or orders manage
  const picker = { id: "5", email: "picker@test.it", name: "Picker", role: "picker" };
  assert.equal(hasPermission(picker, "inventory.pick"), true);
  assert.equal(hasPermission(picker, "inventory.adjust"), false);
  assert.equal(hasPermission(picker, "orders.manage"), false);

  // 6. Driver has deliveries update assigned, but no invoices manage or inventory adjust
  const driver = { id: "6", email: "driver@test.it", name: "Driver", role: "driver" };
  assert.equal(hasPermission(driver, "deliveries.update_assigned"), true);
  assert.equal(hasPermission(driver, "invoices.manage"), false);
  assert.equal(hasPermission(driver, "inventory.adjust"), false);

  // 7. QA has quality checks and recalls manage, but no financial payment recording
  const qa = { id: "7", email: "qa@test.it", name: "QA", role: "qa" };
  assert.equal(hasPermission(qa, "quality_checks.manage"), true);
  assert.equal(hasPermission(qa, "recalls.manage"), true);
  assert.equal(hasPermission(qa, "payments.record"), false);

  // 8. Store Vendor has own orders and inventory, but no cross-platform user management
  const vendor = { id: "8", email: "vendor@test.it", name: "Vendor", role: "store_vendor", store_id: "STR-01" };
  assert.equal(hasPermission(vendor, "orders.manage"), true);
  assert.equal(hasPermission(vendor, "users.manage"), false);

  // 9. Sales has orders manage, but no system settings
  const sales = { id: "9", email: "sales@test.it", name: "Sales", role: "sales" };
  assert.equal(hasPermission(sales, "orders.manage"), true);
  assert.equal(hasPermission(sales, "settings.manage"), false);
});

test("8. Scope Boundary Enforcement (Warehouse, Store Vendor, Driver)", () => {
  // Warehouse scoping: User belonging to Milan cannot adjust Verona
  const milanStaff = { id: "U-1", email: "milan@test.it", name: "Milan User", role: "warehouse_manager", warehouse: "Milan Cold Hub" };
  assert.doesNotThrow(() => assertWarehouseScope(milanStaff, "Milan Cold Hub"));
  assert.throws(() => assertWarehouseScope(milanStaff, "Verona Regional Hub"), /FORBIDDEN_WAREHOUSE_SCOPE/);

  // Store Vendor scoping: Vendor for STR-MIL-01 cannot manage STR-ROM-02
  const vendorMilan = { id: "U-2", email: "v@navigli.it", name: "Navigli Store", role: "store_vendor", store_id: "STR-MIL-01" };
  assert.doesNotThrow(() => assertStoreVendorScope(vendorMilan, "STR-MIL-01"));
  assert.throws(() => assertStoreVendorScope(vendorMilan, "STR-ROM-02"), /FORBIDDEN_VENDOR_SCOPE/);

  // Driver scoping: Driver cannot update another driver's route
  const driverDavide = { id: "USR-DRV", email: "davide@ascentra.it", name: "Davide Galli", role: "driver" };
  assert.doesNotThrow(() => assertDriverScope(driverDavide, "USR-DRV"));
  assert.throws(() => assertDriverScope(driverDavide, "USR-OTHER-DRIVER"), /FORBIDDEN_DRIVER_SCOPE/);
});

test("9. Centralized Audit Logging and Sensitive Data Sanitization", () => {
  const actor = { id: "USR-ADMIN", email: "elena.conti@ascentra.it", name: "Elena Conti", role: "super_admin" };
  
  const auditId = recordAuditEvent({
    actor,
    action: "auth.test_sensitive_sanitization",
    entityType: "UserSecurity",
    entityId: "USR-ADMIN",
    before: { password: "SecretPassword123!", raw_token: "jwt.secret.token", normal_field: "Safe Value" },
    after: { mfa_secret: "SECRETKEY123", backup_recovery_code: "1234-5678", email: "elena@ascentra.it" },
    ipAddress: "192.168.1.50"
  });

  assert.ok(auditId.startsWith("AUD-"), "Audit ID must be generated");

  const events = listAuditEvents(5);
  const recorded = events.find((e) => e.id === auditId);
  assert.ok(recorded, "Recorded event must be retrievable");

  // Confirm sensitive data was redacted before persisting
  assert.ok(!recorded.after_json.includes("SECRETKEY123"), "TOTP secret must NOT appear in audit logs");
  assert.ok(!recorded.after_json.includes("1234-5678"), "Recovery code must NOT appear in audit logs");
  assert.ok(recorded.after_json.includes("[REDACTED]"), "Sensitive values must be replaced by [REDACTED]");
  assert.ok(recorded.after_json.includes("elena@ascentra.it"), "Non-sensitive data must be retained");
});
