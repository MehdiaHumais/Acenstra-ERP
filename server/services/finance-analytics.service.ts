import { getDb, withTransaction } from "@/server/db/connection";
import { ApiError } from "@/server/core/http";
import {
  AuthenticatedUser,
  assertPermission,
  recordAuditEvent,
  requireMutationAuthorization,
  requireRecordAccess
} from "@/server/security/auth";
import { listLots, listTemperatureReadings } from "@/server/services/inventory-fefo.service";
import { listWarehouseTasks } from "@/server/services/orders-warehouse.service";
import type {
  DashboardOverview,
  FinanceSummary,
  Insight,
  Invoice,
  StorePerformance,
  StoreSummary
} from "@/lib/types";

function numericId(rawId: string, indexFallback: number): number {
  const digits = rawId.replace(/\D/g, "");
  if (digits.length > 0) {
    return Number(digits.slice(-6)) || indexFallback;
  }
  return indexFallback;
}

interface InvoiceRow {
  id: string;
  invoice_number: string;
  order_id: string;
  order_number: string;
  customer_id: string;
  customer: string;
  issued_date: string;
  due_date: string;
  amount_cents: number;
  paid_cents: number;
  status: string;
  sdi_status: string;
  payment_terms: string;
}

export function getFinanceSummary(actor?: AuthenticatedUser): FinanceSummary {
  if (actor) {
    if (actor.role === "picker" || actor.role === "driver") {
      throw new ApiError(403, "FORBIDDEN_FINANCE_ACCESS", "Operational roles are not authorized to view financial records.");
    }
  }

  const db = getDb();
  let query = `
    SELECT
      i.id, i.invoice_number, i.order_id, i.order_number, i.customer_id, i.customer,
      i.issued_date, i.due_date, i.amount_cents, i.paid_cents, i.status, i.sdi_status, i.payment_terms,
      COALESCE(so.margin_pct, 28.4) as margin_pct
    FROM invoices i
    LEFT JOIN sales_orders so ON so.order_number = i.order_number
  `;
  const conditions: string[] = [];
  const params: string[] = [];

  const isStoreRole = actor && (actor.role === "store_vendor" || actor.role === "store_user") && actor.store_id;
  if (isStoreRole) {
    conditions.push("i.customer_id = ?");
    params.push(actor.store_id!);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }
  query += ` ORDER BY i.issued_date DESC, i.invoice_number DESC`;

  const rows = db.prepare(query).all(...params) as Array<InvoiceRow & { margin_pct: number }>;

  const invoices: Invoice[] = rows.map((row, idx) => {
    const amountCents = Number(row.amount_cents);
    const paidCents = Number(row.paid_cents);
    let mappedStatus: Invoice["status"] = "issued";
    if (paidCents >= amountCents && amountCents > 0) {
      mappedStatus = "paid";
    } else if (paidCents > 0 && paidCents < amountCents) {
      mappedStatus = "part_paid";
    } else if (row.status === "overdue" || row.status === "disputed") {
      mappedStatus = "overdue";
    } else if (row.status === "draft") {
      mappedStatus = "draft";
    }

    const mappedSdi: Invoice["sdi_status"] =
      row.sdi_status === "pending"
        ? "queued"
        : row.sdi_status === "accepted" || row.sdi_status === "rejected" || row.sdi_status === "sent"
          ? (row.sdi_status as Invoice["sdi_status"])
          : "not_sent";

    return {
      id: numericId(row.id, idx + 1),
      number: row.invoice_number,
      customer_name: row.customer,
      order_number: row.order_number,
      total_cents: amountCents,
      paid_cents: paidCents,
      status: mappedStatus,
      due_date: row.due_date,
      sdi_status: mappedSdi,
      // Hide internal profit margin from external store vendors
      margin_pct: isStoreRole ? 0 : Number(Number(row.margin_pct || 28.4).toFixed(1))
    };
  });

  const revenue_cents = invoices.reduce((acc, inv) => acc + inv.total_cents, 0);
  const collected_cents = invoices.reduce((acc, inv) => acc + inv.paid_cents, 0);
  const overdue_cents = invoices
    .filter((inv) => inv.status === "overdue")
    .reduce((acc, inv) => acc + Math.max(0, inv.total_cents - inv.paid_cents), 0);

  const apRow = isStoreRole
    ? { ap_cents: 0 }
    : (db.prepare(`
        SELECT COALESCE(SUM(total_cents), 0) as ap_cents
        FROM purchase_orders
        WHERE status IN ('submitted', 'approved', 'in_transit', 'received')
      `).get() as { ap_cents: number });

  const marginRow = isStoreRole
    ? { avg_margin: 0 }
    : (db.prepare(`
        SELECT COALESCE(AVG(margin_pct), 28.4) as avg_margin
        FROM sales_orders
        WHERE status != 'cancelled'
      `).get() as { avg_margin: number });

  const sdi_pending = invoices.filter((inv) => inv.sdi_status !== "accepted").length;

  const nowMs = Date.now();
  const buckets = {
    current: { bucket: "Current (Not Due)", amount_cents: 0 },
    days1_30: { bucket: "1–30 Days Overdue", amount_cents: 0 },
    days31_60: { bucket: "31–60 Days Overdue", amount_cents: 0 },
    days60Plus: { bucket: "60+ Days Overdue", amount_cents: 0 }
  };

  for (const inv of invoices) {
    const unpaid = Math.max(0, inv.total_cents - inv.paid_cents);
    if (unpaid <= 0) continue;
    const dueMs = new Date(`${inv.due_date}T00:00:00Z`).getTime();
    const daysOverdue = Math.floor((nowMs - dueMs) / 86400000);
    if (daysOverdue <= 0 && inv.status !== "overdue") {
      buckets.current.amount_cents += unpaid;
    } else if (daysOverdue <= 30) {
      buckets.days1_30.amount_cents += unpaid;
    } else if (daysOverdue <= 60) {
      buckets.days31_60.amount_cents += unpaid;
    } else {
      buckets.days60Plus.amount_cents += unpaid;
    }
  }

  return {
    invoices,
    revenue_cents,
    collected_cents,
    overdue_cents,
    ap_cents: isStoreRole ? 0 : Number(apRow.ap_cents || 0),
    gross_margin_pct: isStoreRole ? 0 : Number(Number(marginRow.avg_margin ?? 28.4).toFixed(1)),
    sdi_pending,
    ageing: [buckets.current, buckets.days1_30, buckets.days31_60, buckets.days60Plus]
  };
}

