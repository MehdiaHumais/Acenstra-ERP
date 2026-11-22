import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, withIdempotency } from "@/server/core/http";
import { generateInvoiceXml } from "@/server/services/sdi-einvoice.service";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const actor = authorizeRequest(req, "finance:sdi");
    const { id } = await Promise.resolve(params);

    return await withIdempotency(req, `/api/v1/finance/sdi/${id}/generate-xml`, {}, () => {
      const result = generateInvoiceXml(actor, id);
      return {
        status: 200,
        body: {
          message: result.validation.isValid
            ? `FatturaPA XML generated and verified against SDI specifications: ${result.fileName}`
            : `FatturaPA XML generated with ${result.validation.errors.length} validation errors`,
          fileName: result.fileName,
          validation: result.validation,
          xml: result.xml,
        },
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
