import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import {
  createStockAdjustment,
  listStockAdjustments,
  StockAdjustmentRecord
} from "@/server/services/stock-intelligence.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "inventory:read");
    const sp = req.nextUrl.searchParams;
    const items = listStockAdjustments(actor, {
      warehouse: sp.get("warehouse"),
      status: sp.get("status"),
      lot: sp.get("lot"),
      sku: sp.get("sku")
    });
    return NextResponse.json({ items });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "inventory:adjust");
    const body = await parseJsonBody<{
      internal_lot: string;
      adjustment_type: StockAdjustmentRecord["adjustment_type"];
      actual_cases?: number;
      difference_cases?: number;
      actual_weight_kg?: number | null;
      target_bin_code?: string | null;
      reason?: string;
      reason_code?: string;
      reason_notes?: string;
      evidence?: string[];
      evidence_ref?: string;
      cycle_count_id?: string | null;
      auto_approve?: boolean;
      idempotency_key?: string | null;
    }>(req);

    return await withIdempotency(req, "/api/v1/inventory/adjustments", body, () => {
      const created = createStockAdjustment(actor, {
        ...body,
        reason: (body.reason || body.reason_notes || body.reason_code || "").trim(),
        evidence: body.evidence || (body.evidence_ref ? [body.evidence_ref] : [])
      });
      return { status: 201, body: created };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
