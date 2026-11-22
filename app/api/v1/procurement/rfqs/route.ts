import { NextRequest, NextResponse } from "next/server";
import {
  authorizeRequest,
  handleApiError,
  parseJsonBody,
  withIdempotency
} from "@/server/core/http";
import { createRfq, listRfqs } from "@/server/services/procurement.service";

export async function GET(req: NextRequest) {
  try {
    authorizeRequest(req, "suppliers:read");
    return NextResponse.json({ rfqs: listRfqs() });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "suppliers:write");
    const body = await parseJsonBody<{
      sku?: string;
      quantity_cases?: number;
      needed_by?: string;
      incoterm?: string;
      destination?: string;
      notes?: string;
    }>(req);

    return await withIdempotency(req, "/api/v1/procurement/rfqs", body, () => {
      const rfq = createRfq(actor, {
        sku: body.sku || "",
        quantity_cases: Number(body.quantity_cases || 0),
        needed_by: body.needed_by || "",
        incoterm: body.incoterm,
        destination: body.destination,
        notes: body.notes
      });
      return {
        status: 201,
        body: { rfq, rfqs: listRfqs() }
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
