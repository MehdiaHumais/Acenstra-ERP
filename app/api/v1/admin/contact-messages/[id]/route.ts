import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import {
  replyToContactMessage,
  markContactMessageRead,
  deleteContactMessage,
} from "@/server/services/contact-message.service";
import { ApiError } from "@/server/core/http";

/**
 * POST actions:
 *  - read   — mark a message read. Owner of the message, or an admin.
 *  - reply  — admin reply to a user's message (admins only).
 *  - delete — delete the message (owner or admin).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = authorizeRequest(req);
    const body = await parseJsonBody<{ action?: "reply" | "read" | "delete"; reply?: string }>(req);
    const action = body.action ?? "reply";
    const isAdmin =
      actor.role === "super_admin" ||
      actor.roles?.includes("super_admin") ||
      (actor.roles ?? []).some((r) => ["company_admin", "administrator"].includes(r));

    if (action === "read") {
      return NextResponse.json(markContactMessageRead(actor, params.id));
    }
    if (action === "reply") {
      if (!isAdmin) throw new ApiError(403, "FORBIDDEN", "Administrators only.");
      const result = await replyToContactMessage(actor, params.id, { reply: body.reply });
      return NextResponse.json(result);
    }
    if (action === "delete") {
      return NextResponse.json(deleteContactMessage(actor, params.id));
    }
    throw new ApiError(400, "INVALID_ACTION", "Unknown action.");
  } catch (err) {
    return handleApiError(err);
  }
}
