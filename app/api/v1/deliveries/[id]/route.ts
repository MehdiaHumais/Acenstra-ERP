import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { getDeliveryPlan } from "@/server/services/loading-delivery.service";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = authorizeRequest(req, "deliveries:read");
    const { id } = await params;
    const delivery = getDeliveryPlan(id, actor);
    return NextResponse.json({ delivery });
  } catch (err) {
    return handleApiError(err);
  }
}
