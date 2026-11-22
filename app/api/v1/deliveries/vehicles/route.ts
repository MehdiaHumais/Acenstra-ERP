import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { listVehicles, getVehicle } from "@/server/services/loading-delivery.service";
import { getDb } from "@/server/db/connection";
import { recordAuditEvent } from "@/server/security/auth";

export async function GET(req: NextRequest) {
  try {
    authorizeRequest(req, "deliveries:read");
    const { searchParams } = new URL(req.url);

    const vehicleId = searchParams.get("id");
    if (vehicleId) {
      const vehicle = getVehicle(vehicleId);
      return NextResponse.json({ vehicle });
    }

    const vehicles = listVehicles({
      warehouse: searchParams.get("warehouse") || undefined,
      status: searchParams.get("status") || undefined,
      temperature_capability: searchParams.get("temperature_capability") || undefined,
    });

    return NextResponse.json({ vehicles });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "deliveries:update");
    const body = await parseJsonBody<{
      registration_number: string;
      vehicle_name: string;
      make_model: string;
      vehicle_type: "van_3_5t" | "rigid_truck_7_5t" | "rigid_truck_18t" | "artic_semi_26t";
      warehouse?: string;
      max_payload_kg: number;
      max_pallets: number;
      max_volume_m3: number;
      temperature_capability: "multi_temp" | "chilled" | "frozen" | "ambient";
      has_chilled_compartment?: boolean;
      has_frozen_compartment?: boolean;
      has_ambient_compartment?: boolean;
      inspection_expiry_date?: string;
      atp_expiry_date?: string;
      notes?: string;
    }>(req);

    return await withIdempotency(req, "/api/v1/deliveries/vehicles", body, () => {
      const db = getDb();
      const id = `VEH-${Date.now().toString().slice(-4)}`;
      db.prepare(`
        INSERT INTO vehicles (
          id, registration_number, vehicle_name, make_model, vehicle_type, warehouse,
          max_payload_kg, max_pallets, max_volume_m3, temperature_capability,
          has_chilled_compartment, has_frozen_compartment, has_ambient_compartment,
          status, inspection_status, inspection_expiry_date, atp_expiry_date, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'passed', ?, ?, ?)
      `).run(
        id,
        body.registration_number,
        body.vehicle_name,
        body.make_model,
        body.vehicle_type,
        body.warehouse || "Milan Cold Hub",
        body.max_payload_kg,
        body.max_pallets,
        body.max_volume_m3,
        body.temperature_capability,
        body.has_chilled_compartment !== false ? 1 : 0,
        body.has_frozen_compartment ? 1 : 0,
        body.has_ambient_compartment !== false ? 1 : 0,
        body.inspection_expiry_date || null,
        body.atp_expiry_date || null,
        body.notes || null
      );

      recordAuditEvent({
        actor,
        action: "vehicle.created",
        entityType: "Vehicle",
        entityId: id,
        after: body,
      });

      const vehicle = getVehicle(id);
      return { status: 201, body: { vehicle } };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
