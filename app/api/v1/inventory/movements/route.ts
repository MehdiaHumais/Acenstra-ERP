import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { listStockMovements } from "@/server/services/stock-intelligence.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "inventory:read");
    const sp = req.nextUrl.searchParams;
    const result = listStockMovements(actor, {
      warehouse: sp.get("warehouse"),
      sku: sp.get("sku"),
      lot: sp.get("lot") || sp.get("lot_number"),
      movement_type: sp.get("movement_type"),
      search: sp.get("search"),
      page: sp.get("page") ? Number(sp.get("page")) : 1,
      page_size: sp.get("page_size") ? Number(sp.get("page_size")) : 25
    });
    return NextResponse.json({ ...result, movements: result.items });
  } catch (err) {
    return handleApiError(err);
  }
}
