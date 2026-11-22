import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, withIdempotency } from "@/server/core/http";
import { transmitInvoiceToSdi } from "@/server/services/sdi-einvoice.service";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const actor = authorizeRequest(req, "finance:sdi");
    const { id } = await Promise.resolve(params);

    return await withIdempotency(req, `/api/v1/finance/sdi/${id}/transmit`, {}, async () => {
      const result = await transmitInvoiceToSdi(actor, id);
      return {
        status: 200,
        body: {
          message: result.transmission.transmission_status === "accepted"
            ? `Invoice ${result.invoice.invoice_number} transmitted to SDI successfully (${result.transmission.sdi_identifier})`
            : `SDI transmission rejected: ${result.transmission.sdi_notification_type}`,
          invoice: result.invoice,
          transmission: {
            ...result.transmission,
            status: result.transmission.transmission_status === "accepted" ? "delivered" : result.transmission.transmission_status,
          },
        },
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
