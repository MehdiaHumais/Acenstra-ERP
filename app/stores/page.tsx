import type { Metadata } from "next";
import { PageHeading } from "@/components/page-heading";
import { ViewOnlyBadge } from "@/components/access-gate";
import { StoreMonitoringWorkbench } from "@/components/store-monitoring-workbench";
import { Badge } from "@/components/ui";

export const metadata: Metadata = {
  title: "Fast-Food Store & Vendor Monitoring | Ascentra ERP",
};

export default function StoresPage() {
  return (
    <div className="space-y-5">
      <PageHeading
        eyebrow="Franchise & Vendor Analytics"
        title="Store Monitoring"
        description="Partner fast-food stores view their purchases, deliveries, order history, spending and product analytics. Consumption is estimated unless actual POS or inventory data is integrated."
        meta="Strict RBAC store isolation enforced · Purchased vs. Delivered vs. Estimated vs. Actual POS Consumption clearly separated."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ViewOnlyBadge modifyPermissions={["stores.manage", "stores.export", "stores.pos.manage", "users.manage"]} />
            <Badge tone="ok" dot>
              Store Isolation Active
            </Badge>
            <Badge tone="info">Franchise Network</Badge>
          </div>
        }
      />

      <StoreMonitoringWorkbench />
    </div>
  );
}
