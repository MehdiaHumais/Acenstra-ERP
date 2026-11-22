import type { Metadata } from "next";
import { WarehouseOperationsHub } from "@/components/warehouse-operations-hub";
import { getLots, getPurchaseOrders, getWarehouseTasks } from "@/lib/api";

export const metadata: Metadata = {
  title: "Picking & Packing · Ascentra ERP",
  description:
    "Pick waves, FEFO batch allocation, barcode scan verification, catch-weight confirmation, packing checklist, SSCC-18 pallet labels, and dispatch staging.",
};

export default async function PickingPackingPage() {
  const [tasks, lots, purchaseOrders] = await Promise.all([
    getWarehouseTasks(),
    getLots(),
    getPurchaseOrders(),
  ]);

  return (
    <WarehouseOperationsHub
      tasks={tasks}
      lots={lots}
      purchaseOrders={purchaseOrders}
      defaultTab="picking"
    />
  );
}
