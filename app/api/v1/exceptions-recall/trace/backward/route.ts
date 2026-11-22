import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { getBackwardTraceability } from "@/server/services/exceptions-recall.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "traceability:read");
    const { searchParams } = new URL(req.url);

    const customer_id = searchParams.get("customer_id") || undefined;
    const order_number = searchParams.get("order_number") || undefined;
    const delivery_id = searchParams.get("delivery_id") || undefined;
    const invoice_number = searchParams.get("invoice_number") || undefined;
    const lot_id = searchParams.get("lot_id") || undefined;

    if (!customer_id && !order_number && !delivery_id && !invoice_number && !lot_id) {
      return NextResponse.json(
        { error: "At least one search parameter (order_number, delivery_id, invoice_number, customer_id, or lot_id) is required." },
        { status: 400 }
      );
    }

    const result = getBackwardTraceability(
      { customer_id, order_number, delivery_id, invoice_number, lot_id },
      actor
    );
    return NextResponse.json({ result });
  } catch (err) {
    return handleApiError(err);
  }
}
