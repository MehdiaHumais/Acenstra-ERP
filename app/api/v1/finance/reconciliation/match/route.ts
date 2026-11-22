import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { manualReconcileTransaction } from "@/server/services/finance.service";

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "finance:reconcile");
    const body = await parseJsonBody<{
      statement_line_id: string;
      invoice_id?: string;
      action: "match" | "ignore";
      notes?: string;
    }>(req);

    return await withIdempotency(req, "/api/v1/finance/reconciliation/match", body, () => {
      const line = manualReconcileTransaction(actor, body);
      return {
        status: 200,
        body: {
          message: `Statement transaction ${line.id} marked as ${line.reconciliation_status}`,
          line,
        },
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
