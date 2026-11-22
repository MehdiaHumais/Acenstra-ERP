import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { getDb } from "@/server/db/connection";
import { validateCustomerCredit } from "@/server/services/customer-order.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "orders.read");
    const db = getDb();

    // If customer user, return only their own account with no internal credit figures
    if (actor.role === "store_vendor" || actor.role === "store_user") {
      const cust = db.prepare(`
        SELECT id, name, segment, customer_type, city, payment_terms, status
        FROM customers
        WHERE id = ?
      `).get(actor.store_id || null) as any;

      if (!cust) {
        return NextResponse.json([]);
      }

      return NextResponse.json([{
        ...cust,
        credit_limit_cents: null,
        current_exposure_cents: 0,
        credit_evaluation: {
          credit_limit_cents: 0,
          current_exposure_cents: 0,
          projected_exposure_cents: 0,
          remaining_credit_cents: 0,
          unpaid_invoices_cents: 0,
          active_orders_cents: 0,
          credit_status: "clear",
          is_allowed: true,
          account_status: cust.status || "active",
          payment_terms: cust.payment_terms,
          reason: null
        }
      }]);
    }

    // Staff user: list all customers with credit limits and exposure
    const rows = db.prepare(`
      SELECT id, name, segment, customer_type, city, credit_limit_cents, current_exposure_cents,
             payment_terms, delivery_address, tax_id, status
      FROM customers
      ORDER BY name ASC
    `).all() as any[];

    const results = rows.map((c) => {
      const credit = validateCustomerCredit(actor, { customer_id: c.id, new_order_cents: 0 });
      return {
        ...c,
        credit_evaluation: credit
      };
    });

    return NextResponse.json(results);
  } catch (err) {
    return handleApiError(err);
  }
}
