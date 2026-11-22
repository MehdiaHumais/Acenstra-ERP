import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { generateFinalRecallReport } from "@/server/services/exceptions-recall.service";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const actor = authorizeRequest(req, "quality.read");
    const { id } = await Promise.resolve(params);
    const report = generateFinalRecallReport(id, actor);
    return NextResponse.json({ report });
  } catch (err) {
    return handleApiError(err);
  }
}
