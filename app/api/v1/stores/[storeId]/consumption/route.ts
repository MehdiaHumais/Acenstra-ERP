import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import {
  getStoreConsumptionAnalysis,
  upsertStoreConsumptionConfig,
} from "@/server/services/store-monitoring.service";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ storeId: string }> }
) {
  try {
    const user = authorizeRequest(req, "stores.read");
    const { storeId } = await context.params;
    const analysis = getStoreConsumptionAnalysis(user, storeId);
    return NextResponse.json(analysis);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ storeId: string }> }
) {
  try {
    const user = authorizeRequest(req, "stores.consumption.manage");
    const { storeId } = await context.params;
    const body = await parseJsonBody<Parameters<typeof upsertStoreConsumptionConfig>[2]>(req);
    const updated = upsertStoreConsumptionConfig(user, storeId, body);
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}
