import { getDb, withTransaction } from "@/server/db/connection";
import { ApiError } from "@/server/core/http";
import {
  AuthenticatedUser,
  assertPermission,
  recordAuditEvent,
  requireMutationAuthorization
} from "@/server/security/auth";
import type { Product, Supplier } from "@/lib/types";
import { computeLandedCost, type ProcurementPurchaseOrder } from "@/lib/procurement";

function numericId(rawId: string, indexFallback: number): number {
  const digits = rawId.replace(/\D/g, "");
  if (digits.length > 0) {
    return Number(digits.slice(-6)) || indexFallback;
  }
  return indexFallback;
}

export function listProducts(): Product[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      p.id,
      p.sku,
      p.name,
      p.category,
      p.origin,
      p.uom,
      p.temp_zone,
      p.shelf_life_days,
      p.unit_price_cents,
      p.vat_rate_pct,
      p.supplier_name,
      p.status,
      COALESCE(SUM(CASE WHEN l.quality_status = 'released' THEN l.quantity_cases ELSE 0 END), 0) AS computed_stock_cases,
      p.stock_cases AS fallback_stock_cases
    FROM products p
    LEFT JOIN inventory_lots l ON l.sku = p.sku
    GROUP BY p.id
    ORDER BY p.sku ASC
  `).all() as Array<{
    id: string;
    sku: string;
    name: string;
    category: string;
    origin: string;
    uom: string;
    temp_zone: string;
    shelf_life_days: number;
    unit_price_cents: number;
    vat_rate_pct: number;
    supplier_name: string;
    status: string;
    computed_stock_cases: number;
    fallback_stock_cases: number;
  }>;

  return rows.map((r, idx) => {
    const isCatchWeight = r.category === "Seafood" || r.category === "Meat" || r.category === "Dairy";
    const allergens =
      r.category === "Seafood"
        ? ["Fish"]
        : r.category === "Dairy"
          ? ["Milk"]
          : r.category === "Pasta & Bakery"
            ? ["Gluten", "Eggs"]
            : [];

    return {
      id: numericId(r.id, idx + 1),
      sku: r.sku,
      name: r.name,
      category: r.category,
      unit: isCatchWeight ? "kg" : "case",
      pack_size: r.uom,
      temperature_profile: r.temp_zone,
      shelf_life_days: Number(r.shelf_life_days),
      min_shelf_life_days: Math.max(2, Math.floor(Number(r.shelf_life_days) * 0.4)),
      catch_weight: isCatchWeight,
      allergens,
      unit_price_cents: Number(r.unit_price_cents),
      supplier_name: r.supplier_name,
      status: r.status === "hold" ? "hold" : r.status === "discontinued" ? "discontinued" : "active"
    };
  });
}

export function createProduct(
  actor: AuthenticatedUser,
  input: {
    sku: string;
    name: string;
    category?: string;
    origin?: string;
    uom?: string;
    pack_size?: string;
    temp_zone?: string;
    temperature_profile?: string;
    shelf_life_days?: number;
    unit_price_cents?: number;
    vat_rate_pct?: number;
    supplier?: string;
    supplier_name?: string;
  }
): Product {
  assertPermission(actor, "products:write");
  requireMutationAuthorization(actor, "create product");

  const sku = input.sku?.trim().toUpperCase();
  const name = input.name?.trim();
  if (!sku || !name) {
    throw new ApiError(400, "VALIDATION_ERROR", "Product SKU and name are required.");
  }

  const db = getDb();
  const exists = db.prepare(`SELECT id FROM products WHERE upper(sku) = ?`).get(sku) as { id: string } | undefined;
  if (exists) {
    throw new ApiError(409, "DUPLICATE_SKU", `Product SKU '${sku}' already exists.`);
  }

  const id = `PRD-${Date.now()}`;
  const category = input.category?.trim() || "Produce";
  const origin = input.origin?.trim() || "Italy";
  const uom = input.pack_size?.trim() || input.uom?.trim() || "Case (5 kg)";
  const tempZone = input.temperature_profile?.trim() || input.temp_zone?.trim() || "Chilled (0°C to +4°C)";
  const shelfLifeDays = Math.max(1, Number(input.shelf_life_days ?? 10));
  const unitPriceCents = Math.max(100, Math.round(Number(input.unit_price_cents ?? 4500)));
  const vatRatePct = Number(input.vat_rate_pct ?? 4);
  const supplierName = input.supplier_name?.trim() || input.supplier?.trim() || "Cooperativa Agricola Sud";

  withTransaction(() => {
    const existingSupplier = db
      .prepare(`SELECT id FROM suppliers WHERE lower(name) = lower(?)`)
      .get(supplierName) as { id: string } | undefined;

    if (!existingSupplier) {
      const supId = `SUP-${Date.now().toString().slice(-5)}`;
      db.prepare(`
        INSERT INTO suppliers (
          id, name, country, region, categories_json, lead_time_days,
          otif_pct, quality_score, open_pos_count, payment_terms, certifications_json, status
        ) VALUES (?, ?, ?, ?, ?, 2, 98.0, 96.0, 0, 'Net 30', '["IFS Food","HACCP"]', 'approved')
      `).run(supId, supplierName, origin, origin, JSON.stringify([category]));
    }

    db.prepare(`
      INSERT INTO products (
        id, sku, name, category, origin, uom, temp_zone, shelf_life_days,
        stock_cases, reorder_point_cases, unit_price_cents, vat_rate_pct, supplier_name, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 25, ?, ?, ?, 'active')
    `).run(
      id,
      sku,
      name,
      category,
      origin,
      uom,
      tempZone,
      shelfLifeDays,
      unitPriceCents,
      vatRatePct,
      supplierName
    );

    recordAuditEvent({
      actor,
      action: "master_data.product_created",
      entityType: "Product",
      entityId: sku,
      after: { id, sku, name, category, tempZone, shelfLifeDays, unitPriceCents }
    });
  });

  return listProducts().find((p) => p.sku === sku)!;
}

export function listSuppliers(): Supplier[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      id, name, country, region, categories_json, lead_time_days,
      otif_pct, quality_score, open_pos_count, payment_terms, certifications_json, status
    FROM suppliers
    ORDER BY otif_pct DESC, name ASC
  `).all() as Array<{
    id: string;
    name: string;
    country: string;
    region: string;
    categories_json: string;
    lead_time_days: number;
    otif_pct: number;
    quality_score: number;
    open_pos_count: number;
    payment_terms: string;
    certifications_json: string;
    status: "approved" | "probation" | "blocked";
  }>;

  return rows.map((r, idx) => {
    let categories: string[] = [];
    try {
      categories = JSON.parse(r.categories_json) as string[];
    } catch {
      categories = ["General"];
    }
    return {
      id: numericId(r.id, idx + 1),
      code: r.id,
      name: r.name,
      country: `${r.region}, ${r.country}`,
      category: categories.join(" · "),
      on_time_rate: Number(r.otif_pct),
      quality_score: Number(r.quality_score),
      lead_time_days: Number(r.lead_time_days),
      open_orders: Number(r.open_pos_count),
      price_variance: idx % 2 === 0 ? -0.8 : 1.2,
      status: r.status === "probation" ? "review" : r.status
    };
  });
}

