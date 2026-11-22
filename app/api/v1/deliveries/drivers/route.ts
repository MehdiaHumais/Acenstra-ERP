import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody, withIdempotency } from "@/server/core/http";
import { listDrivers, getDriver } from "@/server/services/loading-delivery.service";
import { getDb } from "@/server/db/connection";
import { recordAuditEvent } from "@/server/security/auth";

export async function GET(req: NextRequest) {
  try {
    authorizeRequest(req, "deliveries:read");
    const { searchParams } = new URL(req.url);

    const driverId = searchParams.get("id");
    if (driverId) {
      const driver = getDriver(driverId);
      return NextResponse.json({ driver });
    }

    const drivers = listDrivers({
      warehouse: searchParams.get("warehouse") || undefined,
      status: searchParams.get("status") || undefined,
    });

    return NextResponse.json({ drivers });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "deliveries:update");
    const body = await parseJsonBody<{
      user_id?: string;
      name: string;
      email: string;
      phone: string;
      warehouse?: string;
      license_number: string;
      license_type: string;
      license_expiry_date: string;
      cqc_expiry_date?: string;
      medical_expiry_date?: string;
      notes?: string;
    }>(req);

    return await withIdempotency(req, "/api/v1/deliveries/drivers", body, () => {
      const db = getDb();
      const id = `DRV-${Date.now().toString().slice(-4)}`;
      db.prepare(`
        INSERT INTO drivers (
          id, user_id, name, email, phone, warehouse, license_number, license_type,
          license_expiry_date, cqc_expiry_date, medical_expiry_date, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?)
      `).run(
        id,
        body.user_id || null,
        body.name,
        body.email,
        body.phone,
        body.warehouse || "Milan Cold Hub",
        body.license_number,
        body.license_type,
        body.license_expiry_date,
        body.cqc_expiry_date || null,
        body.medical_expiry_date || null,
        body.notes || null
      );

      recordAuditEvent({
        actor,
        action: "driver.created",
        entityType: "Driver",
        entityId: id,
        after: body,
      });

      const driver = getDriver(id);
      return { status: 201, body: { driver } };
    });
  } catch (err) {
    return handleApiError(err);
  }
}
