import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "Ascentra Food Distribution ERP API",
      version: "1.0.0",
      description:
        "Production REST API for Ascentra Global Ltd AI-Powered Food Distribution ERP: FEFO cold-chain inventory, procurement & ASN, B2B/store orders with credit controls, directed warehouse tasks & GS1 barcode verification, refrigerated route POD, batch traceability & recall containment, Italy SdI FatturaPA e-invoicing, and governed AI insights."
    },
    servers: [{ url: "/api/v1", description: "Versioned REST API v1" }],
    paths: {
      "/health": {
        get: { summary: "Public system & database health probe", tags: ["Infrastructure"] },
        post: {
          summary:
            "Admin-only dataset lifecycle: clear_all_data or restore_demo_data (requires settings.manage)",
          tags: ["Infrastructure"]
        }
      },
      "/auth": {
        get: { summary: "Get active user session, RBAC permissions, and demo role accounts", tags: ["Security"] },
        post: { summary: "Authenticate, sign out, reset password, or switch active RBAC role", tags: ["Security"] }
      },
      "/dashboard/overview": {
        get: { summary: "Get executive operational KPIs, alerts, FEFO risk, cold-chain telemetry, and revenue", tags: ["Dashboard"] },
        post: { summary: "Mark operational alerts as read", tags: ["Dashboard"] }
      },
      "/products": {
        get: { summary: "List master product catalog with aggregate available FEFO stock", tags: ["Master Data"] },
        post: { summary: "Create a new product SKU with temperature zone and VAT configuration", tags: ["Master Data"] }
      },
      "/suppliers": {
        get: { summary: "List approved suppliers and optional inbound purchase orders", tags: ["Procurement"] },
        post: { summary: "Issue an RFQ/Purchase Order or receive an inbound PO into FEFO inventory lots", tags: ["Procurement"] }
      },
      "/inventory/lots": {
        get: { summary: "List all inventory lots dynamically ranked by FEFO (First-Expired, First-Out)", tags: ["Inventory & Cold Chain"] },
        post: { summary: "Post a physical cycle count and reconcile lot stock variance", tags: ["Inventory & Cold Chain"] }
      },
      "/temperature/readings": {
        get: { summary: "List cold-chain HACCP temperature zone telemetry", tags: ["Inventory & Cold Chain"] },
        post: { summary: "Ingest IoT temperature probe reading and trigger excursion alerts", tags: ["Inventory & Cold Chain"] }
      },
      "/warehouse/tasks": {
        get: { summary: "List directed warehouse tasks (pick, pack, putaway, cycle_count, transfer)", tags: ["Warehouse"] },
        patch: { summary: "Start, complete, assign, or block/unblock a warehouse task", tags: ["Warehouse"] },
        post: { summary: "Verify a GS1-128 barcode scan against FEFO task assignment or sync offline queued events", tags: ["Warehouse"] }
      },
      "/orders": {
        get: { summary: "List B2B and store sales orders (scoped by role/branch)", tags: ["Sales Orders"] },
        post: { summary: "Create a sales order with automatic FEFO lot reservation and credit limit check", tags: ["Sales Orders"] },
        patch: { summary: "Release credit hold (maker-checker), advance order status, or cancel order", tags: ["Sales Orders"] }
      },
      "/customer-portal/catalog": {
        get: { summary: "Customer-specific product catalog with resolved contract prices, promo rates, and live FEFO stock availability", tags: ["Customer Order & B2B Portal"] }
      },
      "/customer-portal/pricing": {
        get: { summary: "Resolve price snapshot applying contract precedence (Promo > Tier > Base > Segment > Standard)", tags: ["Customer Order & B2B Portal"] },
        post: { summary: "Evaluate pricing for line quantities with volume discounts", tags: ["Customer Order & B2B Portal"] }
      },
      "/customer-portal/validate": {
        post: { summary: "Pre-flight validation of customer order lines against credit limits, stock availability, and shelf life", tags: ["Customer Order & B2B Portal"] }
      },
      "/customer-portal/orders": {
        get: { summary: "List customer orders with status, delivery tracking, and invoice status", tags: ["Customer Order & B2B Portal"] },
        post: { summary: "Submit customer order with atomic FEFO reservation creation and credit validation", tags: ["Customer Order & B2B Portal"] }
      },
      "/customer-portal/orders/{id}": {
        get: { summary: "Retrieve complete order confirmation document, line pricing snapshots, and allocated lot genealogy", tags: ["Customer Order & B2B Portal"] }
      },
      "/customer-portal/orders/{id}/cancel": {
        post: { summary: "Cancel customer order and atomically release linked stock reservations", tags: ["Customer Order & B2B Portal"] }
      },
      "/customer-portal/orders/{id}/approve": {
        post: { summary: "Maker-checker approval for orders on credit hold with audit justification", tags: ["Customer Order & B2B Portal"] }
      },
      "/customer-portal/contracts": {
        get: { summary: "List customer supply contracts, pricing tiers, and promotional dates", tags: ["Customer Order & B2B Portal"] },
        post: { summary: "Create or update customer contract and pricing items (authorized staff only)", tags: ["Customer Order & B2B Portal"] }
      },
      "/customer-portal/customers": {
        get: { summary: "List available customer accounts with credit profiles for staff order entry", tags: ["Customer Order & B2B Portal"] }
      },
      "/deliveries": {
        get: { summary: "List refrigerated delivery routes and stops", tags: ["Deliveries & Fleet"] },
        patch: { summary: "Start loading, dispatch route, capture digital POD, or log/resolve delivery exceptions", tags: ["Deliveries & Fleet"] }
      },
      "/traceability/batches/{id}": {
        get: { summary: "Query 1-up / 1-down batch genealogy and mass-balance reconciliation", tags: ["Traceability"] },
        post: { summary: "Quarantine a batch lot or send a recall containment notice to downstream customers", tags: ["Traceability"] }
      },
      "/finance/summary": {
        get: { summary: "Get invoice ledger, AR ageing buckets, AP exposure, and SdI transmission summary", tags: ["Finance & SdI"] },
        post: { summary: "Transmit invoice to Italy SdI (FatturaPA sandbox) or record customer SEPA payment", tags: ["Finance & SdI"] }
      },
      "/stores/summary": {
        get: { summary: "Get retail store & hospitality branch ordering and waste summary", tags: ["Stores"] },
        patch: { summary: "Update store operational status (active, watch, paused)", tags: ["Stores"] }
      },
      "/ai/insights": {
        get: { summary: "List governed AI demand, FEFO markdown, and replenishment recommendations", tags: ["Governed AI"] },
        post: { summary: "Approve or reject an AI recommendation with maker-checker audit logging", tags: ["Governed AI"] }
      },
      "/audit": {
        get: { summary: "List immutable, PII-redacted security and operational audit trail events", tags: ["Security"] }
      },
      "/inbound/shipments": {
        get: { summary: "List expected and arriving supplier shipments with transport and dock status", tags: ["Inbound Receiving"] },
        post: { summary: "Register an expected inbound shipment with supplier, ASN, vehicle and line items", tags: ["Inbound Receiving"] }
      },
      "/inbound/shipments/{id}": {
        get: { summary: "Get inbound shipment detail, line quantities, documents and receiving history", tags: ["Inbound Receiving"] }
      },
      "/inbound/shipments/{id}/arrival": {
        post: { summary: "Confirm dock arrival, seal number, vehicle condition and arrival temperature", tags: ["Inbound Receiving"] }
      },
      "/inbound/shipments/{id}/temperature-logs": {
        post: { summary: "Record transport or probe temperature readings and raise cold-chain excursions", tags: ["Inbound Receiving"] }
      },
      "/inbound/shipments/{id}/receiving": {
        post: { summary: "Record received quantities, catch-weights, supplier batches and manufacture/expiry dates", tags: ["Inbound Receiving"] }
      },
      "/inbound/shipments/{id}/documents": {
        get: { summary: "List COA, HACCP and delivery documents attached to a shipment", tags: ["Inbound Receiving"] },
        post: { summary: "Attach a supplier document and capture its verification metadata", tags: ["Inbound Receiving"] }
      },
      "/inbound/shipments/{id}/quality-checks": {
        post: { summary: "Record inbound quality checks and certificate verification evidence", tags: ["Inbound Receiving"] }
      },
      "/inbound/shipments/{id}/accept": {
        post: { summary: "Accept received goods and post released lots into FEFO inventory", tags: ["Inbound Receiving"] }
      },
      "/inbound/shipments/{id}/quarantine": {
        post: { summary: "Quarantine a shipment or selected lines pending investigation", tags: ["Inbound Receiving"] }
      },
      "/inbound/shipments/{id}/reject": {
        post: { summary: "Reject a shipment or selected lines and record the supplier discrepancy", tags: ["Inbound Receiving"] }
      },
      "/quality/dashboard": {
        get: { summary: "Get receiving inspection KPIs, open exceptions and CAPA workload", tags: ["Quality Gate"] }
      },
      "/quality/inspections": {
        get: { summary: "List receiving inspections by lot, supplier, PO or warehouse", tags: ["Quality Gate"] },
        post: { summary: "Create a receiving inspection with HACCP checkpoints and sample evidence", tags: ["Quality Gate"] }
      },
      "/quality/inspections/{id}/haccp": {
        post: { summary: "Record HACCP checkpoint readings and evaluate limits", tags: ["Quality Gate"] }
      },
      "/quality/inspections/{id}/decision": {
        post: { summary: "Release, hold, quarantine or reject inspected goods with QA justification", tags: ["Quality Gate"] }
      },
      "/quality/exceptions": {
        get: { summary: "List quality exceptions linked to inspections and lots", tags: ["Quality Gate"] },
        post: { summary: "Raise a quality exception requiring investigation", tags: ["Quality Gate"] }
      },
      "/quality/capas": {
        get: { summary: "List corrective and preventive actions with verification status", tags: ["Quality Gate"] },
        post: { summary: "Create a CAPA with root cause, corrective and preventive actions", tags: ["Quality Gate"] }
      },
      "/quality/haccp-templates": {
        get: { summary: "List configurable HACCP checkpoint templates", tags: ["Quality Gate"] },
        post: { summary: "Create a HACCP checkpoint template with min/max limits", tags: ["Quality Gate"] }
      },
      "/putaway/dashboard": {
        get: { summary: "Get put-away workload, bin occupancy and placement recommendations", tags: ["Put-away"] }
      },
      "/putaway/tasks": {
        get: { summary: "List put-away tasks generated from quality-released lots", tags: ["Put-away"] },
        post: { summary: "Create a manual put-away task for a released lot", tags: ["Put-away"] }
      },
      "/putaway/tasks/{id}/override": {
        post: { summary: "Override the recommended bin with a mandatory audit reason", tags: ["Put-away"] }
      },
      "/putaway/tasks/{id}/scan": {
        post: { summary: "Verify task, SKU, lot and bin barcode/QR scans", tags: ["Put-away"] }
      },
      "/putaway/tasks/{id}/confirm": {
        post: { summary: "Confirm partial or split bin placement and post stock to the bin ledger", tags: ["Put-away"] }
      },
      "/putaway/bins": {
        get: { summary: "List warehouse bins with zone, temperature, capacity and occupancy", tags: ["Put-away"] }
      },
      "/inventory/dashboard": {
        get: { summary: "Get multi-level stock visibility, status reconciliation and shelf-life KPIs", tags: ["Stock Intelligence"] }
      },
      "/inventory/fefo": {
        post: { summary: "Allocate FEFO stock for a customer, delivery date and requested cases", tags: ["Stock Intelligence"] }
      },
      "/inventory/reservations": {
        get: { summary: "List stock reservations by order, SKU, lot or status", tags: ["Stock Intelligence"] },
        post: { summary: "Create a concurrency-protected stock reservation with TTL", tags: ["Stock Intelligence"] }
      },
      "/inventory/shelf-life": {
        get: { summary: "Evaluate minimum remaining shelf-life rules for a delivery date", tags: ["Stock Intelligence"] },
        post: { summary: "Create a product- or customer-specific shelf-life rule", tags: ["Stock Intelligence"] }
      },
      "/inventory/cycle-counts": {
        get: { summary: "List blind cycle counts and their reconciliation status", tags: ["Stock Intelligence"] },
        post: { summary: "Start a blind cycle count for a lot or bin", tags: ["Stock Intelligence"] }
      },
      "/inventory/adjustments": {
        get: { summary: "List maker-checker stock adjustments and approval status", tags: ["Stock Intelligence"] },
        post: { summary: "Request a stock adjustment with reason code and evidence", tags: ["Stock Intelligence"] }
      },
      "/inventory/movements": {
        get: { summary: "List the immutable stock movement ledger", tags: ["Stock Intelligence"] }
      },
      "/procurement/purchase-orders": {
        get: { summary: "List purchase orders and approval state", tags: ["Procurement"] },
        post: { summary: "Create a purchase order with supplier, lines and delivery terms", tags: ["Procurement"] }
      },
      "/procurement/purchase-orders/{po}/approve": {
        post: { summary: "Approve a purchase order under maker-checker controls", tags: ["Procurement"] }
      },
      "/procurement/purchase-orders/{po}/asn": {
        post: { summary: "Record the supplier advance shipping notice for a purchase order", tags: ["Procurement"] }
      },
      "/procurement/rfqs": {
        get: { summary: "List requests for quotation and their pipeline", tags: ["Procurement"] },
        post: { summary: "Create an RFQ for supplier quotations", tags: ["Procurement"] }
      },
      "/procurement/rfqs/{id}/quotations": {
        get: { summary: "List supplier quotations for an RFQ", tags: ["Procurement"] },
        post: { summary: "Record a supplier quotation with price and lead time", tags: ["Procurement"] }
      },
      "/procurement/scorecards": {
        get: { summary: "List supplier quality, delivery and cost scorecards", tags: ["Procurement"] }
      },
      "/admin/users": {
        get: { summary: "List platform users with role, warehouse and store scope", tags: ["Administration"] },
        post: { summary: "Create a platform user", tags: ["Administration"] }
      },
      "/admin/roles": {
        get: { summary: "List RBAC roles and their permission matrix", tags: ["Administration"] }
      },
      "/admin/permissions": {
        get: { summary: "List all available permissions", tags: ["Administration"] }
      },
      "/picking/waves": {
        get: { summary: "List pick waves or eligible orders ready for wave grouping", tags: ["Picking & Packing"] },
        post: { summary: "Generate a new pick wave with FEFO batch allocations and route optimization", tags: ["Picking & Packing"] }
      },
      "/picking/waves/{id}": {
        get: { summary: "Get pick wave details, assigned orders, and sequential pick tasks", tags: ["Picking & Packing"] },
        patch: { summary: "Assign a pick wave to a warehouse operator", tags: ["Picking & Packing"] },
        delete: { summary: "Cancel a pick wave and release reserved stock", tags: ["Picking & Packing"] }
      },
      "/picking/tasks": {
        get: { summary: "List pick tasks filtered by wave, order, status or picker", tags: ["Picking & Packing"] }
      },
      "/picking/tasks/{id}/scan": {
        post: { summary: "Verify barcode scans for bin, product, and FEFO batch", tags: ["Picking & Packing"] }
      },
      "/picking/tasks/{id}/catch-weight": {
        post: { summary: "Confirm actual scale weight and enforce configured tolerances", tags: ["Picking & Packing"] }
      },
      "/picking/tasks/{id}/complete": {
        post: { summary: "Complete a pick task and advance wave progress", tags: ["Picking & Packing"] }
      },
      "/picking/packing": {
        get: { summary: "Get packing record by order or SSCC barcode", tags: ["Picking & Packing"] },
        post: { summary: "Verify packing checklist (temp, segregation, condition) and create package", tags: ["Picking & Packing"] }
      },
      "/picking/labels": {
        get: { summary: "Generate shipping labels and GS1 SSCC-18 pallet barcode labels", tags: ["Picking & Packing"] }
      },
      "/picking/staging": {
        get: { summary: "Get dispatch staging lanes status, occupancy, and staged packages", tags: ["Picking & Packing"] },
        post: { summary: "Verify staging lane barcode scan and execute physical inventory consumption", tags: ["Picking & Packing"] }
      }
    }
  });
}
