"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BellRing, CheckCircle2, ShieldAlert } from "lucide-react";
import { Can } from "@/components/access-gate";

export function TraceNotifyButton({
  orderNumber,
  batchCode,
}: {
  orderNumber: string;
  batchCode?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [notified, setNotified] = useState(false);

  if (notified) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-marine-mid">
        <CheckCircle2 className="h-3.5 w-3.5" /> Notified
      </span>
    );
  }

  const handleNotify = async () => {
    const targetBatch = batchCode || searchParams.get("batch") || "LOT-2026-SAL-041";
    try {
      await fetch(`/api/v1/traceability/batches/${encodeURIComponent(targetBatch)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "notify_customer",
          order_number: orderNumber,
        }),
      });
    } finally {
      setNotified(true);
      router.refresh();
    }
  };

  return (
    <Can permission="traceability:quarantine" mode="disable">
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={handleNotify}
        aria-label={`Notify customer for ${orderNumber}`}
      >
        <BellRing className="h-3 w-3" /> Notify
      </button>
    </Can>
  );
}

export function QuarantineButton({ batchCode }: { batchCode?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [quarantined, setQuarantined] = useState(false);

  if (quarantined) {
    return (
      <div className="rounded-lg border border-marine-ocean/60 bg-marine-ocean/20 p-3 text-[11px] leading-5 text-marine-navy">
        <p className="flex items-center gap-1.5 font-semibold">
          <CheckCircle2 className="h-3.5 w-3.5" /> Quarantine applied
        </p>
        <p className="mt-1">
          Remaining lot stock is blocked from allocation and dispatch. Quality manager release is required.
        </p>
      </div>
    );
  }

  const handleQuarantine = async () => {
    const targetBatch = batchCode || searchParams.get("batch") || "LOT-2026-SAL-041";
    try {
      await fetch(`/api/v1/traceability/batches/${encodeURIComponent(targetBatch)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "quarantine",
          reason: "Emergency recall containment initiated from Traceability console",
        }),
      });
    } finally {
      setQuarantined(true);
      router.refresh();
    }
  };

  return (
    <Can permission="traceability:quarantine" mode="disable">
      <button type="button" className="btn btn-danger w-full" onClick={handleQuarantine}>
        <ShieldAlert className="h-3.5 w-3.5" /> Quarantine remaining stock
      </button>
    </Can>
  );
}
