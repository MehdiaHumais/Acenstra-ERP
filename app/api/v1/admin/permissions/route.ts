import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/server/core/http";
import { requirePermission } from "@/server/security/auth";
import { listPermissionMatrix } from "@/server/services/access-control.service";

export async function GET(req: NextRequest) {
  try {
    const actor = requirePermission(req, "roles.read");
    return NextResponse.json(listPermissionMatrix(actor));
  } catch (err) {
    return handleApiError(err);
  }
}
