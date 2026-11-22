import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { getGovernedAiAction } from "@/server/services/management-ai.service";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const user = authorizeRequest(req, "ai.recommendations.read");
    const { id } = await Promise.resolve(params);
    const action = getGovernedAiAction(id, user);
    if (!action) {
      return NextResponse.json({ error: "AI action record not found" }, { status: 404 });
    }
    return NextResponse.json({ action });
  } catch (err) {
    return handleApiError(err);
  }
}
