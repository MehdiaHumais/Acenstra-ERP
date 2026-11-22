import { NextRequest, NextResponse } from "next/server";
import {
  authorizeRequest,
  handleApiError,
  parseJsonBody,
  withIdempotency
} from "@/server/core/http";
import { approvePurchaseOrder } from "@/server/services/procurement.service";
import { listPurchaseOrders } from "@/server/services/master-data.service";

export async function POST(
  req: NextRequest,
  context: { params: { po: string } }
) {
  try {
    const actor = authorizeRequest(req, "suppliers:write");
    const body = await parseJsonBody<{
      asn_reference?: string;
      asn_carrier?: string;
      asn_eta?: string;
      asn_notes?: string;
    }>(req);
    const poNumber = decodeURIComponent(context.params.po);

    return await withIdempotency(req, `/api/v1/procurement/purchase-orders/${poNumber}/approve`, body, () => {
      const purchaseOrder = approvePurchaseOrder(actor, poNumber, body);
      return {
        status: 200,
        body: {
          purchase_order: purchaseOrder,
          purchase_orders: listPurchaseOrders()
        }
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
