import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextRequest } from "next/server";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ascentra-finance-test-"));
const tmpDbPath = path.join(tmpDir, "test-finance.sqlite");
process.env.SQLITE_DB_PATH = tmpDbPath;
process.env.SEED_DEMO_DATA = "true";

import { getDb, seedFinanceModule } from "@/server/db/connection";
import { signAccessToken } from "@/server/security/crypto";
import { AuthenticatedUser } from "@/server/security/auth";
import {
  listInvoices,
  getInvoice,
  generateInvoiceFromDelivery,
  createCreditNote,
  listPayments,
  recordCustomerPayment,
  listBankStatements,
  importBankStatement,
  manualReconcileTransaction,
  listLandedCostAllocations,
  allocateLandedCost,
  getDeliveredMarginReport,
} from "@/server/services/finance.service";

import {
  validateItalianPartitaIva,
  validateItalianCodiceFiscale,
  validateSdiRecipientCode,
  validateInvoiceForSdi,
  generateFatturaPaXml,
  transmitInvoiceToSdi,
  resubmitInvoiceToSdi,
} from "@/server/services/sdi-einvoice.service";

import { GET as getInvoicesRoute, POST as postInvoicesRoute } from "@/app/api/v1/finance/invoices/route";
import { GET as getInvoiceByIdRoute } from "@/app/api/v1/finance/invoices/[id]/route";
import { POST as postCreditNoteRoute } from "@/app/api/v1/finance/invoices/[id]/credit-note/route";
import { POST as postGenerateXmlRoute } from "@/app/api/v1/finance/sdi/[id]/generate-xml/route";
import { POST as postTransmitSdiRoute } from "@/app/api/v1/finance/sdi/[id]/transmit/route";
import { POST as postResubmitSdiRoute } from "@/app/api/v1/finance/sdi/[id]/resubmit/route";
import { GET as getPaymentsRoute, POST as postPaymentsRoute } from "@/app/api/v1/finance/payments/route";
import { POST as postImportStatementRoute } from "@/app/api/v1/finance/reconciliation/import/route";
import { GET as getStatementsRoute } from "@/app/api/v1/finance/reconciliation/statements/route";
import { POST as postMatchReconciliationRoute } from "@/app/api/v1/finance/reconciliation/match/route";
import { GET as getLandedCostRoute, POST as postLandedCostRoute } from "@/app/api/v1/finance/landed-cost/route";
import { GET as getMarginsRoute } from "@/app/api/v1/finance/margins/route";

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

