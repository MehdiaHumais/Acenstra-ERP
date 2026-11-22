import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { listCustomerContracts, upsertCustomerContract } from "@/server/services/customer-order.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "orders.read");
    const { searchParams } = new URL(req.url);

    let customerId = searchParams.get("customer_id") || undefined;
    if (actor.role === "store_vendor" || actor.role === "store_user") {
      customerId = actor.store_id || undefined;
    }

    const contracts = listCustomerContracts(actor, customerId);
    return NextResponse.json(contracts);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "orders.manage");
    const body = await parseJsonBody<any>(req);
    const contract = upsertCustomerContract(actor, body);
    return NextResponse.json(contract, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
