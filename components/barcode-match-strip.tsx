"use client";

import { useState } from "react";
import { Barcode, CheckCircle2, XCircle } from "lucide-react";

interface BarcodeMatchStripProps {
  operation: string;
  referenceId?: string | null;
  expectedSku?: string | null;
  /** Optional lot/expiry reminder shown after a product match — the barcode identifies the PRODUCT, never the lot. */
  lotHint?: string | null;
  onMatch?: (productSku: string, productName: string) => void;
  disabled?: boolean;
}

/**
 * Compact, reusable barcode confirmation strip for operational screens
 * (receiving / put-away / picking / packing). USB scanners finish with Enter,
 * and the underlying lookup API enforces permissions and records the scan.
 */
export function BarcodeMatchStrip({
  operation,
  referenceId,
  expectedSku,
  lotHint,
  onMatch,
  disabled
}: BarcodeMatchStripProps) {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<"idle" | "ok" | "error" | "mismatch">("idle");
  const [note, setNote] = useState<string>("Scan the product barcode to validate against the task.");

  const verify = async () => {
    const code = value.trim();
    if (!code) return;
    setStatus("idle");
    setNote("Verifying…");
    try {
      const res = await fetch("/api/v1/products/barcode/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          barcode: code,
          operation,
          reference_id: referenceId ?? undefined,
          quantity: 1,
          result: expectedSku ? "pending_sku" : "lookup"
        }),
        credentials: "include"
      });
      const body = await res.json().catch(() => ({}));
      if (body?.found && body?.product) {
        if (expectedSku && body.product.sku !== expectedSku) {
          setStatus("mismatch");
          setNote(`Barcode resolves to ${body.product.sku} — expected ${expectedSku}. Pick the correct lot or task.`);
          return;
        }
        setStatus("ok");
        setNote(`${body.product.sku} — ${body.product.name}`);
        onMatch?.(body.product.sku, body.product.name);
        setValue("");
        return;
      }
      setStatus("error");
      setNote(`Barcode ${code} not found. Associate it with a product first.`);
    } catch {
      setStatus("error");
      setNote("Network error while resolving barcode.");
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      verify();
    }
  };

  const tone =
    status === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : status === "mismatch"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : status === "error"
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-border bg-muted/40 text-muted-foreground";

  const icon =
    status === "ok" ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
    ) : status === "mismatch" ? (
      <XCircle className="h-4 w-4 text-amber-600" />
    ) : status === "error" ? (
      <XCircle className="h-4 w-4 text-red-600" />
    ) : (
      <Barcode className="h-4 w-4 text-primary" />
    );

  return (
    <div className={`rounded-lg border px-2.5 py-2 text-[11px] ${tone}`}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-semibold">Barcode</span>
        <div className="mt-1 flex w-full flex-col gap-2 sm:ml-auto sm:mt-0 sm:w-auto sm:flex-row sm:items-center">
          <input
            disabled={disabled}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Scan barcode…"
            className="min-h-11 w-full rounded border border-border bg-background px-2 font-mono text-[11px] tracking-wider outline-none focus:ring-1 focus:ring-primary sm:w-44"
            aria-label="Product barcode"
          />
          <button
            type="button"
            disabled={disabled || !value.trim()}
            onClick={verify}
            className="min-h-11 w-full rounded-md border border-border bg-background px-3 text-xs font-semibold disabled:opacity-40 sm:w-auto sm:px-2 sm:text-[10px]"
          >
            Verify
          </button>
        </div>
      </div>
      <p className="mt-1 leading-4">{note}</p>
      {status === "ok" && (
        <p className="mt-1 leading-4 text-[10px] font-medium text-emerald-800">
          Barcode identifies the PRODUCT — now scan/inspect the lot and expiry printed on the pack.
          {lotHint ? ` FEFO expects ${lotHint}.` : ""}
        </p>
      )}
    </div>
  );
}
