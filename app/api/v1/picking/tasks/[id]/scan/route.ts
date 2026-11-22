import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { verifyPickScan } from "@/server/services/picking-packing.service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = authorizeRequest(req, "warehouse:update");
    const { id } = await params;
    const body = await parseJsonBody<{
      scanned_bin: string;
      scanned_sku: string;
      scanned_lot: string;
      is_manual_entry?: boolean;
      manual_entry_reason?: string;
    }>(req);

    const result = verifyPickScan(actor, {
      task_id: id,
      scanned_bin: body.scanned_bin,
      scanned_sku: body.scanned_sku,
      scanned_lot: body.scanned_lot,
      is_manual_entry: body.is_manual_entry,
      manual_entry_reason: body.manual_entry_reason
    });

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
