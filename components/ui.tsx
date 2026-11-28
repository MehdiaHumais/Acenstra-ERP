import type { ReactNode } from "react";
import { cn } from "@/lib/format";
import type { StatusTone } from "@/lib/types";

const toneClasses: Record<StatusTone, string> = {
  ok: "border-emerald-600/30 bg-emerald-50 text-emerald-800",
  success: "border-emerald-600/30 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  critical: "border-red-200 bg-red-50 text-red-700",
  danger: "border-red-200 bg-red-50 text-red-700",
  neutral: "border-marine-ocean/25 bg-marine-ocean/5 text-marine-mid",
  default: "border-marine-ocean/25 bg-marine-ocean/5 text-marine-mid",
  info: "border-sky-200 bg-sky-50 text-sky-800",
  brand: "border-[#061222]/20 bg-[#061222] text-marine-ice",
};

const dotClasses: Record<StatusTone, string> = {
  ok: "bg-emerald-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  critical: "bg-red-500",
  danger: "bg-red-500",
  neutral: "bg-slate-400",
  default: "bg-slate-400",
  info: "bg-sky-500",
  brand: "bg-marine-steelLight",
};

export function Badge({
  children,
  tone = "neutral",
  dot = false,
  className,
}: {
  children: ReactNode;
  tone?: StatusTone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 break-words rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none whitespace-normal sm:whitespace-nowrap",
        toneClasses[tone],
        className,
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dotClasses[tone])} />}
      {children}
    </span>
  );
}

export function Surface({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={cn("surface", className)}>{children}</section>;
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
      <div>
        {eyebrow && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            {eyebrow}
          </p>
        )}
        <h2 className="mt-0.5 text-base font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {action && (
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
          {action}
        </div>
      )}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  change,
  trend,
  tone = "neutral",
  hint,
  icon,
}: {
  label: string;
  value: string;
  change: string;
  trend: "up" | "down" | "flat";
  tone?: StatusTone;
  hint?: string;
  icon?: ReactNode;
}) {
  const trendColour =
    tone === "critical"
      ? "text-red-600"
      : trend === "up"
        ? "text-emerald-700"
        : trend === "down"
          ? "text-red-600"
          : "text-muted-foreground";

  return (
    <div className="surface flex h-full min-h-[80px] flex-col p-3">
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {label}
        </p>
        {icon && (
          <span className="rounded-lg bg-secondary p-1.5 text-primary">{icon}</span>
        )}
      </div>
      <div className="mt-auto pt-3">
        <p className="text-xl font-semibold tracking-tight">{value}</p>
        <p className={cn("mt-1 text-xs font-medium", trendColour)}>{change}</p>
      </div>
      {hint && <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ProgressBar({
  value,
  tone = "ok",
  className,
}: {
  value: number;
  tone?: StatusTone;
  className?: string;
}) {
  const bar: Record<StatusTone, string> = {
    ok: "bg-primary",
    success: "bg-primary",
    warning: "bg-amber-500",
    critical: "bg-red-500",
    danger: "bg-red-500",
    neutral: "bg-slate-400",
    default: "bg-slate-400",
    info: "bg-sky-500",
    brand: "bg-primary",
  };
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className={cn("h-full rounded-full transition-all", bar[tone])}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export function StatRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "critical" | "warning" | "ok";
}) {
  const colour =
    tone === "critical"
      ? "text-red-600"
      : tone === "warning"
        ? "text-amber-700"
        : tone === "ok"
          ? "text-emerald-700"
          : "text-foreground";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 py-2.5 last:border-0 sm:gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn("break-words text-right text-sm font-semibold", colour)}>{value}</span>
    </div>
  );
}

export function statusTone(value: string | null | undefined): StatusTone {
  const normalised = String(value ?? "").toLowerCase().replace(/\s+/g, "_");
  if (["active", "approved", "delivered", "paid", "released", "accepted", "in_range", "done", "clear", "ok", "valid", "received", "awarded", "selected", "completed", "fulfilled"].includes(normalised)) {
    return "ok";
  }
  if (["warning", "warning_approaching", "part_paid", "review", "watch", "picking", "loading", "in_transit", "queued", "sent", "warning", "expiring", "hold", "quoted", "partially_confirmed", "backordered", "pending_approval"].includes(normalised)) {
    return "warning";
  }
  if (["blocked", "critical", "excursion", "overdue", "rejected", "exception", "quarantine", "paused", "cancelled", "expired"].includes(normalised)) {
    return "critical";
  }
  if (["issued", "confirmed", "planned", "draft", "pending", "not_sent", "scheduled", "open", "processing", "submitted"].includes(normalised)) {
    return "info";
  }
  return "neutral";
}
