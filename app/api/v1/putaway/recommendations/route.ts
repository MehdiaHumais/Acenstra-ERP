import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { requireWarehouseAccess } from "@/server/security/auth";
import { computeBinRecommendations } from "@/server/services/putaway.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "putaway.read");
    const url = new URL(req.url);
    const warehouse = url.searchParams.get("warehouse") || "Milan Cold Hub";
    const sku = url.searchParams.get("sku") || "SKU-ATLANT-001";
    const qty = Number(url.searchParams.get("qty") || 10);
    const weightKg = url.searchParams.get("weight_kg") ? Number(url.searchParams.get("weight_kg")) : null;

    requireWarehouseAccess(actor, warehouse);
    const recommendations = computeBinRecommendations(warehouse, sku, qty, weightKg);
    return NextResponse.json({
      warehouse,
      sku,
      qty,
      recommendations
    });
  } catch (err) {
    return handleApiError(err);
  }
}
