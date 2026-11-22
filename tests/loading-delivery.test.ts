import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextRequest } from "next/server";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ascentra-loading-delivery-test-"));
const tmpDbPath = path.join(tmpDir, "test-loading-delivery.sqlite");
process.env.SQLITE_DB_PATH = tmpDbPath;
process.env.SEED_DEMO_DATA = "true";

import { getDb } from "@/server/db/connection";
import { signAccessToken } from "@/server/security/crypto";
import { AuthenticatedUser } from "@/server/security/auth";
import {
  listDeliveryPlans,
  getDeliveryPlan,
  generateDeliveryFromStagedOrders,
  listVehicles,
  getVehicle,
  listDrivers,
  getDriver,
  assignVehicleAndDriver,
  submitPreLoadingInspection,
  verifyManifestLoadingScan,
  dispatchDelivery,
  updateStopStatus,
  recordTransportTemperature,
  recordDeliveryException,
  captureProofOfDelivery,
  processOfflineSyncQueue,
} from "@/server/services/loading-delivery.service";

import { GET as getPlanRoute, POST as postPlanRoute } from "@/app/api/v1/deliveries/plan/route";
import { POST as postAssignRoute } from "@/app/api/v1/deliveries/assign/route";
import { POST as postInspectionRoute } from "@/app/api/v1/deliveries/inspections/route";
import { GET as getManifestRoute, POST as postManifestScanRoute } from "@/app/api/v1/deliveries/[id]/manifest/route";
import { POST as postDispatchRoute } from "@/app/api/v1/deliveries/[id]/dispatch/route";
import { POST as postTempRoute } from "@/app/api/v1/deliveries/[id]/temperature/route";
import { POST as postPodRoute } from "@/app/api/v1/deliveries/[id]/pod/route";
import { POST as postExceptionRoute } from "@/app/api/v1/deliveries/[id]/exception/route";
import { POST as postSyncRoute } from "@/app/api/v1/deliveries/sync/route";

