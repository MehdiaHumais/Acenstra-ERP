import { getDb, withTransaction } from "@/server/db/connection";
import { ApiError } from "@/server/core/http";
import {
  AuthenticatedUser,
  assertPermission,
  recordAuditEvent,
  requireMutationAuthorization
} from "@/server/security/auth";
import {
  computeLandedCost,
  computeSupplierScore,
  daysBetween,
  gradeForScore,
  type ProcurementPurchaseOrder,
  type ProcurementQuotation,
  type ProcurementRfq,
  type QuotationStatus,
  type SupplierScorecard
} from "@/lib/procurement";
import { listSuppliers } from "./master-data.service";

const ACTIVE_RFQ_STATUSES = new Set(["open", "quoted"]);

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateOnly(value: string | null | undefined): string {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function uniqueNumber(prefix: string, table: string, column: string): string {
  const db = getDb();
  const year = new Date().getFullYear();
  const rows = db
    .prepare(`SELECT ${column} AS value FROM ${table} WHERE ${column} LIKE ?`)
    .all(`${prefix}-${year}-%`) as Array<{ value: string }>;
  let next = rows.length + 1;
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const candidate = `${prefix}-${year}-${String(next).padStart(4, "0")}`;
    const exists = db
      .prepare(`SELECT 1 FROM ${table} WHERE ${column} = ?`)
      .get(candidate);
    if (!exists) return candidate;
    next += 1;
  }
  return `${prefix}-${year}-${Date.now().toString().slice(-5)}`;
}

function supplierLookup(supplierId: string): {
  id: string;
  name: string;
  status: string;
  lead_time_days: number;
} {
  const db = getDb();
  const supplier = db
    .prepare(`SELECT id, name, status, lead_time_days FROM suppliers WHERE id = ? OR lower(name) = lower(?)`)
    .get(supplierId, supplierId) as
    | { id: string; name: string; status: string; lead_time_days: number }
    | undefined;
  if (!supplier) {
    throw new ApiError(404, "SUPPLIER_NOT_FOUND", `Supplier '${supplierId}' not found.`);
  }
  return supplier;
}

function productLookup(sku: string): { sku: string; name: string; case_weight_kg: number | null } {
  const db = getDb();
  const product = db
    .prepare(`SELECT sku, name, case_weight_kg FROM products WHERE sku = ? OR lower(name) = lower(?)`)
    .get(sku, sku) as { sku: string; name: string; case_weight_kg: number | null } | undefined;
  if (!product) {
    throw new ApiError(404, "PRODUCT_NOT_FOUND", `Product '${sku}' not found.`);
  }
  return product;
}

