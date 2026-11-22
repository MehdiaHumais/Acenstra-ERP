import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { evaluateFefoAllocation } from "@/server/services/stock-intelligence.service";

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "inventory:read");
    const body = await parseJsonBody<{
      sku: string;
      requested_cases: number;
      warehouse?: string | null;
      customer_id?: string | null;
      customer_name?: string | null;
      customer_segment?: string | null;
      delivery_date?: string | null;
      order_min_remaining_days?: number | null;
      order_number?: string | null;
      allow_partial?: boolean;
      persist_log?: boolean;
    }>(req);

    const result = evaluateFefoAllocation(actor, body);
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
