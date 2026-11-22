# Ascentra ERP — Frontend-to-Backend Audit & Implementation Checklist

## 1. Existing Repository Audit Summary

- **Frontend Stack**: Next.js 14.2 App Router (`app/`), React 18, TypeScript, Tailwind CSS, Lucide Icons.
- **Database & Persistence**:
  - Production-grade **PostgreSQL Prisma Schema** ([prisma/schema.prisma](prisma/schema.prisma)) and SQL DDL migration ([prisma/migrations/20261024000000_init/migration.sql](prisma/migrations/20261024000000_init/migration.sql)).
  - Zero-dependency persistent relational SQL engine ([server/db/connection.ts](server/db/connection.ts) & [server/db/sqlite-driver.ts](server/db/sqlite-driver.ts)) powered by Node 24's built-in `node:sqlite` (`DatabaseSync`) with WAL mode, foreign keys, `BEGIN IMMEDIATE` ACID transactions, and automatic seed initialization in `data/ascentra-erp.sqlite`.
- **Security, Auth, RBAC/ABAC & Audit**:
  - Password hashing (`scryptSync` + `timingSafeEqual`) and HMAC-SHA256 session tokens in [server/security/crypto.ts](server/security/crypto.ts).
  - Role-based & attribute-based access control across all 9 enterprise roles (`super_admin`, `warehouse_manager`, `picker`, `driver`, `finance`, `sales`, `qa`, `store_vendor`, `ceo`) plus legacy role aliases and an immutable PII-redacted audit trail in [server/security/auth.ts](server/security/auth.ts).
  - Rate limiting, `Idempotency-Key` request fingerprinting & replay protection, and structured error handling in [server/core/http.ts](server/core/http.ts).

---

## 2. Page, Component, and Endpoint Mapping Checklist

### A. Global Shell & Header
- [x] **Header Actions ([components/header-actions.tsx](components/header-actions.tsx))**
  - Search modal (`Cmd+K`): Live search across orders, SKUs, batches, deliveries, and pages.
  - Operational alerts popover (`Bell`): Loads live alerts, supports "Mark all read" (`POST /api/v1/dashboard/overview`).
  - Role / User switcher (`AC` avatar): Switches the active ERP role, signs in/out via `POST /api/v1/auth`, and triggers `router.refresh()`.

### B. Control Tower Dashboard ([app/page.tsx](app/page.tsx))
- [x] **Data Fetching**: `getDashboard()` -> `GET /api/v1/dashboard/overview` (and direct server-side service query).
- [x] **Metrics & Visuals**:
  - 6 live KPI cards (revenue MTD, fulfillment rate, FEFO compliance, cold-chain excursions, overdue AR, open tasks).
  - 7-day Revenue & Fulfillment trend chart (`revenue_series`).
  - Live Cold-Chain Telemetry across zones (`temperature`).
  - Active Warehouse Execution Queue (`tasks`).
  - Open Operational Exceptions (`alerts`).
  - Governed AI Insights awaiting approval (`insights`) via [components/insight-list.tsx](components/insight-list.tsx).
  - End-to-End 7-step Food Distribution Journey (`journey` steps 1–7).

### C. Sales Orders & Credit Control ([app/orders/page.tsx](app/orders/page.tsx) & [components/orders-table.tsx](components/orders-table.tsx))
- [x] **List & Filter Orders**: `GET /api/v1/orders` with status, channel, and search filtering.
- [x] **Create Sales Order (`+ New sales order`)**: `POST /api/v1/orders` with real-time credit limit evaluation (`clear` / `warning` / `blocked`), FEFO batch allocation, and automatic warehouse pick task creation.
- [x] **Maker-Checker Credit Override (`Release`)**: `PATCH /api/v1/orders` (`action: "release_credit"`) restricted to `finance`, `management`, and `administrator`, recording reason and audit log.
- [x] **Order State Machine (`Confirm` / `Pick` / `Dispatch` / `Deliver`)**: `PATCH /api/v1/orders` (`action: "advance"`), automatically generating delivery routes on dispatch and customer invoices on delivery.
- [x] **Order Cancellation (`Cancel`)**: `PATCH /api/v1/orders` (`action: "cancel"`), releasing reserved FEFO stock.

### D. Warehouse & WMS ([app/warehouse/page.tsx](app/warehouse/page.tsx), [components/task-queue.tsx](components/task-queue.tsx), [components/scan-panel.tsx](components/scan-panel.tsx))
- [x] **Task Queue**: `GET /api/v1/warehouse/tasks` & `PATCH /api/v1/warehouse/tasks` (`Start` -> `in_progress`, `Complete` -> `completed`, `Hold` -> `blocked`).
- [x] **GS1-128 Barcode Scan Verification**: `POST /api/v1/warehouse/tasks` (`action: "scan"`) validating batch existence, quarantine status, and catch-weight tolerance (`±2%`), plus offline scan batch sync (`action: "sync_offline_scans"`) with conflict detection.
- [x] **Inbound Dock Schedule**: Live dock doors populated from active Purchase Orders & ASNs.

