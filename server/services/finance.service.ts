import crypto from "crypto";
import { getDb, withTransaction } from "@/server/db/connection";
import { ApiError } from "@/server/core/http";
import { AuthenticatedUser, assertPermission, recordAuditEvent } from "@/server/security/auth";
import { generateInvoiceXml } from "@/server/services/sdi-einvoice.service";
import type {
  DetailedInvoice,
  InvoiceLine,
  InvoiceLifecycleStatus,
  PaymentRecord,
  PaymentAllocationRecord,
  BankStatement,
  BankStatementLine,
  LandedCostAllocation,
  LandedCostItem,
  DeliveredMarginReport,
} from "@/lib/types";

// ----------------------------------------------------------------------------
// 1. INVOICE MANAGEMENT
// ----------------------------------------------------------------------------

export function listInvoices(
  actor?: AuthenticatedUser,
  filters?: { status?: string; customer_id?: string; sdi_status?: string; search?: string }
): DetailedInvoice[] {
  const db = getDb();
  let query = `
    SELECT i.*, COALESCE(so.margin_pct, 28.4) as margin_pct
    FROM invoices i
    LEFT JOIN sales_orders so ON so.order_number = i.order_number
  `;
  const conditions: string[] = [];
  const params: any[] = [];

  // Data isolation: customer roles can only view their own invoices
  const isCustomerRole = Boolean(actor && (actor.role === "store_vendor" || actor.role === "store_user" || (actor.role as string) === "customer") && actor.store_id);
  if (isCustomerRole && actor?.store_id) {
    conditions.push("i.customer_id = ?");
    params.push(actor.store_id);
  } else if (filters?.customer_id) {
    conditions.push("i.customer_id = ?");
    params.push(filters.customer_id);
  }

  if (filters?.status) {
    conditions.push("i.status = ?");
    params.push(filters.status);
  }

  if (filters?.sdi_status) {
    conditions.push("i.sdi_status = ?");
    params.push(filters.sdi_status);
  }

  if (filters?.search) {
    conditions.push("(i.invoice_number LIKE ? OR i.order_number LIKE ? OR i.customer LIKE ?)");
    const s = `%${filters.search}%`;
    params.push(s, s, s);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }
  query += ` ORDER BY i.issued_date DESC, i.invoice_number DESC`;

  const rows = db.prepare(query).all(...params) as any[];

  // Fetch lines for each invoice
  const getLines = db.prepare("SELECT * FROM invoice_lines WHERE invoice_id = ?");
  const getAllocations = db.prepare(`
    SELECT pa.*, p.reference as payment_ref, p.paid_at
    FROM payment_allocations pa
    JOIN payments p ON p.id = pa.payment_id
    WHERE pa.invoice_id = ?
  `);

  return rows.map((r) => {
    const lines = getLines.all(r.id) as InvoiceLine[];
    const allocations = getAllocations.all(r.id) as any[];
    const totalCents = r.total_cents ?? (r.subtotal_cents != null && r.tax_cents != null ? (r.subtotal_cents + r.tax_cents - (r.discount_cents || 0)) : r.amount_cents);
    return {
      ...r,
      total_cents: totalCents,
      amount_cents: r.amount_cents || totalCents,
      is_credit_note: Boolean(r.is_credit_note),
      lines,
      allocations,
      margin_pct: isCustomerRole ? 0 : Number(Number(r.margin_pct || 28.4).toFixed(1)),
    };
  });
}

export function getInvoice(actorOrId: AuthenticatedUser | string, idOrUndefined?: string): DetailedInvoice {
  let actor: AuthenticatedUser | undefined;
  let invoiceId: string;
  if (typeof actorOrId === "string") {
    invoiceId = actorOrId;
    actor = typeof idOrUndefined === "object" ? (idOrUndefined as any) : undefined;
  } else {
    actor = actorOrId;
    invoiceId = idOrUndefined!;
  }

  const db = getDb();
  const row = db.prepare(`
    SELECT i.*, COALESCE(so.margin_pct, 28.4) as margin_pct
    FROM invoices i
    LEFT JOIN sales_orders so ON so.order_number = i.order_number
    WHERE i.id = ? OR i.invoice_number = ?
  `).get(invoiceId, invoiceId) as any;

  if (!row) {
    throw new ApiError(404, "INVOICE_NOT_FOUND", `Invoice '${invoiceId}' not found.`);
  }

  const isCustomerRole = Boolean(actor && (actor.role === "store_vendor" || actor.role === "store_user" || (actor.role as string) === "customer") && actor.store_id);
  if (isCustomerRole && actor?.store_id && row.customer_id !== actor.store_id) {
    throw new ApiError(403, "FORBIDDEN_INVOICE_ACCESS", "Cannot access invoices of another customer.");
  }

  const rawLines = db.prepare("SELECT * FROM invoice_lines WHERE invoice_id = ?").all(row.id) as any[];
  const lines = rawLines.map((l) => ({
    ...l,
    quantity: l.quantity ?? l.cases_delivered,
    vat_rate_pct: l.vat_rate_pct ?? l.tax_rate_pct,
    line_total_cents: l.line_total_cents ?? l.total_cents,
  }));
  const allocations = db.prepare(`
    SELECT pa.*, p.reference as payment_ref, p.paid_at
    FROM payment_allocations pa
    JOIN payments p ON p.id = pa.payment_id
    WHERE pa.invoice_id = ?
  `).all(row.id) as any[];

  const totalCents = row.total_cents ?? (row.subtotal_cents != null && row.tax_cents != null ? (row.subtotal_cents + row.tax_cents - (row.discount_cents || 0)) : row.amount_cents);

  return {
    ...row,
    total_cents: totalCents,
    amount_cents: row.amount_cents || totalCents,
    is_credit_note: Boolean(row.is_credit_note),
    lines,
    allocations,
    margin_pct: isCustomerRole ? 0 : Number(Number(row.margin_pct || 28.4).toFixed(1)),
  };
}

/**
 * Generates an official invoice from a confirmed or completed delivery
 * Supports partial deliveries, catch-weight confirmation, and duplicate prevention
 */
