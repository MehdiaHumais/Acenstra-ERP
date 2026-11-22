import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import {
  assignStagingLane,
  getDispatchStagingStatus
} from "@/server/services/picking-packing.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "warehouse:read");
    const { searchParams } = new URL(req.url);
    const warehouse = searchParams.get("warehouse") || undefined;

    const status = getDispatchStagingStatus(actor, warehouse);
    return NextResponse.json(status);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "warehouse:update");
    const body = await parseJsonBody<{
      packing_id: string;
      staging_lane_code: string;
      scanned_lane_barcode: string;
    }>(req);

    return await withIdempotency(req, "/api/v1/picking/staging", body, () => {
      const res = assignStagingLane(actor, body);
      return { status: 200, body: res };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
