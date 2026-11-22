import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";

export function PageHeading({
  eyebrow,
  title,
  description,
  meta,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  meta?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-2 border-b border-border pb-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 max-w-2xl flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
          {eyebrow}
        </p>
        <h1 className="mt-0.5 text-lg font-semibold tracking-tight sm:text-xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-2xl break-words text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        )}
        {meta && (
          <p className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <ArrowUpRight className="h-3 w-3 text-primary" />
            {meta}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
