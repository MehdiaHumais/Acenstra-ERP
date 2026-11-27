import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * End-to-end backend tests.
 *
 * By default this file boots its own Next.js server on a temporary SQLite
 * database seeded with the demo dataset, so it is self-contained and never
 * mutates `data/ascentra-erp.sqlite`.
 *
 * To run against an already running instance instead, set TEST_BASE_URL.
 * That instance must have been started with SEED_DEMO_DATA=true, because the
 * workflow assertions rely on the seeded demo records (orders, tasks, lots).
 */

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_PORT = Number(process.env.E2E_PORT || 3117);
const DEMO_PASSWORD = "Ascentra!2026";

const demoUsers = {
  admin: "elena.conti@ascentra.it",
  warehouseManager: "marco.bellini@ascentra.it",
  driver: "davide.galli@ascentra.it",
  finance: "matteo.ricci@ascentra.it",
  sales: "sofia.greco@ascentra.it",
  storeVendor: "chiara.moretti@store-navigli.it"
};

let BASE_URL = process.env.TEST_BASE_URL || "";
let child = null;
let tempDir = null;
let serverOutput = "";
const sessions = {};

class Session {
  constructor() {
    this.cookies = new Map();
  }

  absorb(res) {
    const setCookies =
      typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const entry of setCookies) {
      const pair = entry.split(";")[0];
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === "" || /max-age=0/i.test(entry)) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  header() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

function attachChildLogs(stream, label) {
  stream?.on("data", (chunk) => {
    serverOutput += chunk.toString();
    if (serverOutput.length > 200_000) serverOutput = serverOutput.slice(-200_000);
    if (process.env.E2E_VERBOSE === "1") process.stdout.write(`[${label}] ${chunk}`);
  });
}

async function waitForServer(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(
        `Test server exited early with code ${child.exitCode}.\n${serverOutput}`
      );
    }
    try {
      const res = await fetch(`${BASE_URL}/health`);
      const text = await res.text();
      if (res.ok && text.trim().startsWith("{")) {
        const payload = JSON.parse(text);
        if (payload.status === "ok") return;
      }
      lastError = `HTTP ${res.status}: ${text.slice(0, 200)}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    `Server at ${BASE_URL} did not become healthy within ${timeoutMs}ms (last: ${lastError}).\n${serverOutput}`
  );
}

async function startServer() {
  const buildId = path.join(PROJECT_ROOT, ".next", "BUILD_ID");
  const useProduction = fs.existsSync(buildId) && process.env.E2E_DEV !== "1";
  const port = DEFAULT_PORT;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ascentra-e2e-"));
  const dbPath = path.join(tempDir, "e2e.sqlite");
  BASE_URL = `http://127.0.0.1:${port}`;

  const nextBin = path.join(PROJECT_ROOT, "node_modules", "next", "dist", "bin", "next");
  const args = useProduction
    ? [nextBin, "start", "-p", String(port)]
    : [nextBin, "dev", "-p", String(port)];

  child = spawn(process.execPath, args, {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      NODE_ENV: useProduction ? "production" : "development",
      SQLITE_DB_PATH: dbPath,
      DB_ENGINE: "sqlite",
      SEED_DEMO_DATA: "true",
      NEXT_TELEMETRY_DISABLED: "1",
      PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  attachChildLogs(child.stdout, "e2e-server");
  attachChildLogs(child.stderr, "e2e-server");
  return useProduction;
}

async function stopServer() {
  if (child && child.exitCode === null && child.pid) {
    if (process.platform === "win32") {
      await new Promise((resolve) => {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true
        });
        killer.on("exit", resolve);
        killer.on("error", resolve);
      });
    } else {
      child.kill("SIGTERM");
    }
  }
  child = null;
  if (tempDir) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
    tempDir = null;
  }
}

async function api(requestPath, options = {}, session = null) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (session && !headers.Cookie && !headers.cookie) {
    const cookie = session.header();
    if (cookie) headers.Cookie = cookie;
  }
  const res = await fetch(`${BASE_URL}${requestPath}`, {
    ...options,
    headers
  });
  if (session) session.absorb(res);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (res.status >= 500) {
    console.error(`[API 500] ${options.method || "GET"} ${requestPath}:`, text.slice(0, 500));
  }
  return { status: res.status, headers: res.headers, data, text };
}

