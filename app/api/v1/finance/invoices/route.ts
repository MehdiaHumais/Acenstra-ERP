import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { listInvoices, generateInvoiceFromDelivery } from "@/server/services/finance.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "finance:read");
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || undefined;
    const customer_id = searchParams.get("customer_id") || undefined;
    const sdi_status = searchParams.get("sdi_status") || undefined;
    const search = searchParams.get("search") || undefined;

    const invoices = listInvoices(actor, { status, customer_id, sdi_status, search });
    return NextResponse.json({ invoices, count: invoices.length });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "finance:invoice");
    const body = await parseJsonBody<{
      delivery_id: string;
      order_id?: string;
      payment_terms?: string;
      invoice_date?: string;
      notes?: string;
    }>(req);

    return await withIdempotency(req, "/api/v1/finance/invoices", body, () => {
      const invoice = generateInvoiceFromDelivery(actor, body);
      return {
        status: 201,
        body: {
          message: `Invoice ${invoice.invoice_number} generated successfully from delivery ${body.delivery_id}`,
          invoice,
        },
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
