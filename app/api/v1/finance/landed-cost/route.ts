import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { listLandedCostAllocations, allocateLandedCost } from "@/server/services/finance.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "finance:read");
    const allocations = listLandedCostAllocations();
    return NextResponse.json({ allocations, count: allocations.length });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "finance:landed_cost");
    const body = await parseJsonBody<{
      po_id?: string;
      batch_id?: string;
      allocation_method: "quantity" | "weight" | "volume" | "value" | "manual";
      freight_cents: number;
      customs_duty_cents: number;
      insurance_cents: number;
      handling_cents: number;
      other_cents?: number;
      notes?: string;
      items?: Array<{
        sku: string;
        batch_id: string;
        cases: number;
        weight_kg: number;
        base_purchase_cost_cents: number;
      }>;
    }>(req);

    return await withIdempotency(req, "/api/v1/finance/landed-cost", body, () => {
      const allocation = allocateLandedCost(actor, body);
      return {
        status: 201,
        body: {
          message: `Landed cost allocation ${allocation.allocation_number} applied (€${(allocation.total_landed_cost_cents / 100).toFixed(2)})`,
          allocation,
        },
      };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
