-- Ascentra ERP: Inbound Transport & Goods Receiving Module Migration

CREATE TABLE IF NOT EXISTS "inbound_shipments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shipment_ref" TEXT NOT NULL UNIQUE,
  "supplier_id" TEXT,
  "supplier_name" TEXT NOT NULL,
  "po_id" TEXT,
  "po_number" TEXT,
  "asn_reference" TEXT,
  "carrier" TEXT,
  "vehicle_reg" TEXT,
  "driver_name" TEXT,
  "driver_phone" TEXT,
  "expected_arrival" TEXT,
  "actual_arrival" TEXT,
  "origin_warehouse" TEXT,
  "destination_warehouse" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'expected',
  "transport_notes" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_inbound_shipments_status" ON "inbound_shipments"("status");
CREATE INDEX IF NOT EXISTS "idx_inbound_shipments_dest" ON "inbound_shipments"("destination_warehouse");
CREATE INDEX IF NOT EXISTS "idx_inbound_shipments_supplier" ON "inbound_shipments"("supplier_id");

CREATE TABLE IF NOT EXISTS "inbound_shipment_items" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shipment_id" TEXT NOT NULL REFERENCES "inbound_shipments"("id") ON DELETE CASCADE,
  "sku" TEXT NOT NULL,
  "product_name" TEXT NOT NULL,
  "ordered_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ordered_uom" TEXT,
  "received_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "accepted_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rejected_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "damaged_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "actual_weight" DOUBLE PRECISION,
  "expected_weight" DOUBLE PRECISION,
  "weight_uom" TEXT,
  "weight_variance_pct" DOUBLE PRECISION,
  "weight_discrepancy_status" TEXT,
  "scale_reference" TEXT,
  "weight_tolerance_pct" DOUBLE PRECISION,
  "packages" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "discrepancy_status" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_inbound_items_shipment" ON "inbound_shipment_items"("shipment_id");
CREATE INDEX IF NOT EXISTS "idx_inbound_items_sku" ON "inbound_shipment_items"("sku");

CREATE TABLE IF NOT EXISTS "inbound_batches" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shipment_id" TEXT NOT NULL REFERENCES "inbound_shipments"("id") ON DELETE CASCADE,
  "item_id" TEXT REFERENCES "inbound_shipment_items"("id") ON DELETE CASCADE,
  "sku" TEXT NOT NULL,
  "product_name" TEXT NOT NULL,
  "supplier_batch" TEXT NOT NULL,
  "internal_lot" TEXT NOT NULL,
  "supplier_id" TEXT,
  "supplier_name" TEXT,
  "po_id" TEXT,
  "po_number" TEXT,
  "manufacture_date" TEXT,
  "expiry_date" TEXT NOT NULL,
  "received_date" TEXT NOT NULL,
  "origin" TEXT,
  "quantity" DOUBLE PRECISION NOT NULL,
  "unit" TEXT NOT NULL,
  "storage" TEXT,
  "status" TEXT NOT NULL DEFAULT 'received',
  "accepted_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rejected_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "quarantined_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("supplier_batch", "sku", "supplier_id")
);

CREATE INDEX IF NOT EXISTS "idx_inbound_batches_shipment" ON "inbound_batches"("shipment_id");
CREATE INDEX IF NOT EXISTS "idx_inbound_batches_sku" ON "inbound_batches"("sku");
CREATE INDEX IF NOT EXISTS "idx_inbound_batches_lot" ON "inbound_batches"("internal_lot");

CREATE TABLE IF NOT EXISTS "inbound_temperature_logs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shipment_id" TEXT NOT NULL REFERENCES "inbound_shipments"("id") ON DELETE CASCADE,
  "sku" TEXT,
  "temp_c" DOUBLE PRECISION NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'C',
  "min_c" DOUBLE PRECISION NOT NULL,
  "max_c" DOUBLE PRECISION NOT NULL,
  "recorded_at" TEXT NOT NULL,
  "recorded_by" TEXT NOT NULL,
  "verified_by" TEXT,
  "excursion" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "evidence_ref" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_inbound_temp_shipment" ON "inbound_temperature_logs"("shipment_id");

CREATE TABLE IF NOT EXISTS "inbound_documents" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shipment_id" TEXT NOT NULL REFERENCES "inbound_shipments"("id") ON DELETE CASCADE,
  "sku" TEXT,
  "doc_type" TEXT NOT NULL,
  "reference_number" TEXT,
  "issuer" TEXT,
  "issue_date" TEXT,
  "expiry_date" TEXT,
  "file_name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "storage_path" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending_review',
  "verified_by" TEXT,
  "verified_at" TEXT,
  "review_notes" TEXT,
  "uploaded_by" TEXT NOT NULL,
  "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_inbound_docs_shipment" ON "inbound_documents"("shipment_id");

CREATE TABLE IF NOT EXISTS "inbound_quality_checks" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shipment_id" TEXT NOT NULL REFERENCES "inbound_shipments"("id") ON DELETE CASCADE,
  "item_id" TEXT REFERENCES "inbound_shipment_items"("id") ON DELETE CASCADE,
  "check_type" TEXT NOT NULL,
  "result" TEXT NOT NULL,
  "notes" TEXT,
  "evidence" TEXT,
  "performed_by" TEXT NOT NULL,
  "performed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_inbound_qc_shipment" ON "inbound_quality_checks"("shipment_id");