describe("Module 10: Finance (Invoicing, Italian E-Invoicing, Payments, Reconciliation & Margins)", () => {
  let adminActor: AuthenticatedUser;
  let financeActor: AuthenticatedUser;
  let driverActor: AuthenticatedUser;
  let adminToken: string;
  let financeToken: string;
  let driverToken: string;

  before(async () => {
    (global as any).__ascentraDbInstance = null;
    const db = getDb();
    seedFinanceModule(db);

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

    financeActor = {
      id: "USR-FIN-01",
      email: "marco.finance@ascentra.it",
      name: "Marco Ferrari",
      role: "finance",
      roles: ["finance"],
      store_id: null,
      warehouse: "Milan Cold Hub",
      mfa_enabled: false,
    };

    driverActor = {
      id: "USR-DRV-01",
      email: "davide.galli@ascentra.it",
      name: "Davide Galli",
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
      roles: adminActor.roles,
      store_id: null,
      warehouse: adminActor.warehouse,
    });
    financeToken = signAccessToken({
      sub: financeActor.id,
      email: financeActor.email,
      name: financeActor.name,
      role: financeActor.role,
      roles: financeActor.roles,
      store_id: null,
      warehouse: financeActor.warehouse,
    });
    driverToken = signAccessToken({
      sub: driverActor.id,
      email: driverActor.email,
      name: driverActor.name,
      role: driverActor.role,
      roles: driverActor.roles,
      store_id: null,
      warehouse: driverActor.warehouse,
    });
  });

  after(() => {
    try {
      if (fs.existsSync(tmpDbPath)) {
        fs.unlinkSync(tmpDbPath);
      }
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("1. Customer Invoicing from Delivered Commercial Transactions", () => {
    it("generates an invoice from a confirmed delivery with catch-weights and tax breakdown", async () => {
      // Delivery DEL-2026-0301 is seeded from Module 09
      const invoice = await generateInvoiceFromDelivery("DEL-2026-0301", financeActor, {
        notes: "Automated invoice post-delivery verification",
      });

      assert.ok(invoice.id);
      assert.ok(invoice.invoice_number.startsWith("INV-"));
      assert.equal(invoice.delivery_id, "DEL-2026-0301");
      assert.equal(invoice.customer_id, "CUST-001");
      assert.equal(invoice.currency, "EUR");
      assert.ok(invoice.subtotal_cents > 0);
      assert.ok(invoice.tax_cents > 0);
      assert.equal(invoice.total_cents, invoice.subtotal_cents + invoice.tax_cents - invoice.discount_cents);
      assert.equal(invoice.status, "issued");
      assert.equal(invoice.sdi_status, "queued");

      // Verify lines were captured with immutable price snapshot
      assert.ok(invoice.lines.length > 0);
      for (const line of invoice.lines) {
        assert.ok(line.product_name);
        assert.ok(line.sku);
        assert.ok(line.quantity > 0);
        assert.ok(line.unit_price_cents > 0);
        assert.ok(line.vat_rate_pct >= 0);
        assert.ok(line.line_total_cents > 0);
      }
    });

    it("prevents duplicate invoicing for the same delivery", async () => {
      await assert.rejects(
        async () => {
          await generateInvoiceFromDelivery("DEL-2026-0301", financeActor);
        },
        (err: any) => {
          assert.equal(err.code, "ALREADY_INVOICED");
          return true;
        }
      );
    });

    it("retrieves invoice details by ID with complete line items", async () => {
      const invoices = await listInvoices();
      assert.ok(invoices.length > 0);
      const target = invoices[0];

      const detailed = await getInvoice(target.id);
      assert.ok(detailed);
      assert.equal(detailed.id, target.id);
      assert.equal(detailed.invoice_number, target.invoice_number);
      assert.ok(detailed.lines.length > 0);
    });
  });

  describe("2. Italian FatturaPA XML Generation & Fiscal Validation", () => {
    it("validates Italian Partita IVA using Modulo 10 Luhn algorithm", () => {
      // Valid P.IVA
      assert.equal(validateItalianPartitaIva("12849180159"), true);
      assert.equal(validateItalianPartitaIva("01255720169"), true);
      assert.equal(validateItalianPartitaIva("00488410010"), true);

      // Invalid P.IVA
      assert.equal(validateItalianPartitaIva("12849180150"), false); // Wrong check digit
      assert.equal(validateItalianPartitaIva("123"), false); // Too short
      assert.equal(validateItalianPartitaIva("128491801591"), false); // Too long
      assert.equal(validateItalianPartitaIva("ABCDEFGHIJK"), false); // Non-numeric
    });

    it("validates Italian Codice Fiscale format", () => {
      // Valid CF
      assert.equal(validateItalianCodiceFiscale("RSSMRA85M01H501Z"), true);
      assert.equal(validateItalianCodiceFiscale("VRDGPP75B12F205K"), true);
      assert.equal(validateItalianCodiceFiscale("12849180159"), true); // P.IVA accepted as numeric CF for companies

      // Invalid CF
      assert.equal(validateItalianCodiceFiscale("INVALIDCF"), false);
      assert.equal(validateItalianCodiceFiscale("RSSMRA85M01H501"), false); // 15 chars
    });

    it("validates SDI Recipient Code (Codice Destinatario)", () => {
      // Valid 7-char SDI codes
      assert.equal(validateSdiRecipientCode("M5UXCR1"), true);
      assert.equal(validateSdiRecipientCode("A472NK3"), true);
      assert.equal(validateSdiRecipientCode("0000000"), true); // Valid generic code for PEC destination

      // Invalid SDI codes
      assert.equal(validateSdiRecipientCode("M5UXC"), false); // 5 chars
      assert.equal(validateSdiRecipientCode("M5UXCR12"), false); // 8 chars
      assert.equal(validateSdiRecipientCode(""), false);
    });

    it("generates a compliant FatturaPA v1.2.2 XML document", async () => {
      const invoices = await listInvoices();
      const target = invoices[0];

      const validation = await validateInvoiceForSdi(target.id);
      assert.equal(validation.valid, true, `Validation failed: ${validation.errors.join(", ")}`);

      const xml = await generateFatturaPaXml(target.id);
      assert.ok(xml.includes('<?xml version="1.0" encoding="UTF-8"?>'));
      assert.ok(xml.includes('versione="FPR12"'));
      assert.ok(xml.includes('<FatturaElettronicaHeader>'));
      assert.ok(xml.includes('<CedentePrestatore>'));
      assert.ok(xml.includes('12849180159')); // Ascentra P.IVA
      assert.ok(xml.includes('<CessionarioCommittente>'));
      assert.ok(xml.includes('<FatturaElettronicaBody>'));
      assert.ok(xml.includes('<DatiGeneraliDocumento>'));
      assert.ok(xml.includes('<TipoDocumento>TD01</TipoDocumento>'));
      assert.ok(xml.includes('<DatiBeniServizi>'));
      assert.ok(xml.includes('<DatiRiepilogo>'));
    });
  });

  describe("3. SDI Intermediary Provider Adapter & Transmission Lifecycle", () => {
    it("transmits an invoice to the SDI Intermediary Gateway", async () => {
      const invoices = await listInvoices();
      const target = invoices.find((i) => i.sdi_status === "queued") || invoices[0];

      const transmission = await transmitInvoiceToSdi(target.id, financeActor);
      assert.ok(transmission.transmission_id);
      assert.equal(transmission.status, "delivered");
      assert.ok(transmission.sdi_identifier);
      assert.ok(transmission.receipt_code.startsWith("RC_")); // Ricevuta Consegna

      // Check updated invoice
      const updated = await getInvoice(target.id);
      assert.equal(updated.sdi_status, "accepted");
      assert.ok(updated.sdi_sent_at);
      assert.ok(updated.sdi_delivered_at);
      assert.equal(updated.sdi_version, 1);
    });

    it("resubmits a corrected invoice incrementing sdi_version", async () => {
      const invoices = await listInvoices();
      const target = invoices[0];

      const resubmission = await resubmitInvoiceToSdi(
        target.id,
        financeActor,
        "Resubmission with verified tax address"
      );

      assert.ok(resubmission.transmission_id);
      assert.equal(resubmission.status, "delivered");

      const updated = await getInvoice(target.id);
      assert.equal(updated.sdi_version, 2);
    });
  });

  describe("4. Customer Payments, Multi-Invoice Allocation & Credit Notes", () => {
    it("records a customer payment and allocates it across an invoice", async () => {
      const invoices = await listInvoices();
      const openInvoice = invoices.find((i) => i.paid_cents < i.total_cents) || invoices[0];
      const paymentAmount = 50000; // 500.00 EUR

      const result = await recordCustomerPayment(
        {
          customer_id: openInvoice.customer_id,
          amount_cents: paymentAmount,
          currency: "EUR",
          payment_method: "bank_transfer",
          payment_reference: "TRN-TEST-PAY-01",
          notes: "Partial payment for delivery invoice",
          allocations: [
            {
              invoice_id: openInvoice.id,
              amount_cents: paymentAmount,
            },
          ],
        },
        financeActor
      );

      assert.ok(result.payment.id);
      assert.equal(result.payment.amount_cents, paymentAmount);
      assert.equal(result.payment.status, "allocated");
      assert.equal(result.payment.unallocated_cents, 0);
      assert.equal(result.allocations.length, 1);
      assert.equal(result.allocations[0].amount_cents, paymentAmount);

      const refreshedInvoice = await getInvoice(openInvoice.id);
      assert.ok(refreshedInvoice.paid_cents >= paymentAmount);
    });

    it("handles overpayments by preserving unallocated credit on customer account", async () => {
      const invoices = await listInvoices();
      const openInvoice = invoices.find((i) => i.paid_cents < (i.total_cents || i.amount_cents)) || invoices[0];
      const openTotal = openInvoice.total_cents || openInvoice.amount_cents;
      const remainingCents = openTotal - openInvoice.paid_cents;
      const overpaymentExtra = 25000; // 250.00 EUR extra
      const totalSent = remainingCents + overpaymentExtra;

      const result = await recordCustomerPayment(
        {
          customer_id: openInvoice.customer_id,
          amount_cents: totalSent,
          payment_method: "bank_transfer",
          payment_reference: "TRN-OVERPAY-01",
          allocations: [
            {
              invoice_id: openInvoice.id,
              amount_cents: remainingCents,
            },
          ],
        },
        financeActor
      );

      assert.equal(result.payment.unallocated_cents, overpaymentExtra);
      assert.equal(result.payment.status, "partially_allocated");

      const refreshed = await getInvoice(openInvoice.id);
      assert.equal(refreshed.status, "paid");
    });

    it("issues a formal Credit Note (TD04) for returned or damaged goods", async () => {
      const invoices = await listInvoices();
      const invoiceToCredit = invoices.find((i) => !i.is_credit_note && i.status !== "credited") || invoices[0];

      const creditNote = await createCreditNote(
        invoiceToCredit.id,
        "Commercial return for temperature deviation in transport",
        financeActor
      );

      assert.ok(creditNote.id);
      assert.equal(creditNote.is_credit_note, true);
      assert.equal(creditNote.original_invoice_id, invoiceToCredit.id);
      assert.ok(creditNote.invoice_number.startsWith("NC-"));
      assert.equal(creditNote.total_cents, invoiceToCredit.total_cents);

      // Verify original invoice status updated to credited
      const original = await getInvoice(invoiceToCredit.id);
      assert.equal(original.status, "credited");

      // Verify XML for credit note produces TD04
      const xml = await generateFatturaPaXml(creditNote.id);
      assert.ok(xml.includes("<TipoDocumento>TD04</TipoDocumento>"));
    });
  });

  describe("5. Bank Statement Reconciliation Engine", () => {
    const sampleCsv = [
      "booking_date,value_date,description,amount_eur,currency,transaction_reference",
      "2026-03-05,2026-03-05,Bonifico da Ristorante Da Vittorio INV-2026-8410,2145.00,EUR,BancaIntesa-TRX-9901",
      "2026-03-05,2026-03-05,Bonifico Ristorante Cracco Milano,1820.50,EUR,BancaIntesa-TRX-9902",
      "2026-03-06,2026-03-06,Pagamento canone locazione magazzino,-3500.00,EUR,BancaIntesa-TRX-9903",
    ].join("\n");

    it("imports and parses bank statement CSV with SHA-256 deduplication", async () => {
      const result = await importBankStatement(
        "banca_intesa_statement_test.csv",
        sampleCsv,
        "Banca Intesa Sanpaolo - Conto Ordinario",
        financeActor
      );

      assert.ok(result.statement.id);
      assert.equal(result.statement.filename, "banca_intesa_statement_test.csv");
      assert.equal(result.statement.line_count, 3);
      assert.ok(result.auto_matched_count >= 1);
    });

    it("rejects duplicate bank statement import with the exact same file content", async () => {
      await assert.rejects(
        async () => {
          await importBankStatement(
            "banca_intesa_statement_test_duplicate.csv",
            sampleCsv,
            "Banca Intesa Sanpaolo",
            financeActor
          );
        },
        (err: any) => {
          assert.equal(err.code, "DUPLICATE_STATEMENT_IMPORT");
          return true;
        }
      );
    });

    it("supports manual reconciliation override with audit trail", async () => {
      const statements = await listBankStatements();
      const current = statements.find((s) => s.filename.includes("test")) || statements[0];
      const unmatchedLine = current.lines.find((l) => l.reconciliation_status === "unmatched") || current.lines[0];
      const invoices = await listInvoices();
      const targetInvoice = invoices[0];

      const reconciled = await manualReconcileTransaction(
        unmatchedLine.id,
        targetInvoice.id,
        financeActor,
        "Manually verified against customer remittance advice email"
      );

      assert.equal(reconciled.reconciliation_status, "reconciled");
      assert.equal(reconciled.matched_invoice_id, targetInvoice.id);
    });
  });

  describe("6. Landed Cost Allocation & Real-Time Lot Valuation", () => {
    it("allocates freight, customs, and insurance costs across PO items and updates lot valuations", async () => {
      const allocation = await allocateLandedCost(
        {
          purchase_order_id: "PO-2026-0810",
          cost_type: "freight",
          description: "Refrigerated cross-border transport from Netherlands",
          amount_cents: 35000, // 350.00 EUR
          currency: "EUR",
          allocation_method: "weight",
          items: [
            {
              purchase_order_line_id: "POL-001",
              product_id: "PROD-001",
              sku: "SALM-001",
              lot_id: "LOT-SALM-01",
              nominal_weight_kg: 50.0,
              nominal_volume_m3: 0.15,
              quantity: 5,
              purchase_value_cents: 120000,
            },
            {
              purchase_order_line_id: "POL-002",
              product_id: "PROD-002",
              sku: "BEEF-001",
              lot_id: "LOT-BEEF-01",
              nominal_weight_kg: 90.0,
              nominal_volume_m3: 0.25,
              quantity: 5,
              purchase_value_cents: 180000,
            },
          ],
        },
        financeActor
      );

      assert.ok(allocation.id);
      assert.equal(allocation.purchase_order_id, "PO-2026-0810");
      assert.equal(allocation.cost_type, "freight");
      assert.equal(allocation.amount_cents, 35000);
      assert.equal(allocation.items.length, 2);

      // Total allocated cents must equal original cost amount
      const totalAllocated = allocation.items.reduce((sum, item) => sum + item.allocated_cost_cents, 0);
      assert.equal(totalAllocated, 35000);

      // Verify weight-proportional split: 50kg vs 90kg (ratio 50/140 vs 90/140)
      const item1 = allocation.items[0];
      const item2 = allocation.items[1];
      assert.ok(item2.allocated_cost_cents > item1.allocated_cost_cents);
    });

    it("lists landed cost allocations with item breakdowns", async () => {
      const allocations = await listLandedCostAllocations();
      assert.ok(allocations.length > 0);
      for (const alloc of allocations) {
        assert.ok(alloc.id);
        assert.ok(alloc.items.length > 0);
      }
    });
  });

  describe("7. Delivered Margin Analytics", () => {
    it("computes net revenue, landed lot cost, delivery expense, and gross margin by product", async () => {
      const report = await getDeliveredMarginReport("product");
      assert.ok(report.length > 0);

      for (const row of report) {
        assert.ok(row.dimension_key);
        assert.ok(row.dimension_name);
        assert.ok(row.net_revenue_cents >= 0);
        assert.ok(row.landed_cost_cents >= 0);
        // Margin cents = revenue - landed - delivery
        assert.equal(
          row.gross_margin_cents,
          row.net_revenue_cents - row.landed_cost_cents - row.delivery_cost_cents
        );
      }
    });

    it("computes delivered margins across customer and order dimensions", async () => {
      const customerReport = await getDeliveredMarginReport("customer");
      assert.ok(customerReport.length > 0);

      const orderReport = await getDeliveredMarginReport("order");
      assert.ok(orderReport.length > 0);
    });
  });

  describe("8. REST API Endpoints & RBAC Authorization", () => {
    it("allows finance role to list and fetch invoices", async () => {
      const req = makeReq("/api/v1/finance/invoices", { token: financeToken });
      const res = await getInvoicesRoute(req);
      assert.equal(res.status, 200);

      const body = await res.json();
      assert.ok(Array.isArray(body.invoices));
    });

    it("blocks unauthorized roles from creating invoices", async () => {
      const req = makeReq("/api/v1/finance/invoices", {
        token: driverToken,
        body: { delivery_id: "DEL-2026-0301" },
        idempotencyKey: "test-idem-unauth-01",
      });
      const res = await postInvoicesRoute(req);
      assert.equal(res.status, 403);
    });

    it("supports generating XML via REST route", async () => {
      const invoices = await listInvoices();
      const target = invoices[0];

      const req = makeReq(`/api/v1/finance/sdi/${target.id}/generate-xml`, {
        token: financeToken,
        method: "POST",
        idempotencyKey: "test-idem-xml-01",
      });
      const res = await postGenerateXmlRoute(req, { params: Promise.resolve({ id: target.id }) });
      assert.equal(res.status, 200);

      const body = await res.json();
      assert.ok(body.xml.includes("FatturaElettronica"));
    });

    it("supports transmitting to SDI via REST route", async () => {
      const invoices = await listInvoices();
      const target = invoices[0];

      const req = makeReq(`/api/v1/finance/sdi/${target.id}/transmit`, {
        token: financeToken,
        method: "POST",
        idempotencyKey: "test-idem-sdi-transmit-01",
      });
      const res = await postTransmitSdiRoute(req, { params: Promise.resolve({ id: target.id }) });
      assert.equal(res.status, 200);

      const body = await res.json();
      assert.equal(body.transmission.status, "delivered");
    });

    it("allows querying delivered margin analytics via REST route", async () => {
      const req = makeReq("/api/v1/finance/margins?dimension=product", { token: financeToken });
      const res = await getMarginsRoute(req);
      assert.equal(res.status, 200);

      const body = await res.json();
      assert.ok(Array.isArray(body.report));
      assert.equal(body.dimension, "product");
    });
  });
});
