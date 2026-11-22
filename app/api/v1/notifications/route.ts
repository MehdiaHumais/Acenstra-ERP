import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { listMyNotifications, markNotificationsRead } from "@/server/services/notification.service";

// GET — current user's notifications.
export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req);
    return NextResponse.json(listMyNotifications(actor));
  } catch (err) {
    return handleApiError(err);
  }
}

// POST — mark notifications as read. Body: { action: "mark_all_read" } or { ids: string[] }
export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req);
    const body = await parseJsonBody<{ action?: string; ids?: string[] }>(req);
    const changed = markNotificationsRead(actor, body.ids);
    return NextResponse.json({ marked: changed });
  } catch (err) {
    return handleApiError(err);
  }
}
