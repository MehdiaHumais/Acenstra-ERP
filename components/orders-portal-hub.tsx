"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CreditCard,
  MousePointerClick,
  ShoppingBag,
  ShoppingCart,
  Store as StoreIcon,
  TimerReset,
  TrendingDown,
} from "lucide-react";
import { B2bPortalWorkbench } from "@/components/b2b-portal-workbench";
import { OrdersTable } from "@/components/orders-table";
import { PageHeading } from "@/components/page-heading";
import { StoreMonitoringWorkbench } from "@/components/store-monitoring-workbench";
import { StoreTable } from "@/components/store-table";
import { Badge, KpiCard, SectionHeader, Surface, statusTone } from "@/components/ui";
import { cn, compactMoney, money, number, percent, titleCase } from "@/lib/format";
import type { Order, Product, StoreSummary } from "@/lib/types";

export type OrdersHubTab = "portal" | "order_book" | "stores";

export function OrdersPortalHub({
  orders,
  products,
  storeSummary,
  defaultTab = "portal",
}: {
  orders: Order[];
  products: Product[];
  storeSummary: StoreSummary;
  defaultTab?: OrdersHubTab;
}) {
  const [activeTab, setActiveTab] = useState<OrdersHubTab>(defaultTab);

  const open = orders.filter((order) => !["delivered", "cancelled"].includes(order.status));
  const blocked = orders.filter((order) => order.credit_status === "blocked");
  const openValue = open.reduce((sum, order) => sum + order.total_cents, 0);
  const average = orders.length
    ? orders.reduce((sum, order) => sum + order.total_cents, 0) / orders.length
    : 0;

  const watchStores = storeSummary.stores.filter((store) => store.status !== "active").length;
  const bestStore = [...storeSummary.stores].sort((a, b) => b.trend_pct - a.trend_pct)[0];

  return (
    <div className="space-y-5">
      <PageHeading
        eyebrow="Step 07 · Commercial ERP, B2B Portal & Credit Control"
        title="Customer Orders"
        description="Restaurants order through the B2B portal, or sales staff create orders internally. The system checks pricing, credit limits, stock and shelf-life requirements before confirmation."
        meta="Order lines reserve FEFO-eligible batches with minimum delivery-date shelf-life validation."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={blocked.length > 0 ? "critical" : "ok"} dot>
              {blocked.length} credit blocks
            </Badge>
            <Badge tone="info">{orders.length} orders</Badge>
          </div>
        }
      />

      {/* Unified Module Switcher */}
      <div className="flex flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap rounded-xl border border-border bg-card p-1.5 shadow-sm [-webkit-overflow-scrolling:touch] sm:flex-wrap">
        <button
          type="button"
          onClick={() => setActiveTab("portal")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all",
            activeTab === "portal"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <ShoppingCart className="h-3.5 w-3.5" />
          B2B Ordering<span className="hidden sm:inline"> &amp; Credit Workbench</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("order_book")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all",
            activeTab === "order_book"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <ShoppingBag className="h-3.5 w-3.5" />
          Order Book<span className="hidden sm:inline"> &amp; Batch Allocations</span>
          <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px]">
            {orders.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("stores")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all",
            activeTab === "stores"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <StoreIcon className="h-3.5 w-3.5" />
          Franchise Stores<span className="hidden sm:inline"> &amp; Consumption</span>
          <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px]">
            {storeSummary.stores.length}
          </span>
        </button>
      </div>

      {activeTab === "portal" && <B2bPortalWorkbench />}

      {activeTab === "order_book" && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Open orders"
              value={String(open.length)}
              change={`${money(openValue)} pipeline value`}
              trend="up"
              icon={<ShoppingBag className="h-4 w-4" />}
            />
            <KpiCard
              label="Blocked by credit"
              value={String(blocked.length)}
              change="Release or override required"
              trend="down"
              tone="critical"
              icon={<CreditCard className="h-4 w-4" />}
            />
            <KpiCard
              label="Average order value"
              value={money(Math.round(average))}
              change={orders.length ? `Across ${orders.length} orders` : "No orders yet"}
              trend="flat"
              icon={<MousePointerClick className="h-4 w-4" />}
            />
            <KpiCard
              label="Promised within 48h"
              value={String(
                orders.filter((order) => order.promised_at < "2026-10-25T23:59:59").length,
              )}
              change="Pick waves generated"
              trend="flat"
              icon={<TimerReset className="h-4 w-4" />}
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-4">
            <Surface className="xl:col-span-3">
              <SectionHeader
                eyebrow="Order-to-cash"
                title="Order book"
                description="Click an order to inspect its batch allocation. A blocked order cannot enter a pick wave until credit approval is recorded."
                action={
                  <Badge tone="info">
                    {number(orders.reduce((sum, order) => sum + order.lines.length, 0))} lines
                  </Badge>
                }
              />
              <OrdersTable orders={orders} products={products} />
            </Surface>

            <div className="space-y-5">
              <Surface>
                <SectionHeader eyebrow="Credit control" title="Order release policy" />
                <div className="space-y-4 p-5 text-[11px] leading-5 text-muted-foreground">
                  <p>
                    Each order checks the customer credit limit, ageing profile, overdue invoices
                    and any approved override.
                  </p>
                  {blocked.length > 0 ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                      <p className="font-semibold">{blocked[0].number} blocked</p>
                      <p className="mt-1">
                        {blocked[0].customer_name} requires credit release before a pick wave can be
                        generated.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-marine-ocean/60 bg-marine-ocean/20 p-3 text-marine-navy">
                      <p className="font-semibold">No credit blocks</p>
                      <p className="mt-1">
                        Every confirmed order is within its approved credit limit.
                      </p>
                    </div>
                  )}
                  <p>
                    Overrides require maker-checker approval and create an immutable audit event
                    with reason and expiry.
                  </p>
                </div>
              </Surface>

              <Surface>
                <SectionHeader eyebrow="B2B portal" title="Customer experience" />
                <div className="space-y-3 p-5">
                  {[
                    "Restricted catalogue by customer group",
                    "Repeat orders and saved baskets",
                    "Account-specific contract prices",
                    "Live FEFO availability and shelf-life threshold",
                    "Order history and credit statements",
                    "Installable responsive PWA",
                  ].map((item) => (
                    <div key={item} className="flex items-start gap-2 text-[11px] leading-5">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </Surface>
            </div>
          </div>
        </div>
      )}

      {activeTab === "stores" && (
        <div className="space-y-6">
          <StoreMonitoringWorkbench />
        </div>
      )}
    </div>
  );
}
