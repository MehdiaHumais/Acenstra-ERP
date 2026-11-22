import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, authorizeRequestAnyOf, handleApiError, parseJsonBody } from "@/server/core/http";
import { assignOrUpdatePutawayTask, getPutawayTaskDetail } from "@/server/services/putaway.service";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = authorizeRequest(req, "putaway.read");
    const { id } = await context.params;
    const detail = getPutawayTaskDetail(actor, id);
    return NextResponse.json(detail);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = authorizeRequestAnyOf(req, ["putaway.manage", "putaway.execute"]);
    const { id } = await context.params;
    const body = await parseJsonBody<Parameters<typeof assignOrUpdatePutawayTask>[2]>(req);
    const detail = assignOrUpdatePutawayTask(actor, id, body);
    return NextResponse.json(detail);
  } catch (err) {
    return handleApiError(err);
  }
}
