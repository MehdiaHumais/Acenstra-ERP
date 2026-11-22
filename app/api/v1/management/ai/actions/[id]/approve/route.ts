import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { approveAndExecuteAiAction } from "@/server/services/management-ai.service";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const user = authorizeRequest(req, "ai.actions.approve");
    const { id } = await Promise.resolve(params);
    const body = await req.json().catch(() => ({}));
    const note = body?.approval_note || undefined;

    const result = approveAndExecuteAiAction(id, note, user);
    return NextResponse.json({ success: true, action: result.action, execution_result: result.execution_result });
  } catch (err) {
    return handleApiError(err);
  }
}
