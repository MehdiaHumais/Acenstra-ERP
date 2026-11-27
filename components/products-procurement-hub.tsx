"use client";

import { useState } from "react";
import {
  Boxes,
  ClipboardCheck,
  Package,
  PackageCheck,
  QrCode,
  Scale,
  ShieldCheck,
  Snowflake,
  Truck,
  Users,
} from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { ViewOnlyBadge } from "@/components/access-gate";
import { BarcodeWorkbench } from "@/components/barcode-workbench";
import { ProcurementWorkbench } from "@/components/procurement-workbench";
import { ProductsTable } from "@/components/products-table";
import { Badge, KpiCard, SectionHeader, Surface } from "@/components/ui";
import { cn, money, percent } from "@/lib/format";
import type { Product, Supplier } from "@/lib/types";

export type ProductsProcurementTab = "products" | "procurement" | "barcode";

export function ProductsProcurementHub({
  products,
  suppliers,
  supplierScorecards,
  rfqs,
  purchaseOrders,
  pipeline,
  defaultTab = "products",
}: {
  products: Product[];
  suppliers: Supplier[];
  supplierScorecards: any[];
  rfqs: any[];
  purchaseOrders: any[];
  pipeline: {
    open_landed_cents: number;
    open_value_cents: number;
    pending_approval: number;
    asn_captured: number;
  };
  defaultTab?: ProductsProcurementTab;
}) {
  const [activeTab, setActiveTab] = useState<ProductsProcurementTab>(defaultTab);

  const active = products.filter((product) => product.status === "active").length;
  const catchWeight = products.filter((product) => product.catch_weight).length;
  const coldChain = products.filter(
    (product) =>
      product.temperature_profile.includes("Chilled") ||
      product.temperature_profile.includes("Frozen"),
  ).length;
  const expiringCertificates = products.reduce(
    (sum, product) => sum + (product.expiring_certificate_count ?? 0),
    0,
  );

  const averageScore = supplierScorecards.length
    ? supplierScorecards.reduce((sum, s) => sum + (s.score ?? 0), 0) / supplierScorecards.length
    : 0;
  const averageOtd = supplierScorecards.length
    ? supplierScorecards.reduce((sum, s) => sum + (s.on_time_rate ?? 0), 0) /
      supplierScorecards.length
    : 0;
  const averageQuality = supplierScorecards.length
    ? supplierScorecards.reduce((sum, s) => sum + (s.quality_score ?? 0), 0) /
      supplierScorecards.length
    : 0;

  return (
    <div className="space-y-5">
      <PageHeading
        eyebrow="Step 01 & 02 · Catalog, Sourcing & Purchase Orders"
        title="Products & Procurement"
        description="Configure products, storage temperatures, shelf-life rules, UOM and catch-weight settings. Manage suppliers and create purchase orders."
        meta="Contract pricing, temperature profiles, supplier scorecards, RFQs, and approved purchase orders in one workspace."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ViewOnlyBadge modifyPermissions={["products:write", "suppliers:write", "procurement:receive", "exports.run"]} />
            <Badge tone="ok" dot>
              {active} active SKUs
            </Badge>
            <Badge tone="info">{supplierScorecards.length} approved suppliers</Badge>
          </div>
        }
      />

      {/* Unified Module Switcher */}
      <div className="flex flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap rounded-xl border border-border bg-card p-1.5 shadow-sm [-webkit-overflow-scrolling:touch] sm:flex-wrap">
        <button
          type="button"
          onClick={() => setActiveTab("products")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all",
            activeTab === "products"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Package className="h-3.5 w-3.5" />
          Product Master<span className="hidden sm:inline"> (SKUs, Temperature, Shelf-Life &amp; Catch-Weight)</span>
          <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px]">
            {products.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("procurement")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all",
            activeTab === "procurement"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Users className="h-3.5 w-3.5" />
          Suppliers<span className="hidden sm:inline">, Scorecards, RFQs &amp; Purchase Orders</span>
          <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px]">
            {purchaseOrders.length} POs
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("barcode")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all",
            activeTab === "barcode"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <QrCode className="h-3.5 w-3.5" />
          Scan & Barcodes
          <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px]">
            Scan · Print
          </span>
        </button>
      </div>

      {activeTab === "barcode" && <BarcodeWorkbench products={products} />}

      {activeTab === "products" && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Active SKUs"
              value={String(active)}
              change="Governed product master"
              trend="up"
              icon={<Boxes className="h-4 w-4" />}
            />
            <KpiCard
              label="Catch-weight SKUs"
              value={String(catchWeight)}
              change="Measured at receipt and pick"
              trend="flat"
              icon={<Scale className="h-4 w-4" />}
            />
            <KpiCard
              label="Cold-chain SKUs"
              value={String(coldChain)}
              change="Chilled or frozen profile"
              trend="flat"
              icon={<Snowflake className="h-4 w-4" />}
            />
            <KpiCard
              label="Certificates expiring"
              value={String(expiringCertificates)}
              change="Within the next 30 days"
              trend={expiringCertificates > 0 ? "down" : "up"}
              tone={expiringCertificates > 0 ? "warning" : "ok"}
              icon={<ShieldCheck className="h-4 w-4" />}
            />
          </div>

          <Surface>
            <SectionHeader
              eyebrow="Product master"
              title="Catalogue"
              description="Click any product to open its full master record: pack conversion, catch-weight rule, allergens and handling, shelf life and temperature, supplier, prices and certificates."
              action={<Badge tone="info">{products.length} records</Badge>}
            />
            <ProductsTable products={products} suppliers={suppliers} />
          </Surface>
        </div>
      )}

      {activeTab === "procurement" && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Supplier score"
              value={`${averageScore.toFixed(0)}/100`}
              change={
                supplierScorecards.length
                  ? `${supplierScorecards.length} approved suppliers scored`
                  : "No suppliers yet"
              }
              trend={averageScore >= 85 ? "up" : "flat"}
              tone={averageScore >= 85 ? "ok" : "warning"}
              icon={<Scale className="h-4 w-4" />}
            />
            <KpiCard
              label="Average on-time delivery"
              value={percent(averageOtd)}
              change={`Quality ${percent(averageQuality, 0)} released`}
              trend={averageOtd >= 95 ? "up" : "down"}
              tone={averageOtd >= 95 ? "ok" : "warning"}
              icon={<Truck className="h-4 w-4" />}
            />
            <KpiCard
              label="Open landed cost"
              value={money(pipeline.open_landed_cents)}
              change={`${money(pipeline.open_value_cents)} goods value in the inbound pipeline`}
              trend="flat"
              icon={<ClipboardCheck className="h-4 w-4" />}
            />
            <KpiCard
              label="Approval / ASN"
              value={`${pipeline.pending_approval} pending`}
              change={`${pipeline.asn_captured} open POs with supplier ASN`}
              trend="flat"
              tone={pipeline.pending_approval > 0 ? "warning" : "ok"}
              icon={<PackageCheck className="h-4 w-4" />}
            />
          </div>

          <ProcurementWorkbench
            suppliers={supplierScorecards}
            products={products}
            rfqs={rfqs}
            purchaseOrders={purchaseOrders}
          />
        </div>
      )}
    </div>
  );
}