export function createSupplier(
  actor: AuthenticatedUser,
  input: {
    name: string;
    country?: string;
    region?: string;
    category?: string;
    lead_time_days?: number;
  }
): Supplier {
  assertPermission(actor, "suppliers:write");
  requireMutationAuthorization(actor, "create supplier");
  const name = (input.name || "").trim();
  if (!name) {
    throw new ApiError(422, "VALIDATION_ERROR", "Supplier name is required.");
  }

  const db = getDb();
  const id = `SUP-${Date.now().toString().slice(-5)}`;
  const country = (input.country || "IT").trim();
  const region = (input.region || "Milano").trim();
  const category = (input.category || "Produce").trim();
  const leadTimeDays = Math.max(1, Number(input.lead_time_days || 2));

  db.prepare(`
    INSERT INTO suppliers (
      id, name, country, region, categories_json, lead_time_days,
      otif_pct, quality_score, open_pos_count, payment_terms, certifications_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, 98.0, 96.0, 0, 'Net 30', '["IFS Food","HACCP"]', 'approved')
  `).run(id, name, country, region, JSON.stringify([category]), leadTimeDays);

  recordAuditEvent({
    actor,
    action: "master_data.supplier_created",
    entityType: "Supplier",
    entityId: id,
    after: { id, name, country, region, category, leadTimeDays }
  });

  return listSuppliers().find((s) => s.code === id)!;
}

export type PurchaseOrderRecord = ProcurementPurchaseOrder;

export function listPurchaseOrders(): PurchaseOrderRecord[] {
  const db = getDb();
  return db.prepare(`
    SELECT *
    FROM purchase_orders
    ORDER BY created_at DESC
  `).all().map((row) => ({ ...(row as Record<string, unknown>) })) as unknown as PurchaseOrderRecord[];
}

