import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ascentra-access-req-"));
process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-access-request.sqlite");
process.env.SEED_DEMO_DATA = "true";

import { getDb } from "@/server/db/connection";
import {
  submitAccessRequest,
  listAccessRequests,
  getAccessRequest,
  reviewAccessRequest,
} from "@/server/services/access-request.service";
import { requestPasswordReset, resetPasswordWithToken } from "@/server/services/password-reset.service";
import { authenticateUser, ensureRbacConfig } from "@/server/security/auth";
import type { AuthenticatedUser } from "@/server/security/auth";

before(() => ensureRbacConfig());

const superAdmin: AuthenticatedUser = {
  id: "USR-ADMIN-ARQ",
  email: "arq-admin@example.com",
  name: "Access Admin",
  role: "super_admin",
  roles: ["super_admin"],
};

describe("Access requests — public submission", () => {
  it("creates a PENDING request without creating any account", async () => {
    const email = `req-${Date.now()}@example.com`;
    const result = await submitAccessRequest({
      name: "Visitor One",
      email,
      company: "Example SpA",
      requested_role: "Warehouse Manager",
      reason: "I need inbound receiving access for Milan Cold Hub deliveries.",
    });
    assert.equal(result.status, "pending");
    const row = getDb().prepare("SELECT status FROM user_access_requests WHERE id = ?").get(result.id) as { status: string };
    assert.equal(row.status, "pending");
    const userRow = getDb().prepare("SELECT id FROM users WHERE lower(email) = ?").get(email);
    assert.equal(userRow, undefined, "No account must be created on submission");
    const audit = getDb()
      .prepare("SELECT COUNT(*) c FROM audit_events WHERE action = 'access_request.submitted' AND entity_id = ?")
      .get(result.id) as { c: number };
    assert.equal(audit.c, 1);
  });

  it("rejects invalid submissions (short reason, bad email)", async () => {
    await assert.rejects(
      submitAccessRequest({ name: "Bad", email: "not-an-email", company: "X", requested_role: "Driver", reason: "too short" }),
      (err: any) => err.code === "VALIDATION_ERROR"
    );
    await assert.rejects(
      submitAccessRequest({ name: "Bad", email: "ok@example.com", company: "X", requested_role: "Driver", reason: "short" }),
      (err: any) => err.code === "VALIDATION_ERROR"
    );
  });

  it("prevents duplicate pending requests for the same email", async () => {
    const email = `dupe-${Date.now()}@example.com`;
    await submitAccessRequest({ name: "Dupe", email, company: "DupeCo", requested_role: "Picker", reason: "First request with enough details please." });
    await assert.rejects(
      submitAccessRequest({ name: "Dupe Again", email, company: "DupeCo", requested_role: "Driver", reason: "Second request attempt with enough details." }),
      (err: any) => err.code === "DUPLICATE_REQUEST" && err.statusCode === 409
    );
  });

  it("rate-limits floods from the same IP", async () => {
    const ip = "203.0.113.77";
    const stamp = Date.now().toString(36);
    for (let i = 0; i < 3; i++) {
      await submitAccessRequest(
        { name: `Flood ${i}`, email: `flood-${stamp}-${i}@example.com`, company: "FloodCo", requested_role: "Picker", reason: "Legitimate-looking request with enough detail." },
        { ip }
      );
    }
    await assert.rejects(
      submitAccessRequest(
        { name: "Flood 4", email: `flood-${stamp}-3@example.com`, company: "FloodCo", requested_role: "Picker", reason: "Fourth request from the same source address." },
        { ip }
      ),
      (err: any) => err.code === "RATE_LIMITED" && err.statusCode === 429
    );
  });
});

