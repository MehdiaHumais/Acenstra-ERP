import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import {
  acknowledgeStoreAlert,
  getStoreNotificationPreferences,
  listStoreMonitoringAlerts,
  updateStoreNotificationPreferences,
} from "@/server/services/store-monitoring.service";

export async function GET(req: NextRequest) {
  try {
    const user = authorizeRequest(req, "stores.read");
    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get("store_id") || undefined;
    const status = searchParams.get("status") || undefined;
    const alerts = listStoreMonitoringAlerts(user, storeId, status);
    const preferences = storeId ? getStoreNotificationPreferences(user, storeId) : null;
    return NextResponse.json({ alerts, preferences });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = authorizeRequest(req, "stores.read");
    const body = await parseJsonBody<Record<string, any>>(req);

    if (body.action === "update_preferences" && body.store_id) {
      const preferences = updateStoreNotificationPreferences(user, body.store_id, body);
      return NextResponse.json({ preferences });
    }

    const updated = acknowledgeStoreAlert(
      user,
      body.alert_id,
      body.status === "resolved" ? "resolved" : "acknowledged"
    );
    return NextResponse.json({ alert: updated });
  } catch (err) {
    return handleApiError(err);
  }
}
