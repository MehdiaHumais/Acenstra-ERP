import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const PORT = 3012;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TEST_DB = path.join(os.tmpdir(), `ascentra-inbound-${Date.now()}.sqlite`);

let server;

test.before(async () => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.rmSync(TEST_DB + suffix, { force: true }); } catch {}
  }
  server = spawn("npm", ["run", "dev", "--", "-p", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, SQLITE_DB_PATH: TEST_DB, SEED_DEMO_DATA: "true", NODE_ENV: "production" },
    stdio: "ignore",
    shell: true
  });
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Server did not start");
});

test.after(async () => {
  if (server) server.kill();
  await new Promise((r) => setTimeout(r, 2000));
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.rmSync(TEST_DB + suffix, { force: true }); } catch {}
  }
});

async function api(path, options = {}, cookie) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, data };
}

async function login(email, password) {
  const res = await api("/api/v1/auth", {
    method: "POST",
    body: JSON.stringify({ action: "login", email, password })
  });
  assert.equal(res.status, 200);
  const cookie = res.headers.get("set-cookie").split(",")[0];
  return cookie;
}

const ADMIN_EMAIL = "elena.conti@ascentra.it";
const PASSWORD = "Ascentra!2026";

test("inbound: create shipment and expected arrival", async () => {
  const cookie = await login(ADMIN_EMAIL, PASSWORD);
  const res = await api("/api/v1/inbound/shipments", {
    method: "POST",
    body: JSON.stringify({
      supplier_name: "Nordic Fjord Seafood AS",
      supplier_id: "SUP-NOR-01",
      destination_warehouse: "Milan Cold Hub",
      items: [{ sku: "SKU-SAL-001", product_name: "Salmon", ordered_qty: 5 }]
    })
  }, cookie);
  assert.equal(res.status, 201);
  assert.ok(res.data.shipment.shipment.id);
  assert.equal(res.data.shipment.status, "expected");
});

test("inbound: arrival confirmation", async () => {
  const cookie = await login(ADMIN_EMAIL, PASSWORD);
  const create = await api("/api/v1/inbound/shipments", {
    method: "POST",
    body: JSON.stringify({ supplier_name: "Nordic Fjord Seafood AS", supplier_id: "SUP-NOR-01", destination_warehouse: "Milan Cold Hub", items: [{ sku: "SKU-SAL-001", ordered_qty: 5 }] })
  }, cookie);
  const sid = create.data.shipment.shipment.id;
  const res = await api(`/api/v1/inbound/shipments/${sid}/arrival`, { method: "POST", body: JSON.stringify({ status: "arrived", actual_arrival: new Date().toISOString() }) }, cookie);
  assert.equal(res.status, 200);
  assert.equal(res.data.shipment.status, "arrived");
  assert.ok(res.data.shipment.actual_arrival);
});

test("inbound: temperature excursion flagged", async () => {
  const cookie = await login(ADMIN_EMAIL, PASSWORD);
  const create = await api("/api/v1/inbound/shipments", {
    method: "POST",
    body: JSON.stringify({ supplier_name: "Nordic Fjord Seafood AS", supplier_id: "SUP-NOR-01", destination_warehouse: "Milan Cold Hub", items: [{ sku: "SKU-SAL-001", ordered_qty: 5 }] })
  }, cookie);
  const sid = create.data.shipment.shipment.id;
  const res = await api(`/api/v1/inbound/shipments/${sid}/temperature-logs`, {
    method: "POST",
    body: JSON.stringify({ temp_c: 10, min_c: 0, max_c: 4, unit: "C" })
  }, cookie);
  assert.equal(res.status, 201);
  assert.equal(res.data.temperature_log.excursion, true);
});

test("inbound: invalid manufacture/expiry dates rejected", async () => {
  const cookie = await login(ADMIN_EMAIL, PASSWORD);
  const create = await api("/api/v1/inbound/shipments", {
    method: "POST",
    body: JSON.stringify({ supplier_name: "Nordic Fjord Seafood AS", supplier_id: "SUP-NOR-01", destination_warehouse: "Milan Cold Hub", items: [{ sku: "SKU-SAL-001", ordered_qty: 5 }] })
  }, cookie);
  const sid = create.data.shipment.shipment.id;
  // receive with bad batch dates
  await api(`/api/v1/inbound/shipments/${sid}/arrival`, { method: "POST", body: JSON.stringify({ status: "arrived" }) }, cookie);
  const res = await api(`/api/v1/inbound/shipments/${sid}/receiving`, {
    method: "POST",
    body: JSON.stringify({ items: [{ sku: "SKU-SAL-001", ordered_qty: 5, received_qty: 5, batches: [{ supplier_batch: "SB-X", internal_lot: `LOT-BAD-${Date.now()}`, manufacture_date: "2026-12-01", expiry_date: "2026-10-01", quantity: 5, unit: "case" }] }] })
  }, cookie);
  assert.equal(res.status, 400);
  assert.equal(res.data.error.code, "INVALID_DATES");
});

