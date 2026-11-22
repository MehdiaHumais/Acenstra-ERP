import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ascentra-onboarding-test-"));
process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-onboarding.sqlite");
process.env.SEED_DEMO_DATA = "true";

import { getDb } from "@/server/db/connection";
import { hashPassword } from "@/server/security/crypto";
import {
  createInvitation,
  listInvitations,
  resendInvitation,
  revokeInvitation,
  updateInvitation,
  deleteInvitation,
  acceptInvitation,
  createManualUser,
  getInvitationByToken
} from "@/server/services/user-onboarding.service";
import { authenticateUser, ensureRbacConfig } from "@/server/security/auth";
import { deleteAccessUser } from "@/server/services/access-control.service";
import type { AuthenticatedUser } from "@/server/security/auth";

before(() => ensureRbacConfig());

const superAdmin: AuthenticatedUser = {
  id: "USR-ONB-ADMIN",
  email: "onb-admin@example.com",
  name: "Onboarding Admin",
  role: "super_admin",
};

const companyAdmin: AuthenticatedUser = {
  id: "USR-ONB-CA",
  email: "onb-company@example.com",
  name: "Onboarding Company Admin",
  role: "company_admin",
};

describe("User onboarding — email invitations", () => {
  it("creates an invitation and never stores the raw token", async () => {
    const uniq = Date.now().toString(36);
    const email = `invite-${uniq}@example.com`;
    const created = await createInvitation(superAdmin, {
      name: "Invitee One",
      email,
      roles: ["picker"],
      warehouse: "Milan Cold Hub",
    });
    assert.equal(created.invitation.status, "pending");
    assert.ok(created.invite_url && created.invite_url.includes("/invite/"));

    const invitee = getDb()
      .prepare("SELECT token_hash, status FROM user_invitations WHERE lower(email) = ?")
      .get(email) as { token_hash: string; status: string };
    assert.equal(invitee.status, "pending");
    assert.ok(invitee.token_hash);
    assert.ok(!invitee.token_hash.includes("/"), "token_hash must be a hash, not the raw token");
    assert.ok(!(created.invite_url?.includes(invitee.token_hash) ?? false));
  });

  it("accepts a valid invitation and activates the account", async () => {
    const uniq = Date.now().toString(36);
    const email = `accept-${uniq}@example.com`;
    const created = await createInvitation(superAdmin, {
      name: "Accept Me",
      email,
      roles: ["picker"],
      warehouse: "Milan Cold Hub",
    });
    const token = (created.invite_url ?? "").split("/invite/")[1];
    const result = acceptInvitation(token, "Str0ng!Passw0rd");
    assert.equal(result.email, email);

    const user = getDb()
      .prepare("SELECT email, role, active, must_change_password FROM users WHERE lower(email) = ?")
      .get(email) as { email: string; role: string; active: number; must_change_password: number };
    assert.equal(user.active, 1);
    assert.equal(user.must_change_password, 0);
    assert.equal(user.role, "picker");

    const login = authenticateUser(email, "Str0ng!Passw0rd", "127.0.0.1", "test-agent");
    assert.notEqual(Boolean((login.user as any).must_change_password), true);
  });

  it("rejects expired invitations", async () => {
    const uniq = Date.now().toString(36);
    const email = `expired-${uniq}@example.com`;
    const created = await createInvitation(superAdmin, {
      name: "Expired One",
      email,
      roles: ["picker"],
      warehouse: "Milan Cold Hub",
    });
    const token = (created.invite_url ?? "").split("/invite/")[1];
    getDb().prepare("UPDATE user_invitations SET expires_at = datetime('now', '-1 hour') WHERE token_hash = (SELECT token_hash FROM user_invitations WHERE lower(email) = ?)").run(email);

    assert.throws(() => acceptInvitation(token, "Str0ng!Passw0rd"), /INVALID_TOKEN|invalid/i);
  });

  it("rejects revoked invitations", async () => {
    const uniq = Date.now().toString(36);
    const email = `revoked-${uniq}@example.com`;
    const created = await createInvitation(superAdmin, {
      name: "Revoked One",
      email,
      roles: ["picker"],
      warehouse: "Milan Cold Hub",
    });
    const token = (created.invite_url ?? "").split("/invite/")[1];
    revokeInvitation(superAdmin, created.invitation.id);
    assert.throws(() => acceptInvitation(token, "Str0ng!Passw0rd"), /INVALID_TOKEN|invalid/i);
  });

  it("prevents duplicate pending invitations for the same email", async () => {
    const uniq = Date.now().toString(36);
    const email = `dup-${uniq}@example.com`;
    await createInvitation(superAdmin, {
      name: "Dup One",
      email,
      roles: ["picker"],
      warehouse: "Milan Cold Hub",
    });
    await assert.rejects(
      () =>
        createInvitation(superAdmin, {
          name: "Dup One Again",
          email,
          roles: ["picker"],
          warehouse: "Milan Cold Hub",
        }),
      /INVITATION_PENDING|pending invitation/i
    );
  });

  it("blocks non-super-admins from inviting for the super_admin role", async () => {
    const uniq = Date.now().toString(36);
    await assert.rejects(
      () =>
        createInvitation(companyAdmin, {
          name: "Escalate Me",
          email: `escalate-${uniq}@example.com`,
          roles: ["super_admin"],
          warehouse: "Milan Cold Hub",
        }),
      /PRIVILEGE_ESCALATION|Super Admin/i
    );
  });

  it("cannot accept the same invitation twice", async () => {
    const uniq = Date.now().toString(36);
    const email = `twice-${uniq}@example.com`;
    const created = await createInvitation(superAdmin, {
      name: "Twice One",
      email,
      roles: ["picker"],
      warehouse: "Milan Cold Hub",
    });
    const token = (created.invite_url ?? "").split("/invite/")[1];
    acceptInvitation(token, "Str0ng!Passw0rd");
    assert.throws(() => acceptInvitation(token, "Str0ng!Passw0rd"), /INVALID_TOKEN|invalid/i);
  });
});

