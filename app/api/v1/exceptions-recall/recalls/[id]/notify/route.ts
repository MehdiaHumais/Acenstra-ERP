import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { notifyRecallCustomer } from "@/server/services/exceptions-recall.service";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const actor = authorizeRequest(req, "recalls.manage");
    const { id } = await Promise.resolve(params);
    const body = await parseJsonBody<{
      customer_id: string;
      channel?: "email" | "portal" | "certified_mail" | "phone";
      recipient_contact?: string;
      custom_message?: string;
    }>(req);

    return await withIdempotency(req, `/api/v1/exceptions-recall/recalls/${id}/notify`, body, () => {
      const notification = notifyRecallCustomer(id, body.customer_id, body, actor);
      return {
        status: 200,
        body: {
          message: `Official recall notification dispatched to ${notification.customer_name}`,
          notification,
        },
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