async function login(email) {
  const session = new Session();
  const res = await api(
    "/api/v1/auth",
    {
      method: "POST",
      body: JSON.stringify({ action: "login", email, password: DEMO_PASSWORD })
    },
    session
  );
  assert.equal(res.status, 200, `Login failed for ${email}: ${res.text}`);
  assert.ok(res.data?.token, `Login returned no token for ${email}`);
  assert.equal(res.data.authenticated, true, `Login was not authenticated for ${email}`);
  return { session, user: res.data.user, data: res.data };
}

test.before(async () => {
  if (BASE_URL) {
    // External server: trust it is seeded, but verify it is healthy.
    await waitForServer();
  } else {
    const production = await startServer();
    if (!production) {
      console.log("No .next/BUILD_ID found; using next dev for the e2e test server.");
    }
    await waitForServer();
  }

  for (const [key, email] of Object.entries(demoUsers)) {
    sessions[key] = await login(email);
  }
});

test.after(async () => {
  await stopServer();
});

test("1. Health check and OpenAPI 3.1 specification endpoints", async () => {
  // /health must be reachable without a session for uptime monitors and diagnostics.
  const health = await api("/health");
  assert.equal(health.status, 200);
  assert.equal(health.data.status, "ok");
  assert.equal(health.data.database.status, "connected");
  assert.ok(health.data.database.active_skus >= 8);

  // Destructive health actions still require an authenticated admin.
  const anonymousClear = await api("/health", {
    method: "POST",
    body: JSON.stringify({ action: "clear_all_data" }),
    redirect: "manual"
  });
  assert.ok(
    [307, 308, 401, 403].includes(anonymousClear.status),
    `POST /health must be protected, got ${anonymousClear.status}`
  );

  const openapi = await api("/api/v1/openapi.json");
  assert.equal(openapi.status, 200);
  assert.equal(openapi.data.openapi, "3.1.0");
  assert.ok(openapi.data.paths["/orders"]);
  assert.ok(openapi.data.paths["/traceability/batches/{id}"]);
  assert.ok(openapi.data.paths["/inbound/shipments"]);
  assert.ok(openapi.data.paths["/quality/inspections"]);
  assert.ok(openapi.data.paths["/putaway/tasks"]);
  assert.ok(openapi.data.paths["/inventory/reservations"]);
});

test("2. Authentication, session token issuance, and RBAC enforcement across roles", async () => {
  // Valid login
  const login = await api("/api/v1/auth", {
    method: "POST",
    body: JSON.stringify({
      action: "login",
      email: demoUsers.admin,
      password: DEMO_PASSWORD
    })
  });
  assert.equal(login.status, 200);
  assert.ok(login.data.token);
  assert.equal(login.data.user.role, "super_admin");
  // Super Admin holds the `*` wildcard grant, which satisfies every concrete
  // permission (including settings.manage) under the backend authorization engine.
  assert.ok(
    login.data.permissions.includes("*") || login.data.permissions.includes("settings.manage"),
    "super admin must hold full settings authority (wildcard or explicit)"
  );

  // Invalid password rejected with 401
  const badLogin = await api("/api/v1/auth", {
    method: "POST",
    body: JSON.stringify({
      action: "login",
      email: demoUsers.admin,
      password: "WrongPassword"
    })
  });
  assert.equal(badLogin.status, 401);
  assert.equal(badLogin.data.error.code, "INVALID_CREDENTIALS");

  // Unauthenticated API access is rejected by the middleware.
  const anonymous = await api("/api/v1/orders");
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.data.error.code, "UNAUTHENTICATED");

  // RBAC: driver cannot approve AI insights (403)
  const driverAiAttempt = await api(
    "/api/v1/ai/insights",
    {
      method: "POST",
      body: JSON.stringify({ insight_id: "AI-INS-01", decision: "approved" })
    },
    sessions.driver.session
  );
  assert.equal(driverAiAttempt.status, 403);
  assert.equal(driverAiAttempt.data.error.code, "FORBIDDEN_INSUFFICIENT_ROLE");

  // RBAC: sales cannot release credit holds (maker-checker requires finance/management/admin)
  const salesCreditAttempt = await api(
    "/api/v1/orders",
    {
      method: "PATCH",
      body: JSON.stringify({ order_id: "SO-2026-9843", action: "release_credit" })
    },
    sessions.sales.session
  );
  assert.equal(salesCreditAttempt.status, 403);
  assert.equal(salesCreditAttempt.data.error.code, "FORBIDDEN_INSUFFICIENT_ROLE");

  // ABAC: store_vendor only sees their own store in /api/v1/stores/summary
  const storeScoped = await api(
    "/api/v1/stores/summary",
    {},
    sessions.storeVendor.session
  );
  assert.equal(storeScoped.status, 200);
  assert.equal(storeScoped.data.stores.length, 1);
  assert.equal(storeScoped.data.stores[0].code, "STR-MIL-01");
});

