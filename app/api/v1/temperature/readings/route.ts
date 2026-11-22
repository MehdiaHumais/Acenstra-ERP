import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { listTemperatureReadings, recordTemperatureReading } from "@/server/services/inventory-fefo.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "inventory:read");
    return NextResponse.json(listTemperatureReadings(actor));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "inventory:adjust");
    const body = await parseJsonBody<{
      zone_id: string;
      current_c: number;
      humidity_pct?: number;
    }>(req);

    const reading = recordTemperatureReading(actor, {
      zone_id: body.zone_id,
      current_c: Number(body.current_c),
      humidity_pct: body.humidity_pct !== undefined ? Number(body.humidity_pct) : undefined
    });
    return NextResponse.json(reading, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
