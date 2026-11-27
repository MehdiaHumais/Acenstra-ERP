# Ascentra Food Distribution ERP

AI-powered food distribution ERP covering warehouse, food traceability, delivery, finance,
store monitoring and governed AI. Built to match the Ascentra Global Ltd revised proposal
(MVP €8,000, 2-month target).

## Architecture

- **Next.js 14 full-stack app (TypeScript, Tailwind)** — the UI and the versioned REST API
  (`/api/v1/*`) run in the same process, so there is no separate service to deploy.
- **Persistence** — two interchangeable engines behind the same synchronous API:
  - `DB_ENGINE=sqlite` (default) uses Node 24's built-in `node:sqlite` with WAL mode, foreign
    keys and `BEGIN IMMEDIATE` transactions. Data lives in `data/ascentra-erp.sqlite` unless
    `SQLITE_DB_PATH` is set.
  - `DB_ENGINE=postgres` uses Supabase/PostgreSQL through a worker-thread sync bridge
    (`server/db/postgres-driver.ts` + `server/db/postgres-worker.cjs`) and a SQL translator
    (`server/db/sql-translate.cjs`). The 109-table schema, seed data and runtime-added columns
    are copied with `npm run db:migrate:postgres`. The pooler connection string (port 6543) is
    recommended because Supabase's direct DB host is IPv6-only on some networks.
- **Modules** — overview, orders, warehouse, inbound receiving, quality gate (HACCP/CAPA),
  put-away, deliveries, products, suppliers, stock intelligence (FEFO/reservations/cycle counts),
  traceability, finance (Italy SdI adapter), stores, analytics/AI, proposal and settings.
- **`backend/`** — the original FastAPI prototype. It is no longer used by the app and is kept
  only as historical reference; the live backend is `app/api/v1`.

## Requirements

- **Node.js 24 LTS or newer** — required for the built-in `node:sqlite` driver.
- npm 11+.

## Quick start (development)

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. The demo dataset is seeded automatically on first start when
`SEED_DEMO_DATA=true` (see `.env.example`). To start from an empty operational dataset instead,
set `SEED_DEMO_DATA=false`, use **Settings ? Clear all data**, or call
`POST /health` with `{ "action": "clear_all_data" }`. **Settings ? Restore demo data** rebuilds
the seeded proposal dataset at any time without touching user accounts or active sessions.

### Demo accounts

All seeded accounts use the password `Ascentra!2026`.

| Role | Email |
| --- | --- |
| Super admin | `elena.conti@ascentra.it` |
| Warehouse manager | `marco.bellini@ascentra.it` |
| Picker | `pietro.rossi@ascentra.it` |
| Driver | `davide.galli@ascentra.it` |
| Finance | `matteo.ricci@ascentra.it` |
| Sales | `sofia.greco@ascentra.it` |
| QA | `giulia.romano@ascentra.it` |
| Store vendor (Navigli) | `chiara.moretti@store-navigli.it` |
| CEO | `lorenzo.ferrari@ascentra.it` |

## Supabase / PostgreSQL production

The full 109-table SQLite dataset (including tombstones and demo rows) can be copied into
Supabase. Use the **pooled** connection string from *Project Settings ? Database ? Connection
string ? URI* (port `6543`), because the direct `db.<ref>.supabase.co` host is IPv6-only on some
networks.

```powershell
# .env (never commit this file)
DB_ENGINE="postgres"
DATABASE_URL="postgresql://postgres.<PROJECT_REF>:<PASSWORD>@<pooler-host>:6543/postgres"

# one-time data copy from the local SQLite file
npm run db:migrate:postgres

npm run build
npm start
```

`npm run db:migrate:postgres` creates the schema, mirrors runtime-added columns, copies every
row with `ON CONFLICT DO NOTHING`, and adds foreign keys after the data is loaded. Re-running it
is safe (idempotent); set `MIGRATE_DROP_EXISTING=true` for a clean re-import. The app then serves
all pages and APIs from Postgres with no code changes. `GET /health` reports
`database.engine: "supabase-postgres"`.

## Production / always-on server (Windows)

```powershell
npm run build
powershell -ExecutionPolicy Bypass -File .\start-server.ps1
```

`start-server.ps1` launches the detached auto-restarting launcher (`run-server.vbs` ?
`run-server.cmd`). The launcher:

- resolves the project folder from its own location (no hard-coded drive paths),
- locates Node from `%LOCALAPPDATA%\Programs\nodejs` or `PATH`,
- runs `next build` automatically when `.next\BUILD_ID` is missing,
- serves on <http://127.0.0.1:3001> and logs to `server.log`,
- restarts the server after a crash.

Other scripts:

- `stop-server.ps1` — stops the server and its restart loop.
- `startup-check.ps1` — starts the server only if port 3001 is not already listening.
- `AscentraERP-autostart.vbs` — put a shortcut to this in `shell:startup` for boot auto-start.
- `start-test.cmd` — starts a throwaway server on port 3016 with a temporary seeded database.

## Health checks

- `GET /health` — public JSON probe (status, database engine, active SKUs, cache/queue stats).
  Used by uptime monitors and **Settings ? Run health check**.
- `POST /health` with `{ "action": "clear_all_data" }` — requires the `settings.manage`
  permission and clears operational data while preserving users and sessions.
- `POST /health` with `{ "action": "restore_demo_data" }` — requires `settings.manage` and
  rebuilds the seeded demo dataset (also available from **Settings**).

## Tests

```bash
npm run typecheck   # TypeScript compiler, no emit
npm test            # 48 backend/security/domain tests (node:test + tsx)
npm run test:e2e    # 11 end-to-end API + page-render tests
npm run verify      # typecheck + unit tests + production build
```

`npm run test:e2e` boots its own production server on port 3117 against a fresh, seeded
temporary SQLite database, then removes it. To test an already running instance instead:

```bash
# PowerShell
$env:TEST_BASE_URL = "http://127.0.0.1:3001"
# the target instance must have been started with SEED_DEMO_DATA=true
npm run test:e2e
```

## Key capabilities

- **Order-to-cash**: contract pricing, credit controls, FEFO allocation, pick/pack/dispatch, POD, invoices
- **Warehouse (WMS)**: put-away, task queues, barcode/scan verification, offline queue conflict detection, cycle counting
- **Traceability & recall**: lot genealogy, mass balance, quarantine, HACCP/CAPA evidence
- **Inbound**: expected shipments, ASN, dock arrival, temperature logs, documents, receiving, quarantine/rejection
- **Quality gate**: HACCP checkpoints, inspection decisions, exceptions, CAPA
- **Stock intelligence**: multi-level visibility, FEFO, shelf-life rules, reservations, blind cycle counts, maker-checker adjustments
- **Procurement**: supplier scorecards, RFQ/quotes, ASN, landed cost
- **Delivery**: routes, vehicle/load checks, temperature, exceptions, reverse logistics
- **Finance**: invoices, Italy SdI handoff (adapter), payments, margin
- **Stores**: restricted vendor accounts, purchases vs estimated consumption, waste trends
- **Governed AI**: approval-gated recommendations, evidence, audit logging

## Notes

- Third-party services (SdI provider, bank, EDI, IoT, maps) require written approval and cost disclosure.
- Native mobile apps are only built after platform/OS scope validation.