export function listSupplierScorecards(): SupplierScorecard[] {
  const db = getDb();
  const suppliers = listSuppliers();

  const poStats = db
    .prepare(
      `
      SELECT
        supplier_id,
        COUNT(*) AS po_count,
        SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END) AS received_po_count,
        SUM(CASE WHEN status <> 'received' THEN 1 ELSE 0 END) AS open_po_count,
        SUM(total_cents) AS spend_cents,
        SUM(COALESCE(landed_cost_cents, total_cents)) AS landed_spend_cents,
        MAX(created_at) AS last_po_at
      FROM purchase_orders
      GROUP BY supplier_id
    `
    )
    .all() as Array<{
    supplier_id: string;
    po_count: number;
    received_po_count: number;
    open_po_count: number;
    spend_cents: number;
    landed_spend_cents: number;
    last_po_at: string | null;
  }>;

  const receiptStats = db
    .prepare(
      `
      SELECT
        po.supplier_id,
        po.expected_date,
        gr.received_at,
        gr.received_cases,
        gr.rejected_cases,
        gr.quality_status
      FROM goods_receipts gr
      JOIN purchase_orders po ON po.id = gr.po_id
    `
    )
    .all() as Array<{
    supplier_id: string;
    expected_date: string;
    received_at: string;
    received_cases: number;
    rejected_cases: number;
    quality_status: string;
  }>;

  const quotationStats = db
    .prepare(
      `
      SELECT q.supplier_id, q.rfq_id, q.unit_cost_cents
      FROM procurement_quotations q
      WHERE q.status <> 'rejected'
    `
    )
    .all() as Array<{ supplier_id: string; rfq_id: string; unit_cost_cents: number }>;

  const bestByRfq = new Map<string, number>();
  for (const quote of quotationStats) {
    const current = bestByRfq.get(quote.rfq_id);
    if (current === undefined || quote.unit_cost_cents < current) {
      bestByRfq.set(quote.rfq_id, quote.unit_cost_cents);
    }
  }
  const varianceBuckets = new Map<string, number[]>();
  for (const quote of quotationStats) {
    const best = bestByRfq.get(quote.rfq_id);
    if (!best) continue;
    const variance = ((quote.unit_cost_cents - best) / best) * 100;
    const bucket = varianceBuckets.get(quote.supplier_id) ?? [];
    bucket.push(variance);
    varianceBuckets.set(quote.supplier_id, bucket);
  }

  const poBySupplier = new Map(poStats.map((row) => [row.supplier_id, row]));
  const receiptsBySupplier = new Map<string, typeof receiptStats>();
  for (const receipt of receiptStats) {
    const bucket = receiptsBySupplier.get(receipt.supplier_id) ?? [];
    bucket.push(receipt);
    receiptsBySupplier.set(receipt.supplier_id, bucket);
  }

  return suppliers
    .map((supplier) => {
      const po = poBySupplier.get(supplier.code);
      const receipts = receiptsBySupplier.get(supplier.code) ?? [];
      const onTimeReceipts = receipts.filter(
        (receipt) => dateOnly(receipt.received_at) <= dateOnly(receipt.expected_date)
      ).length;
      const lateReceipts = receipts.length - onTimeReceipts;
      const totalReceivedCases = receipts.reduce(
        (sum, receipt) => sum + Number(receipt.received_cases || 0),
        0
      );
      const totalRejectedCases = receipts.reduce(
        (sum, receipt) => sum + Number(receipt.rejected_cases || 0),
        0
      );
      const qualityPct =
        totalReceivedCases > 0
          ? ((totalReceivedCases - totalRejectedCases) / totalReceivedCases) * 100
          : Number(supplier.quality_score);
      const onTimePct = receipts.length > 0 ? (onTimeReceipts / receipts.length) * 100 : Number(supplier.on_time_rate);
      const variances = varianceBuckets.get(supplier.code) ?? [];
      const priceVariance =
        variances.length > 0
          ? variances.reduce((sum, value) => sum + value, 0) / variances.length
          : Number(supplier.price_variance || 0);
      const score = computeSupplierScore({
        on_time_pct: onTimePct,
        quality_pct: qualityPct,
        price_variance_pct: priceVariance
      });

      return {
        ...supplier,
        on_time_rate: Math.round(onTimePct * 10) / 10,
        quality_score: Math.round(qualityPct * 10) / 10,
        price_variance: Math.round(priceVariance * 10) / 10,
        po_count: Number(po?.po_count ?? 0),
        received_po_count: Number(po?.received_po_count ?? 0),
        open_po_count: Number(po?.open_po_count ?? 0),
        on_time_receipts: onTimeReceipts,
        late_receipts: lateReceipts,
        rejected_receipts: receipts.filter(
          (receipt) => receipt.quality_status !== "released" || Number(receipt.rejected_cases || 0) > 0
        ).length,
        spend_cents: Number(po?.spend_cents ?? 0),
        landed_spend_cents: Number(po?.landed_spend_cents ?? 0),
        avg_lead_time_days: Number(supplier.lead_time_days || 0),
        last_po_at: po?.last_po_at ?? null,
        score,
        grade: gradeForScore(score)
      };
    })
    .sort((a, b) => b.score - a.score || b.spend_cents - a.spend_cents);
}