### E. Fleet, Deliveries & POD ([app/deliveries/page.tsx](app/deliveries/page.tsx) & [components/delivery-board.tsx](components/delivery-board.tsx))
- [x] **Route Manifests**: `GET /api/v1/deliveries`.
- [x] **Route Actions**: `PATCH /api/v1/deliveries` supporting `start_load`, `dispatch`, `capture_pod` (digital signature, recipient name, cabin temperature check), `flag_exception` (shortage/damage/rejection), and `resolve_exception` (creating credit note and re-delivery/return log).

### F. Product Master & Catch-Weight Catalog ([app/products/page.tsx](app/products/page.tsx) & [components/products-table.tsx](components/products-table.tsx))
- [x] **Catalog & Search**: `GET /api/v1/products`.
- [x] **Register SKU (`+ Add product`)**: `POST /api/v1/products` with `Idempotency-Key` support, allergen metadata, shelf-life rules, and catch-weight flag.

### G. Suppliers, Procurement & Receiving ([app/suppliers/page.tsx](app/suppliers/page.tsx) & [components/supplier-actions.tsx](components/supplier-actions.tsx))
- [x] **Supplier Scorecard & PO Pipeline**: `GET /api/v1/suppliers` returning suppliers and purchase orders (`PO-2026-*`) with ASN references.
- [x] **Create RFQ / Purchase Order (`Create RFQ / PO`)**: `POST /api/v1/suppliers` (`action: "create_rfq"`).
- [x] **Receive PO into Stock (`Receive PO`)**: `POST /api/v1/suppliers` (`action: "receive_po"`), recording arrival temperature, creating a new FEFO inventory lot, incrementing product stock, and logging a receiving warehouse task.

### H. FEFO Inventory & Cold-Chain ([app/inventory/page.tsx](app/inventory/page.tsx) & [components/inventory-actions.tsx](components/inventory-actions.tsx))
- [x] **FEFO Lot Ledger**: `GET /api/v1/inventory/lots` ordered by earliest expiry date and risk status.
- [x] **Cycle Count Reconciliation (`Cycle count`)**: `POST /api/v1/inventory/lots` (`action: "cycle_count"`), updating physical vs system quantities, product stock totals, and variance reason codes.
- [x] **Cold-Chain Telemetry & Excursion Alerts**: `GET /api/v1/temperature/readings` & `POST /api/v1/temperature/readings`.

### I. Batch Traceability & Recall Containment ([app/traceability/page.tsx](app/traceability/page.tsx) & [components/trace-actions.tsx](components/trace-actions.tsx))
- [x] **Forward & Backward Batch Graph**: `GET /api/v1/traceability/batches/[id]` returning supplier origin, PO, reception temperature, current warehouse bin, and downstream customer allocations.
- [x] **Quarantine Batch (`Quarantine batch`)**: `POST /api/v1/traceability/batches/[id]` (`action: "quarantine"`), locking the lot and blocking linked pick tasks.
- [x] **Customer Recall Notification (`Notify`)**: `POST /api/v1/traceability/batches/[id]` (`action: "notify_customer"`), dispatching recall advisories and recording an immutable audit event.

### J. Finance, Billing & Italy SdI ([app/finance/page.tsx](app/finance/page.tsx) & [components/finance-register.tsx](components/finance-register.tsx))
- [x] **Invoices, Credit Notes & Ageing**: `GET /api/v1/finance/summary` with 4 ageing buckets (`Current (0–30d)`, `31–60 days`, `61–90 days`, `90+ days`).
- [x] **Italy SdI FatturaPA XML Transmission (`Send to SdI`)**: `POST /api/v1/finance/summary` (`action: "send_to_sdi"`).
- [x] **SEPA Payment Reconciliation (`Record payment`)**: `POST /api/v1/finance/summary` (`action: "record_payment"`), updating invoice status and reducing customer credit exposure.

### K. Retail Store & Vendor Monitoring ([app/stores/page.tsx](app/stores/page.tsx) & [components/store-table.tsx](components/store-table.tsx))
- [x] **Store Telemetry & ABAC Scoping**: `GET /api/v1/stores/summary` (automatically scoped to the assigned store when role is `store_vendor`).
- [x] **Flag / Clear Store Replenishment Review**: `PATCH /api/v1/stores/summary`.

### L. Governed AI & Executive Analytics ([app/analytics/page.tsx](app/analytics/page.tsx) & [components/insight-list.tsx](components/insight-list.tsx))
- [x] **AI Recommendations**: `GET /api/v1/ai/insights`.
- [x] **Maker-Checker Approval / Rejection (`Approve` / `Reject`)**: `POST /api/v1/ai/insights`, executing downstream actions (auto-generating replenishment RFQs or promotional markdown flags) upon approval.

