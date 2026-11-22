-- ============================================================================
-- Ascentra Food Distribution ERP — Initial PostgreSQL Migration
-- Migration: 20261024000000_init
-- Non-destructive DDL with foreign keys, constraints, and indexes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "organizations" (
    "id" SERIAL PRIMARY KEY,
    "code" TEXT NOT NULL UNIQUE,
    "name" TEXT NOT NULL,
    "vat_number" TEXT,
    "country" TEXT NOT NULL DEFAULT 'UK',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "sites" (
    "id" SERIAL PRIMARY KEY,
    "organization_id" INTEGER NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "code" TEXT NOT NULL UNIQUE,
    "name" TEXT NOT NULL,
    "site_type" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'Italy',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Rome',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "sites_organization_id_idx" ON "sites"("organization_id");

CREATE TABLE IF NOT EXISTS "warehouses" (
    "id" SERIAL PRIMARY KEY,
    "site_id" INTEGER NOT NULL REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "code" TEXT NOT NULL UNIQUE,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "warehouses_site_id_idx" ON "warehouses"("site_id");

CREATE TABLE IF NOT EXISTS "warehouse_locations" (
    "id" SERIAL PRIMARY KEY,
    "warehouse_id" INTEGER NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "code" TEXT NOT NULL UNIQUE,
    "zone" TEXT NOT NULL,
    "min_temp_c" DECIMAL(5,2) NOT NULL,
    "max_temp_c" DECIMAL(5,2) NOT NULL,
    "capacity_kg" DECIMAL(12,3) NOT NULL DEFAULT 2000,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS "warehouse_locations_warehouse_id_zone_idx" ON "warehouse_locations"("warehouse_id", "zone");

CREATE TABLE IF NOT EXISTS "users" (
    "id" SERIAL PRIMARY KEY,
    "organization_id" INTEGER NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "site_id" INTEGER REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "email" TEXT NOT NULL UNIQUE,
    "full_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "users_organization_id_role_idx" ON "users"("organization_id", "role");

CREATE TABLE IF NOT EXISTS "user_sessions" (
    "id" TEXT PRIMARY KEY,
    "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "token_hash" TEXT NOT NULL UNIQUE,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "user_sessions_user_id_expires_at_idx" ON "user_sessions"("user_id", "expires_at");

CREATE TABLE IF NOT EXISTS "suppliers" (
    "id" SERIAL PRIMARY KEY,
    "organization_id" INTEGER NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "code" TEXT NOT NULL UNIQUE,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "on_time_rate" DECIMAL(5,2) NOT NULL DEFAULT 95.0,
    "quality_score" INTEGER NOT NULL DEFAULT 95,
    "lead_time_days" INTEGER NOT NULL DEFAULT 2,
    "open_orders" INTEGER NOT NULL DEFAULT 0,
    "price_variance" DECIMAL(5,2) NOT NULL DEFAULT 0.0,
    "status" TEXT NOT NULL DEFAULT 'approved',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "suppliers_organization_id_status_idx" ON "suppliers"("organization_id", "status");

CREATE TABLE IF NOT EXISTS "customers" (
    "id" SERIAL PRIMARY KEY,
    "organization_id" INTEGER NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "code" TEXT NOT NULL UNIQUE,
    "name" TEXT NOT NULL,
    "customer_type" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'Milan',
    "contact_email" TEXT,
    "vat_number" TEXT,
    "sdi_recipient_code" TEXT,
    "credit_limit_cents" INTEGER NOT NULL DEFAULT 2500000,
    "current_exposure_cents" INTEGER NOT NULL DEFAULT 0,
    "credit_status" TEXT NOT NULL DEFAULT 'clear',
    "min_shelf_life_days" INTEGER NOT NULL DEFAULT 5,
    "status" TEXT NOT NULL DEFAULT 'active',
    "estimated_waste_pct" DECIMAL(5,2) NOT NULL DEFAULT 2.5,
    "trend_pct" DECIMAL(5,2) NOT NULL DEFAULT 4.2,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "customers_organization_id_customer_type_idx" ON "customers"("organization_id", "customer_type");

CREATE TABLE IF NOT EXISTS "products" (
    "id" SERIAL PRIMARY KEY,
    "organization_id" INTEGER NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "supplier_id" INTEGER REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "sku" TEXT NOT NULL UNIQUE,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'kg',
    "pack_size" TEXT NOT NULL,
    "temperature_profile" TEXT NOT NULL,
    "shelf_life_days" INTEGER NOT NULL,
    "min_shelf_life_days" INTEGER NOT NULL,
    "catch_weight" BOOLEAN NOT NULL DEFAULT false,
    "allergens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "unit_price_cents" INTEGER NOT NULL,
    "landed_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "tax_rate_pct" DECIMAL(5,2) NOT NULL DEFAULT 10.0,
    "supplier_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "products_organization_id_category_idx" ON "products"("organization_id", "category");

CREATE TABLE IF NOT EXISTS "purchase_orders" (
    "id" SERIAL PRIMARY KEY,
    "number" TEXT NOT NULL UNIQUE,
    "supplier_id" INTEGER NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "supplier_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'rfq_sent',
    "expected_at" TIMESTAMP(3) NOT NULL,
    "asn_number" TEXT,
    "temperature_profile" TEXT NOT NULL DEFAULT 'Chilled 0–4°C',
    "subtotal_cents" INTEGER NOT NULL DEFAULT 0,
    "freight_duty_cents" INTEGER NOT NULL DEFAULT 0,
    "total_landed_cents" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "purchase_orders_supplier_id_status_idx" ON "purchase_orders"("supplier_id", "status");

CREATE TABLE IF NOT EXISTS "purchase_order_lines" (
    "id" SERIAL PRIMARY KEY,
    "purchase_order_id" INTEGER NOT NULL REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "product_id" INTEGER NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "sku" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "ordered_kg" DECIMAL(12,3) NOT NULL,
    "received_kg" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "unit_cost_cents" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "goods_receipts" (
    "id" SERIAL PRIMARY KEY,
    "purchase_order_id" INTEGER NOT NULL REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "receipt_number" TEXT NOT NULL UNIQUE,
    "batch_code" TEXT NOT NULL,
    "received_kg" DECIMAL(12,3) NOT NULL,
    "temperature_c" DECIMAL(5,2) NOT NULL,
    "certificate_ref" TEXT NOT NULL,
    "inspection_status" TEXT NOT NULL DEFAULT 'released',
    "inspected_by" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "inventory_lots" (
    "id" SERIAL PRIMARY KEY,
    "batch_code" TEXT NOT NULL UNIQUE,
    "product_id" INTEGER NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "supplier_id" INTEGER REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "warehouse_id" INTEGER REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "location_id" INTEGER REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "sku" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "warehouse" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "purchase_order_ref" TEXT NOT NULL DEFAULT 'PO-2401',
    "certificate_ref" TEXT NOT NULL DEFAULT 'CERT-HACCP-OK',
    "received_at" TIMESTAMP(3) NOT NULL,
    "expires_on" TIMESTAMP(3) NOT NULL,
    "initial_kg" DECIMAL(12,3) NOT NULL,
    "remaining_kg" DECIMAL(12,3) NOT NULL CHECK ("remaining_kg" >= 0),
    "reserved_kg" DECIMAL(12,3) NOT NULL DEFAULT 0 CHECK ("reserved_kg" >= 0),
    "landed_cost_cents_kg" INTEGER NOT NULL DEFAULT 0,
    "temperature_status" TEXT NOT NULL DEFAULT 'in_range',
    "quality_status" TEXT NOT NULL DEFAULT 'released',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "inventory_lots_sku_quality_status_expires_on_idx" ON "inventory_lots"("sku", "quality_status", "expires_on");

CREATE TABLE IF NOT EXISTS "stock_movements" (
    "id" SERIAL PRIMARY KEY,
    "lot_id" INTEGER NOT NULL REFERENCES "inventory_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "movement_type" TEXT NOT NULL,
    "quantity_delta" DECIMAL(12,3) NOT NULL,
    "balance_after" DECIMAL(12,3) NOT NULL,
    "reference" TEXT NOT NULL,
    "reason" TEXT,
    "actor" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "stock_movements_lot_id_created_at_idx" ON "stock_movements"("lot_id", "created_at");

CREATE TABLE IF NOT EXISTS "sales_orders" (
    "id" SERIAL PRIMARY KEY,
    "number" TEXT NOT NULL UNIQUE,
    "customer_id" INTEGER REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "customer_name" TEXT NOT NULL,
    "customer_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "credit_status" TEXT NOT NULL DEFAULT 'clear',
    "credit_override_by" TEXT,
    "credit_override_reason" TEXT,
    "ordered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "promised_at" TIMESTAMP(3) NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "landed_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "delivery_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "sales_orders_status_credit_status_idx" ON "sales_orders"("status", "credit_status");

CREATE TABLE IF NOT EXISTS "sales_order_lines" (
    "id" SERIAL PRIMARY KEY,
    "order_id" INTEGER NOT NULL REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "product_id" INTEGER REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "sku" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "quantity_kg" DECIMAL(12,3) NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "batch_code" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "sales_order_lines_order_id_idx" ON "sales_order_lines"("order_id");
CREATE INDEX IF NOT EXISTS "sales_order_lines_batch_code_idx" ON "sales_order_lines"("batch_code");

CREATE TABLE IF NOT EXISTS "stock_reservations" (
    "id" SERIAL PRIMARY KEY,
    "lot_id" INTEGER NOT NULL REFERENCES "inventory_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "order_id" INTEGER NOT NULL REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "order_number" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "reserved_kg" DECIMAL(12,3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "stock_reservations_lot_id_status_idx" ON "stock_reservations"("lot_id", "status");
CREATE INDEX IF NOT EXISTS "stock_reservations_order_id_idx" ON "stock_reservations"("order_id");

CREATE TABLE IF NOT EXISTS "cycle_counts" (
    "id" SERIAL PRIMARY KEY,
    "lot_id" INTEGER NOT NULL REFERENCES "inventory_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "batch_code" TEXT NOT NULL,
    "expected_kg" DECIMAL(12,3) NOT NULL,
    "counted_kg" DECIMAL(12,3) NOT NULL,
    "variance_kg" DECIMAL(12,3) NOT NULL,
    "counted_by" TEXT NOT NULL,
    "counted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "warehouse_tasks" (
    "id" SERIAL PRIMARY KEY,
    "warehouse_id" INTEGER REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "reference" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "assignee" TEXT NOT NULL DEFAULT 'Unassigned',
    "location" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "due_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "warehouse_tasks_status_priority_idx" ON "warehouse_tasks"("status", "priority");

CREATE TABLE IF NOT EXISTS "deliveries" (
    "id" SERIAL PRIMARY KEY,
    "number" TEXT NOT NULL UNIQUE,
    "order_id" INTEGER REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "order_number" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "driver" TEXT NOT NULL,
    "vehicle" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "planned_at" TIMESTAMP(3) NOT NULL,
    "delivered_at" TIMESTAMP(3),
    "temperature_c" DECIMAL(5,2) NOT NULL,
    "pod_signed" BOOLEAN NOT NULL DEFAULT false,
    "pod_signer" TEXT,
    "exception" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "deliveries_status_route_idx" ON "deliveries"("status", "route");

CREATE TABLE IF NOT EXISTS "invoices" (
    "id" SERIAL PRIMARY KEY,
    "number" TEXT NOT NULL UNIQUE,
    "customer_id" INTEGER REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "order_id" INTEGER REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "customer_name" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "paid_cents" INTEGER NOT NULL DEFAULT 0,
    "cost_cents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "due_date" TEXT NOT NULL,
    "sdi_status" TEXT NOT NULL DEFAULT 'not_sent',
    "sdi_reference" TEXT,
    "margin_pct" DECIMAL(5,2) NOT NULL DEFAULT 24.0,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "invoices_status_sdi_status_idx" ON "invoices"("status", "sdi_status");

CREATE TABLE IF NOT EXISTS "payments" (
    "id" SERIAL PRIMARY KEY,
    "invoice_id" INTEGER NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "amount_cents" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'bank_transfer',
    "bank_reference" TEXT,
    "recorded_by" TEXT NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "credit_notes" (
    "id" SERIAL PRIMARY KEY,
    "number" TEXT NOT NULL UNIQUE,
    "invoice_id" INTEGER REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "customer_id" INTEGER REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "customer_name" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "temperature_readings" (
    "id" SERIAL PRIMARY KEY,
    "location" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "celsius" DECIMAL(5,2) NOT NULL,
    "min_c" DECIMAL(5,2) NOT NULL,
    "max_c" DECIMAL(5,2) NOT NULL,
    "status" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "temperature_readings_status_recorded_at_idx" ON "temperature_readings"("status", "recorded_at");

CREATE TABLE IF NOT EXISTS "ai_insights" (
    "id" SERIAL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL,
    "evidence" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "action" TEXT NOT NULL,
    "requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "decision" TEXT,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "alert_events" (
    "id" SERIAL PRIMARY KEY,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "recall_notifications" (
    "id" SERIAL PRIMARY KEY,
    "batch_id" INTEGER NOT NULL,
    "batch_code" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "notified_by" TEXT NOT NULL,
    "notified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE ("batch_id", "order_number")
);

CREATE TABLE IF NOT EXISTS "idempotency_records" (
    "key" TEXT PRIMARY KEY,
    "endpoint" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response_body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "offline_sync_events" (
    "id" SERIAL PRIMARY KEY,
    "idempotency_key" TEXT NOT NULL UNIQUE,
    "device_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload_json" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'applied',
    "conflict_detail" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "audit_events" (
    "id" SERIAL PRIMARY KEY,
    "organization_id" INTEGER REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "user_id" INTEGER REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "actor" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata_json" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "audit_events_entity_type_entity_id_idx" ON "audit_events"("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "audit_events_created_at_idx" ON "audit_events"("created_at");
