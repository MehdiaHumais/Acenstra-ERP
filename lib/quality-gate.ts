export type InspectionStatus = "pending" | "on_hold" | "released" | "partially_released" | "rejected" | "quarantined";
export type CheckResultStatus = "pending" | "pass" | "fail" | "na";

export interface EvidenceItem {
  id: string;
  title: string;
  file_type: "photo" | "document" | "temperature_log" | "certificate" | "lab_report";
  file_url: string;
  uploaded_by: string;
  uploaded_at: string;
  notes?: string | null;
}

export interface QualityInspection {
  id: string;
  inspection_number: string;
  shipment_id: string | null;
  shipment_reference: string | null;
  asn_reference: string | null;
  purchase_order_id: string | null;
  supplier_id: string | null;
  supplier_name: string;
  product_id: string | null;
  sku: string;
  product_name: string;
  supplier_batch: string;
  internal_lot: string;
  warehouse: string;
  receiving_location: string;
  uom: string;
  received_qty: number;
  accepted_qty: number;
  held_qty: number;
  rejected_qty: number;
  quarantined_qty: number;
  expected_weight_kg: number | null;
  actual_weight_kg: number | null;
  weight_verified: number;
  quantity_verified: number;
  manufacture_date: string | null;
  expiry_date: string;
  visual_inspection: CheckResultStatus;
  packaging_condition: CheckResultStatus;
  product_condition: CheckResultStatus;
  freshness_status: CheckResultStatus;
  labelling_status: CheckResultStatus;
  traceability_verified: number;
  temp_reading_c: number | null;
  temp_min_c: number | null;
  temp_max_c: number | null;
  temp_status: CheckResultStatus;
  certificates_verified: number;
  required_certificates: string[];
  evidence: EvidenceItem[];
  notes: string | null;
  status: InspectionStatus;
  decision_reason: string | null;
  inspector_id: string | null;
  inspector_name: string | null;
  inspected_at: string | null;
  decided_by_id: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface HaccpCheckpointTemplate {
  id: string;
  code: string;
  checkpoint_name: string;
  description: string;
  ccp_classification: string;
  is_ccp: number;
  category: string | null;
  sku: string | null;
  temp_zone: string | null;
  measurement_type: "temperature" | "numeric" | "boolean" | "condition";
  min_limit: number | null;
  max_limit: number | null;
  unit: string | null;
  expected_text: string | null;
  active: number;
  created_at: string;
}

export interface HaccpCheckpointReading {
  id: string;
  inspection_id: string;
  shipment_id: string | null;
  template_id: string | null;
  checkpoint_code: string;
  checkpoint_name: string;
  description: string | null;
  ccp_classification: string;
  is_ccp: number;
  sku: string;
  internal_lot: string;
  min_limit: number | null;
  max_limit: number | null;
  unit: string | null;
  expected_text: string | null;
  actual_numeric: number | null;
  actual_text: string | null;
  status: "pass" | "fail";
  critical_violation: number;
  evidence: EvidenceItem[];
  notes: string | null;
  inspector_id: string;
  inspector_name: string;
  recorded_at: string;
}

export interface QualityException {
  id: string;
  exception_number: string;
  inspection_id: string | null;
  shipment_id: string | null;
  shipment_reference: string | null;
  haccp_reading_id: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  sku: string;
  product_name: string;
  internal_lot: string;
  warehouse: string;
  location: string;
  exception_type: "temperature_excursion" | "haccp_failure" | "packaging_damage" | "contamination_risk" | "labelling_error" | "certificate_missing" | "expiry_violation" | "other";
  severity: "critical" | "high" | "medium" | "low";
  expected_limits: string;
  actual_reading: string;
  food_safety_impact: string;
  responsible_person: string;
  evidence: EvidenceItem[];
  investigation_notes: string | null;
  resolution: string | null;
  status: "open" | "investigating" | "capa_assigned" | "resolved" | "closed";
  detected_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export type CapaStatus = "Open" | "In Progress" | "Pending Verification" | "Closed" | "Rejected";

export interface QualityCapa {
  id: string;
  capa_number: string;
  exception_id: string | null;
  inspection_id: string | null;
  shipment_id: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  sku: string | null;
  product_name: string | null;
  internal_lot: string | null;
  warehouse: string;
  problem_description: string;
  root_cause: string | null;
  containment_action: string | null;
  corrective_action: string | null;
  preventive_action: string | null;
  assigned_to_id: string | null;
  assigned_to_name: string;
  target_completion_date: string;
  evidence: EvidenceItem[];
  verification_notes: string | null;
  effectiveness_review: string | null;
  verified_by_id: string | null;
  verified_by_name: string | null;
  verified_at: string | null;
  status: CapaStatus;
  is_overdue?: boolean;
  closed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface QualityDashboardMetrics {
  pending_inspections: number;
  goods_on_hold_cases: number;
  released_cases: number;
  rejected_cases: number;
  quarantined_cases: number;
  failed_haccp_checkpoints: number;
  open_quality_exceptions: number;
  overdue_capas: number;
  total_capas_open: number;
}

export interface QualityInspectionDetail extends QualityInspection {
  haccp_readings: HaccpCheckpointReading[];
  exceptions: QualityException[];
  capas: QualityCapa[];
  lot_record: Record<string, unknown> | null;
  audit_events: Array<{
    id: string;
    action: string;
    actor_email: string;
    actor_role: string;
    before_json: string | null;
    after_json: string | null;
    created_at: string;
  }>;
}

export interface QualityHistorySummary {
  query: {
    lot?: string | null;
    supplier_id?: string | null;
    sku?: string | null;
  };
  inspections: QualityInspection[];
  haccp_readings: HaccpCheckpointReading[];
  exceptions: QualityException[];
  capas: QualityCapa[];
  stats: {
    total_inspections: number;
    released_count: number;
    rejected_count: number;
    on_hold_count: number;
    quarantined_count: number;
    haccp_pass_rate_pct: number;
    recurring_exception_count: number;
    open_capa_count: number;
  };
}
