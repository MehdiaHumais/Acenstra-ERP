import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { createException, listExceptions } from "@/server/services/quality-gate.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "quality.read");
    const url = new URL(req.url);
    const exceptions = listExceptions(actor, {
      status: url.searchParams.get("status"),
      severity: url.searchParams.get("severity"),
      warehouse: url.searchParams.get("warehouse"),
      search: url.searchParams.get("search"),
      lot: url.searchParams.get("lot")
    });
    return NextResponse.json({ exceptions });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "quality.inspect");
    const body = await parseJsonBody<Parameters<typeof createException>[1]>(req);
    return await withIdempotency(req, "/api/v1/quality/exceptions", body, async () => {
      const exception = createException(actor, body);
      return {
        status: 201,
        body: { exception }
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
