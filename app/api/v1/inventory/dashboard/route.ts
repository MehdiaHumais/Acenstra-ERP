import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import {
  getStockIntelligenceDashboard,
  listMultiLevelStockLots
} from "@/server/services/stock-intelligence.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "inventory:read");
    const sp = req.nextUrl.searchParams;
    const warehouse = sp.get("warehouse");
    const zone = sp.get("zone");
    const bin = sp.get("bin");
    const sku = sp.get("sku");
    const status = sp.get("status");
    const search = sp.get("search");

    const dashboard = getStockIntelligenceDashboard(actor, warehouse, sku);
    const lots = listMultiLevelStockLots(actor, {
      warehouse,
      zone,
      bin,
      sku,
      status,
      search
    });

    return NextResponse.json({
      ...dashboard,
      lots
    });
  } catch (err) {
    return handleApiError(err);
  }
}
