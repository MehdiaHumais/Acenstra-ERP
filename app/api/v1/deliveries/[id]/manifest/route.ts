import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { verifyManifestLoadingScan, getDeliveryPlan } from "@/server/services/loading-delivery.service";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = authorizeRequest(req, "deliveries:read");
    const { id } = await params;
    const delivery = getDeliveryPlan(id, actor);
    return NextResponse.json({
      delivery_id: delivery.id,
      manifest_items: delivery.manifest_items || [],
      total_items: delivery.manifest_items?.length || 0,
      loaded_items: delivery.manifest_items?.filter((i) => i.is_scanned_loaded).length || 0,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = authorizeRequest(req, "deliveries:update");
    const { id } = await params;
    const body = await parseJsonBody<{
      scanned_barcode: string;
      compartment?: "chilled" | "frozen" | "ambient";
    }>(req);

    return await withIdempotency(req, `/api/v1/deliveries/${id}/manifest`, body, () => {
      const result = verifyManifestLoadingScan(actor, {
        delivery_id: id,
        scanned_barcode: body.scanned_barcode,
        compartment: body.compartment,
      });
      return { status: 200, body: result };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
