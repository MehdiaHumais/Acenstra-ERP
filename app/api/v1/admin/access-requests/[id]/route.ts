import { NextRequest, NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/server/core/http";
import { requirePermission } from "@/server/security/auth";
import { getAccessRequest, reviewAccessRequest, deleteAccessRequest, type ReviewInput } from "@/server/services/access-request.service";

// GET one access request (admin read)
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = requirePermission(req, "users.read");
    return NextResponse.json(getAccessRequest(actor, params.id));
  } catch (err) {
    return handleApiError(err);
  }
}

// PATCH — review an access request (admin write)
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = requirePermission(req, "users.manage");
    const body = await parseJsonBody<ReviewInput>(req);
    const result = await reviewAccessRequest(actor, params.id, body);
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}

// DELETE — remove an access request (accepted/pending). The created account
// is NOT affected; only the request row is deleted.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = requirePermission(req, "users.manage");
    const result = deleteAccessRequest(actor, params.id);
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