function makeReq(
  urlPath: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    idempotencyKey?: string;
  } = {}
): NextRequest {
  const headers = new Headers();
  if (options.token) {
    headers.set("authorization", `Bearer ${options.token}`);
  }
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (options.idempotencyKey) {
    headers.set("idempotency-key", options.idempotencyKey);
  }

  const url = `http://localhost:3000${urlPath}`;
  return new NextRequest(url, {
    method: options.method || (options.body !== undefined ? "POST" : "GET"),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

describe("Module 09: Loading and Delivery (Vehicle Assignment, Dispatch, Driver PWA & POD)", () => {
  let adminActor: AuthenticatedUser;
  let driverActor: AuthenticatedUser;
  let otherDriverActor: AuthenticatedUser;
  let adminToken: string;
  let driverToken: string;

  before(async () => {
    getDb();

    adminActor = {
      id: "USR-ADMIN",
      email: "elena.conti@ascentra.it",
      name: "Elena Conti",
      role: "super_admin",
      roles: ["super_admin"],
      store_id: null,
      warehouse: "Milan Cold Hub",
      mfa_enabled: false,
    };

    driverActor = {
      id: "USR-DRV",
      email: "davide.galli@ascentra.it",
      name: "Davide Galli",
      role: "driver",
      roles: ["driver"],
      store_id: null,
      warehouse: "Milan Cold Hub",
      mfa_enabled: false,
    };

    otherDriverActor = {
      id: "USR-DRV-COSTA",
      email: "stefano.costa@ascentra.it",
      name: "Stefano Costa",
      role: "driver",
      roles: ["driver"],
      store_id: null,
      warehouse: "Milan Cold Hub",
      mfa_enabled: false,
    };

    adminToken = signAccessToken({
      sub: adminActor.id,
      email: adminActor.email,
      name: adminActor.name,
      role: adminActor.role,
      store_id: null,
      warehouse: adminActor.warehouse,
    });
    driverToken = signAccessToken({
      sub: driverActor.id,
      email: driverActor.email,
      name: driverActor.name,
      role: driverActor.role,
      store_id: null,
      warehouse: driverActor.warehouse,
    });
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // --------------------------------------------------------------------------
  // 1. Database Seeding & Fleet Roster
  // --------------------------------------------------------------------------
  it("seeds vehicles and drivers correctly into database", () => {
    const vehicles = listVehicles();
    assert.ok(vehicles.length >= 5, "Expected at least 5 vehicles seeded");
    const iveco = vehicles.find((v) => v.registration_number === "MI-892-FR");
    assert.ok(iveco, "Expected IVECO Eurocargo MI-892-FR to be seeded");
    assert.equal(iveco.max_payload_kg, 4500);
    assert.equal(iveco.has_chilled_compartment, true);

    const drivers = listDrivers();
    assert.ok(drivers.length >= 4, "Expected at least 4 drivers seeded");
    const davide = drivers.find((d) => d.name === "Davide Galli");
    assert.ok(davide, "Expected driver Davide Galli to be seeded");
    assert.equal(davide.license_type, "C+CQC");
    assert.equal(davide.status, "available");
  });

  // --------------------------------------------------------------------------
  // 2. Delivery Planning from Staged Orders
  // --------------------------------------------------------------------------
  let testDeliveryId: string;

  it("generates delivery plan from customer order with manifest items and stops", () => {
    const delivery = generateDeliveryFromStagedOrders(adminActor, {
      order_ids: ["SO-2026-9841"],
      route_code: "RT-MIL-N1",
      delivery_date: "2026-11-06",
      time_window_start: "09:00",
      time_window_end: "11:00",
      priority: "high",
    });

    assert.ok(delivery.id, "Expected delivery id");
    assert.equal(delivery.route_code, "RT-MIL-N1");
    assert.equal(delivery.customer, "Ristorante Cracco Galleria");
    assert.ok(delivery.total_cases > 0, "Expected cases to be populated");
    assert.ok(delivery.total_weight_kg > 0, "Expected weight to be calculated");
    assert.ok(delivery.manifest_items && delivery.manifest_items.length > 0, "Expected manifest items");
    assert.ok(delivery.stops && delivery.stops.length > 0, "Expected route stops");
    assert.equal(delivery.status, "planned");

    testDeliveryId = delivery.id;
  });

  it("rejects delivery plan generation with empty orders list", () => {
    assert.throws(
      () => {
        generateDeliveryFromStagedOrders(adminActor, {
          order_ids: [],
          route_code: "RT-MIL-N1",
        });
      },
      (err: any) => err.code === "MISSING_ORDERS"
    );
  });

  // --------------------------------------------------------------------------
  // 3. Vehicle and Driver Assignment
  // --------------------------------------------------------------------------
  it("assigns vehicle and driver to planned delivery", () => {
    const assigned = assignVehicleAndDriver(adminActor, {
      delivery_id: testDeliveryId,
      vehicle_id: "VEH-001",
      driver_id: "DRV-001",
    });

    assert.equal(assigned.vehicle_id, "VEH-001");
    assert.equal(assigned.driver_id, "DRV-001");
    assert.equal(assigned.driver, "Davide Galli");
    assert.equal(assigned.status, "assigned");
  });

  it("prevents vehicle assignment when delivery payload exceeds vehicle capacity", () => {
    const db = getDb();
    // Temporarily increase delivery weight to 10,000 kg
    db.prepare(`UPDATE deliveries SET total_weight_kg = 10000 WHERE id = ?`).run(testDeliveryId);

    // VEH-002 (Mercedes Sprinter) has max payload of 1,400 kg
    assert.throws(
      () => {
        assignVehicleAndDriver(adminActor, {
          delivery_id: testDeliveryId,
          vehicle_id: "VEH-002",
          driver_id: "DRV-001",
        });
      },
      (err: any) => err.code === "EXCEEDS_VEHICLE_PAYLOAD"
    );

    // Restore delivery weight
    db.prepare(`UPDATE deliveries SET total_weight_kg = 85.5 WHERE id = ?`).run(testDeliveryId);
  });

  it("prevents assigning vehicle in maintenance status", () => {
    // VEH-005 is in maintenance
    assert.throws(
      () => {
        assignVehicleAndDriver(adminActor, {
          delivery_id: testDeliveryId,
          vehicle_id: "VEH-005",
          driver_id: "DRV-001",
        });
      },
      (err: any) => err.code === "VEHICLE_UNAVAILABLE"
    );
  });

  // --------------------------------------------------------------------------
  // 4. Pre-Loading Vehicle Safety & Temperature Inspection
  // --------------------------------------------------------------------------
  it("blocks dispatch if mandatory safety checks fail", () => {
    // Submit failed inspection (dirty vehicle, broken reefer)
    const inspection = submitPreLoadingInspection(adminActor, {
      vehicle_id: "VEH-001",
      driver_id: "DRV-001",
      delivery_id: testDeliveryId,
      cleanliness_passed: false,
      cleanliness_notes: "Cargo bay floor dirty",
      vehicle_condition_passed: true,
      reefer_functioning: false,
      chilled_temp_c: 8.5, // > 4.0
      compartment_dividers_secure: true,
      load_capacity_valid: true,
      transport_documents_verified: true,
      driver_confirmed: true,
    });

    assert.equal(inspection.status, "failed");
    assert.ok(inspection.failed_reason?.includes("cleanliness"), "Expected failure reason recorded");

    // Attempting to dispatch must be blocked
    assert.throws(
      () => {
        dispatchDelivery(adminActor, testDeliveryId);
      },
      (err: any) => err.code === "PRE_LOADING_CHECK_FAILED"
    );
  });

  it("passes inspection when all safety and temperature standards are met", () => {
    const inspection = submitPreLoadingInspection(adminActor, {
      vehicle_id: "VEH-001",
      driver_id: "DRV-001",
      delivery_id: testDeliveryId,
      cleanliness_passed: true,
      vehicle_condition_passed: true,
      reefer_functioning: true,
      chilled_temp_c: 2.1,
      frozen_temp_c: -19.0,
      compartment_dividers_secure: true,
      load_capacity_valid: true,
      transport_documents_verified: true,
      driver_confirmed: true,
    });

    assert.equal(inspection.status, "passed");
    const updated = getDeliveryPlan(testDeliveryId, adminActor);
    assert.equal(updated.status, "ready_for_loading");
  });

  // --------------------------------------------------------------------------
  // 5. Loading Workflow & Manifest Barcode Scanning
  // --------------------------------------------------------------------------
  it("rejects unassigned or invalid barcode scan during loading", () => {
    assert.throws(
      () => {
        verifyManifestLoadingScan(adminActor, {
          delivery_id: testDeliveryId,
          scanned_barcode: "INVALID-BARCODE-9999",
          compartment: "chilled",
        });
      },
      (err: any) => err.code === "UNVERIFIED_PACKAGE_BLOCKED"
    );
  });

  it("verifies package loading barcode and advances delivery loading progress", () => {
    const plan = getDeliveryPlan(testDeliveryId, adminActor);
    const firstItem = plan.manifest_items![0];
    const barcodeToScan = firstItem.sscc_barcode || firstItem.sku;

    const res = verifyManifestLoadingScan(adminActor, {
      delivery_id: testDeliveryId,
      scanned_barcode: barcodeToScan,
      compartment: "chilled",
    });

    assert.equal(res.success, true);
    assert.ok(res.loaded_count >= 1);
    assert.equal(res.matched_item.is_scanned_loaded, true);

    // Verify all remaining items to reach 'loaded' status
    for (let i = 1; i < plan.manifest_items!.length; i++) {
      const itm = plan.manifest_items![i];
      verifyManifestLoadingScan(adminActor, {
        delivery_id: testDeliveryId,
        scanned_barcode: itm.sscc_barcode || itm.sku,
        compartment: "chilled",
      });
    }

    const fullyLoaded = getDeliveryPlan(testDeliveryId, adminActor);
    assert.equal(fullyLoaded.status, "loaded");
  });

  // --------------------------------------------------------------------------
  // 6. Dispatch & Transit Execution
  // --------------------------------------------------------------------------
  it("dispatches loaded delivery and updates driver to on_route", () => {
    const dispatched = dispatchDelivery(adminActor, testDeliveryId);
    assert.equal(dispatched.status, "in_transit");
    assert.ok(dispatched.departure_time, "Expected departure time");

    const driver = getDriver("DRV-001");
    assert.equal(driver.status, "on_route");

    // Update stop arrival
    const stop = dispatched.stops![0];
    const updatedStop = updateStopStatus(adminActor, {
      stop_id: stop.id,
      stop_status: "arrived",
    });
    assert.equal(updatedStop.stop_status, "arrived");
  });

  // --------------------------------------------------------------------------
  // 7. Cold Chain Transport Temperature Monitoring & Excursions
  // --------------------------------------------------------------------------
  it("logs compliant transport temperature reading", () => {
    const log = recordTransportTemperature(adminActor, {
      delivery_id: testDeliveryId,
      compartment: "chilled",
      stage: "in_transit",
      actual_temp_c: 2.8,
      notes: "Thermo King unit maintaining steady 2.8°C",
    });

    assert.equal(log.is_excursion, false);
    assert.equal(log.actual_temp_c, 2.8);
  });

  it("detects cold chain temperature excursion and triggers quality alert", () => {
    const excLog = recordTransportTemperature(adminActor, {
      delivery_id: testDeliveryId,
      compartment: "chilled",
      stage: "in_transit",
      actual_temp_c: 6.4, // Exceeds 4.0°C limit
      notes: "Door open during traffic inspection",
    });

    assert.equal(excLog.is_excursion, true);
    assert.equal(excLog.excursion_severity, "warning");

    const del = getDeliveryPlan(testDeliveryId, adminActor);
    assert.ok(del.exception?.includes("Cold Chain Excursion"), "Expected cold chain excursion flagged on delivery");

    // Verify alert event created
    const db = getDb();
    const alert = db.prepare(`SELECT * FROM alert_events WHERE module = 'Cold Chain' ORDER BY created_at DESC LIMIT 1`).get() as any;
    assert.ok(alert, "Expected Cold Chain alert created in alert_events");
  });

  // --------------------------------------------------------------------------
  // 8. Delivery Exceptions
  // --------------------------------------------------------------------------
  it("records delivery exception with photographic evidence and follow-up action", () => {
    const exc = recordDeliveryException(adminActor, {
      delivery_id: testDeliveryId,
      exception_type: "damaged_goods",
      severity: "medium",
      reason: "One carton crushed during sudden braking on A4 highway",
      affected_cases: 1,
      customer_acknowledged: true,
      follow_up_action: "credit_note",
    });

    assert.equal(exc.exception_type, "damaged_goods");
    assert.equal(exc.follow_up_action, "credit_note");
    assert.equal(exc.customer_acknowledged, true);
  });

  // --------------------------------------------------------------------------
  // 9. Proof of Delivery (POD) Capture
  // --------------------------------------------------------------------------
  it("rejects POD submission with missing recipient name or signature", () => {
    assert.throws(
      () => {
        captureProofOfDelivery(adminActor, {
          delivery_id: testDeliveryId,
          recipient_name: "",
          signature_data: "data:image/png;base64,sample",
          delivered_cases: 8,
          accepted_cases: 8,
        });
      },
      (err: any) => err.code === "MISSING_RECIPIENT"
    );

    assert.throws(
      () => {
        captureProofOfDelivery(adminActor, {
          delivery_id: testDeliveryId,
          recipient_name: "Marco Rossi",
          signature_data: "",
          delivered_cases: 8,
          accepted_cases: 8,
        });
      },
      (err: any) => err.code === "MISSING_SIGNATURE"
    );
  });

  it("captures valid digital proof of delivery and marks delivery and sales order complete", () => {
    // Complete any other deliveries assigned to DRV-001 so this is the final stop
    const db = getDb();
    db.prepare(`UPDATE deliveries SET status = 'delivered' WHERE driver_id = 'DRV-001' AND id != ?`).run(testDeliveryId);

    const pod = captureProofOfDelivery(adminActor, {
      delivery_id: testDeliveryId,
      recipient_name: "Carlo Cracco",
      recipient_role: "Executive Chef & Owner",
      signature_data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      delivered_cases: 8,
      accepted_cases: 7,
      rejected_cases: 1,
      delivery_notes: "1 case damaged credited, 7 cases accepted in cold room",
    });

    assert.equal(pod.recipient_name, "Carlo Cracco");
    assert.equal(pod.accepted_cases, 7);
    assert.equal(pod.rejected_cases, 1);

    const delivery = getDeliveryPlan(testDeliveryId, adminActor);
    assert.equal(delivery.pod_signed, true);
    assert.equal(delivery.status, "partially_delivered");
    assert.ok(delivery.completed_time, "Expected completed time");

    // Driver status returns to available
    const driver = getDriver("DRV-001");
    assert.equal(driver.status, "available");
  });

  // --------------------------------------------------------------------------
  // 10. Offline Synchronization Queue & Idempotency
  // --------------------------------------------------------------------------
  it("processes offline action queue idempotently without duplicate records", () => {
    const syncActionId = `SYNC-TEST-${Date.now()}`;
    const idempKey = `IDEMP-TEST-${Date.now()}`;

    const batch = [
      {
        sync_action_id: syncActionId,
        idempotency_key: idempKey,
        action_type: "LOG_TEMPERATURE" as const,
        payload: {
          delivery_id: testDeliveryId,
          compartment: "chilled" as const,
          stage: "delivery" as const,
          actual_temp_c: 3.1,
          notes: "Recorded offline at customer loading bay",
        },
        device_timestamp: "2026-11-06T10:15:00Z",
      },
    ];

    // First synchronization run
    const result1 = processOfflineSyncQueue(adminActor, batch);
    assert.equal(result1.synced_count, 1);
    assert.equal(result1.failed_count, 0);

    // Second synchronization run with exact same sync_action_id and idempotency_key
    const result2 = processOfflineSyncQueue(adminActor, batch);
    assert.equal(result2.synced_count, 1);
    assert.equal(result2.results[0].status, "synced");
    assert.ok(result2.results[0].message?.includes("idempotent duplicate"));
  });

  // --------------------------------------------------------------------------
  // 11. Driver Scoped Data Isolation (IDOR Protection)
  // --------------------------------------------------------------------------
  it("enforces driver-specific delivery isolation (driver cannot access another driver's loads)", () => {
    // otherDriverActor is Stefano Costa; testDeliveryId is assigned to Davide Galli
    assert.throws(
      () => {
        getDeliveryPlan(testDeliveryId, otherDriverActor);
      },
      (err: any) => err.status === 403 || err.code === "FORBIDDEN"
    );

    // Davide Galli can access his own delivery without error
    const plan = getDeliveryPlan(testDeliveryId, driverActor);
    assert.equal(plan.id, testDeliveryId);
  });

  // --------------------------------------------------------------------------
  // 12. REST API Integration Endpoints
  // --------------------------------------------------------------------------
  it("API: GET /api/v1/deliveries/plan returns list of delivery plans", async () => {
    const req = makeReq("/api/v1/deliveries/plan", { token: adminToken });
    const res = await getPlanRoute(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.deliveries));
  });

  it("API: POST /api/v1/deliveries/sync flushes offline driver action queue", async () => {
    const req = makeReq("/api/v1/deliveries/sync", {
      token: adminToken,
      method: "POST",
      body: {
        actions: [
          {
            sync_action_id: `API-SYNC-${Date.now()}`,
            idempotency_key: `API-IDEMP-${Date.now()}`,
            action_type: "LOG_TEMPERATURE",
            payload: {
              delivery_id: testDeliveryId,
              compartment: "ambient",
              stage: "post_loading",
              actual_temp_c: 16.5,
            },
            device_timestamp: new Date().toISOString(),
          },
        ],
      },
    });

    const res = await postSyncRoute(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.synced_count, 1);
  });
});
