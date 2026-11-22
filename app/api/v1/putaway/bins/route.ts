import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { listWarehouseBins, listWarehouseZones, updateWarehouseBin } from "@/server/services/putaway.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "putaway.read");
    const url = new URL(req.url);
    const warehouse = url.searchParams.get("warehouse");
    const zones = listWarehouseZones(actor, warehouse);
    const bins = listWarehouseBins(actor, {
      warehouse,
      zone_code: url.searchParams.get("zone_code"),
      storage_type: url.searchParams.get("storage_type"),
      status: url.searchParams.get("status")
    });
    return NextResponse.json({ zones, bins });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "putaway.manage");
    const body = await parseJsonBody<
      Parameters<typeof updateWarehouseBin>[2] & { bin_id_or_code: string }
    >(req);
    const bin = updateWarehouseBin(actor, body.bin_id_or_code, body);
    return NextResponse.json({ bin });
  } catch (err) {
    return handleApiError(err);
  }
}
