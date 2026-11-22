import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import {
  getPutawayDashboardMetrics,
  listPutawayHistory,
  listPutawayTasks,
  listWarehouseBins,
  listWarehouseZones
} from "@/server/services/putaway.service";
import { getDb } from "@/server/db/connection";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "putaway.read");
    const url = new URL(req.url);
    const warehouse = url.searchParams.get("warehouse") || undefined;

    const metrics = getPutawayDashboardMetrics(actor, warehouse);
    const tasks = listPutawayTasks(actor, { warehouse, page: 1, page_size: 50 });
    const zones = listWarehouseZones(actor, warehouse);
    const bins = listWarehouseBins(actor, { warehouse });
    const history = listPutawayHistory(actor, { warehouse });

    const db = getDb();
    const eligibleLots = db
      .prepare(
        `SELECT l.batch_id, l.sku, l.product_name, l.warehouse, l.location, l.quantity_cases, l.quality_status, l.expiry_date, l.temp_c
         FROM inventory_lots l
         WHERE l.quality_status = 'released' AND l.quantity_cases > 0
         ORDER BY l.updated_at DESC
         LIMIT 25`
      )
      .all();

    return NextResponse.json({
      metrics,
      tasks: tasks.items,
      tasks_total: tasks.total,
      zones,
      bins,
      history,
      eligible_lots: eligibleLots
    });
  } catch (err) {
    return handleApiError(err);
  }
}
