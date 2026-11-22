import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { deleteProductCertificate } from "@/server/services/product-master.service";

export async function DELETE(
  req: NextRequest,
  context: { params: { sku: string; id: string } },
) {
  try {
    const actor = authorizeRequest(req, "products:write");
    const result = deleteProductCertificate(
      actor,
      decodeURIComponent(context.params.sku),
      decodeURIComponent(context.params.id),
    );
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
