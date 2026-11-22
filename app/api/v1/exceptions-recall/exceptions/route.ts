import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { listExceptions, createException } from "@/server/services/exceptions-recall.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "quality.read");
    const { searchParams } = new URL(req.url);

    const status = searchParams.get("status") || undefined;
    const severity = searchParams.get("severity") || undefined;
    const exception_type = searchParams.get("exception_type") || undefined;
    const lot_id = searchParams.get("lot_id") || undefined;
    const warehouse = searchParams.get("warehouse") || undefined;

    const exceptions = listExceptions({ status, severity, exception_type, lot_id, warehouse }, actor);
    return NextResponse.json({ exceptions, count: exceptions.length });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "quality.inspect");
    const body = await parseJsonBody<any>(req);

    return await withIdempotency(req, "/api/v1/exceptions-recall/exceptions", body, () => {
      const exception = createException(body, actor);
      return {
        status: 201,
        body: {
          message: `Quality exception ${exception.exception_number} created successfully`,
          exception,
        },
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
