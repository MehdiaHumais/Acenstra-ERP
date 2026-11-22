import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import {
  createRfqOrPurchaseOrder,
  createSupplier,
  listPurchaseOrders,
  listSuppliers,
  receivePurchaseOrder
} from "@/server/services/master-data.service";

export async function GET(req: NextRequest) {
  try {
    authorizeRequest(req, "suppliers:read");
    const includePos = req.nextUrl.searchParams.get("include_pos") === "true";
    if (includePos) {
      return NextResponse.json({
        suppliers: listSuppliers(),
        purchase_orders: listPurchaseOrders()
      });
    }
    return NextResponse.json(listSuppliers());
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await parseJsonBody<{
      action?: "create_po" | "receive_po" | "create_supplier";
      name?: string;
      country?: string;
      region?: string;
      category?: string;
      lead_time_days?: number;
      supplier_id?: string;
      sku?: string;
      cases?: number;
      expected_date?: string;
      mode?: "rfq" | "po";
      po_number?: string;
      temp_c?: number;
      accepted_cases?: number;
      expiry_date?: string;
    }>(req);

    if (body.action === "create_supplier") {
      const actor = authorizeRequest(req, "suppliers:write");
      return await withIdempotency(req, "/api/v1/suppliers#create_supplier", body, () => {
        const supplier = createSupplier(actor, {
          name: body.name || "",
          country: body.country,
          region: body.region,
          category: body.category,
          lead_time_days: body.lead_time_days
        });
        return {
          status: 201,
          body: {
            supplier,
            suppliers: listSuppliers()
          }
        };
      });
    }

    if (body.action === "receive_po") {
      const actor = authorizeRequest(req, "procurement:receive");
      return await withIdempotency(req, "/api/v1/suppliers#receive", body, () => {
        const result = receivePurchaseOrder(actor, {
          po_number: body.po_number || "",
          temp_c: body.temp_c,
          accepted_cases: body.accepted_cases,
          expiry_date: body.expiry_date
        });
        return { status: 200, body: result };
      });
    }

    const actor = authorizeRequest(req, "suppliers:write");
    return await withIdempotency(req, "/api/v1/suppliers#create_po", body, () => {
      const po = createRfqOrPurchaseOrder(actor, {
        supplier_id: body.supplier_id || "",
        sku: body.sku || "",
        cases: Number(body.cases || 40),
        expected_date: body.expected_date,
        mode: body.mode
      });
      return {
        status: 201,
        body: {
          purchase_order: po,
          suppliers: listSuppliers(),
          purchase_orders: listPurchaseOrders()
        }
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
