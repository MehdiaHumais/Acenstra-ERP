import fs from "node:fs";
import path from "node:path";
import { openSqliteDatabase, SqliteDatabaseSync } from "@/server/db/sqlite-driver";
import { openPostgresDatabase } from "@/server/db/postgres-driver";
import { hashPassword } from "@/server/security/crypto";

/**
 * Production can run on SQLite (default) or on Supabase Postgres. The Postgres
 * path uses a synchronous worker facade so the existing 1,200+ sync call sites
 * need no changes. Set DB_ENGINE=postgres in production to use Supabase.
 */
const DB_ENGINE = (process.env.DB_ENGINE || "sqlite").trim().toLowerCase();
const IS_POSTGRES = DB_ENGINE === "postgres" || DB_ENGINE === "postgresql" || DB_ENGINE === "supabase";

/** Test helpers always use an isolated in-memory SQLite database, never production data. */
let forceSqliteForTests = false;

/**
 * `next build` starts several static-generation workers that import API routes
 * and open this database in separate processes. Running the idempotent startup
 * seeds in every worker races for SQLite write locks ("database is locked").
 * A build must never mutate the database — seeding runs on the first real
 * server start instead.
 */
const IS_NEXT_BUILD = process.env.NEXT_PHASE === "phase-production-build";

declare global {
  // eslint-disable-next-line no-var
  var __ascentraDbInstance: SqliteDatabaseSync | undefined;
}

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  store_id TEXT,
  store_sub_role TEXT,
  store_permissions_json TEXT DEFAULT '[]',
  invited_by TEXT,
  invited_at TEXT,
  warehouse TEXT,
  mfa_enabled INTEGER NOT NULL DEFAULT 1,
  mfa_secret TEXT,
  mfa_backup_codes TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tombstones for hard-deleted accounts. The users row is removed so the email
-- can be reused immediately, but we keep a minimal record so a login attempt or
-- an existing session can be told "this account was deleted" instead of the
-- generic invalid-credentials message.
CREATE TABLE IF NOT EXISTS deleted_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  roles_json TEXT DEFAULT '[]',
  deleted_by TEXT,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deleted_accounts_email ON deleted_accounts(email);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  family_id TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1,
  revoked INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  ip_address TEXT,
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Personal access credentials for barcode / QR authentication.
-- Credentials identify a user; the RBAC system still decides what they can do.
-- Only a keyed hash of the secret is stored — never the secret itself.
CREATE TABLE IF NOT EXISTS user_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'qr',
  credential_hash TEXT NOT NULL UNIQUE,
  secret_hint TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT 'Default',
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TEXT,
  created_by TEXT,
  last_used_at TEXT,
  revoked_at TEXT,
  revoked_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_credentials_user ON user_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_user_credentials_status ON user_credentials(status);


CREATE TABLE IF NOT EXISTS product_barcodes (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'CODE128',
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (barcode)
);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_product ON product_barcodes(product_id);

CREATE TABLE IF NOT EXISTS scan_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_email TEXT,
  user_role TEXT,
  barcode TEXT NOT NULL,
  format TEXT,
  product_id TEXT,
  product_sku TEXT,
  operation TEXT NOT NULL,
  reference_id TEXT,
  quantity INTEGER,
  result TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scan_events_product ON scan_events(product_id);
CREATE INDEX IF NOT EXISTS idx_scan_events_barcode ON scan_events(barcode);
CREATE INDEX IF NOT EXISTS idx_scan_events_created ON scan_events(created_at);

-- Scoped in-app notifications — one row per recipient.
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  severity TEXT NOT NULL DEFAULT 'info',
  module TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  href TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at);

CREATE TABLE IF NOT EXISTS user_invitations (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  roles_json TEXT NOT NULL DEFAULT '[]',
  warehouse TEXT,
  store_id TEXT,
  scopes_json TEXT NOT NULL DEFAULT '{}',
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  invited_by TEXT,
  invited_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT,
  revoked_by TEXT,
  created_user_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_invitations_email ON user_invitations(email);
CREATE INDEX IF NOT EXISTS idx_user_invitations_status ON user_invitations(status);
CREATE INDEX IF NOT EXISTS idx_user_invitations_token ON user_invitations(token_hash);

-- Self-service password reset: single-purpose, expiring tokens emailed to the account owner.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);

-- Public access requests: visitors ask for ERP access; an admin reviews and
-- approves or rejects them. No account exists at this stage.
CREATE TABLE IF NOT EXISTS user_access_requests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT NOT NULL,
  phone TEXT,
  requested_role TEXT NOT NULL,
  reason TEXT NOT NULL,
  additional_info TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  review_notes TEXT,
  reviewed_by TEXT,
  reviewed_by_name TEXT,
  reviewed_at TEXT,
  invitation_id TEXT,
  created_user_id TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_user_access_requests_status ON user_access_requests(status);
CREATE INDEX IF NOT EXISTS idx_user_access_requests_email ON user_access_requests(email);
CREATE INDEX IF NOT EXISTS idx_user_access_requests_created ON user_access_requests(created_at);

-- Contact messages: user → admin (direction='to_admin') and admin → user (direction='to_user').
CREATE TABLE IF NOT EXISTS user_contact_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  user_name TEXT NOT NULL,
  user_role TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'to_admin',
  status TEXT NOT NULL DEFAULT 'new',
  admin_reply TEXT,
  replied_by TEXT,
  replied_by_name TEXT,
  replied_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON user_contact_messages(status, created_at);
