import type { Metadata } from "next";
import { WarehouseInventoryHub } from "@/components/warehouse-inventory-hub";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Warehouse & Inventory · Put-away | Ascentra ERP",
  description:
    "Put approved goods into suitable warehouse bins. Track batches, expiry dates, locations and stock availability using FEFO.",
};

export default async function PutawayPage() {
  return <WarehouseInventoryHub defaultTab="putaway" />;
}
