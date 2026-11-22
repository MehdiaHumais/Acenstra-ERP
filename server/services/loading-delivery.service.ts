import { getDb, withTransaction } from "@/server/db/connection";
import { ApiError } from "@/server/core/http";
import {
  AuthenticatedUser,
  assertPermission,
  recordAuditEvent,
  requireAssignedDelivery,
  requireMutationAuthorization,
} from "@/server/security/auth";
import type {
  DetailedDelivery,
  DeliveryLifecycleStatus,
  Vehicle,
  Driver,
  DeliveryStop,
  DeliveryManifestItem,
  VehicleInspection,
  DeliveryTemperatureLog,
  DeliveryProof,
  DeliveryException,
  OfflineSyncQueueItem,
} from "@/lib/types";

// ============================================================================
// Helpers
// ============================================================================

function generateId(prefix: string): string {
  const rand = Math.floor(1000 + Math.random() * 9000);
  const now = Date.now().toString().slice(-4);
  return `${prefix}-${now}-${rand}`;
}

function formatDate(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

// ============================================================================
// 1. Delivery Planning & Queries
// ============================================================================

export function listDeliveryPlans(
  actor?: AuthenticatedUser,
  filters?: {
    warehouse?: string;
    status?: string;
    route_code?: string;
    driver_id?: string;
    date?: string;
  }
): DetailedDelivery[] {
  const db = getDb();
  let query = `
    SELECT
      id, delivery_reference, order_id, order_number, customer_id, customer,
      delivery_address, warehouse, delivery_date, time_window_start, time_window_end,
      route_code, driver_id, driver, vehicle_id, vehicle, stop_sequence, eta,
      temp_c, status, pod_signed, stops_completed, stops_total, priority,
      total_packages, total_pallets, total_cases, total_weight_kg,
      departure_time, arrival_time, completed_time, driver_notes, exception,
      created_at, updated_at
    FROM deliveries
  `;
  const conditions: string[] = [];
  const params: any[] = [];

  // Driver scoping (IDOR protection)
  if (actor?.role === "driver") {
    conditions.push("(driver_id = ? OR lower(driver) = lower(?) OR lower(driver) = lower(?) OR lower(driver) = lower(?))");
    params.push(actor.id, actor.name, actor.email, actor.id);
  } else if ((actor?.role === "store_vendor" || actor?.role === "store_user") && actor.store_id) {
    conditions.push("(customer_id = ? OR lower(customer) LIKE lower(?))");
    params.push(actor.store_id, `%${actor.store_id}%`);
  }

  if (filters?.warehouse) {
    conditions.push("warehouse = ?");
    params.push(filters.warehouse);
  }
  if (filters?.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters?.route_code) {
    conditions.push("route_code = ?");
    params.push(filters.route_code);
  }
  if (filters?.driver_id) {
    conditions.push("driver_id = ?");
    params.push(filters.driver_id);
  }
  if (filters?.date) {
    conditions.push("delivery_date = ?");
    params.push(filters.date);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }
  query += ` ORDER BY stop_sequence ASC, id DESC`;

  const rows = db.prepare(query).all(...params) as any[];
  return rows.map(mapDeliveryRow);
}

export function getDeliveryPlan(deliveryId: string, actor?: AuthenticatedUser): DetailedDelivery {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM deliveries WHERE id = ? OR delivery_reference = ? OR order_number = ?`).get(deliveryId, deliveryId, deliveryId) as any;
  if (!row) {
    throw new ApiError(404, "DELIVERY_NOT_FOUND", `Delivery '${deliveryId}' not found.`);
  }

  if (actor?.role === "driver") {
    requireAssignedDelivery(actor, row.driver);
  }

  const delivery = mapDeliveryRow(row);

  // Fetch related data
  delivery.manifest_items = db.prepare(`SELECT * FROM delivery_manifest_items WHERE delivery_id = ? ORDER BY loading_sequence ASC`).all(delivery.id) as any[];
  delivery.stops = db.prepare(`SELECT * FROM delivery_stops WHERE delivery_id = ? ORDER BY stop_number ASC`).all(delivery.id) as any[];
  delivery.temperature_logs = db.prepare(`SELECT * FROM delivery_temperature_logs WHERE delivery_id = ? ORDER BY recorded_at DESC`).all(delivery.id) as any[];
  delivery.inspections = db.prepare(`SELECT * FROM vehicle_inspections WHERE delivery_id = ? OR vehicle_id = ? ORDER BY inspected_at DESC`).all(delivery.id, delivery.vehicle_id ?? "") as any[];
  delivery.proof_of_delivery = (db.prepare(`SELECT * FROM delivery_proofs WHERE delivery_id = ?`).get(delivery.id) as any) ?? null;
  delivery.exceptions = db.prepare(`SELECT * FROM delivery_exceptions WHERE delivery_id = ? ORDER BY reported_at DESC`).all(delivery.id) as any[];

  return delivery;
}

function mapDeliveryRow(row: any): DetailedDelivery {
  return {
    id: row.id,
    delivery_reference: row.delivery_reference || row.id,
    order_id: row.order_id,
    order_number: row.order_number,
    customer_id: row.customer_id || "CUST-B2B-01",
    customer: row.customer,
    delivery_address: row.delivery_address || "",
    warehouse: row.warehouse || "Milan Cold Hub",
    delivery_date: row.delivery_date || formatDate(),
    time_window_start: row.time_window_start || "08:00",
    time_window_end: row.time_window_end || "12:00",
    route_code: row.route_code,
    driver_id: row.driver_id || null,
    driver: row.driver,
    vehicle_id: row.vehicle_id || null,
    vehicle: row.vehicle,
    stop_sequence: Number(row.stop_sequence ?? 1),
    eta: row.eta,
    temp_c: Number(row.temp_c ?? 2.0),
    status: row.status as DeliveryLifecycleStatus,
    pod_signed: Boolean(row.pod_signed),
    stops_completed: Number(row.stops_completed ?? 0),
    stops_total: Number(row.stops_total ?? 1),
    priority: (row.priority as any) || "normal",
    total_packages: Number(row.total_packages ?? 0),
    total_pallets: Number(row.total_pallets ?? 0),
    total_cases: Number(row.total_cases ?? 0),
    total_weight_kg: Number(row.total_weight_kg ?? 0),
    departure_time: row.departure_time || null,
    arrival_time: row.arrival_time || null,
    completed_time: row.completed_time || null,
    driver_notes: row.driver_notes || null,
    exception: row.exception || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function generateDeliveryFromStagedOrders(
  actor: AuthenticatedUser,
  input: {
    order_ids: string[];
    route_code: string;
    delivery_date?: string;
    time_window_start?: string;
    time_window_end?: string;
    priority?: "low" | "normal" | "high" | "urgent";
    vehicle_id?: string;
    driver_id?: string;
    warehouse?: string;
  }
): DetailedDelivery {
  assertPermission(actor, "deliveries:update");
  requireMutationAuthorization(actor, "plan delivery");

  if (!input.order_ids || input.order_ids.length === 0) {
    throw new ApiError(400, "MISSING_ORDERS", "At least one order must be specified for delivery planning.");
  }

  const db = getDb();
  return withTransaction(() => {
    // 1. Gather all sales orders and packing records
    let totalCases = 0;
    let totalWeightKg = 0;
    let totalPackages = 0;
    let totalPallets = 0;
    let firstCustomerName = "";
    let firstCustomerId = "";
    let firstDeliveryAddress = "";
    const orderNumbers: string[] = [];
    const manifestItemsToInsert: any[] = [];

    for (const orderId of input.order_ids) {
      const order = db.prepare(`SELECT * FROM sales_orders WHERE id = ? OR order_number = ?`).get(orderId, orderId) as any;
      if (!order) {
        throw new ApiError(404, "ORDER_NOT_FOUND", `Order '${orderId}' not found.`);
      }
      orderNumbers.push(order.order_number);

      if (!firstCustomerName) {
        firstCustomerName = order.customer || order.customer_name || "Customer";
        firstCustomerId = order.customer_id;
        firstDeliveryAddress = order.delivery_address || "Customer Delivery Dock";
      }

      // Check packing records for this order
      const packRecords = db.prepare(`SELECT * FROM packing_records WHERE order_id = ? OR order_number = ?`).all(order.id, order.order_number) as any[];

      if (packRecords.length > 0) {
        for (const pr of packRecords) {
          totalPackages += 1;
          if (pr.package_type === "pallet") totalPallets += 1;
          totalCases += Number(pr.total_cases ?? 0);
          totalWeightKg += Number(pr.total_weight_kg ?? 0);

          // Get packing record items
          const items = db.prepare(`SELECT * FROM packing_record_items WHERE packing_id = ?`).all(pr.id) as any[];
          for (const item of items) {
            manifestItemsToInsert.push({
              order_id: order.id,
              order_number: order.order_number,
              order_line_id: item.pick_task_id || null,
              packing_record_id: pr.id,
              sscc_barcode: pr.sscc_barcode,
              container_id: pr.container_id,
              sku: item.sku,
              product_name: item.product_name,
              lot_batch: item.lot_batch,
              cases: Number(item.cases_packed),
              weight_kg: Number(item.weight_kg),
              uom: item.uom || "case",
              temp_zone: pr.temp_zone || "chilled",
              compartment: pr.temp_zone === "frozen" ? "frozen" : pr.temp_zone === "ambient" ? "ambient" : "chilled",
            });
          }
        }
      } else {
        // Fallback to order lines if not yet packed into packing_records (for flexible testing)
        const lines = db.prepare(`SELECT * FROM sales_order_lines WHERE order_id = ?`).all(order.id) as any[];
        for (const line of lines) {
          const cases = Number(line.cases_confirmed ?? line.cases_ordered);
          const weight = cases * 10; // 10kg estimated
          totalCases += cases;
          totalWeightKg += weight;
          totalPackages += 1;
          manifestItemsToInsert.push({
            order_id: order.id,
            order_number: order.order_number,
            order_line_id: line.id,
            packing_record_id: null,
            sscc_barcode: `SSCC-18-MAN-${order.order_number.slice(-4)}-${line.sku.slice(-3)}`,
            container_id: `CTN-${order.order_number.slice(-4)}-${line.sku.slice(-3)}`,
            sku: line.sku,
            product_name: line.product_name,
            lot_batch: "ALLOC-BATCH-AUTO",
            cases,
            weight_kg: weight,
            uom: line.uom || "case",
            temp_zone: "chilled",
            compartment: "chilled",
          });
        }
      }
    }

    if (totalPallets === 0 && totalPackages > 0) {
      totalPallets = Math.max(1, Math.ceil(totalPackages / 10));
    }

    const deliveryId = generateId("DEL-2026");
    const deliveryRef = deliveryId;
    const warehouse = input.warehouse || "Milan Cold Hub";
    const deliveryDate = input.delivery_date || formatDate();
    const timeStart = input.time_window_start || "08:30";
    const timeEnd = input.time_window_end || "11:30";
    const priority = input.priority || "normal";

    let vehicleReg = "TBD";
    let driverName = "Unassigned";

    if (input.vehicle_id) {
      const v = db.prepare(`SELECT * FROM vehicles WHERE id = ?`).get(input.vehicle_id) as any;
      if (v) vehicleReg = v.registration_number;
    }
    if (input.driver_id) {
      const d = db.prepare(`SELECT * FROM drivers WHERE id = ?`).get(input.driver_id) as any;
      if (d) driverName = d.name;
    }

    // Insert delivery record
    db.prepare(`
      INSERT INTO deliveries (
        id, delivery_reference, order_id, order_number, customer_id, customer,
        delivery_address, warehouse, delivery_date, time_window_start, time_window_end,
        route_code, driver_id, driver, vehicle_id, vehicle, stop_sequence, eta,
        temp_c, status, pod_signed, stops_completed, stops_total, priority,
        total_packages, total_pallets, total_cases, total_weight_kg,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      deliveryId,
      deliveryRef,
      input.order_ids[0],
      orderNumbers.join(", "),
      firstCustomerId,
      firstCustomerName,
      firstDeliveryAddress,
      warehouse,
      deliveryDate,
      timeStart,
      timeEnd,
      input.route_code,
      input.driver_id || null,
      driverName,
      input.vehicle_id || null,
      vehicleReg,
      1,
      `${timeStart} - ${timeEnd}`,
      2.0,
      input.vehicle_id && input.driver_id ? "assigned" : "planned",
      0,
      0,
      input.order_ids.length,
      priority,
      totalPackages,
      totalPallets,
      totalCases,
      totalWeightKg
    );

    // Insert manifest items
    let seq = 1;
    const insertManifestItem = db.prepare(`
      INSERT INTO delivery_manifest_items (
        id, manifest_number, delivery_id, order_id, order_number, order_line_id,
        packing_record_id, sscc_barcode, container_id, sku, product_name, lot_batch,
        cases, weight_kg, uom, temp_zone, compartment, loading_sequence, is_scanned_loaded
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);

    for (const item of manifestItemsToInsert) {
      insertManifestItem.run(
        generateId("MNF-ITM"),
        `MNF-${deliveryId}`,
        deliveryId,
        item.order_id,
        item.order_number,
        item.order_line_id,
        item.packing_record_id,
        item.sscc_barcode,
        item.container_id,
        item.sku,
        item.product_name,
        item.lot_batch,
        item.cases,
        item.weight_kg,
        item.uom,
        item.temp_zone,
        item.compartment,
        seq++
      );
    }

    // Insert delivery stops
    let stopNum = 1;
    const insertStop = db.prepare(`
      INSERT INTO delivery_stops (
        id, delivery_id, route_code, stop_number, customer_id, customer_name,
        delivery_address, time_window_start, time_window_end, stop_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `);

    for (const orderId of input.order_ids) {
      const ord = db.prepare(`SELECT * FROM sales_orders WHERE id = ? OR order_number = ?`).get(orderId, orderId) as any;
      if (ord) {
        insertStop.run(
          generateId("STP"),
          deliveryId,
          input.route_code,
          stopNum++,
          ord.customer_id,
          ord.customer || ord.customer_name || "Customer",
          ord.delivery_address || firstDeliveryAddress,
          timeStart,
          timeEnd
        );
      }
    }

    recordAuditEvent({
      actor,
      action: "delivery.plan_created",
      entityType: "Delivery",
      entityId: deliveryId,
      after: {
        deliveryId,
        orders: orderNumbers,
        route: input.route_code,
        totalCases,
        totalWeightKg,
      },
    });

    return getDeliveryPlan(deliveryId, actor);
  });
}

// ============================================================================
// 2. Vehicle & Driver Assignment
// ============================================================================

export function listVehicles(filters?: {
  warehouse?: string;
  status?: string;
  temperature_capability?: string;
}): Vehicle[] {
  const db = getDb();
  let query = "SELECT * FROM vehicles";
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters?.warehouse) {
    conditions.push("warehouse = ?");
    params.push(filters.warehouse);
  }
  if (filters?.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters?.temperature_capability) {
    conditions.push("temperature_capability = ?");
    params.push(filters.temperature_capability);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }
  query += " ORDER BY vehicle_name ASC";

  const rows = db.prepare(query).all(...params) as any[];
  return rows.map((r) => ({
    ...r,
    has_chilled_compartment: Boolean(r.has_chilled_compartment),
    has_frozen_compartment: Boolean(r.has_frozen_compartment),
    has_ambient_compartment: Boolean(r.has_ambient_compartment),
  }));
}

export function getVehicle(vehicleId: string): Vehicle {
  const db = getDb();
  const r = db.prepare(`SELECT * FROM vehicles WHERE id = ? OR registration_number = ?`).get(vehicleId, vehicleId) as any;
  if (!r) throw new ApiError(404, "VEHICLE_NOT_FOUND", `Vehicle '${vehicleId}' not found.`);
  return {
    ...r,
    has_chilled_compartment: Boolean(r.has_chilled_compartment),
    has_frozen_compartment: Boolean(r.has_frozen_compartment),
    has_ambient_compartment: Boolean(r.has_ambient_compartment),
  };
}

export function listDrivers(filters?: { warehouse?: string; status?: string }): Driver[] {
  const db = getDb();
  let query = "SELECT * FROM drivers";
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters?.warehouse) {
    conditions.push("warehouse = ?");
    params.push(filters.warehouse);
  }
  if (filters?.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }
  query += " ORDER BY name ASC";

  return db.prepare(query).all(...params) as Driver[];
}

export function getDriver(driverId: string): Driver {
  const db = getDb();
  const r = db.prepare(`SELECT * FROM drivers WHERE id = ? OR email = ? OR user_id = ?`).get(driverId, driverId, driverId) as any;
  if (!r) throw new ApiError(404, "DRIVER_NOT_FOUND", `Driver '${driverId}' not found.`);
  return r as Driver;
}

export function assignVehicleAndDriver(
  actor: AuthenticatedUser,
  input: {
    delivery_id: string;
    vehicle_id: string;
    driver_id: string;
    override_capacity_check?: boolean;
  }
): DetailedDelivery {
  assertPermission(actor, "deliveries:update");
  requireMutationAuthorization(actor, "assign vehicle and driver");

  const db = getDb();
  return withTransaction(() => {
    const delivery = db.prepare(`SELECT * FROM deliveries WHERE id = ? OR delivery_reference = ?`).get(input.delivery_id, input.delivery_id) as any;
    if (!delivery) {
      throw new ApiError(404, "DELIVERY_NOT_FOUND", `Delivery '${input.delivery_id}' not found.`);
    }

    const vehicle = getVehicle(input.vehicle_id);
    const driver = getDriver(input.driver_id);

    // 1. Vehicle status & inspection checks
    if (vehicle.status !== "active") {
      throw new ApiError(400, "VEHICLE_UNAVAILABLE", `Vehicle '${vehicle.registration_number}' is currently in status '${vehicle.status}'.`);
    }
    if (vehicle.inspection_status === "failed") {
      throw new ApiError(400, "VEHICLE_INSPECTION_FAILED", `Vehicle '${vehicle.registration_number}' failed inspection and cannot be assigned.`);
    }

    // 2. Capacity validations
    if (!input.override_capacity_check) {
      const deliveryWeight = Number(delivery.total_weight_kg ?? 0);
      const deliveryPallets = Number(delivery.total_pallets ?? 0);

      if (deliveryWeight > vehicle.max_payload_kg) {
        throw new ApiError(
          400,
          "EXCEEDS_VEHICLE_PAYLOAD",
          `Delivery load weight (${deliveryWeight} kg) exceeds vehicle max payload (${vehicle.max_payload_kg} kg) for vehicle '${vehicle.registration_number}'.`
        );
      }

      if (deliveryPallets > vehicle.max_pallets) {
        throw new ApiError(
          400,
          "EXCEEDS_VEHICLE_PALLETS",
          `Delivery pallet count (${deliveryPallets}) exceeds vehicle max pallet capacity (${vehicle.max_pallets}) for vehicle '${vehicle.registration_number}'.`
        );
      }
    }

    // 3. Temperature capability validation
    const manifestItems = db.prepare(`SELECT * FROM delivery_manifest_items WHERE delivery_id = ?`).all(delivery.id) as any[];
    const hasFrozenItems = manifestItems.some((i) => i.temp_zone === "frozen" || i.compartment === "frozen");
    if (hasFrozenItems && !vehicle.has_frozen_compartment) {
      throw new ApiError(
        400,
        "TEMPERATURE_CAPABILITY_MISMATCH",
        `Delivery contains frozen items, but vehicle '${vehicle.registration_number}' does not have a frozen compartment.`
      );
    }

    // 4. Driver validations
    if (driver.status === "suspended" || driver.status === "off_duty") {
      throw new ApiError(400, "DRIVER_UNAVAILABLE", `Driver '${driver.name}' is currently '${driver.status}'.`);
    }

    // Check license expiry
    const today = formatDate();
    if (driver.license_expiry_date && driver.license_expiry_date < today) {
      throw new ApiError(400, "DRIVER_LICENSE_EXPIRED", `Driver '${driver.name}' driver licence expired on ${driver.license_expiry_date}.`);
    }

    // Update delivery record
    db.prepare(`
      UPDATE deliveries SET
        vehicle_id = ?,
        vehicle = ?,
        driver_id = ?,
        driver = ?,
        status = CASE WHEN status = 'planned' THEN 'assigned' ELSE status END,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(vehicle.id, vehicle.registration_number, driver.id, driver.name, delivery.id);

    // Update driver assigned vehicle
    db.prepare(`UPDATE drivers SET assigned_vehicle_id = ?, current_route_code = ?, updated_at = datetime('now') WHERE id = ?`).run(
      vehicle.id,
      delivery.route_code,
      driver.id
    );

    recordAuditEvent({
      actor,
      action: "delivery.vehicle_driver_assigned",
      entityType: "Delivery",
      entityId: delivery.id,
      after: {
        deliveryId: delivery.id,
        vehicle: vehicle.registration_number,
        driver: driver.name,
      },
    });

    return getDeliveryPlan(delivery.id, actor);
  });
}

// ============================================================================
// 3. Pre-Loading Checks
// ============================================================================

export function submitPreLoadingInspection(
  actor: AuthenticatedUser,
  input: {
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
  }
): VehicleInspection {
  assertPermission(actor, "deliveries:update");
  requireMutationAuthorization(actor, "submit pre-loading inspection");

  const db = getDb();
  return withTransaction(() => {
    const vehicle = getVehicle(input.vehicle_id);
    const driver = getDriver(input.driver_id);

    // Evaluate temperature checks
    const chilledValid = input.chilled_temp_c === undefined || input.chilled_temp_c === null || (input.chilled_temp_c >= -1.0 && input.chilled_temp_c <= 4.0);
    const frozenValid = input.frozen_temp_c === undefined || input.frozen_temp_c === null || input.frozen_temp_c <= -15.0;

    const allPassed =
      Boolean(input.cleanliness_passed) &&
      Boolean(input.vehicle_condition_passed) &&
      Boolean(input.reefer_functioning) &&
      chilledValid &&
      frozenValid &&
      Boolean(input.compartment_dividers_secure) &&
      Boolean(input.load_capacity_valid) &&
      Boolean(input.transport_documents_verified) &&
      Boolean(input.driver_confirmed);

    let failedReasons: string[] = [];
    if (!input.cleanliness_passed) failedReasons.push("Vehicle cleanliness check failed.");
    if (!input.vehicle_condition_passed) failedReasons.push("Vehicle physical condition check failed.");
    if (!input.reefer_functioning) failedReasons.push("Refrigeration unit not functioning.");
    if (!chilledValid) failedReasons.push(`Chilled temp (${input.chilled_temp_c}°C) exceeds max limit of 4.0°C.`);
    if (!frozenValid) failedReasons.push(`Frozen temp (${input.frozen_temp_c}°C) exceeds max limit of -15.0°C.`);
    if (!input.compartment_dividers_secure) failedReasons.push("Compartment dividers not secure.");
    if (!input.load_capacity_valid) failedReasons.push("Load capacity validation failed.");
    if (!input.transport_documents_verified) failedReasons.push("Transport documents missing or unverified.");
    if (!input.driver_confirmed) failedReasons.push("Driver did not confirm inspection checklist.");

    const inspId = generateId("INSP-2026");
    const status = allPassed ? "passed" : "failed";
    const failedReasonStr = failedReasons.length > 0 ? failedReasons.join("; ") : null;

    db.prepare(`
      INSERT INTO vehicle_inspections (
        id, inspection_number, vehicle_id, vehicle_registration, driver_id, driver_name,
        warehouse, route_code, delivery_id, cleanliness_passed, cleanliness_notes,
        vehicle_condition_passed, vehicle_condition_notes, reefer_functioning,
        chilled_temp_c, chilled_temp_valid, frozen_temp_c, frozen_temp_valid,
        compartment_dividers_secure, load_capacity_valid, transport_documents_verified,
        driver_confirmed, status, failed_reason, inspected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      inspId,
      inspId,
      vehicle.id,
      vehicle.registration_number,
      driver.id,
      driver.name,
      vehicle.warehouse,
      input.route_code || null,
      input.delivery_id || null,
      input.cleanliness_passed ? 1 : 0,
      input.cleanliness_notes || null,
      input.vehicle_condition_passed ? 1 : 0,
      input.vehicle_condition_notes || null,
      input.reefer_functioning ? 1 : 0,
      input.chilled_temp_c ?? null,
      chilledValid ? 1 : 0,
      input.frozen_temp_c ?? null,
      frozenValid ? 1 : 0,
      input.compartment_dividers_secure ? 1 : 0,
      input.load_capacity_valid ? 1 : 0,
      input.transport_documents_verified ? 1 : 0,
      input.driver_confirmed ? 1 : 0,
      status,
      failedReasonStr
    );

    // Update vehicle inspection status
    db.prepare(`UPDATE vehicles SET inspection_status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, vehicle.id);

    // If linked to delivery, update delivery status
    if (input.delivery_id) {
      if (allPassed) {
        db.prepare(`
          UPDATE deliveries SET
            status = 'ready_for_loading',
            updated_at = datetime('now')
          WHERE id = ? AND status IN ('planned', 'assigned')
        `).run(input.delivery_id);
      } else {
        db.prepare(`
          UPDATE deliveries SET
            exception = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(`Pre-loading inspection failed: ${failedReasonStr}`, input.delivery_id);
      }
    }

    recordAuditEvent({
      actor,
      action: "delivery.pre_loading_inspection",
      entityType: "VehicleInspection",
      entityId: inspId,
      after: {
        vehicle: vehicle.registration_number,
        driver: driver.name,
        status,
        failedReasonStr,
      },
    });

    const inspRow = db.prepare(`SELECT * FROM vehicle_inspections WHERE id = ?`).get(inspId) as any;
    return {
      ...inspRow,
      cleanliness_passed: Boolean(inspRow.cleanliness_passed),
      vehicle_condition_passed: Boolean(inspRow.vehicle_condition_passed),
      reefer_functioning: Boolean(inspRow.reefer_functioning),
      chilled_temp_valid: Boolean(inspRow.chilled_temp_valid),
      frozen_temp_valid: Boolean(inspRow.frozen_temp_valid),
      compartment_dividers_secure: Boolean(inspRow.compartment_dividers_secure),
      load_capacity_valid: Boolean(inspRow.load_capacity_valid),
      transport_documents_verified: Boolean(inspRow.transport_documents_verified),
      driver_confirmed: Boolean(inspRow.driver_confirmed),
    };
  });
}

// ============================================================================
// 4. Loading Workflow & Manifest Barcode Verification
// ============================================================================

export function verifyManifestLoadingScan(
  actor: AuthenticatedUser,
  input: {
    delivery_id: string;
    scanned_barcode: string;
    compartment?: "chilled" | "frozen" | "ambient";
  }
): {
  success: boolean;
  message: string;
  loaded_count: number;
  total_count: number;
  is_delivery_fully_loaded: boolean;
  matched_item: DeliveryManifestItem;
} {
  assertPermission(actor, "deliveries:update");
  requireMutationAuthorization(actor, "verify loading barcode");

  const db = getDb();
  return withTransaction(() => {
    const delivery = db.prepare(`SELECT * FROM deliveries WHERE id = ? OR delivery_reference = ?`).get(input.delivery_id, input.delivery_id) as any;
    if (!delivery) {
      throw new ApiError(404, "DELIVERY_NOT_FOUND", `Delivery '${input.delivery_id}' not found.`);
    }

    if (actor.role === "driver") {
      requireAssignedDelivery(actor, delivery.driver);
    }

    // Require vehicle inspection pass before loading
    const passedInspection = db.prepare(`SELECT * FROM vehicle_inspections WHERE (delivery_id = ? OR vehicle_id = ?) AND status = 'passed' ORDER BY inspected_at DESC LIMIT 1`).get(delivery.id, delivery.vehicle_id ?? "") as any;
    if (!passedInspection) {
      throw new ApiError(
        400,
        "PRE_LOADING_CHECK_REQUIRED",
        `Pre-loading inspection has not been passed for vehicle '${delivery.vehicle}'. You cannot load packages until safety checks pass.`
      );
    }

    // Find matching manifest item by SSCC barcode, container ID, SKU, or lot batch
    const barcode = input.scanned_barcode.trim();
    const item = db.prepare(`
      SELECT * FROM delivery_manifest_items
      WHERE delivery_id = ? AND (
        sscc_barcode = ? OR container_id = ? OR sku = ? OR lot_batch = ?
      )
      ORDER BY is_scanned_loaded ASC, loading_sequence ASC
      LIMIT 1
    `).get(delivery.id, barcode, barcode, barcode, barcode) as any;

    if (!item) {
      throw new ApiError(
        400,
        "UNVERIFIED_PACKAGE_BLOCKED",
        `Barcode '${barcode}' does not belong to delivery '${delivery.id}'. Unassigned packages cannot be loaded onto vehicle '${delivery.vehicle}'.`
      );
    }

    // Compartment check if specified
    const targetCompartment = input.compartment || item.compartment;
    if (item.temp_zone === "frozen" && targetCompartment !== "frozen") {
      throw new ApiError(
        400,
        "TEMPERATURE_SEGREGATION_ERROR",
        `Item '${item.sku}' requires frozen storage but was scanned into '${targetCompartment}' compartment.`
      );
    }

    // Mark item as scanned loaded
    db.prepare(`
      UPDATE delivery_manifest_items SET
        is_scanned_loaded = 1,
        scanned_barcode = ?,
        compartment = ?,
        scanned_at = datetime('now'),
        scanned_by = ?
      WHERE id = ?
    `).run(barcode, targetCompartment, actor.name, item.id);

    // Count totals
    const totalItems = (db.prepare(`SELECT COUNT(*) as c FROM delivery_manifest_items WHERE delivery_id = ?`).get(delivery.id) as any).c;
    const loadedItems = (db.prepare(`SELECT COUNT(*) as c FROM delivery_manifest_items WHERE delivery_id = ? AND is_scanned_loaded = 1`).get(delivery.id) as any).c;
    const isComplete = loadedItems >= totalItems;

    // Advance delivery status
    const newStatus = isComplete ? "loaded" : "loading";
    db.prepare(`
      UPDATE deliveries SET
        status = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(newStatus, delivery.id);

    recordAuditEvent({
      actor,
      action: "delivery.manifest_item_loaded",
      entityType: "DeliveryManifestItem",
      entityId: item.id,
      after: {
        deliveryId: delivery.id,
        barcode,
        sku: item.sku,
        lot: item.lot_batch,
        loadedItems,
        totalItems,
        isComplete,
      },
    });

    const updatedItem = db.prepare(`SELECT * FROM delivery_manifest_items WHERE id = ?`).get(item.id) as any;
    return {
      success: true,
      message: `Package '${barcode}' (${item.product_name}) verified and loaded into ${targetCompartment} compartment.`,
      loaded_count: loadedItems,
      total_count: totalItems,
      is_delivery_fully_loaded: isComplete,
      matched_item: {
        ...updatedItem,
        is_scanned_loaded: Boolean(updatedItem.is_scanned_loaded),
      },
    };
  });
}

// ============================================================================
// 5. Dispatch & Route Execution
// ============================================================================

export function dispatchDelivery(
  actor: AuthenticatedUser,
  deliveryId: string,
  input?: { departure_time?: string; odometer_km?: number }
): DetailedDelivery {
  assertPermission(actor, "deliveries:update");
  requireMutationAuthorization(actor, "dispatch delivery");

  const db = getDb();
  return withTransaction(() => {
    const delivery = db.prepare(`SELECT * FROM deliveries WHERE id = ? OR delivery_reference = ?`).get(deliveryId, deliveryId) as any;
    if (!delivery) {
      throw new ApiError(404, "DELIVERY_NOT_FOUND", `Delivery '${deliveryId}' not found.`);
    }

    if (actor.role === "driver") {
      requireAssignedDelivery(actor, delivery.driver);
    }

    // Require vehicle inspection pass
    const inspection = db.prepare(`SELECT * FROM vehicle_inspections WHERE (delivery_id = ? OR vehicle_id = ?) AND status = 'passed' ORDER BY inspected_at DESC LIMIT 1`).get(delivery.id, delivery.vehicle_id ?? "") as any;
    if (!inspection) {
      throw new ApiError(
        400,
        "PRE_LOADING_CHECK_FAILED",
        `Pre-loading inspection must be passed before dispatching delivery '${delivery.id}'.`
      );
    }

    const departureTime = input?.departure_time || new Date().toISOString();

    db.prepare(`
      UPDATE deliveries SET
        status = 'in_transit',
        departure_time = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(departureTime, delivery.id);

    // Update driver status to on_route
    if (delivery.driver_id) {
      db.prepare(`UPDATE drivers SET status = 'on_route', updated_at = datetime('now') WHERE id = ?`).run(delivery.driver_id);
    }

    // Update sales orders to in_transit
    db.prepare(`
      UPDATE sales_orders SET
        status = 'in_transit',
        updated_at = datetime('now')
      WHERE id = ? OR order_number = ?
    `).run(delivery.order_id, delivery.order_number);

    recordAuditEvent({
      actor,
      action: "delivery.dispatched",
      entityType: "Delivery",
      entityId: delivery.id,
      after: {
        deliveryId: delivery.id,
        driver: delivery.driver,
        vehicle: delivery.vehicle,
        departureTime,
      },
    });

    return getDeliveryPlan(delivery.id, actor);
  });
}

export function updateStopStatus(
  actor: AuthenticatedUser,
  input: {
    stop_id: string;
    stop_status: "arrived" | "delivered" | "failed" | "skipped";
    arrival_time?: string;
    departure_time?: string;
  }
): DeliveryStop {
  assertPermission(actor, "deliveries:update");
  requireMutationAuthorization(actor, "update delivery stop");

  const db = getDb();
  return withTransaction(() => {
    const stop = db.prepare(`SELECT * FROM delivery_stops WHERE id = ?`).get(input.stop_id) as any;
    if (!stop) {
      throw new ApiError(404, "STOP_NOT_FOUND", `Delivery stop '${input.stop_id}' not found.`);
    }

    const delivery = db.prepare(`SELECT * FROM deliveries WHERE id = ?`).get(stop.delivery_id) as any;
    if (actor.role === "driver" && delivery) {
      requireAssignedDelivery(actor, delivery.driver);
    }

    const now = new Date().toISOString();
    const arrivalTime = input.arrival_time || (input.stop_status === "arrived" ? now : stop.arrival_time);
    const departureTime = input.departure_time || (input.stop_status === "delivered" || input.stop_status === "failed" ? now : stop.departure_time);

    db.prepare(`
      UPDATE delivery_stops SET
        stop_status = ?,
        arrival_time = ?,
        departure_time = ?
      WHERE id = ?
    `).run(input.stop_status, arrivalTime, departureTime, stop.id);

    // Update stops completed count on delivery
    const completedCount = (db.prepare(`SELECT COUNT(*) as c FROM delivery_stops WHERE delivery_id = ? AND stop_status IN ('delivered', 'failed', 'skipped')`).get(stop.delivery_id) as any).c;
    db.prepare(`UPDATE deliveries SET stops_completed = ?, updated_at = datetime('now') WHERE id = ?`).run(completedCount, stop.delivery_id);

    return db.prepare(`SELECT * FROM delivery_stops WHERE id = ?`).get(stop.id) as DeliveryStop;
  });
}

// ============================================================================
// 6. Transport Temperature Monitoring
// ============================================================================

export function recordTransportTemperature(
  actor: AuthenticatedUser,
  input: {
    delivery_id: string;
    compartment: "chilled" | "frozen" | "ambient";
    stage: "pre_loading" | "post_loading" | "in_transit" | "arrival" | "delivery";
    actual_temp_c: number;
    notes?: string;
  }
): DeliveryTemperatureLog {
  assertPermission(actor, "deliveries:update");
  requireMutationAuthorization(actor, "record temperature log");

  const db = getDb();
  return withTransaction(() => {
    const delivery = db.prepare(`SELECT * FROM deliveries WHERE id = ? OR delivery_reference = ?`).get(input.delivery_id, input.delivery_id) as any;
    if (!delivery) {
      throw new ApiError(404, "DELIVERY_NOT_FOUND", `Delivery '${input.delivery_id}' not found.`);
    }

    if (actor.role === "driver") {
      requireAssignedDelivery(actor, delivery.driver);
    }

    // Determine expected temperature thresholds
    let minC = 0.0;
    let maxC = 4.0;
    if (input.compartment === "frozen") {
      minC = -25.0;
      maxC = -15.0;
    } else if (input.compartment === "ambient") {
      minC = 10.0;
      maxC = 22.0;
    }

    const temp = Number(input.actual_temp_c);
    const isExcursion = temp < minC || temp > maxC;
    let severity: "warning" | "critical" | null = null;
    let qualityExceptionId: string | null = null;

    if (isExcursion) {
      if (input.compartment === "chilled" && temp > 8.0) severity = "critical";
      else if (input.compartment === "frozen" && temp > -10.0) severity = "critical";
      else severity = "warning";

      // Trigger Quality Exception workflow
      qualityExceptionId = generateId("QE-TEMP");
      const excTitle = `Cold Chain Excursion on Delivery ${delivery.id} (${input.compartment.toUpperCase()}: ${temp}°C)`;
      const excDetail = `Compartment ${input.compartment} temperature recorded at ${temp}°C (permitted limit: ${minC}°C to ${maxC}°C) during ${input.stage} by ${actor.name}. Temperature Excursion Hold applied.`;

      db.prepare(`
        INSERT INTO alert_events (id, severity, module, title, detail, created_at)
        VALUES (?, ?, 'Cold Chain', ?, ?, datetime('now'))
      `).run(generateId("ALT"), severity === "critical" ? "critical" : "warning", excTitle, excDetail);

      // Flag delivery with exception
      db.prepare(`
        UPDATE deliveries SET
          temp_c = ?,
          exception = ?,
          status = CASE WHEN status = 'in_transit' THEN 'in_transit' ELSE status END,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(temp, excTitle, delivery.id);
    } else {
      db.prepare(`UPDATE deliveries SET temp_c = ?, updated_at = datetime('now') WHERE id = ?`).run(temp, delivery.id);
    }

    const logId = generateId("TLOG");
    db.prepare(`
      INSERT INTO delivery_temperature_logs (
        id, delivery_id, vehicle_id, vehicle_registration, route_code, compartment,
        stage, expected_temp_min_c, expected_temp_max_c, actual_temp_c,
        is_excursion, excursion_severity, sensor_or_driver_id, recorded_by_name,
        quality_exception_id, notes, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      logId,
      delivery.id,
      delivery.vehicle_id || null,
      delivery.vehicle || null,
      delivery.route_code,
      input.compartment,
      input.stage,
      minC,
      maxC,
      temp,
      isExcursion ? 1 : 0,
      severity,
      actor.id,
      actor.name,
      qualityExceptionId,
      input.notes || null
    );

    recordAuditEvent({
      actor,
      action: "delivery.temperature_logged",
      entityType: "DeliveryTemperatureLog",
      entityId: logId,
      after: {
        deliveryId: delivery.id,
        compartment: input.compartment,
        actualTemp: temp,
        isExcursion,
        severity,
      },
    });

    const logRow = db.prepare(`SELECT * FROM delivery_temperature_logs WHERE id = ?`).get(logId) as any;
    return {
      ...logRow,
      is_excursion: Boolean(logRow.is_excursion),
    };
  });
}

// ============================================================================
// 7. Delivery Exceptions
// ============================================================================

export function recordDeliveryException(
  actor: AuthenticatedUser,
  input: {
    delivery_id: string;
    order_id?: string;
    order_number?: string;
    exception_type:
      | "customer_unavailable"
      | "delivery_refused"
      | "damaged_goods"
      | "missing_quantity"
      | "temperature_excursion"
      | "incorrect_product"
      | "access_issue"
      | "partial_delivery";
    severity?: "low" | "medium" | "high" | "critical";
    reason: string;
    affected_sku?: string;
    affected_lot?: string;
    affected_cases?: number;
    photo_url?: string;
    customer_acknowledged?: boolean;
    follow_up_action?: "return_to_warehouse" | "redeliver" | "credit_note" | "dispose" | "quarantine";
    resolution_notes?: string;
  }
): DeliveryException {
  assertPermission(actor, "deliveries:update");
  requireMutationAuthorization(actor, "record delivery exception");

  const db = getDb();
  return withTransaction(() => {
    const delivery = db.prepare(`SELECT * FROM deliveries WHERE id = ? OR delivery_reference = ?`).get(input.delivery_id, input.delivery_id) as any;
    if (!delivery) {
      throw new ApiError(404, "DELIVERY_NOT_FOUND", `Delivery '${input.delivery_id}' not found.`);
    }

    if (actor.role === "driver") {
      requireAssignedDelivery(actor, delivery.driver);
    }

    const excId = generateId("DEXC");
    const severity = input.severity || "medium";
    const followUp = input.follow_up_action || "return_to_warehouse";

    db.prepare(`
      INSERT INTO delivery_exceptions (
        id, delivery_id, order_id, order_number, exception_type, severity, reason,
        affected_sku, affected_lot, affected_cases, photo_url, customer_acknowledged,
        follow_up_action, driver_id, driver_name, reported_at, status, resolution_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'open', ?)
    `).run(
      excId,
      delivery.id,
      input.order_id || delivery.order_id,
      input.order_number || delivery.order_number,
      input.exception_type,
      severity,
      input.reason,
      input.affected_sku || null,
      input.affected_lot || null,
      input.affected_cases ?? null,
      input.photo_url || null,
      input.customer_acknowledged ? 1 : 0,
      followUp,
      actor.id,
      actor.name,
      input.resolution_notes || null
    );

    // Update delivery record status and exception notice
    const newStatus = input.exception_type === "partial_delivery" ? "partially_delivered" : "failed";
    db.prepare(`
      UPDATE deliveries SET
        status = ?,
        exception = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(newStatus, `Exception: ${input.exception_type} - ${input.reason}`, delivery.id);

    recordAuditEvent({
      actor,
      action: "delivery.exception_recorded",
      entityType: "DeliveryException",
      entityId: excId,
      after: {
        deliveryId: delivery.id,
        type: input.exception_type,
        reason: input.reason,
        severity,
        followUp,
      },
    });

    const excRow = db.prepare(`SELECT * FROM delivery_exceptions WHERE id = ?`).get(excId) as any;
    return {
      ...excRow,
      customer_acknowledged: Boolean(excRow.customer_acknowledged),
    };
  });
}

// ============================================================================
// 8. Proof of Delivery (POD)
// ============================================================================

export function captureProofOfDelivery(
  actor: AuthenticatedUser,
  input: {
    delivery_id: string;
    order_id?: string;
    order_number?: string;
    customer_id?: string;
    customer_name?: string;
    recipient_name: string;
    recipient_role?: string;
    signature_data: string;
    photo_url?: string;
    delivered_cases: number;
    accepted_cases: number;
    rejected_cases?: number;
    delivery_notes?: string;
  }
): DeliveryProof {
  assertPermission(actor, "deliveries:update");
  requireMutationAuthorization(actor, "capture proof of delivery");

  if (!input.recipient_name || input.recipient_name.trim().length === 0) {
    throw new ApiError(400, "MISSING_RECIPIENT", "Recipient name is required for proof of delivery confirmation.");
  }
  if (!input.signature_data || input.signature_data.trim().length === 0) {
    throw new ApiError(400, "MISSING_SIGNATURE", "Digital signature is required for proof of delivery confirmation.");
  }

  const db = getDb();
  return withTransaction(() => {
    const delivery = db.prepare(`SELECT * FROM deliveries WHERE id = ? OR delivery_reference = ?`).get(input.delivery_id, input.delivery_id) as any;
    if (!delivery) {
      throw new ApiError(404, "DELIVERY_NOT_FOUND", `Delivery '${input.delivery_id}' not found.`);
    }

    if (actor.role === "driver") {
      requireAssignedDelivery(actor, delivery.driver);
    }

    const podId = generateId("POD");
    const rejectedCases = Number(input.rejected_cases ?? 0);
    const deliveredCases = Number(input.delivered_cases);
    const acceptedCases = Number(input.accepted_cases);

    db.prepare(`
      INSERT INTO delivery_proofs (
        id, delivery_id, order_id, order_number, customer_id, customer_name,
        recipient_name, recipient_role, signature_data, photo_url,
        delivered_cases, accepted_cases, rejected_cases, driver_id, driver_name,
        delivery_notes, captured_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'synced')
    `).run(
      podId,
      delivery.id,
      input.order_id || delivery.order_id,
      input.order_number || delivery.order_number,
      input.customer_id || delivery.customer_id,
      input.customer_name || delivery.customer,
      input.recipient_name,
      input.recipient_role || "Receiving Clerk",
      input.signature_data,
      input.photo_url || null,
      deliveredCases,
      acceptedCases,
      rejectedCases,
      actor.id,
      actor.name,
      input.delivery_notes || null
    );

    // Update delivery record: pod_signed = 1, status = delivered, completed_time = now
    const now = new Date().toISOString();
    const finalStatus = rejectedCases > 0 ? "partially_delivered" : "delivered";
    db.prepare(`
      UPDATE deliveries SET
        pod_signed = 1,
        status = ?,
        stops_completed = stops_total,
        completed_time = ?,
        driver_notes = COALESCE(?, driver_notes),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(finalStatus, now, input.delivery_notes || null, delivery.id);

    // Update sales order to delivered
    db.prepare(`
      UPDATE sales_orders SET
        status = 'delivered',
        updated_at = datetime('now')
      WHERE id = ? OR order_number = ?
    `).run(delivery.order_id, delivery.order_number);

    // If driver has completed all deliveries, update status back to available
    if (delivery.driver_id) {
      const activeDeliveries = (db.prepare(`SELECT COUNT(*) as c FROM deliveries WHERE driver_id = ? AND status IN ('in_transit', 'loading')`).get(delivery.driver_id) as any).c;
      if (activeDeliveries === 0) {
        db.prepare(`UPDATE drivers SET status = 'available', current_route_code = NULL, updated_at = datetime('now') WHERE id = ?`).run(delivery.driver_id);
      }
    }

    recordAuditEvent({
      actor,
      action: "delivery.pod_captured",
      entityType: "DeliveryProof",
      entityId: podId,
      after: {
        deliveryId: delivery.id,
        recipient: input.recipient_name,
        acceptedCases,
        rejectedCases,
      },
    });

    return db.prepare(`SELECT * FROM delivery_proofs WHERE id = ?`).get(podId) as DeliveryProof;
  });
}

// ============================================================================
// 9. Offline Synchronization Queue
// ============================================================================

export function processOfflineSyncQueue(
  actor: AuthenticatedUser,
  actions: Array<{
    sync_action_id: string;
    idempotency_key: string;
    action_type:
      | "SUBMIT_INSPECTION"
      | "LOG_TEMPERATURE"
      | "SCAN_MANIFEST"
      | "START_TRANSIT"
      | "ARRIVE_STOP"
      | "SUBMIT_POD"
      | "REPORT_EXCEPTION";
    payload: any;
    device_timestamp: string;
  }>
): {
  synced_count: number;
  failed_count: number;
  results: Array<{
    sync_action_id: string;
    status: "synced" | "failed";
    message?: string;
    data?: any;
  }>;
} {
  assertPermission(actor, "deliveries:update");

  const db = getDb();
  let syncedCount = 0;
  let failedCount = 0;
  const results: Array<{
    sync_action_id: string;
    status: "synced" | "failed";
    message?: string;
    data?: any;
  }> = [];

  for (const item of actions) {
    try {
      // 1. Check idempotency: If already successfully synced, return previous result
      const existing = db.prepare(`SELECT * FROM offline_sync_queue WHERE sync_action_id = ? OR idempotency_key = ?`).get(item.sync_action_id, item.idempotency_key) as any;
      if (existing && existing.status === "synced") {
        syncedCount++;
        results.push({
          sync_action_id: item.sync_action_id,
          status: "synced",
          message: "Action already synchronized previously (idempotent duplicate skipped).",
        });
        continue;
      }

      // Record queue item as pending
      const queueId = existing?.id || generateId("SYNC");
      if (!existing) {
        db.prepare(`
          INSERT INTO offline_sync_queue (
            id, sync_action_id, idempotency_key, driver_id, action_type, payload_json, device_timestamp, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
        `).run(queueId, item.sync_action_id, item.idempotency_key, actor.id, item.action_type, JSON.stringify(item.payload), item.device_timestamp);
      }

      // 2. Execute business operation
      let opResult: any = null;
      switch (item.action_type) {
        case "SUBMIT_INSPECTION":
          opResult = submitPreLoadingInspection(actor, item.payload);
          break;
        case "LOG_TEMPERATURE":
          opResult = recordTransportTemperature(actor, item.payload);
          break;
        case "SCAN_MANIFEST":
          opResult = verifyManifestLoadingScan(actor, item.payload);
          break;
        case "START_TRANSIT":
          opResult = dispatchDelivery(actor, item.payload.delivery_id, item.payload);
          break;
        case "ARRIVE_STOP":
          opResult = updateStopStatus(actor, item.payload);
          break;
        case "SUBMIT_POD":
          opResult = captureProofOfDelivery(actor, item.payload);
          break;
        case "REPORT_EXCEPTION":
          opResult = recordDeliveryException(actor, item.payload);
          break;
        default:
          throw new ApiError(400, "INVALID_ACTION_TYPE", `Unknown offline action type '${item.action_type}'.`);
      }

      // Mark synced
      db.prepare(`UPDATE offline_sync_queue SET status = 'synced', processed_at = datetime('now') WHERE id = ?`).run(queueId);
      syncedCount++;
      results.push({
        sync_action_id: item.sync_action_id,
        status: "synced",
        message: "Successfully synchronized offline action.",
        data: opResult,
      });
    } catch (err: any) {
      failedCount++;
      const errorMessage = err?.message || "Failed to process offline action.";
      db.prepare(`UPDATE offline_sync_queue SET status = 'failed', error_message = ?, processed_at = datetime('now') WHERE sync_action_id = ?`).run(errorMessage, item.sync_action_id);
      results.push({
        sync_action_id: item.sync_action_id,
        status: "failed",
        message: errorMessage,
      });
    }
  }

  return {
    synced_count: syncedCount,
    failed_count: failedCount,
    results,
  };
}