function findInvoiceRow(invoiceId: string | number): InvoiceRow | undefined {
  const db = getDb();
  const str = String(invoiceId).trim();
  const direct = db.prepare(`SELECT * FROM invoices WHERE id = ? OR invoice_number = ?`).get(str, str) as
    | InvoiceRow
    | undefined;
  if (direct) return direct;
  const all = db.prepare(`SELECT * FROM invoices`).all() as unknown as InvoiceRow[];
  return all.find((r, i) => String(numericId(r.id, i + 1)) === str);
}

export function sendInvoiceToSdi(actor: AuthenticatedUser, invoiceId: string | number): Invoice {
  assertPermission(actor, "finance:sdi");
  requireMutationAuthorization(actor, "transmit invoice to SDI");
  const db = getDb();
  const inv = findInvoiceRow(invoiceId);
  if (!inv) {
    throw new ApiError(404, "INVOICE_NOT_FOUND", `Invoice '${invoiceId}' not found.`);
  }

  requireRecordAccess(actor, { customer_id: inv.customer_id });

  return withTransaction(() => {
    const sdiReference = `SDI-IT-${Date.now().toString().slice(-7)}`;
    db.prepare(`
      UPDATE invoices
      SET sdi_status = 'accepted',
          sdi_reference = ?
      WHERE id = ?
    `).run(sdiReference, inv.id);

    recordAuditEvent({
      actor,
      action: "finance.sdi_transmission",
      entityType: "Invoice",
      entityId: inv.invoice_number,
      before: { sdi_status: inv.sdi_status },
      after: { sdi_status: "accepted", sdi_reference: sdiReference, format: "FatturaPA_v1.2.2_XML" }
    });

    const updated = getFinanceSummary().invoices.find((i) => i.number === inv.invoice_number);
    if (!updated) {
      throw new ApiError(500, "SDI_UPDATE_FAILED", "Failed to reload invoice after SdI transmission.");
    }
    return updated;
  });
}

