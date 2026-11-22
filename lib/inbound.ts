export type InboundShipmentStatus =
  | "expected"
  | "confirmed"
  | "in_transit"
  | "arrived"
  | "unloading"
  | "under_inspection"
  | "accepted"
  | "partially_accepted"
  | "rejected"
  | "quarantined"
  | "completed"
  | "cancelled";

export type InboundDocumentStatus = "missing" | "pending_review" | "verified" | "rejected" | "expired";

export interface InboundShipment {
  id: string;
  shipment_ref: string;
  supplier_id: string | null;
  supplier_name: string;
  po_id: string | null;
  po_number: string | null;
  asn_reference: string | null;
  carrier: string | null;
  vehicle_reg: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  expected_arrival: string | null;
  actual_arrival: string | null;
  origin_warehouse: string | null;
  destination_warehouse: string;
  status: InboundShipmentStatus;
  transport_notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface InboundShipmentItem {
  id: string;
  shipment_id: string;
  sku: string;
  product_name: string;
  ordered_qty: number;
  ordered_uom: string | null;
  received_qty: number;
  accepted_qty: number;
  rejected_qty: number;
  damaged_qty: number;
  actual_weight: number | null;
  expected_weight: number | null;
  weight_uom: string | null;
  weight_variance_pct: number | null;
  weight_discrepancy_status: string | null;
  scale_reference: string | null;
  weight_tolerance_pct: number | null;
  packages: number;
  notes: string | null;
  discrepancy_status: string | null;
  created_at: string;
  updated_at: string;
}

export interface InboundBatch {
  id: string;
  shipment_id: string;
  item_id: string | null;
  sku: string;
  product_name: string;
  supplier_batch: string;
  internal_lot: string;
  supplier_id: string | null;
  supplier_name: string | null;
  po_id: string | null;
  po_number: string | null;
  manufacture_date: string | null;
  expiry_date: string;
  received_date: string;
  origin: string | null;
  quantity: number;
  unit: string;
  storage: string | null;
  status: string;
  accepted_qty: number;
  rejected_qty: number;
  quarantined_qty: number;
  created_at: string;
}

export interface InboundTemperatureLog {
  id: string;
  shipment_id: string;
  sku: string | null;
  temp_c: number;
  unit: string;
  min_c: number;
  max_c: number;
  recorded_at: string;
  recorded_by: string;
  verified_by: string | null;
  excursion: boolean;
  notes: string | null;
  evidence_ref: string | null;
  created_at: string;
}

export interface InboundDocument {
  id: string;
  shipment_id: string;
  sku: string | null;
  doc_type: string;
  reference_number: string | null;
  issuer: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  status: InboundDocumentStatus;
  verified_by: string | null;
  verified_at: string | null;
  review_notes: string | null;
  uploaded_by: string;
  uploaded_at: string;
}

export interface InboundQualityCheck {
  id: string;
  shipment_id: string;
  item_id: string | null;
  check_type: string;
  result: string;
  notes: string | null;
  evidence: string | null;
  performed_by: string;
  performed_at: string;
}

export interface InboundShipmentExceptions {
  temp_excursions: number;
  expired_documents: number;
  rejected_documents: number;
  unverified_documents: number;
  missing_documents: boolean;
  qty_discrepancies: number;
  weight_discrepancies: number;
  failed_quality_checks: number;
}

export interface InboundShipmentDetail {
  shipment: InboundShipment;
  items: InboundShipmentItem[];
  batches: InboundBatch[];
  temperature_logs: InboundTemperatureLog[];
  documents: InboundDocument[];
  quality_checks: InboundQualityCheck[];
  exceptions?: InboundShipmentExceptions;
}

export const INBOUND_QUALITY_CHECK_TYPES = [
  "visual",
  "packaging",
  "product_condition",
  "temperature_compliance",
  "weight_compliance",
  "quantity_compliance",
  "batch_expiry",
  "certificate_verification",
  "contamination_damage",
] as const;

export const INBOUND_SHIPMENT_STATUSES: InboundShipmentStatus[] = [
  "expected",
  "confirmed",
  "in_transit",
  "arrived",
  "unloading",
  "under_inspection",
  "accepted",
  "partially_accepted",
  "rejected",
  "quarantined",
  "completed",
  "cancelled",
];

export const INBOUND_DOCUMENT_TYPES = [
  "coa",
  "health_certificate",
  "veterinary_certificate",
  "food_safety_certificate",
  "supplier_quality_certificate",
  "product_specification",
  "temperature_report",
  "delivery_note",
  "other",
] as const;

export function inboundStatusTone(status: string): "ok" | "warning" | "critical" | "neutral" | "info" {
  if (status === "accepted" || status === "completed") return "ok";
  if (status === "partially_accepted") return "info";
  if (status === "rejected" || status === "quarantined" || status === "cancelled") return "critical";
  if (status === "under_inspection" || status === "unloading" || status === "arrived") return "warning";
  return "neutral";
}

export function calculateDiscrepancy(ordered: number, received: number): { delta: number; status: string } {
  const delta = Math.round((received - ordered) * 1000) / 1000;
  if (delta === 0) return { delta, status: "match" };
  if (received === 0) return { delta, status: "missing" };
  if (received < ordered) return { delta, status: "short" };
  return { delta, status: "excess" };
}
