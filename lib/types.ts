export type StatusTone =
  | "ok"
  | "warning"
  | "critical"
  | "neutral"
  | "info"
  | "success"
  | "danger"
  | "brand"
  | "default";

export interface Kpi {
  label: string;
  value: string;
  change: string;
  trend: "up" | "down" | "flat";
  tone?: StatusTone;
  hint?: string;
}

export interface ProductCertificate {
  id: string;
  certificate_type: string;
  certificate_number: string;
  issuer: string;
  valid_from: string;
  valid_to: string;
  status: "valid" | "expiring" | "expired" | "pending";
  document_reference: string | null;
  notes: string | null;
}

export interface ProductPrice {
  id: string;
  price_type: "list" | "cost" | "contract" | "promotional";
  amount_cents: number;
  currency: string;
  uom: string;
  customer_segment: string | null;
  effective_from: string;
  effective_to: string | null;
  status: "active" | "expired" | "scheduled";
}

export interface ProductSupplierLink {
  supplier_id: string;
  supplier_name: string;
  supplier_sku: string | null;
  is_primary: boolean;
  lead_time_days: number;
  moq_cases: number;
  cost_price_cents: number;
  status: "approved" | "review" | "blocked";
}

export interface Product {
  id: number;
  sku: string;
  name: string;
  category: string;
  unit: string;
  pack_size: string;
  temperature_profile: string;
  shelf_life_days: number;
  min_shelf_life_days: number;
  catch_weight: boolean;
  allergens: string[];
  unit_price_cents: number;
  supplier_name: string;
  status: "active" | "hold" | "discontinued";
  // Extended product-master attributes. Optional so older call sites and the
  // empty-start fixtures remain valid.
  description?: string;
  brand?: string;
  origin?: string;
  hs_code?: string;
  base_uom?: string;
  pack_uom?: string;
  units_per_case?: number;
  unit_weight_kg?: number;
  case_weight_kg?: number;
  catch_weight_min_kg?: number;
  catch_weight_max_kg?: number;
  tare_weight_kg?: number;
  may_contain?: string[];
  handling?: string[];
  diet_flags?: string[];
  temp_min_c?: number;
  temp_max_c?: number;
  weight_tolerance_pct?: number;
  cost_price_cents?: number;
  vat_rate_pct?: number;
  currency?: string;
  supplier_id?: string;
  supplier_sku?: string;
  image_url?: string;
  image_source?: string;
  certificate_count?: number;
  expiring_certificate_count?: number;
}

export interface ProductDetail extends Product {
  prices: ProductPrice[];
  certificates: ProductCertificate[];
  suppliers: ProductSupplierLink[];
}

export interface Supplier {
  id: number;
  code: string;
  name: string;
  country: string;
  category: string;
  on_time_rate: number;
  quality_score: number;
  lead_time_days: number;
  open_orders: number;
  price_variance: number;
  status: "approved" | "review" | "blocked";
}

export interface Lot {
  id: number;
  batch_code: string;
  batch_id?: string;
  sku: string;
  product_name: string;
  supplier_name: string;
  supplier_lot?: string;
  warehouse: string;
  location: string;
  zone: string;
  received_at: string;
  expires_on: string;
  days_remaining: number;
  remaining_kg: number;
  quantity_cases?: number;
  received_cases?: number;
  allocated_cases?: number;
  held_cases?: number;
  quarantined_cases?: number;
  rejected_cases?: number;
  pending_cases?: number;
  temperature_status: "in_range" | "warning" | "excursion" | "pending";
  quality_status: "released" | "quarantine" | "rejected" | "on_hold" | "pending";
  inspection_id?: string | null;
  quality_decision_reason?: string | null;
  fefo_rank: number;
}

export interface WarehouseTask {
  id: number;
  reference: string;
  task_type: "putaway" | "pick" | "pack" | "load" | "cycle_count";
  priority: "low" | "normal" | "high";
  assignee: string;
  location: string;
  detail: string;
  status: "queued" | "in_progress" | "blocked" | "done";
  due_at: string;
}

export interface OrderLine {
  sku: string;
  product_name: string;
  quantity_kg: number;
  unit_price_cents: number;
  batch_code: string;
}