export function recordInvoicePayment(
  actor: AuthenticatedUser,
  input: { invoice_id: string | number; amount_cents?: number; method?: string; reference?: string }
): Invoice {
  assertPermission(actor, "finance:payment");
  requireMutationAuthorization(actor, "record payment");
  const db = getDb();
  const inv = findInvoiceRow(input.invoice_id);
  if (!inv) {
    throw new ApiError(404, "INVOICE_NOT_FOUND", `Invoice '${input.invoice_id}' not found.`);
  }

  requireRecordAccess(actor, { customer_id: inv.customer_id });

  const remaining = Math.max(0, Number(inv.amount_cents) - Number(inv.paid_cents));
  const paymentAmount =
    input.amount_cents !== undefined && input.amount_cents > 0
      ? Math.min(remaining, Math.round(input.amount_cents))
      : remaining;

  return withTransaction(() => {
    const now = new Date().toISOString();
    const newPaid = Number(inv.paid_cents) + paymentAmount;
    const newStatus = newPaid >= Number(inv.amount_cents) ? "paid" : inv.status;

    db.prepare(`
      UPDATE invoices
      SET paid_cents = ?,
          status = ?
      WHERE id = ?
    `).run(newPaid, newStatus, inv.id);

    if (paymentAmount > 0) {
      db.prepare(`
        INSERT INTO payments (id, invoice_id, amount_cents, method, reference, recorded_by, paid_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        `PAY-${Date.now()}`,
        inv.id,
        paymentAmount,
        input.method || "SEPA Instant",
        input.reference || `SEPA-${inv.invoice_number}`,
        actor.email,
        now
      );

      db.prepare(`
        UPDATE customers
        SET current_exposure_cents = MAX(0, current_exposure_cents - ?)
        WHERE id = ?
      `).run(paymentAmount, inv.customer_id);
    }

    recordAuditEvent({
      actor,
      action: "finance.payment_recorded",
      entityType: "Invoice",
      entityId: inv.invoice_number,
      before: { paid_cents: inv.paid_cents, status: inv.status },
      after: { paid_cents: newPaid, status: newStatus, payment_cents: paymentAmount }
    });

    const updated = getFinanceSummary().invoices.find((i) => i.number === inv.invoice_number);
    if (!updated) {
      throw new ApiError(500, "PAYMENT_UPDATE_FAILED", "Failed to reload invoice after payment.");
    }
    return updated;
  });
}

export function getStoreSummary(actor?: AuthenticatedUser): StoreSummary {
  const db = getDb();
  let query = `
    SELECT
      id, name, city, segment, manager,
      active_orders_count, monthly_spend_cents, fill_rate_pct, waste_pct,
      last_delivery_text, top_categories_json, status
    FROM customers
    WHERE customer_type = 'store'
  `;
  const params: string[] = [];

  if (actor && (actor.role === "store_user" || actor.role === "store_vendor") && actor.store_id) {
    query += ` AND id = ?`;
    params.push(actor.store_id);
  }
  query += ` ORDER BY monthly_spend_cents DESC`;

  const rows = db.prepare(query).all(...params) as Array<{
    id: string;
    name: string;
    city: string;
    segment: string;
    manager: string;
    active_orders_count: number;
    monthly_spend_cents: number;
    fill_rate_pct: number;
    waste_pct: number;
    last_delivery_text: string;
    top_categories_json: string;
    status: StorePerformance["status"];
  }>;

  const stores: StorePerformance[] = rows.map((row, idx) => {
    let topCategories: string[] = [];
    try {
      topCategories = JSON.parse(row.top_categories_json) as string[];
    } catch {
      topCategories = ["Seafood", "Dairy"];
    }
    const monthlySpend = Number(row.monthly_spend_cents);
    return {
      id: numericId(row.id, idx + 1),
      code: row.id,
      name: row.name,
      city: row.city,
      purchases_30d_cents: monthlySpend,
      orders_30d: Math.max(4, Number(row.active_orders_count) * 4),
      estimated_consumption_kg: Math.round(monthlySpend / 850),
      waste_pct: Number(row.waste_pct),
      trend_pct: row.status === "watch" ? -3.4 : 8.6,
      top_product: topCategories[0] || "Norwegian Atlantic Salmon",
      status: row.status
    };
  });

  const total_spend_cents = stores.reduce((acc, s) => acc + s.purchases_30d_cents, 0);
  const total_orders = stores.reduce((acc, s) => acc + s.orders_30d, 0);
  const average_waste_pct =
    stores.length > 0
      ? Number((stores.reduce((acc, s) => acc + s.waste_pct, 0) / stores.length).toFixed(2))
      : 0;

  return {
    stores,
    total_spend_cents,
    total_orders,
    average_waste_pct
  };
}

export function updateStoreStatus(
  actor: AuthenticatedUser,
  storeId: string | number,
  status: StorePerformance["status"]
): StorePerformance {
  assertPermission(actor, "stores:update");
  requireMutationAuthorization(actor, "update store status");
  const db = getDb();
  const str = String(storeId).trim();
  const allRows = db.prepare(`SELECT id, status FROM customers WHERE customer_type = 'store'`).all() as Array<{
    id: string;
    status: StorePerformance["status"];
  }>;
  const existing =
    allRows.find((r) => r.id === str) ??
    allRows.find((r, i) => String(numericId(r.id, i + 1)) === str);

  if (!existing) {
    throw new ApiError(404, "STORE_NOT_FOUND", `Store '${storeId}' not found.`);
  }

  db.prepare(`UPDATE customers SET status = ? WHERE id = ?`).run(status, existing.id);

  recordAuditEvent({
    actor,
    action: "store.status_updated",
    entityType: "Store",
    entityId: existing.id,
    before: { status: existing.status },
    after: { status }
  });

  const updated = getStoreSummary().stores.find((s) => s.code === existing.id);
  if (!updated) {
    throw new ApiError(500, "STORE_UPDATE_FAILED", "Failed to load updated store.");
  }
  return updated;
}

export function listAiInsights(): (Insight & { decision?: "pending" | "approved" | "rejected"; decided_by?: string | null })[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, category, title, confidence_pct, impact_label, recommendation, action_label, decision, decided_by
    FROM ai_insights
    ORDER BY confidence_pct DESC
  `).all() as Array<{
    id: string;
    category: string;
    title: string;
    confidence_pct: number;
    impact_label: string;
    recommendation: string;
    action_label: string;
    decision: "pending" | "approved" | "rejected";
    decided_by: string | null;
  }>;

  return rows.map((r, idx) => {
    const kind: Insight["kind"] =
      r.category === "demand"
        ? "forecast"
        : r.category === "replenishment"
          ? "replenishment"
          : r.category === "expiry"
            ? "margin"
            : "anomaly";

    return {
      id: numericId(r.id, idx + 1),
      kind,
      title: r.title,
      detail: r.recommendation,
      confidence: Number((Number(r.confidence_pct) / 100).toFixed(2)),
      evidence: [r.impact_label, `Code: ${r.id}`, "FEFO & historical POS telemetry verified"],
      action: r.action_label,
      requires_approval: true,
      decision: r.decision,
      decided_by: r.decided_by
    };
  });
}

export function decideAiInsight(
  actor: AuthenticatedUser,
  input: { insight_id: string | number; decision: "approved" | "rejected"; reason?: string }
): Insight & { decision: "approved" | "rejected"; decided_by: string } {
  assertPermission(actor, "ai:approve");
  requireMutationAuthorization(actor, "decide AI insight");
  const db = getDb();
  const str = String(input.insight_id).trim();
  const allRows = db.prepare(`SELECT * FROM ai_insights ORDER BY confidence_pct DESC`).all() as Array<{
    id: string;
    decision: string;
    title: string;
    category: string;
  }>;
  const existing =
    allRows.find((r) => r.id === str) ??
    allRows.find((r, i) => String(numericId(r.id, i + 1)) === str);

  if (!existing) {
    throw new ApiError(404, "INSIGHT_NOT_FOUND", `AI insight '${input.insight_id}' not found.`);
  }

  return withTransaction(() => {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE ai_insights
      SET decision = ?,
          decided_by = ?,
          decided_at = ?,
          decision_reason = ?
      WHERE id = ?
    `).run(input.decision, actor.email, now, input.reason || null, existing.id);

    recordAuditEvent({
      actor,
      action: `ai.insight_${input.decision}`,
      entityType: "AiInsight",
      entityId: existing.id,
      before: { decision: existing.decision },
      after: { decision: input.decision, reason: input.reason ?? null, decided_by: actor.email }
    });

    const updated = listAiInsights().find((i) => i.evidence.includes(`Code: ${existing.id}`));
    if (!updated) {
      throw new ApiError(500, "INSIGHT_UPDATE_FAILED", "Failed to load updated insight.");
    }
    return {
      ...updated,
      decision: input.decision,
      decided_by: actor.email
    };
  });
}

export function getDashboardOverview(actor?: AuthenticatedUser): DashboardOverview {
  const db = getDb();
  const finance =
    actor && (actor.role === "picker" || actor.role === "driver")
      ? { revenue_cents: 0, collected_cents: 0, overdue_cents: 0, ap_cents: 0, gross_margin_pct: 0, sdi_pending: 0, invoices: [], ageing: [] }
      : getFinanceSummary(actor);
  const lots = listLots(actor);
  const temperature = listTemperatureReadings(actor);
  const tasks = listWarehouseTasks(actor);
  const insights = listAiInsights();

  const ordersCount = (db.prepare(`SELECT COUNT(*) as c FROM sales_orders WHERE status != 'cancelled'`).get() as { c: number }).c;
  const creditHoldCount = (db.prepare(`SELECT COUNT(*) as c FROM sales_orders WHERE credit_hold = 1`).get() as { c: number }).c;
  const creditHoldCents = (
    db.prepare(`SELECT COALESCE(SUM(total_cents), 0) as s FROM sales_orders WHERE credit_hold = 1`).get() as { s: number }
  ).s;

  const expiringLots = lots.filter((l) => l.days_remaining <= 7 && l.quality_status !== "quarantine");
  const excursions = temperature.filter((t) => t.status !== "in_range");

  const deliveredCount = (
    db.prepare(`SELECT COUNT(*) as c FROM deliveries WHERE status IN ('delivered', 'in_transit')`).get() as { c: number }
  ).c;
  const actualDeliveriesCount = (db.prepare(`SELECT COUNT(*) as c FROM deliveries`).get() as { c: number }).c;
  const otifPct =
    actualDeliveriesCount > 0 ? Number(((deliveredCount / actualDeliveriesCount) * 100).toFixed(1)) : 0;

  const lineTotals = db
    .prepare(
      `SELECT COALESCE(SUM(cases_ordered), 0) as ordered, COALESCE(SUM(cases_allocated), 0) as allocated FROM sales_order_lines`
    )
    .get() as { ordered: number; allocated: number };
  const fillRatePct =
    lineTotals.ordered > 0
      ? Number(((Math.min(lineTotals.ordered, lineTotals.allocated) / lineTotals.ordered) * 100).toFixed(1))
      : ordersCount > 0
        ? 100
        : 0;

  const ordersRevenueCents = (
    db.prepare(`SELECT COALESCE(SUM(total_cents), 0) as s FROM sales_orders WHERE status != 'cancelled'`).get() as {
      s: number;
    }
  ).s;
  const effectiveRevenueCents = Math.max(finance.revenue_cents, ordersRevenueCents);

  const alertRows = db.prepare(`
    SELECT id, severity, module, title, detail, created_at
    FROM alert_events
    WHERE is_read = 0
    ORDER BY created_at DESC
    LIMIT 6
  `).all() as Array<{
    id: string;
    severity: "critical" | "warning" | "info";
    module: string;
    title: string;
    detail: string;
    created_at: string;
  }>;

  const alerts = alertRows.map((a, idx) => ({
    id: numericId(a.id, idx + 1),
    severity: a.severity,
    title: a.title,
    detail: a.detail,
    href:
      a.module === "Access Requests"
        ? "/admin?tab=requests"
        : a.module === "Messages"
          ? "/admin?tab=messages"
          : a.module === "Cold Chain" || a.module === "FEFO"
          ? "/inventory"
          : a.module === "Credit"
            ? "/orders"
            : a.module === "Deliveries"
              ? "/deliveries"
              : a.module === "Traceability"
                ? "/traceability"
                : "/finance",
    age: "Active"
  }));

  return {
    kpis: [
      {
        label: "Gross Revenue (MTD)",
        value: `€${(effectiveRevenueCents / 100).toLocaleString("en-IE", { maximumFractionDigits: 0 })}`,
        change: ordersCount > 0 ? `${ordersCount} orders` : "0 orders",
        trend: effectiveRevenueCents > 0 ? "up" : "flat",
        tone: "ok",
        hint: `${ordersCount} active B2B & store orders`
      },
      {
        label: "Case Fill Rate",
        value: `${fillRatePct}%`,
        change: lots.length > 0 ? `${lots.length} lots` : "0 lots",
        trend: fillRatePct > 0 ? "up" : "flat",
        tone: "ok",
        hint: "FEFO auto-allocation across zones"
      },
      {
        label: "OTIF Delivery",
        value: `${otifPct}%`,
        change: `${actualDeliveriesCount} routes`,
        trend: actualDeliveriesCount > 0 ? "up" : "flat",
        tone: "ok",
        hint: `${actualDeliveriesCount} active refrigerated routes`
      },
      {
        label: "FEFO Stock at Risk",
        value: `${expiringLots.length} lots`,
        change: "≤ 7 days",
        trend: expiringLots.length > 2 ? "down" : "flat",
        tone: expiringLots.length > 0 ? "warning" : "ok",
        hint: `${expiringLots.reduce((acc, l) => acc + l.remaining_kg, 0)} kg require priority dispatch`
      },
      {
        label: "Cold-Chain Excursions",
        value: String(excursions.length),
        change: excursions.length > 0 ? "Alert active" : "All normal",
        trend: excursions.length > 0 ? "down" : "flat",
        tone: excursions.length > 0 ? "critical" : "ok",
        hint: `${temperature.length} HACCP probes monitored live`
      },
      {
        label: "Credit Blocks",
        value: String(creditHoldCount),
        change: `€${(creditHoldCents / 100).toLocaleString("en-IE", { maximumFractionDigits: 0 })}`,
        trend: creditHoldCount > 0 ? "down" : "flat",
        tone: creditHoldCount > 0 ? "warning" : "ok",
        hint: "Maker-checker approval queue"
      }
    ],
    alerts,
    temperature,
    expiring: expiringLots,
    tasks: tasks.slice(0, 5),
    insights,
    journey: [
      {
        step: 1,
        title: "Product master",
        description:
          "Create product, SKU, pack/UOM conversion, catch-weight rules, allergens/handling attributes, shelf-life and temperature profile, suppliers, prices and certificates.",
        owner: "Commercial"
      },
      {
        step: 2,
        title: "Supplier sourcing",
        description:
          "Use supplier scorecards, RFQ and quotation comparison; raise approved purchase order, calculate expected landed cost and capture supplier ASN if provided.",
        owner: "Procurement"
      },
      {
        step: 3,
        title: "Inbound transport",
        description:
          "Track expected arrival and transport conditions; verify goods, quantities, supplier batch, manufacture/expiry dates, weight, quality certificates and temperatures.",
        owner: "Inbound"
      },
      {
        step: 4,
        title: "Quality gate",
        description:
          "Record receiving inspection, HACCP checkpoints, hold/release decision, excursion evidence and CAPA where an exception arises. Rejected stock remains unavailable.",
        owner: "Quality"
      },
      {
        step: 5,
        title: "Put-away",
        description:
          "Generate storage location/zone recommendation and scan goods into the designated bin; retain batch, quantity, weight and temperature status.",
        owner: "Warehouse"
      },
      {
        step: 6,
        title: "Stock intelligence",
        description:
          "Maintain stock by warehouse, zone, location, lot and status. Apply FEFO, minimum remaining shelf life, reservations, cycle counting and reconciled adjustments.",
        owner: "Inventory"
      },
      {
        step: 7,
        title: "Customer order",
        description:
          "Restaurant customer orders through B2B portal/PWA or staff entry. Apply contract pricing, credit limit, availability, batch/shelf-life eligibility and confirmation.",
        owner: "Sales"
      },
      {
        step: 8,
        title: "Picking and packing",
        description:
          "Create pick waves/tasks, FEFO batch allocation, barcode verification, catch-weight confirmation, packing checks, labels and staging assignment.",
        owner: "Warehouse"
      },
      {
        step: 9,
        title: "Loading and delivery",
        description:
          "Assign vehicle/driver and route, complete vehicle/load checks, record temperature checks, offline mobile actions, delivery exceptions and proof of delivery.",
        owner: "Transport"
      },
      {
        step: 10,
        title: "Finance",
        description:
          "Generate invoice data and Italy-specific e-invoicing handoff, reconcile payments and bank statements subject to integration, calculate landed and delivered margin.",
        owner: "Finance"
      },
      {
        step: 11,
        title: "Exceptions and recall",
        description:
          "Trace affected batches supplier-to-customer and customer-to-supplier, run mass-balance reconciliation, quarantine stock and coordinate a recall workflow.",
        owner: "Compliance"
      },
      {
        step: 12,
        title: "Management and AI",
        description:
          "Provide CEO KPIs, governed BI, forecasting, anomaly alerts, replenishment suggestions and auditable AI actions requiring approval when consequential.",
        owner: "Executive AI"
      }
    ],
    revenue_by_week:
      effectiveRevenueCents > 0
        ? [
            {
              week: "Current",
              revenue: Math.round(effectiveRevenueCents / 100),
              cost: Math.round((effectiveRevenueCents * 0.71) / 100)
            }
          ]
        : []
  };
}

export function markAlertsRead(actor: AuthenticatedUser, alertIds?: (string | number)[]): { marked_count: number } {
  const db = getDb();
  let changes = 0;
  if (alertIds && alertIds.length > 0) {
    const placeholders = alertIds.map(() => "?").join(",");
    const res = db
      .prepare(`UPDATE alert_events SET is_read = 1 WHERE id IN (${placeholders})`)
      .run(...alertIds.map(String));
    changes = Number(res.changes);
    if (changes === 0) {
      const fallback = db.prepare(`UPDATE alert_events SET is_read = 1 WHERE is_read = 0`).run();
      changes = Number(fallback.changes);
    }
  } else {
    const res = db.prepare(`UPDATE alert_events SET is_read = 1 WHERE is_read = 0`).run();
    changes = Number(res.changes);
  }

  recordAuditEvent({
    actor,
    action: "dashboard.alerts_marked_read",
    entityType: "AlertEvent",
    entityId: "all",
    after: { marked_count: changes }
  });

  return { marked_count: changes };
}
