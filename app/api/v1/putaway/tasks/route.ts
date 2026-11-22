import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, authorizeRequestAnyOf, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { createPutawayTask, listPutawayTasks } from "@/server/services/putaway.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "putaway.read");
    const url = new URL(req.url);
    const result = listPutawayTasks(actor, {
      search: url.searchParams.get("search"),
      status: url.searchParams.get("status"),
      warehouse: url.searchParams.get("warehouse"),
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
    const actor = authorizeRequestAnyOf(req, ["putaway.manage", "putaway.execute", "quality.decide"]);
    const body = await parseJsonBody<Parameters<typeof createPutawayTask>[1]>(req);
    return await withIdempotency(req, "/api/v1/putaway/tasks", body, async () => {
      const task = createPutawayTask(actor, body);
      return {
        status: 201,
        body: { task }
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
