import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { reviewAnomaly } from "@/server/services/management-ai.service";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const user = authorizeRequest(req, "dashboard:read");
    const { id } = await Promise.resolve(params);
    const body = await req.json();

    const updated = reviewAnomaly(
      id,
      {
        review_status: body.review_status,
        resolution_notes: body.resolution_notes,
      },
      user
    );

    return NextResponse.json({ anomaly: updated });
  } catch (err) {
    return handleApiError(err);
  }
}
