import type {
  DashboardOverview,
  Delivery,
  FinanceSummary,
  Insight,
  Lot,
  Product,
  SalesOrder,
  StoreSummary,
  Supplier,
  TemperatureReading,
  WarehouseTask,
} from "./types";

export const emptyProducts: Product[] = [];

export const emptySuppliers: Supplier[] = [];

export const emptyLots: Lot[] = [];

export const emptyTasks: WarehouseTask[] = [];

export const emptyOrders: SalesOrder[] = [];

export const emptyDeliveries: Delivery[] = [];

export const emptyInsights: Insight[] = [];

export const emptyTemperature: TemperatureReading[] = [];

export const emptyFinance: FinanceSummary = {
  invoices: [],
  revenue_cents: 0,
  collected_cents: 0,
  overdue_cents: 0,
  ap_cents: 0,
  gross_margin_pct: 0,
  sdi_pending: 0,
  ageing: [],
};

export const emptyStoreSummary: StoreSummary = {
  stores: [],
  total_spend_cents: 0,
  total_orders: 0,
  average_waste_pct: 0,
};

export const emptyOverview: DashboardOverview = {
  kpis: [],
  alerts: [],
  temperature: [],
  expiring: [],
  tasks: [],
  insights: [],
  journey: [
    {
      step: 1,
      title: "Product master",
      description:
        "Create product, SKU, pack/UOM conversion, catch-weight rules, allergens/handling attributes, shelf-life and temperature profile, suppliers, prices and certificates.",
      owner: "Commercial",
    },
    {
      step: 2,
      title: "Supplier sourcing",
      description:
        "Use supplier scorecards, RFQ and quotation comparison; raise approved purchase order, calculate expected landed cost and capture supplier ASN if provided.",
      owner: "Procurement",
    },
    {
      step: 3,
      title: "Inbound transport",
      description:
        "Track expected arrival and transport conditions; verify goods, quantities, supplier batch, manufacture/expiry dates, weight, quality certificates and temperatures.",
      owner: "Inbound",
    },
    {
      step: 4,
      title: "Quality gate",
      description:
        "Record receiving inspection, HACCP checkpoints, hold/release decision, excursion evidence and CAPA where an exception arises. Rejected stock remains unavailable.",
      owner: "Quality",
    },
    {
      step: 5,
      title: "Put-away",
      description:
        "Generate storage location/zone recommendation and scan goods into the designated bin; retain batch, quantity, weight and temperature status.",
      owner: "Warehouse",
    },
    {
      step: 6,
      title: "Stock intelligence",
      description:
        "Maintain stock by warehouse, zone, location, lot and status. Apply FEFO, minimum remaining shelf life, reservations, cycle counting and reconciled adjustments.",
      owner: "Inventory",
    },
    {
      step: 7,
      title: "Customer order",
      description:
        "Restaurant customer orders through B2B portal/PWA or staff entry. Apply contract pricing, credit limit, availability, batch/shelf-life eligibility and confirmation.",
      owner: "Sales",
    },
    {
      step: 8,
      title: "Picking and packing",
      description:
        "Create pick waves/tasks, FEFO batch allocation, barcode verification, catch-weight confirmation, packing checks, labels and staging assignment.",
      owner: "Warehouse",
    },
    {
      step: 9,
      title: "Loading and delivery",
      description:
        "Assign vehicle/driver and route, complete vehicle/load checks, record temperature checks, offline mobile actions, delivery exceptions and proof of delivery.",
      owner: "Transport",
    },
    {
      step: 10,
      title: "Finance",
      description:
        "Generate invoice data and Italy-specific e-invoicing handoff, reconcile payments and bank statements subject to integration, calculate landed and delivered margin.",
      owner: "Finance",
    },
    {
      step: 11,
      title: "Exceptions and recall",
      description:
        "Trace affected batches supplier-to-customer and customer-to-supplier, run mass-balance reconciliation, quarantine stock and coordinate a recall workflow.",
      owner: "Compliance",
    },
    {
      step: 12,
      title: "Management and AI",
      description:
        "Provide CEO KPIs, governed BI, forecasting, anomaly alerts, replenishment suggestions and auditable AI actions requiring approval when consequential.",
      owner: "Executive AI",
    },
  ],
  revenue_by_week: [],
};
