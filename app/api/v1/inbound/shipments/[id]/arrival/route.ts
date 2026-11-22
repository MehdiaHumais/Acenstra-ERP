import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, authorizeRequestAnyOf, handleApiError, parseJsonBody } from "@/server/core/http";
import { recordArrival } from "@/server/services/inbound.service";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = authorizeRequestAnyOf(req, ["inbound.arrival", "inbound.driver_update"]);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const detail = recordArrival(actor, params.id, body);
    return NextResponse.json(detail);
  } catch (err) {
    return handleApiError(err);
  }
}
