import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, authorizeRequestAnyOf, handleApiError, parseJsonBody } from "@/server/core/http";
import { releaseOrCancelReservation } from "@/server/services/stock-intelligence.service";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = authorizeRequestAnyOf(req, [
      "inventory.reserve",
      "inventory:adjust",
      "orders:write",
      "warehouse:update"
    ]);
    const { id } = await context.params;
    const body = await parseJsonBody<{
      action: "release" | "cancel" | "convert_to_pick";
      reason?: string;
      assignee?: string;
    }>(req);

    const updated = releaseOrCancelReservation(actor, decodeURIComponent(id), body);
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}
