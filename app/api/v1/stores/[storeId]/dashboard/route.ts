import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { getStoreDashboard } from "@/server/services/store-monitoring.service";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ storeId: string }> }
) {
  try {
    const user = authorizeRequest(req, "stores.read");
    const { storeId } = await context.params;
    const { searchParams } = new URL(req.url);
    const dashboard = getStoreDashboard(user, storeId, {
      date_from: searchParams.get("date_from") || searchParams.get("period_start") || undefined,
      date_to: searchParams.get("date_to") || searchParams.get("period_end") || undefined,
    });
    return NextResponse.json({ dashboard });
  } catch (err) {
    return handleApiError(err);
  }
}
