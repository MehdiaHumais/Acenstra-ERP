import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { runAiOperationalAnalysis } from "@/server/services/management-ai.service";

export async function POST(req: NextRequest) {
  try {
    const user = authorizeRequest(req, "ai.recommendations.read");
    const body = await req.json().catch(() => ({}));
    const prompt = body?.prompt || undefined;

    const analysis = await runAiOperationalAnalysis(prompt, user);
    return NextResponse.json({ analysis });
  } catch (err) {
    return handleApiError(err);
  }
}
