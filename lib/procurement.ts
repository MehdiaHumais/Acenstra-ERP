import type { Supplier } from "./types";

export type SupplierGrade = "A" | "B" | "C" | "D";
export type RfqStatus = "open" | "quoted" | "awarded" | "cancelled";
export type QuotationStatus = "received" | "selected" | "rejected";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface SupplierScorecard extends Supplier {
  po_count: number;
  received_po_count: number;
  open_po_count: number;
  on_time_receipts: number;
  late_receipts: number;
  rejected_receipts: number;
  spend_cents: number;
  landed_spend_cents: number;
  avg_lead_time_days: number;
  last_po_at: string | null;
  score: number;
  grade: SupplierGrade;
}

export interface LandedCostBreakdown {
  goods_cents: number;
  freight_cents: number;
  duty_cents: number;
  other_cents: number;
  landed_cost_cents: number;
  unit_landed_cost_cents: number;
}

export interface ProcurementQuotation {
  id: string;
  rfq_id: string;
  supplier_id: string;
  supplier_name: string;
  supplier_status: string;
  unit_cost_cents: number;
  freight_cents: number;
  duty_pct: number;
  other_cents: number;
  lead_time_days: number;
  valid_until: string | null;
  incoterm: string;
  notes: string | null;
  status: QuotationStatus;
  created_by: string;
  created_at: string;
  goods_cents: number;
  duty_cents: number;
  landed_cost_cents: number;
  unit_landed_cost_cents: number;
  rank: number | null;
  eligible: boolean;
  eligible_reason: string | null;
}

export interface ProcurementRfq {
  id: string;
  sku: string;
  product_name: string;
  quantity_cases: number;
  needed_by: string;
  incoterm: string;
  destination: string;
  status: RfqStatus;
  notes: string | null;
  created_by: string;
  created_at: string;
  quotations: ProcurementQuotation[];
  recommended_quotation_id: string | null;
  selected_quotation_id: string | null;
  best_landed_cost_cents: number | null;
}

export interface ProcurementPurchaseOrder {
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
  asn_reference: string | null;
  created_at: string;
  rfq_id: string | null;
  quotation_id: string | null;
  freight_cents: number;
  duty_cents: number;
  other_cents: number;
  landed_cost_cents: number | null;
  unit_landed_cost_cents: number | null;
  incoterm: string | null;
  approval_status: ApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  asn_carrier: string | null;
  asn_eta: string | null;
  asn_notes: string | null;
  asn_captured_at: string | null;
}

export function computeLandedCost(input: {
  quantity_cases: number;
  unit_cost_cents: number;
  freight_cents?: number;
  duty_pct?: number;
  other_cents?: number;
}): LandedCostBreakdown {
  const cases = Math.max(1, Math.round(Number(input.quantity_cases) || 1));
  const unitCost = Math.max(0, Math.round(Number(input.unit_cost_cents) || 0));
  const goods = cases * unitCost;
  const freight = Math.max(0, Math.round(Number(input.freight_cents) || 0));
  const dutyPct = Math.max(0, Number(input.duty_pct) || 0);
  const duty = Math.round((goods * dutyPct) / 100);
  const other = Math.max(0, Math.round(Number(input.other_cents) || 0));
  const landed = goods + freight + duty + other;
  return {
    goods_cents: goods,
    freight_cents: freight,
    duty_cents: duty,
    other_cents: other,
    landed_cost_cents: landed,
    unit_landed_cost_cents: Math.round(landed / cases),
  };
}

export function gradeForScore(score: number): SupplierGrade {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  return "D";
}

export function computeSupplierScore(input: {
  on_time_pct: number;
  quality_pct: number;
  price_variance_pct: number;
}): number {
  const onTime = Math.max(0, Math.min(100, Number(input.on_time_pct) || 0));
  const quality = Math.max(0, Math.min(100, Number(input.quality_pct) || 0));
  const variance = Math.max(0, Number(input.price_variance_pct) || 0);
  const priceScore = Math.max(0, Math.min(100, 100 - variance * 2));
  return Math.round(onTime * 0.4 + quality * 0.4 + priceScore * 0.2);
}

export function daysBetween(from: string, to: string): number {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}
