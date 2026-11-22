import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { getBiReport } from "@/server/services/management-ai.service";
import { BiReportFilter } from "@/lib/management-ai";

export async function GET(req: NextRequest) {
  try {
    const user = authorizeRequest(req, "reports.executive.read");
    const { searchParams } = new URL(req.url);

    const dimensionParam = searchParams.get("dimension") || searchParams.get("group_by") || "customer";
    const validDimensions = ["customer", "product", "supplier", "warehouse", "month"];
    const dimension = validDimensions.includes(dimensionParam) ? (dimensionParam as any) : "customer";

    const filter: BiReportFilter = {
      date_from: searchParams.get("date_from") || searchParams.get("start_date") || undefined,
      date_to: searchParams.get("date_to") || searchParams.get("end_date") || undefined,
      customer_id: searchParams.get("customer_id") || undefined,
      supplier_id: searchParams.get("supplier_id") || undefined,
      sku: searchParams.get("sku") || searchParams.get("product_id") || undefined,
      warehouse: searchParams.get("warehouse") || undefined,
      dimension,
    };

    const report = getBiReport(filter, user);
    return NextResponse.json({ report });
  } catch (err) {
    return handleApiError(err);
  }
}
