import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { submitPreLoadingInspection } from "@/server/services/loading-delivery.service";

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "deliveries:update");
    const body = await parseJsonBody<{
      vehicle_id: string;
      driver_id: string;
      route_code?: string;
      delivery_id?: string;
      cleanliness_passed: boolean;
      cleanliness_notes?: string;
      vehicle_condition_passed: boolean;
      vehicle_condition_notes?: string;
      reefer_functioning: boolean;
      chilled_temp_c?: number;
      frozen_temp_c?: number;
      compartment_dividers_secure: boolean;
      load_capacity_valid: boolean;
      transport_documents_verified: boolean;
      driver_confirmed: boolean;
    }>(req);

    return await withIdempotency(req, "/api/v1/deliveries/inspections", body, () => {
      const inspection = submitPreLoadingInspection(actor, body);
      return { status: 201, body: { inspection } };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
