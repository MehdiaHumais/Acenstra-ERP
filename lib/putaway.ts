export type PutawayTaskStatus =
  | "Pending Recommendation"
  | "Ready for Put-away"
  | "Assigned"
  | "In Progress"
  | "Partially Completed"
  | "Completed"
  | "Blocked"
  | "Cancelled";

export type BinStatus = "active" | "inactive" | "blocked" | "restricted";

export interface WarehouseZoneRecord {
  id: string;
  code: string;
  warehouse: string;
  name: string;
  zone_type: "chilled" | "frozen" | "ambient" | "quarantine" | "staging";
  min_temp_c: number;
  max_temp_c: number;
  allowed_categories: string[];
  segregation_rules: string[];
  is_active: number;
  created_at: string;
}

export interface BinStockPlacement {
  id: string;
  bin_id: string;
  bin_code: string;
  warehouse: string;
  zone_code: string;
  internal_lot: string;
  supplier_batch: string;
  sku: string;
  product_name: string;
  category: string;
  quantity_cases: number;
  uom: string;
  weight_kg: number;
  packages: number;
  manufacture_date: string | null;
  expiry_date: string;
  quality_status: "released" | "on_hold" | "quarantined" | "rejected";
  temp_at_placement_c: number | null;
  placed_by: string;
  placed_at: string;
  updated_at: string;
}

export interface WarehouseBinRecord {
  id: string;
  code: string;
  barcode: string;
  warehouse: string;
  zone_id: string;
  zone_code: string;
  zone_name: string;
  storage_type: "chilled" | "frozen" | "ambient" | "quarantine";
  aisle: string;
  rack: string;
  shelf: string;
  position: string;
  min_temp_c: number;
  max_temp_c: number;
  max_cases: number;
  current_cases: number;
  available_cases: number;
  max_weight_kg: number;
  current_weight_kg: number;
  available_weight_kg: number;
  max_volume_m3: number;
  current_volume_m3: number;
  utilization_pct: number;
  allowed_categories: string[];
  restricted_allergens: string[];
  segregation_group: string;
  status: BinStatus;
  notes: string | null;
  lots?: BinStockPlacement[];
  updated_at: string;
}

export interface BinRecommendationCandidate {
  bin: WarehouseBinRecord;
  eligible: boolean;
  score: number;
  can_fit_full_batch: boolean;
  max_placeable_cases: number;
  reason: string;
  disqualify_reasons: string[];
}

export interface PutawayTask {
  id: string;
  task_number: string;
  inspection_id: string | null;
  shipment_id: string | null;
  shipment_reference: string | null;
  asn_reference: string | null;
  purchase_order_id: string | null;
  supplier_id: string | null;
  supplier_name: string;
  sku: string;
  product_name: string;
  category: string;
  supplier_batch: string;
  internal_lot: string;
  manufacture_date: string | null;
  expiry_date: string;
  warehouse: string;
  receiving_location: string;
  uom: string;
  total_eligible_qty: number;
  placed_qty: number;
  remaining_qty: number;
  expected_weight_kg: number;
  actual_weight_kg: number | null;
  placed_weight_kg: number;
  packages: number;
  temp_reading_c: number | null;
  temp_min_c: number;
  temp_max_c: number;
  temp_status: "in_range" | "warning" | "excursion";
  quality_status: "released" | "partially_released";
  recommended_zone_code: string | null;
  recommended_bin_code: string | null;
  recommendation_reason: string | null;
  recommendation_score: number | null;
  assigned_bin_code: string | null;
  override_reason: string | null;
  overridden_by: string | null;
  overridden_at: string | null;
  assigned_operator_id: string | null;
  assigned_operator_name: string | null;
  priority: "urgent" | "high" | "normal" | "low";
  status: PutawayTaskStatus;
  status_changed_by: string | null;
  status_changed_at: string | null;
  scan_task_verified: number;
  scan_sku_verified: number;
  scan_lot_verified: number;
  scan_bin_verified: number;
  notes: string | null;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
}

export interface PutawayPlacement {
  id: string;
  placement_number: string;
  task_id: string;
  task_number: string;
  internal_lot: string;
  supplier_batch: string;
  sku: string;
  product_name: string;
  warehouse: string;
  from_location: string;
  to_zone_code: string;
  to_bin_code: string;
  expected_qty: number;
  placed_qty: number;
  remaining_qty_after: number;
  uom: string;
  packages: number;
  expected_weight_kg: number;
  actual_weight_kg: number;
  weight_variance_kg: number;
  weight_variance_pct: number;
  discrepancy_notes: string | null;
  temp_c: number | null;
  temp_status: "in_range" | "warning" | "excursion";
  scan_method: "barcode_scan" | "manual_fallback";
  movement_id: string | null;
  operator_id: string;
  operator_name: string;
  placed_at: string;
}

export interface PutawayScanLog {
  id: string;
  task_id: string;
  scan_step: "task" | "sku" | "lot" | "bin";
  scanned_value: string;
  expected_value: string;
  scan_mode: "scanner" | "manual";
  valid: number;
  failure_reason: string | null;
  scanned_by: string;
  scanned_at: string;
}

export interface PutawayDashboardMetrics {
  pending_putaway_tasks: number;
  tasks_in_progress: number;
  completed_tasks: number;
  partially_completed_tasks: number;
  blocked_tasks: number;
  total_quantities_awaiting_placement: number;
  warehouse_bin_utilization_pct: number;
  active_bins_count: number;
  total_bins_count: number;
}

export interface PutawayTaskDetail extends PutawayTask {
  recommendations: BinRecommendationCandidate[];
  placements: PutawayPlacement[];
  scan_logs: PutawayScanLog[];
  lot_placements: BinStockPlacement[];
}
