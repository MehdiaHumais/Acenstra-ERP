import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { deleteQuotation, listRfqs } from "@/server/services/procurement.service";

export async function DELETE(
  req: NextRequest,
  context: { params: { id: string; quotationId: string } }
) {
  try {
    const actor = authorizeRequest(req, "suppliers:write");
    const rfq = deleteQuotation(
      actor,
      decodeURIComponent(context.params.id),
      decodeURIComponent(context.params.quotationId)
    );
    return NextResponse.json({ rfq, rfqs: listRfqs() });
  } catch (err) {
    return handleApiError(err);
  }
}
