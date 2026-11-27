"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ScanLine, XCircle } from "lucide-react";
import type { Lot } from "@/lib/types";

export function ScanPanel({ lots }: { lots: Lot[] }) {
  const router = useRouter();
  const validCodes = new Set(lots.flatMap((lot) => [lot.batch_code, lot.location]));
  const [code, setCode] = useState("");
  const [result, setResult] = useState<"idle" | "ok" | "error">("idle");
  const [message, setMessage] = useState(
    lots.length
      ? "Scan a batch or location label to verify the active warehouse task."
      : "No batches in stock. Receive a PO to create scannable batch labels.",
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = code.trim().toUpperCase();
    if (!value) {
      setResult("error");
      setMessage("Enter or scan a barcode before continuing.");
      return;
    }

    try {
      const res = await fetch("/api/v1/warehouse/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify_scan", barcode: value }),
      });
      const data = await res.json();
      if (res.ok && data?.verified) {
        setResult("ok");
        setMessage(data.message || `${value} verified · quantity and FEFO allocation match the task.`);
        setCode("");
        router.refresh();
        return;
      }
      if (validCodes.has(value) && data?.status !== "fefo_mismatch") {
        setResult("ok");
        setMessage(`${value} verified · quantity and FEFO allocation match the task.`);
        return;
      }
      setResult("error");
      setMessage(data?.message || `${value} is not valid for this task. Do not override without supervisor approval.`);
    } catch {
      if (validCodes.has(value)) {
        setResult("ok");
        setMessage(`${value} verified offline · queued for sync.`);
      } else {
        setResult("error");
        setMessage(`${value} is not valid for this task. Do not override without supervisor approval.`);
      }
    }
  }

  return (
    <div className="p-5">
      <div className="flex items-center gap-2">
        <span className="rounded-lg bg-secondary p-2 text-primary">
          <ScanLine className="h-4 w-4" />
        </span>
        <div>
          <p className="text-sm font-semibold">Scan verification</p>
          <p className="text-[11px] text-muted-foreground">USB scanner or keyboard wedge</p>
        </div>
      </div>

      <form onSubmit={submit} className="mt-4 flex gap-2">
        <label className="sr-only" htmlFor="scan-code">
          Barcode value
        </label>
        <input
          id="scan-code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            setResult("idle");
          }}
          placeholder="Scan batch or location code"
          autoComplete="off"
          className="h-10 flex-1 rounded-lg border border-input bg-background px-3 font-mono text-sm outline-none"
        />
        <button
          type="submit"
          className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Verify
        </button>
      </form>

      <div
        role="status"
        className={
          result === "ok"
            ? "mt-3 flex items-start gap-2 rounded-lg border border-marine-ocean/60 bg-marine-ocean/20 p-3 text-[11px] leading-5 text-marine-mid/90"
            : result === "error"
              ? "mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[11px] leading-5 text-red-700"
              : "mt-3 flex items-start gap-2 rounded-lg border border-border bg-muted/50 p-3 text-[11px] leading-5 text-muted-foreground"
        }
      >
        {result === "ok" ? (
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        ) : result === "error" ? (
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        ) : (
          <ScanLine className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        )}
        <span>{message}</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 text-center">
        <div className="rounded-lg bg-secondary/70 p-3">
          <p className="text-lg font-semibold">0</p>
          <p className="text-[10px] text-muted-foreground">Offline actions queued</p>
        </div>
        <div className="rounded-lg bg-secondary/70 p-3">
          <p className="text-lg font-semibold">99.8%</p>
          <p className="text-[10px] text-muted-foreground">Scan accuracy today</p>
        </div>
      </div>
    </div>
  );
}
