"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  PackageCheck,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { InboundWorkbench } from "@/components/inbound-workbench";
import { PageHeading } from "@/components/page-heading";
import { ViewOnlyBadge } from "@/components/access-gate";
import { QualityGateWorkbench } from "@/components/quality-gate-workbench";
import { Badge, KpiCard } from "@/components/ui";
import { cn } from "@/lib/format";
import type { Product, PurchaseOrder, Supplier } from "@/lib/types";

export type InboundHubTab = "inbound" | "quality";

export function InboundQualityHub({
  initialShipments,
  suppliers,
  products,
  purchaseOrders,
  defaultTab = "inbound",
}: {
  initialShipments: any[];
  suppliers: Supplier[];
  products: Product[];
  purchaseOrders: any[];
  defaultTab?: InboundHubTab;
}) {
  const [activeTab, setActiveTab] = useState<InboundHubTab>(defaultTab);

  const active = initialShipments.filter(
    (s: any) => !["accepted", "completed", "rejected", "cancelled"].includes(s.status),
  ).length;
  const accepted = initialShipments.filter(
    (s: any) => s.status === "accepted" || s.status === "completed",
  ).length;
  const exceptions = initialShipments.filter((s: any) =>
    ["quarantined", "partially_accepted", "rejected"].includes(s.status),
  ).length;

  return (
    <div className="space-y-5">
      <PageHeading
        eyebrow="Step 03 & 04 · Receiving, Temperature & HACCP Inspection"
        title="Inbound & Quality Gate"
        description="Record arriving shipments, verify quantities, temperature, expiry, certificates and HACCP checks. QA releases accepted quantities and holds or quarantines unsafe goods."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ViewOnlyBadge modifyPermissions={["inbound.manage", "inbound.decision", "quality.inspect", "quality.decide"]} />
            <Badge tone={exceptions > 0 ? "warning" : "ok"} dot>
              {exceptions} active holds / exceptions
            </Badge>
            <Badge tone="info">{initialShipments.length} shipments</Badge>
          </div>
        }
      />

      {/* Unified Module Switcher */}
      <div className="flex flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap rounded-xl border border-border bg-card p-1.5 shadow-sm [-webkit-overflow-scrolling:touch] sm:flex-wrap">
        <button
          type="button"
          onClick={() => setActiveTab("inbound")}
          className={cn(
            "flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all",
            activeTab === "inbound"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Truck className="h-3.5 w-3.5" />
          Inbound Shipments<span className="hidden sm:inline"> & Goods Receiving</span>
          <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px]">
            {initialShipments.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("quality")}
          className={cn(
            "flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all",
            activeTab === "quality"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Quality Gate<span className="hidden sm:inline">, HACCP Checkpoints & CAPA</span>
        </button>
      </div>

      {activeTab === "inbound" && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Registered shipments"
              value={String(initialShipments.length)}
              change="Total inbound manifest"
              trend="flat"
              icon={<Truck className="h-4 w-4" />}
            />
            <KpiCard
              label="In transit / inspection"
              value={String(active)}
              change="Active dock & transit queue"
              trend="flat"
              icon={<PackageCheck className="h-4 w-4" />}
            />
            <KpiCard
              label="Accepted & released"
              value={String(accepted)}
              change="Posted to FEFO inventory"
              trend="up"
              tone="ok"
              icon={<CheckCircle2 className="h-4 w-4" />}
            />
            <KpiCard
              label="Exceptions & holds"
              value={String(exceptions)}
              change="Partial, quarantined, or rejected"
              trend={exceptions ? "down" : "up"}
              tone={exceptions ? "warning" : "ok"}
              icon={<AlertTriangle className="h-4 w-4" />}
            />
          </div>
          <InboundWorkbench
            initialShipments={initialShipments as any}
            suppliers={suppliers}
            products={products}
            purchaseOrders={purchaseOrders}
          />
        </div>
      )}

      {activeTab === "quality" && <QualityGateWorkbench />}
    </div>
  );
}