CREATE INDEX IF NOT EXISTS idx_contact_messages_user ON user_contact_messages(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_contact_messages_direction ON user_contact_messages(direction, created_at);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  origin TEXT NOT NULL,
  uom TEXT NOT NULL,
  temp_zone TEXT NOT NULL,
  shelf_life_days INTEGER NOT NULL,
  stock_cases INTEGER NOT NULL DEFAULT 0,
  reorder_point_cases INTEGER NOT NULL DEFAULT 25,
  unit_price_cents INTEGER NOT NULL,
  vat_rate_pct REAL NOT NULL DEFAULT 4.0,
  supplier_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  description TEXT,
  brand TEXT,
  hs_code TEXT,
  base_uom TEXT,
  pack_uom TEXT,
  units_per_case INTEGER,
  unit_weight_kg REAL,
  case_weight_kg REAL,
  catch_weight INTEGER,
  catch_weight_min_kg REAL,
  catch_weight_max_kg REAL,
  tare_weight_kg REAL,
  allergens_json TEXT,
  may_contain_json TEXT,
  handling_json TEXT,
  diet_flags_json TEXT,
  temp_min_c REAL,
  temp_max_c REAL,
  min_shelf_life_days INTEGER,
  cost_price_cents INTEGER,
  currency TEXT,
  supplier_id TEXT,
  supplier_sku TEXT,
  batch_tracking INTEGER NOT NULL DEFAULT 0,
  weight_tolerance_pct REAL,
  required_documents_json TEXT,
  image_url TEXT,
  image_source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_prices (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  price_type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  uom TEXT NOT NULL DEFAULT 'case',
  customer_segment TEXT,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_product_prices_sku ON product_prices(sku);

CREATE TABLE IF NOT EXISTS product_certificates (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  certificate_type TEXT NOT NULL,
  certificate_number TEXT NOT NULL,
  issuer TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'valid',
  document_reference TEXT,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_product_certificates_sku ON product_certificates(sku);

CREATE TABLE IF NOT EXISTS product_suppliers (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  supplier_sku TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  lead_time_days INTEGER NOT NULL DEFAULT 2,
  moq_cases INTEGER NOT NULL DEFAULT 1,
  cost_price_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'approved',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(sku, supplier_id)
);

CREATE INDEX IF NOT EXISTS idx_product_suppliers_sku ON product_suppliers(sku);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  region TEXT NOT NULL,
  categories_json TEXT NOT NULL,
  lead_time_days INTEGER NOT NULL,
  otif_pct REAL NOT NULL,
  quality_score REAL NOT NULL,
  open_pos_count INTEGER NOT NULL DEFAULT 0,
  payment_terms TEXT NOT NULL,
  certifications_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved'
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  segment TEXT NOT NULL,
  customer_type TEXT NOT NULL DEFAULT 'store',
  manager TEXT NOT NULL,
  credit_limit_cents INTEGER NOT NULL DEFAULT 1500000,
  current_exposure_cents INTEGER NOT NULL DEFAULT 0,
  active_orders_count INTEGER NOT NULL DEFAULT 0,
  monthly_spend_cents INTEGER NOT NULL DEFAULT 0,
  fill_rate_pct REAL NOT NULL DEFAULT 98.0,
  waste_pct REAL NOT NULL DEFAULT 1.8,
  last_delivery_text TEXT NOT NULL DEFAULT 'Today, 06:45',
  top_categories_json TEXT NOT NULL DEFAULT '["Seafood","Dairy"]',
  payment_terms TEXT NOT NULL DEFAULT 'Net 30',
  status TEXT NOT NULL DEFAULT 'active',
  delivery_address TEXT,
  tax_id TEXT,
  min_shelf_life_days INTEGER DEFAULT 5,
  allow_backorders INTEGER DEFAULT 1,
  credit_status TEXT DEFAULT 'approved',
  piva TEXT,
  fiscal_code TEXT,
  sdi_recipient_code TEXT DEFAULT 'SUBM70N',
  pec_email TEXT,
  postal_code TEXT DEFAULT '20121',
  country TEXT DEFAULT 'IT',
  store_code TEXT,
  parent_franchise_group TEXT,
  region TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  assigned_distributor TEXT DEFAULT 'Ascentra Global Ltd - Milan Cold Hub',
  assigned_contract_id TEXT,
  allowed_skus_json TEXT DEFAULT '[]',
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS procurement_rfqs (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity_cases INTEGER NOT NULL,
  needed_by TEXT NOT NULL,
  incoterm TEXT NOT NULL DEFAULT 'DAP',
  destination TEXT NOT NULL DEFAULT 'Milan Cold Hub',
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_procurement_rfqs_sku ON procurement_rfqs(sku);
CREATE INDEX IF NOT EXISTS idx_procurement_rfqs_status ON procurement_rfqs(status);

CREATE TABLE IF NOT EXISTS procurement_quotations (
  id TEXT PRIMARY KEY,
  rfq_id TEXT NOT NULL REFERENCES procurement_rfqs(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  supplier_name TEXT NOT NULL,
  unit_cost_cents INTEGER NOT NULL,
  freight_cents INTEGER NOT NULL DEFAULT 0,
  duty_pct REAL NOT NULL DEFAULT 0,
  other_cents INTEGER NOT NULL DEFAULT 0,
  lead_time_days INTEGER NOT NULL,
  valid_until TEXT,
  incoterm TEXT NOT NULL DEFAULT 'DAP',
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_procurement_quotations_rfq ON procurement_quotations(rfq_id);
CREATE INDEX IF NOT EXISTS idx_procurement_quotations_supplier ON procurement_quotations(supplier_id);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  po_number TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  supplier_name TEXT NOT NULL,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  ordered_cases INTEGER NOT NULL,
  received_cases INTEGER NOT NULL DEFAULT 0,
  unit_cost_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  expected_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved',
  asn_reference TEXT,
  rfq_id TEXT,
  quotation_id TEXT,
  freight_cents INTEGER NOT NULL DEFAULT 0,
  duty_cents INTEGER NOT NULL DEFAULT 0,
  other_cents INTEGER NOT NULL DEFAULT 0,
  landed_cost_cents INTEGER,
  unit_landed_cost_cents INTEGER,
  incoterm TEXT,
  approval_status TEXT NOT NULL DEFAULT 'approved',
  approved_by TEXT,
  approved_at TEXT,
  asn_carrier TEXT,
  asn_eta TEXT,
  asn_notes TEXT,
  asn_captured_at TEXT,
  warehouse TEXT NOT NULL DEFAULT 'WH-MILAN-01',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS goods_receipts (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL REFERENCES purchase_orders(id),
  batch_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  received_cases INTEGER NOT NULL,
  accepted_cases INTEGER NOT NULL,
  rejected_cases INTEGER NOT NULL DEFAULT 0,
  temp_c REAL NOT NULL,
  quality_status TEXT NOT NULL,
  received_by TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_lots (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL UNIQUE,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  category TEXT NOT NULL,
  warehouse TEXT NOT NULL,
  location TEXT NOT NULL,
  zone TEXT NOT NULL,
  quantity_cases INTEGER NOT NULL CHECK (quantity_cases >= 0),
  received_cases INTEGER NOT NULL,
  allocated_cases INTEGER NOT NULL DEFAULT 0,
  received_date TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  supplier TEXT NOT NULL,
  supplier_lot TEXT NOT NULL,
  origin_country TEXT NOT NULL,
  quality_status TEXT NOT NULL DEFAULT 'released',
  temp_c REAL NOT NULL,
  unit_weight_kg REAL NOT NULL DEFAULT 5.0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  quantity_delta INTEGER NOT NULL,
  previous_cases INTEGER NOT NULL,
  new_cases INTEGER NOT NULL,
  reason TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS temperature_readings (
  id TEXT PRIMARY KEY,
  zone_name TEXT NOT NULL,
  warehouse TEXT NOT NULL,
  target_min_c REAL NOT NULL,
  target_max_c REAL NOT NULL,
  current_c REAL NOT NULL,
  humidity_pct INTEGER NOT NULL,
  status TEXT NOT NULL,
  sensor_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL,
  customer TEXT NOT NULL,
  segment TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  credit_hold INTEGER NOT NULL DEFAULT 0,
  credit_hold_reason TEXT,
  approved_by TEXT,
  items_count INTEGER NOT NULL,
  cases_total INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  margin_pct REAL NOT NULL,
  delivery_date TEXT NOT NULL,
  warehouse TEXT NOT NULL,
  fefo_allocated INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales_order_lines (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  cases_ordered INTEGER NOT NULL,
  cases_allocated INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  batch_id TEXT,
  weight_kg REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS warehouse_tasks (
  id TEXT PRIMARY KEY,
  task_type TEXT NOT NULL,
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  from_bin TEXT NOT NULL,
  to_bin TEXT NOT NULL,
  cases INTEGER NOT NULL,
  assignee TEXT NOT NULL,
  order_number TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  delivery_reference TEXT,
  order_id TEXT NOT NULL,
  order_number TEXT NOT NULL,
  customer_id TEXT,
  customer TEXT NOT NULL,
  delivery_address TEXT,
  warehouse TEXT NOT NULL DEFAULT 'Milan Cold Hub',
  delivery_date TEXT,
  time_window_start TEXT,
  time_window_end TEXT,
  route_code TEXT NOT NULL,
  driver_id TEXT,
  driver TEXT NOT NULL,
  vehicle_id TEXT,
  vehicle TEXT NOT NULL,
  stop_sequence INTEGER NOT NULL DEFAULT 1,
  eta TEXT NOT NULL,
  temp_c REAL NOT NULL,
  status TEXT NOT NULL,
  pod_signed INTEGER NOT NULL DEFAULT 0,
  stops_completed INTEGER NOT NULL DEFAULT 0,
  stops_total INTEGER NOT NULL DEFAULT 1,
  priority TEXT NOT NULL DEFAULT 'normal',
  total_packages INTEGER NOT NULL DEFAULT 0,
  total_pallets INTEGER NOT NULL DEFAULT 0,
  total_cases REAL NOT NULL DEFAULT 0,
  total_weight_kg REAL NOT NULL DEFAULT 0,
  departure_time TEXT,
  arrival_time TEXT,
  completed_time TEXT,
  driver_notes TEXT,
  exception TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL,
  order_number TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  customer TEXT NOT NULL,
  issued_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  sdi_status TEXT NOT NULL,
  sdi_reference TEXT,
  payment_terms TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  amount_cents INTEGER NOT NULL,
  method TEXT NOT NULL DEFAULT 'SEPA Instant',
  reference TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  paid_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_insights (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  confidence_pct INTEGER NOT NULL,
  impact_label TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  action_label TEXT NOT NULL,
  decision TEXT NOT NULL DEFAULT 'pending',
  decided_by TEXT,
  decided_at TEXT,
  decision_reason TEXT
);

CREATE TABLE IF NOT EXISTS alert_events (
  id TEXT PRIMARY KEY,
  severity TEXT NOT NULL,
  module TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recall_notifications (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  order_number TEXT NOT NULL,
  customer TEXT NOT NULL,
  notified_by TEXT NOT NULL,
  notified_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(batch_id, order_number)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  key TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Module 07: immutable per-order event timeline (submission, amendment, status
-- changes, approvals, cancellation and notification dispatch).
CREATE TABLE IF NOT EXISTS customer_order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  order_number TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor_id TEXT,
  actor_email TEXT,
  actor_role TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customer_order_events_order
  ON customer_order_events(order_id, created_at);

-- Module 07: customer-facing notifications. Scoped by customer_id so a store
-- vendor can never read another account's notifications.
CREATE TABLE IF NOT EXISTS customer_notifications (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  order_id TEXT,
  order_number TEXT,
  channel TEXT NOT NULL DEFAULT 'in_app',
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  read_at TEXT,
  sent_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customer_notifications_customer
  ON customer_notifications(customer_id, created_at);

CREATE TABLE IF NOT EXISTS inbound_shipments (
  id TEXT PRIMARY KEY,
  shipment_ref TEXT NOT NULL UNIQUE,
  supplier_id TEXT,
  supplier_name TEXT NOT NULL,
  po_id TEXT,
  po_number TEXT,
  asn_reference TEXT,
  carrier TEXT,
  vehicle_reg TEXT,
  driver_name TEXT,
  driver_phone TEXT,
  expected_arrival TEXT,
  actual_arrival TEXT,
  origin_warehouse TEXT,
  destination_warehouse TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'expected',
  transport_notes TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inbound_shipments_status ON inbound_shipments(status);
CREATE INDEX IF NOT EXISTS idx_inbound_shipments_dest ON inbound_shipments(destination_warehouse);
CREATE INDEX IF NOT EXISTS idx_inbound_shipments_supplier ON inbound_shipments(supplier_id);

CREATE TABLE IF NOT EXISTS inbound_shipment_items (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES inbound_shipments(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  ordered_qty REAL NOT NULL DEFAULT 0,
  ordered_uom TEXT,
  received_qty REAL NOT NULL DEFAULT 0,
  accepted_qty REAL NOT NULL DEFAULT 0,
  rejected_qty REAL NOT NULL DEFAULT 0,
  damaged_qty REAL NOT NULL DEFAULT 0,
  actual_weight REAL,
  expected_weight REAL,
  weight_uom TEXT,
  weight_variance_pct REAL,
  weight_discrepancy_status TEXT,
  scale_reference TEXT,
  weight_tolerance_pct REAL,
  packages INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  discrepancy_status TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inbound_items_shipment ON inbound_shipment_items(shipment_id);
CREATE INDEX IF NOT EXISTS idx_inbound_items_sku ON inbound_shipment_items(sku);

CREATE TABLE IF NOT EXISTS inbound_batches (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES inbound_shipments(id) ON DELETE CASCADE,
  item_id TEXT REFERENCES inbound_shipment_items(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  supplier_batch TEXT NOT NULL,
  internal_lot TEXT NOT NULL,
  supplier_id TEXT,
  supplier_name TEXT,
  po_id TEXT,
  po_number TEXT,
  manufacture_date TEXT,
  expiry_date TEXT NOT NULL,
  received_date TEXT NOT NULL,
  origin TEXT,
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  storage TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  accepted_qty REAL NOT NULL DEFAULT 0,
  rejected_qty REAL NOT NULL DEFAULT 0,
  quarantined_qty REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(supplier_batch, sku, supplier_id)
);

CREATE INDEX IF NOT EXISTS idx_inbound_batches_shipment ON inbound_batches(shipment_id);
CREATE INDEX IF NOT EXISTS idx_inbound_batches_sku ON inbound_batches(sku);
CREATE INDEX IF NOT EXISTS idx_inbound_batches_lot ON inbound_batches(internal_lot);

CREATE TABLE IF NOT EXISTS inbound_temperature_logs (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES inbound_shipments(id) ON DELETE CASCADE,
  sku TEXT,
  temp_c REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT 'C',
  min_c REAL NOT NULL,
  max_c REAL NOT NULL,
  recorded_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  verified_by TEXT,
  excursion INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  evidence_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inbound_temp_shipment ON inbound_temperature_logs(shipment_id);

CREATE TABLE IF NOT EXISTS inbound_documents (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES inbound_shipments(id) ON DELETE CASCADE,
  sku TEXT,
  doc_type TEXT NOT NULL,
  reference_number TEXT,
  issuer TEXT,
  issue_date TEXT,
  expiry_date TEXT,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review',
  verified_by TEXT,
  verified_at TEXT,
  review_notes TEXT,
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inbound_docs_shipment ON inbound_documents(shipment_id);

CREATE TABLE IF NOT EXISTS inbound_quality_checks (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES inbound_shipments(id) ON DELETE CASCADE,
  item_id TEXT REFERENCES inbound_shipment_items(id) ON DELETE CASCADE,
  check_type TEXT NOT NULL,
  result TEXT NOT NULL,
  notes TEXT,
  evidence TEXT,
  performed_by TEXT NOT NULL,
  performed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inbound_qc_shipment ON inbound_quality_checks(shipment_id);

CREATE TABLE IF NOT EXISTS quality_inspections (
  id TEXT PRIMARY KEY,
  inspection_number TEXT NOT NULL UNIQUE,
  shipment_id TEXT,
  shipment_reference TEXT,
  asn_reference TEXT,
  purchase_order_id TEXT,
  supplier_id TEXT,
  supplier_name TEXT NOT NULL,
  product_id TEXT,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  supplier_batch TEXT NOT NULL,
  internal_lot TEXT NOT NULL,
  warehouse TEXT NOT NULL,
  receiving_location TEXT NOT NULL DEFAULT 'RCV-STAGE-01',
  uom TEXT NOT NULL DEFAULT 'case',
  received_qty REAL NOT NULL DEFAULT 0,
  accepted_qty REAL NOT NULL DEFAULT 0,
  held_qty REAL NOT NULL DEFAULT 0,
  rejected_qty REAL NOT NULL DEFAULT 0,
  quarantined_qty REAL NOT NULL DEFAULT 0,
  expected_weight_kg REAL,
  actual_weight_kg REAL,
  weight_verified INTEGER NOT NULL DEFAULT 0,
  quantity_verified INTEGER NOT NULL DEFAULT 0,
  manufacture_date TEXT,
  expiry_date TEXT NOT NULL,
  visual_inspection TEXT NOT NULL DEFAULT 'pending',
  packaging_condition TEXT NOT NULL DEFAULT 'pending',
  product_condition TEXT NOT NULL DEFAULT 'pending',
  freshness_status TEXT NOT NULL DEFAULT 'pending',
  labelling_status TEXT NOT NULL DEFAULT 'pending',
  traceability_verified INTEGER NOT NULL DEFAULT 0,
  temp_reading_c REAL,
  temp_min_c REAL,
  temp_max_c REAL,
  temp_status TEXT NOT NULL DEFAULT 'pending',
  certificates_verified INTEGER NOT NULL DEFAULT 0,
  required_certificates_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  decision_reason TEXT,
  inspector_id TEXT,
  inspector_name TEXT,
  inspected_at TEXT,
  decided_by_id TEXT,
  decided_by_name TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_quality_inspections_status ON quality_inspections(status);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_warehouse ON quality_inspections(warehouse);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_lot ON quality_inspections(internal_lot);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_shipment ON quality_inspections(shipment_id);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_supplier ON quality_inspections(supplier_id);

CREATE TABLE IF NOT EXISTS haccp_checkpoint_templates (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  checkpoint_name TEXT NOT NULL,
  description TEXT NOT NULL,
  ccp_classification TEXT NOT NULL DEFAULT 'CCP-1',
  is_ccp INTEGER NOT NULL DEFAULT 1,
  category TEXT,
  sku TEXT,
  temp_zone TEXT,
  measurement_type TEXT NOT NULL DEFAULT 'temperature',
  min_limit REAL,
  max_limit REAL,
  unit TEXT,
  expected_text TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS haccp_checkpoint_readings (
  id TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL REFERENCES quality_inspections(id) ON DELETE CASCADE,
  shipment_id TEXT,
  template_id TEXT,
  checkpoint_code TEXT NOT NULL,
  checkpoint_name TEXT NOT NULL,
  description TEXT,
  ccp_classification TEXT NOT NULL DEFAULT 'CCP-1',
  is_ccp INTEGER NOT NULL DEFAULT 1,
  sku TEXT NOT NULL,
  internal_lot TEXT NOT NULL,
  min_limit REAL,
  max_limit REAL,
  unit TEXT,
  expected_text TEXT,
  actual_numeric REAL,
  actual_text TEXT,
  status TEXT NOT NULL DEFAULT 'pass',
  critical_violation INTEGER NOT NULL DEFAULT 0,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  inspector_id TEXT NOT NULL,
  inspector_name TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_haccp_readings_inspection ON haccp_checkpoint_readings(inspection_id);
CREATE INDEX IF NOT EXISTS idx_haccp_readings_lot ON haccp_checkpoint_readings(internal_lot);
CREATE INDEX IF NOT EXISTS idx_haccp_readings_status ON haccp_checkpoint_readings(status);

CREATE TABLE IF NOT EXISTS quality_exceptions (
  id TEXT PRIMARY KEY,
  exception_number TEXT NOT NULL UNIQUE,
  inspection_id TEXT,
  shipment_id TEXT,
  shipment_reference TEXT,
  haccp_reading_id TEXT,
  supplier_id TEXT,
  supplier_name TEXT,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  internal_lot TEXT NOT NULL,
  warehouse TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT 'RCV-STAGE-01',
  exception_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'critical',
  expected_limits TEXT NOT NULL,
  actual_reading TEXT NOT NULL,
  food_safety_impact TEXT NOT NULL,
  responsible_person TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  investigation_notes TEXT,
  resolution TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_by TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_quality_exceptions_status ON quality_exceptions(status);
CREATE INDEX IF NOT EXISTS idx_quality_exceptions_warehouse ON quality_exceptions(warehouse);
CREATE INDEX IF NOT EXISTS idx_quality_exceptions_lot ON quality_exceptions(internal_lot);

CREATE TABLE IF NOT EXISTS quality_capas (
  id TEXT PRIMARY KEY,
  capa_number TEXT NOT NULL UNIQUE,
  exception_id TEXT,
  inspection_id TEXT,
  shipment_id TEXT,
  supplier_id TEXT,
  supplier_name TEXT,
  sku TEXT,
  product_name TEXT,
  internal_lot TEXT,
  warehouse TEXT NOT NULL DEFAULT 'Milan Cold Hub',
  problem_description TEXT NOT NULL,
  root_cause TEXT,
  containment_action TEXT,
  corrective_action TEXT,
  preventive_action TEXT,
  assigned_to_id TEXT,
  assigned_to_name TEXT NOT NULL,
  target_completion_date TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  verification_notes TEXT,
  effectiveness_review TEXT,
  verified_by_id TEXT,
  verified_by_name TEXT,
  verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'Open',
  closed_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_quality_capas_status ON quality_capas(status);
CREATE INDEX IF NOT EXISTS idx_quality_capas_warehouse ON quality_capas(warehouse);
CREATE INDEX IF NOT EXISTS idx_quality_capas_lot ON quality_capas(internal_lot);

CREATE TABLE IF NOT EXISTS warehouse_zones (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  warehouse TEXT NOT NULL,
  name TEXT NOT NULL,
  zone_type TEXT NOT NULL DEFAULT 'chilled',
  min_temp_c REAL NOT NULL,
  max_temp_c REAL NOT NULL,
  allowed_categories_json TEXT NOT NULL DEFAULT '[]',
  segregation_rules_json TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_warehouse_zones_wh ON warehouse_zones(warehouse);

CREATE TABLE IF NOT EXISTS warehouse_bins (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  barcode TEXT NOT NULL UNIQUE,
  warehouse TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  zone_code TEXT NOT NULL,
  zone_name TEXT NOT NULL,
  storage_type TEXT NOT NULL DEFAULT 'chilled',
  aisle TEXT NOT NULL,
  rack TEXT NOT NULL,
  shelf TEXT NOT NULL,
  position TEXT NOT NULL,
  min_temp_c REAL NOT NULL,
  max_temp_c REAL NOT NULL,
  max_cases INTEGER NOT NULL DEFAULT 120,
  current_cases INTEGER NOT NULL DEFAULT 0,
  max_weight_kg REAL NOT NULL DEFAULT 1000.0,
  current_weight_kg REAL NOT NULL DEFAULT 0.0,
  max_volume_m3 REAL NOT NULL DEFAULT 4.0,
  current_volume_m3 REAL NOT NULL DEFAULT 0.0,
  allowed_categories_json TEXT NOT NULL DEFAULT '[]',
  restricted_allergens_json TEXT NOT NULL DEFAULT '[]',
  segregation_group TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_warehouse_bins_wh ON warehouse_bins(warehouse);
CREATE INDEX IF NOT EXISTS idx_warehouse_bins_zone ON warehouse_bins(zone_code);
CREATE INDEX IF NOT EXISTS idx_warehouse_bins_status ON warehouse_bins(status);

CREATE TABLE IF NOT EXISTS bin_stock_placements (
  id TEXT PRIMARY KEY,
  bin_id TEXT NOT NULL,
  bin_code TEXT NOT NULL,
  warehouse TEXT NOT NULL,
  zone_code TEXT NOT NULL,
  internal_lot TEXT NOT NULL,
  supplier_batch TEXT NOT NULL,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Chilled',
  quantity_cases REAL NOT NULL DEFAULT 0,
  uom TEXT NOT NULL DEFAULT 'case',
  weight_kg REAL NOT NULL DEFAULT 0,
  packages INTEGER NOT NULL DEFAULT 0,
  manufacture_date TEXT,
  expiry_date TEXT NOT NULL,
  quality_status TEXT NOT NULL DEFAULT 'released',
  temp_at_placement_c REAL,
  placed_by TEXT NOT NULL,
  placed_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(bin_code, internal_lot)
);

CREATE INDEX IF NOT EXISTS idx_bin_stock_bin ON bin_stock_placements(bin_code);
CREATE INDEX IF NOT EXISTS idx_bin_stock_lot ON bin_stock_placements(internal_lot);
CREATE INDEX IF NOT EXISTS idx_bin_stock_sku ON bin_stock_placements(sku);

CREATE TABLE IF NOT EXISTS putaway_tasks (
  id TEXT PRIMARY KEY,
  task_number TEXT NOT NULL UNIQUE,
  inspection_id TEXT,
  shipment_id TEXT,
  shipment_reference TEXT,
  asn_reference TEXT,
  purchase_order_id TEXT,
  supplier_id TEXT,
  supplier_name TEXT NOT NULL,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Chilled',
  supplier_batch TEXT NOT NULL,
  internal_lot TEXT NOT NULL,
  manufacture_date TEXT,
  expiry_date TEXT NOT NULL,
  warehouse TEXT NOT NULL,
  receiving_location TEXT NOT NULL DEFAULT 'RCV-STAGE-01',
  uom TEXT NOT NULL DEFAULT 'case',
  total_eligible_qty REAL NOT NULL,
  placed_qty REAL NOT NULL DEFAULT 0,
  remaining_qty REAL NOT NULL,
  expected_weight_kg REAL NOT NULL DEFAULT 0,
  actual_weight_kg REAL,
  placed_weight_kg REAL NOT NULL DEFAULT 0,
  packages INTEGER NOT NULL DEFAULT 0,
  temp_reading_c REAL,
  temp_min_c REAL NOT NULL DEFAULT 0,
  temp_max_c REAL NOT NULL DEFAULT 4,
  temp_status TEXT NOT NULL DEFAULT 'in_range',
  quality_status TEXT NOT NULL DEFAULT 'released',
  recommended_zone_code TEXT,
  recommended_bin_code TEXT,
  recommendation_reason TEXT,
  recommendation_score INTEGER,
  assigned_bin_code TEXT,
  override_reason TEXT,
  overridden_by TEXT,
  overridden_at TEXT,
  assigned_operator_id TEXT,
  assigned_operator_name TEXT,
  priority TEXT NOT NULL DEFAULT 'high',
  status TEXT NOT NULL DEFAULT 'Ready for Put-away',
  status_changed_by TEXT,
  status_changed_at TEXT,
  scan_task_verified INTEGER NOT NULL DEFAULT 0,
  scan_sku_verified INTEGER NOT NULL DEFAULT 0,
  scan_lot_verified INTEGER NOT NULL DEFAULT 0,
  scan_bin_verified INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_putaway_tasks_status ON putaway_tasks(status);
CREATE INDEX IF NOT EXISTS idx_putaway_tasks_wh ON putaway_tasks(warehouse);
CREATE INDEX IF NOT EXISTS idx_putaway_tasks_lot ON putaway_tasks(internal_lot);

CREATE TABLE IF NOT EXISTS putaway_placements (
  id TEXT PRIMARY KEY,
  placement_number TEXT NOT NULL UNIQUE,
  task_id TEXT NOT NULL REFERENCES putaway_tasks(id) ON DELETE CASCADE,
  task_number TEXT NOT NULL,
  internal_lot TEXT NOT NULL,
  supplier_batch TEXT NOT NULL,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  warehouse TEXT NOT NULL,
  from_location TEXT NOT NULL,
  to_zone_code TEXT NOT NULL,
  to_bin_code TEXT NOT NULL,
  expected_qty REAL NOT NULL,
  placed_qty REAL NOT NULL,
  remaining_qty_after REAL NOT NULL,
  uom TEXT NOT NULL DEFAULT 'case',
  packages INTEGER NOT NULL DEFAULT 0,
  expected_weight_kg REAL NOT NULL DEFAULT 0,
  actual_weight_kg REAL NOT NULL DEFAULT 0,
  weight_variance_kg REAL NOT NULL DEFAULT 0,
  weight_variance_pct REAL NOT NULL DEFAULT 0,
  discrepancy_notes TEXT,
  temp_c REAL,
  temp_status TEXT NOT NULL DEFAULT 'in_range',
  scan_method TEXT NOT NULL DEFAULT 'barcode_scan',
  movement_id TEXT,
  operator_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  placed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_putaway_placements_task ON putaway_placements(task_id);
CREATE INDEX IF NOT EXISTS idx_putaway_placements_lot ON putaway_placements(internal_lot);

CREATE TABLE IF NOT EXISTS putaway_scan_logs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  scan_step TEXT NOT NULL,
  scanned_value TEXT NOT NULL,
  expected_value TEXT NOT NULL,
  scan_mode TEXT NOT NULL DEFAULT 'scanner',
  valid INTEGER NOT NULL DEFAULT 1,
  failure_reason TEXT,
  scanned_by TEXT NOT NULL,
  scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_putaway_scans_task ON putaway_scan_logs(task_id);

CREATE TABLE IF NOT EXISTS shelf_life_rules (
  id TEXT PRIMARY KEY,
  rule_code TEXT NOT NULL UNIQUE,
  rule_scope TEXT NOT NULL DEFAULT 'product',
  sku TEXT,
  product_name TEXT,
  category TEXT,
  customer_id TEXT,
  customer_name TEXT,
  customer_segment TEXT,
  min_remaining_days INTEGER NOT NULL DEFAULT 2,
  min_remaining_pct REAL,
  enforce_at_allocation INTEGER NOT NULL DEFAULT 1,
  enforce_at_pick INTEGER NOT NULL DEFAULT 1,
  allow_manager_override INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_shelf_life_rules_sku ON shelf_life_rules(sku);
CREATE INDEX IF NOT EXISTS idx_shelf_life_rules_customer ON shelf_life_rules(customer_id);

CREATE TABLE IF NOT EXISTS stock_reservations (
  id TEXT PRIMARY KEY,
  reservation_number TEXT NOT NULL UNIQUE,
  order_id TEXT,
  order_number TEXT,
  order_line_id TEXT,
  customer_id TEXT,
  customer_name TEXT,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  internal_lot TEXT NOT NULL,
  supplier_batch TEXT,
  warehouse TEXT NOT NULL,
  zone TEXT,
  bin_code TEXT,
  requested_cases REAL NOT NULL,
  reserved_cases REAL NOT NULL,
  reserved_weight_kg REAL NOT NULL DEFAULT 0,
  uom TEXT NOT NULL DEFAULT 'case',
  delivery_date TEXT,
  min_shelf_life_days_required INTEGER NOT NULL DEFAULT 0,
  days_remaining_at_delivery INTEGER,
  fefo_rank INTEGER,
  selection_reason TEXT,
  status TEXT NOT NULL DEFAULT 'Active',
  pick_task_id TEXT,
  expires_at TEXT NOT NULL,
  released_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stock_reservations_lot ON stock_reservations(internal_lot);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_sku ON stock_reservations(sku);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_order ON stock_reservations(order_number);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_status ON stock_reservations(status);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_wh ON stock_reservations(warehouse);

CREATE TABLE IF NOT EXISTS stock_reservation_events (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES stock_reservations(id) ON DELETE CASCADE,
  reservation_number TEXT NOT NULL,
  event_type TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  quantity_cases REAL NOT NULL,
  reason TEXT,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stock_res_events_res ON stock_reservation_events(reservation_id);

CREATE TABLE IF NOT EXISTS fefo_allocation_logs (
  id TEXT PRIMARY KEY,
  allocation_ref TEXT NOT NULL,
  order_number TEXT,
  customer_id TEXT,
  customer_name TEXT,
  sku TEXT NOT NULL,
  warehouse TEXT,
  delivery_date TEXT NOT NULL,
  requested_cases REAL NOT NULL,
  allocated_cases REAL NOT NULL,
  min_shelf_life_days INTEGER NOT NULL DEFAULT 0,
  internal_lot TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  days_at_delivery INTEGER NOT NULL,
  decision TEXT NOT NULL,
  lot_allocated_cases REAL NOT NULL DEFAULT 0,
  reason_code TEXT NOT NULL,
  reason_detail TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fefo_logs_ref ON fefo_allocation_logs(allocation_ref);
CREATE INDEX IF NOT EXISTS idx_fefo_logs_sku ON fefo_allocation_logs(sku);
CREATE INDEX IF NOT EXISTS idx_fefo_logs_lot ON fefo_allocation_logs(internal_lot);

CREATE TABLE IF NOT EXISTS cycle_counts (
  id TEXT PRIMARY KEY,
  count_number TEXT NOT NULL UNIQUE,
  count_type TEXT NOT NULL DEFAULT 'scheduled',
  warehouse TEXT NOT NULL,
  zone TEXT,
  bin_code TEXT NOT NULL,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  internal_lot TEXT NOT NULL,
  supplier_batch TEXT,
  is_blind INTEGER NOT NULL DEFAULT 1,
  expected_cases REAL NOT NULL,
  expected_weight_kg REAL NOT NULL,
  counted_cases REAL,
  counted_weight_kg REAL,
  variance_cases REAL,
  variance_weight_kg REAL,
  unit_weight_kg REAL NOT NULL DEFAULT 5.0,
  barcode_scanned TEXT,
  scan_verified INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Assigned',
  recount_number INTEGER NOT NULL DEFAULT 0,
  assigned_to_id TEXT,
  assigned_to_name TEXT NOT NULL,
  scheduled_date TEXT NOT NULL,
  counted_by_id TEXT,
  counted_by_name TEXT,
  counted_at TEXT,
  approved_by_id TEXT,
  approved_by_name TEXT,
  approved_at TEXT,
  approval_notes TEXT,
  adjustment_id TEXT,
  discrepancy_reason TEXT,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cycle_counts_wh ON cycle_counts(warehouse);
CREATE INDEX IF NOT EXISTS idx_cycle_counts_status ON cycle_counts(status);
CREATE INDEX IF NOT EXISTS idx_cycle_counts_lot ON cycle_counts(internal_lot);

CREATE TABLE IF NOT EXISTS cycle_count_history (
  id TEXT PRIMARY KEY,
  cycle_count_id TEXT NOT NULL REFERENCES cycle_counts(id) ON DELETE CASCADE,
  count_number TEXT NOT NULL,
  action TEXT NOT NULL,
  recount_number INTEGER NOT NULL DEFAULT 0,
  expected_cases REAL,
  counted_cases REAL,
  variance_cases REAL,
  counted_weight_kg REAL,
  notes TEXT,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cycle_count_hist_cc ON cycle_count_history(cycle_count_id);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id TEXT PRIMARY KEY,
  adjustment_number TEXT NOT NULL UNIQUE,
  warehouse TEXT NOT NULL,
  zone TEXT,
  bin_code TEXT,
  target_bin_code TEXT,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  internal_lot TEXT NOT NULL,
  supplier_batch TEXT,
  adjustment_type TEXT NOT NULL,
  target_status TEXT NOT NULL DEFAULT 'Available',
  original_cases REAL NOT NULL,
  actual_cases REAL NOT NULL,
  difference_cases REAL NOT NULL,
  original_weight_kg REAL NOT NULL,
  actual_weight_kg REAL NOT NULL,
  difference_weight_kg REAL NOT NULL,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0,
  value_impact_cents INTEGER NOT NULL DEFAULT 0,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Pending Approval',
  reason TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  cycle_count_id TEXT,
  movement_id TEXT,
  idempotency_key TEXT UNIQUE,
  requested_by_id TEXT NOT NULL,
  requested_by_name TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_by_id TEXT,
  approved_by_name TEXT,
  approved_at TEXT,
  approval_notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_wh ON stock_adjustments(warehouse);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_status ON stock_adjustments(status);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_lot ON stock_adjustments(internal_lot);

CREATE TABLE IF NOT EXISTS customer_contracts (
  id TEXT PRIMARY KEY,
  contract_number TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  title TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  payment_terms TEXT NOT NULL DEFAULT 'Net 30',
  credit_limit_cents INTEGER,
  discount_pct REAL NOT NULL DEFAULT 0.0,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customer_contracts_cust ON customer_contracts(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_contracts_status ON customer_contracts(status);

CREATE TABLE IF NOT EXISTS customer_contract_items (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES customer_contracts(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  uom TEXT NOT NULL DEFAULT 'case',
  min_quantity INTEGER NOT NULL DEFAULT 1,
  discount_pct REAL NOT NULL DEFAULT 0.0,
  promotional_price_cents INTEGER,
  promo_start TEXT,
  promo_end TEXT,
  customer_sku TEXT,
  is_exclusive INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contract_items_contract ON customer_contract_items(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_items_sku ON customer_contract_items(sku);

-- ============================================================================
-- Module 08: Picking, Packing, Catch-Weight & Dispatch Staging
-- ============================================================================

CREATE TABLE IF NOT EXISTS pick_waves (
  id TEXT PRIMARY KEY,
  wave_number TEXT NOT NULL UNIQUE,
  warehouse TEXT NOT NULL,
  zone TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'wave_created',
  strategy TEXT NOT NULL DEFAULT 'multi_order_batch',
  assigned_picker_id TEXT,
  assigned_picker_name TEXT,
  scheduled_delivery_date TEXT,
  route_code TEXT,
  orders_count INTEGER NOT NULL DEFAULT 0,
  tasks_count INTEGER NOT NULL DEFAULT 0,
  cases_total REAL NOT NULL DEFAULT 0,
  cases_picked REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pick_waves_warehouse ON pick_waves(warehouse);
CREATE INDEX IF NOT EXISTS idx_pick_waves_status ON pick_waves(status);

CREATE TABLE IF NOT EXISTS pick_wave_orders (
  id TEXT PRIMARY KEY,
  wave_id TEXT NOT NULL REFERENCES pick_waves(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES sales_orders(id),
  order_number TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wave_orders_wave ON pick_wave_orders(wave_id);
CREATE INDEX IF NOT EXISTS idx_wave_orders_order ON pick_wave_orders(order_id);

CREATE TABLE IF NOT EXISTS pick_tasks (
  id TEXT PRIMARY KEY,
  task_number TEXT NOT NULL UNIQUE,
  wave_id TEXT NOT NULL REFERENCES pick_waves(id) ON DELETE CASCADE,
  wave_number TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES sales_orders(id),
  order_number TEXT NOT NULL,
  order_line_id TEXT,
  customer_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  uom TEXT NOT NULL DEFAULT 'case',
  requested_cases REAL NOT NULL,
  picked_cases REAL NOT NULL DEFAULT 0,
  allocated_lot TEXT NOT NULL,
  supplier_lot TEXT,
  expiry_date TEXT NOT NULL,
  warehouse TEXT NOT NULL,
  zone TEXT NOT NULL,
  bin_code TEXT NOT NULL,
  aisle TEXT,
  shelf_level TEXT,
  route_sequence INTEGER NOT NULL DEFAULT 0,
  barcode_sku TEXT NOT NULL,
  barcode_bin TEXT NOT NULL,
  barcode_lot TEXT NOT NULL,
  is_catch_weight INTEGER NOT NULL DEFAULT 0,
  expected_weight_kg REAL NOT NULL DEFAULT 0,
  actual_weight_kg REAL,
  weight_variance_pct REAL,
  weight_tolerance_pct REAL NOT NULL DEFAULT 5.0,
  weight_approved_by TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  assigned_to TEXT,
  picker_id TEXT,
  picker_name TEXT,
  scanned_sku TEXT,
  scanned_bin TEXT,
  scanned_lot TEXT,
  manual_entry_reason TEXT,
  picked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pick_tasks_wave ON pick_tasks(wave_id);
CREATE INDEX IF NOT EXISTS idx_pick_tasks_order ON pick_tasks(order_number);
CREATE INDEX IF NOT EXISTS idx_pick_tasks_status ON pick_tasks(status);
CREATE INDEX IF NOT EXISTS idx_pick_tasks_route ON pick_tasks(warehouse, route_sequence);

CREATE TABLE IF NOT EXISTS packing_records (
  id TEXT PRIMARY KEY,
  pack_number TEXT NOT NULL UNIQUE,
  wave_id TEXT,
  order_id TEXT NOT NULL REFERENCES sales_orders(id),
  order_number TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  package_type TEXT NOT NULL DEFAULT 'carton',
  sscc_barcode TEXT NOT NULL UNIQUE,
  container_id TEXT NOT NULL,
  temp_zone TEXT NOT NULL DEFAULT 'chilled',
  temp_condition_verified INTEGER NOT NULL DEFAULT 1,
  segregation_verified INTEGER NOT NULL DEFAULT 1,
  packaging_condition_verified INTEGER NOT NULL DEFAULT 1,
  customer_instructions_verified INTEGER NOT NULL DEFAULT 1,
  total_cases REAL NOT NULL DEFAULT 0,
  total_weight_kg REAL NOT NULL DEFAULT 0,
  staging_bin TEXT,
  staged_at TEXT,
  staged_by TEXT,
  status TEXT NOT NULL DEFAULT 'packed',
  packed_by TEXT NOT NULL,
  packed_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_packing_records_order ON packing_records(order_number);
CREATE INDEX IF NOT EXISTS idx_packing_records_sscc ON packing_records(sscc_barcode);

CREATE TABLE IF NOT EXISTS packing_record_items (
  id TEXT PRIMARY KEY,
  packing_id TEXT NOT NULL REFERENCES packing_records(id) ON DELETE CASCADE,
  pick_task_id TEXT REFERENCES pick_tasks(id),
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  lot_batch TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  cases_packed REAL NOT NULL,
  weight_kg REAL NOT NULL,
  uom TEXT NOT NULL DEFAULT 'case'
);

CREATE INDEX IF NOT EXISTS idx_packing_items_packing ON packing_record_items(packing_id);

CREATE TABLE IF NOT EXISTS dispatch_staging_lanes (
  id TEXT PRIMARY KEY,
  warehouse TEXT NOT NULL,
  lane_code TEXT NOT NULL UNIQUE,
  zone TEXT NOT NULL,
  capacity_pallets INTEGER NOT NULL DEFAULT 10,
  current_occupancy INTEGER NOT NULL DEFAULT 0,
  assigned_route TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_staging_lanes_wh ON dispatch_staging_lanes(warehouse);

-- ============================================================================
-- Module 09: Loading and Delivery (Vehicles, Drivers, Manifests, Inspections, POD, Offline Sync)
-- ============================================================================

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  registration_number TEXT NOT NULL UNIQUE,
  vehicle_name TEXT NOT NULL,
  make_model TEXT NOT NULL,
  vehicle_type TEXT NOT NULL,
  warehouse TEXT NOT NULL DEFAULT 'Milan Cold Hub',
  max_payload_kg REAL NOT NULL,
  max_pallets INTEGER NOT NULL,
  max_volume_m3 REAL NOT NULL,
  temperature_capability TEXT NOT NULL,
  has_chilled_compartment INTEGER NOT NULL DEFAULT 1,
  has_frozen_compartment INTEGER NOT NULL DEFAULT 0,
  has_ambient_compartment INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  inspection_status TEXT NOT NULL DEFAULT 'passed',
  inspection_expiry_date TEXT,
  atp_expiry_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vehicles_wh ON vehicles(warehouse);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);

CREATE TABLE IF NOT EXISTS drivers (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  warehouse TEXT NOT NULL DEFAULT 'Milan Cold Hub',
  license_number TEXT NOT NULL,
  license_type TEXT NOT NULL,
  license_expiry_date TEXT NOT NULL,
  cqc_expiry_date TEXT,
  medical_expiry_date TEXT,
  status TEXT NOT NULL DEFAULT 'available',
  assigned_vehicle_id TEXT REFERENCES vehicles(id),
  current_route_code TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_drivers_wh ON drivers(warehouse);
CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(status);

CREATE TABLE IF NOT EXISTS delivery_stops (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  route_code TEXT NOT NULL,
  stop_number INTEGER NOT NULL,
  customer_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  delivery_address TEXT NOT NULL,
  time_window_start TEXT NOT NULL,
  time_window_end TEXT NOT NULL,
  driver_instructions TEXT,
  stop_status TEXT NOT NULL DEFAULT 'pending',
  arrival_time TEXT,
  departure_time TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_delivery_stops_del ON delivery_stops(delivery_id);
CREATE INDEX IF NOT EXISTS idx_delivery_stops_route ON delivery_stops(route_code);

CREATE TABLE IF NOT EXISTS delivery_manifest_items (
  id TEXT PRIMARY KEY,
  manifest_number TEXT NOT NULL,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  order_number TEXT NOT NULL,
  order_line_id TEXT,
  packing_record_id TEXT,
  sscc_barcode TEXT,
  container_id TEXT,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  lot_batch TEXT NOT NULL,
  cases REAL NOT NULL,
  weight_kg REAL NOT NULL,
  uom TEXT NOT NULL DEFAULT 'case',
  temp_zone TEXT NOT NULL DEFAULT 'chilled',
  compartment TEXT NOT NULL DEFAULT 'chilled',
  loading_sequence INTEGER NOT NULL DEFAULT 1,
  is_scanned_loaded INTEGER NOT NULL DEFAULT 0,
  scanned_barcode TEXT,
  scanned_at TEXT,
  scanned_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_manifest_items_del ON delivery_manifest_items(delivery_id);
CREATE INDEX IF NOT EXISTS idx_manifest_items_sscc ON delivery_manifest_items(sscc_barcode);

CREATE TABLE IF NOT EXISTS vehicle_inspections (
  id TEXT PRIMARY KEY,
  inspection_number TEXT NOT NULL UNIQUE,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  vehicle_registration TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  driver_name TEXT NOT NULL,
  warehouse TEXT NOT NULL DEFAULT 'Milan Cold Hub',
  route_code TEXT,
  delivery_id TEXT,
  cleanliness_passed INTEGER NOT NULL DEFAULT 1,
  cleanliness_notes TEXT,
  vehicle_condition_passed INTEGER NOT NULL DEFAULT 1,
  vehicle_condition_notes TEXT,
  reefer_functioning INTEGER NOT NULL DEFAULT 1,
  chilled_temp_c REAL,
  chilled_temp_valid INTEGER NOT NULL DEFAULT 1,
  frozen_temp_c REAL,
  frozen_temp_valid INTEGER NOT NULL DEFAULT 1,
  compartment_dividers_secure INTEGER NOT NULL DEFAULT 1,
  load_capacity_valid INTEGER NOT NULL DEFAULT 1,
  transport_documents_verified INTEGER NOT NULL DEFAULT 1,
  driver_confirmed INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'passed',
  failed_reason TEXT,
  inspected_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vehicle_inspections_veh ON vehicle_inspections(vehicle_id);

CREATE TABLE IF NOT EXISTS delivery_temperature_logs (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  vehicle_id TEXT,
  vehicle_registration TEXT,
  route_code TEXT,
  compartment TEXT NOT NULL,
  stage TEXT NOT NULL,
  expected_temp_min_c REAL NOT NULL,
  expected_temp_max_c REAL NOT NULL,
  actual_temp_c REAL NOT NULL,
  is_excursion INTEGER NOT NULL DEFAULT 0,
  excursion_severity TEXT,
  sensor_or_driver_id TEXT NOT NULL,
  recorded_by_name TEXT NOT NULL,
  quality_exception_id TEXT,
  notes TEXT,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_temp_logs_del ON delivery_temperature_logs(delivery_id);

CREATE TABLE IF NOT EXISTS delivery_proofs (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  order_number TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_role TEXT,
  signature_data TEXT NOT NULL,
  photo_url TEXT,
  delivered_cases REAL NOT NULL,
  accepted_cases REAL NOT NULL,
  rejected_cases REAL NOT NULL DEFAULT 0,
  driver_id TEXT NOT NULL,
  driver_name TEXT NOT NULL,
  delivery_notes TEXT,
  captured_at TEXT NOT NULL DEFAULT (datetime('now')),
  sync_status TEXT NOT NULL DEFAULT 'synced'
);

CREATE INDEX IF NOT EXISTS idx_delivery_proofs_del ON delivery_proofs(delivery_id);

CREATE TABLE IF NOT EXISTS delivery_exceptions (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  order_id TEXT,
  order_number TEXT,
  exception_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  reason TEXT NOT NULL,
  affected_sku TEXT,
  affected_lot TEXT,
  affected_cases REAL,
  photo_url TEXT,
  customer_acknowledged INTEGER NOT NULL DEFAULT 0,
  follow_up_action TEXT NOT NULL DEFAULT 'return_to_warehouse',
  driver_id TEXT NOT NULL,
  driver_name TEXT NOT NULL,
  reported_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'open',
  resolution_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_deliv_exceptions_del ON delivery_exceptions(delivery_id);

CREATE TABLE IF NOT EXISTS offline_sync_queue (
  id TEXT PRIMARY KEY,
  sync_action_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  driver_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  device_timestamp TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  processed_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_driver ON offline_sync_queue(driver_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON offline_sync_queue(status);

-- Module 10 Finance Tables
CREATE TABLE IF NOT EXISTS invoice_lines (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  order_line_id TEXT,
  delivery_manifest_item_id TEXT,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  cases_delivered REAL NOT NULL DEFAULT 1,
  catch_weight_kg REAL NOT NULL DEFAULT 0,
  unit_price_cents INTEGER NOT NULL,
  discount_pct REAL NOT NULL DEFAULT 0,
  tax_rate_pct REAL NOT NULL DEFAULT 10.0,
  subtotal_cents INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  lot_batch TEXT
);

CREATE INDEX IF NOT EXISTS idx_inv_lines_inv ON invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_inv_lines_sku ON invoice_lines(sku);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  allocated_cents INTEGER NOT NULL,
  allocated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pay_alloc_pay ON payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_pay_alloc_inv ON payment_allocations(invoice_id);

CREATE TABLE IF NOT EXISTS bank_statements (
  id TEXT PRIMARY KEY,
  statement_reference TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_checksum TEXT NOT NULL UNIQUE,
  account_iban TEXT,
  opening_balance_cents INTEGER NOT NULL DEFAULT 0,
  closing_balance_cents INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  imported_by TEXT NOT NULL,
  total_lines INTEGER NOT NULL DEFAULT 0,
  matched_lines INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'reconciled'
);

CREATE INDEX IF NOT EXISTS idx_bank_stmt_ref ON bank_statements(statement_reference);
CREATE INDEX IF NOT EXISTS idx_bank_stmt_status ON bank_statements(status);

CREATE TABLE IF NOT EXISTS bank_statement_lines (
  id TEXT PRIMARY KEY,
  statement_id TEXT NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  transaction_date TEXT NOT NULL,
  value_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  counterparty_name TEXT,
  counterparty_iban TEXT,
  bank_reference TEXT,
  description TEXT NOT NULL,
  reconciliation_status TEXT NOT NULL DEFAULT 'unmatched',
  matched_invoice_id TEXT REFERENCES invoices(id),
  matched_payment_id TEXT REFERENCES payments(id),
  reconciled_by TEXT,
  reconciled_at TEXT,
  reconciliation_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_stmt_lines_stmt ON bank_statement_lines(statement_id);
CREATE INDEX IF NOT EXISTS idx_stmt_lines_status ON bank_statement_lines(reconciliation_status);
CREATE INDEX IF NOT EXISTS idx_stmt_lines_inv ON bank_statement_lines(matched_invoice_id);

CREATE TABLE IF NOT EXISTS landed_cost_allocations (
  id TEXT PRIMARY KEY,
  po_id TEXT REFERENCES purchase_orders(id),
  batch_id TEXT,
  allocation_number TEXT NOT NULL UNIQUE,
  allocation_method TEXT NOT NULL,
  total_freight_cents INTEGER NOT NULL DEFAULT 0,
  total_customs_duty_cents INTEGER NOT NULL DEFAULT 0,
  total_insurance_cents INTEGER NOT NULL DEFAULT 0,
  total_handling_cents INTEGER NOT NULL DEFAULT 0,
  total_other_cents INTEGER NOT NULL DEFAULT 0,
  total_landed_cost_cents INTEGER NOT NULL DEFAULT 0,
  allocated_by TEXT NOT NULL,
  allocated_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_landed_alloc_po ON landed_cost_allocations(po_id);
CREATE INDEX IF NOT EXISTS idx_landed_alloc_batch ON landed_cost_allocations(batch_id);

CREATE TABLE IF NOT EXISTS landed_cost_items (
  id TEXT PRIMARY KEY,
  allocation_id TEXT NOT NULL REFERENCES landed_cost_allocations(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  cases REAL NOT NULL DEFAULT 1,
  weight_kg REAL NOT NULL DEFAULT 0,
  base_purchase_cost_cents INTEGER NOT NULL,
  allocated_freight_cents INTEGER NOT NULL DEFAULT 0,
  allocated_duty_cents INTEGER NOT NULL DEFAULT 0,
  allocated_insurance_cents INTEGER NOT NULL DEFAULT 0,
  allocated_handling_cents INTEGER NOT NULL DEFAULT 0,
  total_allocated_cents INTEGER NOT NULL DEFAULT 0,
  final_unit_cost_cents INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_landed_items_alloc ON landed_cost_items(allocation_id);
CREATE INDEX IF NOT EXISTS idx_landed_items_sku ON landed_cost_items(sku);
CREATE INDEX IF NOT EXISTS idx_landed_items_batch ON landed_cost_items(batch_id);

CREATE TABLE IF NOT EXISTS sdi_transmissions (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  file_name TEXT NOT NULL,
  xml_content TEXT NOT NULL,
  xml_hash TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'Aruba_SDI_Hub',
  transmission_status TEXT NOT NULL DEFAULT 'generated',
  validation_errors_json TEXT,
  provider_transmission_id TEXT,
  sdi_identifier TEXT,
  sdi_notification_type TEXT,
  sdi_notification_date TEXT,
  sdi_raw_notification TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sdi_tx_inv ON sdi_transmissions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_sdi_tx_status ON sdi_transmissions(transmission_status);

-- Module 11 Exceptions & Recall Tables
CREATE TABLE IF NOT EXISTS recalls (
  id TEXT PRIMARY KEY,
  recall_number TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  classification TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  reason_category TEXT NOT NULL,
  risk_assessment TEXT NOT NULL,
  affected_sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  affected_lot TEXT NOT NULL,
  supplier_batch TEXT,
  supplier_id TEXT,
  supplier_name TEXT,
  warehouse TEXT NOT NULL DEFAULT 'Milan Cold Hub',
  total_affected_cases REAL NOT NULL DEFAULT 0,
  total_affected_weight_kg REAL NOT NULL DEFAULT 0,
  recovered_cases REAL NOT NULL DEFAULT 0,
  recovered_weight_kg REAL NOT NULL DEFAULT 0,
  disposed_cases REAL NOT NULL DEFAULT 0,
  disposed_weight_kg REAL NOT NULL DEFAULT 0,
  initiated_by_id TEXT NOT NULL,
  initiated_by_name TEXT NOT NULL,
  initiated_by_role TEXT NOT NULL,
  initiated_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_by_id TEXT,
  approved_by_name TEXT,
  approved_by_role TEXT,
  approved_at TEXT,
  target_recovery_date TEXT,
  closed_by_id TEXT,
  closed_by_name TEXT,
  closed_at TEXT,
  closure_notes TEXT,
  capa_id TEXT REFERENCES quality_capas(id),
  regulatory_agency_notified INTEGER NOT NULL DEFAULT 0,
  regulatory_agency_name TEXT,
  regulatory_reference TEXT,
  public_alert_issued INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recalls_status ON recalls(status);
CREATE INDEX IF NOT EXISTS idx_recalls_sku ON recalls(affected_sku);
CREATE INDEX IF NOT EXISTS idx_recalls_lot ON recalls(affected_lot);

CREATE TABLE IF NOT EXISTS recall_affected_customers (
  id TEXT PRIMARY KEY,
  recall_id TEXT NOT NULL REFERENCES recalls(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_contact TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  order_id TEXT,
  order_number TEXT NOT NULL,
  delivery_id TEXT,
  delivery_reference TEXT,
  invoice_id TEXT,
  invoice_number TEXT,
  delivered_date TEXT NOT NULL,
  delivered_cases REAL NOT NULL,
  delivered_weight_kg REAL NOT NULL DEFAULT 0,
  notification_status TEXT NOT NULL DEFAULT 'pending',
  notified_at TEXT,
  acknowledged_at TEXT,
  recovered_cases REAL NOT NULL DEFAULT 0,
  recovered_weight_kg REAL NOT NULL DEFAULT 0,
  disposed_by_customer_cases REAL NOT NULL DEFAULT 0,
  remaining_unrecovered_cases REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(recall_id, customer_id, order_number)
);

CREATE INDEX IF NOT EXISTS idx_recall_aff_cust_recall ON recall_affected_customers(recall_id);
CREATE INDEX IF NOT EXISTS idx_recall_aff_cust_order ON recall_affected_customers(order_number);

CREATE TABLE IF NOT EXISTS quarantine_actions (
  id TEXT PRIMARY KEY,
  action_number TEXT NOT NULL UNIQUE,
  lot_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  warehouse TEXT NOT NULL DEFAULT 'Milan Cold Hub',
  action_type TEXT NOT NULL,
  previous_quality_status TEXT NOT NULL,
  new_quality_status TEXT NOT NULL,
  quarantined_cases REAL NOT NULL,
  quarantined_weight_kg REAL NOT NULL DEFAULT 0,
  zone_code TEXT,
  bin_code TEXT,
  quarantine_bin_code TEXT,
  reason TEXT NOT NULL,
  authorized_by_id TEXT NOT NULL,
  authorized_by_name TEXT NOT NULL,
  authorized_by_role TEXT NOT NULL,
  recall_id TEXT REFERENCES recalls(id),
  exception_id TEXT REFERENCES quality_exceptions(id),
  action_timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  released_by_id TEXT,
  released_by_name TEXT,
  released_at TEXT,
  release_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_quarantine_lot ON quarantine_actions(lot_id);
CREATE INDEX IF NOT EXISTS idx_quarantine_sku ON quarantine_actions(sku);
CREATE INDEX IF NOT EXISTS idx_quarantine_recall ON quarantine_actions(recall_id);

CREATE TABLE IF NOT EXISTS recall_recovery_logs (
  id TEXT PRIMARY KEY,
  recall_id TEXT NOT NULL REFERENCES recalls(id) ON DELETE CASCADE,
  affected_customer_id TEXT REFERENCES recall_affected_customers(id),
  customer_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  order_number TEXT,
  lot_id TEXT NOT NULL,
  recovered_cases REAL NOT NULL,
  recovered_weight_kg REAL NOT NULL DEFAULT 0,
  action_type TEXT NOT NULL DEFAULT 'returned_to_warehouse',
  receipt_warehouse TEXT NOT NULL DEFAULT 'Milan Cold Hub',
  quarantine_bin_code TEXT NOT NULL DEFAULT 'QUAR-ZONE-01',
  destruction_certificate_ref TEXT,
  seal_number TEXT,
  carrier TEXT,
  vehicle_reg TEXT,
  condition_on_receipt TEXT,
  temp_c REAL,
  received_by_id TEXT NOT NULL,
  received_by_name TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  verified_by_qa_id TEXT,
  verified_by_qa_name TEXT,
  verified_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recovery_logs_recall ON recall_recovery_logs(recall_id);
CREATE INDEX IF NOT EXISTS idx_recovery_logs_lot ON recall_recovery_logs(lot_id);

CREATE TABLE IF NOT EXISTS ai_action_logs (
  id TEXT PRIMARY KEY,
  action_reference TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'heuristic_engine',
  model TEXT NOT NULL DEFAULT 'rule_governor_v1',
  action_type TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'medium',
  target_entity_type TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  recommendation_text TEXT NOT NULL,
  proposed_payload_json TEXT NOT NULL,
  validation_status TEXT NOT NULL DEFAULT 'valid',
  validation_notes TEXT,
  approval_status TEXT NOT NULL DEFAULT 'proposed',
  requested_by_id TEXT NOT NULL,
  requested_by_name TEXT NOT NULL,
  approved_by_id TEXT,
  approved_by_name TEXT,
  approved_at TEXT,
  rejection_reason TEXT,
  execution_status TEXT NOT NULL DEFAULT 'pending',
  execution_result_json TEXT,
  executed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_action_logs_status ON ai_action_logs(approval_status, execution_status);
CREATE INDEX IF NOT EXISTS idx_ai_action_logs_ref ON ai_action_logs(action_reference);

CREATE TABLE IF NOT EXISTS operational_anomalies (
  id TEXT PRIMARY KEY,
  anomaly_number TEXT NOT NULL UNIQUE,
  anomaly_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  explanation TEXT NOT NULL,
  supporting_data_json TEXT NOT NULL,
  related_entity_type TEXT NOT NULL,
  related_entity_id TEXT NOT NULL,
  suggested_investigation TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'detected',
  fingerprint TEXT NOT NULL UNIQUE,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_notes TEXT,
  detected_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_anomalies_status ON operational_anomalies(review_status);
CREATE INDEX IF NOT EXISTS idx_anomalies_fingerprint ON operational_anomalies(fingerprint);
CREATE INDEX IF NOT EXISTS idx_anomalies_type ON operational_anomalies(anomaly_type);

-- ============================================================================
-- Module 13: Fast-Food Store / Vendor Monitoring Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS store_account_history (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  notes TEXT,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_store_acc_hist_store ON store_account_history(store_id);

CREATE TABLE IF NOT EXISTS store_consumption_configs (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  estimation_method TEXT NOT NULL DEFAULT 'rolling_delivery_rate',
  assumed_waste_pct REAL NOT NULL DEFAULT 2.0,
  daily_baseline_cases REAL,
  safety_buffer_cases REAL NOT NULL DEFAULT 2.0,
  replenishment_threshold_cases REAL NOT NULL DEFAULT 5.0,
  notes TEXT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(store_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_store_cons_cfg_store ON store_consumption_configs(store_id);

CREATE TABLE IF NOT EXISTS store_pos_integrations (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL,
  external_store_ref TEXT,
  connection_status TEXT NOT NULL DEFAULT 'unconfigured',
  sync_sales_enabled INTEGER NOT NULL DEFAULT 0,
  sync_inventory_enabled INTEGER NOT NULL DEFAULT 0,
  last_sync_at TEXT,
  last_sync_status TEXT,
  error_message TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_store_pos_int_store ON store_pos_integrations(store_id);

CREATE TABLE IF NOT EXISTS store_pos_sku_mappings (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL,
  pos_item_code TEXT NOT NULL,
  pos_item_name TEXT NOT NULL,
  distributor_sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  mapping_type TEXT NOT NULL DEFAULT 'direct_1to1',
  cases_per_pos_unit REAL NOT NULL DEFAULT 0.05,
  kg_per_pos_unit REAL NOT NULL DEFAULT 0.25,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(store_id, pos_item_code, distributor_sku)
);

CREATE INDEX IF NOT EXISTS idx_store_pos_map_store ON store_pos_sku_mappings(store_id);

CREATE TABLE IF NOT EXISTS store_pos_import_batches (
  id TEXT PRIMARY KEY,
  import_ref TEXT NOT NULL UNIQUE,
  store_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL,
  import_type TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  records_submitted INTEGER NOT NULL DEFAULT 0,
  records_imported INTEGER NOT NULL DEFAULT 0,
  duplicates_skipped INTEGER NOT NULL DEFAULT 0,
  validation_errors_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  error_details_json TEXT NOT NULL DEFAULT '[]',
  imported_by TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_store_pos_batch_store ON store_pos_import_batches(store_id);

CREATE TABLE IF NOT EXISTS store_pos_transactions (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  import_batch_id TEXT NOT NULL REFERENCES store_pos_import_batches(id) ON DELETE CASCADE,
  external_tx_id TEXT NOT NULL,
  transaction_date TEXT NOT NULL,
  pos_item_code TEXT NOT NULL,
  pos_item_name TEXT NOT NULL,
  distributor_sku TEXT NOT NULL,
  quantity_sold REAL NOT NULL,
  derived_cases_consumed REAL NOT NULL,
  derived_kg_consumed REAL NOT NULL,
  consumption_type TEXT NOT NULL DEFAULT 'pos_sales_derived',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(store_id, external_tx_id)
);

CREATE INDEX IF NOT EXISTS idx_store_pos_tx_store_sku ON store_pos_transactions(store_id, distributor_sku);

CREATE TABLE IF NOT EXISTS store_inventory_snapshots (
  id TEXT PRIMARY KEY,
  snapshot_ref TEXT NOT NULL UNIQUE,
  store_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  opening_stock_cases REAL NOT NULL,
  deliveries_received_cases REAL NOT NULL,
  recorded_consumption_cases REAL NOT NULL,
  waste_spoilage_cases REAL NOT NULL DEFAULT 0,
  adjustments_cases REAL NOT NULL DEFAULT 0,
  expected_closing_cases REAL NOT NULL,
  actual_closing_cases REAL,
  variance_cases REAL,
  reconciliation_status TEXT NOT NULL DEFAULT 'reconciled',
  source TEXT NOT NULL DEFAULT 'store_declaration',
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_store_inv_snap_store ON store_inventory_snapshots(store_id, sku);

CREATE TABLE IF NOT EXISTS store_monitoring_alerts (
  id TEXT PRIMARY KEY,
  alert_ref TEXT NOT NULL UNIQUE,
  store_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  store_name TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  supporting_data_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  acknowledged_by TEXT,
  acknowledged_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_store_mon_alerts_store ON store_monitoring_alerts(store_id, status);

CREATE TABLE IF NOT EXISTS store_notification_preferences (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  low_purchasing_threshold_pct REAL NOT NULL DEFAULT 25.0,
  purchase_spike_threshold_pct REAL NOT NULL DEFAULT 35.0,
  cancellation_count_threshold INTEGER NOT NULL DEFAULT 2,
  credit_utilization_warn_pct REAL NOT NULL DEFAULT 80.0,
  consumption_variance_warn_pct REAL NOT NULL DEFAULT 15.0,
  email_enabled INTEGER NOT NULL DEFAULT 1,
  in_app_enabled INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- RBAC configuration (Module: Security & Architecture)
-- These tables hold the persisted role catalogue, granular permissions,
-- user-role assignments, per-user overrides, data scopes and configurable
-- approval thresholds. No foreign keys are used because operational data is
-- cleared independently of security configuration; referential integrity is
-- enforced by the access-control service.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS roles (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  role_type TEXT NOT NULL DEFAULT 'custom',
  base_role TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  protected INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS permissions (
  code TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sensitive INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_code TEXT NOT NULL,
  permission_code TEXT NOT NULL,
  PRIMARY KEY (role_code, permission_code)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_code);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL,
  role_code TEXT NOT NULL,
  assigned_by TEXT,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, role_code)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id TEXT NOT NULL,
  permission_code TEXT NOT NULL,
  effect TEXT NOT NULL DEFAULT 'grant',
  granted_by TEXT,
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, permission_code)
);

CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);

CREATE TABLE IF NOT EXISTS user_scopes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_value TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, scope_type, scope_value)
);

CREATE INDEX IF NOT EXISTS idx_user_scopes_user ON user_scopes(user_id, scope_type);

CREATE TABLE IF NOT EXISTS approval_thresholds (
  action_code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  amount_cents INTEGER,
  requires_permission TEXT NOT NULL,
  maker_checker INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rbac_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function relativeDate(daysOffset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysOffset);
  return d.toISOString().slice(0, 10);
}

/**
 * A user deleted by an administrator must never be re-seeded — not even a
 * demo account. Seeds consult the audit trail for a deletion tombstone
 * (entity id or recorded email) before re-inserting an account.
 */
function wasUserDeleted(db: SqliteDatabaseSync, id: string, email: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS hit FROM audit_events
        WHERE action IN ('admin.user_deleted','admin.user_soft_deleted')
          AND (entity_id = ? OR json_extract(before_json, '$.email') = lower(?))
        LIMIT 1`
    )
    .get(id, email) as { hit: number } | undefined;
  return !!row;
}

function seedDatabase(db: SqliteDatabaseSync): void {
  const existing = db.prepare("SELECT COUNT(*) as c FROM products").get() as { c: number } | undefined;
  if (existing && existing.c > 0) {
    return;
  }

  const defaultPassHash = hashPassword("Ascentra!2026");

  // 1. Seed Users covering all 9 RBAC roles
  const users = [
    ["USR-ADMIN", "elena.conti@ascentra.it", "Elena Conti", defaultPassHash, "super_admin", null, "Milan Cold Hub"],
    ["USR-WH-MGR", "marco.bellini@ascentra.it", "Marco Bellini", defaultPassHash, "warehouse_manager", null, "Milan Cold Hub"],
    ["USR-PICK", "pietro.rossi@ascentra.it", "Pietro Rossi", defaultPassHash, "picker", null, "Milan Cold Hub"],
    ["USR-DRV", "davide.galli@ascentra.it", "Davide Galli", defaultPassHash, "driver", null, "Milan Cold Hub"],
    ["USR-FIN", "matteo.ricci@ascentra.it", "Matteo Ricci", defaultPassHash, "finance", null, "Milan Cold Hub"],
    ["USR-SALES", "sofia.greco@ascentra.it", "Sofia Greco", defaultPassHash, "sales", null, "Milan Cold Hub"],
    ["USR-QA", "giulia.romano@ascentra.it", "Giulia Romano", defaultPassHash, "qa", null, "Milan Cold Hub"],
    ["USR-STR", "chiara.moretti@store-navigli.it", "Chiara Moretti", defaultPassHash, "store_vendor", "STR-MIL-01", "Milan Cold Hub"],
    ["USR-CEO", "lorenzo.ferrari@ascentra.it", "Lorenzo Ferrari", defaultPassHash, "ceo", null, "Milan Cold Hub"]
  ];
  const insertUser = db.prepare(
    // Users and sessions survive clear_all_data, so a demo-data restore must not
    // fail on the already-present accounts (nor overwrite changed passwords).
    "INSERT OR IGNORE INTO users (id, email, name, password_hash, role, store_id, warehouse) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  for (const u of users) {
    if (wasUserDeleted(db, String(u[0]), String(u[1]))) continue;
    insertUser.run(...u);
  }

  // 2. Seed Suppliers
  const suppliers = [
    [
      "SUP-NOR-01",
      "Nordic Fjord Seafood AS",
      "Norway",
      "Bergen",
      JSON.stringify(["Seafood"]),
      2,
      98.4,
      99.1,
      2,
      "Net 30",
      JSON.stringify(["MSC", "IFS Food", "HACCP"]),
      "approved"
    ],
    [
      "SUP-ITA-02",
      "Caseificio Val d'Orcia Srl",
      "Italy",
      "Campania & Tuscany",
      JSON.stringify(["Dairy"]),
      1,
      96.8,
      97.9,
      1,
      "Net 30",
      JSON.stringify(["DOP Consortium", "ISO 22000", "HACCP"]),
      "approved"
    ],
    [
      "SUP-ITA-03",
      "Consorzio Carni Piemonte",
      "Italy",
      "Piedmont",
      JSON.stringify(["Meat", "Charcuterie"]),
      1,
      95.2,
      96.4,
      1,
      "Net 45",
      JSON.stringify(["BRCGS", "IGP", "HACCP"]),
      "approved"
    ],
    [
      "SUP-ITA-04",
      "Cooperativa Agricola Sud",
      "Italy",
      "Apulia & Sicily",
      JSON.stringify(["Produce", "Ambient"]),
      2,
      91.5,
      94.0,
      2,
      "Net 30",
      JSON.stringify(["GlobalG.A.P.", "Organic EU", "HACCP"]),
      "approved"
    ],
    [
      "SUP-ESP-05",
      "Iberia Congelados SA",
      "Spain",
      "Valencia",
      JSON.stringify(["Frozen", "Seafood"]),
      3,
      86.2,
      88.5,
      1,
      "Net 60",
      JSON.stringify(["IFS Logistics", "HACCP"]),
      "probation"
    ]
  ];
  const insertSupplier = db.prepare(`
    INSERT INTO suppliers (
      id, name, country, region, categories_json, lead_time_days,
      otif_pct, quality_score, open_pos_count, payment_terms, certifications_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const s of suppliers) {
    insertSupplier.run(...s);
  }

  // 3. Seed Products
  const products = [
    ["PRD-01", "SKU-SAL-001", "Norwegian Atlantic Salmon Fillet (Trim D)", "Seafood", "Norway", "Case (5 kg)", "Chilled (0°C to +2°C)", 7, 142, 40, 9450, 4.0, "Nordic Fjord Seafood AS", "active"],
    ["PRD-02", "SKU-BUR-004", "Artisanal Burrata di Andria IGP (12x125g)", "Dairy", "Apulia, Italy", "Tray (1.5 kg)", "Chilled (+2°C to +4°C)", 5, 22, 35, 2890, 4.0, "Caseificio Val d'Orcia Srl", "active"],
    ["PRD-03", "SKU-BFL-009", "Dry-Aged Piedmontese Beef Striploin", "Meat", "Piedmont, Italy", "Case (8 kg)", "Chilled (0°C to +2°C)", 14, 64, 25, 21600, 10.0, "Consorzio Carni Piemonte", "active"],
    ["PRD-04", "SKU-TMA-012", "San Marzano DOP Pelati Tomatoes (6x2.5kg)", "Ambient", "Campania, Italy", "Case (15 kg)", "Ambient (+14°C to +20°C)", 540, 310, 80, 3450, 4.0, "Cooperativa Agricola Sud", "active"],
    ["PRD-05", "SKU-OCT-018", "IQF Mediterranean Octopus Tentacles", "Seafood", "Spain", "Case (6 kg)", "Frozen (-18°C to -22°C)", 180, 88, 30, 13800, 10.0, "Iberia Congelados SA", "active"],
    ["PRD-06", "SKU-PRO-021", "Prosciutto di Parma DOP 24M Deboned", "Charcuterie", "Emilia-Romagna, Italy", "Piece (7.5 kg)", "Chilled (+2°C to +6°C)", 90, 49, 20, 16200, 10.0, "Consorzio Carni Piemonte", "active"],
    ["PRD-07", "SKU-TRF-027", "Fresh Organic Baby Spinach Washed", "Produce", "Lombardy, Italy", "Crate (2 kg)", "Chilled (+2°C to +5°C)", 6, 18, 30, 1480, 4.0, "Cooperativa Agricola Sud", "active"],
    ["PRD-08", "SKU-RVL-033", "Fresh Truffle & Ricotta Girasoli Pasta", "Pasta & Bakery", "Veneto, Italy", "Case (4x1 kg)", "Chilled (+2°C to +4°C)", 21, 95, 30, 4200, 4.0, "Caseificio Val d'Orcia Srl", "active"]
  ];
  const insertProduct = db.prepare(`
    INSERT INTO products (
      id, sku, name, category, origin, uom, temp_zone, shelf_life_days,
      stock_cases, reorder_point_cases, unit_price_cents, vat_rate_pct, supplier_name, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const p of products) {
    insertProduct.run(...p);
  }

  // 3b. Seed Product Barcodes (EAN-13 demo values)
  const insertBarcode = db.prepare(`
    INSERT OR IGNORE INTO product_barcodes (id, product_id, barcode, format, is_primary, created_by)
    VALUES (?, ?, ?, 'EAN-13', 1, 'system')
  `);
  const productBarcodes: Array<[string, string, string]> = [
    ["BC-01", "PRD-01", "8056593285012"],
    ["BC-02", "PRD-02", "8056593285029"],
    ["BC-03", "PRD-03", "8056593285036"],
    ["BC-04", "PRD-04", "8056593285043"],
    ["BC-05", "PRD-05", "8056593287016"],
    ["BC-06", "PRD-06", "8056593287023"],
    ["BC-07", "PRD-07", "8056593287030"],
    ["BC-08", "PRD-08", "8056593287047"]
  ];
  for (const [id, pid, code] of productBarcodes) {
    insertBarcode.run(id, pid, code);
  }

  // 4. Seed Inventory Lots
  const lots = [
    ["LOT-1", "LOT-2026-BUR-019", "SKU-BUR-004", "Artisanal Burrata di Andria IGP (12x125g)", "Dairy", "Milan Cold Hub", "CH-A02", "Chilled A", 22, 60, 10, relativeDate(-3), relativeDate(2), "Caseificio Val d'Orcia Srl", "CVO-88412", "Italy", "released", 3.4, 1.5],
    ["LOT-2", "LOT-2026-SPN-008", "SKU-TRF-027", "Fresh Organic Baby Spinach Washed", "Produce", "Milan Cold Hub", "CH-C11", "Produce C", 18, 45, 6, relativeDate(-3), relativeDate(3), "Cooperativa Agricola Sud", "CAS-11904", "Italy", "released", 3.9, 2.0],
    ["LOT-3", "LOT-2026-SAL-041", "SKU-SAL-001", "Norwegian Atlantic Salmon Fillet (Trim D)", "Seafood", "Milan Cold Hub", "CH-A01", "Chilled A", 52, 120, 24, relativeDate(-2), relativeDate(4), "Nordic Fjord Seafood AS", "NO-BG-7721", "Norway", "released", 1.2, 5.0],
    ["LOT-4", "LOT-2026-SAL-044", "SKU-SAL-001", "Norwegian Atlantic Salmon Fillet (Trim D)", "Seafood", "Milan Cold Hub", "CH-A04", "Chilled A", 90, 90, 0, relativeDate(0), relativeDate(6), "Nordic Fjord Seafood AS", "NO-BG-7790", "Norway", "released", 1.1, 5.0],
    ["LOT-5", "LOT-2026-BFL-015", "SKU-BFL-009", "Dry-Aged Piedmontese Beef Striploin", "Meat", "Milan Cold Hub", "CH-B03", "Chilled B", 64, 80, 12, relativeDate(-3), relativeDate(11), "Consorzio Carni Piemonte", "CCP-55301", "Italy", "released", 1.6, 8.0],
    ["LOT-6", "LOT-2026-OCT-003", "SKU-OCT-018", "IQF Mediterranean Octopus Tentacles", "Seafood", "Bologna Freezer DC", "FZ-D08", "Deep Freeze", 88, 100, 8, relativeDate(-14), relativeDate(165), "Iberia Congelados SA", "IBC-40922", "Spain", "released", -19.8, 6.0],
    ["LOT-7", "LOT-2026-BUR-014", "SKU-BUR-004", "Artisanal Burrata di Andria IGP (12x125g)", "Dairy", "Milan Cold Hub", "QR-Z01", "Quarantine", 14, 14, 0, relativeDate(-5), relativeDate(1), "Caseificio Val d'Orcia Srl", "CVO-88290", "Italy", "quarantine", 6.2, 1.5]
  ];
  const insertLot = db.prepare(`
    INSERT INTO inventory_lots (
      id, batch_id, sku, product_name, category, warehouse, location, zone,
      quantity_cases, received_cases, allocated_cases, received_date, expiry_date,
      supplier, supplier_lot, origin_country, quality_status, temp_c, unit_weight_kg
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const l of lots) {
    insertLot.run(...l);
  }

  // 5. Seed Purchase Orders
  const pos = [
    ["PO-2026-1041", "PO-2026-1041", "SUP-NOR-01", "Nordic Fjord Seafood AS", "SKU-SAL-001", "Norwegian Atlantic Salmon Fillet (Trim D)", 80, 0, 7200, 576000, relativeDate(1), "in_transit", "ASN-NOR-9921", "giulia.romano@ascentra.it"],
    ["PO-2026-1042", "PO-2026-1042", "SUP-ITA-02", "Caseificio Val d'Orcia Srl", "SKU-BUR-004", "Artisanal Burrata di Andria IGP (12x125g)", 60, 0, 2100, 126000, relativeDate(1), "approved", "ASN-ITA-4410", "giulia.romano@ascentra.it"],
    ["PO-2026-1039", "PO-2026-1039", "SUP-ITA-03", "Consorzio Carni Piemonte", "SKU-BFL-009", "Dry-Aged Piedmontese Beef Striploin", 80, 80, 16500, 1320000, relativeDate(-3), "received", "ASN-CCP-5530", "giulia.romano@ascentra.it"]
  ];
  const insertPo = db.prepare(`
    INSERT INTO purchase_orders (
      id, po_number, supplier_id, supplier_name, sku, product_name,
      ordered_cases, received_cases, unit_cost_cents, total_cents, expected_date,
      status, asn_reference, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const po of pos) {
    insertPo.run(...po);
  }

  // 6. Seed Customers & Retail Stores
  const customers = [
    ["STR-MIL-01", "Gourmet Market Brera", "Milan", "Flagship Retail", "store", "Chiara Moretti", 3500000, 742000, 3, 4820000, 99.1, 1.4, "Today, 06:45", JSON.stringify(["Seafood", "Dairy", "Produce"]), "active"],
    ["STR-MIL-02", "Bottega Alimentare Navigli", "Milan", "Urban Bistro & Store", "store", "Alessandro Riva", 2500000, 412000, 2, 3190000, 97.8, 2.1, "Today, 07:20", JSON.stringify(["Charcuterie", "Dairy", "Pasta & Bakery"]), "active"],
    ["STR-TUR-03", "Enoteca & Cucina Torino Centro", "Turin", "Hospitality & Retail", "store", "Valeria Conti", 2000000, 1895000, 2, 2640000, 94.2, 3.8, "Yesterday, 16:10", JSON.stringify(["Meat", "Seafood"]), "watch"],
    ["STR-BOL-04", "Mercato San Petronio", "Bologna", "Regional Hub Store", "store", "Federico Neri", 3000000, 620000, 1, 3950000, 98.5, 1.6, "Today, 06:15", JSON.stringify(["Charcuterie", "Ambient", "Dairy"]), "active"],
    ["STR-ROM-05", "Dispensa Trastevere", "Rome", "Boutique Food Hall", "store", "Martina De Luca", 1800000, 510000, 1, 2180000, 96.4, 2.4, "2 days ago", JSON.stringify(["Dairy", "Produce", "Ambient"]), "active"],
    ["CUST-B2B-01", "Ristorante Cracco Galleria", "Milan", "Fine Dining", "b2b", "Chef Carlo", 2500000, 484200, 1, 1950000, 99.5, 0.8, "Today, 06:30", JSON.stringify(["Seafood", "Meat"]), "active"],
    ["CUST-B2B-02", "Hotel Principe di Savoia", "Milan", "Luxury Hotel", "b2b", "F&B Director", 1200000, 1185000, 1, 2800000, 98.0, 1.2, "Yesterday", JSON.stringify(["Meat", "Seafood", "Dairy"]), "watch"],
    ["CUST-B2B-03", "Osteria Francescana Group", "Modena", "Fine Dining", "b2b", "Purchasing Lead", 3000000, 629000, 1, 2400000, 99.8, 0.5, "Today, 08:00", JSON.stringify(["Meat", "Charcuterie"]), "active"],
    ["CUST-B2B-04", "Trattoria Trippa Milano", "Milan", "Contemporary Trattoria", "b2b", "Pietro", 1500000, 192400, 1, 980000, 97.9, 1.1, "Today, 09:00", JSON.stringify(["Meat", "Produce"]), "active"]
  ];
  const insertCustomer = db.prepare(`
    INSERT INTO customers (
      id, name, city, segment, customer_type, manager, credit_limit_cents,
      current_exposure_cents, active_orders_count, monthly_spend_cents,
      fill_rate_pct, waste_pct, last_delivery_text, top_categories_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const c of customers) {
    insertCustomer.run(...c);
  }

  // 7. Seed Temperature Readings
  const temps = [
    ["TMP-01", "Chilled A · Seafood & Fish", "Milan Cold Hub", 0.0, 2.0, 1.2, 86, "normal", "IOT-MCH-CA1", "2 mins ago"],
    ["TMP-02", "Chilled B · Dairy & Pasta", "Milan Cold Hub", 2.0, 4.0, 3.4, 82, "normal", "IOT-MCH-CB2", "1 min ago"],
    ["TMP-03", "Produce C · High-Humidity", "Milan Cold Hub", 2.0, 5.0, 5.4, 91, "warning", "IOT-MCH-PC3", "Just now"],
    ["TMP-04", "Deep Freeze D · IQF", "Bologna Freezer DC", -22.0, -18.0, -19.8, 74, "normal", "IOT-BFD-DF4", "3 mins ago"]
  ];
  const insertTemp = db.prepare(`
    INSERT INTO temperature_readings (
      id, zone_name, warehouse, target_min_c, target_max_c,
      current_c, humidity_pct, status, sensor_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const t of temps) {
    insertTemp.run(...t);
  }

  // 8. Seed Sales Orders & Order Lines
  const orders = [
    ["SO-2026-9841", "SO-2026-9841", "CUST-B2B-01", "Ristorante Cracco Galleria", "Fine Dining", "b2b_portal", "dispatched", 0, null, 6, 34, 484200, 31.4, relativeDate(0), "Milan Cold Hub", 1, "Today 05:12"],
    ["SO-2026-9842", "SO-2026-9842", "STR-MIL-01", "Gourmet Market Brera", "Retail Store", "edi", "picking", 0, null, 11, 78, 742000, 27.8, relativeDate(0), "Milan Cold Hub", 1, "Today 06:05"],
    ["SO-2026-9843", "SO-2026-9843", "CUST-B2B-02", "Hotel Principe di Savoia", "Luxury Hotel", "sales_rep", "draft", 1, "Customer exposure €11,850 + order €11,850 exceeds €12,000 credit limit", 14, 96, 1185000, 29.2, relativeDate(1), "Milan Cold Hub", 0, "Today 07:40"],
    ["SO-2026-9844", "SO-2026-9844", "STR-MIL-02", "Bottega Alimentare Navigli", "Retail Store", "b2b_portal", "confirmed", 0, null, 8, 45, 369000, 28.5, relativeDate(1), "Milan Cold Hub", 1, "Today 08:15"],
    ["SO-2026-9845", "SO-2026-9845", "CUST-B2B-03", "Osteria Francescana Group", "Fine Dining", "sales_rep", "delivered", 0, null, 5, 28, 629000, 34.1, relativeDate(-1), "Bologna Freezer DC", 1, "Yesterday 14:20"],
    ["SO-2026-9846", "SO-2026-9846", "STR-TUR-03", "Enoteca & Cucina Torino Centro", "Hospitality & Retail", "phone", "packed", 0, null, 7, 38, 318500, 26.9, relativeDate(0), "Milan Cold Hub", 1, "Today 06:50"],
    ["SO-2026-9847", "SO-2026-9847", "CUST-B2B-04", "Trattoria Trippa Milano", "Contemporary Trattoria", "b2b_portal", "invoiced", 0, null, 4, 19, 192400, 30.2, relativeDate(-2), "Milan Cold Hub", 1, "2 days ago"]
  ];
  const insertOrder = db.prepare(`
    INSERT INTO sales_orders (
      id, order_number, customer_id, customer, segment, channel, status,
      credit_hold, credit_hold_reason, items_count, cases_total, total_cents,
      margin_pct, delivery_date, warehouse, fefo_allocated, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const o of orders) {
    insertOrder.run(...o);
  }

  const orderLines = [
    ["SOL-01", "SO-2026-9841", "SKU-SAL-001", "Norwegian Atlantic Salmon Fillet (Trim D)", 18, 18, 9450, "LOT-2026-SAL-041", 90.0],
    ["SOL-02", "SO-2026-9841", "SKU-BUR-004", "Artisanal Burrata di Andria IGP (12x125g)", 16, 16, 2890, "LOT-2026-BUR-019", 24.0],
    ["SOL-03", "SO-2026-9842", "SKU-SAL-001", "Norwegian Atlantic Salmon Fillet (Trim D)", 24, 24, 9450, "LOT-2026-SAL-041", 120.0],
    ["SOL-04", "SO-2026-9842", "SKU-BFL-009", "Dry-Aged Piedmontese Beef Striploin", 12, 12, 21600, "LOT-2026-BFL-015", 96.0],
    ["SOL-05", "SO-2026-9845", "SKU-SAL-001", "Norwegian Atlantic Salmon Fillet (Trim D)", 16, 16, 9450, "LOT-2026-SAL-041", 80.0],
    ["SOL-06", "SO-2026-9846", "SKU-SAL-001", "Norwegian Atlantic Salmon Fillet (Trim D)", 10, 10, 9450, "LOT-2026-SAL-041", 50.0]
  ];
  const insertLine = db.prepare(`
    INSERT INTO sales_order_lines (
      id, order_id, sku, product_name, cases_ordered, cases_allocated, unit_price_cents, batch_id, weight_kg
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const l of orderLines) {
    insertLine.run(...l);
  }

  // 9. Seed Warehouse Tasks
  const tasks = [
    ["TSK-401", "pick", "urgent", "in_progress", "SKU-SAL-001", "Norwegian Atlantic Salmon Fillet (Trim D)", "LOT-2026-SAL-041", "CH-A01", "STAGE-D2", 24, "Marco Bellini", "SO-2026-9842"],
    ["TSK-402", "pick", "high", "queued", "SKU-BUR-004", "Artisanal Burrata di Andria IGP (12x125g)", "LOT-2026-BUR-019", "CH-A02", "STAGE-D2", 18, "Lucia Ferri", "SO-2026-9842"],
    ["TSK-403", "putaway", "high", "queued", "SKU-SAL-001", "Norwegian Atlantic Salmon Fillet (Trim D)", "LOT-2026-SAL-044", "DOCK-IN-1", "CH-A04", 90, "Matteo Rossi", null],
    ["TSK-404", "pack", "normal", "in_progress", "SKU-BFL-009", "Dry-Aged Piedmontese Beef Striploin", "LOT-2026-BFL-015", "CH-B03", "PACK-01", 12, "Elena Galli", "SO-2026-9846"],
    ["TSK-405", "cycle_count", "normal", "queued", "SKU-TRF-027", "Fresh Organic Baby Spinach Washed", "LOT-2026-SPN-008", "CH-C11", "CH-C11", 18, "Marco Bellini", null],
    ["TSK-406", "replenish", "urgent", "blocked", "SKU-BUR-004", "Artisanal Burrata di Andria IGP (12x125g)", "LOT-2026-BUR-014", "QR-Z01", "CH-A02", 14, "QA Hold", null]
  ];
  const insertTask = db.prepare(`
    INSERT INTO warehouse_tasks (
      id, task_type, priority, status, sku, product_name, batch_id,
      from_bin, to_bin, cases, assignee, order_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const t of tasks) {
    insertTask.run(...t);
  }

  // 10. Seed Deliveries
  const deliveries = [
    ["DEL-501", "SO-2026-9841", "SO-2026-9841", "Ristorante Cracco Galleria", "RT-MIL-N1", "Davide Galli", "IVECO-FRIGO-08", "09:30", 1.5, "in_transit", 0, 2, 4, null],
    ["DEL-502", "SO-2026-9846", "SO-2026-9846", "Enoteca & Cucina Torino Centro", "RT-WEST-04", "Stefano Costa", "MERC-REEFER-12", "11:15", 2.1, "loading", 0, 0, 3, null],
    ["DEL-503", "SO-2026-9845", "SO-2026-9845", "Osteria Francescana Group", "RT-SOUTH-02", "Paolo Verdi", "IVECO-FRIGO-03", "Delivered 07:50", 1.8, "delivered", 1, 5, 5, null],
    ["DEL-504", "SO-2026-9839", "SO-2026-9839", "Trattoria del Corso", "RT-MIL-S3", "Luca Bianchi", "SCANIA-COLD-15", "10:40", 5.8, "exception", 0, 1, 4, "Reefer door seal alarm (+5.8°C) — driver inspecting probe"]
  ];
  const insertDelivery = db.prepare(`
    INSERT INTO deliveries (
      id, order_id, order_number, customer, route_code, driver, vehicle,
      eta, temp_c, status, pod_signed, stops_completed, stops_total, exception
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const d of deliveries) {
    insertDelivery.run(...d);
  }

  // 11. Seed Invoices
  const invoices = [
    ["INV-2026-8410", "INV-2026-8410", "SO-2026-9845", "SO-2026-9845", "CUST-B2B-03", "Osteria Francescana Group", relativeDate(-1), relativeDate(29), 629000, 629000, "paid", "accepted", "SDI-IT-992014", "Net 30"],
    ["INV-2026-8411", "INV-2026-8411", "SO-2026-9847", "SO-2026-9847", "CUST-B2B-04", "Trattoria Trippa Milano", relativeDate(-2), relativeDate(28), 192400, 0, "issued", "accepted", "SDI-IT-992488", "Net 30"],
    ["INV-2026-8412", "INV-2026-8412", "SO-2026-9841", "SO-2026-9841", "CUST-B2B-01", "Ristorante Cracco Galleria", relativeDate(0), relativeDate(30), 484200, 0, "issued", "pending", null, "Net 30"],
    ["INV-2026-8390", "INV-2026-8390", "SO-2026-9788", "SO-2026-9788", "STR-TUR-03", "Enoteca & Cucina Torino Centro", relativeDate(-38), relativeDate(-8), 412000, 150000, "overdue", "accepted", "SDI-IT-981002", "Net 30"],
    ["INV-2026-8398", "INV-2026-8398", "SO-2026-9804", "SO-2026-9804", "CUST-B2B-02", "Hotel Principe di Savoia", relativeDate(-45), relativeDate(-15), 895000, 0, "overdue", "accepted", "SDI-IT-984119", "Net 30"]
  ];
  const insertInvoice = db.prepare(`
    INSERT INTO invoices (
      id, invoice_number, order_id, order_number, customer_id, customer,
      issued_date, due_date, amount_cents, paid_cents, status, sdi_status, sdi_reference, payment_terms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const inv of invoices) {
    insertInvoice.run(...inv);
  }

  // 12. Seed Governed AI Insights
  const insights = [
    [
      "AI-INS-01",
      "expiry",
      "FEFO Markdown & Priority Allocation: Burrata Lot LOT-2026-BUR-019",
      94,
      "Prevent €636 spoilage loss",
      "22 cases in Chilled A expire in 48h. Auto-assign to Gourmet Market Brera & Navigli morning replenishment with 12% promotional bundle.",
      "Approve FEFO Promo Allocation",
      "pending"
    ],
    [
      "AI-INS-02",
      "replenishment",
      "Dynamic Reorder Trigger: Norwegian Salmon Fillet (SKU-SAL-001)",
      91,
      "+18% weekend hospitality demand",
      "Milan fine-dining velocity is tracking 18% above 4-week moving average. Issue PO for 85 cases from Nordic Fjord Seafood AS for Friday 05:00 dock arrival.",
      "Generate Draft PO (85 Cases)",
      "pending"
    ],
    [
      "AI-INS-03",
      "anomaly",
      "Compressor Defrost Cycle Drift Detected in Produce Zone C",
      88,
      "Cold-chain excursion risk",
      "Sensor IOT-MCH-PC3 rose +0.4°C above +5.0°C ceiling during 07:00 dock loading. Adjust evaporator fan staging and alert maintenance.",
      "Dispatch Maintenance Ticket",
      "pending"
    ],
    [
      "AI-INS-04",
      "demand",
      "Store Waste Reduction: Enoteca Torino Centro Beef Striploin",
      86,
      "-1.4% store shrink",
      "Shift Enoteca Torino from 2x weekly bulk case drop to 3x split-case FEFO replenishment to cut trim waste from 3.8% to 2.4%.",
      "Apply Split-Case Schedule",
      "pending"
    ]
  ];
  const insertInsight = db.prepare(`
    INSERT INTO ai_insights (
      id, category, title, confidence_pct, impact_label, recommendation, action_label, decision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const ins of insights) {
    insertInsight.run(...ins);
  }

  // 13. Seed Alerts
  const alerts = [
    ["ALT-01", "critical", "Cold Chain", "Reefer exception on Route RT-MIL-S3 (DEL-504)", "Vehicle SCANIA-COLD-15 reported +5.8°C at stop 2/4. Driver inspecting door seal."],
    ["ALT-02", "warning", "FEFO", "22 cases of Burrata IGP (LOT-2026-BUR-019) expire in 2 days", "FEFO Rank #1 in Chilled A (CH-A02) — prioritized for today's picking queue."],
    ["ALT-03", "warning", "Credit", "Order SO-2026-9843 (€11,850) on Credit Hold", "Hotel Principe di Savoia exceeds €12,000 credit limit due to overdue invoice INV-2026-8398."],
    ["ALT-04", "info", "Finance", "Invoice INV-2026-8412 ready for Italy SdI transmission", "FatturaPA XML validated for Ristorante Cracco Galleria (€4,842.00)."]
  ];
  const insertAlert = db.prepare(`
    INSERT INTO alert_events (id, severity, module, title, detail) VALUES (?, ?, ?, ?, ?)
  `);
  for (const a of alerts) {
    insertAlert.run(...a);
  }

  // 14. Initial Audit Event
  db.prepare(`
    INSERT INTO audit_events (id, actor_id, actor_email, actor_role, action, entity_type, entity_id, after_json, ip_address)
    VALUES ('AUD-INIT-001', 'USR-ADMIN', 'elena.conti@ascentra.it', 'administrator', 'system.seed_initialized', 'Database', 'ascentra-erp', '{"status":"seeded","tables":16}', '127.0.0.1')
  `).run();

  // 15. Seed Customer Contracts & Addresses
  seedContractsAndAddresses(db);

  // 16. Seed Dispatch Staging Lanes & Picking Config
  seedPickingAndStaging(db);
  seedVehiclesAndDrivers(db);

  // 17. Seed Vehicles & Drivers
  seedVehiclesAndDrivers(db);
}

function seedPickingAndStaging(db: SqliteDatabaseSync): void {
  try {
    const laneCount = (db.prepare("SELECT COUNT(*) as c FROM dispatch_staging_lanes").get() as { c: number } | undefined)?.c ?? 0;
    if (laneCount === 0) {
      const insertLane = db.prepare(`
        INSERT OR IGNORE INTO dispatch_staging_lanes (
          id, warehouse, lane_code, zone, capacity_pallets, current_occupancy, assigned_route, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
      `);
      insertLane.run("LNE-MCH-01", "Milan Cold Hub", "STAGE-D1", "Chilled A", 12, 2, "RT-MIL-N1");
      insertLane.run("LNE-MCH-02", "Milan Cold Hub", "STAGE-D2", "Chilled B", 12, 1, "RT-MIL-S3");
      insertLane.run("LNE-MCH-03", "Milan Cold Hub", "STAGE-D3", "Ambient", 16, 0, "RT-WEST-04");
      insertLane.run("LNE-MCH-04", "Milan Cold Hub", "COLD-DOCK-1", "Loading Dock", 20, 3, "RT-SOUTH-02");
      insertLane.run("LNE-BFD-01", "Bologna Freezer DC", "FREEZER-STAGING-A", "Deep Freeze", 10, 1, "RT-EAST-01");
    }
  } catch (e) {
    // ignore
  }
}

function seedVehiclesAndDrivers(db: SqliteDatabaseSync): void {
  try {
    const vehCount = (db.prepare("SELECT COUNT(*) as c FROM vehicles").get() as { c: number } | undefined)?.c ?? 0;
    if (vehCount === 0) {
      const insertVeh = db.prepare(`
        INSERT OR IGNORE INTO vehicles (
          id, registration_number, vehicle_name, make_model, vehicle_type, warehouse,
          max_payload_kg, max_pallets, max_volume_m3, temperature_capability,
          has_chilled_compartment, has_frozen_compartment, has_ambient_compartment,
          status, inspection_status, inspection_expiry_date, atp_expiry_date, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertVeh.run("VEH-001", "MI-892-FR", "Iveco Eurocargo Reefer 08", "Iveco Eurocargo ML75E19P", "rigid_truck_7_5t", "Milan Cold Hub", 4500, 8, 24, "multi_temp", 1, 1, 1, "active", "passed", relativeDate(160), relativeDate(160), "Primary multi-temp route truck with dual-evaporator Thermo King unit");
      insertVeh.run("VEH-002", "MI-552-KL", "Mercedes-Benz Sprinter Chilled", "Mercedes-Benz Sprinter 314 CDI", "van_3_5t", "Milan Cold Hub", 1400, 3, 10, "chilled", 1, 0, 1, "active", "passed", relativeDate(230), relativeDate(230), "Express city center courier van, Carrier Transicold Neos 100");
      insertVeh.run("VEH-003", "MI-104-AB", "Scania P280 Dual-Temp", "Scania P280 LB4x2MNB", "rigid_truck_18t", "Milan Cold Hub", 11500, 18, 48, "multi_temp", 1, 1, 1, "active", "passed", relativeDate(95), relativeDate(95), "Heavy duty regional distribution reefer with movable bulkhead divider");
      insertVeh.run("VEH-004", "BO-441-FZ", "Iveco Daily Cold Van", "Iveco Daily 35S16", "van_3_5t", "Bologna Freezer DC", 1250, 2, 8, "chilled", 1, 0, 1, "active", "passed", relativeDate(55), relativeDate(55), "Emilia-Romagna local delivery van");
      insertVeh.run("VEH-005", "MI-720-CX", "Volvo FM Chilled Transporter", "Volvo FM 330 4x2", "artic_semi_26t", "Milan Cold Hub", 16000, 26, 72, "multi_temp", 1, 1, 1, "maintenance", "due", relativeDate(-5), relativeDate(-5), "Scheduled for annual ATP re-certification and reefer overhaul");
    }
  } catch (e) {
    // ignore
  }

  try {
    const drvCount = (db.prepare("SELECT COUNT(*) as c FROM drivers").get() as { c: number } | undefined)?.c ?? 0;
    if (drvCount === 0) {
      const insertDrv = db.prepare(`
        INSERT OR IGNORE INTO drivers (
          id, user_id, name, email, phone, warehouse, license_number, license_type,
          license_expiry_date, cqc_expiry_date, medical_expiry_date, status,
          assigned_vehicle_id, current_route_code, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertDrv.run("DRV-001", "USR-DRV", "Davide Galli", "davide.galli@ascentra.it", "+39 02 8739 5501", "Milan Cold Hub", "IT-PAT-90821-C", "C+CQC", relativeDate(650), relativeDate(650), relativeDate(320), "available", "VEH-001", "RT-MIL-N1", "Senior refrigerated transport specialist, HACCP certified");
      insertDrv.run("DRV-002", "USR-DRV-COSTA", "Stefano Costa", "stefano.costa@ascentra.it", "+39 02 8739 5502", "Milan Cold Hub", "IT-PAT-77412-C", "C+CQC", relativeDate(380), relativeDate(380), relativeDate(180), "available", "VEH-002", "RT-WEST-04", "Express delivery specialist for Milan & Piedmont routes");
      insertDrv.run("DRV-003", "USR-DRV-VERDI", "Paolo Verdi", "paolo.verdi@ascentra.it", "+39 02 8739 5503", "Milan Cold Hub", "IT-PAT-61904-C", "C+CQC", relativeDate(800), relativeDate(800), relativeDate(500), "available", "VEH-003", "RT-SOUTH-02", "Emilia-Romagna linehaul & fine dining deliveries");
      insertDrv.run("DRV-004", "USR-DRV-BIANCHI", "Marco Bianchi", "marco.bianchi@ascentra.it", "+39 051 442 8901", "Bologna Freezer DC", "IT-PAT-38291-B", "B", relativeDate(-10), null, relativeDate(60), "available", "VEH-004", "RT-EAST-01", "Bologna urban distribution driver");
    }
  } catch (e) {
    // ignore
  }

  // Ensure default driver accounts exist in users table
  try {
    const defaultPassHash = hashPassword("Ascentra!2026");
    const insertUser = db.prepare(`
      INSERT OR IGNORE INTO users (id, email, name, password_hash, role, store_id, warehouse)
      VALUES (?, ?, ?, ?, 'driver', NULL, ?)
    `);
    if (!wasUserDeleted(db, "USR-DRV-COSTA", "stefano.costa@ascentra.it")) {
      insertUser.run("USR-DRV-COSTA", "stefano.costa@ascentra.it", "Stefano Costa", defaultPassHash, "Milan Cold Hub");
    }
    if (!wasUserDeleted(db, "USR-DRV-VERDI", "paolo.verdi@ascentra.it")) {
      insertUser.run("USR-DRV-VERDI", "paolo.verdi@ascentra.it", "Paolo Verdi", defaultPassHash, "Milan Cold Hub");
    }
    if (!wasUserDeleted(db, "USR-DRV-BIANCHI", "marco.bianchi@ascentra.it")) {
      insertUser.run("USR-DRV-BIANCHI", "marco.bianchi@ascentra.it", "Marco Bianchi", defaultPassHash, "Bologna Freezer DC");
    }
  } catch (e) {
    // ignore
  }

  // Backfill extended delivery fields for seeded deliveries if null
  try {
    db.prepare(`
      UPDATE deliveries SET
        delivery_reference = COALESCE(delivery_reference, id),
        customer_id = COALESCE(customer_id, 'CUST-B2B-01'),
        delivery_address = COALESCE(delivery_address, 'Galleria Vittorio Emanuele II, 20121 Milano MI'),
        warehouse = COALESCE(warehouse, 'Milan Cold Hub'),
        delivery_date = COALESCE(delivery_date, date('now')),
        time_window_start = COALESCE(time_window_start, '09:00'),
        time_window_end = COALESCE(time_window_end, '10:30'),
        driver_id = COALESCE(driver_id, 'DRV-001'),
        vehicle_id = COALESCE(vehicle_id, 'VEH-001'),
        stop_sequence = COALESCE(stop_sequence, 1),
        priority = COALESCE(priority, 'high'),
        total_packages = COALESCE(total_packages, 4),
        total_pallets = COALESCE(total_pallets, 1),
        total_cases = COALESCE(total_cases, 8),
        total_weight_kg = COALESCE(total_weight_kg, 92.5)
      WHERE id = 'DEL-501'
    `).run();

    db.prepare(`
      UPDATE deliveries SET
        delivery_reference = COALESCE(delivery_reference, id),
        customer_id = COALESCE(customer_id, 'STR-TUR-03'),
        delivery_address = COALESCE(delivery_address, 'Via Roma 45, 10121 Torino TO'),
        warehouse = COALESCE(warehouse, 'Milan Cold Hub'),
        delivery_date = COALESCE(delivery_date, date('now')),
        time_window_start = COALESCE(time_window_start, '11:00'),
        time_window_end = COALESCE(time_window_end, '12:30'),
        driver_id = COALESCE(driver_id, 'DRV-002'),
        vehicle_id = COALESCE(vehicle_id, 'VEH-002'),
        stop_sequence = COALESCE(stop_sequence, 1),
        priority = COALESCE(priority, 'normal'),
        total_packages = COALESCE(total_packages, 3),
        total_pallets = COALESCE(total_pallets, 1),
        total_cases = COALESCE(total_cases, 5),
        total_weight_kg = COALESCE(total_weight_kg, 64.0)
      WHERE id = 'DEL-502'
    `).run();

    db.prepare(`
      UPDATE deliveries SET
        delivery_reference = COALESCE(delivery_reference, id),
        customer_id = COALESCE(customer_id, 'CUST-B2B-03'),
        delivery_address = COALESCE(delivery_address, 'Via Stella 22, 41121 Modena MO'),
        warehouse = COALESCE(warehouse, 'Milan Cold Hub'),
        delivery_date = COALESCE(delivery_date, date('now')),
        time_window_start = COALESCE(time_window_start, '07:00'),
        time_window_end = COALESCE(time_window_end, '08:30'),
        driver_id = COALESCE(driver_id, 'DRV-003'),
        vehicle_id = COALESCE(vehicle_id, 'VEH-003'),
        stop_sequence = COALESCE(stop_sequence, 1),
        priority = COALESCE(priority, 'high'),
        total_packages = COALESCE(total_packages, 6),
        total_pallets = COALESCE(total_pallets, 2),
        total_cases = COALESCE(total_cases, 15),
        total_weight_kg = COALESCE(total_weight_kg, 178.0)
      WHERE id = 'DEL-503'
    `).run();

    db.prepare(`
      UPDATE deliveries SET
        delivery_reference = COALESCE(delivery_reference, id),
        customer_id = COALESCE(customer_id, 'STR-MIL-02'),
        delivery_address = COALESCE(delivery_address, 'Corso Buenos Aires 12, 20124 Milano MI'),
        warehouse = COALESCE(warehouse, 'Milan Cold Hub'),
        delivery_date = COALESCE(delivery_date, date('now')),
        time_window_start = COALESCE(time_window_start, '10:00'),
        time_window_end = COALESCE(time_window_end, '11:30'),
        driver_id = COALESCE(driver_id, 'DRV-001'),
        vehicle_id = COALESCE(vehicle_id, 'VEH-001'),
        stop_sequence = COALESCE(stop_sequence, 2),
        priority = COALESCE(priority, 'urgent'),
        total_packages = COALESCE(total_packages, 4),
        total_pallets = COALESCE(total_pallets, 1),
        total_cases = COALESCE(total_cases, 6),
        total_weight_kg = COALESCE(total_weight_kg, 71.0)
      WHERE id = 'DEL-504'
    `).run();
  } catch (e) {
    console.error("SEED STEP 0 ERROR:", e);
  }
}

function seedContractsAndAddresses(db: SqliteDatabaseSync): void {
  try {
    db.prepare("UPDATE customers SET delivery_address = 'Galleria Vittorio Emanuele II, 20121 Milano MI', tax_id = 'IT08923410961', min_shelf_life_days = 4 WHERE id = 'CUST-B2B-01' AND (delivery_address IS NULL OR delivery_address = '')").run();
    db.prepare("UPDATE customers SET delivery_address = 'Piazza della Repubblica 17, 20124 Milano MI', tax_id = 'IT01289450152', min_shelf_life_days = 5 WHERE id = 'CUST-B2B-02' AND (delivery_address IS NULL OR delivery_address = '')").run();
    db.prepare("UPDATE customers SET delivery_address = 'Via Stella 22, 41121 Modena MO', tax_id = 'IT02487310368', min_shelf_life_days = 4 WHERE id = 'CUST-B2B-03' AND (delivery_address IS NULL OR delivery_address = '')").run();
    db.prepare("UPDATE customers SET delivery_address = 'Via Giorgio Vasari 3, 20135 Milano MI', tax_id = 'IT09412380965', min_shelf_life_days = 3 WHERE id = 'CUST-B2B-04' AND (delivery_address IS NULL OR delivery_address = '')").run();
    db.prepare("UPDATE customers SET delivery_address = 'Via Fiori Chiari 14, 20121 Milano MI', tax_id = 'IT07812900963', min_shelf_life_days = 3 WHERE id = 'STR-MIL-01' AND (delivery_address IS NULL OR delivery_address = '')").run();
  } catch (e) {
    // ignore
  }

  try {
    const ctrCount = (db.prepare("SELECT COUNT(*) as c FROM customer_contracts").get() as { c: number } | undefined)?.c ?? 0;
    if (ctrCount === 0) {
      const insertCtr = db.prepare(`
        INSERT OR IGNORE INTO customer_contracts (
          id, contract_number, customer_id, title, start_date, end_date,
          currency, payment_terms, credit_limit_cents, discount_pct, status, notes, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, 'EUR', ?, ?, ?, 'active', ?, 'elena.conti@ascentra.it')
      `);
      const insertItem = db.prepare(`
        INSERT OR IGNORE INTO customer_contract_items (
          id, contract_id, sku, unit_price_cents, uom, min_quantity, discount_pct,
          promotional_price_cents, promo_start, promo_end, customer_sku, is_exclusive, notes
        ) VALUES (?, ?, ?, ?, 'case', ?, ?, ?, ?, ?, ?, 0, ?)
      `);

      // 1. Cracco Galleria Master Agreement (Fine Dining)
      insertCtr.run("CTR-2026-CRACCO", "CTR-2026-001", "CUST-B2B-01", "Ristorante Cracco Fine Dining Master Contract", relativeDate(-60), relativeDate(305), "Net 30", 2500000, 5.0, "Exclusive Michelin fine dining supply agreement with FEFO tier guarantees.");
      insertItem.run("CTRI-01", "CTR-2026-CRACCO", "SKU-SAL-001", 8900, 1, 5.8, null, null, null, "CRAC-SAL-01", "Cracco base contract price on Norwegian Salmon");
      insertItem.run("CTRI-02", "CTR-2026-CRACCO", "SKU-SAL-001", 8400, 20, 11.1, null, null, null, "CRAC-SAL-VOL", "Volume discount tier for >= 20 cases");
      insertItem.run("CTRI-03", "CTR-2026-CRACCO", "SKU-BUR-004", 2550, 1, 11.7, null, null, null, "CRAC-BUR-01", "Handcrafted Burrata di Andria contract price");
      insertItem.run("CTRI-04", "CTR-2026-CRACCO", "SKU-BFL-009", 19800, 1, 8.3, null, null, null, "CRAC-BFL-01", "Dry-Aged Beef contract rate");

      // 2. Hotel Principe di Savoia (Luxury Hospitality) - includes promotional price on Salmon
      insertCtr.run("CTR-2026-SAVOIA", "CTR-2026-002", "CUST-B2B-02", "Hotel Principe di Savoia Hospitality Master Agreement", relativeDate(-30), relativeDate(335), "Net 45", 1200000, 3.0, "Luxury hotel annual supply contract with seasonal seafood promotion.");
      insertItem.run("CTRI-05", "CTR-2026-SAVOIA", "SKU-SAL-001", 9100, 1, 3.7, 8200, relativeDate(-7), relativeDate(14), "SAV-SAL-PROMO", "Winter Gastronomy Promo (€82.00/case)");
      insertItem.run("CTRI-06", "CTR-2026-SAVOIA", "SKU-OCT-018", 12500, 1, 9.4, null, null, null, "SAV-OCT-01", "Mediterranean Octopus contract rate");

      // 3. Gourmet Market Brera (Retail Flagship)
      insertCtr.run("CTR-2026-BRERA", "CTR-2026-003", "STR-MIL-01", "Gourmet Market Brera Retail Franchise Agreement", relativeDate(-90), relativeDate(275), "Net 30", 3500000, 4.0, "High-volume retail store replenishment contract.");
      insertItem.run("CTRI-07", "CTR-2026-BRERA", "SKU-TMA-012", 3100, 1, 10.1, null, null, null, "BRER-TMA-01", "San Marzano DOP base contract");
      insertItem.run("CTRI-08", "CTR-2026-BRERA", "SKU-TMA-012", 2850, 25, 17.3, null, null, null, "BRER-TMA-VOL", "San Marzano bulk volume tier >= 25 cases");
      insertItem.run("CTRI-09", "CTR-2026-BRERA", "SKU-RVL-033", 3800, 1, 9.5, null, null, null, "BRER-RVL-01", "Fresh Truffle Ravioli store contract rate");
    }
  } catch (e) {
    // ignore
  }
}

function syncSchemaColumnsFromCreateTables(db: SqliteDatabaseSync): void {
  const tableRegex = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\);/gi;
  let match: RegExpExecArray | null;
  while ((match = tableRegex.exec(SCHEMA_SQL)) !== null) {
    const tableName = match[1];
    const body = match[2];
    const fullCreateSql = match[0];

    try {
      db.exec(fullCreateSql);
    } catch {
      // ignore if table already exists
    }

    let existingCols = new Set<string>();
    try {
      const info = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
      existingCols = new Set(info.map((c) => c.name.toLowerCase()));
    } catch {
      continue;
    }

    const lines = body
      .split("\n")
      .map((l) => l.replace(/--.*$/, "").trim().replace(/,$/, "").trim())
      .filter(Boolean);

    for (const line of lines) {
      const upper = line.toUpperCase();
      if (
        upper.startsWith("PRIMARY KEY") ||
        upper.startsWith("FOREIGN KEY") ||
        upper.startsWith("UNIQUE") ||
        upper.startsWith("CHECK") ||
        upper.startsWith("CONSTRAINT")
      ) {
        continue;
      }

      const colMatch = /^([a-zA-Z0-9_]+)\s+(TEXT|INTEGER|REAL|BLOB|NUMERIC)(.*)$/i.exec(line);
      if (!colMatch) continue;

      const colName = colMatch[1];
      const colType = colMatch[2].toUpperCase();
      const rest = colMatch[3] || "";

      if (existingCols.has(colName.toLowerCase())) {
        continue;
      }

      // Extract a constant DEFAULT if present (SQLite forbids non-constant defaults like (datetime('now')) in ALTER TABLE ADD COLUMN)
      let defaultClause = "";
      const constDefaultMatch = /\bDEFAULT\s+('[^']*'|[-+]?\d+(?:\.\d+)?|NULL)\b/i.exec(rest);
      if (constDefaultMatch) {
        defaultClause = ` DEFAULT ${constDefaultMatch[1]}`;
      } else if (/\bNOT\s+NULL\b/i.test(rest)) {
        if (colType === "INTEGER" || colType === "REAL" || colType === "NUMERIC") {
          defaultClause = " DEFAULT 0";
        } else if (colType === "TEXT") {
          defaultClause = " DEFAULT ''";
        }
      }

      const alterSql = `ALTER TABLE ${tableName} ADD COLUMN ${colName} ${colType}${defaultClause}`;
      try {
        db.exec(alterSql);
        existingCols.add(colName.toLowerCase());
      } catch {
        // ignore if already added or unsupported constraint
      }
    }
  }

  // Also ensure all indexes in SCHEMA_SQL exist after columns have been synchronized
  const indexRegex = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+[^;]+;/gi;
  let idxMatch: RegExpExecArray | null;
  while ((idxMatch = indexRegex.exec(SCHEMA_SQL)) !== null) {
    try {
      db.exec(idxMatch[0]);
    } catch {
      // ignore
    }
  }
}

/**
 * One-time, idempotent seed for the bundled demo barcodes. Safe on every
 * fresh database and re-run against existing ones — inserts are OR IGNORE.
 */
function backfillDemoBarcodes(db: SqliteDatabaseSync): void {
  const seeds: Array<[string, string, string]> = [
    ["BC-01", "SKU-SAL-001", "8056593285012"],
    ["BC-02", "SKU-BUR-004", "8056593285029"],
    ["BC-03", "SKU-BFL-009", "8056593285036"],
    ["BC-04", "SKU-TMA-012", "8056593285043"],
    ["BC-05", "SKU-OCT-018", "8056593287016"],
    ["BC-06", "SKU-PRO-021", "8056593287023"],
    ["BC-07", "SKU-TRF-027", "8056593287030"],
    ["BC-08", "SKU-RVL-033", "8056593287047"]
  ];
  for (const [id, sku, code] of seeds) {
    const product = db.prepare("SELECT id FROM products WHERE sku = ?").get(sku) as
      | { id: string }
      | undefined;
    if (!product) continue;
    db.prepare(
      "INSERT OR IGNORE INTO product_barcodes (id, product_id, barcode, format, is_primary, created_by) VALUES (?, ?, ?, 'EAN-13', 1, 'system')"
    ).run(id, product.id, code);
  }
}

export function getDb(): SqliteDatabaseSync {
  if (global.__ascentraDbInstance) {
    // Schema sync runs once per process (on first open), not on every query.
    // Re-running it per call caused severe page-load slowdowns.
    if ((!IS_POSTGRES || forceSqliteForTests) && !(global as any).__ascentraSchemaSynced) {
      syncSchemaColumnsFromCreateTables(global.__ascentraDbInstance);
      (global as any).__ascentraSchemaSynced = true;
    }
    return global.__ascentraDbInstance;
  }

  if (IS_POSTGRES && !forceSqliteForTests) {
    // Schema and data are provisioned by scripts/migrate-sqlite-to-postgres.ts.
    // Running SQLite's PRAGMA/ALTER migration path here would be invalid SQL.
    global.__ascentraDbInstance = openPostgresDatabase();
    // Additive product-photo columns can be applied to an existing Supabase
    // database without a destructive re-import of the migrated data.
    for (const alter of [
      "ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT",
      "ALTER TABLE products ADD COLUMN IF NOT EXISTS image_source TEXT",
    ]) {
      try {
        global.__ascentraDbInstance.exec(alter);
      } catch {
        // Table may not exist yet during initial provisioning; migrate script owns it.
      }
    }
    (global as any).__ascentraSchemaSynced = true;
    return global.__ascentraDbInstance;
  }

  const configuredPath = process.env.SQLITE_DB_PATH?.trim() || "./data/ascentra-erp.sqlite";
  const dbPath =
    configuredPath === ":memory:"
      ? ":memory:"
      : path.isAbsolute(configuredPath)
        ? configuredPath
        : path.join(process.cwd(), configuredPath);

  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = openSqliteDatabase(dbPath);
  try {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    // Wait briefly for another process to release a write lock instead of
    // failing immediately (build workers / multiple server instances).
    db.exec("PRAGMA busy_timeout = 10000;");
  } catch {
    // ignore
  }
  syncSchemaColumnsFromCreateTables(db);
  try {
    db.exec(SCHEMA_SQL);
  } catch {
    // individual tables and indexes are already synced via syncSchemaColumnsFromCreateTables
  }
  // Backfill demo barcodes idempotently — never duplicates (PK/barcode UNIQUE)
  try {
    backfillDemoBarcodes(db);
  } catch (err) {
    console.error("SEED BARCODE BACKFILL ERROR:", err);
  }
  const userMigrations = [
    "ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE users ADD COLUMN mfa_secret TEXT",
    "ALTER TABLE users ADD COLUMN mfa_backup_codes TEXT",
    "ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN locked_until TEXT",
    "ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0"
  ];
  for (const sql of userMigrations) {
    try {
      db.exec(sql);
    } catch {
      // column already exists
    }
  }
  try {
    db.exec("ALTER TABLE customers ADD COLUMN payment_terms TEXT NOT NULL DEFAULT 'Net 30'");
  } catch {
    // column already exists
  }

  // Product-master attributes added after the original catalogue schema. SQLite
  // has no "ADD COLUMN IF NOT EXISTS", so each statement is attempted once and
  // ignored when the column is already present.
  const inboundItemMigrations = [
    "ALTER TABLE inbound_shipment_items ADD COLUMN expected_weight REAL",
    "ALTER TABLE inbound_shipment_items ADD COLUMN weight_variance_pct REAL",
    "ALTER TABLE inbound_shipment_items ADD COLUMN weight_discrepancy_status TEXT",
    "ALTER TABLE inbound_shipment_items ADD COLUMN scale_reference TEXT",
    "ALTER TABLE inbound_shipment_items ADD COLUMN weight_tolerance_pct REAL",
  ];
  for (const sql of inboundItemMigrations) {
    try { db.exec(sql); } catch { /* exists */ }
  }

  const productMigrations = [
    "ALTER TABLE products ADD COLUMN description TEXT",
    "ALTER TABLE products ADD COLUMN brand TEXT",
    "ALTER TABLE products ADD COLUMN hs_code TEXT",
    "ALTER TABLE products ADD COLUMN base_uom TEXT",
    "ALTER TABLE products ADD COLUMN pack_uom TEXT",
    "ALTER TABLE products ADD COLUMN units_per_case INTEGER",
    "ALTER TABLE products ADD COLUMN unit_weight_kg REAL",
    "ALTER TABLE products ADD COLUMN case_weight_kg REAL",
    "ALTER TABLE products ADD COLUMN catch_weight INTEGER",
    "ALTER TABLE products ADD COLUMN catch_weight_min_kg REAL",
    "ALTER TABLE products ADD COLUMN catch_weight_max_kg REAL",
    "ALTER TABLE products ADD COLUMN tare_weight_kg REAL",
    "ALTER TABLE products ADD COLUMN allergens_json TEXT",
    "ALTER TABLE products ADD COLUMN may_contain_json TEXT",
    "ALTER TABLE products ADD COLUMN handling_json TEXT",
    "ALTER TABLE products ADD COLUMN diet_flags_json TEXT",
    "ALTER TABLE products ADD COLUMN temp_min_c REAL",
    "ALTER TABLE products ADD COLUMN temp_max_c REAL",
    "ALTER TABLE products ADD COLUMN min_shelf_life_days INTEGER",
    "ALTER TABLE products ADD COLUMN cost_price_cents INTEGER",
    "ALTER TABLE products ADD COLUMN currency TEXT",
    "ALTER TABLE products ADD COLUMN supplier_id TEXT",
    "ALTER TABLE products ADD COLUMN supplier_sku TEXT",
    "ALTER TABLE products ADD COLUMN batch_tracking INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE products ADD COLUMN weight_tolerance_pct REAL",
    "ALTER TABLE products ADD COLUMN required_documents_json TEXT",
    "ALTER TABLE products ADD COLUMN image_url TEXT",
    "ALTER TABLE products ADD COLUMN image_source TEXT",
  ];
  for (const sql of productMigrations) {
    try {
      db.exec(sql);
    } catch {
      // column already exists
    }
  }

  // Procurement workflow columns added after the original purchase-order
  // schema. Existing orders are treated as already approved.
  const procurementMigrations = [
    "ALTER TABLE purchase_orders ADD COLUMN rfq_id TEXT",
    "ALTER TABLE purchase_orders ADD COLUMN quotation_id TEXT",
    "ALTER TABLE purchase_orders ADD COLUMN freight_cents INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE purchase_orders ADD COLUMN duty_cents INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE purchase_orders ADD COLUMN other_cents INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE purchase_orders ADD COLUMN landed_cost_cents INTEGER",
    "ALTER TABLE purchase_orders ADD COLUMN unit_landed_cost_cents INTEGER",
    "ALTER TABLE purchase_orders ADD COLUMN incoterm TEXT",
    "ALTER TABLE purchase_orders ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'",
    "ALTER TABLE purchase_orders ADD COLUMN approved_by TEXT",
    "ALTER TABLE purchase_orders ADD COLUMN approved_at TEXT",
    "ALTER TABLE purchase_orders ADD COLUMN asn_carrier TEXT",
    "ALTER TABLE purchase_orders ADD COLUMN asn_eta TEXT",
    "ALTER TABLE purchase_orders ADD COLUMN asn_notes TEXT",
    "ALTER TABLE purchase_orders ADD COLUMN asn_captured_at TEXT",
    "ALTER TABLE purchase_orders ADD COLUMN warehouse TEXT NOT NULL DEFAULT 'WH-MILAN-01'",
  ];
  for (const sql of procurementMigrations) {
    try {
      db.exec(sql);
    } catch {
      // column already exists
    }
  }
  const inboundMigrations = [
    "ALTER TABLE inbound_batches ADD COLUMN accepted_qty REAL NOT NULL DEFAULT 0",
    "ALTER TABLE inbound_batches ADD COLUMN rejected_qty REAL NOT NULL DEFAULT 0",
    "ALTER TABLE inbound_batches ADD COLUMN quarantined_qty REAL NOT NULL DEFAULT 0",
    "ALTER TABLE inbound_batches ADD COLUMN held_qty REAL NOT NULL DEFAULT 0",
    "ALTER TABLE inbound_batches ADD COLUMN updated_at TEXT",
    "ALTER TABLE inventory_lots ADD COLUMN held_cases INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE inventory_lots ADD COLUMN quarantined_cases INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE inventory_lots ADD COLUMN rejected_cases INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE inventory_lots ADD COLUMN pending_cases INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE inventory_lots ADD COLUMN inspection_id TEXT",
    "ALTER TABLE inventory_lots ADD COLUMN quality_decision_reason TEXT",
    "ALTER TABLE inventory_lots ADD COLUMN quality_decided_by TEXT",
    "ALTER TABLE inventory_lots ADD COLUMN quality_decided_at TEXT",
    "ALTER TABLE stock_movements ADD COLUMN source_location TEXT",
    "ALTER TABLE stock_movements ADD COLUMN destination_location TEXT",
  ];
  for (const sql of inboundMigrations) {
    try {
      db.exec(sql);
    } catch {
      // column already exists
    }
  }
  try {
    db.exec("ALTER TABLE user_access_requests ADD COLUMN created_user_id TEXT");
  } catch {
    // column already exists
  }
  try {
    db.exec("ALTER TABLE user_contact_messages ADD COLUMN direction TEXT NOT NULL DEFAULT 'to_admin'");
  } catch {
    // column already exists
  }

  // Ensure default configurable HACCP checkpoint templates exist
  try {
    const tplCount = (db.prepare("SELECT COUNT(*) as c FROM haccp_checkpoint_templates").get() as { c: number } | undefined)?.c ?? 0;
    if (tplCount === 0) {
      const insertTpl = db.prepare(`
        INSERT OR IGNORE INTO haccp_checkpoint_templates (
          id, code, checkpoint_name, description, ccp_classification, is_ccp,
          category, sku, temp_zone, measurement_type, min_limit, max_limit, unit, expected_text, active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 1)
      `);
      insertTpl.run(
        "HCT-01",
        "CCP-1B-CHILLED-TEMP",
        "Chilled Product Core Temperature",
        "Verify arrival core/surface temperature of chilled perishable products using calibrated probe.",
        "CCP-1B",
        1,
        "Chilled",
        "Chilled (0°C to +4°C)",
        "temperature",
        0,
        4,
        "°C",
        "0°C to 4°C (or product-specific cold-chain range)"
      );
      insertTpl.run(
        "HCT-02",
        "CCP-1A-FROZEN-TEMP",
        "Deep-Frozen Product Temperature",
        "Verify frozen product core temperature shows no thawing or thermal abuse during transit.",
        "CCP-1A",
        1,
        "Frozen",
        "Frozen (-18°C)",
        "temperature",
        -28,
        -18,
        "°C",
        "-28°C to -18°C"
      );
      insertTpl.run(
        "HCT-03",
        "CCP-2-PACKAGING-INTEGRITY",
        "Primary & Secondary Packaging Integrity",
        "Check vacuum seals, MAP film, cartons, and tamper-evident closures for punctures, leaks, or crushing.",
        "CCP-2",
        1,
        "All",
        null,
        "condition",
        null,
        null,
        null,
        "Intact, sealed, clean, no leaks or pest/water damage"
      );
      insertTpl.run(
        "HCT-04",
        "CCP-3-CROSS-CONTAMINATION",
        "Allergen & Cross-Contamination Segregation",
        "Verify physical separation of raw seafood/meat from ready-to-eat items and absence of chemical/foreign bodies.",
        "CCP-3",
        1,
        "All",
        null,
        "condition",
        null,
        null,
        null,
        "Segregated, zero cross-contamination or foreign matter"
      );
      insertTpl.run(
        "HCT-05",
        "PRP-1-PRODUCT-FRESHNESS",
        "Organoleptic & Product Condition Check",
        "Visual appearance, color, odor, texture, and absence of freezer burn or spoilage.",
        "PRP-1",
        0,
        "All",
        null,
        "condition",
        null,
        null,
        null,
        "Normal appearance, odor, and freshness"
      );
      insertTpl.run(
        "HCT-06",
        "PRP-2-STORAGE-HANDLING",
        "Vehicle Hygiene & Storage Handling",
        "Inspect trailer cleanliness, air chute circulation, pallet condition, and EU 1169/2011 lot labelling.",
        "PRP-2",
        0,
        "All",
        null,
        "condition",
        null,
        null,
        null,
        "Clean reefer, compliant pallets and clear lot/expiry labels"
      );
    }
  } catch {
    // ignore if table not ready
  }

  // Ensure default configured warehouse zones and bins exist for Put-away (Module 05)
  try {
    const binCount = (db.prepare("SELECT COUNT(*) as c FROM warehouse_bins").get() as { c: number } | undefined)?.c ?? 0;
    if (binCount === 0) {
      const insertZone = db.prepare(`
        INSERT OR IGNORE INTO warehouse_zones (
          id, code, warehouse, name, zone_type, min_temp_c, max_temp_c,
          allowed_categories_json, segregation_rules_json, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertZone.run("ZN-MIL-01", "Z-MIL-SEAFOOD", "Milan Cold Hub", "Milan Chilled Seafood Chamber (0°C to +2°C)", "chilled", 0, 2, JSON.stringify(["Seafood"]), JSON.stringify(["raw_seafood_isolated"]), 1);
      insertZone.run("ZN-MIL-02", "Z-MIL-DAIRY", "Milan Cold Hub", "Milan Chilled Dairy & RTE Chamber (+2°C to +4°C)", "chilled", 2, 4, JSON.stringify(["Dairy", "Charcuterie", "Produce", "Chilled"]), JSON.stringify(["ready_to_eat", "no_raw_seafood"]), 1);
      insertZone.run("ZN-MIL-03", "Z-MIL-MEAT", "Milan Cold Hub", "Milan Chilled Meat Chamber (0°C to +4°C)", "chilled", 0, 4, JSON.stringify(["Meat", "Charcuterie"]), JSON.stringify(["raw_meat_segregated"]), 1);
      insertZone.run("ZN-MIL-04", "Z-MIL-FROZEN", "Milan Cold Hub", "Milan Deep-Freeze Vault (-25°C to -18°C)", "frozen", -25, -18, JSON.stringify(["Frozen", "Seafood", "Meat"]), JSON.stringify(["deep_frozen"]), 1);
      insertZone.run("ZN-MIL-05", "Z-MIL-AMBIENT", "Milan Cold Hub", "Milan Ambient Dry Store (+10°C to +22°C)", "ambient", 10, 22, JSON.stringify(["Ambient", "Produce"]), JSON.stringify(["dry_ambient"]), 1);
      insertZone.run("ZN-MIL-06", "Z-MIL-QUAR", "Milan Cold Hub", "Milan QA Quarantine & Hold Cage (0°C to +4°C)", "quarantine", 0, 4, JSON.stringify(["All"]), JSON.stringify(["quarantine_isolated"]), 1);
      insertZone.run("ZN-ROM-01", "Z-ROM-CHILL", "Rome Cold Hub", "Rome Chilled Distribution Chamber (0°C to +4°C)", "chilled", 0, 4, JSON.stringify(["Seafood", "Dairy", "Meat", "Produce", "Chilled"]), JSON.stringify(["general_chilled"]), 1);

      const insertBin = db.prepare(`
        INSERT OR IGNORE INTO warehouse_bins (
          id, code, barcode, warehouse, zone_id, zone_code, zone_name, storage_type,
          aisle, rack, shelf, position, min_temp_c, max_temp_c,
          max_cases, current_cases, max_weight_kg, current_weight_kg, max_volume_m3, current_volume_m3,
          allowed_categories_json, restricted_allergens_json, segregation_group, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Milan Chilled Seafood Bins (0..2°C)
      insertBin.run("BIN-MIL-01", "CHILL-A1-01", "BIN:CHILL-A1-01", "Milan Cold Hub", "ZN-MIL-01", "Z-MIL-SEAFOOD", "Milan Chilled Seafood Chamber (0°C to +2°C)", "chilled", "A1", "R01", "S01", "P01", 0, 2, 100, 15, 600, 75, 4.0, 0.6, JSON.stringify(["Seafood"]), JSON.stringify([]), "seafood_raw", "active", "Primary chilled seafood FEFO rack");
      insertBin.run("BIN-MIL-02", "CHILL-A1-02", "BIN:CHILL-A1-02", "Milan Cold Hub", "ZN-MIL-01", "Z-MIL-SEAFOOD", "Milan Chilled Seafood Chamber (0°C to +2°C)", "chilled", "A1", "R01", "S02", "P02", 0, 2, 100, 0, 600, 0, 4.0, 0.0, JSON.stringify(["Seafood"]), JSON.stringify([]), "seafood_raw", "active", "Secondary chilled seafood FEFO rack");

      // Milan Chilled Dairy & RTE Bins (2..4°C)
      insertBin.run("BIN-MIL-03", "CHILL-B1-01", "BIN:CHILL-B1-01", "Milan Cold Hub", "ZN-MIL-02", "Z-MIL-DAIRY", "Milan Chilled Dairy & RTE Chamber (+2°C to +4°C)", "chilled", "B1", "R01", "S01", "P01", 2, 4, 120, 10, 500, 30, 4.0, 0.4, JSON.stringify(["Dairy", "Charcuterie", "Produce", "Chilled"]), JSON.stringify(["Fish", "Crustaceans"]), "dairy_rte", "active", "Ready-to-eat dairy & DOP cheese rack (no raw fish)");
      insertBin.run("BIN-MIL-04", "CHILL-B1-02", "BIN:CHILL-B1-02", "Milan Cold Hub", "ZN-MIL-02", "Z-MIL-DAIRY", "Milan Chilled Dairy & RTE Chamber (+2°C to +4°C)", "chilled", "B1", "R01", "S02", "P02", 2, 4, 120, 0, 500, 0, 4.0, 0.0, JSON.stringify(["Dairy", "Charcuterie", "Produce", "Chilled"]), JSON.stringify(["Fish", "Crustaceans"]), "dairy_rte", "active", "Overflow dairy & RTE rack");

      // Milan Chilled Meat Bin (0..4°C)
      insertBin.run("BIN-MIL-05", "CHILL-C1-01", "BIN:CHILL-C1-01", "Milan Cold Hub", "ZN-MIL-03", "Z-MIL-MEAT", "Milan Chilled Meat Chamber (0°C to +4°C)", "chilled", "C1", "R01", "S01", "P01", 0, 4, 100, 0, 800, 0, 4.5, 0.0, JSON.stringify(["Meat", "Charcuterie"]), JSON.stringify(["Fish"]), "meat_raw", "active", "Chilled meat & charcuterie rack");

      // Milan Deep-Frozen Bins (-25..-18°C)
      insertBin.run("BIN-MIL-06", "FROZ-F1-01", "BIN:FROZ-F1-01", "Milan Cold Hub", "ZN-MIL-04", "Z-MIL-FROZEN", "Milan Deep-Freeze Vault (-25°C to -18°C)", "frozen", "F1", "R01", "S01", "P01", -25, -18, 150, 20, 1200, 160, 6.0, 0.8, JSON.stringify(["Frozen", "Seafood", "Meat"]), JSON.stringify([]), "frozen_general", "active", "Deep-freeze pallet bay 1");
      insertBin.run("BIN-MIL-07", "FROZ-F1-02", "BIN:FROZ-F1-02", "Milan Cold Hub", "ZN-MIL-04", "Z-MIL-FROZEN", "Milan Deep-Freeze Vault (-25°C to -18°C)", "frozen", "F1", "R01", "S02", "P02", -25, -18, 150, 0, 1200, 0, 6.0, 0.0, JSON.stringify(["Frozen", "Seafood", "Meat"]), JSON.stringify([]), "frozen_general", "active", "Deep-freeze pallet bay 2");

      // Milan Ambient Bins (10..22°C)
      insertBin.run("BIN-MIL-08", "AMB-D1-01", "BIN:AMB-D1-01", "Milan Cold Hub", "ZN-MIL-05", "Z-MIL-AMBIENT", "Milan Ambient Dry Store (+10°C to +22°C)", "ambient", "D1", "R01", "S01", "P01", 10, 22, 200, 0, 1500, 0, 8.0, 0.0, JSON.stringify(["Ambient", "Produce"]), JSON.stringify([]), "produce_ambient", "active", "Ambient dry goods & olive oil bay");
      insertBin.run("BIN-MIL-09", "AMB-D1-02", "BIN:AMB-D1-02", "Milan Cold Hub", "ZN-MIL-05", "Z-MIL-AMBIENT", "Milan Ambient Dry Store (+10°C to +22°C)", "ambient", "D1", "R01", "S02", "P02", 10, 22, 200, 0, 1500, 0, 8.0, 0.0, JSON.stringify(["Ambient", "Produce"]), JSON.stringify([]), "produce_ambient", "active", "Ambient dry goods bay 2");

      // Special test & operational states: Full bin, Blocked bin, Quarantine bin, Rome bin
      insertBin.run("BIN-MIL-10", "CHILL-FULL-99", "BIN:CHILL-FULL-99", "Milan Cold Hub", "ZN-MIL-01", "Z-MIL-SEAFOOD", "Milan Chilled Seafood Chamber (0°C to +2°C)", "chilled", "A9", "R09", "S01", "P01", 0, 2, 20, 20, 100, 100, 1.0, 1.0, JSON.stringify(["Seafood"]), JSON.stringify([]), "seafood_raw", "active", "100% full bin for capacity rejection verification");
      insertBin.run("BIN-MIL-11", "CHILL-BLK-98", "BIN:CHILL-BLK-98", "Milan Cold Hub", "ZN-MIL-01", "Z-MIL-SEAFOOD", "Milan Chilled Seafood Chamber (0°C to +2°C)", "chilled", "A9", "R09", "S02", "P02", 0, 2, 100, 0, 600, 0, 4.0, 0.0, JSON.stringify(["Seafood"]), JSON.stringify([]), "seafood_raw", "blocked", "Blocked for evaporator coil maintenance");
      insertBin.run("BIN-MIL-12", "QUAR-ZONE-01", "BIN:QUAR-ZONE-01", "Milan Cold Hub", "ZN-MIL-06", "Z-MIL-QUAR", "Milan QA Quarantine & Hold Cage (0°C to +4°C)", "quarantine", "Q1", "R01", "S01", "P01", 0, 4, 100, 0, 800, 0, 4.0, 0.0, JSON.stringify(["All"]), JSON.stringify([]), "quarantine", "restricted", "Isolated QA hold & quarantine cage");
      insertBin.run("BIN-ROM-01", "ROM-CH-01", "BIN:ROM-CH-01", "Rome Cold Hub", "ZN-ROM-01", "Z-ROM-CHILL", "Rome Chilled Distribution Chamber (0°C to +4°C)", "chilled", "R1", "R01", "S01", "P01", 0, 4, 120, 0, 800, 0, 5.0, 0.0, JSON.stringify(["Seafood", "Dairy", "Meat", "Produce", "Chilled"]), JSON.stringify([]), "general_chilled", "active", "Rome primary chilled rack");
    }
  } catch {
    // ignore if table not ready
  }

  // Module 06 Stock Intelligence column migrations & default shelf-life rules
  const stockIntelligenceMigrations = [
    "ALTER TABLE inventory_lots ADD COLUMN organization TEXT NOT NULL DEFAULT 'Ascentra Global Ltd'",
    "ALTER TABLE inventory_lots ADD COLUMN damaged_cases INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE inventory_lots ADD COLUMN expired_cases INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE inventory_lots ADD COLUMN in_transit_cases INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE inventory_lots ADD COLUMN catch_weight_kg REAL",
    "ALTER TABLE inventory_lots ADD COLUMN unit_cost_cents INTEGER",
    "ALTER TABLE stock_movements ADD COLUMN warehouse TEXT",
    "ALTER TABLE stock_movements ADD COLUMN zone TEXT",
    "ALTER TABLE stock_movements ADD COLUMN reference_type TEXT",
    "ALTER TABLE stock_movements ADD COLUMN reference_id TEXT",
    "ALTER TABLE stock_movements ADD COLUMN weight_delta_kg REAL",
    "ALTER TABLE stock_movements ADD COLUMN idempotency_key TEXT"
  ];
  for (const sql of stockIntelligenceMigrations) {
    try {
      db.exec(sql);
    } catch {
      // column already exists
    }
  }
  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_movements_idemp ON stock_movements(idempotency_key) WHERE idempotency_key IS NOT NULL");
  } catch {
    // index already exists
  }

  try {
    const slCount = (db.prepare("SELECT COUNT(*) as c FROM shelf_life_rules").get() as { c: number } | undefined)?.c ?? 0;
    if (slCount === 0) {
      const insertRule = db.prepare(`
        INSERT OR IGNORE INTO shelf_life_rules (
          id, rule_code, rule_scope, sku, product_name, category,
          customer_id, customer_name, customer_segment,
          min_remaining_days, min_remaining_pct,
          enforce_at_allocation, enforce_at_pick, allow_manager_override, notes, active, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, ?, 1, 'elena.conti@ascentra.it')
      `);
      insertRule.run("SLR-01", "SLR-PRD-SALMON", "product", "SKU-SAL-001", "Norwegian Atlantic Salmon Fillet (Trim D)", "Seafood", null, null, null, 3, 40, "Fresh chilled salmon requires >= 3 days remaining shelf life at customer delivery.");
      insertRule.run("SLR-02", "SLR-PRD-BURRATA", "product", "SKU-BUR-004", "Artisanal Burrata di Andria IGP (12x125g)", "Dairy", null, null, null, 2, 35, "Fresh burrata requires >= 2 days remaining shelf life at customer delivery.");
      insertRule.run("SLR-03", "SLR-PRD-BEEF", "product", "SKU-BFL-009", "Dry-Aged Piedmontese Beef Striploin", "Meat", null, null, null, 5, 35, "Dry-aged beef requires >= 5 days remaining shelf life at delivery.");
      insertRule.run("SLR-04", "SLR-CUST-CRACCO", "customer", null, null, null, "CUST-B2B-01", "Ristorante Cracco Galleria", "Fine Dining", 4, 50, "Fine dining SLA: minimum 4 days remaining shelf life at promised delivery date.");
      insertRule.run("SLR-05", "SLR-CUST-SAVOIA", "customer", null, null, null, "CUST-B2B-02", "Hotel Principe di Savoia", "Luxury Hotel", 5, 50, "Luxury hospitality contract: minimum 5 days remaining shelf life at delivery.");
      insertRule.run("SLR-06", "SLR-SEG-RETAIL", "segment", null, null, null, null, null, "Retail Store", 3, 40, "Retail store replenishment requires >= 3 days shelf life on store arrival.");
    }
  } catch {
    // ignore if table not ready
  }

  // Module 07 Customer Order migrations & default contracts
  const customerOrderMigrations = [
    "ALTER TABLE customers ADD COLUMN delivery_address TEXT",
    "ALTER TABLE customers ADD COLUMN tax_id TEXT",
    "ALTER TABLE customers ADD COLUMN min_shelf_life_days INTEGER DEFAULT 5",
    "ALTER TABLE customers ADD COLUMN allow_backorders INTEGER DEFAULT 1",
    "ALTER TABLE customers ADD COLUMN credit_status TEXT DEFAULT 'approved'",
    "ALTER TABLE sales_orders ADD COLUMN po_reference TEXT",
    "ALTER TABLE sales_orders ADD COLUMN delivery_address TEXT",
    "ALTER TABLE sales_orders ADD COLUMN delivery_notes TEXT",
    "ALTER TABLE sales_orders ADD COLUMN subtotal_cents INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE sales_orders ADD COLUMN tax_cents INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE sales_orders ADD COLUMN payment_terms TEXT DEFAULT 'Net 30'",
    "ALTER TABLE sales_orders ADD COLUMN cancellation_reason TEXT",
    "ALTER TABLE sales_orders ADD COLUMN submitted_at TEXT",
    "ALTER TABLE sales_orders ADD COLUMN confirmed_at TEXT",
    "ALTER TABLE sales_orders ADD COLUMN approval_status TEXT DEFAULT 'none'",
    "ALTER TABLE sales_orders ADD COLUMN approval_notes TEXT",
    "ALTER TABLE sales_orders ADD COLUMN approved_at TEXT",
    "ALTER TABLE sales_orders ADD COLUMN is_backorder INTEGER DEFAULT 0",
    "ALTER TABLE sales_order_lines ADD COLUMN cases_backordered INTEGER DEFAULT 0",
    "ALTER TABLE sales_order_lines ADD COLUMN line_status TEXT DEFAULT 'confirmed'",
    "ALTER TABLE sales_order_lines ADD COLUMN uom TEXT DEFAULT 'case'",
    "ALTER TABLE sales_order_lines ADD COLUMN pricing_source TEXT DEFAULT 'standard'",
    "ALTER TABLE sales_order_lines ADD COLUMN contract_id TEXT",
    "ALTER TABLE sales_order_lines ADD COLUMN original_list_price_cents INTEGER",
    "ALTER TABLE sales_order_lines ADD COLUMN discount_cents INTEGER DEFAULT 0",
    "ALTER TABLE sales_order_lines ADD COLUMN vat_rate_pct REAL DEFAULT 4.0",
    "ALTER TABLE sales_order_lines ADD COLUMN tax_cents INTEGER DEFAULT 0",
    "ALTER TABLE sales_order_lines ADD COLUMN line_total_cents INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE sales_order_lines ADD COLUMN shelf_life_min_days INTEGER",
    "ALTER TABLE sales_order_lines ADD COLUMN shelf_life_verified INTEGER DEFAULT 1",
    "ALTER TABLE sales_order_lines ADD COLUMN notes TEXT",
    "ALTER TABLE packing_records ADD COLUMN created_at TEXT",
    "ALTER TABLE packing_records ADD COLUMN updated_at TEXT"
  ];
  for (const sql of customerOrderMigrations) {
    try {
      db.exec(sql);
    } catch {
      // column already exists
    }
  }

  // Module 09 Loading & Delivery migrations
  const deliveryMigrations = [
    "ALTER TABLE deliveries ADD COLUMN delivery_reference TEXT",
    "ALTER TABLE deliveries ADD COLUMN customer_id TEXT",
    "ALTER TABLE deliveries ADD COLUMN delivery_address TEXT",
    "ALTER TABLE deliveries ADD COLUMN warehouse TEXT NOT NULL DEFAULT 'Milan Cold Hub'",
    "ALTER TABLE deliveries ADD COLUMN delivery_date TEXT",
    "ALTER TABLE deliveries ADD COLUMN time_window_start TEXT",
    "ALTER TABLE deliveries ADD COLUMN time_window_end TEXT",
    "ALTER TABLE deliveries ADD COLUMN driver_id TEXT",
    "ALTER TABLE deliveries ADD COLUMN vehicle_id TEXT",
    "ALTER TABLE deliveries ADD COLUMN stop_sequence INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE deliveries ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'",
    "ALTER TABLE deliveries ADD COLUMN total_packages INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE deliveries ADD COLUMN total_pallets INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE deliveries ADD COLUMN total_cases REAL NOT NULL DEFAULT 0",
    "ALTER TABLE deliveries ADD COLUMN total_weight_kg REAL NOT NULL DEFAULT 0",
    "ALTER TABLE deliveries ADD COLUMN departure_time TEXT",
    "ALTER TABLE deliveries ADD COLUMN arrival_time TEXT",
    "ALTER TABLE deliveries ADD COLUMN completed_time TEXT",
    "ALTER TABLE deliveries ADD COLUMN driver_notes TEXT",
    "ALTER TABLE deliveries ADD COLUMN invoiced_cases REAL NOT NULL DEFAULT 0",
    "ALTER TABLE deliveries ADD COLUMN created_at TEXT",
    "ALTER TABLE deliveries ADD COLUMN updated_at TEXT"
  ];
  for (const sql of deliveryMigrations) {
    try {
      db.exec(sql);
    } catch {
      // column already exists
    }
  }

  // Module 10 Finance migrations
  const financeMigrations = [
    "ALTER TABLE invoices ADD COLUMN delivery_id TEXT",
    "ALTER TABLE invoices ADD COLUMN subtotal_cents INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE invoices ADD COLUMN tax_cents INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE invoices ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE invoices ADD COLUMN currency TEXT NOT NULL DEFAULT 'EUR'",
    "ALTER TABLE invoices ADD COLUMN is_credit_note INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE invoices ADD COLUMN original_invoice_id TEXT",
    "ALTER TABLE invoices ADD COLUMN customer_piva TEXT",
    "ALTER TABLE invoices ADD COLUMN customer_fiscal_code TEXT",
    "ALTER TABLE invoices ADD COLUMN customer_sdi_code TEXT DEFAULT 'SUBM70N'",
    "ALTER TABLE invoices ADD COLUMN customer_pec TEXT",
    "ALTER TABLE invoices ADD COLUMN customer_address TEXT",
    "ALTER TABLE invoices ADD COLUMN notes TEXT",
    "ALTER TABLE invoices ADD COLUMN sdi_sent_at TEXT",
    "ALTER TABLE invoices ADD COLUMN sdi_delivered_at TEXT",
    "ALTER TABLE invoices ADD COLUMN sdi_error_code TEXT",
    "ALTER TABLE invoices ADD COLUMN sdi_error_description TEXT",
    "ALTER TABLE invoices ADD COLUMN sdi_version INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE invoices ADD COLUMN xml_content TEXT",
    "ALTER TABLE invoices ADD COLUMN created_at TEXT",
    "ALTER TABLE payments ADD COLUMN customer_id TEXT",
    "ALTER TABLE payments ADD COLUMN unallocated_cents INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE payments ADD COLUMN currency TEXT NOT NULL DEFAULT 'EUR'",
    "ALTER TABLE payments ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'bank_transfer'",
    "ALTER TABLE payments ADD COLUMN bank_statement_id TEXT",
    "ALTER TABLE payments ADD COLUMN status TEXT NOT NULL DEFAULT 'settled'",
    "ALTER TABLE payments ADD COLUMN notes TEXT",
    "ALTER TABLE customers ADD COLUMN piva TEXT",
    "ALTER TABLE customers ADD COLUMN fiscal_code TEXT",
    "ALTER TABLE customers ADD COLUMN sdi_recipient_code TEXT DEFAULT 'SUBM70N'",
    "ALTER TABLE customers ADD COLUMN pec_email TEXT",
    "ALTER TABLE customers ADD COLUMN postal_code TEXT DEFAULT '20121'",
    "ALTER TABLE customers ADD COLUMN country TEXT DEFAULT 'IT'",
    "ALTER TABLE sales_order_lines ADD COLUMN invoiced_cases REAL NOT NULL DEFAULT 0",
    "ALTER TABLE delivery_manifest_items ADD COLUMN invoiced_cases REAL NOT NULL DEFAULT 0"
  ];
  for (const sql of financeMigrations) {
    try {
      db.exec(sql);
    } catch {
      // column already exists
    }
  }

  // Module 11 Exceptions & Recall migrations
  const exceptionsRecallMigrations = [
    "ALTER TABLE recall_notifications ADD COLUMN recall_id TEXT",
    "ALTER TABLE recall_notifications ADD COLUMN customer_id TEXT",
    "ALTER TABLE recall_notifications ADD COLUMN channel TEXT NOT NULL DEFAULT 'email'",
    "ALTER TABLE recall_notifications ADD COLUMN recipient_contact TEXT",
    "ALTER TABLE recall_notifications ADD COLUMN subject TEXT",
    "ALTER TABLE recall_notifications ADD COLUMN body_content TEXT",
    "ALTER TABLE recall_notifications ADD COLUMN acknowledgment_status TEXT NOT NULL DEFAULT 'sent'",
    "ALTER TABLE recall_notifications ADD COLUMN acknowledged_at TEXT",
    "ALTER TABLE recall_notifications ADD COLUMN response_text TEXT",
    "ALTER TABLE quality_exceptions ADD COLUMN customer_id TEXT",
    "ALTER TABLE quality_exceptions ADD COLUMN customer_name TEXT",
    "ALTER TABLE quality_exceptions ADD COLUMN order_id TEXT",
    "ALTER TABLE quality_exceptions ADD COLUMN order_number TEXT",
    "ALTER TABLE quality_exceptions ADD COLUMN delivery_id TEXT",
    "ALTER TABLE quality_exceptions ADD COLUMN containment_actions TEXT",
    "ALTER TABLE quality_exceptions ADD COLUMN capa_id TEXT",
    "ALTER TABLE quality_capas ADD COLUMN recall_id TEXT"
  ];
  for (const sql of exceptionsRecallMigrations) {
    try {
      db.exec(sql);
    } catch {
      // column already exists
    }
  }

  // Module 13 Fast-Food Store / Vendor Monitoring migrations
  const storeMonitoringMigrations = [
    "ALTER TABLE customers ADD COLUMN store_code TEXT",
    "ALTER TABLE customers ADD COLUMN parent_franchise_group TEXT",
    "ALTER TABLE customers ADD COLUMN region TEXT",
    "ALTER TABLE customers ADD COLUMN contact_name TEXT",
    "ALTER TABLE customers ADD COLUMN contact_email TEXT",
    "ALTER TABLE customers ADD COLUMN contact_phone TEXT",
    "ALTER TABLE customers ADD COLUMN assigned_distributor TEXT DEFAULT 'Ascentra Global Ltd - Milan Cold Hub'",
    "ALTER TABLE customers ADD COLUMN assigned_contract_id TEXT",
    "ALTER TABLE customers ADD COLUMN allowed_skus_json TEXT DEFAULT '[]'",
    "ALTER TABLE customers ADD COLUMN approved_by TEXT",
    "ALTER TABLE customers ADD COLUMN approved_at TEXT",
    "ALTER TABLE customers ADD COLUMN created_at TEXT",
    "ALTER TABLE users ADD COLUMN store_sub_role TEXT",
    "ALTER TABLE users ADD COLUMN store_permissions_json TEXT DEFAULT '[]'",
    "ALTER TABLE users ADD COLUMN invited_by TEXT",
    "ALTER TABLE users ADD COLUMN invited_at TEXT"
  ];
  for (const sql of storeMonitoringMigrations) {
    try {
      db.exec(sql);
    } catch {
      // column already exists
    }
  }

  if (!IS_NEXT_BUILD) enforceStartupData(db, dbPath);

  global.__ascentraDbInstance = db;
  (global as any).__ascentraSchemaSynced = true;
  return db;
}

/**
 * Idempotent startup data enforcement. Kept out of `getDb()` so build workers
 * can open the database read-only without replaying all of these writes.
 */
function enforceStartupData(db: SqliteDatabaseSync, dbPath: string): void {
  if (process.env.SEED_DEMO_DATA === "true" || dbPath === ":memory:") {
    seedDatabase(db);
  }

  // Populate default customer delivery addresses & tax IDs where null
  try {
    db.prepare("UPDATE customers SET delivery_address = 'Galleria Vittorio Emanuele II, 20121 Milano MI', tax_id = 'IT08923410961', min_shelf_life_days = 4 WHERE id = 'CUST-B2B-01' AND (delivery_address IS NULL OR delivery_address = '')").run();
    db.prepare("UPDATE customers SET delivery_address = 'Piazza della Repubblica 17, 20124 Milano MI', tax_id = 'IT01289450152', min_shelf_life_days = 5 WHERE id = 'CUST-B2B-02' AND (delivery_address IS NULL OR delivery_address = '')").run();
    db.prepare("UPDATE customers SET delivery_address = 'Via Stella 22, 41121 Modena MO', tax_id = 'IT02487310368', min_shelf_life_days = 4 WHERE id = 'CUST-B2B-03' AND (delivery_address IS NULL OR delivery_address = '')").run();
    db.prepare("UPDATE customers SET delivery_address = 'Via Giorgio Vasari 3, 20135 Milano MI', tax_id = 'IT09412380965', min_shelf_life_days = 3 WHERE id = 'CUST-B2B-04' AND (delivery_address IS NULL OR delivery_address = '')").run();
    db.prepare("UPDATE customers SET delivery_address = 'Via Fiori Chiari 14, 20121 Milano MI', tax_id = 'IT07812900963', min_shelf_life_days = 3 WHERE id = 'STR-MIL-01' AND (delivery_address IS NULL OR delivery_address = '')").run();
  } catch (e) {
    // ignore
  }

  // Ensure default contracts and contract items exist
  try {
    const ctrCount = (db.prepare("SELECT COUNT(*) as c FROM customer_contracts").get() as { c: number } | undefined)?.c ?? 0;
    if (ctrCount === 0) {
      const insertCtr = db.prepare(`
        INSERT OR IGNORE INTO customer_contracts (
          id, contract_number, customer_id, title, start_date, end_date,
          currency, payment_terms, credit_limit_cents, discount_pct, status, notes, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, 'EUR', ?, ?, ?, 'active', ?, 'elena.conti@ascentra.it')
      `);
      const insertItem = db.prepare(`
        INSERT OR IGNORE INTO customer_contract_items (
          id, contract_id, sku, unit_price_cents, uom, min_quantity, discount_pct,
          promotional_price_cents, promo_start, promo_end, customer_sku, is_exclusive, notes
        ) VALUES (?, ?, ?, ?, 'case', ?, ?, ?, ?, ?, ?, 0, ?)
      `);

      // 1. Cracco Galleria Master Agreement (Fine Dining)
      insertCtr.run("CTR-2026-CRACCO", "CTR-2026-001", "CUST-B2B-01", "Ristorante Cracco Fine Dining Master Contract", relativeDate(-60), relativeDate(305), "Net 30", 2500000, 5.0, "Exclusive Michelin fine dining supply agreement with FEFO tier guarantees.");
      insertItem.run("CTRI-01", "CTR-2026-CRACCO", "SKU-SAL-001", 8900, 1, 5.8, null, null, null, "CRAC-SAL-01", "Cracco base contract price on Norwegian Salmon");
      insertItem.run("CTRI-02", "CTR-2026-CRACCO", "SKU-SAL-001", 8400, 20, 11.1, null, null, null, "CRAC-SAL-VOL", "Volume discount tier for >= 20 cases");
      insertItem.run("CTRI-03", "CTR-2026-CRACCO", "SKU-BUR-004", 2550, 1, 11.7, null, null, null, "CRAC-BUR-01", "Handcrafted Burrata di Andria contract price");
      insertItem.run("CTRI-04", "CTR-2026-CRACCO", "SKU-BFL-009", 19800, 1, 8.3, null, null, null, "CRAC-BFL-01", "Dry-Aged Beef contract rate");

      // 2. Hotel Principe di Savoia (Luxury Hospitality) - includes promotional price on Salmon
      insertCtr.run("CTR-2026-SAVOIA", "CTR-2026-002", "CUST-B2B-02", "Hotel Principe di Savoia Hospitality Master Agreement", relativeDate(-30), relativeDate(335), "Net 45", 1200000, 3.0, "Luxury hotel annual supply contract with seasonal seafood promotion.");
      insertItem.run("CTRI-05", "CTR-2026-SAVOIA", "SKU-SAL-001", 9100, 1, 3.7, 8200, relativeDate(-7), relativeDate(14), "SAV-SAL-PROMO", "Winter Gastronomy Promo (€82.00/case)");
      insertItem.run("CTRI-06", "CTR-2026-SAVOIA", "SKU-OCT-018", 12500, 1, 9.4, null, null, null, "SAV-OCT-01", "Mediterranean Octopus contract rate");

      // 3. Gourmet Market Brera (Retail Flagship)
      insertCtr.run("CTR-2026-BRERA", "CTR-2026-003", "STR-MIL-01", "Gourmet Market Brera Retail Franchise Agreement", relativeDate(-90), relativeDate(275), "Net 30", 3500000, 4.0, "High-volume retail store replenishment contract.");
      insertItem.run("CTRI-07", "CTR-2026-BRERA", "SKU-TMA-012", 3100, 1, 10.1, null, null, null, "BRER-TMA-01", "San Marzano DOP base contract");
      insertItem.run("CTRI-08", "CTR-2026-BRERA", "SKU-TMA-012", 2850, 25, 17.3, null, null, null, "BRER-TMA-VOL", "San Marzano bulk volume tier >= 25 cases");
      insertItem.run("CTRI-09", "CTR-2026-BRERA", "SKU-RVL-033", 3800, 1, 9.5, null, null, null, "BRER-RVL-01", "Fresh Truffle Ravioli store contract rate");
    }
  } catch {
    // ignore if table not ready
  }

  // Ensure customer portal accounts exist in users table
  try {
    const defaultPassHash = hashPassword("Ascentra!2026");
    const insertPortalUser = db.prepare(`
      INSERT OR IGNORE INTO users (id, email, name, password_hash, role, store_id, warehouse)
      VALUES (?, ?, ?, ?, 'store_vendor', ?, 'Milan Cold Hub')
    `);
    if (!wasUserDeleted(db, "USR-CUST-CRACCO", "carlo@ristorantecracco.it")) {
      insertPortalUser.run("USR-CUST-CRACCO", "carlo@ristorantecracco.it", "Carlo Cracco", defaultPassHash, "CUST-B2B-01");
    }
    if (!wasUserDeleted(db, "USR-CUST-SAVOIA", "fnb@hotelprincipedisavoia.it")) {
      insertPortalUser.run("USR-CUST-SAVOIA", "fnb@hotelprincipedisavoia.it", "Hotel Savoia F&B", defaultPassHash, "CUST-B2B-02");
    }
    if (!wasUserDeleted(db, "USR-CUST-FRANCESCANA", "purchasing@osteriafrancescana.it")) {
      insertPortalUser.run("USR-CUST-FRANCESCANA", "purchasing@osteriafrancescana.it", "Francescana Purchasing", defaultPassHash, "CUST-B2B-03");
    }
  } catch (e) {
    // ignore
  }

  seedPickingAndStaging(db);
  seedVehiclesAndDrivers(db);
  seedFinanceModule(db);
  seedExceptionsAndRecallModule(db);
  seedManagementAndAiModule(db);
  seedStoreMonitoringModule(db);
}

export function seedFinanceModule(db: SqliteDatabaseSync): void {
  // 0. Ensure customer CUST-001 / CUST-B2B-01 exists with fiscal profile
  try {
    db.prepare(`
      INSERT OR IGNORE INTO customers (
        id, name, city, segment, manager, customer_type, status, payment_terms, credit_limit_cents,
        delivery_address, tax_id, piva, fiscal_code, sdi_recipient_code, pec_email, postal_code, country
      ) VALUES (
        'CUST-001', 'Ristorante Cracco Galleria', 'Milano', 'Fine Dining', 'Chef Carlo Cracco', 'b2b_restaurant', 'active', 'Net 30', 2500000,
        'Galleria Vittorio Emanuele II, 20121 Milano MI', 'IT08923410961', '08923410961', '08923410961', 'M5UXCR1', 'cracco.galleria@pec.it', '20121', 'IT'
      )
    `).run();
  } catch (e) {
    console.error("SEED STEP 0 ERROR:", e);
  }

  // 1. Update Customer Italian Fiscal Profile
  try {
    const updateFiscal = db.prepare(`
      UPDATE customers
      SET piva = ?, fiscal_code = ?, sdi_recipient_code = ?, pec_email = ?, postal_code = ?, country = 'IT'
      WHERE id = ?
    `);
    updateFiscal.run("08923410961", "08923410961", "M5UXCR1", "cracco.galleria@pec.it", "20121", "CUST-B2B-01");
    updateFiscal.run("08923410961", "08923410961", "M5UXCR1", "cracco.galleria@pec.it", "20121", "CUST-001");
    updateFiscal.run("01289450152", "01289450152", "SUBM70N", "amministrazione.savoia@pec.it", "20124", "CUST-B2B-02");
    updateFiscal.run("02487310368", "02487310368", "A472NK3", "osteriafrancescana@pec.it", "41121", "CUST-B2B-03");
    updateFiscal.run("09412380965", "09412380965", "W7YVJK9", "trippamilano@pec.it", "20135", "CUST-B2B-04");
    updateFiscal.run("07812900963", "07812900963", "SUBM70N", "amministrazione@gourmetbrera.it", "20121", "STR-MIL-01");
  } catch (e) {
    // ignore
  }

  // 2. Update existing invoices with subtotal, tax, and customer fiscal details
  try {
    db.prepare(`
      UPDATE invoices
      SET subtotal_cents = 571818, tax_cents = 57182, customer_piva = '02487310368', customer_fiscal_code = '02487310368', customer_sdi_code = 'A472NK3', customer_address = 'Via Stella 22, 41121 Modena MO'
      WHERE id = 'INV-2026-8410'
    `).run();
    db.prepare(`
      UPDATE invoices
      SET subtotal_cents = 174909, tax_cents = 17491, customer_piva = '09412380965', customer_fiscal_code = '09412380965', customer_sdi_code = 'W7YVJK9', customer_address = 'Via Giorgio Vasari 3, 20135 Milano MI'
      WHERE id = 'INV-2026-8411'
    `).run();
    db.prepare(`
      UPDATE invoices
      SET subtotal_cents = 440182, tax_cents = 44018, customer_piva = '08923410961', customer_fiscal_code = '08923410961', customer_sdi_code = 'M5UXCR1', customer_address = 'Galleria Vittorio Emanuele II, 20121 Milano MI'
      WHERE id = 'INV-2026-8412'
    `).run();
    db.prepare(`
      UPDATE invoices
      SET subtotal_cents = 374545, tax_cents = 37455, customer_piva = '01289450152', customer_fiscal_code = '01289450152', customer_sdi_code = 'SUBM70N', customer_address = 'Via Roma 12, 10121 Torino TO'
      WHERE id = 'INV-2026-8390'
    `).run();
    db.prepare(`
      UPDATE invoices
      SET subtotal_cents = 813636, tax_cents = 81364, customer_piva = '01289450152', customer_fiscal_code = '01289450152', customer_sdi_code = 'SUBM70N', customer_address = 'Piazza della Repubblica 17, 20124 Milano MI'
      WHERE id = 'INV-2026-8398'
    `).run();
  } catch (e) {
    console.error("SEED STEP 0 ERROR:", e);
  }

  // 3. Seed Invoice Lines for existing invoices
  try {
    const lineCount = (db.prepare("SELECT COUNT(*) as c FROM invoice_lines").get() as { c: number } | undefined)?.c ?? 0;
    if (lineCount === 0) {
      const insertLine = db.prepare(`
        INSERT OR IGNORE INTO invoice_lines (
          id, invoice_id, sku, product_name, cases_delivered, catch_weight_kg,
          unit_price_cents, discount_pct, tax_rate_pct, subtotal_cents, tax_cents, total_cents, lot_batch
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertLine.run("INVL-01", "INV-2026-8410", "SKU-BFL-009", "Dry-Aged Chianina Beef Fillet", 30, 360.0, 19060, 0, 10.0, 571818, 57182, 629000, "LOT-2026-BFL-044");
      insertLine.run("INVL-02", "INV-2026-8411", "SKU-BUR-004", "Handcrafted Burrata di Andria", 70, 140.0, 2498, 0, 10.0, 174909, 17491, 192400, "LOT-2026-BUR-019");
      insertLine.run("INVL-03", "INV-2026-8412", "SKU-SAL-001", "Norwegian Atlantic Salmon Fillet", 50, 480.0, 8803, 0, 10.0, 440182, 44018, 484200, "LOT-2026-SAL-082");
      insertLine.run("INVL-04", "INV-2026-8390", "SKU-TMA-012", "San Marzano Plum Tomatoes DOP", 120, 720.0, 3121, 0, 10.0, 374545, 37455, 412000, "LOT-2026-TMA-003");
      insertLine.run("INVL-05", "INV-2026-8398", "SKU-SAL-001", "Norwegian Atlantic Salmon Fillet", 90, 850.0, 9040, 0, 10.0, 813636, 81364, 895000, "LOT-2026-SAL-071");
    }
  } catch (e) {
    // ignore
  }

  // 4. Seed Payment Allocations
  try {
    const allocCount = (db.prepare("SELECT COUNT(*) as c FROM payment_allocations").get() as { c: number } | undefined)?.c ?? 0;
    if (allocCount === 0) {
      db.prepare(`
        INSERT OR IGNORE INTO payments (
          id, invoice_id, amount_cents, method, reference, recorded_by,
          customer_id, unallocated_cents, currency, payment_method, status
        ) VALUES
        ('PAY-SEED-01', 'INV-2026-8410', 629000, 'SEPA Credit Transfer', 'TRX-SEED-01', 'elena.conti@ascentra.it', 'CUST-B2B-03', 0, 'EUR', 'bank_transfer', 'settled'),
        ('PAY-SEED-02', 'INV-2026-8390', 150000, 'SEPA Credit Transfer', 'TRX-SEED-02', 'elena.conti@ascentra.it', 'STR-TUR-03', 0, 'EUR', 'bank_transfer', 'settled')
      `).run();

      const insertAlloc = db.prepare(`
        INSERT OR IGNORE INTO payment_allocations (id, payment_id, invoice_id, allocated_cents, allocated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `);
      insertAlloc.run("ALLOC-01", "PAY-SEED-01", "INV-2026-8410", 629000);
      insertAlloc.run("ALLOC-02", "PAY-SEED-02", "INV-2026-8390", 150000);
    }
  } catch (e) {
    console.error("STEP 7 SEED ERROR:", e);
  }

  // 5. Seed Bank Statements & Lines for demonstration
  try {
    const stmtCount = (db.prepare("SELECT COUNT(*) as c FROM bank_statements").get() as { c: number } | undefined)?.c ?? 0;
    if (stmtCount === 0) {
      db.prepare(`
        INSERT OR IGNORE INTO bank_statements (
          id, statement_reference, filename, file_checksum, account_iban,
          opening_balance_cents, closing_balance_cents, imported_by, total_lines, matched_lines, status
        ) VALUES (
          'STMT-2026-001', 'STMT-INTESA-2026-MAR', 'banca_intesa_statement_2026_03.csv',
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'IT60X0542811101000000123456',
          14520000, 22734000, 'elena.conti@ascentra.it', 4, 2, 'partially_reconciled'
        )
      `).run();

      const insertStmtLine = db.prepare(`
        INSERT OR IGNORE INTO bank_statement_lines (
          id, statement_id, line_number, transaction_date, value_date, amount_cents, currency,
          counterparty_name, counterparty_iban, bank_reference, description, reconciliation_status,
          matched_invoice_id, reconciled_by, reconciled_at
        ) VALUES (?, 'STMT-2026-001', ?, ?, ?, ?, 'EUR', ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertStmtLine.run("STMT-L-01", 1, relativeDate(-2), relativeDate(-2), 629000, "Osteria Francescana Group S.r.l.", "IT22A0306912903000000012345", "TRX-BNK-88410", "BONIFICO SEPA INV-2026-8410 OSTERIA FRANCESCANA", "matched", "INV-2026-8410", "elena.conti@ascentra.it", relativeDate(-1));
      insertStmtLine.run("STMT-L-02", 2, relativeDate(-1), relativeDate(-1), 192400, "Trattoria Trippa Milano", "IT33B0503411100000000067890", "TRX-BNK-88411", "BONIFICO SO-2026-9847 SALDO FATTURA TRIPPA", "matched", "INV-2026-8411", "elena.conti@ascentra.it", relativeDate(0));
      insertStmtLine.run("STMT-L-03", 3, relativeDate(0), relativeDate(0), 484200, "Ristorante Cracco Galleria S.r.l.", "IT44C0123456789000000009876", "TRX-BNK-88412", "BONIFICO CRACCO ACCONTO FORNITURA IT-08923410961", "partially_matched", "INV-2026-8412", null, null);
      insertStmtLine.run("STMT-L-04", 4, relativeDate(0), relativeDate(0), 150000, "Bonifico da Cliente Ignoto", null, "TRX-BNK-88413", "BONIFICO DISPOSIZIONE CLIENTE RIF CUCINA", "unmatched", null, null, null);
    }
  } catch (e) {
    // ignore
  }

  // 6. Seed Landed Cost Allocation
  try {
    const lcCount = (db.prepare("SELECT COUNT(*) as c FROM landed_cost_allocations").get() as { c: number } | undefined)?.c ?? 0;
    if (lcCount === 0) {
      db.prepare(`
        INSERT OR IGNORE INTO landed_cost_allocations (
          id, po_id, batch_id, allocation_number, allocation_method,
          total_freight_cents, total_customs_duty_cents, total_insurance_cents,
          total_handling_cents, total_other_cents, total_landed_cost_cents, allocated_by, notes
        ) VALUES (
          'LCA-2026-001', 'PO-2026-1041', 'LOT-2026-SAL-082', 'LCA-2026-001', 'weight',
          42000, 18000, 9500, 12500, 0, 82000, 'elena.conti@ascentra.it',
          'Air freight & customs import clearance from Norway via Milan Malpensa cargo terminal'
        )
      `).run();

      db.prepare(`
        INSERT OR IGNORE INTO landed_cost_items (
          id, allocation_id, sku, batch_id, cases, weight_kg, base_purchase_cost_cents,
          allocated_freight_cents, allocated_duty_cents, allocated_insurance_cents, allocated_handling_cents,
          total_allocated_cents, final_unit_cost_cents
        ) VALUES (
          'LCI-01', 'LCA-2026-001', 'SKU-SAL-001', 'LOT-2026-SAL-082', 100, 1000.0, 6800,
          420, 180, 95, 125, 820, 7620
        )
      `).run();
    }
  } catch (e) {
    // ignore
  }

  // 7. Seed Order SO-2026-9841 & Confirmed Delivery DEL-2026-0301 with Manifest Items for Invoicing
  try {
    db.prepare(`
      INSERT OR IGNORE INTO sales_orders (
        id, order_number, customer_id, customer, segment, channel, status,
        items_count, cases_total, total_cents, margin_pct, delivery_date, warehouse,
        created_at
      ) VALUES (
        'SO-2026-9841', 'SO-2026-9841', 'CUST-001', 'Ristorante Cracco Galleria', 'fine_dining', 'b2b_direct', 'delivered',
        3, 23, 484200, 24.5, date('now'), 'Milan Cold Hub', datetime('now')
      )
    `).run();

    db.prepare(`
      INSERT OR IGNORE INTO sales_order_lines (
        id, order_id, sku, product_name, cases_ordered, cases_allocated,
        unit_price_cents, vat_rate_pct, line_total_cents, invoiced_cases
      ) VALUES
      ('SOL-9841-01', 'SO-2026-9841', 'SKU-SAL-001', 'Salmone Norvegese Fresco Superiore', 10, 10, 8900, 10.0, 89000, 0),
      ('SOL-9841-02', 'SO-2026-9841', 'SKU-PRM-001', 'Parmigiano Reggiano DOP 24 Mesi', 8, 8, 2200, 4.0, 17600, 0),
      ('SOL-9841-03', 'SO-2026-9841', 'SKU-TRF-001', 'Salsa Tartufata Nera Pregiata', 5, 5, 4500, 10.0, 22500, 0)
    `).run();

    db.prepare(`
      INSERT OR IGNORE INTO deliveries (
        id, delivery_reference, order_id, order_number, customer_id, customer,
        delivery_address, warehouse, route_code, driver_id, driver,
        vehicle_id, vehicle, eta, temp_c, status, pod_signed, stops_completed,
        stops_total, priority, total_cases, invoiced_cases
      ) VALUES (
        'DEL-2026-0301', 'DEL-2026-0301', 'SO-2026-9841', 'SO-2026-9841', 'CUST-001', 'Ristorante Cracco Galleria',
        'Galleria Vittorio Emanuele II, 20121 Milano MI', 'Milan Cold Hub', 'RT-MIL-N1', 'DRV-001', 'Davide Galli',
        'VEH-001', 'MI-784-KR', '09:30', 2.2, 'delivered', 1, 1, 1, 'high', 23, 0
      )
    `).run();

    db.prepare(`
      INSERT OR IGNORE INTO delivery_manifest_items (
        id, manifest_number, delivery_id, order_id, order_number, order_line_id,
        sku, product_name, lot_batch, cases, weight_kg, uom, temp_zone, compartment,
        loading_sequence, is_scanned_loaded, invoiced_cases
      ) VALUES
      ('DMI-0301-1', 'MAN-0301', 'DEL-2026-0301', 'SO-2026-9841', 'SO-2026-9841', 'SOL-9841-01', 'SKU-SAL-001', 'Salmone Norvegese Fresco Superiore', 'LOT-2026-SAL-082', 10, 12.5, 'case', 'chilled', 'chilled', 1, 1, 0),
      ('DMI-0301-2', 'MAN-0301', 'DEL-2026-0301', 'SO-2026-9841', 'SO-2026-9841', 'SOL-9841-02', 'SKU-PRM-001', 'Parmigiano Reggiano DOP 24 Mesi', 'LOT-2026-PRM-091', 8, 20.0, 'case', 'chilled', 'chilled', 2, 1, 0),
      ('DMI-0301-3', 'MAN-0301', 'DEL-2026-0301', 'SO-2026-9841', 'SO-2026-9841', 'SOL-9841-03', 'SKU-TRF-001', 'Salsa Tartufata Nera Pregiata', 'LOT-2026-TRF-014', 5, 0.0, 'case', 'ambient', 'ambient', 3, 1, 0)
    `).run();
  } catch (e) {
    console.error("STEP 7 SEED ERROR:", e);
  }
}

let txDepth = 0;

export function withTransaction<T>(fn: (db: SqliteDatabaseSync) => T): T {
  const db = getDb();
  if (txDepth > 0) {
    return fn(db);
  }
  txDepth++;
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn(db);
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore rollback error if transaction already closed
    }
    throw err;
  } finally {
    txDepth--;
  }
}

export function resetDatabaseForTests(): SqliteDatabaseSync {
  txDepth = 0;
  forceSqliteForTests = true;
  process.env.SQLITE_DB_PATH = ":memory:";
  process.env.SEED_DEMO_DATA = "true";
  global.__ascentraDbInstance = undefined;
  (global as any).__ascentraSchemaSynced = false;
  return getDb();
}

export function clearAllOperationalData(): void {
  // Auth and security-configuration tables must survive: clearing business data
  // must never delete accounts, active sessions, refresh tokens, role
  // definitions, permission assignments, data scopes or approval thresholds.
  const preserved = new Set([
    "users",
    "user_sessions",
    "refresh_tokens",
    "roles",
    "permissions",
    "role_permissions",
    "user_roles",
    "user_permissions",
    "user_scopes",
    "user_credentials",
    "approval_thresholds",
    "rbac_meta"
  ]);
  withTransaction((db) => {
    // Tables reference each other, so delete order is otherwise constrained.
    // Deferring foreign-key checks until COMMIT lets us wipe every operational
    // table in one pass; the transaction still fails if a reference is truly
    // left dangling (for example to a deleted business record).
    db.exec("PRAGMA defer_foreign_keys = ON");
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>
    ).map((t) => t.name);

    for (const table of tables) {
      if (preserved.has(table)) continue;
      db.prepare(`DELETE FROM "${table}"`).run();
    }
  });
}

export function resetToProposalDemoData(): void {
  clearAllOperationalData();
  const db = getDb();
  seedDatabase(db);
}

export function seedExceptionsAndRecallModule(db: SqliteDatabaseSync): void {
  // 0. Ensure LOT-2026-SAL-082 exists in inventory_lots, inbound_batches and bin_stock_placements
  try {
    db.prepare(`
      INSERT OR IGNORE INTO customers (
        id, name, city, segment, manager, customer_type, status, payment_terms, credit_limit_cents,
        delivery_address, tax_id, piva, fiscal_code, sdi_recipient_code, pec_email, postal_code, country
      ) VALUES (
        'CUST-B2B-02', 'Hotel Principe di Savoia', 'Milano', 'Luxury Hospitality', 'Chef Matteo', 'hotel', 'active', 'Net 30', 5000000,
        'Piazza della Repubblica 17, 20124 Milano MI', 'IT01289450152', '01289450152', '01289450152', 'SUBM70N', 'amministrazione.savoia@pec.it', '20124', 'IT'
      )
    `).run();

    db.prepare(`
      INSERT OR IGNORE INTO inventory_lots (
        id, batch_id, sku, product_name, category, warehouse, location, zone,
        quantity_cases, received_cases, allocated_cases, quarantined_cases, received_date, expiry_date,
        supplier, supplier_lot, origin_country, quality_status, temp_c, unit_weight_kg
      ) VALUES (
        'LOT-2026-SAL-082', 'LOT-2026-SAL-082', 'SKU-SAL-001', 'Salmone Norvegese Fresco Superiore', 'Seafood',
        'Milan Cold Hub', 'CHILL-A1-01', 'Z-MIL-SEAFOOD', 65, 100, 0, 65, date('now', '-2 days'), date('now', '+5 days'),
        'Nordic Fjords Salmon AS', 'SUP-BAT-9921', 'Norway', 'quarantine', 2.1, 5.0
      )
    `).run();

    db.prepare(`
      INSERT OR IGNORE INTO inbound_shipments (
        id, shipment_ref, supplier_name, destination_warehouse, created_by
      ) VALUES (
        'SHP-2026-1041', 'SHP-2026-1041', 'Nordic Fjords Salmon AS', 'Milan Cold Hub', 'system'
      )
    `).run();

    db.prepare(`
      INSERT OR IGNORE INTO inbound_batches (
        id, shipment_id, sku, product_name, supplier_batch, internal_lot,
        supplier_id, supplier_name, po_id, po_number, expiry_date, received_date,
        origin, quantity, unit, status, accepted_qty, rejected_qty, quarantined_qty
      ) VALUES (
        'IB-2026-SAL-082', 'SHP-2026-1041', 'SKU-SAL-001', 'Salmone Norvegese Fresco Superiore', 'SUP-BAT-9921', 'LOT-2026-SAL-082',
        'SUP-001', 'Nordic Fjords Salmon AS', 'PO-2026-1041', 'PO-2026-1041', date('now', '+5 days'), date('now', '-2 days'),
        'Norway', 100.0, 'case', 'received', 100.0, 0.0, 0.0
      )
    `).run();

    db.prepare(`
      INSERT OR IGNORE INTO bin_stock_placements (
        id, bin_id, bin_code, warehouse, zone_code, internal_lot, supplier_batch,
        sku, product_name, category, quantity_cases, uom, weight_kg, expiry_date,
        quality_status, placed_by, placed_at
      ) VALUES (
        'BSP-2026-SAL-082', 'BIN-MIL-01', 'CHILL-A1-01', 'Milan Cold Hub', 'Z-MIL-SEAFOOD', 'LOT-2026-SAL-082', 'SUP-BAT-9921',
        'SKU-SAL-001', 'Salmone Norvegese Fresco Superiore', 'Seafood', 40.0, 'case', 200.0, date('now', '+5 days'),
        'quarantine', 'elena.conti@ascentra.it', datetime('now', '-2 days')
      )
    `).run();

    // Ensure order SO-2026-9842 and delivery DEL-501 exist for Hotel Principe di Savoia (50 delivered cases)
    db.prepare(`
      INSERT OR IGNORE INTO sales_orders (
        id, order_number, customer_id, customer, segment, channel, status,
        items_count, cases_total, total_cents, margin_pct, delivery_date, warehouse,
        created_at
      ) VALUES (
        'SO-2026-9842', 'SO-2026-9842', 'CUST-B2B-02', 'Hotel Principe di Savoia', 'luxury_hospitality', 'b2b_direct', 'delivered',
        1, 50, 445000, 26.0, date('now', '-1 day'), 'Milan Cold Hub', datetime('now')
      )
    `).run();

    db.prepare(`
      INSERT OR IGNORE INTO sales_order_lines (
        id, order_id, sku, product_name, cases_ordered, cases_allocated,
        unit_price_cents, vat_rate_pct, line_total_cents, invoiced_cases
      ) VALUES (
        'SOL-9842-01', 'SO-2026-9842', 'SKU-SAL-001', 'Salmone Norvegese Fresco Superiore', 50, 50, 8900, 10.0, 445000, 50
      )
    `).run();

    db.prepare(`
      INSERT OR IGNORE INTO deliveries (
        id, delivery_reference, order_id, order_number, customer_id, customer,
        delivery_address, warehouse, route_code, driver_id, driver,
        vehicle_id, vehicle, eta, temp_c, status, pod_signed, stops_completed,
        stops_total, priority, total_cases, invoiced_cases
      ) VALUES (
        'DEL-2026-0302', 'DEL-2026-0302', 'SO-2026-9842', 'SO-2026-9842', 'CUST-B2B-02', 'Hotel Principe di Savoia',
        'Piazza della Repubblica 17, 20124 Milano MI', 'Milan Cold Hub', 'RT-MIL-N1', 'DRV-001', 'Davide Galli',
        'VEH-001', 'MI-784-KR', '10:30', 2.0, 'delivered', 1, 1, 1, 'high', 50, 50
      )
    `).run();

    db.prepare(`
      INSERT OR IGNORE INTO delivery_manifest_items (
        id, manifest_number, delivery_id, order_id, order_number, order_line_id,
        sku, product_name, lot_batch, cases, weight_kg, uom, temp_zone, compartment,
        loading_sequence, is_scanned_loaded, invoiced_cases
      ) VALUES (
        'DMI-0302-1', 'MAN-0302', 'DEL-2026-0302', 'SO-2026-9842', 'SO-2026-9842', 'SOL-9842-01',
        'SKU-SAL-001', 'Salmone Norvegese Fresco Superiore', 'LOT-2026-SAL-082', 50, 250.0, 'case', 'chilled', 'chilled', 1, 1, 50
      )
    `).run();
  } catch (e) {
    console.error("SEED STEP 0 ERROR:", e);
  }

  // 1. Seed Quality Exceptions
  try {
    const expCount = (db.prepare("SELECT COUNT(*) as c FROM quality_exceptions").get() as { c: number } | undefined)?.c ?? 0;
    if (expCount === 0) {
      db.prepare(`
        INSERT OR IGNORE INTO quality_exceptions (
          id, exception_number, inspection_id, shipment_id, shipment_reference,
          supplier_id, supplier_name, sku, product_name, internal_lot,
          warehouse, location, exception_type, severity, expected_limits,
          actual_reading, food_safety_impact, responsible_person, evidence_json,
          investigation_notes, containment_actions, resolution, status, detected_at, created_at
        ) VALUES
        (
          'EXP-2026-001', 'EXP-2026-001', 'INSP-2026-1041', 'SHP-2026-1041', 'SHP-2026-1041',
          'SUP-001', 'Nordic Fjords Salmon AS', 'SKU-SAL-001', 'Salmone Norvegese Fresco Superiore', 'LOT-2026-SAL-082',
          'Milan Cold Hub', 'RCV-STAGE-01', 'temperature_excursion', 'critical', '0°C to 4°C',
          '+6.8°C core probe at trailer rear door', 'Potential microbial acceleration, cold chain breach during airport transshipment.',
          'Giulia Romano', '["https://storage.ascentra.it/evidence/temp_logger_shp1041.pdf"]',
          'Reefer data logger indicates unit stopped during airport cargo loading for 45 minutes.',
          'Quarantined all 40 unallocated cases in warehouse vault. Initiated supplier inquiry.',
          'Under investigation with Nordic Fjords logistics QA team.',
          'open', datetime('now', '-2 days'), datetime('now', '-2 days')
        ),
        (
          'EXP-2026-002', 'EXP-2026-002', 'INSP-2026-1033', 'SHP-2026-1033', 'SHP-2026-1033',
          'SUP-004', 'Caseificio Del Sole S.r.l.', 'SKU-BUR-004', 'Artisanal Burrata di Andria IGP', 'LOT-2026-BUR-019',
          'Milan Cold Hub', 'CHILL-B1-01', 'packaging_defect', 'medium', 'Intact hermetic heat seal',
          'Micro-leakage on outer protective film in 3 cases', 'Secondary fluid leakage, reduced shelf life for affected packs.',
          'Marco Bellini', '["https://storage.ascentra.it/evidence/burrata_seal_flaw.jpg"]',
          'Packaging sealing bar temperature fluctuation at supplier facility.',
          'Damaged units isolated and destroyed. Remaining 67 cases inspected 100% and released.',
          'Supplier adjusted sealing bar calibrator. Credit note requested.',
          'resolved', datetime('now', '-3 days'), datetime('now', '-3 days')
        )
      `).run();
    }
  } catch (e) {
    console.error("SEED EXCEPTION ERROR:", e);
  }

  // 2. Seed Quality CAPAs
  try {
    const capaCount = (db.prepare("SELECT COUNT(*) as c FROM quality_capas").get() as { c: number } | undefined)?.c ?? 0;
    if (capaCount === 0) {
      db.prepare(`
        INSERT OR IGNORE INTO quality_capas (
          id, capa_number, exception_id, supplier_id, supplier_name, sku,
          product_name, internal_lot, warehouse, problem_description, root_cause,
          containment_action, corrective_action, preventive_action, assigned_to_id,
          assigned_to_name, target_completion_date, status, recall_id, created_by
        ) VALUES (
          'CAPA-2026-001', 'CAPA-2026-001', 'EXP-2026-001', 'SUP-001', 'Nordic Fjords Salmon AS',
          'SKU-SAL-001', 'Salmone Norvegese Fresco Superiore', 'LOT-2026-SAL-082', 'Milan Cold Hub',
          'Cold chain temperature breach and positive environmental Listeria swab from supplier packaging hall.',
          'Tarmac delay at Malpensa air cargo combined with evaporator maintenance lapse on supplier facility.',
          'Immediate recall RCL-2026-001 initiated, all warehouse lots quarantined, customer return logistics dispatched.',
          'Supplier performed full chemical sanitation and UV eradication on line 3; carrier replaced reefer unit battery backup.',
          'Mandate continuous Bluetooth real-time data loggers on all Nordic air shipments with automated dispatch halt.',
          'USR-QA', 'Giulia Romano', date('now', '+14 days'), 'In Progress', 'RCL-2026-001', 'Giulia Romano'
        )
      `).run();
    }
  } catch (e) {
    console.error("SEED CAPA ERROR:", e);
  }

  // 3. Seed Active Class 1 Recall for Listeria Monocytogenes on Norwegian Salmon LOT-2026-SAL-082
  try {
    const recallCount = (db.prepare("SELECT COUNT(*) as c FROM recalls").get() as { c: number } | undefined)?.c ?? 0;
    if (recallCount === 0) {
      db.prepare(`
        INSERT OR IGNORE INTO recalls (
          id, recall_number, title, classification, status, reason_category,
          risk_assessment, affected_sku, product_name, affected_lot, supplier_batch,
          supplier_id, supplier_name, warehouse, total_affected_cases, total_affected_weight_kg,
          recovered_cases, recovered_weight_kg, disposed_cases, disposed_weight_kg,
          initiated_by_id, initiated_by_name, initiated_by_role, initiated_at,
          approved_by_id, approved_by_name, approved_by_role, approved_at,
          target_recovery_date, capa_id, regulatory_agency_notified, regulatory_agency_name,
          regulatory_reference, public_alert_issued
        ) VALUES (
          'RCL-2026-001', 'RCL-2026-001', 'Precautionary Recall: Potential Listeria Monocytogenes in Fresh Norwegian Salmon Fillets',
          'class_1', 'recovery_in_progress', 'microbiological_contamination',
          'Supplier notified positive environmental Listeria swab at processing line 3. High risk for immunocompromised consumers. Complete withdrawal mandated by EU General Food Law Reg 178/2002.',
          'SKU-SAL-001', 'Salmone Norvegese Fresco Superiore', 'LOT-2026-SAL-082', 'SUP-BAT-9921',
          'SUP-001', 'Nordic Fjords Salmon AS', 'Milan Cold Hub', 100.0, 1000.0,
          25.0, 250.0, 0.0, 0.0,
          'USR-QA', 'Giulia Romano', 'qa', datetime('now', '-2 days'),
          'USR-ADMIN', 'Elena Conti', 'super_admin', datetime('now', '-2 days'),
          date('now', '+3 days'), 'CAPA-2026-001', 1, 'Ministero della Salute (DGISAN)',
          'RASFF-2026-IT-9012', 0
        )
      `).run();

      // Seed Affected Customers for this recall
      const insertAffCust = db.prepare(`
        INSERT OR IGNORE INTO recall_affected_customers (
          id, recall_id, customer_id, customer_name, customer_contact, customer_email, customer_phone,
          order_id, order_number, delivery_id, delivery_reference, invoice_id, invoice_number,
          delivered_date, delivered_cases, delivered_weight_kg, notification_status,
          notified_at, acknowledged_at, recovered_cases, recovered_weight_kg,
          disposed_by_customer_cases, remaining_unrecovered_cases, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertAffCust.run(
        "RAC-01", "RCL-2026-001", "CUST-001", "Ristorante Cracco Galleria", "Carlo Cracco", "carlo@ristorantecracco.it", "+39 02 8767 881",
        "SO-2026-9841", "SO-2026-9841", "DEL-2026-0301", "DEL-2026-0301", "INV-2026-8412", "INV-2026-8412",
        relativeDate(-1), 10.0, 12.5, "acknowledged",
        relativeDate(-2), relativeDate(-1), 10.0, 12.5,
        0.0, 0.0, "All 10 cases sealed in walk-in cold room and recovered by dedicated Ascentra courier."
      );

      insertAffCust.run(
        "RAC-02", "RCL-2026-001", "CUST-B2B-02", "Hotel Principe di Savoia", "Chef Matteo", "fnb@hotelprincipedisavoia.it", "+39 02 6230 1",
        "SO-2026-9842", "SO-2026-9842", "DEL-2026-0302", "DEL-2026-0302", "INV-2026-8413", "INV-2026-8413",
        relativeDate(-1), 50.0, 480.0, "sent",
        relativeDate(-2), null, 15.0, 150.0,
        0.0, 35.0, "15 cases collected. Awaiting pickup for remaining 35 cases in refrigerated quarantine."
      );

      // Seed Recovery Logs
      const insertRecLog = db.prepare(`
        INSERT OR IGNORE INTO recall_recovery_logs (
          id, recall_id, affected_customer_id, customer_id, customer_name, order_number,
          lot_id, recovered_cases, recovered_weight_kg, action_type, receipt_warehouse,
          quarantine_bin_code, seal_number, carrier, vehicle_reg, condition_on_receipt,
          temp_c, received_by_id, received_by_name, received_at, verified_by_qa_id, verified_by_qa_name, verified_at, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertRecLog.run(
        "RRL-01", "RCL-2026-001", "RAC-01", "CUST-001", "Ristorante Cracco Galleria", "SO-2026-9841",
        "LOT-2026-SAL-082", 10.0, 12.5, "returned_to_warehouse", "Milan Cold Hub",
        "QUAR-ZONE-01", "SEAL-QA-8821", "Ascentra Cold Fleet", "MI-784-KR", "Intact original styrofoam cases with ice packs",
        1.8, "USR-WH-MGR", "Marco Bellini", relativeDate(-1), "USR-QA", "Giulia Romano", relativeDate(-1), "Full return verified, transferred to secure QA cage"
      );

      insertRecLog.run(
        "RRL-02", "RCL-2026-001", "RAC-02", "CUST-B2B-02", "Hotel Principe di Savoia", "SO-2026-9842",
        "LOT-2026-SAL-082", 15.0, 150.0, "returned_to_warehouse", "Milan Cold Hub",
        "QUAR-ZONE-01", "SEAL-QA-8822", "Ascentra Cold Fleet", "MI-784-KR", "Original unbroken cartons",
        2.1, "USR-WH-MGR", "Marco Bellini", relativeDate(-1), "USR-QA", "Giulia Romano", relativeDate(-1), "Partial recovery batch 1"
      );

      // Seed Quarantine Action for this recall
      db.prepare(`
        INSERT OR IGNORE INTO quarantine_actions (
          id, action_number, lot_id, sku, product_name, warehouse, action_type,
          previous_quality_status, new_quality_status, quarantined_cases, quarantined_weight_kg,
          zone_code, bin_code, quarantine_bin_code, reason, authorized_by_id,
          authorized_by_name, authorized_by_role, recall_id, action_timestamp
        ) VALUES (
          'QACT-2026-001', 'QACT-2026-001', 'LOT-2026-SAL-082', 'SKU-SAL-001', 'Salmone Norvegese Fresco Superiore',
          'Milan Cold Hub', 'quarantine_hold', 'released', 'quarantine', 40.0, 400.0,
          'Z-MIL-SEAFOOD', 'CHILL-A1-01', 'QUAR-ZONE-01', 'Precautionary quality hold due to Class 1 recall RCL-2026-001',
          'USR-QA', 'Giulia Romano', 'qa', 'RCL-2026-001', datetime('now', '-2 days')
        )
      `).run();

      // Ensure inventory_lots reflects quarantine status
      db.prepare(`
        UPDATE inventory_lots
        SET quality_status = 'quarantine', quarantined_cases = quantity_cases
        WHERE id = 'LOT-2026-SAL-082' OR batch_id = 'LOT-2026-SAL-082'
      `).run();
    }
  } catch (e) {
    console.error("SEED RECALL ERROR:", e);
  }
}

export function seedManagementAndAiModule(db: SqliteDatabaseSync): void {
  // 1. Seed Operational Anomalies
  try {
    const anmCount = (db.prepare("SELECT COUNT(*) as c FROM operational_anomalies").get() as { c: number } | undefined)?.c ?? 0;
    if (anmCount === 0) {
      const insertAnomaly = db.prepare(`
        INSERT OR IGNORE INTO operational_anomalies (
          id, anomaly_number, anomaly_type, severity, category, title, explanation,
          supporting_data_json, related_entity_type, related_entity_id, suggested_investigation,
          review_status, fingerprint, reviewed_by, reviewed_at, review_notes, detected_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertAnomaly.run(
        "ANM-2026-001", "ANM-2026-001", "sudden_stock_discrepancy", "critical", "inventory",
        "Cold Chain Spoilage & Precautionary Lot Isolation",
        "Lot LOT-2026-SAL-082 subject to Class 1 recall RCL-2026-001. Mass balance variance under active reverse logistics.",
        JSON.stringify({ lot_id: "LOT-2026-SAL-082", sku: "SKU-SAL-001", recalled_cases: 100, recovered_cases: 25, quarantine_bin: "QUAR-ZONE-01" }),
        "inventory_lots", "LOT-2026-SAL-082",
        "Reconcile remaining 35 cases at Hotel Principe di Savoia cold room; audit carrier cargo temperature loggers.",
        "under_review", "ANM-LOT-2026-SAL-082-RECALL", "Giulia Romano", relativeDate(-1), "Quarantine cage verified; reverse logistics collection scheduled.", relativeDate(-2)
      );

      insertAnomaly.run(
        "ANM-2026-002", "ANM-2026-002", "repeated_temperature_excursions", "warning", "operations",
        "Reefer Trailer Temperature Spike on Delivery Route RT-MIL-N1",
        "Vehicle MI-784-KR recorded +2.8°C spike during stop 2 door opening, exceeding target max +2.0°C for 22 minutes.",
        JSON.stringify({ vehicle_id: "VEH-001", route: "RT-MIL-N1", peak_temp_c: 4.8, target_max_c: 2.0, duration_minutes: 22 }),
        "deliveries", "DEL-2026-0301",
        "Inspect thermal air curtain on rear roller shutter; review driver multi-drop dwell times.",
        "acknowledged", "ANM-VEH-001-RT-MIL-N1-TEMP", "Marco Bellini", relativeDate(0), "Thermal seals inspected and recalibrated.", relativeDate(-1)
      );

      insertAnomaly.run(
        "ANM-2026-003", "ANM-2026-003", "unexpected_purchase_price_change", "warning", "procurement",
        "Supplier Unit Cost Spike: Artisanal Burrata di Andria",
        "Quotation unit cost rose from €22.50 to €25.80 (+14.7%) without advance tariff renegotiation notice.",
        JSON.stringify({ supplier_id: "SUP-004", sku: "SKU-BUR-004", previous_unit_cost_cents: 2250, quoted_unit_cost_cents: 2580, variance_pct: 14.7 }),
        "purchase_orders", "PO-2026-1041",
        "Verify seasonal milk yield surcharges with Caseificio Del Sole; evaluate backup creamery quotations.",
        "detected", "ANM-SUP-004-SKU-BUR-004-PRICE", null, null, null, relativeDate(0)
      );

      insertAnomaly.run(
        "ANM-2026-004", "ANM-2026-004", "unexpected_margin_drop", "warning", "finance",
        "Compressed Net Margin on San Marzano DOP Bulk Replenishment",
        "Contract volume discount tier applied alongside freight surcharge resulted in delivered margin of 8.4% (target min 18.0%).",
        JSON.stringify({ customer_id: "STR-MIL-01", sku: "SKU-TMA-012", actual_margin_pct: 8.4, target_margin_pct: 18.0, net_revenue_cents: 71250, cogs_cents: 65250 }),
        "sales_orders", "SO-2026-9841",
        "Review tiered contract pricing formula in CTR-2026-BRERA to index freight surcharges on pallet volumes.",
        "detected", "ANM-STR-MIL-01-SKU-TMA-MARGIN", null, null, null, relativeDate(0)
      );
    }
  } catch (e) {
    console.error("SEED ANOMALIES ERROR:", e);
  }

  // 2. Seed Governed AI Action Logs
  try {
    const aiCount = (db.prepare("SELECT COUNT(*) as c FROM ai_action_logs").get() as { c: number } | undefined)?.c ?? 0;
    if (aiCount === 0) {
      const insertAiAction = db.prepare(`
        INSERT OR IGNORE INTO ai_action_logs (
          id, action_reference, provider, model, action_type, risk_level, target_entity_type,
          target_entity_id, recommendation_text, proposed_payload_json, validation_status,
          validation_notes, approval_status, requested_by_id, requested_by_name,
          approved_by_id, approved_by_name, approved_at, rejection_reason,
          execution_status, execution_result_json, executed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertAiAction.run(
        "AIA-2026-001", "AIA-2026-001", "ascentra_rule_governor", "model_governor_v1",
        "create_replenishment_po", "medium", "purchase_orders", "SKU-PRM-001",
        "Parmigiano Reggiano DOP 24 Mesi projected stockout in 6 days. Recommended PO for 30 cases from Consorzio Parmigiano Reggiano.",
        JSON.stringify({
          sku: "SKU-PRM-001",
          supplier_id: "SUP-002",
          supplier_name: "Consorzio Parmigiano Reggiano DOP",
          ordered_cases: 30,
          unit_cost_cents: 2200,
          destination_warehouse: "Milan Cold Hub"
        }),
        "valid", "Pre-validated against supplier DAP contract terms and warehouse space availability.",
        "proposed", "AI-ADVISOR", "Ascentra Demand Governor",
        null, null, null, null,
        "pending", null, null, relativeDate(0)
      );

      insertAiAction.run(
        "AIA-2026-002", "AIA-2026-002", "ascentra_rule_governor", "model_governor_v1",
        "quarantine_risk_lot", "high", "inventory_lots", "LOT-2026-BUR-019",
        "Repeated micro-leakage defects reported on Burrata outer film. Quarantine remaining 40 unallocated cases for secondary seal inspection.",
        JSON.stringify({
          lot_id: "LOT-2026-BUR-019",
          warehouse: "Milan Cold Hub",
          quarantine_bin_code: "QUAR-ZONE-01",
          reason: "Automated quality hold triggered by recurring packaging seal micro-leakage defect"
        }),
        "valid", "Lot currently in CHILL-B1-01 with 40 cases unallocated.",
        "proposed", "AI-ADVISOR", "Ascentra Quality Sentry",
        null, null, null, null,
        "pending", null, null, relativeDate(0)
      );

      insertAiAction.run(
        "AIA-2026-003", "AIA-2026-003", "ascentra_rule_governor", "model_governor_v1",
        "adjust_safety_stock", "low", "products", "SKU-SAL-001",
        "Increase minimum safety stock buffer for Norwegian Salmon from 15 to 25 cases due to airport cargo customs clearance volatility.",
        JSON.stringify({
          sku: "SKU-SAL-001",
          previous_safety_stock: 15,
          new_safety_stock: 25,
          lead_time_buffer_days: 2
        }),
        "valid", "Validated against lead time volatility metrics.",
        "approved", "AI-ADVISOR", "Ascentra Inventory Optimizer",
        "USR-ADMIN", "Elena Conti", relativeDate(-1), null,
        "executed", JSON.stringify({ status: "success", sku: "SKU-SAL-001", updated_safety_stock: 25 }),
        relativeDate(-1), relativeDate(-2)
      );
    }
  } catch (e) {
    console.error("SEED AI ACTIONS ERROR:", e);
  }
}




export function seedStoreMonitoringModule(db: SqliteDatabaseSync): void {
  // 1. Enrich Store Accounts (STR-MIL-01 .. STR-ROM-05) with franchise groups, regions, contacts, and contracts
  try {
    const updateStore = db.prepare(`
      UPDATE customers
      SET store_code = ?,
          parent_franchise_group = ?,
          region = ?,
          contact_name = ?,
          contact_email = ?,
          contact_phone = ?,
          delivery_address = COALESCE(NULLIF(delivery_address, ''), ?),
          assigned_distributor = ?,
          assigned_contract_id = ?,
          approved_by = 'Elena Conti',
          approved_at = datetime('now', '-90 days')
      WHERE id = ?
    `);

    updateStore.run(
      "STR-MIL-01",
      "Gruppo Gastronomico Lombardo",
      "Lombardy",
      "Chiara Moretti",
      "chiara.moretti@store-navigli.it",
      "+39 02 7601 4410",
      "Via Fiori Chiari 14, 20121 Milano MI",
      "Ascentra Global Ltd - Milan Cold Hub",
      "CTR-2026-BRERA",
      "STR-MIL-01"
    );

    updateStore.run(
      "STR-MIL-02",
      "Gruppo Gastronomico Lombardo",
      "Lombardy",
      "Alessandro Riva",
      "alessandro.riva@botteganavigli.it",
      "+39 02 8940 2219",
      "Alzaia Naviglio Grande 38, 20144 Milano MI",
      "Ascentra Global Ltd - Milan Cold Hub",
      "CTR-2026-BRERA",
      "STR-MIL-02"
    );

    updateStore.run(
      "STR-TUR-03",
      "Piemonte Bistro Holdings",
      "Piedmont",
      "Valeria Conti",
      "valeria.conti@enotecatorino.it",
      "+39 011 548 9021",
      "Via Roma 45, 10121 Torino TO",
      "Ascentra Global Ltd - Milan Cold Hub",
      null,
      "STR-TUR-03"
    );

    updateStore.run(
      "STR-BOL-04",
      "Emilia Food Network",
      "Emilia-Romagna",
      "Federico Neri",
      "federico.neri@mercatosanpetronio.it",
      "+39 051 239 8810",
      "Piazza Maggiore 6, 40124 Bologna BO",
      "Ascentra Global Ltd - Bologna Freezer DC",
      null,
      "STR-BOL-04"
    );

    updateStore.run(
      "STR-ROM-05",
      "Roma Capitale Food Group",
      "Lazio",
      "Martina De Luca",
      "martina.deluca@dispensatrastevere.it",
      "+39 06 581 7740",
      "Vicolo del Cinque 18, 00153 Roma RM",
      "Ascentra Global Ltd - Rome Cold Hub",
      null,
      "STR-ROM-05"
    );
  } catch (e) {
    console.error("SEED STORE ACCOUNTS ERROR:", e);
  }

  // 2. Seed Store Users (Store Owner, Store Manager, Store Staff)
  try {
    const defaultPassHash = hashPassword("Ascentra!2026");
    db.prepare(`
      UPDATE users
      SET store_sub_role = 'store_owner',
          store_permissions_json = '["dashboard.read","purchases.read","orders.read","orders.manage","products.read","spending.read","consumption.read","inventory.read","invoices.read","users.manage","export.read"]'
      WHERE id = 'USR-STR'
    `).run();

    const insertStoreUser = db.prepare(`
      INSERT OR IGNORE INTO users (
        id, email, name, password_hash, role, store_id, store_sub_role, store_permissions_json, warehouse, invited_by, invited_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Milan Cold Hub', 'Elena Conti', datetime('now', '-30 days'))
    `);
    const seedStoreUser = (
      id: string,
      email: string,
      name: string,
      password_hash: string,
      role: string,
      store_id: string,
      store_sub_role: string,
      permissionsJson: string
    ) => {
      if (wasUserDeleted(db, id, email)) return;
      insertStoreUser.run(id, email, name, password_hash, role, store_id, store_sub_role, permissionsJson);
    };

    seedStoreUser(
      "USR-STR-MGR-01",
      "luca.ferrari@gourmetbrera.it",
      "Luca Ferrari",
      defaultPassHash,
      "store_manager",
      "STR-MIL-01",
      "store_manager",
      JSON.stringify(["dashboard.read", "purchases.read", "orders.read", "orders.manage", "products.read", "spending.read", "consumption.read", "inventory.read", "invoices.read", "export.read"])
    );

    seedStoreUser(
      "USR-STR-STF-01",
      "sara.bianchi@gourmetbrera.it",
      "Sara Bianchi",
      defaultPassHash,
      "store_staff",
      "STR-MIL-01",
      "store_staff",
      JSON.stringify(["dashboard.read", "purchases.read", "orders.read", "products.read", "consumption.read"])
    );

    seedStoreUser(
      "USR-STR-OWN-02",
      "alessandro.riva@botteganavigli.it",
      "Alessandro Riva",
      defaultPassHash,
      "store_owner",
      "STR-MIL-02",
      "store_owner",
      JSON.stringify(["dashboard.read", "purchases.read", "orders.read", "orders.manage", "products.read", "spending.read", "consumption.read", "inventory.read", "invoices.read", "users.manage", "export.read"])
    );

    seedStoreUser(
      "USR-STR-OWN-03",
      "valeria.conti@enotecatorino.it",
      "Valeria Conti",
      defaultPassHash,
      "store_owner",
      "STR-TUR-03",
      "store_owner",
      JSON.stringify(["dashboard.read", "purchases.read", "orders.read", "orders.manage", "products.read", "spending.read", "consumption.read", "inventory.read", "invoices.read", "users.manage", "export.read"])
    );
  } catch (e) {
    console.error("SEED STORE USERS ERROR:", e);
  }

  // 3. Seed Historical Store Orders, Lines, Deliveries & Invoices for rich Store & Consolidated Analytics
  try {
    const insertOrder = db.prepare(`
      INSERT OR IGNORE INTO sales_orders (
        id, order_number, customer_id, customer, segment, channel, status,
        credit_hold, items_count, cases_total, subtotal_cents, tax_cents, total_cents,
        margin_pct, delivery_date, warehouse, fefo_allocated, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);

    const insertLine = db.prepare(`
      INSERT OR IGNORE INTO sales_order_lines (
        id, order_id, sku, product_name, cases_ordered, cases_allocated,
        unit_price_cents, batch_id, weight_kg, vat_rate_pct, line_total_cents, invoiced_cases
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertDeliv = db.prepare(`
      INSERT OR IGNORE INTO deliveries (
        id, delivery_reference, order_id, order_number, customer_id, customer,
        delivery_address, warehouse, delivery_date, route_code, driver, vehicle,
        eta, temp_c, status, pod_signed, stops_completed, stops_total, total_cases, total_weight_kg
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Davide Galli', 'MI-892-FR', '08:00', 2.1, ?, ?, 1, 1, ?, ?)
    `);

    const insertInv = db.prepare(`
      INSERT OR IGNORE INTO invoices (
        id, invoice_number, order_id, order_number, customer_id, customer,
        issued_date, due_date, subtotal_cents, tax_cents, amount_cents, paid_cents,
        status, sdi_status, sdi_reference, payment_terms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, 'Net 30')
    `);

    // STR-MIL-01 Delivered Order (12 days ago)
    insertOrder.run(
      "SO-2026-9810", "SO-2026-9810", "STR-MIL-01", "Gourmet Market Brera", "Flagship Retail", "b2b_portal", "delivered",
      3, 46, 265000, 15400, 280400, 28.4, relativeDate(-12), "Milan Cold Hub", `${relativeDate(-13)} 09:15:00`
    );
    insertLine.run("SOL-9810-1", "SO-2026-9810", "SKU-SAL-001", "Norwegian Atlantic Salmon Fillet (Trim D)", 16, 16, 9450, "LOT-2026-SAL-041", 80.0, 4.0, 151200, 16);
    insertLine.run("SOL-9810-2", "SO-2026-9810", "SKU-BUR-004", "Artisanal Burrata di Andria IGP (12x125g)", 20, 20, 2890, "LOT-2026-BUR-019", 30.0, 4.0, 57800, 20);
    insertLine.run("SOL-9810-3", "SO-2026-9810", "SKU-RVL-033", "Fresh Truffle & Ricotta Girasoli Pasta", 10, 10, 3800, "LOT-2026-BUR-019", 40.0, 4.0, 38000, 10);
    insertDeliv.run(
      "DEL-9810", "DEL-9810", "SO-2026-9810", "SO-2026-9810", "STR-MIL-01", "Gourmet Market Brera",
      "Via Fiori Chiari 14, 20121 Milano MI", "Milan Cold Hub", relativeDate(-12), "RT-MIL-N1", "delivered", 1, 46, 150.0
    );
    insertInv.run(
      "INV-2026-8401", "INV-2026-8401", "SO-2026-9810", "SO-2026-9810", "STR-MIL-01", "Gourmet Market Brera",
      relativeDate(-12), relativeDate(18), 265000, 15400, 280400, 280400, "paid", "SDI-IT-990101"
    );

    // STR-MIL-01 Previous Month Delivered Order (38 days ago for monthly trend comparison)
    insertOrder.run(
      "SO-2026-9750", "SO-2026-9750", "STR-MIL-01", "Gourmet Market Brera", "Flagship Retail", "b2b_portal", "delivered",
      2, 34, 210000, 12000, 222000, 27.5, relativeDate(-38), "Milan Cold Hub", `${relativeDate(-39)} 10:00:00`
    );
    insertLine.run("SOL-9750-1", "SO-2026-9750", "SKU-SAL-001", "Norwegian Atlantic Salmon Fillet (Trim D)", 14, 14, 9200, "LOT-2026-SAL-041", 70.0, 4.0, 128800, 14);
    insertLine.run("SOL-9750-2", "SO-2026-9750", "SKU-TMA-012", "San Marzano DOP Pelati Tomatoes (6x2.5kg)", 20, 20, 3100, "LOT-2026-SPN-008", 300.0, 4.0, 62000, 20);
    insertDeliv.run(
      "DEL-9750", "DEL-9750", "SO-2026-9750", "SO-2026-9750", "STR-MIL-01", "Gourmet Market Brera",
      "Via Fiori Chiari 14, 20121 Milano MI", "Milan Cold Hub", relativeDate(-38), "RT-MIL-N1", "delivered", 1, 34, 370.0
    );
    insertInv.run(
      "INV-2026-8350", "INV-2026-8350", "SO-2026-9750", "SO-2026-9750", "STR-MIL-01", "Gourmet Market Brera",
      relativeDate(-38), relativeDate(-8), 210000, 12000, 222000, 222000, "paid", "SDI-IT-980150"
    );

    // STR-MIL-01 Open Invoice on SO-2026-9842
    insertInv.run(
      "INV-2026-8415", "INV-2026-8415", "SO-2026-9842", "SO-2026-9842", "STR-MIL-01", "Gourmet Market Brera",
      relativeDate(0), relativeDate(30), 695000, 47000, 742000, 200000, "part_paid", "SDI-IT-993012"
    );

    // STR-MIL-01 Confirmed Order Pending Delivery
    insertOrder.run(
      "SO-2026-8503", "SO-2026-8503", "STR-MIL-01", "Gourmet Market Brera", "Flagship Retail", "b2b_portal", "confirmed",
      1, 15, 141750, 5670, 147420, 28.0, relativeDate(2), "Milan Cold Hub", `${relativeDate(0)} 14:00:00`
    );
    insertLine.run("SOL-8503-1", "SO-2026-8503", "SKU-SAL-001", "Norwegian Atlantic Salmon Fillet (Trim D)", 15, 15, 9450, "LOT-2026-SAL-041", 75.0, 4.0, 141750, 0);

    // STR-MIL-02 Partial Delivery Order (20 cases ordered, 16 cases delivered)
    insertOrder.run(
      "SO-2026-8504", "SO-2026-8504", "STR-MIL-02", "Bottega Alimentare Navigli", "Urban Bistro & Store", "b2b_portal", "delivered",
      1, 20, 76000, 3040, 79040, 27.0, relativeDate(-3), "Milan Cold Hub", `${relativeDate(-4)} 10:00:00`
    );
    insertLine.run("SOL-8504-1", "SO-2026-8504", "SKU-RVL-033", "Fresh Truffle & Ricotta Girasoli Pasta", 20, 16, 3800, "LOT-2026-BUR-019", 64.0, 4.0, 60800, 16);
    insertDeliv.run(
      "DEL-8504", "DEL-8504", "SO-2026-8504", "SO-2026-8504", "STR-MIL-02", "Bottega Alimentare Navigli",
      "Alzaia Naviglio Grande 38, 20144 Milano MI", "Milan Cold Hub", relativeDate(-3), "RT-MIL-S3", "delivered", 1, 16, 64.0
    );

    // STR-MIL-02 Delivered Order & Lines

    insertOrder.run(
      "SO-2026-9815", "SO-2026-9815", "STR-MIL-02", "Bottega Alimentare Navigli", "Urban Bistro & Store", "b2b_portal", "delivered",
      2, 28, 195000, 11800, 206800, 28.1, relativeDate(-8), "Milan Cold Hub", `${relativeDate(-9)} 11:20:00`
    );
    insertLine.run("SOL-9815-1", "SO-2026-9815", "SKU-BUR-004", "Artisanal Burrata di Andria IGP (12x125g)", 18, 18, 2890, "LOT-2026-BUR-019", 27.0, 4.0, 52020, 18);
    insertLine.run("SOL-9815-2", "SO-2026-9815", "SKU-PRO-021", "Prosciutto di Parma DOP 24M Deboned", 10, 10, 15478, "LOT-2026-BFL-015", 75.0, 10.0, 154780, 10);
    insertDeliv.run(
      "DEL-9815", "DEL-9815", "SO-2026-9815", "SO-2026-9815", "STR-MIL-02", "Bottega Alimentare Navigli",
      "Alzaia Naviglio Grande 38, 20144 Milano MI", "Milan Cold Hub", relativeDate(-8), "RT-MIL-S3", "delivered", 1, 28, 102.0
    );
    insertInv.run(
      "INV-2026-8405", "INV-2026-8405", "SO-2026-9815", "SO-2026-9815", "STR-MIL-02", "Bottega Alimentare Navigli",
      relativeDate(-8), relativeDate(22), 195000, 11800, 206800, 0, "issued", "SDI-IT-991042"
    );

    // STR-BOL-04 & STR-ROM-05 Delivered Orders
    insertOrder.run(
      "SO-2026-9820", "SO-2026-9820", "STR-BOL-04", "Mercato San Petronio", "Regional Hub Store", "b2b_portal", "delivered",
      2, 35, 312000, 21000, 333000, 29.0, relativeDate(-5), "Bologna Freezer DC", `${relativeDate(-6)} 08:30:00`
    );
    insertLine.run("SOL-9820-1", "SO-2026-9820", "SKU-PRO-021", "Prosciutto di Parma DOP 24M Deboned", 15, 15, 16200, "LOT-2026-BFL-015", 112.5, 10.0, 243000, 15);
    insertLine.run("SOL-9820-2", "SO-2026-9820", "SKU-TMA-012", "San Marzano DOP Pelati Tomatoes (6x2.5kg)", 20, 20, 3450, "LOT-2026-SPN-008", 300.0, 4.0, 69000, 20);
    insertDeliv.run(
      "DEL-9820", "DEL-9820", "SO-2026-9820", "SO-2026-9820", "STR-BOL-04", "Mercato San Petronio",
      "Piazza Maggiore 6, 40124 Bologna BO", "Bologna Freezer DC", relativeDate(-5), "RT-EAST-01", "delivered", 1, 35, 412.5
    );
    insertInv.run(
      "INV-2026-8408", "INV-2026-8408", "SO-2026-9820", "SO-2026-9820", "STR-BOL-04", "Mercato San Petronio",
      relativeDate(-5), relativeDate(25), 312000, 21000, 333000, 333000, "paid", "SDI-IT-991550"
    );
  } catch (e) {
    console.error("SEED STORE ORDERS ERROR:", e);
  }

  // 4. Seed Store Account History, Consumption Configs, POS Integration, SKU Mappings, POS Transactions, Inventory Snapshots & Alerts
  try {
    const histCount = (db.prepare("SELECT COUNT(*) as c FROM store_account_history").get() as { c: number } | undefined)?.c ?? 0;
    if (histCount === 0) {
      db.prepare(`
        INSERT OR IGNORE INTO store_account_history (id, store_id, action, previous_status, new_status, notes, actor_id, actor_name, created_at)
        VALUES
        ('SAH-01', 'STR-MIL-01', 'account.created_and_approved', NULL, 'active', 'Flagship retail store onboarded under Gruppo Gastronomico Lombardo with contract CTR-2026-BRERA', 'USR-ADMIN', 'Elena Conti', datetime('now', '-90 days')),
        ('SAH-02', 'STR-MIL-02', 'account.created_and_approved', NULL, 'active', 'Navigli bistro & store onboarded under Gruppo Gastronomico Lombardo', 'USR-ADMIN', 'Elena Conti', datetime('now', '-75 days')),
        ('SAH-03', 'STR-TUR-03', 'account.watchlist_flagged', 'active', 'watch', 'Placed on watch due to overdue invoice INV-2026-8390 and high credit utilization', 'USR-FIN', 'Matteo Ricci', datetime('now', '-7 days'))
      `).run();

      // Consumption Estimation Configs
      db.prepare(`
        INSERT OR IGNORE INTO store_consumption_configs (
          id, store_id, sku, estimation_method, assumed_waste_pct, daily_baseline_cases,
          safety_buffer_cases, replenishment_threshold_cases, notes, updated_by
        ) VALUES
        ('SCC-01', 'STR-MIL-01', 'SKU-SAL-001', 'pos_recipe_mapping', 1.5, 1.2, 4.0, 8.0, 'Connected to Lightspeed POS recipe mapping (0.05 cases / 250g portion)', 'Elena Conti'),
        ('SCC-02', 'STR-MIL-01', 'SKU-BUR-004', 'pos_recipe_mapping', 1.8, 1.5, 3.0, 6.0, 'Connected to Lightspeed POS counter & bistro menu mapping', 'Elena Conti'),
        ('SCC-03', 'STR-MIL-02', 'SKU-PRO-021', 'rolling_delivery_rate', 2.2, 0.8, 2.0, 5.0, 'Estimated from 30-day rolling delivery cadence minus 2.2% trim allowance (no POS connected)', 'Elena Conti'),
        ('SCC-04', 'STR-TUR-03', 'SKU-SAL-001', 'rolling_delivery_rate', 3.8, 0.6, 2.0, 4.0, 'Estimated from historical delivery intervals; POS integration not configured', 'Elena Conti')
      `).run();

      // POS Integrations
      db.prepare(`
        INSERT OR IGNORE INTO store_pos_integrations (
          id, store_id, provider_name, external_store_ref, connection_status,
          sync_sales_enabled, sync_inventory_enabled, last_sync_at, last_sync_status, error_message, config_json
        ) VALUES
        ('SPI-01', 'STR-MIL-01', 'Lightspeed_Restaurant_POS', 'LS-IT-MIL-BRERA-01', 'active', 1, 1, datetime('now', '-2 hours'), 'success', NULL, '{"webhook_verified":true,"mode":"batch_import"}'),
        ('SPI-02', 'STR-MIL-02', 'Unconfigured', NULL, 'unconfigured', 0, 0, NULL, 'never_synced', 'No POS or store inventory feed connected. Consumption figures use delivery-rate estimation.', '{}'),
        ('SPI-03', 'STR-TUR-03', 'Toast_POS_Adapter', 'TST-TUR-03', 'error', 1, 0, datetime('now', '-4 days'), 'error', 'API token expired on Toast POS gateway — falling back to estimated consumption.', '{}')
      `).run();

      // POS SKU Mappings for STR-MIL-01
      db.prepare(`
        INSERT OR IGNORE INTO store_pos_sku_mappings (
          id, store_id, provider_name, pos_item_code, pos_item_name,
          distributor_sku, product_name, mapping_type, cases_per_pos_unit, kg_per_pos_unit, active, created_by
        ) VALUES
        ('SPM-01', 'STR-MIL-01', 'Lightspeed_Restaurant_POS', 'POS-SAL-250G', 'Filetto di Salmone Norvegese (250g Counter/Plate)', 'SKU-SAL-001', 'Norwegian Atlantic Salmon Fillet (Trim D)', 'ingredient_recipe', 0.05, 0.25, 1, 'Elena Conti'),
        ('SPM-02', 'STR-MIL-01', 'Lightspeed_Restaurant_POS', 'POS-BUR-125G', 'Burrata di Andria IGP Singola (125g)', 'SKU-BUR-004', 'Artisanal Burrata di Andria IGP (12x125g)', 'ingredient_recipe', 0.0833, 0.125, 1, 'Elena Conti'),
        ('SPM-03', 'STR-MIL-01', 'Lightspeed_Restaurant_POS', 'POS-RVL-250G', 'Girasoli Tartufo e Ricotta (250g Pack)', 'SKU-RVL-033', 'Fresh Truffle & Ricotta Girasoli Pasta', 'direct_1to1', 0.0625, 0.25, 1, 'Elena Conti')
      `).run();

      // POS Import Batch & Transactions for STR-MIL-01
      db.prepare(`
        INSERT OR IGNORE INTO store_pos_import_batches (
          id, import_ref, store_id, provider_name, import_type, period_start, period_end,
          records_submitted, records_imported, duplicates_skipped, validation_errors_count, status, imported_by
        ) VALUES (
          'PIB-2026-001', 'PIB-2026-001', 'STR-MIL-01', 'Lightspeed_Restaurant_POS', 'pos_sales',
          date('now', '-14 days'), date('now'), 3, 3, 0, 0, 'completed', 'Elena Conti'
        )
      `).run();

      db.prepare(`
        INSERT OR IGNORE INTO store_pos_transactions (
          id, store_id, import_batch_id, external_tx_id, transaction_date,
          pos_item_code, pos_item_name, distributor_sku, quantity_sold,
          derived_cases_consumed, derived_kg_consumed, consumption_type
        ) VALUES
        ('PTX-01', 'STR-MIL-01', 'PIB-2026-001', 'LS-TX-2026-901', date('now', '-5 days'), 'POS-SAL-250G', 'Filetto di Salmone Norvegese (250g Counter/Plate)', 'SKU-SAL-001', 260, 13.0, 65.0, 'pos_sales_derived'),
        ('PTX-02', 'STR-MIL-01', 'PIB-2026-001', 'LS-TX-2026-902', date('now', '-3 days'), 'POS-BUR-125G', 'Burrata di Andria IGP Singola (125g)', 'SKU-BUR-004', 204, 17.0, 25.5, 'pos_sales_derived'),
        ('PTX-03', 'STR-MIL-01', 'PIB-2026-001', 'LS-TX-2026-903', date('now', '-1 day'), 'POS-RVL-250G', 'Girasoli Tartufo e Ricotta (250g Pack)', 'SKU-RVL-033', 128, 8.0, 32.0, 'pos_sales_derived')
      `).run();

      // Store Inventory Snapshots for STR-MIL-01 (demonstrating exact formula: Opening + Received - Recorded Consumption - Waste +/- Adjustments = Expected Closing vs Actual Closing)
      db.prepare(`
        INSERT OR IGNORE INTO store_inventory_snapshots (
          id, snapshot_ref, store_id, sku, product_name, period_start, period_end,
          opening_stock_cases, deliveries_received_cases, recorded_consumption_cases,
          waste_spoilage_cases, adjustments_cases, expected_closing_cases, actual_closing_cases,
          variance_cases, reconciliation_status, source, recorded_by, notes
        ) VALUES
        (
          'SIS-2026-001', 'SIS-2026-001', 'STR-MIL-01', 'SKU-SAL-001', 'Norwegian Atlantic Salmon Fillet (Trim D)',
          date('now', '-14 days'), date('now'),
          4.0, 16.0, 13.0, 0.5, 0.0, 6.5, 6.5, 0.0, 'reconciled', 'pos_inventory_import', 'Chiara Moretti',
          'Opening (4) + Received (16) - Consumed (13) - Waste (0.5) + Adj (0) = 6.5 expected vs 6.5 physical count'
        ),
        (
          'SIS-2026-002', 'SIS-2026-002', 'STR-MIL-01', 'SKU-BUR-004', 'Artisanal Burrata di Andria IGP (12x125g)',
          date('now', '-14 days'), date('now'),
          2.0, 20.0, 17.0, 1.0, 0.0, 4.0, 3.0, -1.0, 'variance_flagged', 'store_declaration', 'Chiara Moretti',
          'Unexplained 1.0 case variance between expected closing (4.0) and physical fridge count (3.0)'
        )
      `).run();

      // Store Monitoring Alerts
      db.prepare(`
        INSERT OR IGNORE INTO store_monitoring_alerts (
          id, alert_ref, store_id, store_name, alert_type, severity, title, detail, supporting_data_json, status
        ) VALUES
        (
          'SMA-2026-001', 'SMA-2026-001', 'STR-TUR-03', 'Enoteca & Cucina Torino Centro',
          'credit_limit_warning', 'critical',
          'Credit Limit Utilization at 94.8% & Overdue Invoice INV-2026-8390',
          'Current exposure €18,950 against €20,000 credit limit. Invoice INV-2026-8390 (€2,620 balance) is 8 days overdue.',
          '{"credit_limit_cents":2000000,"exposure_cents":1895000,"utilization_pct":94.75,"overdue_invoice":"INV-2026-8390"}',
          'open'
        ),
        (
          'SMA-2026-002', 'SMA-2026-002', 'STR-MIL-02', 'Bottega Alimentare Navigli',
          'missing_pos_inventory_data', 'info',
          'POS & Store Inventory Feed Not Connected — Using Delivery-Rate Estimation',
          'Bottega Alimentare Navigli has no connected POS or store stock feed. Consumption metrics are flagged as directional estimates.',
          '{"estimation_method":"rolling_delivery_rate","confidence":"low_directional"}',
          'open'
        ),
        (
          'SMA-2026-003', 'SMA-2026-003', 'STR-MIL-01', 'Gourmet Market Brera',
          'consumption_variance', 'warning',
          'Burrata IGP Physical Stock Variance (-1.0 Case / -25.0%)',
          'Snapshot SIS-2026-002 expected 4.0 closing cases of SKU-BUR-004 but physical walk-in count recorded 3.0 cases.',
          '{"snapshot_ref":"SIS-2026-002","sku":"SKU-BUR-004","expected_cases":4.0,"actual_cases":3.0,"variance_cases":-1.0}',
          'open'
        ),
        (
          'SMA-2026-004', 'SMA-2026-004', 'STR-MIL-01', 'Gourmet Market Brera',
          'replenishment_threshold', 'warning',
          'Approaching Store Replenishment Threshold: Norwegian Salmon (6.5 Cases Remaining)',
          'Reconciled store closing stock (6.5 cases) is below configured replenishment threshold (8.0 cases). Suggested next store order: 12 cases.',
          '{"sku":"SKU-SAL-001","closing_stock_cases":6.5,"threshold_cases":8.0}',
          'open'
        )
      `).run();

      // Store Notification Preferences
      db.prepare(`
        INSERT OR IGNORE INTO store_notification_preferences (
          id, store_id, low_purchasing_threshold_pct, purchase_spike_threshold_pct,
          cancellation_count_threshold, credit_utilization_warn_pct, consumption_variance_warn_pct,
          email_enabled, in_app_enabled, updated_by
        ) VALUES
        ('SNP-01', 'STR-MIL-01', 25.0, 35.0, 2, 80.0, 15.0, 1, 1, 'Elena Conti'),
        ('SNP-02', 'STR-MIL-02', 25.0, 35.0, 2, 80.0, 15.0, 1, 1, 'Elena Conti'),
        ('SNP-03', 'STR-TUR-03', 20.0, 30.0, 2, 75.0, 10.0, 1, 1, 'Elena Conti')
      `).run();
    }
  } catch (e) {
    console.error("SEED STORE MONITORING DETAILS ERROR:", e);
  }
}
