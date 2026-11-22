import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { resubmitInvoiceToSdi } from "@/server/services/sdi-einvoice.service";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const actor = authorizeRequest(req, "finance:sdi");
    const { id } = await Promise.resolve(params);
    const body = await parseJsonBody<{
      customer_piva?: string;
      customer_fiscal_code?: string;
      customer_sdi_code?: string;
      customer_pec?: string;
    }>(req);

    return await withIdempotency(req, `/api/v1/finance/sdi/${id}/resubmit`, body, async () => {
      const result = await resubmitInvoiceToSdi(actor, id, body);
      return {
        status: 200,
        body: {
          message: `Invoice ${result.invoice.invoice_number} resubmitted to SDI with version v${result.invoice.sdi_version}`,
          invoice: result.invoice,
          transmission: result.transmission,
        },
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
