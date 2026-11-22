/**
 * Ascentra ERP - Module 12: Management and AI
 * Type definitions for CEO Dashboard, BI Reporting, Statistical Forecasting,
 * Anomaly Detection, Replenishment Engine, and Governed AI Actions.
 */

import { AuthenticatedUser } from "@/server/security/auth";

// ----------------------------------------------------------------------------
// 1. CEO DASHBOARD & EXECUTIVE KPIS
// ----------------------------------------------------------------------------

export interface SalesKpis {
  total_revenue_cents: number;
  total_orders_count: number;
  average_order_value_cents: number;
  active_customers_count: number;
  sales_growth_pct: number;
  outstanding_receivables_cents: number;
  top_customers: Array<{
    customer_id: string;
    customer_name: string;
    segment: string;
    order_count: number;
    total_sales_cents: number;
    outstanding_cents: number;
  }>;
  top_products: Array<{
    sku: string;
    product_name: string;
    category: string;
    cases_sold: number;
    total_revenue_cents: number;
    margin_pct: number;
  }>;
}

export interface InventoryKpis {
  total_stock_value_cents: number;
  total_physical_cases: number;
  available_cases: number;
  reserved_cases: number;
  quarantined_cases: number;
  held_cases: number;
  expiring_within_7d_cases: number;
  expiring_within_7d_value_cents: number;
  stock_turnover_ratio: number;
  warehouse_utilization_pct: number;
  total_bins_count: number;
  occupied_bins_count: number;
  slow_moving_skus_count: number;
  slow_moving_inventory: Array<{
    sku: string;
    product_name: string;
    warehouse: string;
    cases_on_hand: number;
    days_since_last_movement: number;
    value_cents: number;
  }>;
}

export interface ProcurementKpis {
  total_po_spend_cents: number;
  total_purchase_orders: number;
  active_suppliers_count: number;
  supplier_on_time_rate_pct: number;
  supplier_quality_pass_pct: number;
  avg_delivery_delay_days: number;
  price_variance_pct: number;
  supplier_performance: Array<{
    supplier_id: string;
    supplier_name: string;
    po_count: number;
    total_spend_cents: number;
    on_time_pct: number;
    rejection_rate_pct: number;
    quality_issues_count: number;
  }>;
}

export interface OperationsKpis {
  total_pick_tasks: number;
  picked_tasks: number;
  picking_completion_pct: number;
  packing_completion_pct: number;
  total_deliveries: number;
  delivered_deliveries: number;
  on_time_delivery_rate_pct: number;
  vehicle_capacity_utilization_pct: number;
  order_fulfillment_fill_rate_pct: number;
  active_vehicles_count: number;
  active_drivers_count: number;
}

export interface QualityComplianceKpis {
  failed_haccp_checkpoints: number;
  open_quality_exceptions: number;
  critical_exceptions: number;
  total_rejected_cases: number;
  temperature_excursions: number;
  open_capas_count: number;
  active_recalls_count: number;
  recall_recovery_rate_pct: number;
}

export interface FinanceKpis {
  gross_revenue_cents: number;
  gross_margin_cents: number;
  gross_margin_pct: number;
  delivered_margin_cents: number;
  delivered_margin_pct: number;
  total_landed_cost_cents: number;
  total_invoiced_cents: number;
  outstanding_invoices_cents: number;
  overdue_receivables_cents: number;
  collection_rate_pct: number;
  dso_days: number;
}

export interface CeoDashboardKpis {
  calculated_at: string;
  period_days: number;
  warehouse_filter: string | null;
  sales: SalesKpis;
  inventory: InventoryKpis;
  procurement: ProcurementKpis;
  operations: OperationsKpis;
  quality: QualityComplianceKpis;
  finance: FinanceKpis;
}

// ----------------------------------------------------------------------------
// 2. BUSINESS INTELLIGENCE & REPORTING
// ----------------------------------------------------------------------------

export interface BiReportFilter {
  date_from?: string;
  date_to?: string;
  customer_id?: string;
  supplier_id?: string;
  sku?: string;
  warehouse?: string;
  order_status?: string;
  delivery_status?: string;
  dimension?: "customer" | "product" | "supplier" | "warehouse" | "month";
}

export interface BiReportRow {
  dimension_key: string;
  dimension_label: string;
  order_count: number;
  cases_sold: number;
  revenue_cents: number;
  cogs_cents: number;
  landed_cost_cents: number;
  gross_margin_cents: number;
  gross_margin_pct: number;
  delivered_margin_cents: number;
  delivered_margin_pct: number;
  quality_exceptions_count: number;
  on_time_rate_pct: number;
}

export interface BiReportSummary {
  period: { from: string; to: string };
  filter_applied: BiReportFilter;
  totals: {
    total_orders: number;
    total_cases: number;
    total_revenue_cents: number;
    total_cogs_cents: number;
    total_gross_margin_cents: number;
    average_gross_margin_pct: number;
    total_delivered_margin_cents: number;
    average_delivered_margin_pct: number;
  };
  rows: BiReportRow[];
}

// ----------------------------------------------------------------------------
// 3. STATISTICAL & PREDICTIVE FORECASTING
// ----------------------------------------------------------------------------

export type ForecastConfidence = "high" | "medium" | "low" | "insufficient_history";

