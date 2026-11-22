import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, authorizeRequestAnyOf, handleApiError, parseJsonBody } from "@/server/core/http";
import { addTemperature } from "@/server/services/inbound.service";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = authorizeRequestAnyOf(req, ["inbound.temperature", "inbound.driver_update"]);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const log = addTemperature(actor, params.id, body);
    return NextResponse.json({ temperature_log: log }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
