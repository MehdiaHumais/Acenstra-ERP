import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { createHaccpTemplate, listHaccpTemplates } from "@/server/services/quality-gate.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "quality.inspect");
    const url = new URL(req.url);
    const templates = listHaccpTemplates(actor, {
      sku: url.searchParams.get("sku"),
      category: url.searchParams.get("category")
    });
    return NextResponse.json({ templates });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "quality.inspect");
    const body = await parseJsonBody<Parameters<typeof createHaccpTemplate>[1]>(req);
    return await withIdempotency(req, "/api/v1/quality/haccp-templates", body, async () => {
      const template = createHaccpTemplate(actor, body);
      return {
        status: 201,
        body: { template }
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