### M. System Settings, Health & OpenAPI ([app/settings/page.tsx](app/settings/page.tsx) & [components/settings-tools.tsx](components/settings-tools.tsx))
- [x] **Health Diagnostics (`Re-run health check`)**: public `GET /health` & `GET /api/v1/health`; destructive `POST /health` requires `settings.manage`.
- [x] **Dataset lifecycle**: **Settings → Clear all data** / **Restore demo data** (`POST /health` actions `clear_all_data` and `restore_demo_data`, FK-safe and preserving users/sessions).
- [x] **OpenAPI 3.1 Specification (`API docs`)**: `GET /api/v1/openapi.json` covering auth, orders, warehouse, inbound, quality, put-away, stock intelligence, procurement, finance, traceability, stores, AI, audit and admin.
- [x] **Immutable Audit Trail**: `GET /api/v1/audit` rendered live in Settings.

### N. Inbound Receiving ([app/inbound/page.tsx](app/inbound/page.tsx) & [components/inbound-workbench.tsx](components/inbound-workbench.tsx))
- [x] Expected shipments and ASN registration: `GET/POST /api/v1/inbound/shipments`.
- [x] Dock arrival, transport temperature and excursion detection: `POST /api/v1/inbound/shipments/[id]/arrival`, `POST /api/v1/inbound/shipments/[id]/temperature-logs`.
- [x] Catch-weight receiving with supplier batch/manufacture/expiry capture: `POST /api/v1/inbound/shipments/[id]/receiving`.
- [x] COA/HACCP document upload and verification: `POST /api/v1/inbound/shipments/[id]/documents`, `POST /api/v1/inbound/shipments/[id]/documents/[docId]/verify`.
- [x] Quality checks, acceptance, quarantine and rejection: `POST /api/v1/inbound/shipments/[id]/quality-checks`, `accept`, `quarantine`, `reject`.
- [x] Released stock posted to FEFO inventory and put-away tasks generated on acceptance.

### O. Quality Gate & HACCP ([app/quality/page.tsx](app/quality/page.tsx) & [components/quality-gate-workbench.tsx](components/quality-gate-workbench.tsx))
- [x] Inspection dashboard and lot/supplier/PO filtering: `GET /api/v1/quality/dashboard`, `GET /api/v1/quality/inspections`.
- [x] HACCP checkpoint templates and readings: `GET/POST /api/v1/quality/haccp-templates`, `POST /api/v1/quality/inspections/[id]/haccp`.
- [x] QA release / hold / quarantine / reject decisions with justification: `POST /api/v1/quality/inspections/[id]/decision`.
- [x] Exceptions and CAPA lifecycle: `GET/POST /api/v1/quality/exceptions`, `GET/POST /api/v1/quality/capas`.
- [x] Quality history and inspection detail: `GET /api/v1/quality/history`, `GET /api/v1/quality/inspections/[id]`.

### P. Put-away ([app/putaway/page.tsx](app/putaway/page.tsx) & [components/putaway-workbench.tsx](components/putaway-workbench.tsx))
- [x] Bin occupancy, temperature zones and placement recommendations: `GET /api/v1/putaway/dashboard`, `GET /api/v1/putaway/bins`.
- [x] Put-away task queue generated from QA-released lots: `GET/POST /api/v1/putaway/tasks`.
- [x] Mandatory-reason bin override: `POST /api/v1/putaway/tasks/[id]/override`.
- [x] Task/SKU/lot/bin barcode verification: `POST /api/v1/putaway/tasks/[id]/scan`.
- [x] Partial and split bin placement posting stock to the bin ledger: `POST /api/v1/putaway/tasks/[id]/confirm`.

### Q. Stock Intelligence ([app/inventory/page.tsx](app/inventory/page.tsx) & [components/stock-intelligence-workbench.tsx](components/stock-intelligence-workbench.tsx))
- [x] Multi-level stock visibility and status reconciliation: `GET /api/v1/inventory/dashboard`.
- [x] FEFO allocation skipping held/quarantined/expired stock: `POST /api/v1/inventory/fefo`.
- [x] Product/customer/segment minimum shelf-life rules: `GET/POST /api/v1/inventory/shelf-life`.
- [x] Concurrency-protected reservations with TTL and picking conversion: `GET/POST /api/v1/inventory/reservations`, `PATCH /api/v1/inventory/reservations/[id]`.
- [x] Blind cycle counts with manager reconciliation: `GET/POST /api/v1/inventory/cycle-counts`, `PATCH /api/v1/inventory/cycle-counts/[id]`.
- [x] Maker-checker stock adjustments and immutable movement ledger: `GET/POST /api/v1/inventory/adjustments`, `PATCH /api/v1/inventory/adjustments/[id]`, `GET /api/v1/inventory/movements`.

---

## 3. Verification Status
- [x] `npm run typecheck` (`tsc --noEmit`): **Passed (0 errors)**
- [x] `npm test` (Node 24 `node:test` + `tsx`): **Passed (48/48 tests)**
- [x] `npm run test:e2e` (self-hosted seeded server, 11 suites): **Passed (11/11)**
- [x] `npm run build` (`next build`): **Passed (73 routes)**
- [x] Production start via `start-server.ps1`: serving on `http://127.0.0.1:3001`, public `GET /health` returns JSON, all 16 pages and 27 API endpoints return 200 with a valid session.
- [x] `py -m pytest` (legacy `backend/` prototype, not used by the app): **Passed (14/14 tests)**
