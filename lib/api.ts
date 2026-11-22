import {
  emptyDeliveries,
  emptyFinance,
  emptyInsights,
  emptyLots,
  emptyOrders,
  emptyOverview,
  emptyProducts,
  emptyStoreSummary,
  emptySuppliers,
  emptyTasks,
  emptyTemperature
} from "./empty-data";
import type {
  DashboardOverview,
  Delivery,
  FinanceSummary,
  Insight,
  Lot,
  Product,
  SalesOrder,
  StoreSummary,
  Supplier,
  TemperatureReading,
  TraceabilityResult,
  WarehouseTask
} from "./types";
import { listLots, listTemperatureReadings } from "@/server/services/inventory-fefo.service";
import {
  listPurchaseOrders,
  listSuppliers,
  type PurchaseOrderRecord
} from "@/server/services/master-data.service";
import {
  expectedLandedCostPipeline,
  listRfqs,
  listSupplierScorecards
} from "@/server/services/procurement.service";
import type { ProcurementRfq, SupplierScorecard } from "./procurement";
import { listProducts } from "@/server/services/product-master.service";
import { listOrders, listWarehouseTasks } from "@/server/services/orders-warehouse.service";
import { getBatchTraceability, listDeliveries } from "@/server/services/deliveries-traceability.service";
import {
  getDashboardOverview,
  getFinanceSummary,
  getStoreSummary as getStoreSummaryFromService,
  listAiInsights
} from "@/server/services/finance-analytics.service";
import { getDefaultAdminUser, listAuditEvents } from "@/server/security/auth";
import { listShipments, getShipmentDetail } from "@/server/services/inbound.service";
import type { InboundShipmentDetail } from "@/lib/inbound";

export async function getOverview(): Promise<DashboardOverview> {
  try {
    return getDashboardOverview();
  } catch {
    return emptyOverview;
  }
}

export async function getProducts(): Promise<Product[]> {
  try {
    return listProducts();
  } catch {
    return emptyProducts;
  }
}

export async function getSuppliers(): Promise<Supplier[]> {
  try {
    return listSuppliers();
  } catch {
    return emptySuppliers;
  }
}

export async function getSupplierScorecards(): Promise<SupplierScorecard[]> {
  try {
    return listSupplierScorecards();
  } catch {
    return emptySuppliers as SupplierScorecard[];
  }
}

export async function getProcurementRfqs(): Promise<ProcurementRfq[]> {
  try {
    return listRfqs();
  } catch {
    return [];
  }
}

export async function getProcurementPipeline(): Promise<{
  open_value_cents: number;
  open_landed_cents: number;
  pending_approval: number;
  asn_captured: number;
}> {
  try {
    return expectedLandedCostPipeline();
  } catch {
    return {
      open_value_cents: 0,
      open_landed_cents: 0,
      pending_approval: 0,
      asn_captured: 0
    };
  }
}

export async function getPurchaseOrders(): Promise<PurchaseOrderRecord[]> {
  try {
    return listPurchaseOrders();
  } catch {
    return [];
  }
}

export async function getInboundShipments() {
  try {
    const actor = getDefaultAdminUser();
    return listShipments(actor, { page: 1, limit: 50 }).shipments;
  } catch {
    return [];
  }
}

export async function getInboundShipmentDetail(id: string): Promise<InboundShipmentDetail | null> {
  try {
    const actor = getDefaultAdminUser();
    return getShipmentDetail(actor, id) as unknown as InboundShipmentDetail;
  } catch {
    return null;
  }
}

export async function getLots(): Promise<Lot[]> {
  try {
    return listLots();
  } catch {
    return emptyLots;
  }
}

export async function getWarehouseTasks(): Promise<WarehouseTask[]> {
  try {
    return listWarehouseTasks();
  } catch {
    return emptyTasks;
  }
}

export async function getOrders(): Promise<SalesOrder[]> {
  try {
    return listOrders();
  } catch {
    return emptyOrders;
  }
}

export async function getDeliveries(): Promise<Delivery[]> {
  try {
    return listDeliveries();
  } catch {
    return emptyDeliveries;
  }
}

export async function getTemperature(): Promise<TemperatureReading[]> {
  try {
    return listTemperatureReadings();
  } catch {
    return emptyTemperature;
  }
}

export async function getFinance(): Promise<FinanceSummary> {
  try {
    return getFinanceSummary();
  } catch {
    return emptyFinance;
  }
}

export async function getStoreSummary(): Promise<StoreSummary> {
  try {
    return getStoreSummaryFromService();
  } catch {
    return emptyStoreSummary;
  }
}

export async function getInsights(): Promise<Insight[]> {
  try {
    return listAiInsights();
  } catch {
    return emptyInsights;
  }
}

export async function getTraceability(batchId: number | string): Promise<TraceabilityResult | null> {
  try {
    return getBatchTraceability(batchId);
  } catch {
    return null;
  }
}

export async function getAuditEvents(limit = 30) {
  try {
    return listAuditEvents(limit);
  } catch {
    return [];
  }
}