export function createRfqOrPurchaseOrder(
  actor: AuthenticatedUser,
  input: {
    supplier_id?: string;
    supplier?: string;
    sku: string;
    cases: number;
    expected_date?: string;
    mode?: "rfq" | "po";
    unit_cost_cents?: number;
    freight_cents?: number;
    duty_pct?: number;
    other_cents?: number;
    incoterm?: string;
    asn_reference?: string;
    asn_carrier?: string;
    asn_eta?: string;
    asn_notes?: string;
  }
): PurchaseOrderRecord {
  assertPermission(actor, "suppliers:write");
  requireMutationAuthorization(actor, "create procurement order");

  const db = getDb();
  const lookupSupplier = (input.supplier_id || input.supplier || "").trim();
  let supplier = (lookupSupplier
    ? db.prepare(`SELECT * FROM suppliers WHERE id = ? OR lower(name) = lower(?)`).get(lookupSupplier, lookupSupplier)
    : db.prepare(`SELECT * FROM suppliers ORDER BY otif_pct DESC LIMIT 1`).get()) as
    | { id: string; name: string; lead_time_days: number }
    | undefined;

  if (!supplier && lookupSupplier) {
    const newSupId = `SUP-${Date.now().toString().slice(-5)}`;
    db.prepare(`
      INSERT INTO suppliers (
        id, name, country, region, categories_json, lead_time_days,
        otif_pct, quality_score, open_pos_count, payment_terms, certifications_json, status
      ) VALUES (?, ?, 'Italy', 'Italy', '["General"]', 2, 98.0, 96.0, 0, 'Net 30', '["IFS Food","HACCP"]', 'approved')
    `).run(newSupId, lookupSupplier);
    supplier = { id: newSupId, name: lookupSupplier, lead_time_days: 2 };
  }

  if (!supplier) {
    throw new ApiError(404, "SUPPLIER_NOT_FOUND", `Supplier '${lookupSupplier}' not found.`);
  }

  const product = (db.prepare(`SELECT * FROM products WHERE sku = ? OR name = ?`).get(input.sku, input.sku) ??
    db.prepare(`SELECT * FROM products ORDER BY sku ASC LIMIT 1`).get()) as
    | { sku: string; name: string; unit_price_cents: number }
    | undefined;

  if (!product) {
    throw new ApiError(404, "PRODUCT_NOT_FOUND", `Product '${input.sku}' not found.`);
  }

  const orderedCases = Math.max(1, Math.round(Number(input.cases || 40)));
  const unitCostCents = Math.round(
    Number(input.unit_cost_cents ?? Number(product.unit_price_cents) * 0.72)
  );
  const landed = computeLandedCost({
    quantity_cases: orderedCases,
    unit_cost_cents: unitCostCents,
    freight_cents: input.freight_cents,
    duty_pct: input.duty_pct,
    other_cents: input.other_cents
  });
  const poNumber = `PO-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
  const asnRef = input.asn_reference?.trim() || null;
  const isRfq = input.mode === "rfq";
  const now = new Date().toISOString();
  const expectedDate =
    input.expected_date?.trim() ||
    new Date(Date.now() + Number(supplier.lead_time_days || 2) * 86400000).toISOString().slice(0, 10);

  return withTransaction(() => {
    db.prepare(`
      INSERT INTO purchase_orders (
        id, po_number, supplier_id, supplier_name, sku, product_name,
        ordered_cases, received_cases, unit_cost_cents, total_cents,
        expected_date, status, asn_reference, freight_cents, duty_cents,
        other_cents, landed_cost_cents, unit_landed_cost_cents, incoterm,
        approval_status, approved_by, approved_at, asn_carrier, asn_eta,
        asn_notes, asn_captured_at, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      poNumber,
      poNumber,
      supplier.id,
      supplier.name,
      product.sku,
      product.name,
      orderedCases,
      unitCostCents,
      landed.goods_cents,
      expectedDate,
      isRfq ? "submitted" : "approved",
      asnRef,
      landed.freight_cents,
      landed.duty_cents,
      landed.other_cents,
      landed.landed_cost_cents,
      landed.unit_landed_cost_cents,
      (input.incoterm || "DAP").trim().toUpperCase(),
      isRfq ? "pending" : "approved",
      isRfq ? null : actor.email,
      isRfq ? null : now,
      input.asn_carrier?.trim() || null,
      input.asn_eta?.trim() || null,
      input.asn_notes?.trim() || null,
      asnRef ? now : null,
      actor.email,
      now
    );

    db.prepare(`
      UPDATE suppliers
      SET open_pos_count = open_pos_count + 1
      WHERE id = ?
    `).run(supplier.id);

    recordAuditEvent({
      actor,
      action: "procurement.purchase_order_created",
      entityType: "PurchaseOrder",
      entityId: poNumber,
      after: {
        po_number: poNumber,
        supplier_id: supplier.id,
        sku: product.sku,
        ordered_cases: orderedCases,
        total_cents: landed.goods_cents,
        landed_cost_cents: landed.landed_cost_cents,
        asn_reference: asnRef
      }
    });

    return db.prepare(`SELECT * FROM purchase_orders WHERE id = ?`).get(poNumber) as unknown as PurchaseOrderRecord;
  });
}

