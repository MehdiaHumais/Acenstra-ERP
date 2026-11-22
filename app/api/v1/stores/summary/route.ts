import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { getStoreSummary, updateStoreStatus } from "@/server/services/finance-analytics.service";
import type { StorePerformance } from "@/lib/types";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "stores:read");
    return NextResponse.json(getStoreSummary(actor));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "stores:update");
    const body = await parseJsonBody<{
      store_id: string;
      status: StorePerformance["status"];
    }>(req);

    const store = updateStoreStatus(actor, body.store_id, body.status);
    return NextResponse.json({
      store,
      summary: getStoreSummary(actor)
    });
  } catch (err) {
    return handleApiError(err);
  }
}
