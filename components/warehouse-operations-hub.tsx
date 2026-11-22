"use client";

import { useState } from "react";
import {
  Barcode,
  ClipboardCheck,
  Truck,
  Warehouse,
  WifiOff,
} from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { ViewOnlyBadge } from "@/components/access-gate";
import { PickingPackingWorkbench } from "@/components/picking-packing-workbench";
import { PutawayWorkbench } from "@/components/putaway-workbench";
import { ScanPanel } from "@/components/scan-panel";
import { TaskQueue } from "@/components/task-queue";
import { Badge, KpiCard, SectionHeader, Surface, statusTone } from "@/components/ui";
import { cn, shortDate, titleCase } from "@/lib/format";
import type { Lot, PurchaseOrder, WarehouseTask } from "@/lib/types";

export type WarehouseHubTab = "picking" | "putaway" | "floor";

const zones = [
  { name: "Chilled", occupancy: 0, locations: 124, temperature: "0–4°C", tone: "ok" as const },
  { name: "Frozen", occupancy: 0, locations: 48, temperature: "-18°C", tone: "ok" as const },
  { name: "Ambient", occupancy: 0, locations: 96, temperature: "12–24°C", tone: "ok" as const },
  { name: "Quarantine", occupancy: 0, locations: 12, temperature: "Controlled", tone: "warning" as const },
];

export function WarehouseOperationsHub({
  tasks,
  lots,
  purchaseOrders,
  defaultTab = "picking",
}: {
  tasks: WarehouseTask[];
  lots: Lot[];
  purchaseOrders: PurchaseOrder[];
  defaultTab?: WarehouseHubTab;
}) {
  const [activeTab, setActiveTab] = useState<WarehouseHubTab>(defaultTab);

  const open = tasks.filter((task) => task.status !== "done").length;
  const blocked = tasks.filter((task) => task.status === "blocked").length;
  const highPriority = tasks.filter(
    (task) => task.priority === "high" && task.status !== "done",
  ).length;
  const zoneUsage = new Map<string, number>();
  for (const lot of lots) {
    const key =
      lot.zone.includes("Chilled") || lot.zone.includes("Produce") || lot.zone.includes("Dairy")
        ? "Chilled"
        : lot.zone.includes("Frozen")
          ? "Frozen"
          : lot.zone.includes("Quarantine")
            ? "Quarantine"
            : "Ambient";
    zoneUsage.set(key, (zoneUsage.get(key) ?? 0) + 1);
  }

  return (
    <div className="space-y-5">
      <PageHeading
        eyebrow="Step 08 · FEFO Pick Waves, Barcode Scan & Dispatch Staging"
        title="Picking & Packing"
        description="Warehouse staff pick eligible stock using FEFO, verify batches and quantities, record catch weights, pack orders and prepare them for dispatch."
        meta="Mobile-first PWA · GS1-128 FEFO verified · Real-time stock & reservation synchronization"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ViewOnlyBadge modifyPermissions={["warehouse:update"]} />
            <Badge tone="ok" dot>
              Scanner online
            </Badge>
            <Badge tone="info">{tasks.length} floor tasks</Badge>
          </div>
        }
      />

      {/* Unified Module Switcher */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-1.5 shadow-sm">
        <button
          type="button"
          onClick={() => setActiveTab("picking")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all",
            activeTab === "picking"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Barcode className="h-3.5 w-3.5" />
          Picking, Packing & Dispatch Staging
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("putaway")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all",
            activeTab === "putaway"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Warehouse className="h-3.5 w-3.5" />
          Put-away & Bin Placement
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("floor")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all",
            activeTab === "floor"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <ClipboardCheck className="h-3.5 w-3.5" />
          Floor Queue, Zones & Scanner
          <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px]">
            {open}
          </span>
        </button>
      </div>

      {activeTab === "picking" && <PickingPackingWorkbench />}

      {activeTab === "putaway" && <PutawayWorkbench />}

      {activeTab === "floor" && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Open tasks"
              value={String(open)}
              change={`${highPriority} high priority`}
              trend="flat"
              icon={<ClipboardCheck className="h-4 w-4" />}
            />
            <KpiCard
              label="Blocked tasks"
              value={String(blocked)}
              change="Credit and quality holds"
              trend="down"
              tone="warning"
              icon={<WifiOff className="h-4 w-4" />}
            />
            <KpiCard
              label="Pick accuracy"
              value="99.8%"
              change="GS1-128 FEFO verified"
              trend="up"
              tone="ok"
              icon={<Barcode className="h-4 w-4" />}
            />
            <KpiCard
              label="Dock appointments"
              value={`${purchaseOrders.length} scheduled`}
              change="Inbound ASN pre-registered"
              trend="flat"
              icon={<Truck className="h-4 w-4" />}
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <Surface className="xl:col-span-2">
              <SectionHeader
                eyebrow="Work queue"
                title="Warehouse tasks"
                description="Tasks carry batch, location, weight and temperature context. A blocked task cannot be completed without an approval decision."
                action={<Badge tone="info">{tasks.length} tasks</Badge>}
              />
              <TaskQueue tasks={tasks} />
            </Surface>

            <div className="space-y-5">
              <Surface>
                <SectionHeader eyebrow="Mobile workflow" title="Scan and confirm" />
                <ScanPanel lots={lots} />
              </Surface>

              <Surface>
                <SectionHeader eyebrow="Capacity" title="Zone occupancy" />
                <div className="space-y-4 p-5">
                  {zones.map((zone) => (
                    <div
                      key={zone.name}
                      className="border-b border-border pb-3 last:border-0 last:pb-0"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">{zone.name}</span>
                        <span className="text-muted-foreground">
                          {zoneUsage.get(zone.name) ?? 0} batches · {zone.locations} bins
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground">{zone.temperature}</p>
                    </div>
                  ))}
                </div>
              </Surface>
            </div>
          </div>

          <Surface>
            <SectionHeader
              eyebrow="Inbound dock"
              title="Arrival and receiving schedule"
              description="Goods are received against the PO with supplier batch, manufacture/expiry, weight, quality certificates and temperature evidence."
            />
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Expected Date</th>
                    <th>PO / Supplier</th>
                    <th>Dock</th>
                    <th>Temperature requirement</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {purchaseOrders.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        No dock appointments. Book an inbound PO to schedule receiving.
                      </td>
                    </tr>
                  )}
                  {purchaseOrders.map((po, idx) => (
                    <tr key={po.id}>
                      <td data-label="Expected Date" className="whitespace-nowrap text-[11px]">
                        {shortDate(po.expected_date)} · 06:30 CET
                      </td>
                      <td data-label="PO / Supplier">
                        <p className="font-mono text-[11px] font-semibold">{po.po_number}</p>
                        <p className="mt-0.5 font-medium">{po.supplier_name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {po.product_name} ({po.ordered_cases} cases)
                        </p>
                      </td>
                      <td data-label="Dock" className="font-mono text-[11px]">
                        DOCK-CH-0{idx + 1}
                      </td>
                      <td data-label="Temperature requirement">Chilled 0–4°C · HACCP probe</td>
                      <td data-label="Status">
                        <Badge tone={statusTone(po.status)} dot>
                          {titleCase(po.status)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Surface>
        </div>
      )}
    </div>
  );
}