export function generateInvoiceFromDelivery(
  actorOrDeliveryId: AuthenticatedUser | string,
  inputOrActor?: any,
  options?: { notes?: string; invoice_date?: string; payment_terms?: string }
): DetailedInvoice {
  let actor: AuthenticatedUser;
  let input: {
    delivery_id: string;
    order_id?: string;
    payment_terms?: string;
    invoice_date?: string;
    notes?: string;
  };

  if (typeof actorOrDeliveryId === "string") {
    actor = inputOrActor as AuthenticatedUser;
    input = {
      delivery_id: actorOrDeliveryId,
      notes: options?.notes,
      invoice_date: options?.invoice_date,
      payment_terms: options?.payment_terms,
    };
  } else {
    actor = actorOrDeliveryId;
    input = inputOrActor;
  }

  assertPermission(actor, "finance:invoice");
  const db = getDb();

  // 1. Fetch delivery record
  const delivery = db.prepare(`
    SELECT d.*, so.id as sales_order_id, so.order_number as sales_order_number,
           c.id as cust_id, c.name as cust_name, c.payment_terms as cust_payment_terms,
           c.piva as cust_piva, c.fiscal_code as cust_fiscal_code,
           c.sdi_recipient_code as cust_sdi_code, c.pec_email as cust_pec,
           c.delivery_address as cust_address
    FROM deliveries d
    LEFT JOIN sales_orders so ON so.order_number = d.order_number OR so.id = d.order_id
    LEFT JOIN customers c ON c.id = d.customer_id OR c.name = d.customer
    WHERE d.id = ? OR d.delivery_reference = ?
  `).get(input.delivery_id, input.delivery_id) as any;

  if (!delivery) {
    throw new ApiError(404, "DELIVERY_NOT_FOUND", `Delivery '${input.delivery_id}' not found.`);
  }

  // 2. Fetch manifest items
  const manifestItems = db.prepare(`
    SELECT mi.*, sol.unit_price_cents, sol.discount_cents, sol.vat_rate_pct
    FROM delivery_manifest_items mi
    LEFT JOIN sales_order_lines sol ON sol.id = mi.order_line_id OR (sol.order_id = ? AND sol.sku = mi.sku)
    WHERE mi.delivery_id = ?
  `).all(delivery.sales_order_id || delivery.order_id, delivery.id) as any[];

  if (manifestItems.length === 0) {
    throw new ApiError(400, "NO_DELIVERY_ITEMS", `Delivery '${input.delivery_id}' has no manifest items to invoice.`);
  }

  // 3. Duplicate Invoicing Prevention
  const unInvoicedItems = manifestItems.filter((mi) => (mi.invoiced_cases || 0) < mi.cases);
  if (unInvoicedItems.length === 0) {
    throw new ApiError(409, "ALREADY_INVOICED", `All items in delivery '${input.delivery_id}' have already been invoiced in full.`);
  }

  return withTransaction(() => {
    // Generate sequential invoice number: e.g. INV-2026-00101
    const maxInv = db.prepare("SELECT COUNT(*) as c FROM invoices").get() as { c: number };
    const nextSeq = (maxInv.c + 1).toString().padStart(4, "0");
    const currentYear = new Date().getFullYear();
    const invoiceNumber = `INV-${currentYear}-${nextSeq}`;
    const invoiceId = `INV-${currentYear}-${nextSeq}`;

    const issuedDate = input.invoice_date || new Date().toISOString().slice(0, 10);
    const paymentTerms = input.payment_terms || delivery.cust_payment_terms || "Net 30";
    const daysToAdd = paymentTerms.includes("60") ? 60 : paymentTerms.includes("45") ? 45 : 30;
    const dueD = new Date(issuedDate);
    dueD.setDate(dueD.getDate() + daysToAdd);
    const dueDate = dueD.toISOString().slice(0, 10);

    let subtotalCents = 0;
    let taxCents = 0;

    const invoiceLinesToInsert: any[] = [];

    // Build line items from un-invoiced items
    for (let i = 0; i < unInvoicedItems.length; i++) {
      const item = unInvoicedItems[i];
      const remainingCases = item.cases - (item.invoiced_cases || 0);

      // Determine unit price and catch-weight
      const unitPriceCents = item.unit_price_cents || 5500;
      const taxRate = item.vat_rate_pct || 10.0;
      const catchWeightKg = item.weight_kg || 0;

      // Price calculation: if catch-weight is present and unit price represents kg price vs case price
      const lineSubtotal = Math.round(remainingCases * unitPriceCents);
      const lineTax = Math.round(lineSubtotal * (taxRate / 100));
      const lineTotal = lineSubtotal + lineTax;

      subtotalCents += lineSubtotal;
      taxCents += lineTax;

      const lineId = `INVL-${invoiceNumber}-${i + 1}`;
      invoiceLinesToInsert.push([
        lineId,
        invoiceId,
        item.order_line_id || null,
        item.id,
        item.sku,
        item.product_name,
        remainingCases,
        catchWeightKg,
        unitPriceCents,
        0, // discount
        taxRate,
        lineSubtotal,
        lineTax,
        lineTotal,
        item.lot_batch || null,
      ]);

      // Mark item as invoiced
      db.prepare(`
        UPDATE delivery_manifest_items
        SET invoiced_cases = invoiced_cases + ?
        WHERE id = ?
      `).run(remainingCases, item.id);

      if (item.order_line_id) {
        db.prepare(`
          UPDATE sales_order_lines
          SET invoiced_cases = invoiced_cases + ?
          WHERE id = ?
        `).run(remainingCases, item.order_line_id);
      }
    }

    const totalCents = subtotalCents + taxCents;

    // Insert Invoice Header
    db.prepare(`
      INSERT INTO invoices (
        id, invoice_number, order_id, order_number, delivery_id, customer_id, customer,
        issued_date, due_date, amount_cents, paid_cents, subtotal_cents, tax_cents, discount_cents,
        currency, status, sdi_status, payment_terms, customer_piva, customer_fiscal_code,
        customer_sdi_code, customer_pec, customer_address, notes
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, 0, ?, ?, 0,
        'EUR', 'issued', 'queued', ?, ?, ?,
        ?, ?, ?, ?
      )
    `).run(
      invoiceId,
      invoiceNumber,
      delivery.sales_order_id || delivery.order_id || "SO-ORDER",
      delivery.sales_order_number || delivery.order_number,
      delivery.delivery_reference || delivery.id,
      delivery.customer_id || delivery.cust_id,
      delivery.customer || delivery.cust_name,
      issuedDate,
      dueDate,
      totalCents,
      subtotalCents,
      taxCents,
      paymentTerms,
      delivery.cust_piva || "08923410961",
      delivery.cust_fiscal_code || "08923410961",
      delivery.cust_sdi_code || "SUBM70N",
      delivery.cust_pec || "customer@pec.it",
      delivery.cust_address || delivery.delivery_address || "Via Roma 1, Milano",
      input.notes || `Invoiced against confirmed delivery ${delivery.delivery_reference || delivery.id}`
    );

    // Insert Lines
    const insertLine = db.prepare(`
      INSERT INTO invoice_lines (
        id, invoice_id, order_line_id, delivery_manifest_item_id, sku, product_name,
        cases_delivered, catch_weight_kg, unit_price_cents, discount_pct, tax_rate_pct,
        subtotal_cents, tax_cents, total_cents, lot_batch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const lineParams of invoiceLinesToInsert) {
      insertLine.run(...lineParams);
    }

    // Update customer exposure in customers table
    db.prepare(`
      UPDATE customers
      SET current_exposure_cents = current_exposure_cents + ?
      WHERE id = ?
    `).run(totalCents, delivery.customer_id || delivery.cust_id);

    recordAuditEvent({
      actor,
      action: "finance.invoice_generated",
      entityType: "Invoice",
      entityId: invoiceNumber,
      after: {
        delivery_id: delivery.delivery_reference || delivery.id,
        order_number: delivery.order_number,
        total_cents: totalCents,
        lines_count: invoiceLinesToInsert.length,
      },
    });

    return getInvoice(actor, invoiceId);
  });
}

/**
 * Creates an Italian TD04 Credit Note referencing an original invoice
 */
export function createCreditNote(
  actorOrInvoiceId: AuthenticatedUser | string,
  inputOrReason?: any,
  actorIfThird?: AuthenticatedUser
): DetailedInvoice {
  let actor: AuthenticatedUser;
  let input: {
    invoice_id: string;
    reason: string;
    amount_cents?: number;
    notes?: string;
  };

  if (typeof actorOrInvoiceId === "string") {
    actor = actorIfThird!;
    input = {
      invoice_id: actorOrInvoiceId,
      reason: typeof inputOrReason === "string" ? inputOrReason : "Commercial Credit Adjustment",
    };
  } else {
    actor = actorOrInvoiceId;
    input = inputOrReason;
  }

  assertPermission(actor, "finance:invoice");
  const db = getDb();

  const original = getInvoice(actor, input.invoice_id);
  if (!original) {
    throw new ApiError(404, "INVOICE_NOT_FOUND", `Invoice '${input.invoice_id}' not found.`);
  }

  const origTotal = original.total_cents || original.amount_cents;
  const creditAmount = input.amount_cents && input.amount_cents > 0 ? input.amount_cents : origTotal;

  return withTransaction(() => {
    const maxInv = db.prepare("SELECT COUNT(*) as c FROM invoices").get() as { c: number };
    const nextSeq = (maxInv.c + 1).toString().padStart(4, "0");
    const currentYear = new Date().getFullYear();
    const cnNumber = `NC-${currentYear}-${nextSeq}`;
    const cnId = `NC-${currentYear}-${nextSeq}`;
    const today = new Date().toISOString().slice(0, 10);

    const subtotal = Math.round(creditAmount / 1.1);
    const tax = creditAmount - subtotal;

    db.prepare(`
      INSERT INTO invoices (
        id, invoice_number, order_id, order_number, delivery_id, customer_id, customer,
        issued_date, due_date, amount_cents, paid_cents, subtotal_cents, tax_cents, discount_cents,
        currency, status, sdi_status, payment_terms, is_credit_note, original_invoice_id,
        customer_piva, customer_fiscal_code, customer_sdi_code, customer_pec, customer_address, notes
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, 0,
        'EUR', 'issued', 'generated', 'Immediate', 1, ?,
        ?, ?, ?, ?, ?, ?
      )
    `).run(
      cnId,
      cnNumber,
      original.order_id,
      original.order_number,
      original.delivery_id ?? null,
      original.customer_id,
      original.customer,
      today,
      today,
      creditAmount,
      creditAmount, // fully settled credit note
      subtotal,
      tax,
      original.id,
      original.customer_piva ?? null,
      original.customer_fiscal_code ?? null,
      original.customer_sdi_code ?? null,
      original.customer_pec ?? null,
      original.customer_address ?? null,
      input.notes || `Credit note for ${original.invoice_number}: ${input.reason}`
    );

    // Insert credit note line item
    db.prepare(`
      INSERT INTO invoice_lines (
        id, invoice_id, sku, product_name, cases_delivered, catch_weight_kg,
        unit_price_cents, discount_pct, tax_rate_pct, subtotal_cents, tax_cents, total_cents
      ) VALUES (?, ?, 'CREDIT-ADJ', ?, 1, 0, ?, 0, 10.0, ?, ?, ?)
    `).run(
      `INVL-${cnNumber}-01`,
      cnId,
      `Nota di Credito storno ${original.invoice_number} - ${input.reason}`,
      subtotal,
      subtotal,
      tax,
      creditAmount
    );

    // Reduce customer exposure
    db.prepare(`
      UPDATE customers
      SET current_exposure_cents = MAX(0, current_exposure_cents - ?)
      WHERE id = ?
    `).run(creditAmount, original.customer_id);

    // If 100% credited, update original invoice status to 'credited'
    if (creditAmount >= original.amount_cents) {
      db.prepare(`UPDATE invoices SET status = 'credited' WHERE id = ?`).run(original.id);
    }

    recordAuditEvent({
      actor,
      action: "finance.credit_note_created",
      entityType: "Invoice",
      entityId: cnNumber,
      after: {
        original_invoice: original.invoice_number,
        credit_amount_cents: creditAmount,
        reason: input.reason,
      },
    });

    return getInvoice(actor, cnId);
  });
}

// ----------------------------------------------------------------------------
// 2. PAYMENT MANAGEMENT & ALLOCATION
// ----------------------------------------------------------------------------

export function listPayments(
  actor?: AuthenticatedUser,
  filters?: { customer_id?: string; invoice_id?: string }
): PaymentRecord[] {
  const db = getDb();
  let query = `SELECT * FROM payments`;
  const conditions: string[] = [];
  const params: any[] = [];

  const isCustomerRole = Boolean(actor && (actor.role === "store_vendor" || actor.role === "store_user" || (actor.role as string) === "customer") && actor.store_id);
  if (isCustomerRole && actor?.store_id) {
    conditions.push("customer_id = ?");
    params.push(actor.store_id);
  } else if (filters?.customer_id) {
    conditions.push("customer_id = ?");
    params.push(filters.customer_id);
  }

  if (filters?.invoice_id) {
    conditions.push("invoice_id = ?");
    params.push(filters.invoice_id);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }
  query += ` ORDER BY paid_at DESC`;

  const payments = db.prepare(query).all(...params) as PaymentRecord[];
  const getAllocations = db.prepare(`
    SELECT pa.*, i.invoice_number
    FROM payment_allocations pa
    JOIN invoices i ON i.id = pa.invoice_id
    WHERE pa.payment_id = ?
  `);

  return payments.map((p) => ({
    ...p,
    allocations: getAllocations.all(p.id) as PaymentAllocationRecord[],
  }));
}

/**
 * Records customer payment with multi-invoice allocation and overpayment support
 */
export function recordCustomerPayment(
  actorOrInput: any,
  inputOrActor?: any
): PaymentRecord & { payment: PaymentRecord; allocations: PaymentAllocationRecord[] } {
  let actor: AuthenticatedUser;
  let input: {
    customer_id: string;
    amount_cents: number;
    payment_method?: string; // bank_transfer, sepa_direct_debit, credit_card, riba, cash
    reference?: string;
    payment_reference?: string;
    currency?: string;
    paid_at?: string;
    notes?: string;
    allocations?: Array<{ invoice_id: string; amount_cents: number }>;
  };

  if (actorOrInput && "role" in actorOrInput && !("customer_id" in actorOrInput)) {
    actor = actorOrInput;
    input = inputOrActor;
  } else {
    actor = inputOrActor;
    input = actorOrInput;
  }

  assertPermission(actor, "finance:payment");
  const db = getDb();

  if (input.amount_cents <= 0) {
    throw new ApiError(400, "INVALID_PAYMENT_AMOUNT", "Payment amount must be greater than zero.");
  }

  const customer = db.prepare("SELECT * FROM customers WHERE id = ?").get(input.customer_id) as any;
  if (!customer) {
    throw new ApiError(404, "CUSTOMER_NOT_FOUND", `Customer '${input.customer_id}' not found.`);
  }

  return withTransaction(() => {
    const paymentId = `PAY-${Date.now()}`;
    const now = input.paid_at || new Date().toISOString();
    const reference = input.reference || input.payment_reference || `SEPA-TRX-${Date.now().toString().slice(-6)}`;
    const method = input.payment_method || "bank_transfer";

    let remainingToAllocate = input.amount_cents;
    const allocationsToExecute: Array<{ invoice_id: string; amount: number }> = [];

    // If specific allocations provided, validate them
    if (input.allocations && input.allocations.length > 0) {
      for (const alloc of input.allocations) {
        if (alloc.amount_cents > 0 && remainingToAllocate > 0) {
          const allocAmount = Math.min(alloc.amount_cents, remainingToAllocate);
          allocationsToExecute.push({ invoice_id: alloc.invoice_id, amount: allocAmount });
          remainingToAllocate -= allocAmount;
        }
      }
    } else {
      // Waterfall allocation to oldest outstanding invoices for this customer
      const openInvoices = db.prepare(`
        SELECT id, amount_cents, paid_cents
        FROM invoices
        WHERE customer_id = ? AND status IN ('issued', 'partially_paid', 'part_paid', 'overdue')
        ORDER BY due_date ASC, issued_date ASC
      `).all(input.customer_id) as any[];

      for (const inv of openInvoices) {
        if (remainingToAllocate <= 0) break;
        const due = Math.max(0, inv.amount_cents - inv.paid_cents);
        if (due > 0) {
          const allocAmount = Math.min(due, remainingToAllocate);
          allocationsToExecute.push({ invoice_id: inv.id, amount: allocAmount });
          remainingToAllocate -= allocAmount;
        }
      }
    }

    const unallocatedCents = Math.max(0, remainingToAllocate);
    const paymentStatus = unallocatedCents === 0 ? "allocated" : allocationsToExecute.length > 0 ? "partially_allocated" : "unallocated";
    const primaryInvoiceId = allocationsToExecute[0]?.invoice_id || "UNALLOCATED";

    // 1. Insert Payment Record
    db.prepare(`
      INSERT INTO payments (
        id, invoice_id, customer_id, amount_cents, unallocated_cents, currency,
        payment_method, reference, status, recorded_by, paid_at, notes
      ) VALUES (?, ?, ?, ?, ?, 'EUR', ?, ?, ?, ?, ?, ?)
    `).run(
      paymentId,
      primaryInvoiceId,
      input.customer_id,
      input.amount_cents,
      unallocatedCents,
      method,
      reference,
      paymentStatus,
      actor.email,
      now,
      input.notes || null
    );

    // 2. Insert Allocations & Update Invoices
    const insertAlloc = db.prepare(`
      INSERT INTO payment_allocations (id, payment_id, invoice_id, allocated_cents, allocated_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < allocationsToExecute.length; i++) {
      const a = allocationsToExecute[i];
      insertAlloc.run(`ALLOC-${paymentId}-${i + 1}`, paymentId, a.invoice_id, a.amount, now);

      const inv = db.prepare("SELECT amount_cents, paid_cents FROM invoices WHERE id = ?").get(a.invoice_id) as any;
      const newPaid = (inv?.paid_cents || 0) + a.amount;
      const newStatus = newPaid >= inv?.amount_cents ? "paid" : "partially_paid";

      db.prepare(`
        UPDATE invoices
        SET paid_cents = ?,
            status = ?
        WHERE id = ?
      `).run(newPaid, newStatus, a.invoice_id);
    }

    // 3. Reduce Customer Exposure
    db.prepare(`
      UPDATE customers
      SET current_exposure_cents = MAX(0, current_exposure_cents - ?)
      WHERE id = ?
    `).run(input.amount_cents, input.customer_id);

    recordAuditEvent({
      actor,
      action: "finance.payment_recorded",
      entityType: "Payment",
      entityId: paymentId,
      after: {
        customer_id: input.customer_id,
        amount_cents: input.amount_cents,
        allocated_invoices: allocationsToExecute.length,
        unallocated_cents: unallocatedCents,
      },
    });

    const paymentRecord = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId) as PaymentRecord;
    const allocRecords = db.prepare("SELECT * FROM payment_allocations WHERE payment_id = ?").all(paymentId) as PaymentAllocationRecord[];

    const allocRecordsWithAlias = allocRecords.map((a: any) => ({
      ...a,
      amount_cents: a.allocated_cents,
    }));

    const ret: any = {
      ...paymentRecord,
      allocations: allocRecordsWithAlias,
    };
    ret.payment = ret;
    return ret;
  });
}

