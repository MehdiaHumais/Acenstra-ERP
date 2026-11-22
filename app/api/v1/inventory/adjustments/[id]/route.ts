import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, authorizeRequestAnyOf, handleApiError, parseJsonBody } from "@/server/core/http";
import { decideStockAdjustment } from "@/server/services/stock-intelligence.service";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = authorizeRequest(req, "inventory.approve_adjustment");
    const { id } = await context.params;
    const body = await parseJsonBody<{
      decision: "approve" | "reject";
      approval_notes?: string | null;
    }>(req);

    const updated = decideStockAdjustment(actor, decodeURIComponent(id), body);
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}