test("3. Master data creation and Idempotency-Key replay & conflict protection", async () => {
  const uniqueSku = `SKU-TST-${Date.now().toString().slice(-4)}`;
  const idemKey = `idem-prd-${Date.now()}`;

  const first = await api(
    "/api/v1/products",
    {
      method: "POST",
      headers: { "Idempotency-Key": idemKey },
      body: JSON.stringify({
        sku: uniqueSku,
        name: "DOP Parmigiano Reggiano 36M Wedge",
        category: "Dairy",
        temp_zone: "Chilled (+2°C to +4°C)",
        shelf_life_days: 90,
        unit_price_cents: 6800,
        supplier: "Caseificio Val d'Orcia Srl"
      })
    },
    sessions.admin.session
  );
  assert.equal(first.status, 201);
  assert.equal(first.headers.get("x-idempotent-replay"), "false");
  assert.equal(first.data.sku, uniqueSku);

  // Replay with identical key and payload returns cached 201 response without duplicate insert
  const replay = await api(
    "/api/v1/products",
    {
      method: "POST",
      headers: { "Idempotency-Key": idemKey },
      body: JSON.stringify({
        sku: uniqueSku,
        name: "DOP Parmigiano Reggiano 36M Wedge",
        category: "Dairy",
        temp_zone: "Chilled (+2°C to +4°C)",
        shelf_life_days: 90,
        unit_price_cents: 6800,
        supplier: "Caseificio Val d'Orcia Srl"
      })
    },
    sessions.admin.session
  );
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get("x-idempotent-replay"), "true");

  // Reusing same Idempotency-Key with different payload returns 409 conflict
  const conflict = await api(
    "/api/v1/products",
    {
      method: "POST",
      headers: { "Idempotency-Key": idemKey },
      body: JSON.stringify({
        sku: `${uniqueSku}-DIFF`,
        name: "Different Product"
      })
    },
    sessions.admin.session
  );
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.error.code, "IDEMPOTENCY_KEY_CONFLICT");
});

test("4. Procurement-to-Stock workflow: RFQ/PO creation -> Goods Receipt -> FEFO lot creation", async () => {
  // Purchase order creation requires suppliers:write, which is held by the admin role.
  const createPo = await api(
    "/api/v1/suppliers",
    {
      method: "POST",
      body: JSON.stringify({
        action: "create_po",
        supplier_id: "SUP-NOR-01",
        sku: "SKU-SAL-001",
        cases: 35,
        mode: "po"
      })
    },
    sessions.admin.session
  );
  assert.equal(createPo.status, 201);
  const poNumber = createPo.data.purchase_order.po_number;
  assert.ok(poNumber.startsWith("PO-2026-"));

  // Receive the PO into warehouse inventory as the warehouse manager.
  const receivePo = await api(
    "/api/v1/suppliers",
    {
      method: "POST",
      body: JSON.stringify({
        action: "receive_po",
        po_number: poNumber,
        temp_c: 1.6,
        accepted_cases: 35
      })
    },
    sessions.warehouseManager.session
  );
  assert.equal(receivePo.status, 200);
  assert.equal(receivePo.data.quality_status, "released");
  assert.ok(receivePo.data.created_batch_id.startsWith("LOT-2026-"));

  // Verify the newly received lot appears in FEFO inventory lots
  const lots = await api("/api/v1/inventory/lots", {}, sessions.warehouseManager.session);
  assert.equal(lots.status, 200);
  const createdLot = lots.data.find((l) => l.batch_code === receivePo.data.created_batch_id);
  assert.ok(createdLot);
  assert.equal(createdLot.remaining_kg, 175);
});

