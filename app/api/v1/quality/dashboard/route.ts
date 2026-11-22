import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import {
  getQualityDashboardMetrics,
  listCapas,
  listExceptions,
  listHaccpTemplates,
  listInspections
} from "@/server/services/quality-gate.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "quality.read");
    const url = new URL(req.url);
    const warehouse = url.searchParams.get("warehouse") || undefined;

    const metrics = getQualityDashboardMetrics(actor, warehouse);
    const inspections = listInspections(actor, { warehouse, page: 1, page_size: 25 });
    const templates = listHaccpTemplates(actor);
    const exceptions = listExceptions(actor, { warehouse });
    const capas = listCapas(actor, { warehouse });

    return NextResponse.json({
      metrics,
      inspections: inspections.items,
      inspections_total: inspections.total,
      haccp_templates: templates,
      exceptions,
      capas
    });
  } catch (err) {
    return handleApiError(err);
  }
}