test("inbound: missing batch number rejected", async () => {
  const cookie = await login(ADMIN_EMAIL, PASSWORD);
  const create = await api("/api/v1/inbound/shipments", {
    method: "POST",
    body: JSON.stringify({ supplier_name: "Nordic Fjord Seafood AS", supplier_id: "SUP-NOR-01", destination_warehouse: "Milan Cold Hub", items: [{ sku: "SKU-SAL-001", ordered_qty: 5 }] })
  }, cookie);
  const sid = create.data.shipment.shipment.id;
  await api(`/api/v1/inbound/shipments/${sid}/arrival`, { method: "POST", body: JSON.stringify({ status: "arrived" }) }, cookie);
  const res = await api(`/api/v1/inbound/shipments/${sid}/receiving`, {
    method: "POST",
    body: JSON.stringify({ items: [{ sku: "SKU-SAL-001", ordered_qty: 5, received_qty: 5, batches: [{ internal_lot: `LOT-NOBATCH-${Date.now()}`, expiry_date: "2026-12-01", quantity: 5, unit: "case" }] }] })
  }, cookie);
  assert.equal(res.status, 400);
  assert.equal(res.data.error.code, "INVALID_BATCH");
});

test("inbound: full receiving and accepted stock", async () => {
  const cookie = await login(ADMIN_EMAIL, PASSWORD);
  const create = await api("/api/v1/inbound/shipments", {
    method: "POST",
    body: JSON.stringify({ supplier_name: "Nordic Fjord Seafood AS", supplier_id: "SUP-NOR-01", destination_warehouse: "Milan Cold Hub", items: [{ sku: "SKU-SAL-001", ordered_qty: 5 }] })
  }, cookie);
  const sid = create.data.shipment.shipment.id;
  await api(`/api/v1/inbound/shipments/${sid}/arrival`, { method: "POST", body: JSON.stringify({ status: "arrived" }) }, cookie);
  const lot = `LOT-FULL-${Date.now()}`;
  const recv = await api(`/api/v1/inbound/shipments/${sid}/receiving`, {
    method: "POST",
    headers: { "Idempotency-Key": `recv-full-${sid}` },
    body: JSON.stringify({ items: [{ sku: "SKU-SAL-001", ordered_qty: 5, received_qty: 5, batches: [{ supplier_batch: "SB-FULL", internal_lot: lot, expiry_date: "2026-12-01", quantity: 5, unit: "case" }] }] })
  }, cookie);
  assert.equal(recv.status, 200);
  assert.equal(recv.data.items[0].discrepancy_status, "match");
  const detail = await api(`/api/v1/inbound/shipments/${sid}`, {}, cookie);
  const bid = detail.data.batches[0].id;
  const acc = await api(`/api/v1/inbound/shipments/${sid}/accept`, {
    method: "POST",
    headers: { "Idempotency-Key": `acc-full-${sid}` },
    body: JSON.stringify({ accepted: [{ batch_id: bid, accepted_qty: 5 }], bin: "BIN-A" })
  }, cookie);
  assert.equal(acc.status, 200);
  assert.equal(acc.data.shipment.status, "accepted");
  const lots = await api("/api/v1/inventory/lots", {}, cookie);
  const created = lots.data.find((l) => l.batch_id === lot);
  assert.ok(created);
  assert.equal(created.quality_status, "released");
  assert.equal(created.quantity_cases, 5);
});

