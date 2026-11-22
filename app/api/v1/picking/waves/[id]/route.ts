import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import {
  assignPickWave,
  cancelPickWave,
  getPickWave
} from "@/server/services/picking-packing.service";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = authorizeRequest(req, "warehouse:read");
    const { id } = await params;
    const wave = getPickWave(actor, id);
    return NextResponse.json(wave);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = authorizeRequest(req, "warehouse:update");
    const { id } = await params;
    const body = await parseJsonBody<{
      picker_id: string;
      picker_name: string;
    }>(req);

    const updated = assignPickWave(actor, id, body);
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = authorizeRequest(req, "warehouse:update");
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const reason = searchParams.get("reason") || "Cancelled by warehouse supervisor";

    const res = cancelPickWave(actor, id, reason);
    return NextResponse.json(res);
  } catch (err) {
    return handleApiError(err);
  }
}
