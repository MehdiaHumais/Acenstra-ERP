import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { createStoreAccount, listStoreAccounts } from "@/server/services/store-monitoring.service";

export async function GET(req: NextRequest) {
  try {
    const user = authorizeRequest(req, "stores.read");
    const { searchParams } = new URL(req.url);
    const stores = listStoreAccounts(user, {
      franchise_group: searchParams.get("franchise_group") || undefined,
      region: searchParams.get("region") || undefined,
      status: searchParams.get("status") || undefined,
      search: searchParams.get("search") || undefined,
    });
    return NextResponse.json({ stores });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = authorizeRequest(req, "stores.manage");
    const body = await parseJsonBody<Parameters<typeof createStoreAccount>[1]>(req);
    const store = createStoreAccount(user, body);
    return NextResponse.json({ store }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
