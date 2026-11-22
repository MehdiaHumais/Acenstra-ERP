import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { processOfflineSyncQueue } from "@/server/services/loading-delivery.service";

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "deliveries:update");
    const body = await parseJsonBody<{
      actions: Array<{
        sync_action_id: string;
        idempotency_key: string;
        action_type:
          | "SUBMIT_INSPECTION"
          | "LOG_TEMPERATURE"
          | "SCAN_MANIFEST"
          | "START_TRANSIT"
          | "ARRIVE_STOP"
          | "SUBMIT_POD"
          | "REPORT_EXCEPTION";
        payload: any;
        device_timestamp: string;
      }>;
    }>(req);

    const result = processOfflineSyncQueue(actor, body.actions || []);
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
