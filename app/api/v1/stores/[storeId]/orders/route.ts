import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { getStorePurchaseOrderHistory } from "@/server/services/store-monitoring.service";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ storeId: string }> }
) {
  try {
    const user = authorizeRequest(req, "stores.read");
    const { storeId } = await context.params;
    const { searchParams } = new URL(req.url);
    const history = getStorePurchaseOrderHistory(user, storeId, {
      date_from: searchParams.get("date_from") || undefined,
      date_to: searchParams.get("date_to") || undefined,
      sku: searchParams.get("sku") || undefined,
      order_status: searchParams.get("order_status") || undefined,
      delivery_status: searchParams.get("delivery_status") || undefined,
      search: searchParams.get("search") || undefined,
    });
    return NextResponse.json(history);
  } catch (err) {
    return handleApiError(err);
  }
}
