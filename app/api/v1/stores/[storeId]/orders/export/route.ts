import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { exportStorePurchaseHistoryCsv } from "@/server/services/store-monitoring.service";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ storeId: string }> }
) {
  try {
    const user = authorizeRequest(req, "stores.export");
    const { storeId } = await context.params;
    const { searchParams } = new URL(req.url);
    const csv = exportStorePurchaseHistoryCsv(user, storeId, {
      date_from: searchParams.get("date_from") || undefined,
      date_to: searchParams.get("date_to") || undefined,
      sku: searchParams.get("sku") || undefined,
      order_status: searchParams.get("order_status") || undefined,
    });
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="store-${storeId}-purchase-history.csv"`,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