test("inbound: partial receiving discrepancy", async () => {
  const cookie = await login(ADMIN_EMAIL, PASSWORD);
  const create = await api("/api/v1/inbound/shipments", {
    method: "POST",
    body: JSON.stringify({ supplier_name: "Nordic Fjord Seafood AS", supplier_id: "SUP-NOR-01", destination_warehouse: "Milan Cold Hub", items: [{ sku: "SKU-SAL-001", ordered_qty: 10 }] })
  }, cookie);
  const sid = create.data.shipment.shipment.id;
  await api(`/api/v1/inbound/shipments/${sid}/arrival`, { method: "POST", body: JSON.stringify({ status: "arrived" }) }, cookie);
  const recv = await api(`/api/v1/inbound/shipments/${sid}/receiving`, {
    method: "POST",
    body: JSON.stringify({ items: [{ sku: "SKU-SAL-001", ordered_qty: 10, received_qty: 7, batches: [{ supplier_batch: "SB-PART", internal_lot: `LOT-PART-${Date.now()}`, expiry_date: "2026-12-01", quantity: 7, unit: "case" }] }] })
  }, cookie);
  assert.equal(recv.status, 200);
  assert.equal(recv.data.items[0].discrepancy_status, "short");
  assert.equal(recv.data.items[0].received_qty, 7);
});

test("inbound: weight discrepancy calculation", async () => {
  const cookie = await login(ADMIN_EMAIL, PASSWORD);
  const create = await api("/api/v1/inbound/shipments", {
    method: "POST",
    body: JSON.stringify({ supplier_name: "Nordic Fjord Seafood AS", supplier_id: "SUP-NOR-01", destination_warehouse: "Milan Cold Hub", items: [{ sku: "SKU-SAL-001", ordered_qty: 5 }] })
  }, cookie);
  const sid = create.data.shipment.shipment.id;
  await api(`/api/v1/inbound/shipments/${sid}/arrival`, { method: "POST", body: JSON.stringify({ status: "arrived" }) }, cookie);
  const recv = await api(`/api/v1/inbound/shipments/${sid}/receiving`, {
    method: "POST",
    body: JSON.stringify({ items: [{ sku: "SKU-SAL-001", ordered_qty: 5, received_qty: 5, actual_weight: 97.5, expected_weight: 100, weight_uom: "kg", weight_tolerance_pct: 5, batches: [{ supplier_batch: "SB-W", internal_lot: `LOT-W-${Date.now()}`, expiry_date: "2026-12-01", quantity: 5, unit: "case" }] }] })
  }, cookie);
  assert.equal(recv.status, 200);
  const item = recv.data.items[0];
  assert.equal(item.weight_discrepancy_status, "within_tolerance");
  assert.ok(Math.abs(item.weight_variance_pct + 2.5) < 0.01);
});

test("inbound: missing certificate derived", async () => {
  const cookie = await login(ADMIN_EMAIL, PASSWORD);
  const create = await api("/api/v1/inbound/shipments", {
    method: "POST",
    body: JSON.stringify({ supplier_name: "Nordic Fjord Seafood AS", supplier_id: "SUP-NOR-01", destination_warehouse: "Milan Cold Hub", items: [{ sku: "SKU-SAL-001", ordered_qty: 5 }] })
  }, cookie);
  const sid = create.data.shipment.shipment.id;
  const detail = await api(`/api/v1/inbound/shipments/${sid}`, {}, cookie);
  assert.equal(detail.data.documents.length, 0);
});

test("inbound: document upload does not equal verification", async () => {
  const cookie = await login(ADMIN_EMAIL, PASSWORD);
  const create = await api("/api/v1/inbound/shipments", {
    method: "POST",
    body: JSON.stringify({ supplier_name: "Nordic Fjord Seafood AS", supplier_id: "SUP-NOR-01", destination_warehouse: "Milan Cold Hub", items: [{ sku: "SKU-SAL-001", ordered_qty: 5 }] })
  }, cookie);
  const sid = create.data.shipment.shipment.id;
  const b64 = Buffer.from("cert").toString("base64");
  const up = await api(`/api/v1/inbound/shipments/${sid}/documents`, {
    method: "POST",
    body: JSON.stringify({ doc_type: "coa", file_name: "coa.pdf", mime_type: "application/pdf", content_base64: b64 })
  }, cookie);
  assert.equal(up.status, 201);
  assert.equal(up.data.document.status, "pending_review");
});

