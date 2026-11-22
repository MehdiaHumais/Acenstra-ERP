import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { createInspection, listInspections } from "@/server/services/quality-gate.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "quality.read");
    const url = new URL(req.url);
    const result = listInspections(actor, {
      search: url.searchParams.get("search"),
      status: url.searchParams.get("status"),
      warehouse: url.searchParams.get("warehouse"),
      supplier_id: url.searchParams.get("supplier_id"),
      sku: url.searchParams.get("sku"),
      lot: url.searchParams.get("lot"),
      page: Number(url.searchParams.get("page") || 1),
      page_size: Number(url.searchParams.get("page_size") || 25)
    });
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "quality.inspect");
    const body = await parseJsonBody<Parameters<typeof createInspection>[1]>(req);
    return await withIdempotency(req, "/api/v1/quality/inspections", body, async () => {
      const inspection = createInspection(actor, body);
      return {
        status: 201,
        body: { inspection }
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