describe("Access requests — admin review", () => {
  it("lists requests and never exposes them before review", async () => {
    const list = listAccessRequests(superAdmin, { status: "pending", limit: 5, offset: 0 });
    assert.ok(Array.isArray(list.requests));
    assert.ok(list.counts.pending >= 1);
    const found = listAccessRequests(superAdmin, { search: "req-", limit: 10 });
    assert.ok(found.requests.length >= 1);
  });

  it("approves and creates the account immediately with the admin-selected role", async () => {
    const email = `approve-${Date.now()}@example.com`;
    const submitted = await submitAccessRequest({
      name: "Approve Me",
      email,
      company: "ApproveCo",
      requested_role: "Warehouse Manager",
      reason: "I would like warehouse manager access for receiving operations.",
    });
    const result = await reviewAccessRequest(superAdmin, submitted.id, {
      action: "approve",
      roles: ["picker"],
      notes: "Start as picker, promote later.",
    });
    assert.equal(result.request.status, "approved");
    assert.ok(result.temporary_password, "a temporary password must be returned once");
    assert.ok(result.created_user_id, "created user id must be recorded");
    assert.equal(result.created_user_id, result.request.created_user_id);
    const login = authenticateUser(email, result.temporary_password!, "127.0.0.1", "test-agent");
    assert.ok((login.user as any).id, "user must be able to sign in with the temporary password");
    const row = getDb()
      .prepare("SELECT role, active, must_change_password FROM users WHERE lower(email) = ?")
      .get(email) as { role: string; active: number; must_change_password: number };
    assert.equal(row.role, "picker", "granted role must be the admin-chosen role, not the requested one");
    assert.equal(row.active, 1);
    assert.equal(row.must_change_password, 1, "user must set their own password on first sign-in");
    const audit = getDb()
      .prepare("SELECT COUNT(*) c FROM audit_events WHERE action = 'access_request.approved' AND entity_id = ?")
      .get(submitted.id) as { c: number };
    assert.equal(audit.c, 1);
    const userCreated = getDb()
      .prepare("SELECT COUNT(*) c FROM audit_events WHERE action = 'admin.user_created_temporary' AND entity_id = ?")
      .get(result.created_user_id) as { c: number };
    assert.equal(userCreated.c, 1);
  });

  it("forbids granting super_admin through approvals", async () => {
    const email = `escalate-${Date.now()}@example.com`;
    const submitted = await submitAccessRequest({
      name: "Escalation",
      email,
      company: "EvilCo",
      requested_role: "Warehouse Manager",
      reason: "Trying to escalate to super admin access rights please.",
    });
    await assert.rejects(
      reviewAccessRequest(superAdmin, submitted.id, { action: "approve", roles: ["super_admin"] }),
      (err: any) => err.code === "PRIVILEGE_ESCALATION" && err.statusCode === 403
    );
    const row = getDb().prepare("SELECT status FROM user_access_requests WHERE id = ?").get(submitted.id) as { status: string };
    assert.equal(row.status, "pending");
  });

  it("rejects with a reason and blocks any later decision", async () => {
    const email = `reject-${Date.now()}@example.com`;
    const submitted = await submitAccessRequest({
      name: "Reject Me",
      email,
      company: "RejectCo",
      requested_role: "Driver",
      reason: "I want to test the rejection workflow end to end.",
    });
    const result = await reviewAccessRequest(superAdmin, submitted.id, {
      action: "reject",
      notes: "Not enough context — please reapply with your manager.",
    });
    assert.equal(result.request.status, "rejected");
    const userRow = getDb().prepare("SELECT id FROM users WHERE lower(email) = ?").get(email);
    assert.equal(userRow, undefined, "rejected request must never create an account");
    await assert.rejects(
      reviewAccessRequest(superAdmin, submitted.id, { action: "approve", roles: ["picker"] }),
      (err: any) => err.code === "REQUEST_ALREADY_DECIDED" && err.statusCode === 409
    );
  });

  it("supports request-info then resume back to pending", async () => {
    const email = `info-${Date.now()}@example.com`;
    const submitted = await submitAccessRequest({
      name: "Info Needed",
      email,
      company: "InfoCo",
      requested_role: "Picker",
      reason: "This request needs a bit of extra detail from my side first.",
    });
    const asked = await reviewAccessRequest(superAdmin, submitted.id, {
      action: "info",
      notes: "Which site and which shift will you work?",
    });
    assert.equal(asked.request.status, "additional_info");
    const resumed = await reviewAccessRequest(superAdmin, submitted.id, { action: "resume" });
    assert.equal(resumed.request.status, "pending");
  });
});

describe("Password reset — self service", () => {
  it("issues a token for existing accounts and resets the password (single use)", async () => {
    const email = "elena.conti@ascentra.it";
    await requestPasswordReset(email);
    const tokenRow = getDb()
      .prepare(
        `SELECT prt.token_hash FROM password_reset_tokens prt JOIN users u ON u.id = prt.user_id WHERE lower(u.email) = ? ORDER BY prt.created_at DESC LIMIT 1`
      )
      .get(email) as { token_hash: string } | undefined;
    assert.ok(tokenRow, "a reset token must be stored for an existing account");

    // Unknown emails must not leak existence
    const before = getDb().prepare("SELECT COUNT(*) c FROM password_reset_tokens").get() as { c: number };
    await requestPasswordReset(`ghost-${Date.now()}@example.invalid`);
    const after = getDb().prepare("SELECT COUNT(*) c FROM password_reset_tokens").get() as { c: number };
    assert.equal(after.c, before.c, "no token may be created for a non-existent email");

    // Simulate the token emailed to the user: insert a known token and verify it is single-use.
    const raw = crypto.randomBytes(32).toString("base64url");
    const hash = crypto.createHmac("sha256", process.env.AUTH_SECRET ?? "ascentra-erp-dev-hmac-secret-key-2026-ChangeInProd").update(`ascentra:password-reset:${raw}`).digest("hex");
    getDb().prepare(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, status, expires_at)
       VALUES ('PRT-TEST-1', (SELECT id FROM users WHERE lower(email) = ?), ?, 'pending', datetime('now', '+60 minutes'))`
    ).run(email, hash);
    const result = resetPasswordWithToken(raw, "Ascentra!2026");
    assert.equal(result.updated, true);
    const login = authenticateUser(email, "Ascentra!2026", "127.0.0.1", "test-agent");
    assert.ok((login.user as any).id);
    assert.throws(() => resetPasswordWithToken(raw, "Ascentra!2026"), (err: any) => err.code === "INVALID_TOKEN");
  });
});

after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore Windows lock
  }
});
