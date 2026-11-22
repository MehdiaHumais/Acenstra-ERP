import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { completePickTask } from "@/server/services/picking-packing.service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = authorizeRequest(req, "warehouse:update");
    const { id } = await params;
    const body = await parseJsonBody<{
      picked_cases?: number;
    }>(req).catch(() => ({ picked_cases: undefined }));

    const task = completePickTask(actor, {
      task_id: id,
      picked_cases: body.picked_cases
    });

    return NextResponse.json(task);
  } catch (err) {
    return handleApiError(err);
  }
}
