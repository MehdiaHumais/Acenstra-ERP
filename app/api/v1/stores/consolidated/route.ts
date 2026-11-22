import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { getDistributorConsolidatedDashboard } from "@/server/services/store-monitoring.service";

export async function GET(req: NextRequest) {
  try {
    const user = authorizeRequest(req, "stores.consolidated.read");
    const { searchParams } = new URL(req.url);
    const dashboard = getDistributorConsolidatedDashboard(user, {
      franchise_group: searchParams.get("franchise_group") || undefined,
      region: searchParams.get("region") || undefined,
      status: searchParams.get("status") || undefined,
      date_from: searchParams.get("date_from") || undefined,
      date_to: searchParams.get("date_to") || undefined,
    });
    return NextResponse.json(dashboard);
  } catch (err) {
    return handleApiError(err);
  }
}
