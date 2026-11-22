import { NextRequest, NextResponse } from "next/server";
import {
  authorizeRequest,
  handleApiError,
  parseJsonBody,
  withIdempotency
} from "@/server/core/http";
import { addQuotation, listRfqs } from "@/server/services/procurement.service";

export async function GET(
  req: NextRequest,
  context: { params: { id: string } }
) {
  try {
    authorizeRequest(req, "suppliers:read");
    const rfq = listRfqs().find((row) => row.id === decodeURIComponent(context.params.id));
    if (!rfq) {
      return NextResponse.json(
        { error: { code: "RFQ_NOT_FOUND", message: "RFQ not found." } },
        { status: 404 }
      );
    }
    return NextResponse.json(rfq);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: { id: string } }
) {
  try {
    const actor = authorizeRequest(req, "suppliers:write");
    const body = await parseJsonBody<{
      supplier_id?: string;
      unit_cost_cents?: number;
      freight_cents?: number;
      duty_pct?: number;
      other_cents?: number;
      lead_time_days?: number;
      valid_until?: string;
      incoterm?: string;
      notes?: string;
    }>(req);

    const rfqId = decodeURIComponent(context.params.id);
    return await withIdempotency(req, `/api/v1/procurement/rfqs/${rfqId}/quotations`, body, () => {
      const rfq = addQuotation(actor, rfqId, {
        supplier_id: body.supplier_id || "",
        unit_cost_cents: Number(body.unit_cost_cents || 0),
        freight_cents: body.freight_cents,
        duty_pct: body.duty_pct,
        other_cents: body.other_cents,
        lead_time_days: body.lead_time_days,
        valid_until: body.valid_until,
        incoterm: body.incoterm,
        notes: body.notes
      });
      return { status: 201, body: { rfq, rfqs: listRfqs() } };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
