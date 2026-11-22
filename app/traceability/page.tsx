import type { Metadata } from "next";
import { ExceptionsRecallWorkbench } from "@/components/exceptions-recall-workbench";

export const metadata: Metadata = {
  title: "Traceability, Exceptions & Recall | Ascentra ERP",
  description:
    "EU Reg 178/2002 Forward & Backward Lot Traceability, Mass-Balance Reconciliation, Quarantine Enforcement & Product Recalls",
};

export default function TraceabilityPage() {
  return (
    <div className="space-y-6">
      <ExceptionsRecallWorkbench />
    </div>
  );
}