test("inbound: expired certificate rejected on verify", async () => {
  const cookie = await login(ADMIN_EMAIL, PASSWORD);
  const create = await api("/api/v1/inbound/shipments", {
    method: "POST",
    body: JSON.stringify({ supplier_name: "Nordic Fjord Seafood AS", supplier_id: "SUP-NOR-01", destination_warehouse: "Milan Cold Hub", items: [{ sku: "SKU-SAL-001", ordered_qty: 5 }] })
  }, cookie);
  const sid = create.data.shipment.shipment.id;
  const b64 = Buffer.from("cert").toString("base64");
  const up = await api(`/api/v1/inbound/shipments/${sid}/documents`, {
    method: "POST",
    body: JSON.stringify({ doc_type: "coa", file_name: "coa.pdf", mime_type: "application/pdf", content_base64: b64, expiry_date: "2020-01-01" })
  }, cookie);
  const docId = up.data.document.id;
  const vr = await api(`/api/v1/inbound/shipments/${sid}/documents/${docId}/verify`, {
    method: "POST",
    body: JSON.stringify({ status: "expired", review_notes: "expired" })
  }, cookie);
  assert.equal(vr.status, 200);
  assert.equal(vr.data.document.status, "expired");
});

test("inbound: quality approval and rejection", async () => {
  const cookie = await login(ADMIN_EMAIL, PASSWORD);
  const create = await api("/api/v1/inbound/shipments", {
    method: "POST",
    body: JSON.stringify({ supplier_name: "Nordic Fjord Seafood AS", supplier_id: "SUP-NOR-01", destination_warehouse: "Milan Cold Hub", items: [{ sku: "SKU-SAL-001", ordered_qty: 5 }] })
  }, cookie);
  const sid = create.data.shipment.shipment.id;
  const qc = await api(`/api/v1/inbound/shipments/${sid}/quality-checks`, {
    method: "POST",
    body: JSON.stringify({ check_type: "visual", result: "fail", notes: "bad" })
  }, cookie);
  assert.equal(qc.status, 201);
  assert.equal(qc.data.quality_check.result, "fail");
});

test("inbound: quarantine prevents normal availability", async () => {
  const cookie = await login(ADMIN_EMAIL, PASSWORD);
  const create = await api("/api/v1/inbound/shipments", {
    method: "POST",
    body: JSON.stringify({ supplier_name: "Nordic Fjord Seafood AS", supplier_id: "SUP-NOR-01", destination_warehouse: "Milan Cold Hub", items: [{ sku: "SKU-SAL-001", ordered_qty: 5 }] })
  }, cookie);
  const sid = create.data.shipment.shipment.id;
  await api(`/api/v1/inbound/shipments/${sid}/arrival`, { method: "POST", body: JSON.stringify({ status: "arrived" }) }, cookie);
  const lot = `LOT-QUAR-${Date.now()}`;
  await api(`/api/v1/inbound/shipments/${sid}/receiving`, {
    method: "POST",
    body: JSON.stringify({ items: [{ sku: "SKU-SAL-001", ordered_qty: 5, received_qty: 5, batches: [{ supplier_batch: "SB-Q", internal_lot: lot, expiry_date: "2026-12-01", quantity: 5, unit: "case" }] }] })
  }, cookie);
  const q = await api(`/api/v1/inbound/shipments/${sid}/quarantine`, {
    method: "POST",
    headers: { "Idempotency-Key": `quar-${sid}` },
    body: JSON.stringify({ reason: "suspect", bin: "Quarantine" })
  }, cookie);
  assert.equal(q.status, 200);
  assert.equal(q.data.shipment.status, "quarantined");
  const lots = await api("/api/v1/inventory/lots", {}, cookie);
  const created = lots.data.find((l) => l.batch_id === lot);
  assert.ok(created);
  assert.equal(created.quality_status, "quarantine");
});

test("inbound: duplicate receiving safety", async () => {
  const cookie = await login(ADMIN_EMAIL, PASSWORD);
  const create = await api("/api/v1/inbound/shipments", {
    method: "POST",
    body: JSON.stringify({ supplier_name: "Nordic Fjord Seafood AS", supplier_id: "SUP-NOR-01", destination_warehouse: "Milan Cold Hub", items: [{ sku: "SKU-SAL-001", ordered_qty: 5 }] })
  }, cookie);
  const sid = create.data.shipment.shipment.id;
  await api(`/api/v1/inbound/shipments/${sid}/arrival`, { method: "POST", body: JSON.stringify({ status: "arrived" }) }, cookie);
  const key = `dup-${sid}`;
  const body = { items: [{ sku: "SKU-SAL-001", ordered_qty: 5, received_qty: 5, batches: [{ supplier_batch: "SB-DUP", internal_lot: `LOT-DUP-${Date.now()}`, expiry_date: "2026-12-01", quantity: 5, unit: "case" }] }] };
  const first = await api(`/api/v1/inbound/shipments/${sid}/receiving`, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(body) }, cookie);
  assert.equal(first.status, 200);
  const second = await api(`/api/v1/inbound/shipments/${sid}/receiving`, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(body) }, cookie);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("x-idempotent-replay"), "true");
});

