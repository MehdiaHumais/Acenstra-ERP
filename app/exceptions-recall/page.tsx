import type { Metadata } from "next";
import { ExceptionsRecallWorkbench } from "@/components/exceptions-recall-workbench";

export const metadata: Metadata = {
  title: "Exceptions & Recall Management | Ascentra ERP",
  description: "EU Reg 178/2002 Batch Traceability, Mass-Balance Reconciliation, Quarantine & Product Recalls",
};

export default function ExceptionsRecallPage() {
  return (
    <div className="space-y-6">
      <ExceptionsRecallWorkbench />
    </div>
  );
}
