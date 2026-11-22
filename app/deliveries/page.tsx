import type { Metadata } from "next";
import { DeliveriesFleetHub } from "@/components/deliveries-fleet-hub";
import { getDeliveries } from "@/lib/api";

export const metadata: Metadata = {
  title: "Deliveries, Fleet & POD | Ascentra ERP",
};

export default async function DeliveriesPage() {
  const deliveries = await getDeliveries();
  return <DeliveriesFleetHub deliveries={deliveries} defaultTab="workbench" />;
}
