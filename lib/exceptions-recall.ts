/**
 * Ascentra ERP - Module 11: Exceptions and Recall
 * TypeScript definitions for bidirectional batch traceability,
 * mass-balance reconciliation, quarantine enforcement, and recall lifecycle.
 */

export type ExceptionType =
  | "supplier_quality_issue"
  | "product_contamination_concern"
  | "temperature_excursion"
  | "expired_product"
  | "incorrect_labelling"
  | "packaging_defect"
  | "missing_traceability_data"
  | "failed_haccp_checkpoint"
  | "customer_complaint"
  | "delivery_damage"
  | "regulatory_safety_alert"
  | "foreign_material"
  | "other";

export type ExceptionSeverity = "critical" | "high" | "medium" | "low";

export type ExceptionInvestigationStatus =
  | "open"
  | "investigating"
  | "containment_active"
  | "capa_assigned"
  | "resolved"
  | "closed";

export type RecallRiskLevel = "class_1" | "class_2" | "class_3";

export type RecallStatus =
  | "draft"
  | "under_investigation"
  | "approved"
  | "active"
  | "customer_notification"
  | "recovery_in_progress"
  | "reconciliation"
  | "closed"
  | "cancelled";

export type QuarantineActionType =
  | "quarantine_hold"
  | "quarantine_release"
  | "scrap_destruction"
  | "supplier_return";

export type CustomerNotificationStatus =
  | "pending"
  | "draft"
  | "sent"
  | "acknowledged"
  | "response_received"
  | "failed";

export type CustomerRecoveryStatus =
  | "pending"
  | "scheduled"
  | "in_transit"
  | "recovered"
  | "disposed_at_site";

export interface ForwardTraceabilityTimelineEvent {
  stage:
    | "purchase_order"
    | "inbound_asn"
    | "receiving_inspection"
    | "haccp_temperature"
    | "putaway"
    | "stock_movement"
    | "order_allocation"
    | "picking_packing"
    | "loading_dispatch"
    | "delivery_pod"
    | "customer_invoicing"
    | "quarantine_action";
  timestamp: string;
  reference: string;
  title: string;
  location?: string;
  actor: string;
  status: "completed" | "verified" | "flagged" | "blocked" | "in_transit";
  details: Record<string, unknown>;
}

export interface ForwardTraceabilityResult {
  lot: {
    internal_lot: string;
    supplier_lot: string;
    sku: string;
    product_name: string;
    category: string;
    warehouse: string;
    current_location: string;
    current_zone: string;
    received_date: string;
    expiry_date: string;
    manufacture_date?: string | null;
    quality_status: string;
    quantity_cases: number;
    unit_weight_kg: number;
    catch_weight_kg?: number | null;
  };
  supplier: {
    id: string;
    name: string;
    origin_country: string;
    purchase_order_id: string;
    purchase_order_number: string;
    asn_reference: string;
    shipment_reference?: string;
    received_date: string;
  };
  inspection?: {
    inspection_id: string;
    inspection_number: string;
    receiving_location: string;
    visual_inspection: string;
    packaging_condition: string;
    product_condition: string;
    freshness_status: string;
    labelling_status: string;
    traceability_verified: boolean;
    temp_reading_c: number | null;
    temp_status: string;
    certificates_verified: boolean;
    haccp_readings: Array<{
      checkpoint_code: string;
      reading_value: string;
      status: string;
      verified_by: string;
    }>;
  };
  storage: {
    warehouse: string;
    zone: string;
    bin: string;
    current_cases: number;
    current_weight_kg: number;
    putaway_completed_at?: string;
  };
  movements: Array<{
    id: string;
    movement_type: string;
    quantity_delta: number;
    previous_cases: number;
    new_cases: number;
    reason: string;
    actor_email: string;
    created_at: string;
  }>;
  orders: Array<{
    order_id: string;
    order_number: string;
    customer_id: string;
    customer_name: string;
    allocated_cases: number;
    picked_cases: number;
    delivered_cases: number;
    catch_weight_kg: number;
    delivery_date: string;
    status: string;
  }>;
  deliveries: Array<{
    delivery_id: string;
    delivery_reference: string;
    order_number: string;
    customer_name: string;
    driver_name: string;
    vehicle_registration: string;
    status: string;
    departure_time: string | null;
    arrival_time: string | null;
    delivered_cases: number;
    delivered_weight_kg: number;
    temp_reading_c: number | null;
    is_temp_excursion: boolean;
    pod_signed: boolean;
    pod_recipient: string | null;
    pod_signed_at: string | null;
  }>;
  invoices: Array<{
    invoice_id: string;
    invoice_number: string;
    customer_name: string;
    total_cents: number;
    sdi_status: string;
    issued_date: string;
  }>;
  mass_balance: LotMassBalance;
  timeline: ForwardTraceabilityTimelineEvent[];
}

