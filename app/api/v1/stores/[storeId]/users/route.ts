import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { inviteOrUpdateStoreUser } from "@/server/services/store-monitoring.service";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ storeId: string }> }
) {
  try {
    const user = authorizeRequest(req, "stores.read");
    const { storeId } = await context.params;
    const body = await parseJsonBody<Parameters<typeof inviteOrUpdateStoreUser>[2]>(req);
    const result = inviteOrUpdateStoreUser(user, storeId, body);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