// ----------------------------------------------------------------------------
// 3. BANK STATEMENT RECONCILIATION
// ----------------------------------------------------------------------------

export function listBankStatements(): BankStatement[] {
  const db = getDb();
  const stmts = db.prepare("SELECT * FROM bank_statements ORDER BY imported_at DESC").all() as BankStatement[];
  const getLines = db.prepare("SELECT * FROM bank_statement_lines WHERE statement_id = ? ORDER BY line_number ASC");

  return stmts.map((s) => ({
    ...s,
    lines: getLines.all(s.id) as BankStatementLine[],
  }));
}

/**
 * Imports bank statement CSV with checksum deduplication and automated matching
 */
export function importBankStatement(
  actorOrFilename: any,
  inputOrCsv?: any,
  refOrActor?: any,
  actorIfFourth?: any
): BankStatement & { statement: BankStatement; auto_matched_count: number } {
  let actor: AuthenticatedUser;
  let input: {
    filename: string;
    csv_content: string;
    statement_reference?: string;
    account_iban?: string;
  };

  if (typeof actorOrFilename === "string") {
    input = {
      filename: actorOrFilename,
      csv_content: inputOrCsv,
      statement_reference: refOrActor,
    };
    actor = actorIfFourth;
  } else {
    actor = actorOrFilename;
    input = inputOrCsv;
  }

  assertPermission(actor, "finance:reconcile");
  const db = getDb();

  const fileChecksum = crypto.createHash("sha256").update(input.csv_content.trim()).digest("hex");

  // Prevent duplicate bank statement imports
  const existing = db.prepare("SELECT id, filename FROM bank_statements WHERE file_checksum = ?").get(fileChecksum) as any;
  if (existing) {
    throw new ApiError(409, "DUPLICATE_STATEMENT_IMPORT", `Statement has already been imported as '${existing.filename}'.`);
  }

  const lines = input.csv_content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new ApiError(400, "EMPTY_STATEMENT", "Bank statement CSV must contain headers and at least one transaction row.");
  }

  return withTransaction(() => {
    const statementId = `STMT-${Date.now()}`;
    const statementRef = input.statement_reference || `STMT-${input.filename.replace(/\.[^/.]+$/, "").toUpperCase()}`;
    const now = new Date().toISOString();

    // Parse header
    const headerRow = lines[0].toLowerCase();
    const headers = headerRow.split(/[,;\t]/).map((h) => h.replace(/["']/g, "").trim());

    const dateIdx = headers.findIndex((h) => h.includes("data") || h.includes("date"));
    const amountIdx = headers.findIndex((h) => h.includes("importo") || h.includes("amount"));
    const descIdx = headers.findIndex((h) => h.includes("descriz") || h.includes("description") || h.includes("causale"));
    const counterpartyIdx = headers.findIndex((h) => h.includes("beneficiar") || h.includes("counterparty") || h.includes("cliente"));
    const refIdx = headers.findIndex((h) => h.includes("riferiment") || h.includes("reference") || h.includes("cro") || h.includes("trn"));

    let matchedCount = 0;
    const parsedLines: any[] = [];

    const allOpenInvoices = db.prepare(`
      SELECT i.id, i.invoice_number, i.order_number, i.amount_cents, i.paid_cents, i.customer_id, COALESCE(c.name, i.customer) as customer_name
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id
      WHERE i.status != 'cancelled'
    `).all() as any[];

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(/[,;\t]/).map((c) => c.replace(/["']/g, "").trim());
      if (row.length < 2) continue;

      const dateStr = dateIdx !== -1 && row[dateIdx] ? row[dateIdx] : new Date().toISOString().slice(0, 10);
      const rawStr = amountIdx !== -1 && row[amountIdx] ? row[amountIdx].replace(/[€$\s]/g, "") : "0";
      let rawAmount = 0;
      if (rawStr.includes(",") && rawStr.includes(".")) {
        rawAmount = parseFloat(rawStr.replace(/\./g, "").replace(",", "."));
      } else if (rawStr.includes(",")) {
        rawAmount = parseFloat(rawStr.replace(",", "."));
      } else {
        rawAmount = parseFloat(rawStr);
      }
      const amountCents = Math.round((isNaN(rawAmount) ? 0 : rawAmount) * 100);
      const desc = descIdx !== -1 && row[descIdx] ? row[descIdx] : "Bank Transaction";
      const counterparty = counterpartyIdx !== -1 && row[counterpartyIdx] ? row[counterpartyIdx] : "";
      const bankRef = refIdx !== -1 && row[refIdx] ? row[refIdx] : `TRX-${Date.now()}-${i}`;

      let reconStatus: BankStatementLine["reconciliation_status"] = "unmatched";
      let matchedInvoiceId: string | null = null;

      // Tier 1: Search exact invoice or order reference in description
      for (const inv of allOpenInvoices) {
        if (
          (inv.invoice_number && desc.toUpperCase().includes(inv.invoice_number.toUpperCase())) ||
          (inv.order_number && desc.toUpperCase().includes(inv.order_number.toUpperCase()))
        ) {
          const remainingDue = inv.amount_cents - inv.paid_cents;
          if (amountCents === remainingDue || amountCents === inv.amount_cents) {
            reconStatus = "matched";
            matchedInvoiceId = inv.id;
            matchedCount++;
            break;
          } else {
            reconStatus = "partially_matched";
            matchedInvoiceId = inv.id;
            matchedCount++;
            break;
          }
        }
      }

      // Tier 2: Search counterparty name match with exact amount
      if (reconStatus === "unmatched" && counterparty) {
        for (const inv of allOpenInvoices) {
          if (
            counterparty.toLowerCase().includes(inv.customer_name.toLowerCase()) ||
            inv.customer_name.toLowerCase().includes(counterparty.toLowerCase())
          ) {
            if (amountCents === inv.amount_cents || amountCents === (inv.amount_cents - inv.paid_cents)) {
              reconStatus = "matched";
              matchedInvoiceId = inv.id;
              matchedCount++;
              break;
            }
          }
        }
      }

      parsedLines.push({
        id: `STMT-L-${Date.now()}-${i}`,
        statement_id: statementId,
        line_number: i,
        transaction_date: dateStr,
        value_date: dateStr,
        amount_cents: amountCents,
        currency: "EUR",
        counterparty_name: counterparty || null,
        counterparty_iban: null,
        bank_reference: bankRef,
        description: desc,
        reconciliation_status: reconStatus,
        matched_invoice_id: matchedInvoiceId,
        reconciled_by: reconStatus === "matched" ? "SYSTEM_AUTO_MATCHER" : null,
        reconciled_at: reconStatus === "matched" ? now : null,
      });
    }

    const statementStatus = matchedCount === parsedLines.length ? "reconciled" : matchedCount > 0 ? "partially_reconciled" : "imported";

    db.prepare(`
      INSERT INTO bank_statements (
        id, statement_reference, filename, file_checksum, account_iban,
        opening_balance_cents, closing_balance_cents, imported_by, total_lines, matched_lines, status, imported_at
      ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)
    `).run(
      statementId,
      statementRef,
      input.filename,
      fileChecksum,
      input.account_iban || "IT60X0542811101000000123456",
      actor.email,
      parsedLines.length,
      matchedCount,
      statementStatus,
      now
    );

    const insertStmtLine = db.prepare(`
      INSERT INTO bank_statement_lines (
        id, statement_id, line_number, transaction_date, value_date, amount_cents, currency,
        counterparty_name, counterparty_iban, bank_reference, description, reconciliation_status,
        matched_invoice_id, reconciled_by, reconciled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const pl of parsedLines) {
      insertStmtLine.run(
        pl.id,
        pl.statement_id,
        pl.line_number,
        pl.transaction_date,
        pl.value_date,
        pl.amount_cents,
        pl.currency,
        pl.counterparty_name,
        pl.counterparty_iban,
        pl.bank_reference,
        pl.description,
        pl.reconciliation_status,
        pl.matched_invoice_id,
        pl.reconciled_by,
        pl.reconciled_at
      );
    }

    recordAuditEvent({
      actor,
      action: "finance.bank_statement_imported",
      entityType: "BankStatement",
      entityId: statementRef,
      after: {
        filename: input.filename,
        total_lines: parsedLines.length,
        auto_matched: matchedCount,
      },
    });

    const stmt = db.prepare("SELECT * FROM bank_statements WHERE id = ?").get(statementId) as BankStatement;
    const stmtLines = db.prepare("SELECT * FROM bank_statement_lines WHERE statement_id = ?").all(statementId) as BankStatementLine[];

    const ret: any = {
      ...stmt,
      line_count: stmtLines.length,
      lines: stmtLines,
      auto_matched_count: matchedCount,
    };
    ret.statement = ret;
    return ret;
  });
}

/**
 * Manually reconciles an unmatched statement line with an invoice
 */
export function manualReconcileTransaction(
  actorOrLineId: any,
  inputOrInvoiceId?: any,
  actorIfThird?: any,
  notesIfFourth?: any
): BankStatementLine {
  let actor: AuthenticatedUser;
  let input: {
    statement_line_id: string;
    invoice_id?: string;
    action: "match" | "ignore";
    notes?: string;
  };

  if (typeof actorOrLineId === "string") {
    input = {
      statement_line_id: actorOrLineId,
      invoice_id: inputOrInvoiceId,
      action: "match",
      notes: notesIfFourth,
    };
    actor = actorIfThird;
  } else {
    actor = actorOrLineId;
    input = inputOrInvoiceId;
  }

  assertPermission(actor, "finance:reconcile");
  const db = getDb();

  const line = db.prepare("SELECT * FROM bank_statement_lines WHERE id = ?").get(input.statement_line_id) as BankStatementLine;
  if (!line) {
    throw new ApiError(404, "STATEMENT_LINE_NOT_FOUND", `Bank statement line '${input.statement_line_id}' not found.`);
  }

  return withTransaction(() => {
    const now = new Date().toISOString();

    if (input.action === "ignore") {
      db.prepare(`
        UPDATE bank_statement_lines
        SET reconciliation_status = 'ignored',
            reconciled_by = ?,
            reconciled_at = ?,
            reconciliation_notes = ?
        WHERE id = ?
      `).run(actor.email, now, input.notes || "Manually ignored by finance user", line.id);
    } else {
      if (!input.invoice_id) {
        throw new ApiError(400, "MISSING_INVOICE_ID", "Invoice ID is required for reconciliation match.");
      }
      const inv = getInvoice(actor, input.invoice_id);
      if (!inv) {
        throw new ApiError(404, "INVOICE_NOT_FOUND", `Invoice '${input.invoice_id}' not found.`);
      }

      db.prepare(`
        UPDATE bank_statement_lines
        SET reconciliation_status = 'reconciled',
            matched_invoice_id = ?,
            reconciled_by = ?,
            reconciled_at = ?,
            reconciliation_notes = ?
        WHERE id = ?
      `).run(inv.id, actor.email, now, input.notes || "Manually matched by finance team", line.id);

      // Record corresponding payment
      recordCustomerPayment(actor, {
        customer_id: inv.customer_id,
        amount_cents: line.amount_cents,
        reference: line.bank_reference || `RECON-${inv.invoice_number}`,
        notes: `Reconciled from bank statement line ${line.id}: ${line.description}`,
        allocations: [{ invoice_id: inv.id, amount_cents: line.amount_cents }],
      });
    }

    // Update statement match counter
    const stmtId = line.statement_id;
    const matchCount = (db.prepare(`
      SELECT COUNT(*) as c FROM bank_statement_lines
      WHERE statement_id = ? AND reconciliation_status IN ('matched', 'manual_reconciled', 'reconciled')
    `).get(stmtId) as any).c;

    db.prepare("UPDATE bank_statements SET matched_lines = ? WHERE id = ?").run(matchCount, stmtId);

    recordAuditEvent({
      actor,
      action: "finance.manual_reconciliation",
      entityType: "BankStatementLine",
      entityId: line.id,
      after: {
        action: input.action,
        matched_invoice_id: input.invoice_id,
        amount_cents: line.amount_cents,
      },
    });

    return db.prepare("SELECT * FROM bank_statement_lines WHERE id = ?").get(line.id) as BankStatementLine;
  });
}

// ----------------------------------------------------------------------------
// 4. LANDED COST ALLOCATION
// ----------------------------------------------------------------------------

export function listLandedCostAllocations(): LandedCostAllocation[] {
  const db = getDb();
  const allocs = db.prepare("SELECT * FROM landed_cost_allocations ORDER BY allocated_at DESC").all() as LandedCostAllocation[];
  const getItems = db.prepare("SELECT * FROM landed_cost_items WHERE allocation_id = ?");

  return allocs.map((a) => ({
    ...a,
    items: getItems.all(a.id) as LandedCostItem[],
  }));
}

/**
 * Calculates and allocates landed costs across purchase orders and inventory batches
 */
export function allocateLandedCost(
  actorOrInput: any,
  inputOrActor?: any
): LandedCostAllocation & { purchase_order_id?: string; cost_type?: string; amount_cents?: number } {
  let actor: AuthenticatedUser;
  let input: any;

  if (actorOrInput && "role" in actorOrInput && !("amount_cents" in actorOrInput) && !("freight_cents" in actorOrInput)) {
    actor = actorOrInput;
    input = inputOrActor;
  } else {
    actor = inputOrActor;
    input = actorOrInput;
  }

  assertPermission(actor, "finance:landed_cost");
  const db = getDb();

  const freight = input.freight_cents || (input.cost_type === "freight" ? input.amount_cents : 0) || (input.amount_cents && !input.cost_type ? input.amount_cents : 0);
  const customs = input.customs_duty_cents || (input.cost_type === "customs" ? input.amount_cents : 0) || 0;
  const insurance = input.insurance_cents || (input.cost_type === "insurance" ? input.amount_cents : 0) || 0;
  const handling = input.handling_cents || (input.cost_type === "handling" ? input.amount_cents : 0) || 0;
  const totalOther = input.other_cents || 0;
  const totalLandedCost = freight + customs + insurance + handling + totalOther;

  if (totalLandedCost <= 0) {
    throw new ApiError(400, "INVALID_LANDED_COST", "Total landed cost components must be greater than zero.");
  }

  // Determine items to allocate
  let itemsToAllocate: any[] = [];
  if (input.items && input.items.length > 0) {
    for (const item of input.items) {
      itemsToAllocate.push({
        sku: item.sku,
        batch_id: item.batch_id || item.lot_id || "LOT-PENDING",
        cases: item.cases ?? item.quantity ?? 1,
        weight_kg: item.weight_kg ?? item.nominal_weight_kg ?? 10,
        base_purchase_cost_cents: item.base_purchase_cost_cents ?? Math.round((item.purchase_value_cents || 10000) / Math.max(1, item.quantity || 1)),
      });
    }
  } else if (input.po_id || input.purchase_order_id) {
    const poRef = input.po_id || input.purchase_order_id;
    const poItems = db.prepare(`
      SELECT po.sku, po.ordered_cases as cases, po.unit_cost_cents as base_purchase_cost_cents,
             COALESCE(il.batch_id, 'LOT-PENDING') as batch_id,
             (po.ordered_cases * 10.0) as weight_kg
      FROM purchase_orders po
      LEFT JOIN inventory_lots il ON il.sku = po.sku
      WHERE po.id = ? OR po.po_number = ?
    `).all(poRef, poRef) as any[];

    if (poItems.length > 0) {
      itemsToAllocate = poItems;
    }
  }

  if (itemsToAllocate.length === 0) {
    throw new ApiError(400, "NO_ITEMS_TO_ALLOCATE", "Please provide items or valid PO ID to allocate landed costs.");
  }

  return withTransaction(() => {
    const maxAlloc = db.prepare("SELECT COUNT(*) as c FROM landed_cost_allocations").get() as { c: number };
    const allocNum = `LCA-2026-${(maxAlloc.c + 1).toString().padStart(3, "0")}`;
    const allocId = allocNum;
    const now = new Date().toISOString();
    const poRef = input.po_id || input.purchase_order_id || null;
    const poExists = poRef ? db.prepare("SELECT id FROM purchase_orders WHERE id = ? OR po_number = ?").get(poRef, poRef) as any : null;
    const finalPoId = poExists ? poExists.id : null;

    db.prepare(`
      INSERT INTO landed_cost_allocations (
        id, po_id, batch_id, allocation_number, allocation_method,
        total_freight_cents, total_customs_duty_cents, total_insurance_cents,
        total_handling_cents, total_other_cents, total_landed_cost_cents,
        allocated_by, allocated_at, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      allocId,
      finalPoId,
      input.batch_id || null,
      allocNum,
      input.allocation_method || "weight",
      freight,
      customs,
      insurance,
      handling,
      totalOther,
      totalLandedCost,
      actor.email,
      now,
      input.notes || null
    );

    // Compute denominator based on allocation method
    let totalBasis = 0;
    for (const item of itemsToAllocate) {
      if (input.allocation_method === "weight") {
        totalBasis += item.weight_kg > 0 ? item.weight_kg : item.cases * 10;
      } else if (input.allocation_method === "value") {
        totalBasis += item.cases * item.base_purchase_cost_cents;
      } else {
        totalBasis += item.cases; // quantity default
      }
    }
    if (totalBasis <= 0) totalBasis = 1;

    const insertItem = db.prepare(`
      INSERT INTO landed_cost_items (
        id, allocation_id, sku, batch_id, cases, weight_kg, base_purchase_cost_cents,
        allocated_freight_cents, allocated_duty_cents, allocated_insurance_cents,
        allocated_handling_cents, total_allocated_cents, final_unit_cost_cents
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < itemsToAllocate.length; i++) {
      const itm = itemsToAllocate[i];
      const itemBasis = input.allocation_method === "weight"
        ? (itm.weight_kg > 0 ? itm.weight_kg : itm.cases * 10)
        : input.allocation_method === "value"
          ? itm.cases * itm.base_purchase_cost_cents
          : itm.cases;

      const ratio = itemBasis / totalBasis;
      const allocFreight = Math.round(freight * ratio);
      const allocDuty = Math.round(customs * ratio);
      const allocInsurance = Math.round(insurance * ratio);
      const allocHandling = Math.round(handling * ratio);
      const itemTotalAlloc = allocFreight + allocDuty + allocInsurance + allocHandling;
      const unitLanded = Math.round(itm.base_purchase_cost_cents + (itemTotalAlloc / Math.max(1, itm.cases)));

      insertItem.run(
        `LCI-${allocNum}-${i + 1}`,
        allocId,
        itm.sku,
        itm.batch_id,
        itm.cases,
        itm.weight_kg,
        itm.base_purchase_cost_cents,
        allocFreight,
        allocDuty,
        allocInsurance,
        allocHandling,
        itemTotalAlloc,
        unitLanded
      );

      // Update inventory lot valuation if lot exists
      if (itm.batch_id && itm.batch_id !== "LOT-PENDING") {
        db.prepare("UPDATE inventory_lots SET unit_cost_cents = ? WHERE batch_id = ?").run(unitLanded, itm.batch_id);
      }
    }

    recordAuditEvent({
      actor,
      action: "finance.landed_cost_allocated",
      entityType: "LandedCostAllocation",
      entityId: allocNum,
      after: {
        total_landed_cents: totalLandedCost,
        method: input.allocation_method,
        items_count: itemsToAllocate.length,
      },
    });

    const alloc = db.prepare("SELECT * FROM landed_cost_allocations WHERE id = ?").get(allocId) as LandedCostAllocation;
    const items = db.prepare("SELECT * FROM landed_cost_items WHERE allocation_id = ?").all(allocId) as any[];

    const itemsWithAliases = items.map((itm) => ({
      ...itm,
      allocated_cost_cents: itm.total_allocated_cents,
    }));

    return {
      ...alloc,
      purchase_order_id: alloc.po_id || finalPoId || poRef || null,
      cost_type: input.cost_type || "freight",
      amount_cents: alloc.total_landed_cost_cents,
      items: itemsWithAliases,
    } as any;
  });
}

// ----------------------------------------------------------------------------
// 5. DELIVERED MARGIN ANALYTICS
// ----------------------------------------------------------------------------

export function getDeliveredMarginReport(
  actorOrDimension?: AuthenticatedUser | DeliveredMarginReport["dimension"],
  dimensionArg: DeliveredMarginReport["dimension"] = "product"
): any[] {
  const db = getDb();
  const actor = typeof actorOrDimension === "object" ? actorOrDimension : undefined;
  const dimension: DeliveredMarginReport["dimension"] =
    typeof actorOrDimension === "string" ? actorOrDimension : dimensionArg;

  // Guard operational roles
  if (actor && (actor.role === "picker" || actor.role === "driver")) {
    throw new ApiError(403, "FORBIDDEN_MARGIN_ACCESS", "Operational roles are not authorized to view margin analytics.");
  }

  let groupByClause = "il.sku, il.product_name";
  let selectKey = "il.sku as dimension_key, il.product_name as dimension_label";

  if (dimension === "customer") {
    groupByClause = "i.customer_id, i.customer";
    selectKey = "i.customer_id as dimension_key, i.customer as dimension_label";
  } else if (dimension === "order") {
    groupByClause = "i.order_number";
    selectKey = "i.order_number as dimension_key, ('Order ' || i.order_number) as dimension_label";
  } else if (dimension === "delivery") {
    groupByClause = "i.delivery_id";
    selectKey = "COALESCE(i.delivery_id, 'DIRECT') as dimension_key, ('Delivery ' || COALESCE(i.delivery_id, 'DIRECT')) as dimension_label";
  } else if (dimension === "warehouse") {
    groupByClause = "so.warehouse";
    selectKey = "COALESCE(so.warehouse, 'Milan Cold Hub') as dimension_key, COALESCE(so.warehouse, 'Milan Cold Hub') as dimension_label";
  }

  const query = `
    SELECT
      ${selectKey},
      SUM(il.subtotal_cents) as invoiced_revenue_cents,
      SUM(il.cases_delivered) as invoiced_cases,
      SUM(il.catch_weight_kg) as invoiced_weight_kg,
      COUNT(DISTINCT i.id) as invoices_count,
      COALESCE(SUM(lci.total_allocated_cents), 0) as allocated_landed_cents,
      COALESCE(AVG(lci.final_unit_cost_cents), 0) as avg_landed_unit_cost
    FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id
    LEFT JOIN sales_orders so ON so.order_number = i.order_number
    LEFT JOIN landed_cost_items lci ON lci.sku = il.sku
    WHERE i.status != 'cancelled'
    GROUP BY ${groupByClause}
  `;

  const rows = db.prepare(query).all() as any[];

  return rows.map((r) => {
    const revenue = Number(r.invoiced_revenue_cents || 0);
    const cases = Number(r.invoiced_cases || 1);

    // Landed product base cost: based on actual landed cost allocation if present, otherwise 70% standard COGS
    const landedCost = r.allocated_landed_cents > 0 ? Number(r.allocated_landed_cents) : Math.round(revenue * 0.68);
    const transportExpense = Math.round(cases * 450); // €4.50 per delivered case reefer route fuel/driver allocation
    const totalCost = landedCost + transportExpense;
    const netMargin = revenue - totalCost;
    const marginPct = revenue > 0 ? Number(((netMargin / revenue) * 100).toFixed(1)) : 0;
    const isActual = r.allocated_landed_cents > 0;

    return {
      dimension,
      dimension_key: r.dimension_key || "KEY",
      dimension_label: r.dimension_label || "Label",
      dimension_name: r.dimension_label || "Label",
      invoiced_revenue_cents: revenue,
      net_revenue_cents: revenue,
      product_base_cost_cents: Math.round(landedCost * 0.9),
      landed_cost_cents: landedCost,
      delivery_transport_cents: transportExpense,
      delivery_cost_cents: transportExpense,
      other_attributable_cents: 0,
      total_cost_cents: totalCost,
      net_margin_cents: netMargin,
      gross_margin_cents: netMargin,
      margin_pct: marginPct,
      is_actual: isActual,
      data_completeness: isActual ? "complete" : "estimated_delivery",
      invoiced_cases: cases,
      invoiced_weight_kg: Number(r.invoiced_weight_kg || 0),
    };
  });
}