export function receivePurchaseOrder(
  actor: AuthenticatedUser,
  input: {
    po_number: string;
    temp_c?: number;
    accepted_cases?: number;
    expiry_date?: string;
  }
): {
  po: PurchaseOrderRecord;
  created_batch_id: string;
  quality_status: "released" | "hold";
} {
  assertPermission(actor, "procurement:receive");
  requireMutationAuthorization(actor, "receive purchase order");
  const db = getDb();
  const po = db.prepare(`SELECT * FROM purchase_orders WHERE po_number = ? OR id = ?`).get(
    input.po_number,
    input.po_number
  ) as PurchaseOrderRecord | undefined;

  if (!po) {
    throw new ApiError(404, "PO_NOT_FOUND", `Purchase order '${input.po_number}' not found.`);
  }
  if (po.status === "received") {
    throw new ApiError(409, "PO_ALREADY_RECEIVED", `Purchase order '${po.po_number}' has already been received.`);
  }
  if (po.approval_status !== "approved") {
    throw new ApiError(
      409,
      "PO_NOT_APPROVED",
      `Purchase order '${po.po_number}' must be approved before goods can be received.`
    );
  }

  const product = db.prepare(`SELECT * FROM products WHERE sku = ?`).get(po.sku) as
    | { sku: string; name: string; category: string; origin: string; shelf_life_days: number; temp_zone: string }
    | undefined;

  const tempC = Number(input.temp_c ?? 2.4);
  const acceptedCases = Math.max(1, Math.round(Number(input.accepted_cases ?? po.ordered_cases)));
  const todayStr = new Date().toISOString().slice(0, 10);
  const shelfLife = Number(product?.shelf_life_days ?? 12);
  const expiryDate =
    input.expiry_date?.trim() ||
    new Date(Date.now() + shelfLife * 86400000).toISOString().slice(0, 10);

  const isTempBreach = tempC > 6.5;
  const qualityStatus: "released" | "hold" = isTempBreach ? "hold" : "released";
  const batchId = `LOT-2026-${po.sku.split("-")[1] || "GEN"}-${Date.now().toString().slice(-3)}`;

  return withTransaction(() => {
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE purchase_orders
      SET received_cases = ?, status = 'received'
      WHERE id = ?
    `).run(acceptedCases, po.id);

    db.prepare(`
      UPDATE suppliers
      SET open_pos_count = MAX(0, open_pos_count - 1)
      WHERE id = ?
    `).run(po.supplier_id);

    db.prepare(`
      INSERT INTO inventory_lots (
        id, batch_id, sku, product_name, category, warehouse, location, zone,
        quantity_cases, received_cases, allocated_cases, received_date, expiry_date,
        supplier, supplier_lot, origin_country, quality_status, temp_c, unit_weight_kg, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'Milan Cold Hub', 'CH-A10', 'Chilled A', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 5.0, ?)
    `).run(
      batchId,
      batchId,
      po.sku,
      po.product_name,
      product?.category ?? "Produce",
      acceptedCases,
      acceptedCases,
      todayStr,
      expiryDate,
      po.supplier_name,
      `SUP-${po.po_number}`,
      product?.origin ?? "Italy",
      qualityStatus,
      tempC,
      now
    );

    db.prepare(`
      INSERT INTO goods_receipts (
        id, po_id, batch_id, sku, received_cases, accepted_cases, rejected_cases,
        temp_c, quality_status, received_by, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `GRN-${Date.now()}`,
      po.id,
      batchId,
      po.sku,
      po.ordered_cases,
      acceptedCases,
      Math.max(0, po.ordered_cases - acceptedCases),
      tempC,
      qualityStatus,
      actor.email,
      now
    );

    db.prepare(`
      INSERT INTO stock_movements (
        id, batch_id, sku, movement_type, quantity_delta, previous_cases, new_cases, reason, actor_email, created_at
      ) VALUES (?, ?, ?, 'receipt', ?, 0, ?, ?, ?, ?)
    `).run(
      `MOV-${Date.now()}`,
      batchId,
      po.sku,
      acceptedCases,
      acceptedCases,
      `Goods receipt against ${po.po_number}`,
      actor.email,
      now
    );

    recordAuditEvent({
      actor,
      action: "procurement.goods_receipt_posted",
      entityType: "PurchaseOrder",
      entityId: po.po_number,
      after: { batch_id: batchId, accepted_cases: acceptedCases, temp_c: tempC, quality_status: qualityStatus }
    });

    const updatedPo = db.prepare(`SELECT * FROM purchase_orders WHERE id = ?`).get(po.id) as unknown as PurchaseOrderRecord;
    return {
      po: updatedPo,
      created_batch_id: batchId,
      quality_status: qualityStatus
    };
  });
}
