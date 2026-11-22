import type { Metadata } from "next";
import {
  CreditCard,
  MousePointerClick,
  ShoppingBag,
  TimerReset,
} from "lucide-react";
import { OrdersTable } from "@/components/orders-table";
import { PageHeading } from "@/components/page-heading";
import { ViewOnlyBadge } from "@/components/access-gate";
import { Badge, KpiCard, SectionHeader, Surface } from "@/components/ui";
import { getOrders, getProducts } from "@/lib/api";
import { money, number } from "@/lib/format";

export const metadata: Metadata = {
  title: "Customer Orders & Credit Control | Ascentra ERP",
};

export default async function OrdersPage() {
  const [orders, products] = await Promise.all([getOrders(), getProducts()]);

  const open = orders.filter((order) => !["delivered", "cancelled"].includes(order.status));
  const blocked = orders.filter((order) => order.credit_status === "blocked");
  const openValue = open.reduce((sum, order) => sum + order.total_cents, 0);
  const average = orders.length
    ? orders.reduce((sum, order) => sum + order.total_cents, 0) / orders.length
    : 0;

  return (
    <div className="space-y-4">
      <PageHeading
        eyebrow="Commercial · Sales Order Management"
        title="Customer Orders & Credit Control"
        description="B2B sales orders, FEFO batch allocations, shelf-life validation, and credit control release."
        meta="A blocked order cannot enter a pick wave until maker-checker credit approval is recorded."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ViewOnlyBadge modifyPermissions={["orders:write", "orders:credit_override"]} />
            <Badge tone={blocked.length > 0 ? "critical" : "ok"} dot>
              {blocked.length} credit blocks
            </Badge>
            <Badge tone="info">{orders.length} orders</Badge>
          </div>
        }
      />

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
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

      <Surface>
        <SectionHeader
          eyebrow="Order-to-cash"
          title="Customer order book & batch allocations"
          description="Click any order to inspect its FEFO lot allocation, contract pricing source, and fulfillment status."
          action={
            <Badge tone="info">
              {number(orders.reduce((sum, order) => sum + order.lines.length, 0))} order lines
            </Badge>
          }
        />
        <OrdersTable orders={orders} products={products} />
      </Surface>

      {blocked.length > 0 && (
        <Surface>
          <SectionHeader eyebrow="Credit control" title="Blocked order" />
          <div className="flex flex-col gap-2 p-4 text-[11px] leading-5 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-foreground">
                {blocked[0].number} — {blocked[0].customer_name}
              </p>
              <p className="mt-0.5">
                Requires credit release before a pick wave can be generated. Overrides need
                maker-checker approval and create an immutable audit event.
              </p>
            </div>
            <a href="/finance" className="shrink-0 font-semibold text-primary hover:underline">
              Open finance →
            </a>
          </div>
        </Surface>
      )}
    </div>
  );
}
