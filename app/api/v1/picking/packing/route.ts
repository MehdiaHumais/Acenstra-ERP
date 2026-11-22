import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { createPackingRecord, getPackingRecord } from "@/server/services/picking-packing.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "warehouse:read");
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id") || searchParams.get("order_number") || searchParams.get("sscc");

    if (!id) {
      return NextResponse.json({ error: "Packing ID, order_number, or sscc required" }, { status: 400 });
    }

    const pack = getPackingRecord(actor, id);
    return NextResponse.json(pack);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "warehouse:update");
    const body = await parseJsonBody<{
      order_id: string;
      wave_id?: string;
      package_type?: "pallet" | "carton" | "crate" | "insulated_box";
      temp_zone?: "ambient" | "chilled" | "frozen";
      checklist: {
        temp_condition_verified: boolean;
        segregation_verified: boolean;
        packaging_condition_verified: boolean;
        customer_instructions_verified: boolean;
      };
      notes?: string;
    }>(req);

    return await withIdempotency(req, "/api/v1/picking/packing", body, () => {
      const packing = createPackingRecord(actor, body);
      return { status: 201, body: packing };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
