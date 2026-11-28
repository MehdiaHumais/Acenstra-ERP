import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ascentra-mail-diag-"));
process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-mail-diag.sqlite");
process.env.SEED_DEMO_DATA = "true";

// A deliberately unreachable local SMTP server. Nothing leaves this machine.
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = "1";
process.env.SMTP_USER = "probe-user@example.local";
process.env.SMTP_PASS = "probe-secret-must-never-leak";
process.env.SMTP_SECURE = "starttls";
process.env.SMTP_FROM_EMAIL = "probe-from@example.local";

import { GET as getHealth } from "@/app/health/route";
import { classifyMailError } from "@/server/services/mail.service";
import { createInvitation } from "@/server/services/user-onboarding.service";
import { ensureRbacConfig, type AuthenticatedUser } from "@/server/security/auth";

const admin: AuthenticatedUser = {
  id: "USR-MAIL-DIAG-ADMIN",
  email: "mail-diag-admin@example.local",
  name: "Mail Diagnostics Admin",
  role: "super_admin",
};

after(() => {
  // SQLite keeps the file handle open on Windows; best-effort cleanup only.
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Ignore — the OS removes temp directories eventually.
  }
});

describe("SMTP failure diagnostics", () => {
  it("classifies common SMTP failures into actionable hints", () => {
    assert.equal(classifyMailError("535 Invalid login: username and password").code, "smtp_auth_failed");
    assert.equal(classifyMailError("connect ECONNREFUSED 10.0.0.5:587").code, "smtp_unreachable");
    assert.equal(classifyMailError("self signed certificate").code, "smtp_tls_error");
    assert.equal(classifyMailError("550 mailbox unavailable").code, "smtp_recipient_rejected");
    assert.equal(classifyMailError("").code, "smtp_unknown_error");
  });

  it("never echoes raw SMTP text, hosts, usernames or passwords to clients", () => {
    const raw = "535 Invalid login for probe-user@example.local on secret-host.internal using probe-secret-must-never-leak";
    const failure = classifyMailError(raw);
    const serialized = JSON.stringify(failure);
    for (const secret of [
      "probe-user@example.local",
      "secret-host.internal",
      "probe-secret-must-never-leak",
      "535 Invalid login for",
    ]) {
      assert.equal(serialized.includes(secret), false, `leaked: ${secret}`);
    }
  });

  it("exposes only a presence flag for SMTP in the public health response", async () => {
    const res = await getHealth();
    const body = (await res.json()) as { email?: { smtp_configured?: boolean } };
    assert.equal(res.status, 200);
    assert.equal(body.email?.smtp_configured, true);
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes("probe-user@example.local"), false);
    assert.equal(serialized.includes("probe-secret-must-never-leak"), false);
  });

  it("returns a sanitized failure reason from createInvitation when SMTP is down", async () => {
    ensureRbacConfig();
    const result = await createInvitation(admin, {
      name: "Diagnostics Invitee",
      email: `mail-diag-${Date.now()}@example.local`,
      roles: ["picker"],
      warehouse: "Milan Cold Hub",
    });

    assert.equal(result.email_delivery, "send_failed");
    assert.ok(result.email_error);
    assert.equal(result.email_error?.code, "smtp_unreachable");
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("probe-secret-must-never-leak"), false);
    assert.equal(serialized.includes("probe-user@example.local"), false);
  });
});
