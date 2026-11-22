import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { createContactMessage, listMyContactMessages } from "@/server/services/contact-message.service";

// GET — the signed-in user's own messages and replies.
export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req);
    return NextResponse.json({ messages: listMyContactMessages(actor) });
  } catch (err) {
    return handleApiError(err);
  }
}

// POST — create a contact message (write to administrators).
export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req);
    const body = await parseJsonBody<{ subject?: string; message?: string }>(req);
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip")?.trim() ||
      "127.0.0.1";
    const result = createContactMessage(actor, body, { ip });
    return NextResponse.json({ ok: true, reference: result.id }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
