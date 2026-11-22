-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('APPROVED', 'PROBATION', 'BLOCKED', 'PENDING_AUDIT');

-- CreateEnum
CREATE TYPE "StorageCondition" AS ENUM ('FROZEN', 'CHILLED', 'AMBIENT', 'DRY_STORAGE');

-- CreateEnum
CREATE TYPE "ZoneType" AS ENUM ('FROZEN', 'CHILLED', 'AMBIENT', 'QUARANTINE', 'RECEIVING_DOCK', 'STAGING');

-- CreateEnum
CREATE TYPE "LotStatus" AS ENUM ('QUARANTINE', 'RELEASED', 'RECALLED', 'EXPIRED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('RESTAURANT', 'FRANCHISE_STORE', 'WHOLESALE', 'HOTEL_CATERING', 'RETAIL');

-- CreateEnum
CREATE TYPE "CustomerAccountStatus" AS ENUM ('ACTIVE', 'CREDIT_HOLD', 'WATCHLIST', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'ALLOCATED', 'PICKING', 'DISPATCHED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderLineStatus" AS ENUM ('PENDING', 'ALLOCATED', 'PICKED', 'DISPATCHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "SdiStatus" AS ENUM ('NOT_SENT', 'QUEUED', 'TRANSMITTED', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('SEPA_CREDIT_TRANSFER', 'SEPA_INSTANT', 'CREDIT_CARD', 'BANK_TRANSFER', 'DIRECT_DEBIT', 'CHECK');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'ISSUED', 'ASN_RECEIVED', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AsnStatus" AS ENUM ('REGISTERED', 'IN_TRANSIT', 'ARRIVED', 'INSPECTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "QualityCheckOutcome" AS ENUM ('PASSED', 'CONDITIONAL_PASS', 'FAILED');

-- CreateEnum
CREATE TYPE "TemperatureStatus" AS ENUM ('IN_RANGE', 'WARNING', 'EXCURSION');

-- CreateEnum
CREATE TYPE "RecallSeverity" AS ENUM ('CLASS_I_HIGH_RISK', 'CLASS_II_POTENTIAL_RISK', 'CLASS_III_LOW_RISK');

-- CreateEnum
CREATE TYPE "RecallStatus" AS ENUM ('INITIATED', 'NOTIFICATIONS_SENT', 'QUARANTINED', 'COMPLETED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CapaSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CapaStatus" AS ENUM ('OPEN', 'UNDER_INVESTIGATION', 'ACTION_PLANNED', 'IMPLEMENTED', 'VERIFIED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AIActionType" AS ENUM ('DEMAND_FORECAST', 'FEFO_ALLOCATION_OPTIMIZATION', 'REORDER_RECOMMENDATION', 'EXPIRY_RISK_ALERT', 'DYNAMIC_PRICING', 'SUPPLIER_RISK_SCORING');

-- CreateEnum
CREATE TYPE "AIApprovalStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'AUTO_EXECUTED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "phone" TEXT,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" TEXT,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "tax_id" TEXT,
    "vat_number" TEXT,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT,
    "address_line" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'Italy',
    "payment_terms" TEXT NOT NULL DEFAULT 'Net 30',
    "on_time_delivery_rate" DECIMAL(5,2) NOT NULL DEFAULT 95.0,
    "quality_score" DECIMAL(5,2) NOT NULL DEFAULT 95.0,
    "status" "SupplierStatus" NOT NULL DEFAULT 'APPROVED',
    "certifications_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "supplier_id" TEXT,
    "storage_condition" "StorageCondition" NOT NULL DEFAULT 'CHILLED',
    "shelf_life_days" INTEGER NOT NULL,
    "allergen_info" TEXT,
    "origin_country" TEXT NOT NULL DEFAULT 'Italy',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skus" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "uom_id" TEXT NOT NULL,
    "barcode" TEXT,
    "pack_size" TEXT NOT NULL,
    "gross_weight_kg" DECIMAL(12,3) NOT NULL,
    "net_weight_kg" DECIMAL(12,3) NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "landed_cost" DECIMAL(12,2) NOT NULL,
    "reorder_point" DECIMAL(12,3) NOT NULL DEFAULT 20.0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units_of_measure" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Weight',
    "conversion_factor" DECIMAL(12,4) NOT NULL DEFAULT 1.0,
    "is_base_unit" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "units_of_measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address_line" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'Italy',
    "total_capacity_kg" DECIMAL(14,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zones" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "zone_type" "ZoneType" NOT NULL DEFAULT 'CHILLED',
    "min_temp_c" DECIMAL(5,2) NOT NULL,
    "max_temp_c" DECIMAL(5,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bins" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "zone_id" TEXT NOT NULL,
    "aisle" TEXT NOT NULL,
    "rack" TEXT NOT NULL,
    "shelf" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "max_weight_kg" DECIMAL(12,3) NOT NULL DEFAULT 1500.0,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lots" (
    "id" TEXT NOT NULL,
    "lot_number" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "supplier_lot_number" TEXT,
    "production_date" TIMESTAMP(3) NOT NULL,
    "expiry_date" TIMESTAMP(3) NOT NULL,
    "received_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "LotStatus" NOT NULL DEFAULT 'RELEASED',
    "initial_quantity" DECIMAL(12,3) NOT NULL,
    "quality_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock" (
    "id" TEXT NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "bin_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "lot_id" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "reserved_quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "available_quantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "last_counted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "customer_type" "CustomerType" NOT NULL DEFAULT 'RESTAURANT',
    "vat_number" TEXT,
    "sdi_recipient_code" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "delivery_address" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'Milan',
    "postal_code" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'Italy',
    "credit_limit" DECIMAL(12,2) NOT NULL DEFAULT 15000.00,
    "current_exposure" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "payment_terms" TEXT NOT NULL DEFAULT 'Net 30',
    "account_status" "CustomerAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "created_by_id" TEXT,
    "order_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivery_date" TIMESTAMP(3) NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'B2B_PORTAL',
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "status" "OrderStatus" NOT NULL DEFAULT 'CONFIRMED',
    "credit_approved" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "lot_id" TEXT,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "total_price" DECIMAL(12,2) NOT NULL,
    "status" "OrderLineStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "issue_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" TIMESTAMP(3) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "tax_amount" DECIMAL(12,2) NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "balance_due" DECIMAL(12,2) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "sdi_transmission_status" "SdiStatus" NOT NULL DEFAULT 'NOT_SENT',
    "sdi_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "payment_number" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payment_method" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'COMPLETED',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "po_number" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "order_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expected_date" TIMESTAMP(3) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'ISSUED',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "quantity_ordered" DECIMAL(12,3) NOT NULL,
    "quantity_received" DECIMAL(12,3) NOT NULL DEFAULT 0.00,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "total_price" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asns" (
    "id" TEXT NOT NULL,
    "asn_number" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "carrier_name" TEXT NOT NULL,
    "tracking_number" TEXT,
    "shipped_at" TIMESTAMP(3) NOT NULL,
    "expected_arrival_at" TIMESTAMP(3) NOT NULL,
    "driver_name" TEXT,
    "vehicle_plate" TEXT,
    "declared_temp_c" DECIMAL(5,2) NOT NULL,
    "status" "AsnStatus" NOT NULL DEFAULT 'IN_TRANSIT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_checks" (
    "id" TEXT NOT NULL,
    "check_number" TEXT NOT NULL,
    "asn_id" TEXT NOT NULL,
    "inspected_by_id" TEXT,
    "temperature_reading_c" DECIMAL(5,2) NOT NULL,
    "packaging_condition_ok" BOOLEAN NOT NULL DEFAULT true,
    "labeling_compliant" BOOLEAN NOT NULL DEFAULT true,
    "sample_size_cases" INTEGER NOT NULL,
    "defect_count" INTEGER NOT NULL DEFAULT 0,
    "outcome" "QualityCheckOutcome" NOT NULL DEFAULT 'PASSED',
    "corrective_notes" TEXT,
    "inspected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temperature_logs" (
    "id" TEXT NOT NULL,
    "sensor_id" TEXT NOT NULL,
    "reading_c" DECIMAL(5,2) NOT NULL,
    "min_allowed_c" DECIMAL(5,2) NOT NULL,
    "max_allowed_c" DECIMAL(5,2) NOT NULL,
    "status" "TemperatureStatus" NOT NULL DEFAULT 'IN_RANGE',
    "warehouse_id" TEXT,
    "zone_id" TEXT,
    "bin_id" TEXT,
    "lot_id" TEXT,
    "recorded_by_id" TEXT,
    "notes" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "temperature_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_email" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_action_logs" (
    "id" TEXT NOT NULL,
    "action_type" "AIActionType" NOT NULL,
    "model_name" TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
    "prompt_summary" TEXT NOT NULL,
    "proposed_action" JSONB NOT NULL,
    "confidence_score" DECIMAL(5,4) NOT NULL,
    "approval_status" "AIApprovalStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "execution_result" JSONB,
    "approved_by_id" TEXT,
    "affected_entity_type" TEXT,
    "affected_entity_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recalls" (
    "id" TEXT NOT NULL,
    "recall_number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "hazard_classification" "RecallSeverity" NOT NULL DEFAULT 'CLASS_I_HIGH_RISK',
    "regulatory_agency" TEXT NOT NULL DEFAULT 'EFSA / Ministero della Salute',
    "status" "RecallStatus" NOT NULL DEFAULT 'INITIATED',
    "initiated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "summary_report" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recalls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recall_lots" (
    "id" TEXT NOT NULL,
    "recall_id" TEXT NOT NULL,
    "lot_id" TEXT NOT NULL,
    "quarantined_kg" DECIMAL(12,3) NOT NULL DEFAULT 0.0,
    "recovered_kg" DECIMAL(12,3) NOT NULL DEFAULT 0.0,
    "disposition" TEXT NOT NULL DEFAULT 'quarantine_hold',
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recall_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capas" (
    "id" TEXT NOT NULL,
    "capa_number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "root_cause" TEXT NOT NULL,
    "corrective_action" TEXT NOT NULL,
    "preventive_action" TEXT NOT NULL,
    "severity" "CapaSeverity" NOT NULL DEFAULT 'HIGH',
    "status" "CapaStatus" NOT NULL DEFAULT 'OPEN',
    "owner_id" TEXT NOT NULL,
    "quality_check_id" TEXT,
    "recall_id" TEXT,
    "target_due_date" TIMESTAMP(3) NOT NULL,
    "completed_date" TIMESTAMP(3),
    "verification_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "permissions_category_idx" ON "permissions"("category");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");

-- CreateIndex
CREATE INDEX "suppliers_status_idx" ON "suppliers"("status");

-- CreateIndex
CREATE INDEX "suppliers_country_idx" ON "suppliers"("country");

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");

-- CreateIndex
CREATE INDEX "products_category_idx" ON "products"("category");

-- CreateIndex
CREATE INDEX "products_storage_condition_idx" ON "products"("storage_condition");

-- CreateIndex
CREATE INDEX "products_supplier_id_idx" ON "products"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "skus_code_key" ON "skus"("code");

-- CreateIndex
CREATE UNIQUE INDEX "skus_barcode_key" ON "skus"("barcode");

-- CreateIndex
CREATE INDEX "skus_product_id_idx" ON "skus"("product_id");

-- CreateIndex
CREATE INDEX "skus_uom_id_idx" ON "skus"("uom_id");

-- CreateIndex
CREATE UNIQUE INDEX "units_of_measure_code_key" ON "units_of_measure"("code");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "zones_code_key" ON "zones"("code");

-- CreateIndex
CREATE INDEX "zones_warehouse_id_zone_type_idx" ON "zones"("warehouse_id", "zone_type");

-- CreateIndex
CREATE UNIQUE INDEX "bins_code_key" ON "bins"("code");

-- CreateIndex
CREATE INDEX "bins_zone_id_is_blocked_idx" ON "bins"("zone_id", "is_blocked");

-- CreateIndex
CREATE UNIQUE INDEX "lots_lot_number_key" ON "lots"("lot_number");

-- CreateIndex
CREATE INDEX "lots_expiry_date_status_idx" ON "lots"("expiry_date", "status");

-- CreateIndex
CREATE INDEX "lots_sku_id_status_idx" ON "lots"("sku_id", "status");

-- CreateIndex
CREATE INDEX "lots_product_id_idx" ON "lots"("product_id");

-- CreateIndex
CREATE INDEX "stock_warehouse_id_idx" ON "stock"("warehouse_id");

-- CreateIndex
CREATE INDEX "stock_sku_id_lot_id_idx" ON "stock"("sku_id", "lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_bin_id_sku_id_lot_id_key" ON "stock"("bin_id", "sku_id", "lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_code_key" ON "customers"("code");

-- CreateIndex
CREATE INDEX "customers_customer_type_idx" ON "customers"("customer_type");

-- CreateIndex
CREATE INDEX "customers_account_status_idx" ON "customers"("account_status");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");

-- CreateIndex
CREATE INDEX "orders_status_order_date_idx" ON "orders"("status", "order_date");

-- CreateIndex
CREATE INDEX "order_lines_order_id_idx" ON "order_lines"("order_id");

-- CreateIndex
CREATE INDEX "order_lines_sku_id_idx" ON "order_lines"("sku_id");

-- CreateIndex
CREATE INDEX "order_lines_lot_id_idx" ON "order_lines"("lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "invoices_order_id_idx" ON "invoices"("order_id");

-- CreateIndex
CREATE INDEX "invoices_customer_id_idx" ON "invoices"("customer_id");

-- CreateIndex
CREATE INDEX "invoices_status_due_date_idx" ON "invoices"("status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "payments_payment_number_key" ON "payments"("payment_number");

-- CreateIndex
CREATE INDEX "payments_invoice_id_idx" ON "payments"("invoice_id");

-- CreateIndex
CREATE INDEX "payments_payment_date_idx" ON "payments"("payment_date");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_po_number_key" ON "purchase_orders"("po_number");

-- CreateIndex
CREATE INDEX "purchase_orders_supplier_id_idx" ON "purchase_orders"("supplier_id");

-- CreateIndex
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders"("status");

-- CreateIndex
CREATE INDEX "purchase_order_lines_purchase_order_id_idx" ON "purchase_order_lines"("purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "asns_asn_number_key" ON "asns"("asn_number");

-- CreateIndex
CREATE INDEX "asns_purchase_order_id_idx" ON "asns"("purchase_order_id");

-- CreateIndex
CREATE INDEX "asns_supplier_id_idx" ON "asns"("supplier_id");

-- CreateIndex
CREATE INDEX "asns_status_idx" ON "asns"("status");

-- CreateIndex
CREATE UNIQUE INDEX "quality_checks_check_number_key" ON "quality_checks"("check_number");

-- CreateIndex
CREATE INDEX "quality_checks_asn_id_idx" ON "quality_checks"("asn_id");

-- CreateIndex
CREATE INDEX "quality_checks_outcome_idx" ON "quality_checks"("outcome");

-- CreateIndex
CREATE INDEX "temperature_logs_status_recorded_at_idx" ON "temperature_logs"("status", "recorded_at");

-- CreateIndex
CREATE INDEX "temperature_logs_lot_id_idx" ON "temperature_logs"("lot_id");

-- CreateIndex
CREATE INDEX "temperature_logs_zone_id_idx" ON "temperature_logs"("zone_id");

-- CreateIndex
CREATE INDEX "temperature_logs_warehouse_id_idx" ON "temperature_logs"("warehouse_id");

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_idx" ON "audit_events"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_events_timestamp_idx" ON "audit_events"("timestamp");

-- CreateIndex
CREATE INDEX "ai_action_logs_action_type_approval_status_idx" ON "ai_action_logs"("action_type", "approval_status");

-- CreateIndex
CREATE INDEX "ai_action_logs_created_at_idx" ON "ai_action_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "recalls_recall_number_key" ON "recalls"("recall_number");

-- CreateIndex
CREATE INDEX "recalls_status_idx" ON "recalls"("status");

-- CreateIndex
CREATE INDEX "recall_lots_lot_id_idx" ON "recall_lots"("lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "recall_lots_recall_id_lot_id_key" ON "recall_lots"("recall_id", "lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "capas_capa_number_key" ON "capas"("capa_number");

-- CreateIndex
CREATE INDEX "capas_status_idx" ON "capas"("status");

-- CreateIndex
CREATE INDEX "capas_owner_id_idx" ON "capas"("owner_id");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skus" ADD CONSTRAINT "skus_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skus" ADD CONSTRAINT "skus_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bins" ADD CONSTRAINT "bins_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock" ADD CONSTRAINT "stock_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock" ADD CONSTRAINT "stock_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "bins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock" ADD CONSTRAINT "stock_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock" ADD CONSTRAINT "stock_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asns" ADD CONSTRAINT "asns_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asns" ADD CONSTRAINT "asns_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_asn_id_fkey" FOREIGN KEY ("asn_id") REFERENCES "asns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_inspected_by_id_fkey" FOREIGN KEY ("inspected_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temperature_logs" ADD CONSTRAINT "temperature_logs_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temperature_logs" ADD CONSTRAINT "temperature_logs_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temperature_logs" ADD CONSTRAINT "temperature_logs_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temperature_logs" ADD CONSTRAINT "temperature_logs_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temperature_logs" ADD CONSTRAINT "temperature_logs_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_action_logs" ADD CONSTRAINT "ai_action_logs_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_lots" ADD CONSTRAINT "recall_lots_recall_id_fkey" FOREIGN KEY ("recall_id") REFERENCES "recalls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recall_lots" ADD CONSTRAINT "recall_lots_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capas" ADD CONSTRAINT "capas_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capas" ADD CONSTRAINT "capas_quality_check_id_fkey" FOREIGN KEY ("quality_check_id") REFERENCES "quality_checks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capas" ADD CONSTRAINT "capas_recall_id_fkey" FOREIGN KEY ("recall_id") REFERENCES "recalls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

