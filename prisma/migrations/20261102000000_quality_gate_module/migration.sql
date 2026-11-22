-- Module 04: Quality Gate (Receiving Inspection, HACCP, Hold/Release & CAPA)
-- Safe additive migration preserving all existing data

ALTER TABLE inbound_batches ADD COLUMN held_qty REAL NOT NULL DEFAULT 0;
ALTER TABLE inventory_lots ADD COLUMN held_cases INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_lots ADD COLUMN quarantined_cases INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_lots ADD COLUMN rejected_cases INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_lots ADD COLUMN pending_cases INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_lots ADD COLUMN inspection_id TEXT;
ALTER TABLE inventory_lots ADD COLUMN quality_decision_reason TEXT;
ALTER TABLE inventory_lots ADD COLUMN quality_decided_by TEXT;
ALTER TABLE inventory_lots ADD COLUMN quality_decided_at TEXT;

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
  received_qty REAL NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_quality_inspections_sku ON quality_inspections(sku);

CREATE TABLE IF NOT EXISTS haccp_checkpoint_templates (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  checkpoint_name TEXT NOT NULL,
  description TEXT NOT NULL,
  ccp_classification TEXT NOT NULL,
  is_ccp INTEGER NOT NULL DEFAULT 1,
  category TEXT,
  sku TEXT,
  temp_zone TEXT,
  measurement_type TEXT NOT NULL DEFAULT 'numeric',
  min_limit REAL,
  max_limit REAL,
  unit TEXT,
  expected_text TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS haccp_checkpoint_readings (
  id TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL,
  shipment_id TEXT,
  template_id TEXT,
  checkpoint_code TEXT NOT NULL,
  checkpoint_name TEXT NOT NULL,
  description TEXT,
  ccp_classification TEXT NOT NULL,
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
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (inspection_id) REFERENCES quality_inspections(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_haccp_readings_inspection ON haccp_checkpoint_readings(inspection_id);
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
  location TEXT NOT NULL,
  exception_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'high',
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
  warehouse TEXT NOT NULL,
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
