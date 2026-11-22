import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { generateLabels } from "@/server/services/picking-packing.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "warehouse:read");
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id") || searchParams.get("order_id") || searchParams.get("order_number") || searchParams.get("sscc");

    if (!id) {
      return NextResponse.json({ error: "id, order_id or order_number query parameter is required" }, { status: 400 });
    }

    const labelData = generateLabels(actor, id);
    return NextResponse.json({ ...labelData, labels: labelData });
  } catch (err) {
    return handleApiError(err);
  }
}
