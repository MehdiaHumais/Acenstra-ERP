import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { listPayments, recordCustomerPayment } from "@/server/services/finance.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "finance:read");
    const { searchParams } = new URL(req.url);
    const customer_id = searchParams.get("customer_id") || undefined;
    const invoice_id = searchParams.get("invoice_id") || undefined;

    const payments = listPayments(actor, { customer_id, invoice_id });
    return NextResponse.json({ payments, count: payments.length });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "finance:payment");
    const body = await parseJsonBody<{
      customer_id: string;
      amount_cents: number;
      payment_method?: string;
      reference?: string;
      paid_at?: string;
      notes?: string;
      allocations?: Array<{ invoice_id: string; amount_cents: number }>;
    }>(req);

    return await withIdempotency(req, "/api/v1/finance/payments", body, () => {
      const payment = recordCustomerPayment(actor, body);
      return {
        status: 201,
        body: {
          message: `Payment of €${(payment.amount_cents / 100).toFixed(2)} recorded successfully`,
          payment,
        },
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
