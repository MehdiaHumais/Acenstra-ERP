import { NextRequest, NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/server/core/http";
import { requirePermission } from "@/server/security/auth";
import { revokeUserCredential } from "@/server/services/credential.service";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const actor = requirePermission(req, "users.manage");
    const body = await parseJsonBody<{ credential_id?: string }>(req);
    const result = revokeUserCredential(actor, params.id, body.credential_id || undefined);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return handleApiError(err);
  }
}
