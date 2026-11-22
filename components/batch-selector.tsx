"use client";

import { useRouter } from "next/navigation";
import type { Lot } from "@/lib/types";

export function BatchSelector({ lots, selected }: { lots: Lot[]; selected: number }) {
  const router = useRouter();

  return (
    <label className="flex items-center gap-2">
      <span className="field-label whitespace-nowrap">Trace batch</span>
      <select
        value={selected}
        onChange={(event) => router.push(`/traceability?batch=${event.target.value}`)}
        className="h-9 max-w-[15rem] rounded-lg border border-input bg-card px-2 text-xs font-medium outline-none"
      >
        {lots.map((lot) => (
          <option key={lot.id} value={lot.id}>
            {lot.batch_code} · {lot.product_name}
          </option>
        ))}
      </select>
    </label>
  );
}