test("5. FEFO ranking, cycle count reconciliation, and cold-chain excursion alerts", async () => {
  const lotsRes = await api("/api/v1/inventory/lots", {}, sessions.warehouseManager.session);
  assert.equal(lotsRes.status, 200);
  const salmonLots = lotsRes.data.filter((l) => l.sku === "SKU-SAL-001" && l.quality_status === "released");
  assert.ok(salmonLots.length >= 2);
  assert.equal(salmonLots[0].fefo_rank, 1);
  assert.ok(salmonLots[0].days_remaining <= salmonLots[1].days_remaining);

  // Post physical cycle count (inventory:adjust)
  const countRes = await api(
    "/api/v1/inventory/lots",
    {
      method: "POST",
      body: JSON.stringify({
        batch_id: "LOT-2026-SAL-041",
        counted_cases: 50,
        reason: "Automated E2E test cycle count"
      })
    },
    sessions.warehouseManager.session
  );
  assert.equal(countRes.status, 200);
  assert.equal(countRes.data.counted_cases, 50);

  // Negative cycle count rejected
  const negRes = await api(
    "/api/v1/inventory/lots",
    {
      method: "POST",
      body: JSON.stringify({
        batch_id: "LOT-2026-SAL-041",
        counted_cases: -5
      })
    },
    sessions.warehouseManager.session
  );
  assert.equal(negRes.status, 400);

  // Record cold-chain excursion reading (inventory:adjust)
  const tempRes = await api(
    "/api/v1/temperature/readings",
    {
      method: "POST",
      body: JSON.stringify({
        zone_id: "TMP-01",
        current_c: 4.8
      })
    },
    sessions.warehouseManager.session
  );
  assert.equal(tempRes.status, 201);
  assert.equal(tempRes.data.status, "excursion");
});

test("6. Order-to-Delivery & Invoicing workflow with credit hold maker-checker release", async () => {
  // Create a high-value order that triggers a credit hold (orders:write -> sales)
  const orderRes = await api(
    "/api/v1/orders",
    {
      method: "POST",
      body: JSON.stringify({
        customer: "Hotel Principe di Savoia",
        customer_type: "wholesale",
        sku: "SKU-BFL-009",
        cases: 20,
        total_cents: 432000
      })
    },
    sessions.sales.session
  );
  assert.equal(orderRes.status, 201);
  const orderNumber = orderRes.data.number;
  assert.equal(orderRes.data.credit_status, "blocked");
  assert.equal(orderRes.data.status, "draft");

  // Attempting to advance while credit hold is active must fail with 422
  const blockedAdvance = await api(
    "/api/v1/orders",
    {
      method: "PATCH",
      body: JSON.stringify({ order_id: orderNumber, action: "advance" })
    },
    sessions.sales.session
  );
  assert.equal(blockedAdvance.status, 422);
  assert.equal(blockedAdvance.data.error.code, "CREDIT_HOLD_ACTIVE");

  // Finance role releases credit hold (maker-checker)
  const releaseRes = await api(
    "/api/v1/orders",
    {
      method: "PATCH",
      body: JSON.stringify({
        order_id: orderNumber,
        action: "release_credit",
        reason: "Confirmed wire transfer advice from Hotel Principe"
      })
    },
    sessions.finance.session
  );
  assert.equal(releaseRes.status, 200);
  assert.equal(releaseRes.data.credit_status, "clear");
  assert.equal(releaseRes.data.status, "confirmed");

  // Advance confirmed -> picking -> dispatched -> delivered
  const stepPicking = await api(
    "/api/v1/orders",
    { method: "PATCH", body: JSON.stringify({ order_id: orderNumber, action: "advance" }) },
    sessions.sales.session
  );
  assert.equal(stepPicking.data.status, "picking");

  const stepDispatched = await api(
    "/api/v1/orders",
    { method: "PATCH", body: JSON.stringify({ order_id: orderNumber, action: "advance" }) },
    sessions.sales.session
  );
  assert.equal(stepDispatched.data.status, "dispatched");

  const stepDelivered = await api(
    "/api/v1/orders",
    { method: "PATCH", body: JSON.stringify({ order_id: orderNumber, action: "advance" }) },
    sessions.sales.session
  );
  assert.equal(stepDelivered.data.status, "delivered");

  // Verify invoice was automatically generated for the delivered order
  const finRes = await api("/api/v1/finance/summary", {}, sessions.finance.session);
  assert.equal(finRes.status, 200);
  const generatedInvoice = finRes.data.invoices.find((i) => i.order_number === orderNumber);
  assert.ok(generatedInvoice);

  // Transmit invoice to Italy SdI and record SEPA payment (finance:sdi / finance:payment)
  const sdiRes = await api(
    "/api/v1/finance/summary",
    {
      method: "POST",
      body: JSON.stringify({ action: "send_to_sdi", invoice_id: generatedInvoice.number })
    },
    sessions.finance.session
  );
  assert.equal(sdiRes.status, 200);
  assert.equal(sdiRes.data.invoice.sdi_status, "accepted");

  const payRes = await api(
    "/api/v1/finance/summary",
    {
      method: "POST",
      body: JSON.stringify({ action: "record_payment", invoice_id: generatedInvoice.number })
    },
    sessions.finance.session
  );
  assert.equal(payRes.status, 200);
  assert.equal(payRes.data.invoice.status, "paid");
});

