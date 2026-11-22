import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { listRecalls, initiateRecall } from "@/server/services/exceptions-recall.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "quality.read");
    const { searchParams } = new URL(req.url);

    const status = searchParams.get("status") || undefined;
    const classification = searchParams.get("classification") || undefined;
    const sku = searchParams.get("sku") || undefined;
    const lot = searchParams.get("lot") || undefined;

    const recalls = listRecalls({ status, classification, sku, lot }, actor);
    return NextResponse.json({ recalls, count: recalls.length });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "recalls.manage");
    const body = await parseJsonBody<any>(req);

    return await withIdempotency(req, "/api/v1/exceptions-recall/recalls", body, () => {
      const recall = initiateRecall(body, actor);
      return {
        status: 201,
        body: {
          message: `Product recall ${recall.recall_number} initiated successfully`,
          recall,
        },
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
