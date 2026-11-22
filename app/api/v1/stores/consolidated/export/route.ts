import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { exportConsolidatedStoresCsv } from "@/server/services/store-monitoring.service";

export async function GET(req: NextRequest) {
  try {
    const user = authorizeRequest(req, "stores.export");
    const { searchParams } = new URL(req.url);
    const csv = exportConsolidatedStoresCsv(user, {
      franchise_group: searchParams.get("franchise_group") || undefined,
      region: searchParams.get("region") || undefined,
      status: searchParams.get("status") || undefined,
    });
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="distributor-consolidated-stores.csv"',
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
