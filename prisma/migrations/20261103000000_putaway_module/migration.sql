-- Module 05: Put-away (Storage Recommendation, Bin Assignment & Stock Placement)
-- Safe additive migration preserving all existing records and tables.

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS source_location TEXT;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS destination_location TEXT;

CREATE TABLE IF NOT EXISTS warehouse_zones (
  id TEXT PRIMARY KEY,
  zone_code TEXT NOT NULL UNIQUE,
  zone_name TEXT NOT NULL,
  warehouse TEXT NOT NULL,
  storage_type TEXT NOT NULL DEFAULT 'chilled',
  temp_min_c REAL NOT NULL,
  temp_max_c REAL NOT NULL,
  allowed_categories TEXT NOT NULL DEFAULT '[]',
  segregation_rules TEXT,
  max_capacity_cases REAL NOT NULL DEFAULT 1000,
  max_weight_kg REAL NOT NULL DEFAULT 15000,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_warehouse_zones_wh ON warehouse_zones(warehouse);
CREATE INDEX IF NOT EXISTS idx_warehouse_zones_type ON warehouse_zones(storage_type);

CREATE TABLE IF NOT EXISTS warehouse_bins (
  id TEXT PRIMARY KEY,
  bin_code TEXT NOT NULL UNIQUE,
  barcode TEXT NOT NULL UNIQUE,
  zone_id TEXT NOT NULL,
  zone_code TEXT NOT NULL,
  warehouse TEXT NOT NULL,
  aisle TEXT NOT NULL DEFAULT 'A1',
  rack TEXT NOT NULL DEFAULT 'R1',
  level TEXT NOT NULL DEFAULT 'L1',
  storage_type TEXT NOT NULL DEFAULT 'chilled',
  temp_min_c REAL NOT NULL,
  temp_max_c REAL NOT NULL,
  allowed_categories TEXT NOT NULL DEFAULT '[]',
  restricted_allergens TEXT NOT NULL DEFAULT '[]',
  dedicated_category TEXT,
  allow_mixed_sku INTEGER NOT NULL DEFAULT 1,
  allow_mixed_batch INTEGER NOT NULL DEFAULT 1,
  max_capacity_cases REAL NOT NULL DEFAULT 200,
  max_weight_kg REAL NOT NULL DEFAULT 2500,
  current_occupied_cases REAL NOT NULL DEFAULT 0,
  current_occupied_weight_kg REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_warehouse_bins_wh ON warehouse_bins(warehouse, status);
CREATE INDEX IF NOT EXISTS idx_warehouse_bins_zone ON warehouse_bins(zone_code);

CREATE TABLE IF NOT EXISTS bin_stock_placements (
  id TEXT PRIMARY KEY,
  bin_id TEXT NOT NULL,
  bin_code TEXT NOT NULL,
  zone_code TEXT NOT NULL,
  warehouse TEXT NOT NULL,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  category TEXT NOT NULL,
  internal_lot TEXT NOT NULL,
  supplier_batch TEXT,
  quantity_cases REAL NOT NULL DEFAULT 0,
  weight_kg REAL NOT NULL DEFAULT 0,
  uom TEXT NOT NULL DEFAULT 'CASE',
  expiry_date TEXT NOT NULL,
  quality_status TEXT NOT NULL DEFAULT 'released',
  temp_c REAL,
  placed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(bin_code, sku, internal_lot)
);

CREATE INDEX IF NOT EXISTS idx_bin_stock_bin ON bin_stock_placements(bin_code);
CREATE INDEX IF NOT EXISTS idx_bin_stock_lot ON bin_stock_placements(internal_lot);
CREATE INDEX IF NOT EXISTS idx_bin_stock_wh ON bin_stock_placements(warehouse);

CREATE TABLE IF NOT EXISTS putaway_tasks (
  id TEXT PRIMARY KEY,
  task_number TEXT NOT NULL UNIQUE,
  shipment_id TEXT,
  shipment_reference TEXT,
  asn_reference TEXT,
  purchase_order_id TEXT,
  supplier_id TEXT,
  supplier_name TEXT,
  inspection_id TEXT,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Seafood',
  supplier_batch TEXT NOT NULL,
  internal_lot TEXT NOT NULL,
  warehouse TEXT NOT NULL,
  receiving_location TEXT NOT NULL DEFAULT 'RCV-STAGE-01',
  accepted_qty REAL NOT NULL,
  placed_qty REAL NOT NULL DEFAULT 0,
  remaining_qty REAL NOT NULL,
  uom TEXT NOT NULL DEFAULT 'CASE',
  expected_weight_kg REAL,
  actual_weight_kg REAL,
  placed_weight_kg REAL NOT NULL DEFAULT 0,
  manufacture_date TEXT,
  expiry_date TEXT NOT NULL,
  current_temp_c REAL,
  temp_status TEXT NOT NULL DEFAULT 'pass',
  recommended_zone TEXT,
  recommended_bin TEXT,
  recommendation_reason TEXT,
  override_bin TEXT,
  override_reason TEXT,
  overridden_by TEXT,
  overridden_at TEXT,
  assigned_operator_id TEXT,
  assigned_operator_name TEXT,
  priority TEXT NOT NULL DEFAULT 'Normal',
  status TEXT NOT NULL DEFAULT 'Ready for Put-away',
  blocked_reason TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_putaway_tasks_status ON putaway_tasks(status);
CREATE INDEX IF NOT EXISTS idx_putaway_tasks_wh ON putaway_tasks(warehouse);
CREATE INDEX IF NOT EXISTS idx_putaway_tasks_lot ON putaway_tasks(internal_lot);
CREATE INDEX IF NOT EXISTS idx_putaway_tasks_sku ON putaway_tasks(sku);

CREATE TABLE IF NOT EXISTS putaway_placements (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  task_number TEXT NOT NULL,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  internal_lot TEXT NOT NULL,
  supplier_batch TEXT NOT NULL,
  warehouse TEXT NOT NULL,
  source_location TEXT NOT NULL,
  destination_zone TEXT NOT NULL,
  destination_bin TEXT NOT NULL,
  expected_qty REAL NOT NULL,
  placed_qty REAL NOT NULL,
  remaining_qty_after REAL NOT NULL,
  uom TEXT NOT NULL DEFAULT 'CASE',
  packages_count INTEGER NOT NULL DEFAULT 1,
  expected_weight_kg REAL,
  actual_weight_kg REAL NOT NULL,
  weight_variance_kg REAL NOT NULL DEFAULT 0,
  weight_variance_pct REAL NOT NULL DEFAULT 0,
  temp_at_putaway_c REAL,
  temp_status TEXT NOT NULL DEFAULT 'pass',
  scan_verified_task INTEGER NOT NULL DEFAULT 0,
  scan_verified_sku INTEGER NOT NULL DEFAULT 0,
  scan_verified_lot INTEGER NOT NULL DEFAULT 0,
  scan_verified_bin INTEGER NOT NULL DEFAULT 0,
  manual_entry_fallback INTEGER NOT NULL DEFAULT 0,
  is_override INTEGER NOT NULL DEFAULT 0,
  override_reason TEXT,
  notes TEXT,
  operator_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  placed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_putaway_placements_task ON putaway_placements(task_id);
CREATE INDEX IF NOT EXISTS idx_putaway_placements_lot ON putaway_placements(internal_lot);
CREATE INDEX IF NOT EXISTS idx_putaway_placements_bin ON putaway_placements(destination_bin);

CREATE TABLE IF NOT EXISTS putaway_scan_logs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  scan_type TEXT NOT NULL,
  scanned_value TEXT NOT NULL,
  expected_value TEXT,
  is_manual INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  failure_reason TEXT,
  operator_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  scanned_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_putaway_scan_logs_task ON putaway_scan_logs(task_id);
