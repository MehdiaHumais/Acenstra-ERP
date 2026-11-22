-- Module 06: Stock Intelligence (Inventory Control, FEFO, Reservations, Shelf-Life, Cycle Counting & Adjustments)

ALTER TABLE inventory_lots ADD COLUMN organization TEXT NOT NULL DEFAULT 'Ascentra Global Ltd';
ALTER TABLE inventory_lots ADD COLUMN damaged_cases INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_lots ADD COLUMN expired_cases INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_lots ADD COLUMN in_transit_cases INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_lots ADD COLUMN catch_weight_kg REAL;
ALTER TABLE inventory_lots ADD COLUMN unit_cost_cents INTEGER;

ALTER TABLE stock_movements ADD COLUMN warehouse TEXT;
ALTER TABLE stock_movements ADD COLUMN zone TEXT;
ALTER TABLE stock_movements ADD COLUMN reference_type TEXT;
ALTER TABLE stock_movements ADD COLUMN reference_id TEXT;
ALTER TABLE stock_movements ADD COLUMN weight_delta_kg REAL;
ALTER TABLE stock_movements ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_movements_idemp ON stock_movements(idempotency_key) WHERE idempotency_key IS NOT NULL;

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
