import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { listPickTasks } from "@/server/services/picking-packing.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "warehouse:read");
    const { searchParams } = new URL(req.url);

    const tasks = listPickTasks(actor, {
      wave_id: searchParams.get("wave_id") || undefined,
      order_number: searchParams.get("order_number") || undefined,
      warehouse: searchParams.get("warehouse") || undefined,
      status: searchParams.get("status") || undefined,
      assigned_to: searchParams.get("assigned_to") || undefined,
      limit: Number(searchParams.get("limit")) || 100
    });

    return NextResponse.json({ tasks });
  } catch (err) {
    return handleApiError(err);
  }
}
