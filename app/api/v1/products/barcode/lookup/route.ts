import { NextRequest, NextResponse } from "next/server";
import {
  authorizeRequest,
  handleApiError,
  parseJsonBody
} from "@/server/core/http";
import {
  lookupBarcode,
  recordScanEvent
} from "@/server/services/product-barcode.service";
import {
  externalBarcodeLookup,
  externalLookupEnabled
} from "@/server/services/external-barcode.service";

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "products:read");
    const body = await parseJsonBody<{
      barcode: string;
      operation?: string;
      reference_id?: string;
      quantity?: number;
      result?: string;
    }>(req);

    const lookup = lookupBarcode(actor, body.barcode);

    if (body.operation) {
      recordScanEvent(actor, {
        barcode: lookup.barcode,
        operation: body.operation,
        reference_id: body.reference_id ?? null,
        quantity: body.quantity ?? null,
        result: body.result ?? (lookup.found ? "matched" : "unknown_barcode"),
        product_id: lookup.product ? String(lookup.product.id) : null,
        product_sku: lookup.product?.sku ?? null
      });
    }

    // Local registry is authoritative. If it misses, ask the configured external
    // catalogue for a read-only suggestion. External data is NEVER written to the
    // ERP without explicit human confirmation.
    let external: Awaited<ReturnType<typeof externalBarcodeLookup>> | null = null;
    const externalEnabled = externalLookupEnabled();
    if (!lookup.found && externalEnabled) {
      external = await externalBarcodeLookup(lookup.barcode);
    }

    return NextResponse.json({
      ...lookup,
      external: external ? external.preview : null,
      external_status: external ? external.status : "disabled",
      external_reason: external?.reason ?? null,
      external_provider: external?.provider ?? null,
      external_enabled: externalEnabled
    });
  } catch (err) {
    return handleApiError(err);
  }
}