export function listRfqs(): ProcurementRfq[] {
  const db = getDb();
  const rfqRows = db
    .prepare(`SELECT * FROM procurement_rfqs ORDER BY created_at DESC`)
    .all() as Array<{
    id: string;
    sku: string;
    product_name: string;
    quantity_cases: number;
    needed_by: string;
    incoterm: string;
    destination: string;
    status: ProcurementRfq["status"];
    notes: string | null;
    created_by: string;
    created_at: string;
  }>;

  const quoteRows = db
    .prepare(
      `
      SELECT q.*, COALESCE(s.status, 'blocked') AS supplier_status
      FROM procurement_quotations q
      LEFT JOIN suppliers s ON s.id = q.supplier_id
      ORDER BY q.unit_cost_cents ASC, q.created_at ASC
    `
    )
    .all() as Array<{
    id: string;
    rfq_id: string;
    supplier_id: string;
    supplier_name: string;
    supplier_status: string;
    unit_cost_cents: number;
    freight_cents: number;
    duty_pct: number;
    other_cents: number;
    lead_time_days: number;
    valid_until: string | null;
    incoterm: string;
    notes: string | null;
    status: QuotationStatus;
    created_by: string;
    created_at: string;
  }>;

  const todayStr = today();
  const quotesByRfq = new Map<string, typeof quoteRows>();
  for (const quote of quoteRows) {
    const bucket = quotesByRfq.get(quote.rfq_id) ?? [];
    bucket.push(quote);
    quotesByRfq.set(quote.rfq_id, bucket);
  }

  return rfqRows.map((rfq) => {
    const quotes = quotesByRfq.get(rfq.id) ?? [];
    const ranked = quotes
      .map((quote) => {
        const landed = computeLandedCost({
          quantity_cases: rfq.quantity_cases,
          unit_cost_cents: quote.unit_cost_cents,
          freight_cents: quote.freight_cents,
          duty_pct: quote.duty_pct,
          other_cents: quote.other_cents
        });
        const expired = Boolean(quote.valid_until && dateOnly(quote.valid_until) < todayStr);
        const eligible = quote.supplier_status === "approved" && !expired && quote.status !== "rejected";
        const reason = expired
          ? "Quotation expired"
          : quote.supplier_status !== "approved"
            ? `Supplier ${quote.supplier_status}`
            : quote.status === "rejected"
              ? "Not selected"
              : null;
        return {
          ...quote,
          goods_cents: landed.goods_cents,
          duty_cents: landed.duty_cents,
          landed_cost_cents: landed.landed_cost_cents,
          unit_landed_cost_cents: landed.unit_landed_cost_cents,
          eligible,
          eligible_reason: reason,
          rank: null as number | null
        };
      })
      .sort((a, b) => a.landed_cost_cents - b.landed_cost_cents);

    let rank = 1;
    for (const quote of ranked) {
      if (quote.eligible) {
        quote.rank = rank;
        rank += 1;
      }
    }

    const recommended = ranked.find((quote) => quote.eligible) ?? null;
    const selected = ranked.find((quote) => quote.status === "selected") ?? null;

    return {
      ...rfq,
      quotations: ranked,
      recommended_quotation_id: recommended?.id ?? null,
      selected_quotation_id: selected?.id ?? null,
      best_landed_cost_cents: recommended?.landed_cost_cents ?? null
    };
  });
}

