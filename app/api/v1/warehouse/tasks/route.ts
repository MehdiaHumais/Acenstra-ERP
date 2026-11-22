import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import {
  listWarehouseTasks,
  syncOfflineWarehouseEvents,
  updateWarehouseTask,
  verifyBarcodeScan
} from "@/server/services/orders-warehouse.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "warehouse:read");
    return NextResponse.json(listWarehouseTasks(actor));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "warehouse:update");
    const body = await parseJsonBody<{
      task_id: string;
      action: "start" | "complete" | "assign_to_me" | "toggle_block";
      assignee?: string;
    }>(req);

    const updated = updateWarehouseTask(actor, body);
    return NextResponse.json({
      task: updated,
      tasks: listWarehouseTasks(actor)
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "warehouse:update");
    const body = await parseJsonBody<{
      action?: "verify_scan" | "sync_offline";
      task_id?: string;
      barcode?: string;
      events?: Array<{
        event_id: string;
        task_id: string;
        action: "start" | "complete" | "verify_scan";
        barcode?: string;
        client_timestamp?: string;
      }>;
    }>(req);

    if (body.action === "sync_offline") {
      const syncResult = syncOfflineWarehouseEvents(actor, body.events || []);
      return NextResponse.json(syncResult);
    }

    const scanResult = verifyBarcodeScan(actor, {
      task_id: body.task_id || "",
      barcode: body.barcode || ""
    });
    return NextResponse.json(scanResult);
  } catch (err) {
    return handleApiError(err);
  }
}
