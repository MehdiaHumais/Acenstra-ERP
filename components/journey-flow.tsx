import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { JourneyStep } from "@/lib/types";

export const CORE_SYSTEM_MODULES = [
  {
    step: 1,
    title: "Products & Procurement",
    description:
      "Configure products, storage temperatures, shelf-life rules, UOM and catch-weight settings. Manage suppliers and create purchase orders.",
    owner: "Catalog & Sourcing",
    href: "/products",
  },
  {
    step: 2,
    title: "Inbound & Quality Gate",
    description:
      "Record arriving shipments, verify quantities, temperature, expiry, certificates and HACCP checks. QA releases accepted quantities and holds or quarantines unsafe goods.",
    owner: "Receiving & QA",
    href: "/inbound",
  },
  {
    step: 3,
    title: "Warehouse & Inventory",
    description:
      "Put approved goods into suitable warehouse bins. Track batches, expiry dates, locations and stock availability using FEFO.",
    owner: "WMS & FEFO",
    href: "/inventory",
  },
  {
    step: 4,
    title: "Customer Orders",
    description:
      "Restaurants order through the B2B portal, or sales staff create orders internally. The system checks pricing, credit limits, stock and shelf-life requirements before confirmation.",
    owner: "B2B & Sales",
    href: "/orders",
  },
  {
    step: 5,
    title: "Picking & Packing",
    description:
      "Warehouse staff pick eligible stock using FEFO, verify batches and quantities, record catch weights, pack orders and prepare them for dispatch.",
    owner: "Fulfilment",
    href: "/warehouse",
  },
  {
    step: 6,
    title: "Loading & Delivery",
    description:
      "Drivers load verified packages, record vehicle temperatures, deliver orders and collect Proof of Delivery (POD), including signatures and delivery exceptions.",
    owner: "Fleet & POD",
    href: "/deliveries",
  },
  {
    step: 7,
    title: "Finance & SdI",
    description:
      "Generate invoices from delivered quantities, prepare FatturaPA XML for Italy's SdI integration, record payments, reconcile bank transactions and calculate margins using actual costs.",
    owner: "Finance & SdI",
    href: "/finance",
  },
  {
    step: 8,
    title: "Traceability & Recall",
    description:
      "Trace products from suppliers and batches to warehouse locations and customers. Quarantine affected stock and manage recalls, recovery and corrective actions.",
    owner: "Food Safety",
    href: "/traceability",
  },
  {
    step: 9,
    title: "Store Monitoring",
    description:
      "Partner fast-food stores view their purchases, deliveries, order history, spending and product analytics. Consumption is estimated unless actual POS or inventory data is integrated.",
    owner: "Store Portal",
    href: "/stores",
  },
  {
    step: 10,
    title: "Executive & AI",
    description:
      "Management views business performance, financial metrics, inventory alerts, forecasts and AI recommendations. Consequential actions require authorized approval.",
    owner: "Management & AI",
    href: "/management",
  },
];

export function JourneyFlow({ steps: _steps }: { steps?: JourneyStep[] }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {CORE_SYSTEM_MODULES.map((step) => (
        <li key={step.step}>
          <Link
            href={step.href}
            className="group relative block h-full rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-muted/30"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-[11px] font-bold text-primary">
                {String(step.step).padStart(2, "0")}
              </span>
              <div className="flex items-center gap-1.5">
                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {step.owner}
                </span>
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
              </div>
            </div>
            <p className="mt-2.5 text-sm font-semibold group-hover:text-primary">{step.title}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.description}</p>
          </Link>
        </li>
      ))}
    </ol>
  );
}
