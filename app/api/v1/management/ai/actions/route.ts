import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { listGovernedAiActions, proposeAiAction } from "@/server/services/management-ai.service";
import { AiActionStatus } from "@/lib/management-ai";

export async function GET(req: NextRequest) {
  try {
    const user = authorizeRequest(req, "ai.recommendations.read");
    const { searchParams } = new URL(req.url);
    const status = (searchParams.get("status") as AiActionStatus) || undefined;

    const actions = await listGovernedAiActions(status, user);
    return NextResponse.json({ actions });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authorizeRequest(req, "ai.recommendations.read");
    const body = await req.json();

    const created = await proposeAiAction(
      {
        action_type: body.action_type,
        target_entity: body.target_entity,
        target_id: body.target_id,
        summary: body.summary,
        rationale: body.rationale,
        parameters: body.parameters || {},
        risk_level: body.risk_level || "low",
        model_version: body.model_version,
        prompt_hash: body.prompt_hash,
      },
      user
    );

    return NextResponse.json({ action: created }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
