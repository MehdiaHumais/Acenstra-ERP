import type { Metadata } from "next";
import { ProductsProcurementHub } from "@/components/products-procurement-hub";
import {
  getProcurementPipeline,
  getProcurementRfqs,
  getProducts,
  getPurchaseOrders,
  getSuppliers,
  getSupplierScorecards,
} from "@/lib/api";

export const metadata: Metadata = {
  title: "Products & Procurement | Ascentra ERP",
  description:
    "Configure products, storage temperatures, shelf-life rules, UOM and catch-weight settings. Manage suppliers and create purchase orders.",
};

export default async function ProductsPage() {
  const [products, suppliers, supplierScorecards, purchaseOrders, rfqs, pipeline] =
    await Promise.all([
      getProducts(),
      getSuppliers(),
      getSupplierScorecards(),
      getPurchaseOrders(),
      getProcurementRfqs(),
      getProcurementPipeline(),
    ]);

  return (
    <ProductsProcurementHub
      products={products}
      suppliers={suppliers}
      supplierScorecards={supplierScorecards}
      rfqs={rfqs}
      purchaseOrders={purchaseOrders}
      pipeline={pipeline}
      defaultTab="products"
    />
  );
}
