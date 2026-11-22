import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { compareStoresAndProducts } from "@/server/services/store-monitoring.service";

export async function GET(req: NextRequest) {
  try {
    const user = authorizeRequest(req, "stores.consolidated.read");
    const { searchParams } = new URL(req.url);
    const storeA = searchParams.get("store_a_id") || "STR-MIL-01";
    const storeB = searchParams.get("store_b_id") || "STR-MIL-02";
    const comparison = compareStoresAndProducts(user, {
      store_a_id: storeA,
      store_b_id: storeB,
      date_from: searchParams.get("date_from") || undefined,
      date_to: searchParams.get("date_to") || undefined,
    });
    return NextResponse.json(comparison);
  } catch (err) {
    return handleApiError(err);
  }
}