test("inbound: unauthorized warehouse access", async () => {
  const cookie = await login("pietro.rossi@ascentra.it", PASSWORD);
  const res = await api("/api/v1/inbound/shipments", {
    method: "POST",
    body: JSON.stringify({ supplier_name: "Nordic Fjord Seafood AS", supplier_id: "SUP-NOR-01", destination_warehouse: "Rome Hub", items: [{ sku: "SKU-SAL-001", ordered_qty: 5 }] })
  }, cookie);
  // picker lacks inbound.manage; should be 403
  assert.equal(res.status, 403);
});

test("inbound: unauthorized acceptance", async () => {
  const adminCookie = await login(ADMIN_EMAIL, PASSWORD);
  const create = await api("/api/v1/inbound/shipments", {
    method: "POST",
    body: JSON.stringify({ supplier_name: "Nordic Fjord Seafood AS", supplier_id: "SUP-NOR-01", destination_warehouse: "Milan Cold Hub", items: [{ sku: "SKU-SAL-001", ordered_qty: 5 }] })
  }, adminCookie);
  const sid = create.data.shipment.shipment.id;
  await api(`/api/v1/inbound/shipments/${sid}/arrival`, { method: "POST", body: JSON.stringify({ status: "arrived" }) }, adminCookie);
  await api(`/api/v1/inbound/shipments/${sid}/receiving`, {
    method: "POST",
    body: JSON.stringify({ items: [{ sku: "SKU-SAL-001", ordered_qty: 5, received_qty: 5, batches: [{ supplier_batch: "SB-A", internal_lot: `LOT-A-${Date.now()}`, expiry_date: "2026-12-01", quantity: 5, unit: "case" }] }] })
  }, adminCookie);
  const pickerCookie = await login("pietro.rossi@ascentra.it", PASSWORD);
  const res = await api(`/api/v1/inbound/shipments/${sid}/accept`, {
    method: "POST",
    body: JSON.stringify({ accepted: [], bin: "BIN-A" })
  }, pickerCookie);
  assert.equal(res.status, 403);
});

test("inbound: audit event generated", async () => {
  const cookie = await login(ADMIN_EMAIL, PASSWORD);
  const create = await api("/api/v1/inbound/shipments", {
    method: "POST",
    body: JSON.stringify({ supplier_name: "Nordic Fjord Seafood AS", supplier_id: "SUP-NOR-01", destination_warehouse: "Milan Cold Hub", items: [{ sku: "SKU-SAL-001", ordered_qty: 5 }] })
  }, cookie);
  const sid = create.data.shipment.shipment.id;
  const hist = await api(`/api/v1/inbound/shipments/${sid}/history`, {}, cookie);
  assert.equal(hist.status, 200);
  assert.ok(Array.isArray(hist.data.history));
  assert.ok(hist.data.history.length > 0);
});

test("inbound: lot traceability after receiving", async () => {
  const cookie = await login(ADMIN_EMAIL, PASSWORD);
  const create = await api("/api/v1/inbound/shipments", {
    method: "POST",
    body: JSON.stringify({ supplier_name: "Nordic Fjord Seafood AS", supplier_id: "SUP-NOR-01", destination_warehouse: "Milan Cold Hub", items: [{ sku: "SKU-SAL-001", ordered_qty: 5 }] })
  }, cookie);
  const sid = create.data.shipment.shipment.id;
  await api(`/api/v1/inbound/shipments/${sid}/arrival`, { method: "POST", body: JSON.stringify({ status: "arrived" }) }, cookie);
  const lot = `LOT-TRACE-${Date.now()}`;
  await api(`/api/v1/inbound/shipments/${sid}/receiving`, {
    method: "POST",
    body: JSON.stringify({ items: [{ sku: "SKU-SAL-001", ordered_qty: 5, received_qty: 5, batches: [{ supplier_batch: "SB-TRACE", internal_lot: lot, manufacture_date: "2026-10-01", expiry_date: "2026-12-01", quantity: 5, unit: "case", origin: "Norway" }] }] })
  }, cookie);
  const detail = await api(`/api/v1/inbound/shipments/${sid}`, {}, cookie);
  const batch = detail.data.batches.find((b) => b.internal_lot === lot);
  assert.ok(batch);
  assert.equal(batch.manufacture_date, "2026-10-01");
  assert.equal(batch.origin, "Norway");
});