export function createRfq(
  actor: AuthenticatedUser,
  input: {
    sku: string;
    quantity_cases: number;
    needed_by: string;
    incoterm?: string;
    destination?: string;
    notes?: string;
  }
): ProcurementRfq {
  assertPermission(actor, "suppliers:write");
  requireMutationAuthorization(actor, "create RFQ");

  const product = productLookup(input.sku);
  const cases = Math.max(1, Math.round(Number(input.quantity_cases) || 0));
  if (cases < 1) {
    throw new ApiError(422, "VALIDATION_ERROR", "RFQ quantity must be at least one case.");
  }
  const neededBy = dateOnly(input.needed_by);
  if (!neededBy || Number.isNaN(new Date(neededBy).getTime())) {
    throw new ApiError(422, "VALIDATION_ERROR", "A valid required-by date is required.");
  }

  const db = getDb();
  const rfqNumber = uniqueNumber("RFQ", "procurement_rfqs", "id");

  db.prepare(
    `
    INSERT INTO procurement_rfqs (
      id, sku, product_name, quantity_cases, needed_by, incoterm,
      destination, status, notes, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
  `
  ).run(
    rfqNumber,
    product.sku,
    product.name,
    cases,
    neededBy,
    (input.incoterm || "DAP").trim().toUpperCase(),
    (input.destination || "Milan Cold Hub").trim(),
    input.notes?.trim() || null,
    actor.email,
    new Date().toISOString()
  );

  recordAuditEvent({
    actor,
    action: "procurement.rfq_created",
    entityType: "Rfq",
    entityId: rfqNumber,
    after: { rfq: rfqNumber, sku: product.sku, cases, needed_by: neededBy }
  });

  return listRfqs().find((rfq) => rfq.id === rfqNumber)!;
}

export function addQuotation(
  actor: AuthenticatedUser,
  rfqId: string,
  input: {
    supplier_id: string;
    unit_cost_cents: number;
    freight_cents?: number;
    duty_pct?: number;
    other_cents?: number;
    lead_time_days?: number;
    valid_until?: string;
    incoterm?: string;
    notes?: string;
  }
): ProcurementRfq {
  assertPermission(actor, "suppliers:write");
  requireMutationAuthorization(actor, "record supplier quotation");

  const db = getDb();
  const rfq = db.prepare(`SELECT * FROM procurement_rfqs WHERE id = ?`).get(rfqId) as
    | { id: string; status: string }
    | undefined;
  if (!rfq) {
    throw new ApiError(404, "RFQ_NOT_FOUND", `RFQ '${rfqId}' not found.`);
  }
  if (!ACTIVE_RFQ_STATUSES.has(rfq.status)) {
    throw new ApiError(409, "RFQ_CLOSED", `RFQ '${rfqId}' is ${rfq.status} and cannot accept new quotations.`);
  }

  const supplier = supplierLookup(input.supplier_id);
  const unitCost = Math.round(Number(input.unit_cost_cents));
  if (!Number.isFinite(unitCost) || unitCost <= 0) {
    throw new ApiError(422, "VALIDATION_ERROR", "Quoted unit cost must be greater than zero.");
  }
  const leadTime = Math.max(1, Math.round(Number(input.lead_time_days) || supplier.lead_time_days || 2));
  const validUntil = input.valid_until?.trim() ? dateOnly(input.valid_until) : null;

  return withTransaction(() => {
    const existing = db
      .prepare(`SELECT id FROM procurement_quotations WHERE rfq_id = ? AND supplier_id = ?`)
      .get(rfq.id, supplier.id) as { id: string } | undefined;
    const quoteId = existing?.id ?? uniqueNumber("QTN", "procurement_quotations", "id");
    const now = new Date().toISOString();

    if (existing) {
      db.prepare(
        `
        UPDATE procurement_quotations
        SET unit_cost_cents = ?, freight_cents = ?, duty_pct = ?, other_cents = ?,
            lead_time_days = ?, valid_until = ?, incoterm = ?, notes = ?,
            status = 'received', created_by = ?, created_at = ?
        WHERE id = ?
      `
      ).run(
        unitCost,
        Math.max(0, Math.round(Number(input.freight_cents) || 0)),
        Math.max(0, Number(input.duty_pct) || 0),
        Math.max(0, Math.round(Number(input.other_cents) || 0)),
        leadTime,
        validUntil,
        (input.incoterm || "DAP").trim().toUpperCase(),
        input.notes?.trim() || null,
        actor.email,
        now,
        quoteId
      );
    } else {
      db.prepare(
        `
        INSERT INTO procurement_quotations (
          id, rfq_id, supplier_id, supplier_name, unit_cost_cents, freight_cents,
          duty_pct, other_cents, lead_time_days, valid_until, incoterm, notes,
          status, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)
      `
      ).run(
        quoteId,
        rfq.id,
        supplier.id,
        supplier.name,
        unitCost,
        Math.max(0, Math.round(Number(input.freight_cents) || 0)),
        Math.max(0, Number(input.duty_pct) || 0),
        Math.max(0, Math.round(Number(input.other_cents) || 0)),
        leadTime,
        validUntil,
        (input.incoterm || "DAP").trim().toUpperCase(),
        input.notes?.trim() || null,
        actor.email,
        now
      );
    }

    db.prepare(`UPDATE procurement_rfqs SET status = 'quoted' WHERE id = ? AND status = 'open'`).run(rfq.id);

    recordAuditEvent({
      actor,
      action: existing ? "procurement.quotation_updated" : "procurement.quotation_recorded",
      entityType: "Rfq",
      entityId: rfq.id,
      after: {
        quotation_id: quoteId,
        supplier_id: supplier.id,
        unit_cost_cents: unitCost,
        lead_time_days: leadTime,
        valid_until: validUntil
      }
    });

    return listRfqs().find((row) => row.id === rfq.id)!;
  });
}

