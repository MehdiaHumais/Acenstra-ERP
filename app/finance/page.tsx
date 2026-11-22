import type { Metadata } from "next";
import { FinanceSdiHub } from "@/components/finance-sdi-hub";
import { getFinance } from "@/lib/api";

export const metadata: Metadata = {
  title: "Finance & Italian E-Invoicing (SdI) | Ascentra ERP",
};

export default async function FinancePage() {
  const finance = await getFinance();
  return <FinanceSdiHub finance={finance} defaultTab="workbench" />;
}
