import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { createCapa, listCapas } from "@/server/services/quality-gate.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "quality.read");
    const url = new URL(req.url);
    const capas = listCapas(actor, {
      status: url.searchParams.get("status"),
      warehouse: url.searchParams.get("warehouse"),
      supplier_id: url.searchParams.get("supplier_id"),
      lot: url.searchParams.get("lot"),
      overdue_only: url.searchParams.get("overdue_only") === "true",
      search: url.searchParams.get("search")
    });
    return NextResponse.json({ capas });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "quality.capa");
    const body = await parseJsonBody<Parameters<typeof createCapa>[1]>(req);
    return await withIdempotency(req, "/api/v1/quality/capas", body, async () => {
      const capa = createCapa(actor, body);
      return {
        status: 201,
        body: { capa }
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
