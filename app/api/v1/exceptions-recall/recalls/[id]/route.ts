import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { getRecall } from "@/server/services/exceptions-recall.service";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const actor = authorizeRequest(req, "quality.read");
    const { id } = await Promise.resolve(params);
    const recall = getRecall(id, actor);
    return NextResponse.json({ recall });
  } catch (err) {
    return handleApiError(err);
  }
}
