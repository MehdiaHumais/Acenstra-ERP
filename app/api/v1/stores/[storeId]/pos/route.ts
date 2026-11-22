import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import {
  configureStorePosIntegration,
  getStorePosIntegrationStatus,
  importStorePosTransactions,
  upsertStorePosSkuMapping,
} from "@/server/services/store-monitoring.service";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ storeId: string }> }
) {
  try {
    const user = authorizeRequest(req, "stores.read");
    const { storeId } = await context.params;
    const status = getStorePosIntegrationStatus(user, storeId);
    return NextResponse.json(status);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ storeId: string }> }
) {
  try {
    const user = authorizeRequest(req, "stores.pos.manage");
    const { storeId } = await context.params;
    const body = await parseJsonBody<Record<string, any>>(req);
    const action = body.action || "import_transactions";

    if (action === "configure_integration") {
      const res = configureStorePosIntegration(user, storeId, {
        provider_name: body.provider_name,
        external_store_ref: body.external_store_ref,
        api_credentials_present: body.api_credentials_present,
        sync_sales_enabled: body.sync_sales_enabled,
        sync_inventory_enabled: body.sync_inventory_enabled,
      });
      return NextResponse.json(res);
    }

    if (action === "upsert_sku_mapping") {
      const res = upsertStorePosSkuMapping(user, storeId, {
        provider_name: body.provider_name,
        pos_item_code: body.pos_item_code,
        pos_item_name: body.pos_item_name,
        distributor_sku: body.distributor_sku,
        mapping_type: body.mapping_type,
        cases_per_pos_unit: Number(body.cases_per_pos_unit),
        kg_per_pos_unit: body.kg_per_pos_unit !== undefined ? Number(body.kg_per_pos_unit) : undefined,
      });
      return NextResponse.json(res);
    }

    const res = importStorePosTransactions(user, storeId, {
      provider_name: body.provider_name || "POS_Adapter",
      period_start: body.period_start || "2026-11-01",
      period_end: body.period_end || "2026-11-07",
      transactions: body.transactions || [],
    });
    return NextResponse.json(res, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