export function deleteQuotation(
  actor: AuthenticatedUser,
  rfqId: string,
  quotationId: string
): ProcurementRfq {
  assertPermission(actor, "suppliers:write");
  requireMutationAuthorization(actor, "remove supplier quotation");

  const db = getDb();
  const rfq = db.prepare(`SELECT status FROM procurement_rfqs WHERE id = ?`).get(rfqId) as
    | { status: string }
    | undefined;
  if (!rfq) {
    throw new ApiError(404, "RFQ_NOT_FOUND", `RFQ '${rfqId}' not found.`);
  }
  if (rfq.status === "awarded") {
    throw new ApiError(409, "RFQ_AWARDED", "Awarded RFQs are locked. Remove quotations is not permitted.");
  }
  const quote = db
    .prepare(`SELECT * FROM procurement_quotations WHERE id = ? AND rfq_id = ?`)
    .get(quotationId, rfqId) as { id: string; supplier_id: string } | undefined;
  if (!quote) {
    throw new ApiError(404, "QUOTATION_NOT_FOUND", `Quotation '${quotationId}' not found on ${rfqId}.`);
  }

  return withTransaction(() => {
    db.prepare(`DELETE FROM procurement_quotations WHERE id = ?`).run(quote.id);
    const remaining = db
      .prepare(`SELECT COUNT(*) AS count FROM procurement_quotations WHERE rfq_id = ?`)
      .get(rfqId) as { count: number };
    if (Number(remaining.count) === 0) {
      db.prepare(`UPDATE procurement_rfqs SET status = 'open' WHERE id = ?`).run(rfqId);
    }
    recordAuditEvent({
      actor,
      action: "procurement.quotation_removed",
      entityType: "Rfq",
      entityId: rfqId,
      before: { quotation_id: quote.id, supplier_id: quote.supplier_id }
    });
    return listRfqs().find((row) => row.id === rfqId)!;
  });
}

