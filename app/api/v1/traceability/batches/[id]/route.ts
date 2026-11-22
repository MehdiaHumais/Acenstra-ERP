import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import {
  getBatchTraceability,
  notifyRecallCustomer,
  quarantineBatch
} from "@/server/services/deliveries-traceability.service";

export async function GET(
  req: NextRequest,
  context: { params: { id: string } }
) {
  try {
    authorizeRequest(req, "traceability:read");
    return NextResponse.json(getBatchTraceability(context.params.id));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: { id: string } }
) {
  try {
    const actor = authorizeRequest(req, "traceability:quarantine");
    const body = await parseJsonBody<{
      action: "quarantine" | "notify_customer";
      order_number?: string;
      reason?: string;
    }>(req);

    if (body.action === "notify_customer") {
      const notice = notifyRecallCustomer(
        actor,
        decodeURIComponent(context.params.id),
        body.order_number || ""
      );
      return NextResponse.json({
        notice,
        trace: getBatchTraceability(context.params.id)
      });
    }

    const trace = quarantineBatch(actor, decodeURIComponent(context.params.id), body.reason);
    return NextResponse.json(trace);
  } catch (err) {
    return handleApiError(err);
  }
}
