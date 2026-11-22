import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import {
  getStoreAccountDetail,
  updateStoreAccountStatus,
} from "@/server/services/store-monitoring.service";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ storeId: string }> }
) {
  try {
    const user = authorizeRequest(req, "stores.read");
    const { storeId } = await context.params;
    const detail = getStoreAccountDetail(user, storeId);
    return NextResponse.json(detail);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ storeId: string }> }
) {
  try {
    const user = authorizeRequest(req, "stores.manage");
    const { storeId } = await context.params;
    const body = await parseJsonBody<Parameters<typeof updateStoreAccountStatus>[2]>(req);
    const updated = updateStoreAccountStatus(user, storeId, body);
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}
