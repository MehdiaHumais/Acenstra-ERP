import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { getException, updateException } from "@/server/services/exceptions-recall.service";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const actor = authorizeRequest(req, "quality.read");
    const { id } = await Promise.resolve(params);
    const exception = getException(id, actor);
    return NextResponse.json({ exception });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const actor = authorizeRequest(req, "quality.inspect");
    const { id } = await Promise.resolve(params);
    const body = await parseJsonBody<any>(req);
    const exception = updateException(id, body, actor);
    return NextResponse.json({
      message: `Exception ${exception.exception_number} updated successfully`,
      exception,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
