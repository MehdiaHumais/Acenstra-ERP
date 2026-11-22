import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { rejectAiAction } from "@/server/services/management-ai.service";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const user = authorizeRequest(req, "ai.actions.approve");
    const { id } = await Promise.resolve(params);
    const body = await req.json();
    const reason = body?.reason || "Rejected by management";

    const rejected = rejectAiAction(id, reason, user);
    return NextResponse.json({ success: true, action: rejected });
  } catch (err) {
    return handleApiError(err);
  }
}
