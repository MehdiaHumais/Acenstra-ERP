import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { listAllContactMessages, createAdminMessageToUser, deleteContactMessage } from "@/server/services/contact-message.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "users.read");
    const url = new URL(req.url);
    const result = listAllContactMessages(actor, {
      search: url.searchParams.get("search") || undefined,
      status: url.searchParams.get("status") || undefined,
      direction: url.searchParams.get("direction") || undefined,
      limit: parseInt(url.searchParams.get("limit") || "50", 10),
      offset: parseInt(url.searchParams.get("offset") || "0", 10),
    });
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}

// POST — admin actions: compose a message to a user, or delete any message.
export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "users.manage");
    const body = await parseJsonBody<{ action?: "compose" | "delete"; id?: string; user_id?: string; subject?: string; message?: string }>(req);
    const action = body.action ?? "compose";
    if (action === "compose") {
      const created = createAdminMessageToUser(actor, {
        user_id: body.user_id,
        subject: body.subject,
        message: body.message,
      });
      return NextResponse.json(created, { status: 201 });
    }
    if (action === "delete") {
      if (!body.id) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Missing message id." } }, { status: 400 });
      return NextResponse.json(deleteContactMessage(actor, body.id));
    }
    return NextResponse.json({ error: { code: "INVALID_ACTION", message: "Unknown action." } }, { status: 400 });
  } catch (err) {
    return handleApiError(err);
  }
}
