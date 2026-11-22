import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextRequest } from "next/server";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ascentra-order-workflow-test-"));
process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-order-workflow.sqlite");
process.env.SEED_DEMO_DATA = "true";

import { getDb } from "@/server/db/connection";
import { signAccessToken } from "@/server/security/crypto";
import { AuthenticatedUser } from "@/server/security/auth";
import {
  amendCustomerOrder,
  cancelCustomerOrder,
  getCustomerOrder,
  listCustomerNotifications,
  listCustomerOrderDocuments,
  listCustomerOrderEvents,
  markCustomerNotificationRead,
  renderCustomerOrderDocument,
  submitCustomerOrder,
  transitionCustomerOrderStatus
} from "@/server/services/customer-order.service";

import { GET as getOrderDocument } from "@/app/api/v1/customer-portal/orders/[id]/documents/route";
import { GET as getNotifications } from "@/app/api/v1/customer-portal/notifications/route";

function addDaysIso(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function makeReq(urlPath: string, token: string): NextRequest {
  const headers = new Headers();
  headers.set("authorization", `Bearer ${token}`);
  return new NextRequest(`http://127.0.0.1:3000${urlPath}`, { headers });
}

function tokenFor(identity: AuthenticatedUser): string {
  return signAccessToken({
    sub: identity.id,
    email: identity.email,
    name: identity.name,
    role: identity.role,
    store_id: identity.store_id ?? null,
    warehouse: identity.warehouse ?? null
  });
}

describe("Module 07 — amendments, status transitions, timeline, notifications and documents", () => {
  const admin: AuthenticatedUser = {
    id: "USR-ADMIN",
    email: "elena.conti@ascentra.it",
    name: "Elena Conti",
    role: "super_admin",
    roles: ["super_admin"],
    store_id: null,
    warehouse: "Milan Cold Hub",
    mfa_enabled: false
  };

  const vendorA: AuthenticatedUser = {
    id: "USR-CUST-CRACCO",
    email: "carlo@ristorantecracco.it",
    name: "Carlo Cracco",
    role: "store_vendor",
    roles: ["store_vendor"],
    store_id: "CUST-B2B-01",
    warehouse: "Milan Cold Hub",
    mfa_enabled: false
  };

  const vendorB: AuthenticatedUser = {
    id: "USR-CUST-SAVOIA",
    email: "fnb@hotelprincipedisavoia.it",
    name: "Hotel Savoia F&B",
    role: "store_vendor",
    roles: ["store_vendor"],
    store_id: "CUST-B2B-02",
    warehouse: "Milan Cold Hub",
    mfa_enabled: false
  };

  const sales: AuthenticatedUser = {
    id: "USR-SALES",
    email: "sofia.greco@ascentra.it",
    name: "Sofia Greco",
    role: "sales",
    roles: ["sales"],
    store_id: null,
    warehouse: "Milan Cold Hub",
    mfa_enabled: false
  };

  let primaryOrderId = "";

  before(() => {
    const db = getDb();
    // Guarantee enough headroom for the stock-shortfall test.
    db.prepare("UPDATE customers SET credit_limit_cents = 100000000 WHERE id = 'CUST-B2B-01'").run();
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore Windows cleanup races
    }
  });

  it("1. submits a confirmed order and records the submission timeline + notification", () => {
    const order = submitCustomerOrder(admin, {
      customer_id: "CUST-B2B-01",
      delivery_date: addDaysIso(1),
      po_reference: "PO-WF-001",
      lines: [{ sku: "SKU-SAL-001", cases: 2 }]
    });

    primaryOrderId = order.id;
    assert.equal(order.status, "confirmed");
    assert.equal(order.lines.length, 1);
    assert.ok(["promotion", "contract_tier", "contract_base", "segment", "standard"].includes(order.lines[0].pricing_source));

    const detail = getCustomerOrder(admin, order.id);
    assert.ok(detail.events && detail.events.length >= 1);
    assert.equal(detail.events![0].event_type, "submitted");
    assert.equal(detail.events![0].to_status, "confirmed");
    assert.ok(detail.notifications && detail.notifications.length >= 1);
    assert.equal(detail.notifications![0].category, "order_confirmation");
  });

  it("2. amends an order, re-prices lines, updates totals and emits an amendment event", () => {
    const before = getCustomerOrder(admin, primaryOrderId);
    const amended = amendCustomerOrder(sales, primaryOrderId, {
      delivery_date: addDaysIso(1),
      delivery_notes: "Deliver to the service entrance",
      lines: [
        { sku: "SKU-SAL-001", cases: 4 },
        { sku: "SKU-BFL-009", cases: 2 }
      ]
    });

    assert.equal(amended.status, "confirmed");
    assert.equal(amended.delivery_date, addDaysIso(1));
    assert.equal(amended.lines.length, 2);
    assert.notEqual(amended.total_cents, before.total_cents);
    assert.equal(
      amended.total_cents,
      amended.lines.reduce((sum, line) => sum + line.line_total_cents, 0),
      "Order total must equal the sum of immutable line snapshots"
    );

    const events = listCustomerOrderEvents(admin, primaryOrderId);
    const amendmentEvent = events.find((event) => event.event_type === "amended");
    assert.ok(amendmentEvent);
    assert.equal(amendmentEvent!.from_status, "confirmed");
    assert.equal(amendmentEvent!.to_status, "confirmed");
    assert.equal(amendmentEvent!.actor_email, sales.email);

    const notifications = listCustomerNotifications(admin, { customer_id: "CUST-B2B-01", limit: 50 });
    assert.ok(notifications.notifications.some((n) => n.category === "order_amendment"));
  });

  it("3. blocks cross-store amendments and limits vendors without orders.amend", () => {
    assert.throws(
      () => amendCustomerOrder(vendorB, primaryOrderId, { lines: [{ sku: "SKU-SAL-001", cases: 1 }] }),
      (err: any) => err.code === "FORBIDDEN_RECORD_ACCESS"
    );

    // Vendor A owns the order but a confirmed order requires orders.amend.
    assert.throws(
      () => amendCustomerOrder(vendorA, primaryOrderId, { lines: [{ sku: "SKU-SAL-001", cases: 1 }] }),
      (err: any) => err.code === "AMENDMENT_NOT_AUTHORIZED"
    );
  });

  it("4. validates and persists fulfilment status transitions", () => {
    const processing = transitionCustomerOrderStatus(sales, primaryOrderId, {
      to_status: "processing",
      reason: "Picking started"
    });
    assert.equal(processing.status, "processing");

    const completed = transitionCustomerOrderStatus(sales, primaryOrderId, {
      to_status: "completed",
      reason: "Delivered and POD signed"
    });
    assert.equal(completed.status, "completed");
    assert.ok(completed.lines.every((line) => line.line_status === "fulfilled"));

    assert.throws(
      () => transitionCustomerOrderStatus(sales, primaryOrderId, { to_status: "processing" }),
      (err: any) => err.code === "INVALID_STATUS_TRANSITION"
    );

    const eventTypes = listCustomerOrderEvents(admin, primaryOrderId).map((event) => event.event_type);
    assert.ok(eventTypes.filter((type) => type === "status_changed").length >= 2);
  });

  it("5. refuses to confirm an order the warehouse cannot fully satisfy", () => {
    const backordered = submitCustomerOrder(admin, {
      customer_id: "CUST-B2B-01",
      delivery_date: addDaysIso(6),
      allow_backorders: true,
      lines: [{ sku: "SKU-SAL-001", cases: 400 }]
    });
    assert.equal(backordered.status, "partially_confirmed");
    assert.ok(backordered.lines[0].cases_backordered > 0);

    assert.throws(
      () => transitionCustomerOrderStatus(sales, backordered.id, { to_status: "confirmed" }),
      (err: any) => err.code === "STOCK_NOT_AVAILABLE"
    );

    const stillPartial = getCustomerOrder(admin, backordered.id);
    assert.equal(stillPartial.status, "partially_confirmed");
  });

  it("6. enforces terminal cancellation and records the cancellation event", () => {
    const order = submitCustomerOrder(admin, {
      customer_id: "CUST-B2B-01",
      delivery_date: addDaysIso(1),
      lines: [{ sku: "SKU-BFL-009", cases: 1 }]
    });
    assert.equal(order.status, "confirmed");

    const cancelled = cancelCustomerOrder(admin, order.id, "Customer changed menu");
    assert.equal(cancelled.status, "cancelled");

    assert.throws(
      () => transitionCustomerOrderStatus(sales, order.id, { to_status: "processing" }),
      (err: any) => err.code === "INVALID_STATUS_TRANSITION"
    );

    const events = listCustomerOrderEvents(admin, order.id);
    assert.ok(events.some((event) => event.event_type === "cancelled"));
  });

  it("7. scopes notifications per customer and supports read receipts", () => {
    const vendorAList = listCustomerNotifications(vendorA, { limit: 100 });
    assert.ok(vendorAList.total >= 1);
    assert.ok(vendorAList.notifications.every((n) => n.customer_id === "CUST-B2B-01"));

    // Passing another customer's ID must never widen a vendor's view.
    const forced = listCustomerNotifications(vendorA, {
      customer_id: "CUST-B2B-02",
      limit: 100
    });
    assert.ok(forced.notifications.every((n) => n.customer_id === "CUST-B2B-01"));

    const vendorBList = listCustomerNotifications(vendorB, { limit: 100 });
    assert.ok(vendorBList.notifications.every((n) => n.customer_id === "CUST-B2B-02"));

    const target = vendorAList.notifications[0];
    assert.throws(
      () => markCustomerNotificationRead(vendorB, target.id),
      (err: any) => err.code === "FORBIDDEN_RECORD_ACCESS"
    );

    const read = markCustomerNotificationRead(vendorA, target.id);
    assert.ok(read.read_at);
    assert.equal(read.status, "read");
  });

  it("8. exposes documents with immutable price snapshots and blocks cross-customer access", () => {
    const documents = listCustomerOrderDocuments(admin, primaryOrderId);
    assert.ok(documents.some((doc) => doc.type === "confirmation"));

    const rendered = renderCustomerOrderDocument(admin, primaryOrderId, "confirmation");
    assert.equal(rendered.content_type, "text/html; charset=utf-8");
    assert.match(rendered.html, /Order Confirmation/);
    assert.match(rendered.html, /SKU-SAL-001/);
    assert.match(rendered.html, /Line prices are immutable snapshots/);
    assert.ok(rendered.filename.endsWith(".html"));

    assert.throws(
      () => renderCustomerOrderDocument(vendorB, primaryOrderId, "confirmation"),
      (err: any) => err.code === "FORBIDDEN_RECORD_ACCESS"
    );

    const draftLike = submitCustomerOrder(admin, {
      customer_id: "CUST-B2B-01",
      delivery_date: addDaysIso(1),
      lines: [{ sku: "SKU-BFL-009", cases: 1 }]
    });
    // A newly submitted order is confirmed, but documents must still resolve.
    assert.ok(listCustomerOrderDocuments(admin, draftLike.id).length >= 1);

    assert.throws(
      () => listCustomerOrderEvents(vendorB, primaryOrderId),
      (err: any) => err.code === "FORBIDDEN_RECORD_ACCESS"
    );
  });

  it("9. serves HTML documents and scoped notifications through the real API routes", async () => {
    const adminToken = tokenFor(admin);
    const vendorAToken = tokenFor(vendorA);
    const vendorBToken = tokenFor(vendorB);

    const htmlResponse = await getOrderDocument(
      makeReq(`/api/v1/customer-portal/orders/${primaryOrderId}/documents?type=confirmation&format=html`, adminToken),
      { params: { id: primaryOrderId } }
    );
    assert.equal(htmlResponse.status, 200);
    assert.match(htmlResponse.headers.get("content-type") || "", /text\/html/);
    const html = await htmlResponse.text();
    assert.match(html, /Ascentra Global Ltd/);

    const listResponse = await getOrderDocument(
      makeReq(`/api/v1/customer-portal/orders/${primaryOrderId}/documents`, adminToken),
      { params: { id: primaryOrderId } }
    );
    assert.equal(listResponse.status, 200);
    const listBody = await listResponse.json();
    assert.ok(Array.isArray(listBody.documents) && listBody.documents.length >= 1);

    const denied = await getOrderDocument(
      makeReq(`/api/v1/customer-portal/orders/${primaryOrderId}/documents?type=confirmation`, vendorBToken),
      { params: { id: primaryOrderId } }
    );
    assert.equal(denied.status, 403);

    const vendorNotifications = await getNotifications(
      makeReq("/api/v1/customer-portal/notifications?customer_id=CUST-B2B-01", vendorAToken)
    );
    assert.equal(vendorNotifications.status, 200);
    const vendorBody = await vendorNotifications.json();
    assert.ok(vendorBody.notifications.every((n: any) => n.customer_id === "CUST-B2B-01"));
  });
});
