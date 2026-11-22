import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import {
  getFinanceSummary,
  recordInvoicePayment,
  sendInvoiceToSdi
} from "@/server/services/finance-analytics.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "finance:read");
    return NextResponse.json(getFinanceSummary(actor));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await parseJsonBody<{
      action: "send_to_sdi" | "record_payment";
      invoice_id: string;
      amount_cents?: number;
      method?: string;
      reference?: string;
    }>(req);

    if (body.action === "send_to_sdi") {
      const actor = authorizeRequest(req, "finance:sdi");
      return await withIdempotency(req, "/api/v1/finance/summary#sdi", body, () => {
        const invoice = sendInvoiceToSdi(actor, body.invoice_id);
        return {
          status: 200,
          body: {
            invoice,
            summary: getFinanceSummary(actor)
          }
        };
      });
    }

    const actor = authorizeRequest(req, "finance:payment");
    return await withIdempotency(req, "/api/v1/finance/summary#payment", body, () => {
      const invoice = recordInvoicePayment(actor, {
        invoice_id: body.invoice_id,
        amount_cents: body.amount_cents,
        method: body.method,
        reference: body.reference
      });
      return {
        status: 200,
        body: {
          invoice,
          summary: getFinanceSummary(actor)
        }
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