test("7. Warehouse barcode scan verification, batch quarantine, and offline sync conflict detection", async () => {
  // VerifyFEFO mismatch rejection when scanning newer lot LOT-2026-SAL-044 instead of LOT-2026-SAL-041 on TSK-401
  const mismatchScan = await api(
    "/api/v1/warehouse/tasks",
    {
      method: "POST",
      body: JSON.stringify({
        action: "verify_scan",
        task_id: "TSK-401",
        barcode: "LOT-2026-SAL-044"
      })
    },
    sessions.warehouseManager.session
  );
  assert.equal(mismatchScan.status, 200);
  assert.equal(mismatchScan.data.verified, false);
  assert.equal(mismatchScan.data.status, "fefo_mismatch");

  // Valid scan of LOT-2026-SAL-041 completes TSK-401
  const validScan = await api(
    "/api/v1/warehouse/tasks",
    {
      method: "POST",
      body: JSON.stringify({
        action: "verify_scan",
        task_id: "TSK-401",
        barcode: "LOT-2026-SAL-041"
      })
    },
    sessions.warehouseManager.session
  );
  assert.equal(validScan.status, 200);
  assert.equal(validScan.data.verified, true);
  assert.equal(validScan.data.task.status, "done");

  // Traceability genealogy and recall notification
  const traceGet = await api(
    "/api/v1/traceability/batches/LOT-2026-SAL-041",
    {},
    sessions.warehouseManager.session
  );
  assert.equal(traceGet.status, 200);
  assert.equal(traceGet.data.batch.batch_code, "LOT-2026-SAL-041");
  assert.ok(traceGet.data.mass_balance.received_kg > 0);

  const notifyRes = await api(
    "/api/v1/traceability/batches/LOT-2026-SAL-041",
    {
      method: "POST",
      body: JSON.stringify({
        action: "notify_customer",
        order_number: "SO-2026-9841"
      })
    },
    sessions.warehouseManager.session
  );
  assert.equal(notifyRes.status, 200);
  assert.equal(notifyRes.data.notice.notified, true);

  // Quarantine batch LOT-2026-SPN-008 and verify offline sync detects conflict on TSK-405
  const quarantineRes = await api(
    "/api/v1/traceability/batches/LOT-2026-SPN-008",
    {
      method: "POST",
      body: JSON.stringify({
        action: "quarantine",
        reason: "QA microbiological hold test"
      })
    },
    sessions.warehouseManager.session
  );
  assert.equal(quarantineRes.status, 200);
  assert.equal(quarantineRes.data.batch.quality_status, "quarantine");

  const offlineSync = await api(
    "/api/v1/warehouse/tasks",
    {
      method: "POST",
      body: JSON.stringify({
        action: "sync_offline",
        events: [
          {
            event_id: "EVT-OFF-1",
            task_id: "TSK-405",
            action: "complete"
          }
        ]
      })
    },
    sessions.warehouseManager.session
  );
  assert.equal(offlineSync.status, 200);
  assert.equal(offlineSync.data.conflicts.length, 1);
  assert.ok(offlineSync.data.conflicts[0].reason.toLowerCase().includes("quarantine"));
});

