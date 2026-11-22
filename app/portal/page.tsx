import type { Metadata } from "next";
import { B2bPortalWorkbench } from "@/components/b2b-portal-workbench";
import { PageHeading } from "@/components/page-heading";
import { ViewOnlyBadge } from "@/components/access-gate";
import { Badge } from "@/components/ui";

export const metadata: Metadata = {
  title: "B2B Customer Ordering Portal | Ascentra ERP",
};

export default function CustomerPortalPage() {
  return (
    <div className="space-y-5">
      <PageHeading
        eyebrow="Customer Self-Service · B2B Ordering PWA"
        title="B2B Customer Ordering Portal"
        description="Dedicated customer-facing ordering portal with account-specific contract pricing, promotional & tiered volume discounts, live FEFO shelf-life availability, repeat ordering, and credit statement visibility."
        meta="Pricing precedence: Promotional Contract Price → Volume Tier Contract Price → Base Contract Price → Standard List Price."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ViewOnlyBadge modifyPermissions={["orders.manage", "orders:credit_override"]} />
            <Badge tone="ok" dot>
              Live FEFO Stock
            </Badge>
            <Badge tone="info">Contract Pricing Active</Badge>
          </div>
        }
      />

      <B2bPortalWorkbench />
    </div>
  );
}
