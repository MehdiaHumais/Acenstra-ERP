import { NextRequest, NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/server/core/http";
import { requirePermission } from "@/server/security/auth";
import {
  listUserCredentials,
  issueUserCredential,
  revokeUserCredential
} from "@/server/services/credential.service";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const actor = requirePermission(req, "users.read");
    return NextResponse.json({ credentials: listUserCredentials(actor, params.id) });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const actor = requirePermission(req, "users.manage");
    const body = await parseJsonBody<{ label?: string }>(req);
    const issued = await issueUserCredential(actor, params.id, body.label?.trim() || "Personal Access Card");

    return NextResponse.json({
      ok: true,
      credential: issued.credential,
      qr_svg: issued.qr_svg,
      qr_data_uri: issued.qr_data_uri,
      /** Only ever present in this response. Print/Download happens now or never. */
      secret: issued.secret
    });
  } catch (err) {
    return handleApiError(err);
  }
}