export interface SalesOrder {
  id: number;
  number: string;
  customer_name: string;
  customer_type: "restaurant" | "store" | "wholesale";
  status: "draft" | "confirmed" | "picking" | "dispatched" | "delivered" | "cancelled";
  credit_status: "clear" | "warning" | "blocked";
  ordered_at: string;
  promised_at: string;
  total_cents: number;
  lines: OrderLine[];
}

export type Order = SalesOrder;

export interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string;
  supplier_name: string;
  sku: string;
  product_name: string;
  ordered_cases: number;
  received_cases: number;
  unit_cost_cents: number;
  total_cents: number;
  expected_date: string;
  status: string;
  asn_reference?: string | null;
  warehouse?: string;
}

export type DeliveryLifecycleStatus =
  | "planned"
  | "assigned"
  | "ready_for_loading"
  | "loading"
  | "loaded"
  | "dispatched"
  | "in_transit"
  | "partially_delivered"
  | "delivered"
  | "failed"
  | "returned"
  | "cancelled"
  | "exception";

export interface Delivery {
  id: number;
  number: string;
  order_number: string;
  customer_name: string;
  driver: string;
  vehicle: string;
  route: string;
  status: DeliveryLifecycleStatus;
  planned_at: string;
  temperature_c: number;
  pod_signed: boolean;
  exception: string | null;
}

export interface Invoice {
  id: number;
  number: string;
  customer_name: string;
  order_number: string;
  total_cents: number;
  paid_cents: number;
  status: "draft" | "issued" | "part_paid" | "paid" | "overdue";
  due_date: string;
  sdi_status: "not_sent" | "queued" | "sent" | "accepted" | "rejected";
  margin_pct: number;
}

export interface TemperatureReading {
  id: number;
  location: string;
  zone: string;
  celsius: number;
  min_c: number;
  max_c: number;
  status: "in_range" | "warning" | "excursion";
  device: string;
  recorded_at: string;
}

export interface StorePerformance {
  id: number;
  code: string;
  name: string;
  city: string;
  purchases_30d_cents: number;
  orders_30d: number;
  estimated_consumption_kg: number;
  waste_pct: number;
  trend_pct: number;
  top_product: string;
  status: "active" | "watch" | "paused";
}

export interface Insight {
  id: number;
  kind: "forecast" | "anomaly" | "replenishment" | "margin" | "compliance";
  title: string;
  detail: string;
  confidence: number;
  evidence: string[];
  action: string;
  requires_approval: boolean;
}

export interface Alert {
  id: number;
  severity: StatusTone;
  title: string;
  detail: string;
  href: string;
  age: string;
}

export interface JourneyStep {
  step: number;
  title: string;
  description: string;
  owner: string;
}

export interface DashboardOverview {
  kpis: Kpi[];
  alerts: Alert[];
  temperature: TemperatureReading[];
  expiring: Lot[];
  tasks: WarehouseTask[];
  insights: Insight[];
  journey: JourneyStep[];
  revenue_by_week: { week: string; revenue: number; cost: number }[];
}

export interface FinanceSummary {
  invoices: Invoice[];
  revenue_cents: number;
  collected_cents: number;
  overdue_cents: number;
  ap_cents: number;
  gross_margin_pct: number;
  sdi_pending: number;
  ageing: { bucket: string; amount_cents: number }[];
}

export interface TraceabilityResult {
  batch: Lot;
  upstream: {
    supplier: string;
    purchase_order: string;
    received_at: string;
    initial_kg: number;
    certificate: string;
  };
  downstream: {
    order_number: string;
    customer_name: string;
    shipped_kg: number;
    delivered_at: string;
  }[];
  mass_balance: {
    received_kg: number;
    shipped_kg: number;
    remaining_kg: number;
    variance_kg: number;
  };
}

export interface StoreSummary {
  stores: StorePerformance[];
  total_spend_cents: number;
  total_orders: number;
  average_waste_pct: number;
}

// ============================================================================
// Module 09: Loading and Delivery Types
// ============================================================================

