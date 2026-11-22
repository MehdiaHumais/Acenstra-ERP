import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import { verifyPutawayScan } from "@/server/services/putaway.service";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = authorizeRequest(req, "putaway.execute");
    const { id } = await context.params;
    const body = await parseJsonBody<Parameters<typeof verifyPutawayScan>[2]>(req);
    const result = verifyPutawayScan(actor, id, body);
    return NextResponse.json(result, { status: result.valid ? 200 : 400 });
  } catch (err) {
    return handleApiError(err);
  }
}