export interface DemandForecast {
  sku: string;
  product_name: string;
  category: string;
  warehouse: string;
  forecast_period_days: number;
  historical_data_points: number;
  data_coverage: ForecastConfidence;
  assumptions: string[];
  daily_demand_mean_cases: number;
  projected_demand_cases: number;
  confidence_level_pct: number;
  lower_bound_cases: number;
  upper_bound_cases: number;
  seasonal_index: number;
  current_available_cases: number;
  days_of_supply_remaining: number;
  projected_stockout_date: string | null;
  depletion_risk: "immediate" | "high" | "moderate" | "safe";
  influencing_factors: string[];
  model_used: "rolling_exponential_smoothing" | "linear_trend_decomposition" | "baseline_moving_average" | "insufficient_data_heuristic";
  calculated_at: string;
}

// ----------------------------------------------------------------------------
// 4. OPERATIONAL ANOMALY DETECTION
// ----------------------------------------------------------------------------

export type AnomalyType =
  | "sudden_stock_discrepancy"
  | "unusual_inventory_adjustment"
  | "unexpected_purchase_price_change"
  | "abnormal_supplier_rejection_rate"
  | "repeated_temperature_excursions"
  | "unusual_order_volume"
  | "unexpected_margin_drop"
  | "suspicious_payment_delay"
  | "unusual_delivery_delay"
  | "repeated_capa_failure";

export type AnomalySeverity = "info" | "warning" | "critical";

export type AnomalyReviewStatus = "detected" | "under_review" | "acknowledged" | "resolved" | "dismissed";

export interface OperationalAnomaly {
  id: string;
  anomaly_number: string;
  anomaly_type: AnomalyType;
  severity: AnomalySeverity;
  category: "inventory" | "procurement" | "operations" | "quality" | "finance";
  title: string;
  explanation: string;
  supporting_data: Record<string, any>;
  related_entity_type: "inventory_lots" | "purchase_orders" | "sales_orders" | "deliveries" | "quality_exceptions" | "invoices" | "customers" | "suppliers";
  related_entity_id: string;
  suggested_investigation: string;
  review_status: AnomalyReviewStatus;
  fingerprint: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_notes?: string | null;
  detected_at: string;
}

// ----------------------------------------------------------------------------
// 5. STOCK REPLENISHMENT SUGGESTIONS
// ----------------------------------------------------------------------------

export interface ReplenishmentSuggestion {
  sku: string;
  product_name: string;
  category: string;
  warehouse: string;
  current_available_cases: number;
  reserved_cases: number;
  quarantined_cases: number;
  daily_demand_run_rate: number;
  days_of_supply: number;
  reorder_point_cases: number;
  safety_stock_cases: number;
  open_po_cases: number;
  recommended_order_cases: number;
  suggested_reorder_cases?: number;
  unit_cost_cents: number;
  estimated_order_value_cents: number;
  estimated_cost_cents: number;
  preferred_supplier_id?: string | null;
  preferred_supplier_name?: string | null;
  supplier_lead_time_days: number;
  shelf_life_days: number;
  estimated_stockout_date: string | null;
  priority: "urgent" | "high" | "medium" | "routine";
  recommendation_reason: string;
  action_proposed: boolean;
  linked_ai_action_id?: string | null;
}

// ----------------------------------------------------------------------------
// 6. GOVERNED AI ACTIONS & MAKER-CHECKER WORKFLOW
// ----------------------------------------------------------------------------

export type GovernedActionType =
  | "create_replenishment_po"
  | "create_purchase_order"
  | "quarantine_risk_lot"
  | "quarantine_lot"
  | "adjust_safety_stock"
  | "create_supplier_capa"
  | "initiate_capa"
  | "flag_customer_credit_hold"
  | "credit_hold_customer"
  | "release_quarantine_lot"
  | "release_quarantine";

export type GovernedActionRisk = "low" | "medium" | "high" | "critical";

export type GovernedActionApprovalStatus =
  | "proposed"
  | "under_review"
  | "approved"
  | "rejected"
  | "executed";

export type AiActionStatus = GovernedActionApprovalStatus;

export type GovernedActionExecutionStatus = "pending" | "executed" | "failed";

export interface GovernedAiAction {
  id: string;
  action_reference: string;
  action_number: string;
  provider: string;
  model: string;
  model_version?: string;
  action_type: GovernedActionType;
  risk_level: GovernedActionRisk;
  target_entity_type: string;
  target_entity?: string;
  target_entity_id: string;
  target_id?: string;
  recommendation_text: string;
  summary?: string;
  rationale?: string;
  proposed_payload: Record<string, any>;
  parameters?: Record<string, any>;
  validation_status: "valid" | "validation_failed";
  validation_notes?: string | null;
  approval_status: GovernedActionApprovalStatus;
  requested_by_id: string;
  requested_by_name: string;
  approved_by_id?: string | null;
  approved_by_name?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  rejection_reason?: string | null;
  execution_status: GovernedActionExecutionStatus;
  execution_result?: Record<string, any> | null;
  executed_at?: string | null;
  created_at: string;
}

export interface ProposeAiActionInput {
  action_type: GovernedActionType;
  risk_level?: GovernedActionRisk;
  target_entity_type: string;
  target_entity_id: string;
  recommendation_text: string;
  proposed_payload: Record<string, any>;
}

// ----------------------------------------------------------------------------
// 7. AI PROVIDER INTERFACES
// ----------------------------------------------------------------------------

export interface AiNarrativeInsight {
  headline: string;
  domain: "sales" | "inventory" | "procurement" | "quality" | "finance";
  tone: "positive" | "neutral" | "warning" | "critical";
  observation: string;
  root_cause_hypothesis: string;
  recommended_management_action: string;
  confidence_score: number;
}

export interface AiAnalysisResponse {
  provider: string;
  model: string;
  generated_at: string;
  headline: string;
  executive_summary: string;
  key_highlights: string[];
  recommended_actions: string[];
  insights: AiNarrativeInsight[];
  proposals_count: number;
  raw_tokens_used?: number;
}