test("8. Governed AI approval, delivery POD capture, and immutable audit trail", async () => {
  const aiApprove = await api(
    "/api/v1/ai/insights",
    {
      method: "POST",
      body: JSON.stringify({
        insight_id: "AI-INS-01",
        decision: "approved",
        reason: "Approved promo allocation for expiring Burrata"
      })
    },
    sessions.admin.session
  );
  assert.equal(aiApprove.status, 200);
  assert.equal(aiApprove.data.insight.decision, "approved");

  const delPod = await api(
    "/api/v1/deliveries",
    {
      method: "PATCH",
      body: JSON.stringify({
        delivery_id: "DEL-501",
        action: "capture_pod"
      })
    },
    sessions.driver.session
  );
  assert.equal(delPod.status, 200);
  assert.equal(delPod.data.delivery.status, "delivered");
  assert.equal(delPod.data.delivery.pod_signed, true);

  const auditRes = await api("/api/v1/audit?limit=25", {}, sessions.admin.session);
  assert.equal(auditRes.status, 200);
  assert.ok(Array.isArray(auditRes.data));
  assert.ok(auditRes.data.length >= 10);
});

test("9. Newer modules (inbound, quality, put-away, stock intelligence, procurement) serve live data", async () => {
  const endpoints = [
    "/api/v1/inbound/shipments",
    "/api/v1/quality/dashboard",
    "/api/v1/quality/inspections",
    "/api/v1/putaway/tasks",
    "/api/v1/putaway/bins",
    "/api/v1/inventory/dashboard",
    "/api/v1/inventory/reservations",
    "/api/v1/inventory/cycle-counts",
    "/api/v1/inventory/adjustments",
    "/api/v1/inventory/movements",
    "/api/v1/procurement/rfqs",
    "/api/v1/procurement/purchase-orders",
    "/api/v1/procurement/scorecards"
  ];

  for (const endpoint of endpoints) {
    const res = await api(endpoint, {}, sessions.admin.session);
    assert.equal(res.status, 200, `Expected HTTP 200 from ${endpoint}: ${res.text}`);
    assert.ok(res.data !== null, `Expected a JSON body from ${endpoint}`);
  }
});

test("10. All 16 Frontend ERP pages render HTTP 200 with an authenticated session", async () => {
  const routes = [
    "/",
    "/orders",
    "/warehouse",
    "/inbound",
    "/quality",
    "/putaway",
    "/deliveries",
    "/products",
    "/suppliers",
    "/inventory",
    "/traceability",
    "/finance",
    "/stores",
    "/analytics",
    "/proposal",
    "/settings"
  ];
  for (const route of routes) {
    const res = await fetch(`${BASE_URL}${route}`, {
      headers: { Cookie: sessions.admin.session.header() },
      redirect: "manual"
    });
    assert.equal(res.status, 200, `Expected HTTP 200 for route ${route}`);
    const html = await res.text();
    assert.ok(html.includes("Ascentra"), `Expected rendered HTML on ${route}`);
    assert.ok(
      !html.includes("Sign in to your ERP"),
      `Route ${route} rendered the login screen instead of the ERP`
    );
  }
});

test("11. Demo dataset can be restored after clearing (Settings lifecycle)", async () => {
  const restore = await api(
    "/health",
    {
      method: "POST",
      body: JSON.stringify({ action: "restore_demo_data" })
    },
    sessions.admin.session
  );
  assert.equal(restore.status, 200, restore.text);
  assert.equal(restore.data.mode, "demo");
  assert.ok(restore.data.active_skus >= 8);

  // Users and sessions survive a dataset reset, so the same session keeps working.
  const me = await api("/api/v1/auth/me", {}, sessions.admin.session);
  assert.equal(me.status, 200);

  const orders = await api("/api/v1/orders", {}, sessions.admin.session);
  assert.equal(orders.status, 200);
  assert.ok(orders.data.some((order) => order.number === "SO-2026-9841"));

  const lots = await api("/api/v1/inventory/lots", {}, sessions.admin.session);
  assert.equal(lots.status, 200);
  assert.ok(lots.data.some((lot) => lot.batch_code === "LOT-2026-SAL-041"));
});