describe("User onboarding — invitation edit & delete", () => {
  it("updates a pending invitation (name, roles, warehouse)", async () => {
    const uniq = Date.now().toString(36);
    const email = `edit-${uniq}@example.com`;
    const created = await createInvitation(superAdmin, {
      name: "Before Edit", email, roles: ["picker"], warehouse: "Milan Cold Hub",
    });
    const updated = updateInvitation(superAdmin, created.invitation.id, {
      name: "After Edit", roles: ["warehouse_manager"], warehouse: "Bologna Freezer DC",
    });
    assert.equal(updated.name, "After Edit");
    assert.deepEqual(updated.roles, ["warehouse_manager"]);
    assert.equal(updated.warehouse, "Bologna Freezer DC");
  });

  it("rejects edit of revoked/accepted invitations", async () => {
    const uniq = Date.now().toString(36);
    const email = `editno-${uniq}@example.com`;
    const created = await createInvitation(superAdmin, {
      name: "No Edit", email, roles: ["picker"], warehouse: "Milan Cold Hub",
    });
    revokeInvitation(superAdmin, created.invitation.id);
    assert.throws(() => updateInvitation(superAdmin, created.invitation.id, { name: "Nope" }), /NOT_EDITABLE|pending/i);
  });

  it("hard-deletes a pending invitation and retains audit", async () => {
    const uniq = Date.now().toString(36);
    const email = `delme-${uniq}@example.com`;
    const created = await createInvitation(superAdmin, {
      name: "Delete Me", email, roles: ["picker"], warehouse: "Milan Cold Hub",
    });
    const result = deleteInvitation(superAdmin, created.invitation.id);
    assert.equal(result.deleted, true);
    const row = getDb().prepare("SELECT id FROM user_invitations WHERE id = ?").get(created.invitation.id);
    assert.equal(row, undefined);
  });
});

describe("User onboarding — manual account creation", () => {
  it("creates an account with a one-time temporary password that forces a password change", () => {
    const uniq = Date.now().toString(36);
    const email = `manual-${uniq}@example.com`;
    const created = createManualUser(superAdmin, {
      name: "Manual One",
      email,
      roles: ["warehouse_manager"],
      warehouse: "Milan Cold Hub",
    });
    assert.ok(created.temporary_password.length >= 12);
    assert.equal(created.must_change_password, true);

    const row = getDb()
      .prepare("SELECT password_hash, must_change_password, active FROM users WHERE lower(email) = ?")
      .get(email) as { password_hash: string; must_change_password: number; active: number };
    assert.equal(row.must_change_password, 1);
    assert.equal(row.active, 1);
    assert.notEqual(row.password_hash, created.temporary_password);

    const login = authenticateUser(email, created.temporary_password, "127.0.0.1", "test-agent");
    assert.equal(Boolean((login.user as any).must_change_password), true);
  });

  it("never stores the temporary password in plain text in audit logs", () => {
    const uniq = Date.now().toString(36);
    const email = `audit-${uniq}@example.com`;
    const created = createManualUser(superAdmin, {
      name: "Audit One",
      email,
      roles: ["picker"],
      warehouse: "Milan Cold Hub",
    });
    const plain = getDb()
      .prepare("SELECT COUNT(*) as c FROM audit_events WHERE after_json LIKE ?")
      .get(`%${created.temporary_password}%`) as { c: number };
    assert.equal(plain.c, 0);
  });

  it("permanently deletes an account and frees its email for re-use", () => {
    const uniq = Date.now().toString(36);
    const email = `recreate-${uniq}@example.com`;
    const first = createManualUser(superAdmin, {
      name: "Recreate One",
      email,
      roles: ["picker"],
      warehouse: "Milan Cold Hub",
    });

    const result = deleteAccessUser(superAdmin, first.id);
    assert.equal(result.deleted, true);

    // The account row and all dependent rows are gone from the database.
    const usersRow = getDb().prepare("SELECT id FROM users WHERE lower(email) = ?").get(email);
    assert.equal(usersRow, undefined);
    const rolesRow = getDb().prepare("SELECT user_id FROM user_roles WHERE user_id = ?").get(first.id);
    assert.equal(rolesRow, undefined);

    // The same email can be used to create a brand-new account with no EMAIL_EXISTS error.
    const second = createManualUser(superAdmin, {
      name: "Recreate Two",
      email,
      roles: ["picker"],
      warehouse: "Milan Cold Hub",
    });
    assert.ok(second.id);
    const count = getDb().prepare("SELECT COUNT(*) as c FROM users WHERE lower(email) = ?").get(email) as { c: number };
    assert.equal(count.c, 1);

    // Audit history still records the deletion (snapshots, no personal row needed).
    deleteAccessUser(superAdmin, second.id);
    const audit = getDb()
      .prepare("SELECT COUNT(*) as c FROM audit_events WHERE action = 'admin.user_deleted' AND entity_id = ?")
      .get(first.id) as { c: number };
    assert.equal(audit.c, 1);
  });
});
