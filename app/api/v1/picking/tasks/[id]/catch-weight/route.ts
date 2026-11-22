import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { confirmCatchWeight } from "@/server/services/picking-packing.service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = authorizeRequest(req, "warehouse:update");
    const { id } = await params;
    const body = await parseJsonBody<{
      actual_weight_kg: number;
      package_count?: number;
      manager_approval_notes?: string;
    }>(req);

    const result = confirmCatchWeight(actor, {
      task_id: id,
      actual_weight_kg: body.actual_weight_kg,
      package_count: body.package_count,
      manager_approval_notes: body.manager_approval_notes
    });

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
