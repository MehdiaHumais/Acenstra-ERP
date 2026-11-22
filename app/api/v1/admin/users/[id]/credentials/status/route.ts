import { NextRequest, NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/server/core/http";
import { requirePermission } from "@/server/security/auth";
import { setUserCredentialStatus } from "@/server/services/credential.service";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const actor = requirePermission(req, "users.manage");
    const body = await parseJsonBody<{ credential_id?: string; status?: "active" | "inactive" }>(req);
    if (!body.credential_id || !body.status) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "credential_id and status are required." } },
        { status: 400 }
      );
    }
    const credential = setUserCredentialStatus(actor, params.id, body.credential_id, body.status);
    return NextResponse.json({ ok: true, credential });
  } catch (err) {
    return handleApiError(err);
  }
}
