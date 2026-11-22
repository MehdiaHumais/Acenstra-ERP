import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { createShipment, listShipments } from "@/server/services/inbound.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "inbound.read");
    const url = new URL(req.url);
    const result = listShipments(actor, {
      status: url.searchParams.get("status") || undefined,
      supplier: url.searchParams.get("supplier") || undefined,
      destination: url.searchParams.get("destination") || undefined,
      search: url.searchParams.get("search") || undefined,
      page: Number(url.searchParams.get("page") || 1),
      limit: Number(url.searchParams.get("limit") || 25)
    });
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "inbound.manage");
    const body = await parseJsonBody<Record<string, unknown>>(req);
    return await withIdempotency(req, "/api/v1/inbound/shipments", body, async () => {
      const detail = createShipment(actor, body);
      return {
        status: 201,
        body: {
          ...detail,
          shipment: {
            ...detail.shipment,
            ...detail
          }
        }
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
