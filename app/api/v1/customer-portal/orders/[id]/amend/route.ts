import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { amendCustomerOrder } from "@/server/services/customer-order.service";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const actor = authorizeRequest(req, "orders.manage");
    const body = await parseJsonBody<{
      delivery_date?: string;
      delivery_address?: string;
      delivery_notes?: string | null;
      po_reference?: string | null;
      allow_backorders?: boolean;
      lines?: Array<{ sku: string; cases: number; uom?: string; notes?: string }>;
    }>(req);

    return await withIdempotency(
      req,
      `/api/v1/customer-portal/orders/${params.id}/amend`,
      body,
      () => ({
        status: 200,
        body: amendCustomerOrder(actor, params.id, body)
      })
    );
  } catch (err) {
    return handleApiError(err);
  }
}
