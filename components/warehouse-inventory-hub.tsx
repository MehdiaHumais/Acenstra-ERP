"use client";

import { useState } from "react";
import { Snowflake, Warehouse } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { ViewOnlyBadge } from "@/components/access-gate";
import { PutawayWorkbench } from "@/components/putaway-workbench";
import { StockIntelligenceWorkbench } from "@/components/stock-intelligence-workbench";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/format";

export type WarehouseInventoryTab = "inventory" | "putaway";

export function WarehouseInventoryHub({
  defaultTab = "inventory",
}: {
  defaultTab?: WarehouseInventoryTab;
}) {
  const [activeTab, setActiveTab] = useState<WarehouseInventoryTab>(defaultTab);

  return (
    <div className="space-y-5">
      <PageHeading
        eyebrow="Step 05 & 06 · Bin Put-away, Stock Intelligence & FEFO"
        title="Warehouse & Inventory"
        description="Put approved goods into suitable warehouse bins. Track batches, expiry dates, locations and stock availability using FEFO."
        meta="Physical stock is never automatically treated as available; held, quarantined, rejected, damaged, and expired stock is strictly excluded from allocation."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ViewOnlyBadge modifyPermissions={["putaway.execute", "putaway.manage", "inventory:adjust", "inventory.reserve"]} />
            <Badge tone="ok" dot>
              FEFO Engine Active
            </Badge>
            <Badge tone="info">Multi-Zone Cold Storage</Badge>
          </div>
        }
      />

      {/* Unified Switcher */}
      <div className="flex flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap rounded-xl border border-border bg-card p-1.5 shadow-sm [-webkit-overflow-scrolling:touch] sm:flex-wrap">
        <button
          type="button"
          onClick={() => setActiveTab("inventory")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all",
            activeTab === "inventory"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Snowflake className="h-3.5 w-3.5" />
          FEFO Inventory<span className="hidden sm:inline">, Batches, Expiry, Reservations & Cycle Counts</span>
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
          Put-away<span className="hidden sm:inline"> & Warehouse Bin Placement</span>
        </button>
      </div>

      {activeTab === "inventory" && <StockIntelligenceWorkbench />}
      {activeTab === "putaway" && <PutawayWorkbench />}
    </div>
  );
}
