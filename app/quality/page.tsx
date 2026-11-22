import type { Metadata } from "next";
import { InboundQualityHub } from "@/components/inbound-quality-hub";
import {
  getInboundShipments,
  getProducts,
  getPurchaseOrders,
  getSuppliers,
} from "@/lib/api";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Quality Gate, HACCP & CAPA | Ascentra ERP",
};

export default async function QualityGatePage() {
  const [shipments, suppliers, products, purchaseOrders] = await Promise.all([
    getInboundShipments(),
    getSuppliers(),
    getProducts(),
    getPurchaseOrders(),
  ]);

  return (
    <InboundQualityHub
      initialShipments={shipments as any}
      suppliers={suppliers}
      products={products}
      purchaseOrders={purchaseOrders}
      defaultTab="quality"
    />
  );
}
