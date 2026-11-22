import type { Metadata } from "next";
import { WarehouseOperationsHub } from "@/components/warehouse-operations-hub";
import { getLots, getPurchaseOrders, getWarehouseTasks } from "@/lib/api";

export const metadata: Metadata = {
  title: "Warehouse Operations, Put-away & Pick/Pack | Ascentra ERP",
};

export default async function WarehousePage() {
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
