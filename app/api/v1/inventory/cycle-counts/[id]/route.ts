import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, authorizeRequestAnyOf, handleApiError, parseJsonBody } from "@/server/core/http";
import {
  reviewOrApproveCycleCount,
  submitCycleCount
} from "@/server/services/stock-intelligence.service";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = authorizeRequestAnyOf(req, ["inventory.count", "inventory:adjust"]);
    const { id } = await context.params;
    const body = await parseJsonBody<{
      counted_cases: number;
      counted_weight_kg?: number | null;
      barcode_scanned?: string | null;
      discrepancy_reason?: string | null;
      notes?: string | null;
    }>(req);

    const submitted = submitCycleCount(actor, decodeURIComponent(id), body);
    return NextResponse.json(submitted);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = authorizeRequestAnyOf(
      req,
      ["inventory.approve_adjustment"],
      ["warehouse_manager", "super_admin", "administrator"]
    );
    const { id } = await context.params;
    const body = await parseJsonBody<{
      action: "approve" | "request_recount" | "reject";
      notes?: string | null;
      assigned_to_name?: string | null;
    }>(req);

    const result = reviewOrApproveCycleCount(actor, decodeURIComponent(id), body);
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
