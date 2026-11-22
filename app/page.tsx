import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Euro,
  Snowflake,
  Thermometer,
  Truck,
} from "lucide-react";
import { JourneyFlow } from "@/components/journey-flow";
import { InsightList } from "@/components/insight-list";
import { PageHeading } from "@/components/page-heading";
import { RevenueChart } from "@/components/revenue-chart";
import { Badge, KpiCard, SectionHeader, Surface, statusTone } from "@/components/ui";
import { getOverview } from "@/lib/api";
import { dateTime, money, number, titleCase } from "@/lib/format";

const kpiIcons = [
  <Euro key="revenue" className="h-4 w-4" />,
  <CheckCircle2 key="fill" className="h-4 w-4" />,
  <Truck key="otif" className="h-4 w-4" />,
  <Snowflake key="risk" className="h-4 w-4" />,
  <Thermometer key="temp" className="h-4 w-4" />,
  <CreditCard key="credit" className="h-4 w-4" />,
];

export default async function OverviewPage() {
  const data = await getOverview();
  const openTasks = data.tasks.filter((task) => task.status !== "done");
  const excursionCount = data.temperature.filter((reading) => reading.status !== "in_range").length;

  return (
    <>
      <PageHeading
        eyebrow="Ascentra Global Ltd · operating platform"
        title="Food distribution command centre"
        description="One connected journey from supplier sourcing and temperature-controlled receiving to FEFO fulfilment, route delivery, financial reconciliation and management intelligence."
        meta="Live operational data · governed AI recommendations"
        actions={
          <>
            <Link
              href="/traceability"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-secondary"
            >
              Trace a batch
            </Link>
            <Link
              href="/orders"
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Review blocked orders <ArrowRight className="h-4 w-4" />
            </Link>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {data.kpis.map((kpi, index) => (
          <KpiCard key={kpi.label} {...kpi} icon={kpiIcons[index]} />
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Surface>
            <SectionHeader
              eyebrow="Financial pulse"
              title="Revenue and landed cost"
              description="Gross contribution is calculated using receipt landed cost and allocated delivery cost."
            />
            <div className="p-5">
              <RevenueChart data={data.revenue_by_week} />
              {data.revenue_by_week.length > 0 && (
                <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
                  <div>
                    <p className="field-label">Revenue (last 8 weeks)</p>
                    <p className="mt-1 text-lg font-semibold">
                      {money(Math.round(data.revenue_by_week.reduce((total, row) => total + row.revenue, 0) * 100))}
                    </p>
                  </div>
                  <div>
                    <p className="field-label">Landed cost</p>
                    <p className="mt-1 text-lg font-semibold">
                      {money(Math.round(data.revenue_by_week.reduce((total, row) => total + row.cost, 0) * 100))}
                    </p>
                  </div>
                  <div>
                    <p className="field-label">Gross contribution</p>
                    <p className="mt-1 text-lg font-semibold text-marine-mid">
                      {money(
                        Math.round(
                          data.revenue_by_week.reduce((total, row) => total + row.revenue - row.cost, 0) * 100,
                        ),
                      )}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </Surface>

          <div className="grid gap-5 lg:grid-cols-2">
            <Surface>
              <SectionHeader
                eyebrow="Cold chain"
                title="Temperature status"
                description={`${excursionCount} areas outside their configured safe range.`}
                action={
                  <Link href="/inventory" className="text-xs font-semibold text-primary">
                    Open inventory
                  </Link>
                }
              />
              <div className="divide-y divide-border">
                {data.temperature.length === 0 && (
                  <p className="px-5 py-8 text-center text-xs text-muted-foreground">
                    No temperature readings yet.
                  </p>
                )}
                {data.temperature.slice(0, 5).map((reading) => (
                  <div key={reading.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{reading.location}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {reading.zone} · {reading.device}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{reading.celsius.toFixed(1)}°C</p>
                      <p className="text-[10px] text-muted-foreground">
                        {reading.min_c}–{reading.max_c}°C
                      </p>
                    </div>
                    <Badge tone={statusTone(reading.status)} dot>
                      {titleCase(reading.status)}
                    </Badge>
                  </div>
                ))}
              </div>
            </Surface>

            <Surface>
              <SectionHeader
                eyebrow="FEFO watchlist"
                title="Stock nearing minimum shelf life"
                description="Lots that require allocation, markdown or quality action."
                action={
                  <Link href="/inventory" className="text-xs font-semibold text-primary">
                    View all lots
                  </Link>
                }
              />
              <div className="divide-y divide-border">
                {data.expiring.length === 0 && (
                  <p className="px-5 py-8 text-center text-xs text-muted-foreground">
                    No lots nearing minimum shelf life.
                  </p>
                )}
                {data.expiring.map((lot) => (
                  <div key={lot.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{lot.product_name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {lot.batch_code} · {number(lot.remaining_kg, 1)} kg
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={lot.days_remaining <= 2 ? "text-sm font-semibold text-red-600" : "text-sm font-semibold"}>
                        {lot.days_remaining}d
                      </p>
                      <p className="text-[10px] text-muted-foreground">to expiry</p>
                    </div>
                    <Badge tone={statusTone(lot.quality_status)}>{titleCase(lot.quality_status)}</Badge>
                  </div>
                ))}
              </div>
            </Surface>
          </div>

          <Surface>
            <SectionHeader
              eyebrow="Warehouse execution"
              title="Live task queue"
              description={`${openTasks.length} open tasks across put-away, FEFO picking, packing, loading and cycle counting.`}
              action={
                <Link href="/warehouse" className="text-xs font-semibold text-primary">
                  Open warehouse
                </Link>
              }
            />
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Reference</th>
                    <th>Location</th>
                    <th>Assignee</th>
                    <th>Due</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tasks.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                        No warehouse tasks yet.
                      </td>
                    </tr>
                  )}
                  {data.tasks.slice(0, 5).map((task) => (
                    <tr key={task.id}>
                      <td data-label="Task">
                        <p className="font-medium">{titleCase(task.task_type)}</p>
                        <p className="mt-0.5 max-w-[260px] text-[11px] text-muted-foreground">
                          {task.detail}
                        </p>
                      </td>
                      <td data-label="Reference" className="font-mono text-[11px]">{task.reference}</td>
                      <td data-label="Location">{task.location}</td>
                      <td data-label="Assignee">{task.assignee}</td>
                      <td data-label="Due" className="whitespace-nowrap text-[11px]">{dateTime(task.due_at)}</td>
                      <td data-label="Status">
                        <Badge tone={statusTone(task.status)} dot>
                          {titleCase(task.status)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Surface>
        </div>

        <div className="space-y-5">
          <Surface>
            <SectionHeader
              eyebrow="Exceptions"
              title="Needs attention"
              description="Operational events requiring a decision or evidence."
            />
            <div className="divide-y divide-border">
              {data.alerts.length === 0 && (
                <p className="px-5 py-8 text-center text-xs text-muted-foreground">
                  No open exceptions.
                </p>
              )}
              {data.alerts.map((alert) => (
                <Link
                  key={alert.id}
                  href={alert.href}
                  className="block px-5 py-3.5 transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-center gap-2">
                    <Badge tone={alert.severity} dot>
                      {titleCase(alert.severity)}
                    </Badge>
                    <span className="ml-auto text-[10px] text-muted-foreground">{alert.age}</span>
                  </div>
                  <p className="mt-1.5 text-sm font-medium">{alert.title}</p>
                  <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{alert.detail}</p>
                </Link>
              ))}
            </div>
          </Surface>

          <Surface>
            <SectionHeader
              eyebrow="Governed AI"
              title="Decisions awaiting approval"
              description="Recommendations are grounded in authorised ERP data."
              action={
                <Link href="/analytics" className="text-xs font-semibold text-primary">
                  Review all
                </Link>
              }
            />
            <InsightList insights={data.insights.slice(0, 2)} />
          </Surface>

          <Surface>
            <SectionHeader eyebrow="Credit control" title="Exposure snapshot" />
            <div className="space-y-4 p-5">
              <p className="text-xs leading-5 text-muted-foreground">
                Customer exposure, credit limits and blocked orders appear here once orders and
                invoices exist.
              </p>
              <Link href="/orders" className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
                Release or block orders <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </Surface>
        </div>
      </div>

      <Surface className="mt-5">
        <SectionHeader
          eyebrow="End-to-end journey"
          title="One food product from supplier to customer"
          description="The operating model is deliberately connected: no module silently loses batch, weight, temperature or financial context."
          action={<Badge tone="info">10 core modules</Badge>}
        />
        <div className="p-5">
          <JourneyFlow steps={data.journey} />
        </div>
      </Surface>
    </>
  );
}
