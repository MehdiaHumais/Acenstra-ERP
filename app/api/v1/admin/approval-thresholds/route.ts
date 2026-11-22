import { NextRequest, NextResponse } from "next/server";
import { handleApiError, parseJsonBody, ApiError } from "@/server/core/http";
import { requirePermission } from "@/server/security/auth";
import {
  listApprovalThresholds,
  updateApprovalThreshold
} from "@/server/services/access-control.service";

export async function GET(req: NextRequest) {
  try {
    const actor = requirePermission(req, "approvals.manage");
    return NextResponse.json({ thresholds: listApprovalThresholds(actor) });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = requirePermission(req, "approvals.manage");
    const body = await parseJsonBody<{
      action_code?: string;
      label?: string;
      amount_cents?: number | null;
      requires_permission?: string;
      maker_checker?: boolean;
      active?: boolean;
    }>(req);
    if (!body.action_code) {
      throw new ApiError(400, "VALIDATION_ERROR", "action_code is required.");
    }
    return NextResponse.json(
      updateApprovalThreshold(actor, body.action_code, {
        label: body.label,
        amount_cents: body.amount_cents,
        requires_permission: body.requires_permission,
        maker_checker: body.maker_checker,
        active: body.active
      })
    );
  } catch (err) {
    return handleApiError(err);
  }
}