export interface BackwardTraceabilityQuery {
  customer_id?: string;
  order_number?: string;
  delivery_id?: string;
  invoice_number?: string;
  lot_id?: string;
}

export interface BackwardTraceabilityDeliveredProduct {
  sku: string;
  product_name: string;
  internal_lot: string;
  supplier_lot: string;
  delivered_cases: number;
  delivered_weight_kg: number;
  delivery_date: string;
  order_number?: string;
  delivery_id?: string;
  invoice_number?: string;
}

export interface BackwardTraceabilitySupplier {
  supplier_id: string;
  supplier_name: string;
  supplier_batch: string;
  internal_lot: string;
  sku: string;
  product_name: string;
  purchase_order_number: string;
  asn_reference: string;
  received_date: string;
  origin_country: string;
  inspection_status: string;
  receiving_temperature_c: number;
}

export interface OtherAffectedCustomer {
  customer_id: string;
  customer_name: string;
  order_number: string;
  delivery_id: string;
  delivered_date: string;
  delivered_cases: number;
  delivered_weight_kg: number;
  affected_lot: string;
  sku: string;
}

export interface CurrentPhysicalLocation {
  lot_id: string;
  sku: string;
  product_name: string;
  warehouse: string;
  zone_code: string;
  bin_code: string;
  quantity_cases: number;
  weight_kg: number;
  quality_status: string;
}

export interface BackwardTraceabilityResult {
  start_reference: {
    type: "customer" | "order" | "delivery" | "invoice" | "lot";
    identifier: string;
  };
  customer: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    address: string;
    delivery_address?: string;
    piva?: string | null;
  };
  delivered_products: BackwardTraceabilityDeliveredProduct[];
  suppliers: BackwardTraceabilitySupplier[];
  other_affected_customers: OtherAffectedCustomer[];
  current_physical_locations: CurrentPhysicalLocation[];
}

export interface LotMassBalance {
  lot_id: string;
  internal_lot?: string;
  sku: string;
  product_name: string;
  warehouse: string;
  received_cases: number;
  received_weight_kg: number;
  accepted_cases: number;
  accepted_weight_kg: number;
  rejected_cases: number;
  rejected_weight_kg: number;
  current_physical_cases: number;
  current_physical_weight_kg: number;
  available_cases: number;
  available_weight_kg: number;
  reserved_cases: number;
  reserved_weight_kg: number;
  quarantined_cases: number;
  quarantined_weight_kg: number;
  picked_cases: number;
  picked_weight_kg: number;
  dispatched_cases: number;
  dispatched_weight_kg: number;
  delivered_cases: number;
  delivered_weight_kg: number;
  returned_cases: number;
  returned_weight_kg: number;
  adjusted_cases: number;
  adjusted_weight_kg: number;
  unaccounted_variance_cases: number;
  unaccounted_variance_weight_kg: number;
  variance_percentage: number;
  reconciliation_status: "balanced" | "variance_flagged";
  reconciliation_notes?: string | null;
  is_catch_weight: boolean;
  catch_weight_unit?: string;
  last_reconciled_at?: string;
}

export interface QuarantineActionResult {
  action_id: string;
  action_number: string;
  lot_id: string;
  sku: string;
  previous_status: string;
  new_status: string;
  quarantined_cases: number;
  quarantined_weight_kg: number;
  quarantine_bin_code: string;
  blocked_reservations_count: number;
  action_timestamp: string;
  authorized_by: string;
}

