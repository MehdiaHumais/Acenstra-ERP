import { NextRequest, NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/server/core/http";
import { resetPasswordWithToken } from "@/server/services/password-reset.service";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await parseJsonBody<{ token?: string; new_password?: string; password?: string }>(req);
    const result = resetPasswordWithToken(body.token ?? "", body.new_password ?? body.password ?? "");
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
