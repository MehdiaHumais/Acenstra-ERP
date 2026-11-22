import { compactMoney } from "@/lib/format";

export function RevenueChart({
  data,
}: {
  data: { week: string; revenue: number; cost: number }[];
}) {
  const maximum = Math.max(1, ...data.flatMap((row) => [row.revenue, row.cost]));

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
        Revenue appears here once orders are invoiced.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-4 text-[11px] font-medium text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-marine-steel" /> Revenue
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-marine-ocean" /> Landed cost
        </span>
        <span className="ml-auto">Last 8 weeks</span>
      </div>
      <div className="flex h-48 items-end gap-2 sm:gap-3">
        {data.map((row) => {
          const revenueHeight = Math.round((row.revenue / maximum) * 100);
          const costHeight = Math.round((row.cost / maximum) * 100);
          return (
            <div key={row.week} className="group flex flex-1 flex-col items-center gap-2">
              <div className="relative flex h-40 w-full items-end gap-1">
                <div
                  className="w-1/2 rounded-t bg-marine-steel transition-opacity group-hover:opacity-80"
                  style={{ height: `${revenueHeight}%` }}
                  title={`${row.week} revenue ${compactMoney(row.revenue)}`}
                />
                <div
                  className="w-1/2 rounded-t bg-marine-ocean/70 transition-opacity group-hover:opacity-80"
                  style={{ height: `${costHeight}%` }}
                  title={`${row.week} cost ${compactMoney(row.cost)}`}
                />
              </div>
              <span className="text-[10px] font-medium text-muted-foreground">{row.week}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
