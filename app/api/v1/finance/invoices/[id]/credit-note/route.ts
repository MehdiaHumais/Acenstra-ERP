import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { createCreditNote } from "@/server/services/finance.service";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const actor = authorizeRequest(req, "finance:invoice");
    const { id } = await Promise.resolve(params);
    const body = await parseJsonBody<{
      reason: string;
      amount_cents?: number;
      notes?: string;
    }>(req);

    return await withIdempotency(req, `/api/v1/finance/invoices/${id}/credit-note`, body, () => {
      const creditNote = createCreditNote(actor, {
        invoice_id: id,
        reason: body.reason,
        amount_cents: body.amount_cents,
        notes: body.notes,
      });
      return {
        status: 201,
        body: {
          message: `Credit note ${creditNote.invoice_number} created for invoice ${id}`,
          credit_note: creditNote,
        },
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