export interface Vehicle {
  id: string;
  registration_number: string;
  vehicle_name: string;
  make_model: string;
  vehicle_type: "van_3_5t" | "rigid_truck_7_5t" | "rigid_truck_18t" | "artic_semi_26t";
  warehouse: string;
  max_payload_kg: number;
  max_pallets: number;
  max_volume_m3: number;
  temperature_capability: "multi_temp" | "chilled" | "frozen" | "ambient";
  has_chilled_compartment: boolean;
  has_frozen_compartment: boolean;
  has_ambient_compartment: boolean;
  status: "active" | "maintenance" | "out_of_service";
  inspection_status: "passed" | "due" | "failed";
  inspection_expiry_date: string | null;
  atp_expiry_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Driver {
  id: string;
  user_id: string | null;
  name: string;
  email: string;
  phone: string;
  warehouse: string;
  license_number: string;
  license_type: string;
  license_expiry_date: string;
  cqc_expiry_date: string | null;
  medical_expiry_date: string | null;
  status: "available" | "on_route" | "off_duty" | "suspended";
  assigned_vehicle_id: string | null;
  current_route_code: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeliveryStop {
  id: string;
  delivery_id: string;
  route_code: string;
  stop_number: number;
  customer_id: string;
  customer_name: string;
  delivery_address: string;
  time_window_start: string;
  time_window_end: string;
  driver_instructions: string | null;
  stop_status: "pending" | "en_route" | "arrived" | "delivered" | "failed" | "skipped";
  arrival_time: string | null;
  departure_time: string | null;
  created_at: string;
}

export interface DeliveryManifestItem {
  id: string;
  manifest_number: string;
  delivery_id: string;
  order_id: string;
  order_number: string;
  order_line_id: string | null;
  packing_record_id: string | null;
  sscc_barcode: string | null;
  container_id: string | null;
  sku: string;
  product_name: string;
  lot_batch: string;
  cases: number;
  weight_kg: number;
  uom: string;
  temp_zone: string;
  compartment: "chilled" | "frozen" | "ambient";
  loading_sequence: number;
  is_scanned_loaded: boolean;
  scanned_barcode: string | null;
  scanned_at: string | null;
  scanned_by: string | null;
  created_at: string;
}

export interface VehicleInspection {
  id: string;
  inspection_number: string;
  vehicle_id: string;
  vehicle_registration: string;
  driver_id: string;
  driver_name: string;
  warehouse: string;
  route_code: string | null;
  delivery_id: string | null;
  cleanliness_passed: boolean;
  cleanliness_notes: string | null;
  vehicle_condition_passed: boolean;
  vehicle_condition_notes: string | null;
  reefer_functioning: boolean;
  chilled_temp_c: number | null;
  chilled_temp_valid: boolean;
  frozen_temp_c: number | null;
  frozen_temp_valid: boolean;
  compartment_dividers_secure: boolean;
  load_capacity_valid: boolean;
  transport_documents_verified: boolean;
  driver_confirmed: boolean;
  status: "passed" | "failed";
  failed_reason: string | null;
  inspected_at: string;
  created_at: string;
}

export interface DeliveryTemperatureLog {
  id: string;
  delivery_id: string;
  vehicle_id: string | null;
  vehicle_registration: string | null;
  route_code: string | null;
  compartment: "chilled" | "frozen" | "ambient";
  stage: "pre_loading" | "post_loading" | "in_transit" | "arrival" | "delivery";
  expected_temp_min_c: number;
  expected_temp_max_c: number;
  actual_temp_c: number;
  is_excursion: boolean;
  excursion_severity: "warning" | "critical" | null;
  sensor_or_driver_id: string;
  recorded_by_name: string;
  quality_exception_id: string | null;
  notes: string | null;
  recorded_at: string;
}

export interface DeliveryProof {
  id: string;
  delivery_id: string;
  order_id: string;
  order_number: string;
  customer_id: string;
  customer_name: string;
  recipient_name: string;
  recipient_role: string | null;
  signature_data: string;
  photo_url: string | null;
  delivered_cases: number;
  accepted_cases: number;
  rejected_cases: number;
  driver_id: string;
  driver_name: string;
  delivery_notes: string | null;
  captured_at: string;
  sync_status: string;
}

export interface DeliveryException {
  id: string;
  delivery_id: string;
  order_id: string | null;
  order_number: string | null;
  exception_type:
    | "customer_unavailable"
    | "delivery_refused"
    | "damaged_goods"
    | "missing_quantity"
    | "temperature_excursion"
    | "incorrect_product"
    | "access_issue"
    | "partial_delivery";
  severity: "low" | "medium" | "high" | "critical";
  reason: string;
  affected_sku: string | null;
  affected_lot: string | null;
  affected_cases: number | null;
  photo_url: string | null;
  customer_acknowledged: boolean;
  follow_up_action: "return_to_warehouse" | "redeliver" | "credit_note" | "dispose" | "quarantine";
  driver_id: string;
  driver_name: string;
  reported_at: string;
  status: "open" | "investigating" | "resolved";
  resolution_notes: string | null;
}

export interface OfflineSyncQueueItem {
  id: string;
  sync_action_id: string;
  idempotency_key: string;
  driver_id: string;
  action_type:
    | "SUBMIT_INSPECTION"
    | "LOG_TEMPERATURE"
    | "SCAN_MANIFEST"
    | "START_TRANSIT"
    | "ARRIVE_STOP"
    | "SUBMIT_POD"
    | "REPORT_EXCEPTION";
  payload_json: string;
  device_timestamp: string;
  status: "pending" | "synced" | "failed" | "conflict";
  processed_at: string | null;
  error_message: string | null;
  created_at: string;
}

export interface DetailedDelivery {
  id: string;
  delivery_reference: string;
  order_id: string;
  order_number: string;
  customer_id: string;
  customer: string;
  delivery_address: string;
  warehouse: string;
  delivery_date: string;
  time_window_start: string;
  time_window_end: string;
  route_code: string;
  driver_id: string | null;
  driver: string;
  vehicle_id: string | null;
  vehicle: string;
  stop_sequence: number;
  eta: string;
  temp_c: number;
  status: DeliveryLifecycleStatus;
  pod_signed: boolean;
  stops_completed: number;
  stops_total: number;
  priority: "low" | "normal" | "high" | "urgent";
  total_packages: number;
  total_pallets: number;
  total_cases: number;
  total_weight_kg: number;
  departure_time: string | null;
  arrival_time: string | null;
  completed_time: string | null;
  driver_notes: string | null;
  exception: string | null;
  created_at: string;
  updated_at: string;
  manifest_items?: DeliveryManifestItem[];
  stops?: DeliveryStop[];
  temperature_logs?: DeliveryTemperatureLog[];
  inspections?: VehicleInspection[];
  proof_of_delivery?: DeliveryProof | null;
  exceptions?: DeliveryException[];
}

// ----------------------------------------------------------------------------
// MODULE 10 — FINANCE & ITALIAN E-INVOICING TYPES
// ----------------------------------------------------------------------------

export type InvoiceLifecycleStatus =
  | "draft"
  | "issued"
  | "part_paid"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "cancelled"
  | "credited";

export type SdiTransmissionStatus =
  | "not_sent"
  | "queued"
  | "generated"
  | "validated"
  | "validation_failed"
  | "transmitted"
  | "delivered_to_sdi"
  | "accepted"
  | "rejected"
  | "failed";

export interface InvoiceLine {
  id: string;
  invoice_id: string;
  order_line_id?: string | null;
  delivery_manifest_item_id?: string | null;
  sku: string;
  product_name: string;
  cases_delivered: number;
  quantity: number;
  catch_weight_kg: number;
  unit_price_cents: number;
  discount_pct: number;
  tax_rate_pct: number;
  vat_rate_pct: number;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  line_total_cents: number;
  lot_batch?: string | null;
}

export interface DetailedInvoice {
  id: string;
  invoice_number: string;
  order_id: string;
  order_number: string;
  delivery_id?: string | null;
  customer_id: string;
  customer: string;
  issued_date: string;
  due_date: string;
  amount_cents: number;
  total_cents: number;
  paid_cents: number;
  subtotal_cents: number;
  tax_cents: number;
  discount_cents: number;
  currency: string;
  status: InvoiceLifecycleStatus;
  sdi_status: SdiTransmissionStatus;
  sdi_reference?: string | null;
  payment_terms: string;
  is_credit_note: boolean;
  original_invoice_id?: string | null;
  customer_piva?: string | null;
  customer_fiscal_code?: string | null;
  customer_sdi_code?: string | null;
  customer_pec?: string | null;
  customer_address?: string | null;
  notes?: string | null;
  sdi_sent_at?: string | null;
  sdi_delivered_at?: string | null;
  sdi_error_code?: string | null;
  sdi_error_description?: string | null;
  sdi_version: number;
  xml_content?: string | null;
  created_at: string;
  lines: InvoiceLine[];
  allocations?: PaymentAllocationRecord[];
  margin_pct?: number;
}

export interface PaymentRecord {
  id: string;
  invoice_id: string;
  customer_id?: string | null;
  amount_cents: number;
  unallocated_cents: number;
  currency: string;
  payment_method: string;
  reference: string;
  bank_statement_id?: string | null;
  status: "pending" | "settled" | "refunded" | "cancelled";
  recorded_by: string;
  paid_at: string;
  notes?: string | null;
  allocations?: PaymentAllocationRecord[];
}

export interface PaymentAllocationRecord {
  id: string;
  payment_id: string;
  invoice_id: string;
  allocated_cents: number;
  amount_cents?: number;
  allocated_at: string;
  invoice_number?: string;
}

export interface BankStatement {
  id: string;
  statement_reference: string;
  filename: string;
  file_checksum: string;
  account_iban?: string | null;
  opening_balance_cents: number;
  closing_balance_cents: number;
  imported_at: string;
  imported_by: string;
  total_lines: number;
  line_count?: number;
  matched_lines: number;
  status: "imported" | "partially_reconciled" | "reconciled";
  lines: BankStatementLine[];
}

export interface BankStatementLine {
  id: string;
  statement_id: string;
  line_number: number;
  transaction_date: string;
  value_date: string;
  amount_cents: number;
  currency: string;
  counterparty_name?: string | null;
  counterparty_iban?: string | null;
  bank_reference?: string | null;
  description: string;
  reconciliation_status: "unmatched" | "matched" | "partially_matched" | "manual_reconciled" | "ignored";
  matched_invoice_id?: string | null;
  matched_payment_id?: string | null;
  reconciled_by?: string | null;
  reconciled_at?: string | null;
  reconciliation_notes?: string | null;
}

export interface LandedCostAllocation {
  id: string;
  po_id?: string | null;
  batch_id?: string | null;
  allocation_number: string;
  allocation_method: "quantity" | "weight" | "volume" | "value" | "manual";
  total_freight_cents: number;
  total_customs_duty_cents: number;
  total_insurance_cents: number;
  total_handling_cents: number;
  total_other_cents: number;
  total_landed_cost_cents: number;
  allocated_by: string;
  allocated_at: string;
  notes?: string | null;
  items: LandedCostItem[];
}

export interface LandedCostItem {
  id: string;
  allocation_id: string;
  sku: string;
  batch_id: string;
  cases: number;
  weight_kg: number;
  base_purchase_cost_cents: number;
  allocated_freight_cents: number;
  allocated_duty_cents: number;
  allocated_insurance_cents: number;
  allocated_handling_cents: number;
  total_allocated_cents: number;
  allocated_cost_cents: number;
  final_unit_cost_cents: number;
}

export interface DeliveredMarginReport {
  dimension: "product" | "sku" | "customer" | "order" | "delivery" | "supplier" | "warehouse" | "period";
  dimension_key: string;
  dimension_label: string;
  invoiced_revenue_cents: number;
  product_base_cost_cents: number;
  landed_cost_cents: number;
  delivery_transport_cents: number;
  other_attributable_cents: number;
  total_cost_cents: number;
  net_margin_cents: number;
  margin_pct: number;
  is_actual: boolean;
  data_completeness: "complete" | "estimated_delivery" | "estimated_landed" | "standard_cost_only";
  invoiced_cases: number;
  invoiced_weight_kg: number;
}

export interface SdiTransmissionRecord {
  id: string;
  invoice_id: string;
  invoice_number: string;
  version: number;
  file_name: string;
  xml_content: string;
  xml_hash: string;
  provider: string;
  transmission_status: "generated" | "validated" | "validation_failed" | "transmitted" | "delivered" | "accepted" | "rejected" | "failed";
  validation_errors_json?: string | null;
  provider_transmission_id?: string | null;
  sdi_identifier?: string | null;
  sdi_notification_type?: string | null;
  sdi_notification_date?: string | null;
  sdi_raw_notification?: string | null;
  created_at: string;
  updated_at: string;
}

// Module 11 Exceptions and Recall re-exports
export * from "./exceptions-recall";

// Module 12 Management and AI re-exports
export * from "./management-ai";

