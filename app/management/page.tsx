import type { Metadata } from "next";
import { ManagementAiWorkbench } from "@/components/management-ai-workbench";

export const metadata: Metadata = {
  title: "Management & AI Control Tower | Ascentra ERP",
  description: "CEO Dashboard, Governed BI, Statistical Forecasting, Operational Anomalies & Maker-Checker AI Actions",
};

export default function ManagementPage() {
  return (
    <div className="space-y-6">
      <ManagementAiWorkbench />
    </div>
  );
}
