"use client";

import { useState } from "react";
import {
  BadgeCheck,
  MapPinned,
  Route,
  ThermometerSnowflake,
  Truck,
} from "lucide-react";
import { DeliveryBoard } from "@/components/delivery-board";
import { LoadingDeliveryWorkbench } from "@/components/loading-delivery-workbench";
import { PageHeading } from "@/components/page-heading";
import { ViewOnlyBadge } from "@/components/access-gate";
import { Badge, KpiCard, SectionHeader, Surface, statusTone } from "@/components/ui";
import { cn, titleCase } from "@/lib/format";
import type { Delivery } from "@/lib/types";

export type DeliveriesHubTab = "workbench" | "routes";

function groupRoutes(deliveries: Delivery[]) {
  const groups = new Map<string, Delivery[]>();
  for (const delivery of deliveries) {
    const key = delivery.route || "Unassigned";
    groups.set(key, [...(groups.get(key) ?? []), delivery]);
  }
  return Array.from(groups.entries()).map(([code, loads]) => ({
    code,
    loads,
    drivers: Array.from(new Set(loads.map((load) => load.driver).filter(Boolean))),
    vehicles: Array.from(new Set(loads.map((load) => load.vehicle).filter(Boolean))),
  }));
}

export function DeliveriesFleetHub({
  deliveries,
  defaultTab = "workbench",
}: {
  deliveries: Delivery[];
  defaultTab?: DeliveriesHubTab;
}) {
  const [activeTab, setActiveTab] = useState<DeliveriesHubTab>(defaultTab);

  const delivered = deliveries.filter((delivery) => delivery.status === "delivered").length;
  const exceptions = deliveries.filter((delivery) => delivery.exception).length;
  const podsSigned = deliveries.filter((delivery) => delivery.pod_signed).length;
  const routes = groupRoutes(deliveries);

  return (
    <div className="space-y-5">
      <PageHeading
        eyebrow="Step 09 · Fleet Routes, Cold Chain & Driver Mobile App"
        title="Loading & Delivery"
        description="Drivers load verified packages, record vehicle temperatures, deliver orders and collect Proof of Delivery (POD), including signatures and delivery exceptions."
        meta="Mobile-first driver PWA · Idempotent offline sync · Cold-chain temperature enforcement"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ViewOnlyBadge modifyPermissions={["deliveries:update"]} />
            <Badge tone={exceptions > 0 ? "warning" : "ok"} dot>
              {exceptions} delivery exceptions
            </Badge>
            <Badge tone="info">{deliveries.length} loads</Badge>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Deliveries today"
          value={String(deliveries.length)}
          change={`${delivered} completed`}
          trend="up"
          icon={<Route className="h-4 w-4" />}
        />
        <KpiCard
          label="POD captured"
          value={`${podsSigned}/${deliveries.length}`}
          change="Signature or consent evidence"
          trend="flat"
          icon={<BadgeCheck className="h-4 w-4" />}
        />
        <KpiCard
          label="Active routes"
          value={String(routes.length)}
          change={routes.length ? "Grouped from planned loads" : "No routes planned"}
          trend="flat"
          icon={<MapPinned className="h-4 w-4" />}
        />
        <KpiCard
          label="Cold-chain exceptions"
          value={String(exceptions)}
          change="Load and delivery temperature evidence"
          trend="flat"
          tone={exceptions ? "critical" : "ok"}
          icon={<ThermometerSnowflake className="h-4 w-4" />}
        />
      </div>

      {/* Unified Switcher */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-1.5 shadow-sm">
        <button
          type="button"
          onClick={() => setActiveTab("workbench")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all",
            activeTab === "workbench"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Truck className="h-3.5 w-3.5" />
          Loading, Driver Dispatch & POD Workbench
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("routes")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all",
            activeTab === "routes"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Route className="h-3.5 w-3.5" />
          Route Board & Load Readiness
          <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px]">
            {routes.length}
          </span>
        </button>
      </div>

      {activeTab === "workbench" && <LoadingDeliveryWorkbench />}

      {activeTab === "routes" && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-3">
            <Surface className="xl:col-span-2">
              <SectionHeader
                eyebrow="Delivery board"
                title="Loads and proof of delivery"
                description="Delivery exceptions trigger returns, refusal handling and credit-note triggers where appropriate."
                action={<Badge tone="info">{deliveries.length} loads</Badge>}
              />
              <DeliveryBoard deliveries={deliveries} />
            </Surface>

            <Surface>
              <SectionHeader
                eyebrow="Route plan"
                title="Load readiness"
                description="Vehicle inspection and load reconciliation must be complete before departure."
              />
              <div className="space-y-4 p-5">
                {routes.length === 0 && (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    No routes planned. Assign deliveries to build the load plan.
                  </p>
                )}
                {routes.map((route) => (
                  <div key={route.code} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold">{route.code}</p>
                      <Badge tone={statusTone(route.loads[0].status)} dot>
                        {titleCase(route.loads[0].status)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {route.loads.length} loads · {route.drivers.join(", ") || "Unassigned"} ·{" "}
                      {route.vehicles.join(", ") || "Vehicle TBC"}
                    </p>
                    <p className="mt-1.5 text-[10px] text-muted-foreground">
                      Temperature range:{" "}
                      {Math.min(...route.loads.map((load) => load.temperature_c)).toFixed(1)}°C to{" "}
                      {Math.max(...route.loads.map((load) => load.temperature_c)).toFixed(1)}°C
                    </p>
                  </div>
                ))}
              </div>
            </Surface>
          </div>
        </div>
      )}
    </div>
  );
}
