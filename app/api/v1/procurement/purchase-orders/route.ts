import { NextRequest, NextResponse } from "next/server";
import {
  authorizeRequest,
  handleApiError,
  parseJsonBody,
  withIdempotency
} from "@/server/core/http";
import { createRfqOrPurchaseOrder, listPurchaseOrders } from "@/server/services/master-data.service";
import { listSupplierScorecards } from "@/server/services/procurement.service";

export async function GET(req: NextRequest) {
  try {
    authorizeRequest(req, "suppliers:read");
    return NextResponse.json({
      purchase_orders: listPurchaseOrders(),
      scorecards: listSupplierScorecards()
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "suppliers:write");
    const body = await parseJsonBody<{
      supplier_id?: string;
      sku?: string;
      cases?: number;
      expected_date?: string;
      unit_cost_cents?: number;
      freight_cents?: number;
      duty_pct?: number;
      other_cents?: number;
      incoterm?: string;
      asn_reference?: string;
      asn_carrier?: string;
      asn_eta?: string;
      asn_notes?: string;
    }>(req);

    return await withIdempotency(req, "/api/v1/procurement/purchase-orders", body, () => {
      const purchaseOrder = createRfqOrPurchaseOrder(actor, {
        supplier_id: body.supplier_id || "",
        sku: body.sku || "",
        cases: Number(body.cases || 0),
        expected_date: body.expected_date,
        mode: "po",
        unit_cost_cents: body.unit_cost_cents,
        freight_cents: body.freight_cents,
        duty_pct: body.duty_pct,
        other_cents: body.other_cents,
        incoterm: body.incoterm,
        asn_reference: body.asn_reference,
        asn_carrier: body.asn_carrier,
        asn_eta: body.asn_eta,
        asn_notes: body.asn_notes
      });
      return {
        status: 201,
        body: {
          purchase_order: purchaseOrder,
          purchase_orders: listPurchaseOrders(),
          scorecards: listSupplierScorecards()
        }
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
