import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import {
  getStoreInventoryReconciliation,
  recordStoreInventorySnapshot,
} from "@/server/services/store-monitoring.service";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ storeId: string }> }
) {
  try {
    const user = authorizeRequest(req, "stores.read");
    const { storeId } = await context.params;
    const reconciliation = getStoreInventoryReconciliation(user, storeId);
    return NextResponse.json(reconciliation);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ storeId: string }> }
) {
  try {
    const user = authorizeRequest(req, "stores.read");
    const { storeId } = await context.params;
    const body = await parseJsonBody<Parameters<typeof recordStoreInventorySnapshot>[2]>(req);
    const snapshot = recordStoreInventorySnapshot(user, storeId, body);
    return NextResponse.json({ snapshot }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
