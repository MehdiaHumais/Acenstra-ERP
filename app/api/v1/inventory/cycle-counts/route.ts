import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, authorizeRequestAnyOf, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import {
  createCycleCount,
  listCycleCounts
} from "@/server/services/stock-intelligence.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "inventory:read");
    const sp = req.nextUrl.searchParams;
    const items = listCycleCounts(actor, {
      warehouse: sp.get("warehouse"),
      status: sp.get("status"),
      lot: sp.get("lot"),
      sku: sp.get("sku")
    });
    return NextResponse.json({ items, counts: items });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequestAnyOf(req, ["inventory.count", "inventory:adjust"]);
    const body = await parseJsonBody<{
      count_type?: "scheduled" | "ad_hoc" | "blind";
      internal_lot: string;
      warehouse?: string;
      zone?: string;
      bin_code?: string;
      is_blind?: boolean;
      blind_count?: boolean;
      assigned_to?: string | null;
      assigned_to_id?: string | null;
      assigned_to_name?: string;
      scheduled_date?: string;
      notes?: string | null;
    }>(req);

    return await withIdempotency(req, "/api/v1/inventory/cycle-counts", body, () => {
      const created = createCycleCount(actor, {
        ...body,
        count_type: body.count_type === "blind" ? "scheduled" : body.count_type,
        is_blind: body.is_blind ?? body.blind_count ?? true,
        assigned_to_id: body.assigned_to_id ?? body.assigned_to ?? null
      });
      return { status: 201, body: created };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
