import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import {
  PreparedStatementSync,
  SqliteDatabaseSync,
  SqlPrimitive,
} from "@/server/db/sqlite-driver";

const STATE_IDLE = 0;
const STATE_REQUEST = 1;
const STATE_RESPONSE = 2;
const STATE_STOP = 3;

const CONTROL_INTS = 4;
const BUFFER_BYTES = 16 * 1024 * 1024;

type WorkerSuccess = {
  ok: true;
  rows: Array<Record<string, unknown>>;
  changes: number;
  lastInsertRowid: number;
};

type WorkerResponse = WorkerSuccess | { ok: false; error: string };

function findWorkerFile(): string {
  const candidates = [
    path.join(process.cwd(), "server", "db", "postgres-worker.cjs"),
    path.join(__dirname, "postgres-worker.cjs"),
    path.join(process.cwd(), ".next", "server", "postgres-worker.cjs"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    "Postgres worker not found. Ensure server/db/postgres-worker.cjs is deployed with the application."
  );
}

function reviveValue(value: unknown): unknown {
  if (value && typeof value === "object" && Array.isArray((value as { __buf?: unknown }).__buf)) {
    return Buffer.from((value as { __buf: number[] }).__buf);
  }
  return value;
}

function reviveRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[key] = reviveValue(value);
  return out;
}

/** A synchronous facade over a Postgres worker thread. */
export class PostgresDatabaseSync implements SqliteDatabaseSync {
  private readonly control: Int32Array;
  private readonly requestBuf: Uint8Array;
  private readonly responseBuf: Uint8Array;
  private readonly worker: Worker;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private closed = false;

  constructor(connectionString: string) {
    if (!connectionString) throw new Error("DATABASE_URL is required when DB_ENGINE=postgres.");

    const controlSab = new SharedArrayBuffer(CONTROL_INTS * Int32Array.BYTES_PER_ELEMENT);
    const requestSab = new SharedArrayBuffer(BUFFER_BYTES);
    const responseSab = new SharedArrayBuffer(BUFFER_BYTES);

    this.control = new Int32Array(controlSab);
    this.requestBuf = new Uint8Array(requestSab);
    this.responseBuf = new Uint8Array(responseSab);

    this.worker = new Worker(findWorkerFile(), {
      workerData: {
        control: controlSab,
        request: requestSab,
        response: responseSab,
        connectionString,
      },
    });
    this.worker.on("error", (err) => {
      console.error("[postgres-worker] fatal error:", err);
    });
  }

  private call(op: string, text: string, values: SqlPrimitive[]): WorkerSuccess {
    if (this.closed) throw new Error("Postgres database is closed.");

    // Wait until the worker is idle (it resets STATE_IDLE after each reply).
    while (Atomics.load(this.control, 0) !== STATE_IDLE) {
      const r = Atomics.wait(this.control, 0, Atomics.load(this.control, 0), 35_000);
      if (r === "timed-out") throw new Error("Timed out waiting for Postgres worker to become idle.");
    }

    const payload = JSON.stringify({ op, text, values: values.map((v) => (v instanceof Uint8Array ? { __buf: Array.from(v) } : v)) });
    const bytes = this.encoder.encode(payload);
    if (bytes.length > this.requestBuf.length) {
      throw new Error(`Postgres request too large (${bytes.length} bytes).`);
    }
    this.requestBuf.set(bytes);
    Atomics.store(this.control, 1, bytes.length);
    Atomics.store(this.control, 0, STATE_REQUEST);
    Atomics.notify(this.control, 0);

    const waited = Atomics.wait(this.control, 0, STATE_REQUEST, 35_000);
    if (waited === "timed-out") {
      throw new Error(`Postgres query timed out: ${text.slice(0, 160)}`);
    }
    const state = Atomics.load(this.control, 0);
    if (state !== STATE_RESPONSE) {
      throw new Error(`Unexpected Postgres worker state ${state}.`);
    }

    const len = Atomics.load(this.control, 1);
    const raw = this.decoder.decode(this.responseBuf.subarray(0, len));
    Atomics.store(this.control, 0, STATE_IDLE);
    Atomics.notify(this.control, 0);

    let response: WorkerResponse;
    try {
      response = JSON.parse(raw) as WorkerResponse;
    } catch {
      throw new Error("Invalid response from Postgres worker: " + raw.slice(0, 200));
    }
    if (!response.ok) throw new Error(response.error);
    return response as WorkerSuccess;
  }

  exec(sql: string): void {
    this.call("exec", sql, []);
  }

  prepare(sql: string): PreparedStatementSync {
    const db = this;
    return {
      run(...params: SqlPrimitive[]) {
        const res = db.call("run", sql, params);
        return {
          changes: res.changes,
          lastInsertRowid: res.lastInsertRowid,
        };
      },
      get<T = Record<string, unknown>>(...params: SqlPrimitive[]): T | undefined {
        const res = db.call("get", sql, params);
        const row = res.rows[0];
        return row ? (reviveRow(row) as T) : undefined;
      },
      all<T = Record<string, unknown>>(...params: SqlPrimitive[]): T[] {
        const res = db.call("all", sql, params);
        return res.rows.map((row) => reviveRow(row) as T);
      },
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (Atomics.load(this.control, 0) !== STATE_IDLE) {
      const r = Atomics.wait(this.control, 0, Atomics.load(this.control, 0), 5_000);
      if (r === "timed-out") break;
    }
    Atomics.store(this.control, 0, STATE_STOP);
    Atomics.notify(this.control, 0);
    void this.worker.terminate();
  }
}

let cached: PostgresDatabaseSync | undefined;

export function openPostgresDatabase(): PostgresDatabaseSync {
  if (cached) return cached;
  const connectionString =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.SUPABASE_DB_URL ||
    "";
  cached = new PostgresDatabaseSync(connectionString);
  return cached;
}