export interface DetailedException {
  id: string;
  exception_number: string;
  inspection_id?: string | null;
  shipment_id?: string | null;
  shipment_reference?: string | null;
  supplier_id?: string | null;
  supplier_name?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  order_id?: string | null;
  order_number?: string | null;
  delivery_id?: string | null;
  sku: string;
  product_name: string;
  internal_lot: string;
  warehouse: string;
  location: string;
  exception_type: ExceptionType;
  severity: ExceptionSeverity;
  expected_limits: string;
  actual_reading: string;
  food_safety_impact: string;
  responsible_person: string;
  evidence_urls?: string[];
  evidence_json?: string;
  investigation_notes?: string | null;
  containment_actions?: string | null;
  resolution?: string | null;
  status: ExceptionInvestigationStatus;
  capa_id?: string | null;
  capa_number?: string | null;
  detected_at: string;
  resolved_by?: string | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecallCase {
  id: string;
  recall_number: string;
  title: string;
  classification: RecallRiskLevel;
  status: RecallStatus;
  reason_category: string;
  risk_assessment: string;
  affected_sku: string;
  product_name: string;
  affected_lot: string;
  supplier_batch?: string | null;
  supplier_id?: string | null;
  supplier_name?: string | null;
  warehouse: string;
  total_affected_cases: number;
  total_affected_weight_kg: number;
  recovered_cases: number;
  recovered_weight_kg: number;
  disposed_cases: number;
  disposed_weight_kg: number;
  recovery_percentage: number;
  affected_customers_count: number;
  notified_customers_count: number;
  acknowledged_customers_count: number;
  affected_customers: RecallAffectedCustomer[];
  recovery_logs: RecallRecoveryLog[];
  mass_balance?: LotMassBalance;
  initiated_by: {
    id: string;
    name: string;
    role: string;
  };
  initiated_at: string;
  approved_by?: {
    id: string;
    name: string;
    role: string;
  };
  approved_at?: string | null;
  target_recovery_date?: string | null;
  closed_by?: {
    id: string;
    name: string;
  };
  closed_at?: string | null;
  closure_notes?: string | null;
  capa_id?: string | null;
  regulatory_agency_notified: boolean;
  regulatory_agency_name?: string | null;
  regulatory_reference?: string | null;
  public_alert_issued: boolean;
  created_at: string;
  updated_at: string;
}

export interface RecallAffectedCustomer {
  id: string;
  recall_id: string;
  customer_id: string;
  customer_name: string;
  customer_contact?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  order_id?: string | null;
  order_number: string;
  delivery_id?: string | null;
  delivery_reference?: string | null;
  invoice_id?: string | null;
  invoice_number?: string | null;
  delivered_date: string;
  delivered_cases: number;
  delivered_weight_kg: number;
  notification_status: CustomerNotificationStatus;
  notified_at?: string | null;
  acknowledged_at?: string | null;
  recovered_cases: number;
  recovered_weight_kg: number;
  disposed_by_customer_cases: number;
  remaining_unrecovered_cases: number;
  notes?: string | null;
}

export interface QuarantineActionRecord {
  id: string;
  action_number: string;
  recall_id?: string | null;
  exception_id?: string | null;
  internal_lot: string;
  sku: string;
  warehouse: string;
  zone?: string | null;
  bin_location?: string | null;
  cases_blocked: number;
  weight_kg_blocked: number;
  action_type: QuarantineActionType;
  reason: string;
  authorized_by: string;
  created_at: string;
}

export interface RecallRecoveryLog {
  id: string;
  recall_id: string;
  affected_customer_id?: string | null;
  customer_id: string;
  customer_name: string;
  order_number: string;
  lot_id: string;
  recovered_cases: number;
  recovered_weight_kg: number;
  action_type: "returned_to_warehouse" | "customer_destruction_certified" | "warehouse_destruction" | "sample_testing" | string;
  receipt_warehouse: string;
  quarantine_bin_code: string;
  destruction_certificate_ref?: string | null;
  seal_number?: string | null;
  carrier?: string | null;
  vehicle_reg?: string | null;
  condition_on_receipt?: string | null;
  temp_c?: number;
  received_by: {
    id: string;
    name: string;
  };
  received_at: string;
  verified_by_qa?: {
    id: string;
    name: string;
  };
  verified_at?: string | null;
  notes?: string | null;
}

export interface RecallNotification {
  id: string;
  recall_id: string;
  customer_id: string;
  customer_name: string;
  channel: "email" | "portal" | "certified_mail" | "phone" | string;
  recipient_contact: string;
  subject: string;
  body_content: string;
  sent_at: string;
  sent_by: string;
  acknowledgment_status: "sent" | "opened" | "acknowledged" | "responded";
  acknowledged_at?: string | null;
  response_text?: string | null;
}

export interface FinalRecallReport {
  report_reference: string;
  generated_at: string;
  generated_by: {
    id: string;
    name: string;
    role: string;
  };
  recall_case: RecallCase;
  mass_balance_reconciliation: LotMassBalance;
  customer_effectiveness: {
    total_customers_affected: number;
    notified_count: number;
    acknowledged_count: number;
    total_delivered_cases: number;
    total_recovered_cases: number;
    total_disposed_cases: number;
    total_unaccounted_cases: number;
    recovery_effectiveness_pct: number;
  };
  regulatory_compliance: {
    framework: string;
    authority_notified: boolean;
    authority_name: string;
    authority_reference: string;
    traceability_guarantee: string;
    conclusion: string;
  };
}
