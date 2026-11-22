import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { getInvoice } from "@/server/services/finance.service";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const actor = authorizeRequest(req, "finance:read");
    const { id } = await Promise.resolve(params);
    const invoice = getInvoice(actor, id);
    return NextResponse.json({ invoice });
  } catch (err) {
    return handleApiError(err);
  }
}
