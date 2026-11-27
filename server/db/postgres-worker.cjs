/**
 * Postgres worker thread.
 *
 * PostgreSQL drivers are asynchronous, but the ERP's data layer is synchronous.
 * This worker owns a single `pg` client and communicates with the main thread
 * through SharedArrayBuffer + Atomics, letting the existing synchronous
 * `prepare().get()/.run()/.all()` API work unchanged.
 */
"use strict";

const { parentPort, workerData } = require("worker_threads");
const { Client } = require("pg");
const { translateSql } = require("./sql-translate.cjs");

const control = new Int32Array(workerData.control);
const reqBuf = new Uint8Array(workerData.request);
const resBuf = new Uint8Array(workerData.response);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const STATE_IDLE = 0;
const STATE_REQUEST = 1;
const STATE_RESPONSE = 2;
const STATE_STOP = 3;

let client = null;

function encodeValue(v) {
  if (Buffer.isBuffer(v)) return { __buf: Array.from(v) };
  if (v instanceof Uint8Array) return { __buf: Array.from(v) };
  if (v === undefined) return null;
  if (typeof v === "bigint") return v.toString();
  return v;
}

function decodeValue(v) {
  if (v && typeof v === "object" && Array.isArray(v.__buf)) return Buffer.from(v.__buf);
  if (v && typeof v === "object" && v.type === "Buffer" && Array.isArray(v.data)) return Buffer.from(v.data);
  return v;
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const out = {};
    for (const [key, value] of Object.entries(row)) out[key] = encodeValue(value);
    return out;
  });
}

async function getClient() {
  if (client) return client;
  const c = new Client({
    connectionString: workerData.connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
    statement_timeout: 30_000,
  });
  try {
    await c.connect();
    client = c;
    c.on("error", () => {
      client = null;
      c.end().catch(() => {});
    });
    return client;
  } catch (err) {
    try { await c.end(); } catch { /* ignore */ }
    throw err;
  }
}

async function invalidate(err) {
  if (!client) return;
  const old = client;
  client = null;
  try { await old.end(); } catch { /* ignore */ }
  void err;
}

async function execute(req) {
  if (req.op === "close") {
    await invalidate();
    return { ok: true };
  }

  const values = Array.isArray(req.values) ? req.values.map(decodeValue) : [];
  const isBatch = req.op === "exec";
  const text = translateSql(String(req.text || ""), values.length, isBatch);
  if (!text.trim()) return { ok: true, rows: [], changes: 0 };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const c = await getClient();
      const result = await c.query(text, values.length ? values : undefined);
      const changes = typeof result.rowCount === "number" ? result.rowCount : 0;
      return {
        ok: true,
        rows: normalizeRows(result.rows || []),
        changes,
        lastInsertRowid: 0,
      };
    } catch (err) {
      await invalidate(err);
      if (attempt === 1) throw err;
    }
  }
  return { ok: false, error: "unreachable" };
}

function writeResponse(obj) {
  const bytes = encoder.encode(JSON.stringify(obj));
  if (bytes.length > resBuf.length) {
    const bytes2 = encoder.encode(
      JSON.stringify({ ok: false, error: `Postgres response too large (${bytes.length} > ${resBuf.length} bytes)` })
    );
    resBuf.set(bytes2.subarray(0, resBuf.length));
    Atomics.store(control, 1, bytes2.length);
  } else {
    resBuf.set(bytes);
    Atomics.store(control, 1, bytes.length);
  }
}

async function loop() {
  while (true) {
    Atomics.wait(control, 0, STATE_IDLE);
    const state = Atomics.load(control, 0);
    if (state === STATE_STOP) break;
    if (state !== STATE_REQUEST) continue;

    const len = Atomics.load(control, 1);
    let response;
    try {
      const raw = decoder.decode(reqBuf.subarray(0, len));
      const req = JSON.parse(raw);
      response = await execute(req);
    } catch (err) {
      response = { ok: false, error: err && err.message ? err.message : String(err) };
    }

    writeResponse(response);
    Atomics.store(control, 0, STATE_RESPONSE);
    Atomics.notify(control, 0);
  }
  if (client) {
    try { await client.end(); } catch { /* ignore */ }
  }
}

loop().catch((err) => {
  writeResponse({ ok: false, error: "worker fatal: " + String(err && err.message || err) });
  Atomics.store(control, 0, STATE_RESPONSE);
  Atomics.notify(control, 0);
});
