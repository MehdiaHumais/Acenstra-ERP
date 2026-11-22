import { NextRequest, NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/server/core/http";
import { submitAccessRequest, type AccessRequestInput } from "@/server/services/access-request.service";

export const runtime = "nodejs";

/**
 * Public endpoint — no authentication required.
 * Accepts an access request; NEVER creates or activates an account.
 * Deliberately returns a generic confirmation and never reveals whether
 * a user or pending request exists for an email address.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await parseJsonBody<AccessRequestInput>(req);
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip")?.trim() ||
      "127.0.0.1";
    const { id } = await submitAccessRequest(body, { ip });
    return NextResponse.json(
      {
        status: "pending",
        reference: id,
        message: "Your access request has been received and is awaiting admin review. We will notify you by email once a decision has been made.",
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
}
