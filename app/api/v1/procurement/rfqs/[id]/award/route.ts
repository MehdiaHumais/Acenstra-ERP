import { NextRequest, NextResponse } from "next/server";
import {
  authorizeRequest,
  handleApiError,
  parseJsonBody,
  withIdempotency
} from "@/server/core/http";
import { awardRfq, listRfqs } from "@/server/services/procurement.service";
import { listPurchaseOrders } from "@/server/services/master-data.service";

export async function POST(
  req: NextRequest,
  context: { params: { id: string } }
) {
  try {
    const actor = authorizeRequest(req, "suppliers:write");
    const body = await parseJsonBody<{
      quotation_id?: string;
      asn_reference?: string;
      asn_carrier?: string;
      asn_eta?: string;
      asn_notes?: string;
    }>(req);

    const rfqId = decodeURIComponent(context.params.id);
    return await withIdempotency(req, `/api/v1/procurement/rfqs/${rfqId}/award`, body, () => {
      const result = awardRfq(actor, rfqId, {
        quotation_id: body.quotation_id || "",
        asn_reference: body.asn_reference,
        asn_carrier: body.asn_carrier,
        asn_eta: body.asn_eta,
        asn_notes: body.asn_notes
      });
      return {
        status: 201,
        body: {
          purchase_order: result.purchase_order,
          rfq: result.rfq,
          rfqs: listRfqs(),
          purchase_orders: listPurchaseOrders()
        }
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
