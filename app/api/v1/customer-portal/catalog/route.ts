import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { getCustomerCatalog, validateCustomerCredit } from "@/server/services/customer-order.service";
import { getDb } from "@/server/db/connection";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "products.read");
    const { searchParams } = new URL(req.url);

    let customerId = searchParams.get("customer_id") || undefined;
    if (actor.role === "store_vendor" || actor.role === "store_user") {
      customerId = actor.store_id || undefined;
    }

    const category = searchParams.get("category") || undefined;
    const tempZone = searchParams.get("temp_zone") || undefined;
    const search = searchParams.get("search") || undefined;
    const warehouse = searchParams.get("warehouse") || undefined;

    const catalog = getCustomerCatalog(actor, {
      customer_id: customerId,
      category,
      temp_zone: tempZone,
      search,
      warehouse
    });

    // If customerId is resolved, also return customer summary and credit profile
    let customerProfile = null;
    if (customerId) {
      const db = getDb();
      const custRow = db.prepare(`SELECT * FROM customers WHERE id = ?`).get(customerId) as any;
      if (custRow) {
        const credit = validateCustomerCredit(actor, { customer_id: customerId, new_order_cents: 0 });
        customerProfile = {
          id: custRow.id,
          name: custRow.name,
          segment: custRow.segment,
          city: custRow.city,
          delivery_address: custRow.delivery_address,
          payment_terms: custRow.payment_terms,
          credit_limit_cents: credit.credit_limit_cents,
          current_exposure_cents: credit.current_exposure_cents,
          remaining_credit_cents: credit.remaining_credit_cents,
          credit_status: credit.credit_status,
          account_status: custRow.status
        };
      }
    }

    return NextResponse.json({
      customer: customerProfile,
      products: catalog,
      total_count: catalog.length
    });
  } catch (err) {
    return handleApiError(err);
  }
}
