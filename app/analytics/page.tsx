import type { Metadata } from "next";
import { ManagementAiWorkbench } from "@/components/management-ai-workbench";

export const metadata: Metadata = {
  title: "Executive & AI Analytics | Ascentra ERP",
  description:
    "CEO Dashboard, Governed BI, Statistical Demand Forecasting, Operational Anomalies & Maker-Checker AI Actions",
};

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <ManagementAiWorkbench />
    </div>
  );
}