export function awardRfq(
  actor: AuthenticatedUser,
  rfqId: string,
  input: {
    quotation_id: string;
    asn_reference?: string;
    asn_carrier?: string;
    asn_eta?: string;
    asn_notes?: string;
  }
): { purchase_order: ProcurementPurchaseOrder; rfq: ProcurementRfq } {
  assertPermission(actor, "suppliers:write");
  requireMutationAuthorization(actor, "award RFQ and raise purchase order");

  const db = getDb();
  const rfq = db.prepare(`SELECT * FROM procurement_rfqs WHERE id = ?`).get(rfqId) as
    | {
        id: string;
        sku: string;
        product_name: string;
        quantity_cases: number;
        needed_by: string;
        incoterm: string;
        status: string;
      }
    | undefined;
  if (!rfq) {
    throw new ApiError(404, "RFQ_NOT_FOUND", `RFQ '${rfqId}' not found.`);
  }
  if (rfq.status === "awarded") {
    throw new ApiError(409, "RFQ_ALREADY_AWARDED", `RFQ '${rfqId}' has already been awarded.`);
  }
  if (rfq.status === "cancelled") {
    throw new ApiError(409, "RFQ_CANCELLED", `RFQ '${rfqId}' has been cancelled.`);
  }

  const quotation = db
    .prepare(
      `
      SELECT q.*, s.status AS supplier_status
      FROM procurement_quotations q
      JOIN suppliers s ON s.id = q.supplier_id
      WHERE q.id = ? AND q.rfq_id = ?
    `
    )
    .get(input.quotation_id, rfq.id) as
    | {
        id: string;
        supplier_id: string;
        supplier_name: string;
        supplier_status: string;
        unit_cost_cents: number;
        freight_cents: number;
        duty_pct: number;
        other_cents: number;
        lead_time_days: number;
        valid_until: string | null;
        incoterm: string;
      }
    | undefined;

  if (!quotation) {
    throw new ApiError(404, "QUOTATION_NOT_FOUND", `Quotation '${input.quotation_id}' not found on ${rfq.id}.`);
  }
  if (quotation.supplier_status !== "approved") {
    throw new ApiError(
      409,
      "SUPPLIER_NOT_APPROVED",
      `${quotation.supplier_name} is ${quotation.supplier_status}; only approved suppliers can receive a purchase order.`
    );
  }
  if (quotation.valid_until && dateOnly(quotation.valid_until) < today()) {
    throw new ApiError(409, "QUOTATION_EXPIRED", `The quotation from ${quotation.supplier_name} expired on ${quotation.valid_until}.`);
  }

  const landed = computeLandedCost({
    quantity_cases: rfq.quantity_cases,
    unit_cost_cents: quotation.unit_cost_cents,
    freight_cents: quotation.freight_cents,
    duty_pct: quotation.duty_pct,
    other_cents: quotation.other_cents
  });
  const poNumber = uniqueNumber("PO", "purchase_orders", "po_number");
  const todayStr = today();
  const leadDate = new Date(Date.now() + quotation.lead_time_days * 86_400_000).toISOString().slice(0, 10);
  const expectedDate = dateOnly(rfq.needed_by) >= leadDate ? dateOnly(rfq.needed_by) : leadDate;
  const now = new Date().toISOString();
  const asnReference = input.asn_reference?.trim() || null;

  return withTransaction(() => {
    db.prepare(
      `
      INSERT INTO purchase_orders (
        id, po_number, supplier_id, supplier_name, sku, product_name,
        ordered_cases, received_cases, unit_cost_cents, total_cents, expected_date,
        status, asn_reference, rfq_id, quotation_id, freight_cents, duty_cents,
        other_cents, landed_cost_cents, unit_landed_cost_cents, incoterm,
        approval_status, approved_by, approved_at, asn_carrier, asn_eta, asn_notes,
        asn_captured_at, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      poNumber,
      poNumber,
      quotation.supplier_id,
      quotation.supplier_name,
      rfq.sku,
      rfq.product_name,
      rfq.quantity_cases,
      quotation.unit_cost_cents,
      landed.goods_cents,
      expectedDate,
      asnReference,
      rfq.id,
      quotation.id,
      landed.freight_cents,
      landed.duty_cents,
      landed.other_cents,
      landed.landed_cost_cents,
      landed.unit_landed_cost_cents,
      quotation.incoterm || rfq.incoterm,
      actor.email,
      now,
      input.asn_carrier?.trim() || null,
      input.asn_eta?.trim() ? dateOnly(input.asn_eta) : null,
      input.asn_notes?.trim() || null,
      asnReference ? now : null,
      actor.email,
      now
    );

    db.prepare(`UPDATE suppliers SET open_pos_count = open_pos_count + 1 WHERE id = ?`).run(quotation.supplier_id);
    db.prepare(`UPDATE procurement_rfqs SET status = 'awarded' WHERE id = ?`).run(rfq.id);
    db.prepare(`UPDATE procurement_quotations SET status = 'selected' WHERE id = ?`).run(quotation.id);
    db.prepare(`UPDATE procurement_quotations SET status = 'rejected' WHERE rfq_id = ? AND id <> ?`).run(
      rfq.id,
      quotation.id
    );

    recordAuditEvent({
      actor,
      action: "procurement.rfq_awarded",
      entityType: "PurchaseOrder",
      entityId: poNumber,
      after: {
        rfq_id: rfq.id,
        quotation_id: quotation.id,
        supplier_id: quotation.supplier_id,
        ordered_cases: rfq.quantity_cases,
        goods_cents: landed.goods_cents,
        freight_cents: landed.freight_cents,
        duty_cents: landed.duty_cents,
        other_cents: landed.other_cents,
        landed_cost_cents: landed.landed_cost_cents,
        asn_reference: asnReference
      }
    });

    const purchaseOrder = db
      .prepare(`SELECT * FROM purchase_orders WHERE id = ?`)
      .get(poNumber) as unknown as ProcurementPurchaseOrder;
    return {
      purchase_order: purchaseOrder,
      rfq: listRfqs().find((row) => row.id === rfq.id)!
    };
  });
}

export function approvePurchaseOrder(
  actor: AuthenticatedUser,
  poNumber: string,
  input?: { asn_reference?: string; asn_carrier?: string; asn_eta?: string; asn_notes?: string }
): ProcurementPurchaseOrder {
  assertPermission(actor, "suppliers:write");
  requireMutationAuthorization(actor, "approve purchase order");

  const db = getDb();
  const po = db
    .prepare(`SELECT * FROM purchase_orders WHERE po_number = ? OR id = ?`)
    .get(poNumber, poNumber) as ProcurementPurchaseOrder | undefined;
  if (!po) {
    throw new ApiError(404, "PO_NOT_FOUND", `Purchase order '${poNumber}' not found.`);
  }
  if (po.status === "received") {
    throw new ApiError(409, "PO_ALREADY_RECEIVED", `Purchase order '${po.po_number}' has already been received.`);
  }
  if (po.approval_status === "approved") {
    throw new ApiError(409, "PO_ALREADY_APPROVED", `Purchase order '${po.po_number}' is already approved.`);
  }

  const now = new Date().toISOString();
  const asnReference = input?.asn_reference?.trim() || po.asn_reference;
  return withTransaction(() => {
    db.prepare(
      `
      UPDATE purchase_orders
      SET approval_status = 'approved', status = 'approved', approved_by = ?, approved_at = ?,
          asn_reference = ?, asn_carrier = ?, asn_eta = ?, asn_notes = ?,
          asn_captured_at = CASE WHEN ? IS NOT NULL THEN ? ELSE asn_captured_at END
      WHERE id = ?
    `
    ).run(
      actor.email,
      now,
      asnReference,
      input?.asn_carrier?.trim() || po.asn_carrier,
      input?.asn_eta?.trim() ? dateOnly(input.asn_eta) : po.asn_eta,
      input?.asn_notes?.trim() || po.asn_notes,
      asnReference,
      now,
      po.id
    );

    recordAuditEvent({
      actor,
      action: "procurement.purchase_order_approved",
      entityType: "PurchaseOrder",
      entityId: po.po_number,
      before: { approval_status: po.approval_status, status: po.status },
      after: { approval_status: "approved", approved_by: actor.email, asn_reference: asnReference }
    });

    return db.prepare(`SELECT * FROM purchase_orders WHERE id = ?`).get(po.id) as unknown as ProcurementPurchaseOrder;
  });
}

export function captureAsn(
  actor: AuthenticatedUser,
  poNumber: string,
  input: {
    asn_reference: string;
    asn_carrier?: string;
    asn_eta?: string;
    asn_notes?: string;
  }
): ProcurementPurchaseOrder {
  assertPermission(actor, "suppliers:write");
  requireMutationAuthorization(actor, "capture supplier ASN");

  const db = getDb();
  const po = db
    .prepare(`SELECT * FROM purchase_orders WHERE po_number = ? OR id = ?`)
    .get(poNumber, poNumber) as ProcurementPurchaseOrder | undefined;
  if (!po) {
    throw new ApiError(404, "PO_NOT_FOUND", `Purchase order '${poNumber}' not found.`);
  }
  if (po.status === "received") {
    throw new ApiError(409, "PO_ALREADY_RECEIVED", `Purchase order '${po.po_number}' has already been received.`);
  }
  const reference = input.asn_reference?.trim();
  if (!reference) {
    throw new ApiError(422, "VALIDATION_ERROR", "ASN reference is required.");
  }
  const now = new Date().toISOString();

  return withTransaction(() => {
    db.prepare(
      `
      UPDATE purchase_orders
      SET asn_reference = ?, asn_carrier = ?, asn_eta = ?, asn_notes = ?, asn_captured_at = ?
      WHERE id = ?
    `
    ).run(
      reference,
      input.asn_carrier?.trim() || null,
      input.asn_eta?.trim() ? dateOnly(input.asn_eta) : null,
      input.asn_notes?.trim() || null,
      now,
      po.id
    );

    recordAuditEvent({
      actor,
      action: "procurement.asn_captured",
      entityType: "PurchaseOrder",
      entityId: po.po_number,
      after: {
        asn_reference: reference,
        asn_carrier: input.asn_carrier?.trim() || null,
        asn_eta: input.asn_eta?.trim() ? dateOnly(input.asn_eta) : null
      }
    });

    return db.prepare(`SELECT * FROM purchase_orders WHERE id = ?`).get(po.id) as unknown as ProcurementPurchaseOrder;
  });
}

export function expectedLandedCostPipeline(): {
  open_value_cents: number;
  open_landed_cents: number;
  pending_approval: number;
  asn_captured: number;
} {
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT
        SUM(CASE WHEN status <> 'received' THEN total_cents ELSE 0 END) AS open_value_cents,
        SUM(CASE WHEN status <> 'received' THEN COALESCE(landed_cost_cents, total_cents) ELSE 0 END) AS open_landed_cents,
        SUM(CASE WHEN status <> 'received' AND approval_status <> 'approved' THEN 1 ELSE 0 END) AS pending_approval,
        SUM(CASE WHEN status <> 'received' AND asn_reference IS NOT NULL THEN 1 ELSE 0 END) AS asn_captured
      FROM purchase_orders
    `
    )
    .get() as {
    open_value_cents: number | null;
    open_landed_cents: number | null;
    pending_approval: number | null;
    asn_captured: number | null;
  };
  return {
    open_value_cents: Number(row?.open_value_cents ?? 0),
    open_landed_cents: Number(row?.open_landed_cents ?? 0),
    pending_approval: Number(row?.pending_approval ?? 0),
    asn_captured: Number(row?.asn_captured ?? 0)
  };
}

export function supplierLeadTimeGap(neededBy: string, leadTimeDays: number): number {
  return daysBetween(today(), neededBy) - leadTimeDays;
}
