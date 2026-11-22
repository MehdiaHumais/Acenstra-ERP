import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import {
  listMultiLevelStockLots,
  listShelfLifeRules,
  upsertShelfLifeRule
} from "@/server/services/stock-intelligence.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "inventory:read");
    const warehouse = req.nextUrl.searchParams.get("warehouse");
    const rules = listShelfLifeRules(actor);
    const lots = listMultiLevelStockLots(actor, { warehouse });
    const alerts = lots.filter((l) => l.shelf_life_alert !== "ok" && l.physical_cases > 0);

    return NextResponse.json({
      rules,
      alerts
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "inventory:adjust");
    const body = await parseJsonBody<{
      id?: string;
      rule_code?: string;
      rule_scope: "product" | "customer" | "customer_product" | "segment";
      sku?: string | null;
      product_name?: string | null;
      category?: string | null;
      customer_id?: string | null;
      customer_name?: string | null;
      customer_segment?: string | null;
      min_remaining_days: number;
      min_remaining_pct?: number | null;
      enforce_at_allocation?: boolean;
      enforce_at_pick?: boolean;
      allow_manager_override?: boolean;
      notes?: string | null;
      active?: boolean;
    }>(req);

    const rule = upsertShelfLifeRule(actor, body);
    return NextResponse.json(rule, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
