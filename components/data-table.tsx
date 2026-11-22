"use client";

import { Fragment, useState } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { Badge, Surface } from "@/components/ui";
import { cn } from "@/lib/format";

// ---------------------------------------------------------------------------
// Loading / empty / error states
// ---------------------------------------------------------------------------

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
      {label}
    </div>
  );
}

export function EmptyState({
  title = "No records found",
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="max-w-md text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <p className="text-sm font-semibold text-red-700">{title}</p>
      {message && <p className="max-w-md text-xs text-muted-foreground">{message}</p>}
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn btn-secondary btn-sm mt-2">
          Retry
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TableToolbar — compact toolbar: title/count left, search/filters/action right
// ---------------------------------------------------------------------------

export interface TableToolbarProps {
  title?: string;
  count?: number;
  countLabel?: string;
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filters?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function TableToolbar({
  title,
  count,
  countLabel = "records",
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  filters,
  action,
  className,
}: TableToolbarProps) {
  return (
    <div className={cn("flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="flex items-center gap-2">
        {title && <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>}
        {typeof count === "number" && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
            {count} {countLabel}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {onSearchChange && (
          <label className="relative block w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <input
              value={search ?? ""}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="input h-8 pl-8 pr-8 text-xs"
            />
            {search && (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                className="absolute right-1.5 top-1.5 rounded-md p-0.5 text-muted-foreground hover:bg-muted"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </label>
        )}
        {filters}
        {action}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TablePagination — page size + prev/next + "X–Y of Z"
// ---------------------------------------------------------------------------

export interface TablePaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  className?: string;
}

export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  className,
}: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);

  return (
    <div className={cn("flex flex-col gap-2 border-t border-border px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          {from}–{to} of {total}
        </span>
        {onPageSizeChange && (
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="h-7 rounded-md border border-input bg-background px-2 text-xs"
            aria-label="Page size"
          >
            {pageSizeOptions.map((s) => (
              <option key={s} value={s}>
                {s} / page
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(safePage - 1)}
          disabled={safePage <= 1}
          className="btn btn-secondary btn-sm h-7 px-2"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="px-2 text-xs font-medium text-foreground">
          {safePage} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(safePage + 1)}
          disabled={safePage >= totalPages}
          className="btn btn-secondary btn-sm h-7 px-2"
          aria-label="Next page"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DataTable — generic table wrapper with loading/empty/error states
// ---------------------------------------------------------------------------

export interface DataTableColumn<T> {
  key: string;
  header: string;
  width?: string;
  align?: "left" | "center" | "right";
  className?: string;
  render: (row: T) => React.ReactNode;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  loadingLabel?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  error?: string | null;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  minTableWidth?: string;
  className?: string;
  footer?: React.ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  loadingLabel = "Loading…",
  emptyTitle = "No records found",
  emptyDescription,
  emptyAction,
  error,
  onRetry,
  onRowClick,
  minTableWidth = "720px",
  className,
  footer,
}: DataTableProps<T>) {
  return (
    <div className={cn("overflow-hidden", className)}>
      <div className="table-shell">
        <table className="table-fit" style={{ minWidth: minTableWidth }}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  className={cn(
                    col.align === "right"
                      ? "text-right"
                      : col.align === "center"
                        ? "text-center"
                        : "text-left",
                    col.className,
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="py-2">
                  <LoadingState label={loadingLabel} />
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={columns.length} className="py-2">
                  <ErrorState message={error} onRetry={onRetry} />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-2">
                  <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={onRowClick ? "cursor-pointer" : undefined}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      style={col.width ? { width: col.width } : undefined}
                      className={cn(
                        col.align === "right"
                          ? "text-right"
                          : col.align === "center"
                            ? "text-center"
                            : "text-left",
                        col.className,
                      )}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {footer}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RowActions — icon-button cluster with overflow menu for secondary actions
// ---------------------------------------------------------------------------

export interface RowAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
}

export function RowActions({
  primary,
  secondary,
  className,
}: {
  primary?: RowAction[];
  secondary?: RowAction[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("relative inline-flex items-center gap-1", className)}>
      {primary?.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            action.onClick();
          }}
          disabled={action.disabled}
          title={action.label}
          aria-label={action.label}
          className={cn(
            "rounded-md p-1.5 transition-colors disabled:opacity-40",
            action.tone === "danger"
              ? "text-muted-foreground hover:bg-red-50 hover:text-red-600"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {action.icon}
        </button>
      ))}
      {secondary && secondary.length > 0 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="More actions"
            title="More actions"
          >
            <span className="text-xs font-bold">⋯</span>
          </button>
          {open && (
            <>
              <button
                type="button"
                aria-label="Close menu"
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setOpen(false)}
              />
              <div className="absolute right-0 top-8 z-50 min-w-[160px] overflow-hidden rounded-xl border border-border bg-card shadow-lg">
                {secondary.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(false);
                      action.onClick();
                    }}
                    disabled={action.disabled}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted disabled:opacity-40",
                      action.tone === "danger" ? "text-red-700" : "text-foreground",
                    )}
                  >
                    {action.icon}
                    {action.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DetailSection — compact labeled grid for record detail pages
// ---------------------------------------------------------------------------

export function DetailSection({
  title,
  eyebrow,
  children,
  className,
}: {
  title?: string;
  eyebrow?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card", className)}>
      {(eyebrow || title) && (
        <header className="border-b border-border px-4 py-2.5">
          {eyebrow && (
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">{eyebrow}</p>
          )}
          {title && <h3 className="mt-0.5 text-sm font-semibold tracking-tight">{title}</h3>}
        </header>
      )}
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

export function DetailGrid({
  columns = 2,
  children,
}: {
  columns?: 2 | 3 | 4;
  children: React.ReactNode;
}) {
  const cls =
    columns === 4
      ? "grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-4"
      : columns === 3
        ? "grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3"
        : "grid gap-x-4 gap-y-2 sm:grid-cols-2";
  return <div className={cls}>{children}</div>;
}

export function DetailField({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-sm text-foreground", mono && "font-mono text-xs")}>{value ?? "—"}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CompactFormLayout — 2-column form grid
// ---------------------------------------------------------------------------

export function CompactFormLayout({
  children,
  columns = 2,
}: {
  children: React.ReactNode;
  columns?: 1 | 2 | 3;
}) {
  const cls =
    columns === 3
      ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      : columns === 2
        ? "grid gap-3 sm:grid-cols-2"
        : "grid gap-3";
  return <div className={cls}>{children}</div>;
}
