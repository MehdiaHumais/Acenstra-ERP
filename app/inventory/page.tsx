import type { Metadata } from "next";
import { WarehouseInventoryHub } from "@/components/warehouse-inventory-hub";

export const metadata: Metadata = {
  title: "Warehouse & Inventory | Ascentra ERP",
  description:
    "Put approved goods into suitable warehouse bins. Track batches, expiry dates, locations and stock availability using FEFO.",
};

export default function InventoryPage() {
  return <WarehouseInventoryHub defaultTab="inventory" />;
}
