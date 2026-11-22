import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { importBankStatement } from "@/server/services/finance.service";

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "finance:reconcile");
    const body = await parseJsonBody<{
      filename: string;
      csv_content: string;
      statement_reference?: string;
      account_iban?: string;
    }>(req);

    return await withIdempotency(req, "/api/v1/finance/reconciliation/import", body, () => {
      const statement = importBankStatement(actor, body);
      return {
        status: 201,
        body: {
          message: `Bank statement '${statement.filename}' imported with ${statement.total_lines} lines (${statement.matched_lines} auto-matched)`,
          statement,
        },
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
