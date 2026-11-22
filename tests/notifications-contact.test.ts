import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ascentra-notifications-"));
process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-notifications.sqlite");
process.env.SEED_DEMO_DATA = "true";

import { getDb } from "@/server/db/connection";
import {
  listMyNotifications,
  markNotificationsRead,
  notifyUsersWithPermission,
} from "@/server/services/notification.service";
import {
  createContactMessage,
  listAllContactMessages,
  listMyContactMessages,
  replyToContactMessage,
} from "@/server/services/contact-message.service";
import { submitAccessRequest } from "@/server/services/access-request.service";
import { ensureRbacConfig, authenticateUser } from "@/server/security/auth";
import type { AuthenticatedUser } from "@/server/security/auth";

before(() => ensureRbacConfig());

const admin: AuthenticatedUser = {
  id: "USR-ADMIN",
  email: "elena.conti@ascentra.it",
  name: "Elena Conti",
  role: "super_admin",
  roles: ["super_admin"],
};

const picker: AuthenticatedUser = {
  id: "USR-PICK",
  email: "pietro.rossi@ascentra.it",
  name: "Pietro Rossi",
  role: "picker",
  roles: ["picker"],
};

describe("notifications — scoped fanout", () => {
  it("reaches users with users.manage, excludes plain staff", () => {
    const target = `NTF-${Date.now()}`;
    const delivered = notifyUsersWithPermission("users.manage", {
      module: "TEST",
      title: target,
      detail: "scoped test",
      href: "/admin",
      severity: "info",
    });
    assert.ok(delivered >= 1, "at least one admin must be notified");
    const adminRows = getDb()
      .prepare("SELECT COUNT(*) as c FROM notifications WHERE title = ?")
      .get(target) as { c: number };
    assert.equal(adminRows.c, delivered);
    const pickerRows = getDb()
      .prepare("SELECT user_id FROM notifications WHERE title = ? AND user_id = ?")
      .get(target, picker.id);
    assert.equal(pickerRows, undefined, "picker must NOT receive admin notifications");
  });

  it("lists + marks notifications read for the current user", () => {
    const mineBefore = listMyNotifications(admin).unread_count;
    notifyUsersWithPermission("users.manage", {
      module: "TEST",
      title: `NTF-READ-${Date.now()}`,
      detail: "mark me read",
      severity: "info",
    });
    const mine = listMyNotifications(admin);
    assert.ok(mine.unread_count >= mineBefore + 1);
    const changed = markNotificationsRead(admin);
    assert.ok(changed >= 1);
    assert.equal(listMyNotifications(admin).unread_count, 0);
  });
});

describe("contact messages — sender ↔ administrator", () => {
  it("lets a signed-in user message an administrator, who replies in-app", async () => {
    const { id } = createContactMessage(picker, {
      subject: "Request access change",
      message: "I need bin location access for the Milan Cold Hub, please.",
    });
    const list = listAllContactMessages(admin, { limit: 10 });
    assert.equal(list.counts.new >= 1, true);
    const mine = listMyContactMessages(picker);
    assert.ok(mine.some((m) => m.id === id));

    const updated = await replyToContactMessage(admin, id, {
      reply: "Granted — bin locations are now visible in your pick queue.",
    });
    assert.equal(updated.status, "replied");
    assert.equal(updated.admin_reply, "Granted — bin locations are now visible in your pick queue.");

    const sender = listMyContactMessages(picker).find((m) => m.id === id);
    assert.equal(sender?.status, "replied");
    assert.equal(sender?.admin_reply, updated.admin_reply);

    // Sender got an in-app notification about the reply
    const senderNotifications = listMyNotifications(picker);
    assert.ok(
      senderNotifications.notifications.some(
        (n) => n.module === "Messages" && n.title.includes("Request access change")
      ),
      "sender must receive an in-app notification about the admin's reply"
    );
  });
});

describe("access requests — account already exists", () => {
  it("rejects submissions for emails that already have accounts", async () => {
    await assert.rejects(
      submitAccessRequest({
        name: "Elena Conti",
        email: "elena.conti@ascentra.it",
        company: "AnyCo",
        requested_role: "Picker",
        reason: "Trying to request an account that is already mine.",
      }),
      (err: any) => err.code === "EMAIL_EXISTS" && err.statusCode === 409
    );
  });
});

after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore Windows lock
  }
});
