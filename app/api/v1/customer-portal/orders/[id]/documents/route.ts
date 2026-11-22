import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import {
  listCustomerOrderDocuments,
  renderCustomerOrderDocument,
  CustomerOrderDocumentType
} from "@/server/services/customer-order.service";

const DOCUMENT_TYPES: CustomerOrderDocumentType[] = ["confirmation", "delivery_note", "invoice"];

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const actor = authorizeRequest(req, "orders.read");
    const url = new URL(req.url);
    const type = url.searchParams.get("type") as CustomerOrderDocumentType | null;
    const format = (url.searchParams.get("format") || "json").toLowerCase();

    if (!type) {
      return NextResponse.json({ documents: listCustomerOrderDocuments(actor, params.id) });
    }

    if (!DOCUMENT_TYPES.includes(type)) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_DOCUMENT_TYPE",
            message: `Document type must be one of: ${DOCUMENT_TYPES.join(", ")}.`
          }
        },
        { status: 400 }
      );
    }

    const rendered = renderCustomerOrderDocument(actor, params.id, type);
    if (format === "html") {
      return new NextResponse(rendered.html, {
        status: 200,
        headers: {
          "Content-Type": rendered.content_type,
          "Content-Disposition": `inline; filename="${rendered.filename}"`
        }
      });
    }

    return NextResponse.json({
      document: rendered.document,
      filename: rendered.filename,
      content_type: rendered.content_type,
      html: rendered.html
    });
  } catch (err) {
    return handleApiError(err);
  }
}
