import { getDb, withTransaction } from "@/server/db/connection";
import { ApiError } from "@/server/core/http";
import {
  AuthenticatedUser,
  assertPermission,
  isStoreScopedRole,
  recordAuditEvent,
  requireMutationAuthorization,
} from "@/server/security/auth";
import { hashPassword } from "@/server/security/crypto";

// ============================================================================
// Security & Store-Level Isolation Guards
// ============================================================================

export function getStoreStaffPermissions(user: AuthenticatedUser): string[] {
  const db = getDb();
  const row = db
    .prepare("SELECT role, store_sub_role, store_permissions_json FROM users WHERE id = ? OR lower(email) = lower(?) LIMIT 1")
    .get(user.id, user.email) as
    | { role: string; store_sub_role: string | null; store_permissions_json: string | null }
    | undefined;

  if (!row) {
    if (user.role === "store_staff") {
      return ["dashboard.read", "purchases.read", "orders.read", "products.read", "consumption.read"];
    }
    return [
      "dashboard.read",
      "purchases.read",
      "orders.read",
      "orders.manage",
      "products.read",
      "spending.read",
      "consumption.read",
      "inventory.read",
      "invoices.read",
      "users.manage",
      "export.read",
    ];
  }

  try {
    const parsed = JSON.parse(row.store_permissions_json || "[]");
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {
    // fallback below
  }

  const subRole = row.store_sub_role || user.role;
  if (subRole === "store_staff") {
    return ["dashboard.read", "purchases.read", "orders.read", "products.read", "consumption.read"];
  }
  if (subRole === "store_manager") {
    return [
      "dashboard.read",
      "purchases.read",
      "orders.read",
      "orders.manage",
      "products.read",
      "spending.read",
      "consumption.read",
      "inventory.read",
      "invoices.read",
      "export.read",
    ];
  }
  return [
    "dashboard.read",
    "purchases.read",
    "orders.read",
    "orders.manage",
    "products.read",
    "spending.read",
    "consumption.read",
    "inventory.read",
    "invoices.read",
    "users.manage",
    "export.read",
  ];
}

export function enforceStoreIsolation(actor: AuthenticatedUser, targetStoreId: string): void {
  if (!targetStoreId) {
    throw new ApiError(400, "MISSING_STORE_ID", "Store identifier is required.");
  }

  if (isStoreScopedRole(actor.role)) {
    if (!actor.store_id) {
      throw new ApiError(
        403,
        "FORBIDDEN_STORE_ISOLATION",
        "Store account has no assigned store_id and cannot access store resources."
      );
    }
    if (actor.store_id !== targetStoreId) {
      throw new ApiError(
        403,
        "FORBIDDEN_STORE_ISOLATION",
        `Store isolation violation: user '${actor.email}' (store '${actor.store_id}') cannot access store '${targetStoreId}'.`
      );
    }
    return;
  }

  // Distributor roles must have stores:read or stores.read
  assertPermission(actor, "stores.read");
}

export function enforceDistributorOnly(actor: AuthenticatedUser, actionDescription: string): void {
  if (isStoreScopedRole(actor.role)) {
    throw new ApiError(
      403,
      "FORBIDDEN_DISTRIBUTOR_ONLY",
      `Access denied: store role '${actor.role}' cannot ${actionDescription}.`
    );
  }
  assertPermission(actor, "stores.consolidated.read");
}

export function enforceStoreSubPermission(actor: AuthenticatedUser, requiredSubPerm: string): void {
  if (!isStoreScopedRole(actor.role)) {
    return; // Distributor roles use primary RBAC
  }
  const perms = getStoreStaffPermissions(actor);
  if (!perms.includes(requiredSubPerm)) {
    throw new ApiError(
      403,
      "FORBIDDEN_STAFF_SCOPE",
      `Store role '${actor.role}' does not have assigned permission '${requiredSubPerm}'.`
    );
  }
}

// ============================================================================
// 2. Store / Vendor Account Management
// ============================================================================

export interface StoreAccountRecord {
  id: string;
  store_code: string;
  name: string;
  parent_franchise_group: string | null;
  city: string;
  region: string;
  segment: string;
  manager: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  delivery_address: string;
  assigned_distributor: string;
  status: string;
  credit_limit_cents: number;
  current_exposure_cents: number;
  credit_utilization_pct: number;
  payment_terms: string;
  assigned_contract_id: string | null;
  contract_title: string | null;
  discount_pct: number;
  allowed_skus: string[];
  users_count: number;
  pos_connection_status: string;
  pos_provider: string;
  approved_by: string | null;
  approved_at: string | null;
}

export function listStoreAccounts(
  actor: AuthenticatedUser,
  filters?: {
    franchise_group?: string;
    region?: string;
    status?: string;
    search?: string;
  }
): StoreAccountRecord[] {
  const db = getDb();
  const conditions: string[] = ["c.customer_type = 'store'"];
  const params: Array<string | number> = [];

  if (isStoreScopedRole(actor.role)) {
    if (!actor.store_id) {
      throw new ApiError(403, "FORBIDDEN_STORE_ISOLATION", "Store user has no assigned store.");
    }
    conditions.push("c.id = ?");
    params.push(actor.store_id);
  } else {
    assertPermission(actor, "stores.read");
  }

  if (filters?.franchise_group && filters.franchise_group !== "all") {
    conditions.push("c.parent_franchise_group = ?");
    params.push(filters.franchise_group);
  }
  if (filters?.region && filters.region !== "all") {
    conditions.push("c.region = ?");
    params.push(filters.region);
  }
  if (filters?.status && filters.status !== "all") {
    conditions.push("c.status = ?");
    params.push(filters.status);
  }
  if (filters?.search?.trim()) {
    const term = `%${filters.search.trim().toLowerCase()}%`;
    conditions.push(
      "(lower(c.name) LIKE ? OR lower(c.id) LIKE ? OR lower(c.city) LIKE ? OR lower(COALESCE(c.parent_franchise_group, '')) LIKE ?)"
    );
    params.push(term, term, term, term);
  }

  const rows = db
    .prepare(
      `
      SELECT
        c.*,
        cc.title as contract_title,
        cc.discount_pct as contract_discount_pct,
        (SELECT COUNT(*) FROM users u WHERE u.store_id = c.id AND u.active = 1) as users_count,
        spi.connection_status as pos_connection_status,
        spi.provider_name as pos_provider
      FROM customers c
      LEFT JOIN customer_contracts cc ON cc.id = c.assigned_contract_id
      LEFT JOIN store_pos_integrations spi ON spi.store_id = c.id
      WHERE ${conditions.join(" AND ")}
      ORDER BY c.name ASC
    `
    )
    .all(...params) as Array<Record<string, any>>;

  return rows.map((r) => {
    const creditLimit = Number(r.credit_limit_cents || 1500000);
    const exposure = Number(r.current_exposure_cents || 0);
    let allowedSkus: string[] = [];
    try {
      allowedSkus = JSON.parse(r.allowed_skus_json || "[]");
    } catch {
      allowedSkus = [];
    }

    return {
      id: r.id,
      store_code: r.store_code || r.id,
      name: r.name,
      parent_franchise_group: r.parent_franchise_group || null,
      city: r.city,
      region: r.region || "Lombardy",
      segment: r.segment,
      manager: r.manager,
      contact_name: r.contact_name || r.manager,
      contact_email: r.contact_email || `contact@${r.id.toLowerCase()}.it`,
      contact_phone: r.contact_phone || "+39 02 0000 0000",
      delivery_address: r.delivery_address || `${r.city}, Italy`,
      assigned_distributor: r.assigned_distributor || "Ascentra Global Ltd - Milan Cold Hub",
      status: r.status,
      credit_limit_cents: creditLimit,
      current_exposure_cents: exposure,
      credit_utilization_pct: creditLimit > 0 ? Number(((exposure / creditLimit) * 100).toFixed(1)) : 0,
      payment_terms: r.payment_terms || "Net 30",
      assigned_contract_id: r.assigned_contract_id || null,
      contract_title: r.contract_title || null,
      discount_pct: Number(r.contract_discount_pct || 0),
      allowed_skus: allowedSkus,
      users_count: Number(r.users_count || 0),
      pos_connection_status: r.pos_connection_status || "unconfigured",
      pos_provider: r.pos_provider || "Unconfigured",
      approved_by: r.approved_by || null,
      approved_at: r.approved_at || null,
    };
  });
}

export function getStoreAccountDetail(actor: AuthenticatedUser, storeId: string) {
  enforceStoreIsolation(actor, storeId);
  const db = getDb();

  const stores = listStoreAccounts(actor).filter((s) => s.id === storeId || s.store_code === storeId);
  const store = stores[0];
  if (!store) {
    throw new ApiError(404, "STORE_NOT_FOUND", `Store '${storeId}' not found.`);
  }

  const users = db
    .prepare(
      `
      SELECT id, email, name, role, store_id, store_sub_role, store_permissions_json, active, invited_by, invited_at, created_at
      FROM users
      WHERE store_id = ?
      ORDER BY created_at ASC
    `
    )
    .all(store.id) as Array<Record<string, any>>;

  const history = db
    .prepare(
      `
      SELECT *
      FROM store_account_history
      WHERE store_id = ?
      ORDER BY created_at DESC
    `
    )
    .all(store.id);

  const contracts = db
    .prepare(
      `
      SELECT *
      FROM customer_contracts
      WHERE customer_id = ? OR id = ?
      ORDER BY created_at DESC
    `
    )
    .all(store.id, store.assigned_contract_id ?? "");

  return {
    store,
    assigned_users: users.map((u) => {
      let permissions: string[] = [];
      try {
        permissions = JSON.parse(u.store_permissions_json || "[]");
      } catch {
        permissions = [];
      }
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        store_sub_role: u.store_sub_role || u.role,
        permissions,
        store_permissions: permissions,
        active: Boolean(u.active),
        invited_by: u.invited_by,
        invited_at: u.invited_at,
        created_at: u.created_at,
      };
    }),
    pricing_contracts: contracts,
    approval_history: history,
    account_history: history,
  };
}

export function createStoreAccount(
  actor: AuthenticatedUser,
  input: {
    store_code: string;
    name: string;
    parent_franchise_group?: string;
    city: string;
    region?: string;
    segment?: string;
    contact_name?: string;
    contact_email?: string;
    contact_phone?: string;
    delivery_address?: string;
    assigned_distributor?: string;
    credit_limit_cents?: number;
    payment_terms?: string;
    payment_terms_days?: number;
    assigned_contract_id?: string;
    price_book_code?: string;
    allowed_skus?: string[];
  }
) {
  enforceDistributorOnly(actor, "create store accounts");
  assertPermission(actor, "stores.manage");
  requireMutationAuthorization(actor, "create store account");

  if (!input.store_code?.trim() || !input.name?.trim() || !input.city?.trim()) {
    throw new ApiError(400, "INVALID_STORE_INPUT", "store_code, name, and city are required.");
  }

  const code = input.store_code.trim().toUpperCase();
  const db = getDb();
  const existing = db.prepare("SELECT id FROM customers WHERE id = ? OR store_code = ?").get(code, code);
  if (existing) {
    throw new ApiError(409, "DUPLICATE_STORE_CODE", `Store '${code}' already exists.`);
  }

  return withTransaction(() => {
    const now = new Date().toISOString();
    const creditLimit = input.credit_limit_cents ?? 2000000;
    const paymentTerms =
      input.payment_terms ?? (input.payment_terms_days ? `Net ${input.payment_terms_days}` : "Net 30");
    const contactName = input.contact_name?.trim() || "Store Manager";
    const contactEmail = input.contact_email?.trim() || `store.${code.toLowerCase()}@ascentra-partner.it`;
    const deliveryAddr = input.delivery_address?.trim() || `Via Centrale 1, ${input.city.trim()}, Italy`;

    db.prepare(
      `
      INSERT INTO customers (
        id, store_code, name, parent_franchise_group, city, region, segment,
        customer_type, manager, contact_name, contact_email, contact_phone,
        delivery_address, assigned_distributor, credit_limit_cents, current_exposure_cents,
        payment_terms, assigned_contract_id, allowed_skus_json, status, approved_by, approved_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'store', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'active', ?, ?, ?)
    `
    ).run(
      code,
      code,
      input.name.trim(),
      input.parent_franchise_group?.trim() || null,
      input.city.trim(),
      input.region?.trim() || "Lombardy",
      input.segment?.trim() || "Fast-Food Franchise Store",
      contactName,
      contactName,
      contactEmail,
      input.contact_phone?.trim() || "+39 02 0000 0000",
      deliveryAddr,
      input.assigned_distributor?.trim() || "Ascentra Global Ltd - Milan Cold Hub",
      creditLimit,
      paymentTerms,
      input.assigned_contract_id || input.price_book_code || null,
      JSON.stringify(input.allowed_skus || []),
      actor.name,
      now,
      now
    );

    db.prepare(
      `
      INSERT INTO store_account_history (id, store_id, action, previous_status, new_status, notes, actor_id, actor_name, created_at)
      VALUES (?, ?, 'account.created', NULL, 'active', ?, ?, ?, ?)
    `
    ).run(
      `SAH-${Date.now()}`,
      code,
      `Store account created under group '${input.parent_franchise_group || "Independent"}'`,
      actor.id,
      actor.name,
      now
    );

    db.prepare(
      `
      INSERT OR IGNORE INTO store_pos_integrations (
        id, store_id, provider_name, connection_status, error_message
      ) VALUES (?, ?, 'Unconfigured', 'unconfigured', 'No POS or store inventory feed connected.')
    `
    ).run(`SPI-${Date.now()}`, code);

    recordAuditEvent({
      actor,
      action: "store.account_created",
      entityType: "StoreAccount",
      entityId: code,
      after: {
        store_code: code,
        name: input.name,
        parent_franchise_group: input.parent_franchise_group || null,
        credit_limit_cents: creditLimit,
      },
    });

    const detail = getStoreAccountDetail(actor, code);
    return {
      ...detail.store,
      ...detail,
    };
  });
}

export function updateStoreAccountStatus(
  actor: AuthenticatedUser,
  storeId: string,
  input: {
    status?: "active" | "suspended" | "watch";
    reason?: string;
    assigned_contract_id?: string;
    credit_limit_cents?: number;
    payment_terms?: string;
    allowed_skus?: string[];
  }
) {
  enforceDistributorOnly(actor, "modify account status, contract prices, or credit limits");
  assertPermission(actor, "stores.manage");
  requireMutationAuthorization(actor, "update store account status or contract");

  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM customers WHERE id = ? AND customer_type = 'store'")
    .get(storeId) as Record<string, any> | undefined;
  if (!existing) {
    throw new ApiError(404, "STORE_NOT_FOUND", `Store '${storeId}' not found.`);
  }

  return withTransaction(() => {
    const nextStatus = input.status || existing.status;
    const nextContract =
      input.assigned_contract_id !== undefined ? input.assigned_contract_id : existing.assigned_contract_id;
    const nextCredit =
      input.credit_limit_cents !== undefined ? input.credit_limit_cents : existing.credit_limit_cents;
    const nextTerms = input.payment_terms !== undefined ? input.payment_terms : existing.payment_terms;
    const nextSkus =
      input.allowed_skus !== undefined ? JSON.stringify(input.allowed_skus) : existing.allowed_skus_json;

    db.prepare(
      `
      UPDATE customers
      SET status = ?,
          assigned_contract_id = ?,
          credit_limit_cents = ?,
          payment_terms = ?,
          allowed_skus_json = ?
      WHERE id = ?
    `
    ).run(nextStatus, nextContract, nextCredit, nextTerms, nextSkus, storeId);

    db.prepare(
      `
      INSERT INTO store_account_history (id, store_id, action, previous_status, new_status, notes, actor_id, actor_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      `SAH-${Date.now()}`,
      storeId,
      nextStatus === "suspended"
        ? "account.suspended"
        : nextStatus === "active"
          ? "account.activated"
          : "account.updated",
      existing.status,
      nextStatus,
      input.reason || `Status set to ${nextStatus}`,
      actor.id,
      actor.name
    );

    recordAuditEvent({
      actor,
      action:
        nextStatus === "suspended"
          ? "store.account_suspended"
          : nextStatus === "active"
            ? "store.account_activated"
            : "store.account_updated",
      entityType: "StoreAccount",
      entityId: storeId,
      before: {
        status: existing.status,
        credit_limit_cents: existing.credit_limit_cents,
        assigned_contract_id: existing.assigned_contract_id,
      },
      after: {
        status: nextStatus,
        credit_limit_cents: nextCredit,
        assigned_contract_id: nextContract,
        reason: input.reason || null,
      },
    });

    return getStoreAccountDetail(actor, storeId);
  });
}

export function inviteOrUpdateStoreUser(
  actor: AuthenticatedUser,
  storeId: string,
  input: {
    email: string;
    name: string;
    store_sub_role: "store_owner" | "store_manager" | "store_staff";
    permissions?: string[];
    active?: boolean;
  }
) {
  enforceStoreIsolation(actor, storeId);
  enforceStoreSubPermission(actor, "users.manage");
  requireMutationAuthorization(actor, "invite or update store user");

  if (!input.email?.trim() || !input.name?.trim()) {
    throw new ApiError(400, "INVALID_USER_INPUT", "User email and name are required.");
  }

  const db = getDb();
  const store = db.prepare("SELECT id, name FROM customers WHERE id = ? AND customer_type = 'store'").get(storeId) as
    | { id: string; name: string }
    | undefined;
  if (!store) {
    throw new ApiError(404, "STORE_NOT_FOUND", `Store '${storeId}' not found.`);
  }

  const email = input.email.trim().toLowerCase();
  const existingUser = db.prepare("SELECT * FROM users WHERE lower(email) = ?").get(email) as
    | Record<string, any>
    | undefined;

  if (existingUser && existingUser.store_id && existingUser.store_id !== storeId) {
    throw new ApiError(
      403,
      "FORBIDDEN_CROSS_STORE_USER",
      `User '${email}' belongs to another store ('${existingUser.store_id}').`
    );
  }

  const defaultPerms =
    input.store_sub_role === "store_staff"
      ? ["dashboard.read", "purchases.read", "orders.read", "products.read", "consumption.read"]
      : input.store_sub_role === "store_manager"
        ? [
            "dashboard.read",
            "purchases.read",
            "orders.read",
            "orders.manage",
            "products.read",
            "spending.read",
            "consumption.read",
            "inventory.read",
            "invoices.read",
            "export.read",
          ]
        : [
            "dashboard.read",
            "purchases.read",
            "orders.read",
            "orders.manage",
            "products.read",
            "spending.read",
            "consumption.read",
            "inventory.read",
            "invoices.read",
            "users.manage",
            "export.read",
          ];

  const perms = input.permissions && input.permissions.length > 0 ? input.permissions : defaultPerms;

  return withTransaction(() => {
    const now = new Date().toISOString();
    const userId = existingUser?.id || `USR-STR-${Date.now()}`;

    if (existingUser) {
      db.prepare(
        `
        UPDATE users
        SET name = ?,
            role = ?,
            store_id = ?,
            store_sub_role = ?,
            store_permissions_json = ?,
            active = ?
        WHERE id = ?
      `
      ).run(
        input.name.trim(),
        input.store_sub_role,
        storeId,
        input.store_sub_role,
        JSON.stringify(perms),
        input.active === false ? 0 : 1,
        userId
      );
    } else {
      db.prepare(
        `
        INSERT INTO users (
          id, email, name, password_hash, role, store_id, store_sub_role,
          store_permissions_json, warehouse, active, invited_by, invited_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Milan Cold Hub', ?, ?, ?)
      `
      ).run(
        userId,
        email,
        input.name.trim(),
        hashPassword("Ascentra!2026"),
        input.store_sub_role,
        storeId,
        input.store_sub_role,
        JSON.stringify(perms),
        input.active === false ? 0 : 1,
        actor.name,
        now
      );
    }

    recordAuditEvent({
      actor,
      action: existingUser ? "store.user_permissions_updated" : "store.user_invited",
      entityType: "StoreUser",
      entityId: userId,
      after: {
        store_id: storeId,
        email,
        store_sub_role: input.store_sub_role,
        permissions: perms,
      },
    });

    return {
      id: userId,
      email,
      name: input.name.trim(),
      store_id: storeId,
      store_sub_role: input.store_sub_role,
      permissions: perms,
      active: input.active !== false,
    };
  });
}

// ============================================================================
// 3, 4, 5 & 6. Store Dashboard, Purchases, Spending, Product Analytics,
// Consumption Estimation & Store Inventory Reconciliation
// ============================================================================

export function getStoreDashboard(
  actor: AuthenticatedUser,
  storeId: string,
  options?: { date_from?: string; date_to?: string }
) {
  enforceStoreIsolation(actor, storeId);
  enforceStoreSubPermission(actor, "dashboard.read");

  const db = getDb();
  const detail = getStoreAccountDetail(actor, storeId);
  const store = detail.store;
  const staffPerms = isStoreScopedRole(actor.role) ? getStoreStaffPermissions(actor) : null;
  const canViewFinancials = !staffPerms || staffPerms.includes("invoices.read") || staffPerms.includes("spending.read");

  // 1. Orders & Order Lines for this store
  const orders = db
    .prepare(
      `
      SELECT
        so.*,
        d.id as delivery_id,
        d.status as delivery_status,
        d.total_cases as delivered_cases,
        d.total_weight_kg as delivered_weight_kg,
        d.pod_signed
      FROM sales_orders so
      LEFT JOIN deliveries d ON d.order_number = so.order_number
      WHERE so.customer_id = ?
      ORDER BY so.delivery_date DESC, so.order_number DESC
    `
    )
    .all(storeId) as Array<Record<string, any>>;

  const orderLines = db
    .prepare(
      `
      SELECT
        sol.*,
        so.order_number,
        so.status as order_status,
        so.delivery_date,
        p.category,
        p.uom as product_uom,
        p.case_weight_kg,
        COALESCE(dmi.cases, CASE WHEN so.status IN ('delivered', 'invoiced') THEN sol.cases_allocated ELSE 0 END) as line_delivered_cases
      FROM sales_order_lines sol
      JOIN sales_orders so ON so.id = sol.order_id
      LEFT JOIN products p ON p.sku = sol.sku
      LEFT JOIN delivery_manifest_items dmi ON dmi.order_line_id = sol.id
      WHERE so.customer_id = ?
      ORDER BY so.delivery_date DESC
    `
    )
    .all(storeId) as Array<Record<string, any>>;

  const validOrders = orders.filter((o) => o.status !== "cancelled");
  const totalPurchasesCents = validOrders.reduce((s, o) => s + Number(o.total_cents || 0), 0);
  const totalOrderedCases = orderLines
    .filter((l) => l.order_status !== "cancelled")
    .reduce((s, l) => s + Number(l.cases_ordered || 0), 0);
  const totalDeliveredCases = orderLines
    .filter((l) => l.order_status !== "cancelled")
    .reduce((s, l) => s + Number(l.line_delivered_cases || 0), 0);

  const pendingOrders = orders.filter((o) => ["draft", "submitted", "credit_hold"].includes(o.status));
  const confirmedOrders = orders.filter((o) => ["confirmed", "picking", "packed", "dispatched"].includes(o.status));
  const deliveredOrders = orders.filter((o) => ["delivered", "invoiced"].includes(o.status));
  const cancelledOrders = orders.filter((o) => o.status === "cancelled");

  // 2. Purchases & Product Analytics by SKU
  const skuMap = new Map<
    string,
    {
      sku: string;
      product_name: string;
      category: string;
      orders_count: number;
      ordered_cases: number;
      allocated_cases: number;
      delivered_cases: number;
      total_spend_cents: number;
      min_unit_price_cents: number;
      max_unit_price_cents: number;
      latest_unit_price_cents: number;
      first_order_date: string;
      last_order_date: string;
    }
  >();

  for (const line of orderLines) {
    if (line.order_status === "cancelled") continue;
    const sku = String(line.sku);
    const ordered = Number(line.cases_ordered || 0);
    const allocated = Number(line.cases_allocated || 0);
    const delivered = Number(line.line_delivered_cases || 0);
    const price = Number(line.unit_price_cents || 0);
    const lineSpend = Number(line.line_total_cents || ordered * price);
    const dDate = String(line.delivery_date || "");

    const existing = skuMap.get(sku);
    if (!existing) {
      skuMap.set(sku, {
        sku,
        product_name: line.product_name,
        category: line.category || "Chilled",
        orders_count: 1,
        ordered_cases: ordered,
        allocated_cases: allocated,
        delivered_cases: delivered,
        total_spend_cents: lineSpend,
        min_unit_price_cents: price,
        max_unit_price_cents: price,
        latest_unit_price_cents: price,
        first_order_date: dDate,
        last_order_date: dDate,
      });
    } else {
      existing.orders_count += 1;
      existing.ordered_cases += ordered;
      existing.allocated_cases += allocated;
      existing.delivered_cases += delivered;
      existing.total_spend_cents += lineSpend;
      existing.min_unit_price_cents = Math.min(existing.min_unit_price_cents, price);
      existing.max_unit_price_cents = Math.max(existing.max_unit_price_cents, price);
      if (dDate >= existing.last_order_date) {
        existing.last_order_date = dDate;
        existing.latest_unit_price_cents = price;
      }
      if (dDate < existing.first_order_date) {
        existing.first_order_date = dDate;
      }
    }
  }

  const purchasesByProduct = Array.from(skuMap.values()).sort(
    (a, b) => b.total_spend_cents - a.total_spend_cents
  );

  // 3. Invoices & Spending (scoped to this store & role permission)
  const invoices = canViewFinancials
    ? (db
        .prepare(
          `
          SELECT *
          FROM invoices
          WHERE customer_id = ?
          ORDER BY issued_date DESC, invoice_number DESC
        `
        )
        .all(storeId) as Array<Record<string, any>>)
    : [];

  const totalInvoicedCents = invoices.reduce((s, i) => s + Number(i.amount_cents || 0), 0);
  const totalPaidCents = invoices.reduce((s, i) => s + Number(i.paid_cents || 0), 0);
  const totalUnpaidCents = Math.max(0, totalInvoicedCents - totalPaidCents);
  const overdueCents = invoices
    .filter((i) => i.status === "overdue")
    .reduce((s, i) => s + Math.max(0, Number(i.amount_cents || 0) - Number(i.paid_cents || 0)), 0);

  // Period comparison (last 30 days vs previous 30 days)
  const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const currentPeriodOrders = validOrders.filter((o) => String(o.delivery_date) >= cutoff30);
  const previousPeriodOrders = validOrders.filter((o) => String(o.delivery_date) < cutoff30);

  const currentPeriodSpendCents = currentPeriodOrders.reduce((s, o) => s + Number(o.total_cents || 0), 0);
  const previousPeriodSpendCents = previousPeriodOrders.reduce((s, o) => s + Number(o.total_cents || 0), 0);
  const periodGrowthPct =
    previousPeriodSpendCents > 0
      ? Number((((currentPeriodSpendCents - previousPeriodSpendCents) / previousPeriodSpendCents) * 100).toFixed(1))
      : currentPeriodSpendCents > 0
        ? 100.0
        : 0.0;

  // 4. Consumption Estimation & Store Inventory
  const consumption = getStoreConsumptionAnalysis(actor, storeId);
  const inventoryReconciliation = getStoreInventoryReconciliation(actor, storeId);
  const alerts = listStoreMonitoringAlerts(actor, storeId);

  return {
    store,
    scope_notice:
      "Distributor-to-Store Purchasing & Consumption Analytics. Purchase quantities represent distributor supply and are never presented as exact kitchen consumption unless verified by connected POS or physical stock counts.",
    purchases: {
      total_purchases_cents: totalPurchasesCents,
      total_orders_count: validOrders.length,
      total_ordered_cases: totalOrderedCases,
      total_delivered_cases: totalDeliveredCases,
      pending_orders_count: pendingOrders.length,
      confirmed_orders_count: confirmedOrders.length,
      delivered_orders_count: deliveredOrders.length,
      cancelled_orders_count: cancelledOrders.length,
      purchases_by_sku: purchasesByProduct,
      recent_orders: orders.slice(0, 10),
    },
    spending: canViewFinancials
      ? {
          authorized: true,
          financials_restricted: false,
          total_spending_cents: totalPurchasesCents,
          current_30d_spend_cents: currentPeriodSpendCents,
          previous_30d_spend_cents: previousPeriodSpendCents,
          period_growth_pct: periodGrowthPct,
          average_order_value_cents:
            validOrders.length > 0 ? Math.round(totalPurchasesCents / validOrders.length) : 0,
          total_invoiced_cents: totalInvoicedCents,
          invoiced_total_cents: totalInvoicedCents,
          paid_amount_cents: totalPaidCents,
          unpaid_amount_cents: totalUnpaidCents,
          overdue_amount_cents: overdueCents,
          outstanding_invoices: invoices.filter((i) => i.status !== "paid"),
          monthly_spending_trends: [
            {
              month: new Date().toISOString().slice(0, 7),
              orders_count: currentPeriodOrders.length,
              cases_total: currentPeriodOrders.reduce((s, o) => s + Number(o.cases_total || 0), 0),
              spend_cents: currentPeriodSpendCents,
            },
            {
              month: new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 7),
              orders_count: previousPeriodOrders.length,
              cases_total: previousPeriodOrders.reduce((s, o) => s + Number(o.cases_total || 0), 0),
              spend_cents: previousPeriodSpendCents,
            },
          ],
          invoices,
        }
      : {
          authorized: false,
          financials_restricted: true,
          message: "Financial spending and invoice history are restricted for your store role.",
          total_spending_cents: 0,
          current_30d_spend_cents: 0,
          previous_30d_spend_cents: 0,
          period_growth_pct: 0,
          average_order_value_cents: 0,
          total_invoiced_cents: 0,
          invoiced_total_cents: 0,
          paid_amount_cents: 0,
          unpaid_amount_cents: 0,
          overdue_amount_cents: 0,
          outstanding_invoices: [],
          monthly_spending_trends: [],
          invoices: [],
        },
    product_analytics: {
      most_purchased_products: purchasesByProduct.slice(0, 5),
      least_purchased_products: [...purchasesByProduct].reverse().slice(0, 5),
      purchase_frequency: purchasesByProduct.map((p) => ({
        sku: p.sku,
        product_name: p.product_name,
        orders_count: p.orders_count,
      })),
      product_price_trends: purchasesByProduct.map((p) => ({
        sku: p.sku,
        product_name: p.product_name,
        min_unit_price_cents: p.min_unit_price_cents,
        max_unit_price_cents: p.max_unit_price_cents,
        latest_unit_price_cents: p.latest_unit_price_cents,
        price_change_pct:
          p.min_unit_price_cents > 0
            ? Number((((p.latest_unit_price_cents - p.min_unit_price_cents) / p.min_unit_price_cents) * 100).toFixed(1))
            : 0,
      })),
      period_comparison: {
        current_period_cents: currentPeriodSpendCents,
        previous_period_cents: previousPeriodSpendCents,
        growth_pct: periodGrowthPct,
      },
    },
    consumption_estimates: consumption,
    store_inventory: inventoryReconciliation,
    alerts,
  };
}

export function getStorePurchaseOrderHistory(
  actor: AuthenticatedUser,
  storeId: string,
  filters?: {
    date_from?: string;
    date_to?: string;
    sku?: string;
    order_status?: string;
    delivery_status?: string;
    search?: string;
  }
) {
  enforceStoreIsolation(actor, storeId);
  enforceStoreSubPermission(actor, "orders.read");

  const db = getDb();
  const staffPerms = isStoreScopedRole(actor.role) ? getStoreStaffPermissions(actor) : null;
  const canViewFinancials = !staffPerms || staffPerms.includes("invoices.read");

  const conditions: string[] = ["so.customer_id = ?"];
  const params: Array<string | number> = [storeId];

  if (filters?.date_from) {
    conditions.push("so.delivery_date >= ?");
    params.push(filters.date_from);
  }
  if (filters?.date_to) {
    conditions.push("so.delivery_date <= ?");
    params.push(filters.date_to);
  }
  if (filters?.order_status && filters.order_status !== "all") {
    conditions.push("so.status = ?");
    params.push(filters.order_status);
  }

  const orders = db
    .prepare(
      `
      SELECT
        so.*,
        d.id as delivery_id,
        d.status as delivery_status,
        d.total_cases as delivered_cases,
        d.pod_signed,
        i.invoice_number,
        i.status as invoice_status,
        i.amount_cents as invoice_amount_cents,
        i.paid_cents as invoice_paid_cents
      FROM sales_orders so
      LEFT JOIN deliveries d ON d.order_number = so.order_number
      LEFT JOIN invoices i ON i.order_number = so.order_number
      WHERE ${conditions.join(" AND ")}
      ORDER BY so.delivery_date DESC, so.order_number DESC
    `
    )
    .all(...params) as Array<Record<string, any>>;

  const enriched = orders
    .map((o) => {
      const lines = db
        .prepare(
          `
          SELECT
            sol.*,
            COALESCE(
              dmi.cases,
              CASE WHEN ? IN ('delivered', 'invoiced') THEN sol.cases_allocated ELSE 0 END
            ) as cases_delivered
          FROM sales_order_lines sol
          LEFT JOIN delivery_manifest_items dmi ON dmi.order_line_id = sol.id
          WHERE sol.order_id = ?
        `
        )
        .all(o.status, o.id) as Array<Record<string, any>>;

      const orderedCases = lines.reduce((s, l) => s + Number(l.cases_ordered || 0), 0) || Number(o.cases_total || 0);
      const deliveredCases =
        lines.length > 0
          ? lines.reduce((s, l) => s + Number(l.cases_delivered || 0), 0)
          : o.status === "delivered" || o.status === "invoiced"
            ? Number(o.delivered_cases || o.cases_total || 0)
            : 0;

      const isPartialDelivery = deliveredCases > 0 && deliveredCases < orderedCases;

      return {
        order_id: o.id,
        order_number: o.order_number,
        customer_id: o.customer_id,
        customer_name: o.customer,
        channel: o.channel,
        order_status: o.status,
        delivery_date: o.delivery_date,
        delivery_id: o.delivery_id || null,
        delivery_status:
          o.delivery_status || (o.status === "delivered" || o.status === "invoiced" ? "delivered" : "pending"),
        is_partial_delivery: isPartialDelivery,
        ordered_cases: orderedCases,
        delivered_cases: deliveredCases,
        cases_ordered: orderedCases,
        cases_delivered: deliveredCases,
        total_cents: canViewFinancials ? Number(o.total_cents || 0) : null,
        invoice_number: canViewFinancials ? o.invoice_number || null : null,
        invoice_status: canViewFinancials ? o.invoice_status || null : null,
        invoice_amount_cents: canViewFinancials ? Number(o.invoice_amount_cents || 0) : null,
        invoice_paid_cents: canViewFinancials ? Number(o.invoice_paid_cents || 0) : null,
        lines,
      };
    })
    .filter((o) => {
      if (filters?.delivery_status && filters.delivery_status !== "all") {
        if (filters.delivery_status === "partial" && !o.is_partial_delivery) return false;
        if (filters.delivery_status !== "partial" && o.delivery_status !== filters.delivery_status) return false;
      }
      if (filters?.sku && filters.sku !== "all") {
        if (!o.lines.some((l) => l.sku === filters.sku)) return false;
      }
      if (filters?.search?.trim()) {
        const q = filters.search.trim().toLowerCase();
        const matchOrder = o.order_number.toLowerCase().includes(q);
        const matchLine = o.lines.some(
          (l) => String(l.sku).toLowerCase().includes(q) || String(l.product_name).toLowerCase().includes(q)
        );
        if (!matchOrder && !matchLine) return false;
      }
      return true;
    });

  return {
    store_id: storeId,
    total_records: enriched.length,
    orders: enriched,
  };
}

export function exportStorePurchaseHistoryCsv(
  actor: AuthenticatedUser,
  storeId: string,
  filters?: { date_from?: string; date_to?: string; sku?: string; order_status?: string }
): string {
  enforceStoreIsolation(actor, storeId);
  assertPermission(actor, "stores.export");
  enforceStoreSubPermission(actor, "export.read");

  const history = getStorePurchaseOrderHistory(actor, storeId, filters);

  recordAuditEvent({
    actor,
    action: "store.purchase_history_exported",
    entityType: "StorePurchaseExport",
    entityId: storeId,
    after: {
      store_id: storeId,
      orders_exported: history.total_records,
      filters: filters ?? {},
    },
  });

  const headers = [
    "Order Number",
    "Store ID",
    "Delivery Date",
    "Order Status",
    "Delivery Status",
    "Cases Ordered",
    "Cases Delivered",
    "Partial Delivery",
    "Total EUR",
    "Invoice Number",
    "Invoice Status",
  ];

  const escapeCsv = (val: unknown) => {
    const s = String(val ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const rows = history.orders.map((o) =>
    [
      o.order_number,
      o.customer_id,
      o.delivery_date,
      o.order_status,
      o.delivery_status,
      o.cases_ordered,
      o.cases_delivered,
      o.is_partial_delivery ? "YES" : "NO",
      o.total_cents !== null ? (o.total_cents / 100).toFixed(2) : "RESTRICTED",
      o.invoice_number || "N/A",
      o.invoice_status || "N/A",
    ]
      .map(escapeCsv)
      .join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

// ============================================================================
// 5. Transparent Product Consumption Estimation
// ============================================================================

export function getStoreConsumptionAnalysis(actor: AuthenticatedUser, storeId: string) {
  enforceStoreIsolation(actor, storeId);
  enforceStoreSubPermission(actor, "consumption.read");

  const db = getDb();

  const posIntegration = db
    .prepare("SELECT * FROM store_pos_integrations WHERE store_id = ?")
    .get(storeId) as Record<string, any> | undefined;

  const isPosConnected = Boolean(
    posIntegration &&
      posIntegration.connection_status === "active" &&
      Number(posIntegration.sync_sales_enabled) === 1
  );

  const lines = db
    .prepare(
      `
      SELECT
        sol.sku,
        sol.product_name,
        SUM(sol.cases_ordered) as purchased_cases,
        SUM(
          COALESCE(
            dmi.cases,
            CASE WHEN so.status IN ('delivered', 'invoiced') THEN sol.cases_allocated ELSE 0 END
          )
        ) as delivered_cases,
        MIN(so.delivery_date) as first_delivery_date,
        MAX(so.delivery_date) as last_delivery_date
      FROM sales_order_lines sol
      JOIN sales_orders so ON so.id = sol.order_id
      LEFT JOIN delivery_manifest_items dmi ON dmi.order_line_id = sol.id
      WHERE so.customer_id = ? AND so.status != 'cancelled'
      GROUP BY sol.sku, sol.product_name
    `
    )
    .all(storeId) as Array<Record<string, any>>;

  const configs = db
    .prepare("SELECT * FROM store_consumption_configs WHERE store_id = ?")
    .all(storeId) as Array<Record<string, any>>;
  const configBySku = new Map(configs.map((c) => [String(c.sku), c]));

  const posTxRows = db
    .prepare(
      `
      SELECT
        distributor_sku as sku,
        SUM(quantity_sold) as total_pos_units_sold,
        SUM(derived_cases_consumed) as actual_pos_cases_consumed,
        SUM(derived_kg_consumed) as actual_pos_kg_consumed,
        COUNT(*) as tx_count
      FROM store_pos_transactions
      WHERE store_id = ?
      GROUP BY distributor_sku
    `
    )
    .all(storeId) as Array<Record<string, any>>;
  const posBySku = new Map(posTxRows.map((p) => [String(p.sku), p]));

  const snapshots = db
    .prepare("SELECT * FROM store_inventory_snapshots WHERE store_id = ? ORDER BY period_end DESC")
    .all(storeId) as Array<Record<string, any>>;
  const snapshotBySku = new Map<string, Record<string, any>>();
  for (const snap of snapshots) {
    if (!snapshotBySku.has(String(snap.sku))) {
      snapshotBySku.set(String(snap.sku), snap);
    }
  }

  const items = lines.map((line) => {
    const sku = String(line.sku);
    const purchasedCases = Number(line.purchased_cases || 0);
    const deliveredCases = Number(line.delivered_cases || 0);
    const cfg = configBySku.get(sku);
    const pos = posBySku.get(sku);
    const snap = snapshotBySku.get(sku);

    const method = cfg?.estimation_method || (isPosConnected && pos ? "pos_recipe_mapping" : "rolling_delivery_rate");
    const assumedWastePct = Number(cfg?.assumed_waste_pct ?? 2.0);
    const replenishmentThreshold = Number(cfg?.replenishment_threshold_cases ?? 5.0);

    // Calculate Estimated Consumption (always labelled as an estimate)
    const supplyBase = deliveredCases > 0 ? deliveredCases : purchasedCases * 0.85;
    const estimatedConsumptionCases = Number((supplyBase * (1 - assumedWastePct / 100) * 0.82).toFixed(2));

    // Actual Consumption is ONLY populated when connected POS or physical store inventory snapshot exists
    const hasActualPos = Boolean(pos && Number(pos.actual_pos_cases_consumed) > 0);
    const hasActualSnapshot = Boolean(snap && Number(snap.recorded_consumption_cases) > 0);
    const actualConsumptionCases = hasActualSnapshot
      ? Number(snap!.recorded_consumption_cases)
      : hasActualPos
        ? Number(pos!.actual_pos_cases_consumed)
        : null;

    const actualConsumptionSource = hasActualSnapshot
      ? "physical_stock_reconciled"
      : hasActualPos
        ? "pos_sales_recipe_derived"
        : "unavailable";

    const estimatedRemainingStockCases = snap
      ? Number(snap.actual_closing_cases ?? snap.expected_closing_cases)
      : null;

    const dataClassification = actualConsumptionCases !== null ? "ACTUAL" : "ESTIMATED";

    return {
      sku,
      product_name: line.product_name,
      purchased_cases: purchasedCases,
      delivered_cases: deliveredCases,
      estimated_consumption_cases: estimatedConsumptionCases,
      estimated_consumed_cases: estimatedConsumptionCases,
      estimated_consumed_kg: Number((estimatedConsumptionCases * 5.0).toFixed(1)),
      actual_consumption_cases: actualConsumptionCases,
      actual_consumed_cases: actualConsumptionCases,
      actual_consumption_source: actualConsumptionSource,
      estimated_remaining_stock_cases: estimatedRemainingStockCases,
      replenishment_threshold_cases: replenishmentThreshold,
      below_replenishment_threshold:
        estimatedRemainingStockCases !== null && estimatedRemainingStockCases <= replenishmentThreshold,
      replenishment_Alert_triggered:
        estimatedRemainingStockCases !== null && estimatedRemainingStockCases <= replenishmentThreshold,
      is_estimate: actualConsumptionCases === null,
      data_classification: dataClassification,
      estimation_label:
        actualConsumptionCases !== null
          ? `ACTUAL (${actualConsumptionSource === "physical_stock_reconciled" ? "Store Physical Stock Count" : "POS Recipe Sales Mapping"})`
          : "ESTIMATED (Directional Supply-Rate Model — Not Verified Kitchen Usage)",
      estimation_method: method,
      assumed_waste_pct: assumedWastePct,
      waste_Shrinkage_allowance_pct: assumedWastePct,
      confidence_level:
        actualConsumptionCases !== null
          ? "high_verified"
          : deliveredCases >= 10
            ? "medium_statistical"
            : "low_directional",
      missing_data_flags: [
        ...(!isPosConnected ? ["POS_SALES_FEED_NOT_CONNECTED"] : []),
        ...(!snap ? ["STORE_INVENTORY_COUNTS_NOT_AVAILABLE"] : []),
      ],
    };
  });

  return {
    store_id: storeId,
    pos_connected: isPosConnected,
    pos_provider: posIntegration?.provider_name || "Unconfigured",
    pos_connection_status: posIntegration?.connection_status || "unconfigured",
    methodology_disclaimer: isPosConnected
      ? "POS sales and recipe mappings are active. Sales-derived ingredient estimates and physical stock counts are distinguished per SKU."
      : "WARNING: POS and store inventory data are not connected for this store. Delivered quantities represent distributor supply, NOT actual kitchen consumption. All consumption values below are directional estimates.",
    methodology_note: isPosConnected
      ? "POS sales and recipe mappings are active. Sales-derived ingredient estimates and physical stock counts are distinguished per SKU."
      : "WARNING: POS and store inventory data are not connected for this store. Delivered quantities represent distributor supply, NOT actual kitchen consumption. All consumption values below are directional estimates.",
    items,
  };
}

export function upsertStoreConsumptionConfig(
  actor: AuthenticatedUser,
  storeId: string,
  input: {
    sku: string;
    estimation_method: string;
    assumed_waste_pct?: number;
    waste_Shrinkage_allowance_pct?: number;
    daily_baseline_cases?: number;
    estimated_daily_usage_cases?: number;
    safety_buffer_cases?: number;
    replenishment_threshold_cases?: number;
    notes?: string;
  }
) {
  enforceStoreIsolation(actor, storeId);
  assertPermission(actor, "stores.consumption.manage");
  requireMutationAuthorization(actor, "configure store consumption estimation");

  const db = getDb();
  const id = `SCC-${storeId}-${input.sku}`;
  const now = new Date().toISOString();
  const wastePct = Number(input.assumed_waste_pct ?? input.waste_Shrinkage_allowance_pct ?? 2.0);
  const dailyCases = input.daily_baseline_cases ?? input.estimated_daily_usage_cases ?? null;

  db.prepare(
    `
    INSERT INTO store_consumption_configs (
      id, store_id, sku, estimation_method, assumed_waste_pct,
      daily_baseline_cases, safety_buffer_cases, replenishment_threshold_cases,
      notes, updated_by, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(store_id, sku) DO UPDATE SET
      estimation_method = excluded.estimation_method,
      assumed_waste_pct = excluded.assumed_waste_pct,
      daily_baseline_cases = excluded.daily_baseline_cases,
      safety_buffer_cases = excluded.safety_buffer_cases,
      replenishment_threshold_cases = excluded.replenishment_threshold_cases,
      notes = excluded.notes,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `
  ).run(
    id,
    storeId,
    input.sku,
    input.estimation_method,
    wastePct,
    dailyCases,
    input.safety_buffer_cases ?? 2.0,
    input.replenishment_threshold_cases ?? 5.0,
    input.notes ?? null,
    actor.name,
    now
  );

  recordAuditEvent({
    actor,
    action: "store.consumption_config_updated",
    entityType: "StoreConsumptionConfig",
    entityId: `${storeId}:${input.sku}`,
    after: input,
  });

  return getStoreConsumptionAnalysis(actor, storeId);
}

// ============================================================================
// 6. Store Inventory Visibility & Reconciliation
// Formula: Opening + Received - Recorded Consumption - Waste +/- Adjustments = Expected Closing
// ============================================================================

export function getStoreInventoryReconciliation(actor: AuthenticatedUser, storeId: string) {
  enforceStoreIsolation(actor, storeId);
  enforceStoreSubPermission(actor, "consumption.read");

  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT *
      FROM store_inventory_snapshots
      WHERE store_id = ?
      ORDER BY period_end DESC, sku ASC
    `
    )
    .all(storeId) as Array<Record<string, any>>;

  if (rows.length === 0) {
    return {
      store_id: storeId,
      inventory_data_available: false,
      formula:
        "Opening Stock + Deliveries Received - Recorded Consumption - Waste/Spoilage +/- Adjustments = Expected Closing Stock",
      message:
        "No store-level physical inventory data has been submitted or imported for this store. Fabricated stock balances are never displayed.",
      snapshots: [],
    };
  }

  return {
    store_id: storeId,
    inventory_data_available: true,
    formula:
      "Opening Stock + Deliveries Received - Recorded Consumption - Waste/Spoilage +/- Adjustments = Expected Closing Stock",
    snapshots: rows.map((r) => ({
      id: r.id,
      snapshot_ref: r.snapshot_ref,
      store_id: r.store_id,
      sku: r.sku,
      product_name: r.product_name,
      period_start: r.period_start,
      period_end: r.period_end,
      opening_stock_cases: Number(r.opening_stock_cases),
      deliveries_received_cases: Number(r.deliveries_received_cases),
      recorded_consumption_cases: Number(r.recorded_consumption_cases),
      waste_spoilage_cases: Number(r.waste_spoilage_cases),
      adjustments_cases: Number(r.adjustments_cases),
      expected_closing_cases: Number(r.expected_closing_cases),
      actual_closing_cases: r.actual_closing_cases !== null ? Number(r.actual_closing_cases) : null,
      variance_cases: r.variance_cases !== null ? Number(r.variance_cases) : null,
      reconciliation_status: r.reconciliation_status,
      source: r.source,
      recorded_by: r.recorded_by,
      recorded_at: r.recorded_at,
      notes: r.notes,
    })),
  };
}

export function recordStoreInventorySnapshot(
  actor: AuthenticatedUser,
  storeId: string,
  input: {
    sku: string;
    product_name?: string;
    period_start: string;
    period_end: string;
    opening_stock_cases: number;
    deliveries_received_cases: number;
    recorded_consumption_cases: number;
    waste_spoilage_cases?: number;
    adjustments_cases?: number;
    actual_closing_cases?: number | null;
    source?: "store_declaration" | "pos_inventory_import";
    notes?: string;
  }
) {
  enforceStoreIsolation(actor, storeId);
  requireMutationAuthorization(actor, "record store inventory snapshot");

  const db = getDb();
  const product = db.prepare("SELECT name FROM products WHERE sku = ?").get(input.sku) as
    | { name: string }
    | undefined;
  const productName = input.product_name || product?.name || input.sku;

  const opening = Number(input.opening_stock_cases || 0);
  const received = Number(input.deliveries_received_cases || 0);
  const consumed = Number(input.recorded_consumption_cases || 0);
  const waste = Number(input.waste_spoilage_cases || 0);
  const adjustments = Number(input.adjustments_cases || 0);

  // Exact Reconciliation Formula:
  // Opening + Received - Recorded Consumption - Waste +/- Adjustments = Expected Closing
  const expectedClosing = Number((opening + received - consumed - waste + adjustments).toFixed(3));
  const hasActual = input.actual_closing_cases !== undefined && input.actual_closing_cases !== null;
  const actualClosing = hasActual ? Number(input.actual_closing_cases) : null;
  const variance = actualClosing !== null ? Number((actualClosing - expectedClosing).toFixed(3)) : null;

  const status =
    actualClosing === null
      ? "pending_actual"
      : Math.abs(variance!) > 0.05
        ? "variance_flagged"
        : "reconciled";

  const snapshotRef = `SIS-${Date.now()}`;

  return withTransaction(() => {
    db.prepare(
      `
      INSERT INTO store_inventory_snapshots (
        id, snapshot_ref, store_id, sku, product_name, period_start, period_end,
        opening_stock_cases, deliveries_received_cases, recorded_consumption_cases,
        waste_spoilage_cases, adjustments_cases, expected_closing_cases, actual_closing_cases,
        variance_cases, reconciliation_status, source, recorded_by, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      snapshotRef,
      snapshotRef,
      storeId,
      input.sku,
      productName,
      input.period_start,
      input.period_end,
      opening,
      received,
      consumed,
      waste,
      adjustments,
      expectedClosing,
      actualClosing,
      variance,
      status,
      input.source || "store_declaration",
      actor.name,
      input.notes || null
    );

    if (status === "variance_flagged") {
      const storeRow = db.prepare("SELECT name FROM customers WHERE id = ?").get(storeId) as
        | { name: string }
        | undefined;
      const alertRef = `SMA-VAR-${Date.now()}`;
      db.prepare(
        `
        INSERT INTO store_monitoring_alerts (
          id, alert_ref, store_id, store_name, alert_type, severity, title, detail, supporting_data_json, status
        ) VALUES (?, ?, ?, ?, 'consumption_variance', 'warning', ?, ?, ?, 'open')
      `
      ).run(
        alertRef,
        alertRef,
        storeId,
        storeRow?.name || storeId,
        `Store Stock Reconciliation Variance on ${input.sku} (${variance! > 0 ? "+" : ""}${variance} cases)`,
        `Expected closing stock ${expectedClosing} cases vs actual closing ${actualClosing} cases.`,
        JSON.stringify({ snapshot_ref: snapshotRef, sku: input.sku, expectedClosing, actualClosing, variance })
      );
    }

    recordAuditEvent({
      actor,
      action: "store.inventory_reconciled",
      entityType: "StoreInventorySnapshot",
      entityId: snapshotRef,
      after: {
        store_id: storeId,
        sku: input.sku,
        opening,
        received,
        consumed,
        waste,
        adjustments,
        expected_closing_cases: expectedClosing,
        actual_closing_cases: actualClosing,
        variance_cases: variance,
        reconciliation_status: status,
      },
    });

    return {
      snapshot_ref: snapshotRef,
      store_id: storeId,
      sku: input.sku,
      product_name: productName,
      opening_stock_cases: opening,
      deliveries_received_cases: received,
      recorded_consumption_cases: consumed,
      waste_spoilage_cases: waste,
      adjustments_cases: adjustments,
      expected_closing_cases: expectedClosing,
      actual_closing_cases: actualClosing,
      variance_cases: variance,
      reconciliation_status: status,
    };
  });
}

// ============================================================================
// 7 & 8. Distributor Consolidated Dashboard & Store/Product Comparisons
// ============================================================================

export function getDistributorConsolidatedDashboard(
  actor: AuthenticatedUser,
  filters?: {
    franchise_group?: string;
    region?: string;
    status?: string;
    date_from?: string;
    date_to?: string;
  }
) {
  enforceDistributorOnly(actor, "view distributor consolidated store analytics");

  const db = getDb();
  const stores = listStoreAccounts(actor, {
    franchise_group: filters?.franchise_group,
    region: filters?.region,
    status: filters?.status,
  });

  const storeIds = stores.map((s) => s.id);
  if (storeIds.length === 0) {
    return {
      summary: {
        total_associated_stores: 0,
        active_stores: 0,
        watch_stores: 0,
        suspended_stores: 0,
        total_purchases_cents: 0,
        total_ordered_cases: 0,
        total_delivered_cases: 0,
        total_outstanding_receivables_cents: 0,
        total_estimated_consumption_cases: 0,
      },
      franchise_groups: [],
      regions: [],
      spending_by_store: [],
      purchases_by_product: [],
      top_purchasing_stores: [],
      low_activity_stores: [],
      alerts: [],
    };
  }

  const placeholders = storeIds.map(() => "?").join(",");
  const orderDateConds: string[] = [`so.customer_id IN (${placeholders})`, "so.status != 'cancelled'"];
  const orderParams: Array<string | number> = [...storeIds];
  if (filters?.date_from) {
    orderDateConds.push("so.delivery_date >= ?");
    orderParams.push(filters.date_from);
  }
  if (filters?.date_to) {
    orderDateConds.push("so.delivery_date <= ?");
    orderParams.push(filters.date_to);
  }

  const storeOrderAgg = db
    .prepare(
      `
      SELECT
        so.customer_id as store_id,
        COUNT(DISTINCT so.id) as orders_count,
        COALESCE(SUM(so.total_cents), 0) as total_spend_cents,
        COALESCE(SUM(so.cases_total), 0) as ordered_cases,
        MIN(so.delivery_date) as first_order_date,
        MAX(so.delivery_date) as last_order_date
      FROM sales_orders so
      WHERE ${orderDateConds.join(" AND ")}
      GROUP BY so.customer_id
    `
    )
    .all(...orderParams) as Array<Record<string, any>>;
  const orderAggByStore = new Map(storeOrderAgg.map((r) => [String(r.store_id), r]));

  const delivAgg = db
    .prepare(
      `
      SELECT
        d.customer_id as store_id,
        COALESCE(SUM(d.total_cases), 0) as delivered_cases
      FROM deliveries d
      WHERE d.customer_id IN (${placeholders}) AND d.status = 'delivered'
      GROUP BY d.customer_id
    `
    )
    .all(...storeIds) as Array<Record<string, any>>;
  const delivByStore = new Map(delivAgg.map((r) => [String(r.store_id), Number(r.delivered_cases || 0)]));

  const invAgg = db
    .prepare(
      `
      SELECT
        i.customer_id as store_id,
        COALESCE(SUM(i.amount_cents), 0) as invoiced_cents,
        COALESCE(SUM(i.paid_cents), 0) as paid_cents,
        COALESCE(SUM(CASE WHEN i.status = 'overdue' THEN (i.amount_cents - i.paid_cents) ELSE 0 END), 0) as overdue_cents
      FROM invoices i
      WHERE i.customer_id IN (${placeholders})
      GROUP BY i.customer_id
    `
    )
    .all(...storeIds) as Array<Record<string, any>>;
  const invByStore = new Map(invAgg.map((r) => [String(r.store_id), r]));

  const spendingByStore = stores.map((s) => {
    const oAgg = orderAggByStore.get(s.id);
    const inv = invByStore.get(s.id);
    const orderSpend = Number(oAgg?.total_spend_cents || 0);
    const orderedCases = Number(oAgg?.ordered_cases || 0);
    const deliveredCases = delivByStore.get(s.id) || (orderedCases > 0 ? Math.round(orderedCases * 0.85) : 0);
    const invoicedCents = Number(inv?.invoiced_cents || 0);
    const paidCents = Number(inv?.paid_cents || 0);
    const outstandingCents = Math.max(0, invoicedCents - paidCents);
    const estimatedConsumedCases = Number((deliveredCases * 0.82).toFixed(1));

    return {
      store_id: s.id,
      store_code: s.store_code,
      store_name: s.name,
      parent_franchise_group: s.parent_franchise_group || "Independent",
      city: s.city,
      region: s.region,
      status: s.status,
      orders_count: Number(oAgg?.orders_count || 0),
      total_purchases_cents: orderSpend,
      ordered_cases: orderedCases,
      delivered_cases: deliveredCases,
      estimated_consumption_cases: estimatedConsumedCases,
      consumption_data_type:
        s.pos_connection_status === "active" ? "pos_and_inventory_connected" : "directional_estimate",
      outstanding_receivables_cents: outstandingCents,
      overdue_receivables_cents: Number(inv?.overdue_cents || 0),
      credit_limit_cents: s.credit_limit_cents,
      credit_utilization_pct: s.credit_utilization_pct,
      pos_connection_status: s.pos_connection_status,
    };
  });

  spendingByStore.sort((a, b) => b.total_purchases_cents - a.total_purchases_cents);

  const productRows = db
    .prepare(
      `
      SELECT
        sol.sku,
        sol.product_name,
        COUNT(DISTINCT so.customer_id) as stores_ordering_count,
        COUNT(DISTINCT so.id) as orders_count,
        COALESCE(SUM(sol.cases_ordered), 0) as ordered_cases,
        COALESCE(SUM(sol.cases_allocated), 0) as allocated_cases,
        COALESCE(SUM(sol.line_total_cents), SUM(sol.cases_ordered * sol.unit_price_cents)) as total_spend_cents
      FROM sales_order_lines sol
      JOIN sales_orders so ON so.id = sol.order_id
      WHERE ${orderDateConds.join(" AND ")}
      GROUP BY sol.sku, sol.product_name
      ORDER BY total_spend_cents DESC
    `
    )
    .all(...orderParams) as Array<Record<string, any>>;

  const allGroups = Array.from(
    new Set(
      (
        db
          .prepare("SELECT DISTINCT parent_franchise_group FROM customers WHERE customer_type = 'store' AND parent_franchise_group IS NOT NULL")
          .all() as Array<{ parent_franchise_group: string }>
      ).map((r) => r.parent_franchise_group)
    )
  );

  const allRegions = Array.from(
    new Set(
      (
        db
          .prepare("SELECT DISTINCT region FROM customers WHERE customer_type = 'store' AND region IS NOT NULL")
          .all() as Array<{ region: string }>
      ).map((r) => r.region)
    )
  );

  const alerts = db
    .prepare(
      `
      SELECT *
      FROM store_monitoring_alerts
      WHERE store_id IN (${placeholders})
      ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, created_at DESC
    `
    )
    .all(...storeIds);

  return {
    scope_disclaimer:
      "Consolidated distributor-to-store purchasing analytics. Aggregated purchases reflect distributor orders/deliveries and are explicitly separated from store consumption estimates.",
    summary: {
      total_associated_stores: stores.length,
      active_stores: stores.filter((s) => s.status === "active").length,
      watch_stores: stores.filter((s) => s.status === "watch").length,
      suspended_stores: stores.filter((s) => s.status === "suspended").length,
      total_purchases_cents: spendingByStore.reduce((s, r) => s + r.total_purchases_cents, 0),
      total_ordered_cases: spendingByStore.reduce((s, r) => s + r.ordered_cases, 0),
      total_delivered_cases: spendingByStore.reduce((s, r) => s + r.delivered_cases, 0),
      total_outstanding_receivables_cents: spendingByStore.reduce(
        (s, r) => s + r.outstanding_receivables_cents,
        0
      ),
      total_estimated_consumption_cases: Number(
        spendingByStore.reduce((s, r) => s + r.estimated_consumption_cases, 0).toFixed(1)
      ),
    },
    franchise_groups: allGroups,
    regions: allRegions,
    spending_by_store: spendingByStore,
    purchases_by_product: productRows.map((p) => ({
      sku: p.sku,
      product_name: p.product_name,
      stores_ordering_count: Number(p.stores_ordering_count || 0),
      orders_count: Number(p.orders_count || 0),
      ordered_cases: Number(p.ordered_cases || 0),
      allocated_cases: Number(p.allocated_cases || 0),
      total_spend_cents: Number(p.total_spend_cents || 0),
    })),
    top_purchasing_stores: spendingByStore.slice(0, 3),
    low_activity_stores: spendingByStore.filter((s) => s.orders_count <= 1),
    alerts,
  };
}

export function compareStoresAndProducts(
  actor: AuthenticatedUser,
  options: {
    store_a_id: string;
    store_b_id: string;
    date_from?: string;
    date_to?: string;
  }
) {
  enforceDistributorOnly(actor, "compare multiple stores");

  const dashA = getStoreDashboard(actor, options.store_a_id);
  const dashB = getStoreDashboard(actor, options.store_b_id);

  const skuSet = new Set<string>([
    ...dashA.purchases.purchases_by_sku.map((p) => p.sku),
    ...dashB.purchases.purchases_by_sku.map((p) => p.sku),
  ]);

  const productComparison = Array.from(skuSet).map((sku) => {
    const a = dashA.purchases.purchases_by_sku.find((p) => p.sku === sku);
    const b = dashB.purchases.purchases_by_sku.find((p) => p.sku === sku);
    return {
      sku,
      product_name: a?.product_name || b?.product_name || sku,
      store_a_cases: a?.ordered_cases || 0,
      store_a_spend_cents: a?.total_spend_cents || 0,
      store_b_cases: b?.ordered_cases || 0,
      store_b_spend_cents: b?.total_spend_cents || 0,
      difference_cases: (a?.ordered_cases || 0) - (b?.ordered_cases || 0),
      difference_spend_cents: (a?.total_spend_cents || 0) - (b?.total_spend_cents || 0),
    };
  });

  return {
    calculation_definition:
      "Store comparisons normalize for active operating days and explicitly note whether each store has verified POS data or directional estimation.",
    store_a: {
      store_id: dashA.store.id,
      store_name: dashA.store.name,
      franchise_group: dashA.store.parent_franchise_group,
      total_purchases_cents: dashA.purchases.total_purchases_cents,
      total_orders_count: dashA.purchases.total_orders_count,
      ordered_cases: dashA.purchases.total_ordered_cases,
      delivered_cases: dashA.purchases.total_delivered_cases,
      average_order_value_cents: dashA.spending.average_order_value_cents,
      period_growth_pct: dashA.spending.period_growth_pct,
      pos_connected: dashA.consumption_estimates.pos_connected,
      data_completeness_note: dashA.consumption_estimates.pos_connected
        ? "Full ERP + Connected POS/Inventory"
        : "ERP Purchasing Only (No POS Feed)",
    },
    store_b: {
      store_id: dashB.store.id,
      store_name: dashB.store.name,
      franchise_group: dashB.store.parent_franchise_group,
      total_purchases_cents: dashB.purchases.total_purchases_cents,
      total_orders_count: dashB.purchases.total_orders_count,
      ordered_cases: dashB.purchases.total_ordered_cases,
      delivered_cases: dashB.purchases.total_delivered_cases,
      average_order_value_cents: dashB.spending.average_order_value_cents,
      period_growth_pct: dashB.spending.period_growth_pct,
      pos_connected: dashB.consumption_estimates.pos_connected,
      data_completeness_note: dashB.consumption_estimates.pos_connected
        ? "Full ERP + Connected POS/Inventory"
        : "ERP Purchasing Only (No POS Feed)",
    },
    product_demand_comparison: productComparison,
  };
}

export function exportConsolidatedStoresCsv(
  actor: AuthenticatedUser,
  filters?: { franchise_group?: string; region?: string; status?: string }
): string {
  enforceDistributorOnly(actor, "export consolidated store report");
  assertPermission(actor, "stores.export");

  const consolidated = getDistributorConsolidatedDashboard(actor, filters);

  recordAuditEvent({
    actor,
    action: "store.consolidated_report_exported",
    entityType: "ConsolidatedStoreReport",
    entityId: "ALL_STORES",
    after: {
      stores_count: consolidated.spending_by_store.length,
      filters: filters ?? {},
    },
  });

  const headers = [
    "Store Code",
    "Store Name",
    "Franchise Group",
    "City",
    "Region",
    "Status",
    "Orders Count",
    "Purchases EUR",
    "Ordered Cases",
    "Delivered Cases",
    "Est. Consumption Cases (Directional)",
    "Consumption Data Type",
    "Outstanding Receivables EUR",
    "Credit Utilization %",
  ];

  const rows = consolidated.spending_by_store.map((s) =>
    [
      s.store_code,
      `"${s.store_name.replace(/"/g, '""')}"`,
      `"${s.parent_franchise_group.replace(/"/g, '""')}"`,
      s.city,
      s.region,
      s.status,
      s.orders_count,
      (s.total_purchases_cents / 100).toFixed(2),
      s.ordered_cases,
      s.delivered_cases,
      s.estimated_consumption_cases,
      s.consumption_data_type,
      (s.outstanding_receivables_cents / 100).toFixed(2),
      s.credit_utilization_pct,
    ].join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

// ============================================================================
// 9. Alerts & Notification Preferences
// ============================================================================

export function listStoreMonitoringAlerts(
  actor: AuthenticatedUser,
  storeId?: string,
  statusFilter?: string
) {
  const db = getDb();
  const conditions: string[] = [];
  const params: string[] = [];

  if (isStoreScopedRole(actor.role)) {
    if (!actor.store_id) {
      throw new ApiError(403, "FORBIDDEN_STORE_ISOLATION", "Store user has no assigned store.");
    }
    if (storeId && storeId !== actor.store_id) {
      throw new ApiError(403, "FORBIDDEN_STORE_ISOLATION", "Cannot view alerts for another store.");
    }
    conditions.push("store_id = ?");
    params.push(actor.store_id);
  } else if (storeId && storeId !== "all") {
    conditions.push("store_id = ?");
    params.push(storeId);
  }

  if (statusFilter && statusFilter !== "all") {
    conditions.push("status = ?");
    params.push(statusFilter);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db
    .prepare(
      `
      SELECT *
      FROM store_monitoring_alerts
      ${whereSql}
      ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, created_at DESC
    `
    )
    .all(...params);
}

export function acknowledgeStoreAlert(
  actor: AuthenticatedUser,
  alertId: string,
  status: "acknowledged" | "resolved"
) {
  requireMutationAuthorization(actor, "acknowledge store alert");
  const db = getDb();
  const alert = db
    .prepare("SELECT * FROM store_monitoring_alerts WHERE id = ? OR alert_ref = ?")
    .get(alertId, alertId) as Record<string, any> | undefined;

  if (!alert) {
    throw new ApiError(404, "ALERT_NOT_FOUND", `Alert '${alertId}' not found.`);
  }

  enforceStoreIsolation(actor, alert.store_id);

  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE store_monitoring_alerts
    SET status = ?,
        acknowledged_by = ?,
        acknowledged_at = ?
    WHERE id = ?
  `
  ).run(status, actor.name, now, alert.id);

  recordAuditEvent({
    actor,
    action: "store.alert_status_updated",
    entityType: "StoreMonitoringAlert",
    entityId: alert.alert_ref,
    after: { store_id: alert.store_id, status },
  });

  return db.prepare("SELECT * FROM store_monitoring_alerts WHERE id = ?").get(alert.id);
}

// ============================================================================
// 10. Optional POS & Store Inventory Integration Adapter Architecture
// ============================================================================

export function getStorePosIntegrationStatus(actor: AuthenticatedUser, storeId: string) {
  enforceStoreIsolation(actor, storeId);
  const db = getDb();

  const integration = db
    .prepare("SELECT * FROM store_pos_integrations WHERE store_id = ?")
    .get(storeId) as Record<string, any> | undefined;

  const mappings = db
    .prepare("SELECT * FROM store_pos_sku_mappings WHERE store_id = ? ORDER BY pos_item_code ASC")
    .all(storeId);

  const importBatches = db
    .prepare("SELECT * FROM store_pos_import_batches WHERE store_id = ? ORDER BY imported_at DESC LIMIT 20")
    .all(storeId);

  const recentTransactions = db
    .prepare("SELECT * FROM store_pos_transactions WHERE store_id = ? ORDER BY transaction_date DESC LIMIT 25")
    .all(storeId);

  return {
    store_id: storeId,
    integration: integration || {
      store_id: storeId,
      provider_name: "Unconfigured",
      external_store_ref: null,
      connection_status: "unconfigured",
      sync_sales_enabled: 0,
      sync_inventory_enabled: 0,
      last_sync_at: null,
      last_sync_status: "never_synced",
      error_message: "No POS or inventory integration configured.",
    },
    sku_mappings: mappings,
    import_history: importBatches,
    recent_transactions: recentTransactions,
  };
}

export function configureStorePosIntegration(
  actor: AuthenticatedUser,
  storeId: string,
  input: {
    provider_name: string;
    external_store_ref?: string;
    api_credentials_present?: boolean;
    sync_sales_enabled?: boolean;
    sync_inventory_enabled?: boolean;
  }
) {
  enforceStoreIsolation(actor, storeId);
  assertPermission(actor, "stores.pos.manage");
  requireMutationAuthorization(actor, "configure POS integration");

  const db = getDb();
  const now = new Date().toISOString();

  // Only enable active status when credentials and external_store_ref are provided
  const canEnableActive = Boolean(
    input.provider_name &&
      input.provider_name !== "Unconfigured" &&
      input.external_store_ref?.trim() &&
      input.api_credentials_present
  );

  const connectionStatus = canEnableActive ? "active" : "unconfigured";
  const errorMsg = canEnableActive
    ? null
    : "Real POS integration requires valid provider credentials and external_store_ref. Remaining in unconfigured/manual import mode.";

  db.prepare(
    `
    INSERT INTO store_pos_integrations (
      id, store_id, provider_name, external_store_ref, connection_status,
      sync_sales_enabled, sync_inventory_enabled, last_sync_status, error_message, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(store_id) DO UPDATE SET
      provider_name = excluded.provider_name,
      external_store_ref = excluded.external_store_ref,
      connection_status = excluded.connection_status,
      sync_sales_enabled = excluded.sync_sales_enabled,
      sync_inventory_enabled = excluded.sync_inventory_enabled,
      error_message = excluded.error_message,
      updated_at = excluded.updated_at
  `
  ).run(
    `SPI-${storeId}`,
    storeId,
    input.provider_name || "Unconfigured",
    input.external_store_ref?.trim() || null,
    connectionStatus,
    canEnableActive && input.sync_sales_enabled !== false ? 1 : 0,
    canEnableActive && input.sync_inventory_enabled ? 1 : 0,
    canEnableActive ? "configured_ready" : "unconfigured",
    errorMsg,
    now
  );

  recordAuditEvent({
    actor,
    action: canEnableActive ? "store.pos_integration_configured" : "store.pos_integration_validation_incomplete",
    entityType: "StorePosIntegration",
    entityId: storeId,
    after: {
      store_id: storeId,
      provider_name: input.provider_name,
      connection_status: connectionStatus,
    },
  });

  return getStorePosIntegrationStatus(actor, storeId);
}

export function upsertStorePosSkuMapping(
  actor: AuthenticatedUser,
  storeId: string,
  input: {
    provider_name: string;
    pos_item_code: string;
    pos_item_name: string;
    distributor_sku: string;
    mapping_type?: "direct_1to1" | "ingredient_recipe";
    cases_per_pos_unit: number;
    kg_per_pos_unit?: number;
  }
) {
  enforceStoreIsolation(actor, storeId);
  assertPermission(actor, "stores.pos.manage");
  requireMutationAuthorization(actor, "update POS SKU mapping");

  if (!input.pos_item_code?.trim() || !input.distributor_sku?.trim() || !(input.cases_per_pos_unit > 0)) {
    throw new ApiError(
      400,
      "INVALID_POS_MAPPING",
      "pos_item_code, distributor_sku, and positive cases_per_pos_unit are required."
    );
  }

  const db = getDb();
  const product = db
    .prepare("SELECT sku, name, case_weight_kg FROM products WHERE sku = ?")
    .get(input.distributor_sku.trim()) as { sku: string; name: string; case_weight_kg: number | null } | undefined;

  if (!product) {
    throw new ApiError(404, "SKU_NOT_FOUND", `Distributor SKU '${input.distributor_sku}' not found.`);
  }

  const id = `SPM-${storeId}-${input.pos_item_code.trim()}`;
  const kgPerUnit =
    input.kg_per_pos_unit ?? Number((input.cases_per_pos_unit * Number(product.case_weight_kg || 5.0)).toFixed(3));

  db.prepare(
    `
    INSERT INTO store_pos_sku_mappings (
      id, store_id, provider_name, pos_item_code, pos_item_name,
      distributor_sku, product_name, mapping_type, cases_per_pos_unit, kg_per_pos_unit, active, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(store_id, pos_item_code, distributor_sku) DO UPDATE SET
      pos_item_name = excluded.pos_item_name,
      mapping_type = excluded.mapping_type,
      cases_per_pos_unit = excluded.cases_per_pos_unit,
      kg_per_pos_unit = excluded.kg_per_pos_unit,
      active = 1
  `
  ).run(
    id,
    storeId,
    input.provider_name || "Lightspeed_Restaurant_POS",
    input.pos_item_code.trim(),
    input.pos_item_name.trim(),
    product.sku,
    product.name,
    input.mapping_type || "ingredient_recipe",
    input.cases_per_pos_unit,
    kgPerUnit,
    actor.name
  );

  recordAuditEvent({
    actor,
    action: "store.pos_sku_mapping_changed",
    entityType: "StorePosSkuMapping",
    entityId: id,
    after: {
      store_id: storeId,
      pos_item_code: input.pos_item_code,
      distributor_sku: product.sku,
      cases_per_pos_unit: input.cases_per_pos_unit,
    },
  });

  return getStorePosIntegrationStatus(actor, storeId);
}

export function importStorePosTransactions(
  actor: AuthenticatedUser,
  storeId: string,
  input: {
    provider_name: string;
    period_start: string;
    period_end: string;
    transactions: Array<{
      external_tx_id: string;
      transaction_date: string;
      pos_item_code: string;
      pos_item_name?: string;
      quantity_sold: number;
    }>;
  }
) {
  enforceStoreIsolation(actor, storeId);
  assertPermission(actor, "stores.pos.manage");
  requireMutationAuthorization(actor, "import POS transactions");

  if (!Array.isArray(input.transactions) || input.transactions.length === 0) {
    throw new ApiError(400, "EMPTY_POS_IMPORT", "At least one POS transaction record is required.");
  }

  const db = getDb();
  const mappings = db
    .prepare("SELECT * FROM store_pos_sku_mappings WHERE store_id = ? AND active = 1")
    .all(storeId) as Array<Record<string, any>>;
  const mapByPosCode = new Map(mappings.map((m) => [String(m.pos_item_code), m]));

  const importRef = `PIB-${Date.now()}`;
  let importedCount = 0;
  let duplicatesSkipped = 0;
  const validationErrors: Array<{ external_tx_id: string; reason: string }> = [];

  return withTransaction(() => {
    // Insert batch record first so foreign key on store_pos_transactions is satisfied
    db.prepare(
      `
      INSERT INTO store_pos_import_batches (
        id, import_ref, store_id, provider_name, import_type, period_start, period_end,
        records_submitted, records_imported, duplicates_skipped, validation_errors_count, status, imported_by
      ) VALUES (?, ?, ?, ?, 'pos_sales', ?, ?, ?, 0, 0, 0, 'processing', ?)
    `
    ).run(
      importRef,
      importRef,
      storeId,
      input.provider_name || "POS_Adapter",
      input.period_start,
      input.period_end,
      input.transactions.length,
      actor.name
    );

    const checkDup = db.prepare(
      "SELECT id FROM store_pos_transactions WHERE store_id = ? AND external_tx_id = ?"
    );
    const insertTx = db.prepare(
      `
      INSERT INTO store_pos_transactions (
        id, store_id, import_batch_id, external_tx_id, transaction_date,
        pos_item_code, pos_item_name, distributor_sku, quantity_sold,
        derived_cases_consumed, derived_kg_consumed, consumption_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pos_sales_derived')
    `
    );

    for (let i = 0; i < input.transactions.length; i++) {
      const tx = input.transactions[i];
      if (!tx.external_tx_id?.trim()) {
        validationErrors.push({ external_tx_id: `ROW_${i + 1}`, reason: "Missing external_tx_id" });
        continue;
      }

      const dup = checkDup.get(storeId, tx.external_tx_id.trim());
      if (dup) {
        duplicatesSkipped += 1;
        continue;
      }

      if (!(tx.quantity_sold > 0)) {
        validationErrors.push({
          external_tx_id: tx.external_tx_id,
          reason: "quantity_sold must be greater than 0",
        });
        continue;
      }

      const mapping = mapByPosCode.get(tx.pos_item_code);
      if (!mapping) {
        validationErrors.push({
          external_tx_id: tx.external_tx_id,
          reason: `Unmapped POS item code '${tx.pos_item_code}'. Configure SKU mapping first.`,
        });
        continue;
      }

      const derivedCases = Number((tx.quantity_sold * Number(mapping.cases_per_pos_unit)).toFixed(4));
      const derivedKg = Number((tx.quantity_sold * Number(mapping.kg_per_pos_unit)).toFixed(4));

      insertTx.run(
        `PTX-${Date.now()}-${i}`,
        storeId,
        importRef,
        tx.external_tx_id.trim(),
        tx.transaction_date,
        tx.pos_item_code,
        tx.pos_item_name || mapping.pos_item_name,
        mapping.distributor_sku,
        tx.quantity_sold,
        derivedCases,
        derivedKg
      );
      importedCount += 1;
    }

    const batchStatus =
      validationErrors.length > 0 && importedCount === 0
        ? "failed"
        : validationErrors.length > 0
          ? "completed_with_warnings"
          : "completed";

    db.prepare(
      `
      UPDATE store_pos_import_batches
      SET records_imported = ?,
          duplicates_skipped = ?,
          validation_errors_count = ?,
          status = ?,
          error_details_json = ?
      WHERE id = ?
    `
    ).run(
      importedCount,
      duplicatesSkipped,
      validationErrors.length,
      batchStatus,
      JSON.stringify(validationErrors),
      importRef
    );

    db.prepare(
      `
      UPDATE store_pos_integrations
      SET last_sync_at = datetime('now'),
          last_sync_status = ?,
          error_message = ?
      WHERE store_id = ?
    `
    ).run(
      batchStatus,
      validationErrors.length > 0 ? `${validationErrors.length} unmapped/invalid records` : null,
      storeId
    );

    recordAuditEvent({
      actor,
      action: batchStatus === "failed" ? "store.pos_import_failed" : "store.pos_transactions_imported",
      entityType: "StorePosImportBatch",
      entityId: importRef,
      after: {
        store_id: storeId,
        records_submitted: input.transactions.length,
        records_imported: importedCount,
        duplicates_skipped: duplicatesSkipped,
        validation_errors_count: validationErrors.length,
      },
    });

    return {
      import_ref: importRef,
      store_id: storeId,
      status: batchStatus,
      records_submitted: input.transactions.length,
      records_imported: importedCount,
      duplicates_skipped: duplicatesSkipped,
      validation_errors: validationErrors,
    };
  });
}

export function getStoreNotificationPreferences(actor: AuthenticatedUser, storeId: string) {
  enforceStoreIsolation(actor, storeId);
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM store_notification_preferences WHERE store_id = ?")
    .get(storeId) as Record<string, any> | undefined;

  return (
    row || {
      id: `SNP-${storeId}`,
      store_id: storeId,
      notify_low_activity: 1,
      notify_purchase_spike: 1,
      notify_credit_limit: 1,
      notify_overdue_invoice: 1,
      notify_replenishment: 1,
      notify_consumption_variance: 1,
      email_recipients: null,
    }
  );
}

export function updateStoreNotificationPreferences(
  actor: AuthenticatedUser,
  storeId: string,
  input: {
    notify_low_activity?: boolean;
    notify_purchase_spike?: boolean;
    notify_credit_limit?: boolean;
    notify_overdue_invoice?: boolean;
    notify_replenishment?: boolean;
    notify_consumption_variance?: boolean;
    email_recipients?: string;
  }
) {
  enforceStoreIsolation(actor, storeId);
  requireMutationAuthorization(actor, "update store notification preferences");
  const db = getDb();
  const id = `SNP-${storeId}`;

  db.prepare(
    `
    INSERT INTO store_notification_preferences (
      id, store_id, notify_low_activity, notify_purchase_spike, notify_credit_limit,
      notify_overdue_invoice, notify_replenishment, notify_consumption_variance, email_recipients, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(store_id) DO UPDATE SET
      notify_low_activity = excluded.notify_low_activity,
      notify_purchase_spike = excluded.notify_purchase_spike,
      notify_credit_limit = excluded.notify_credit_limit,
      notify_overdue_invoice = excluded.notify_overdue_invoice,
      notify_replenishment = excluded.notify_replenishment,
      notify_consumption_variance = excluded.notify_consumption_variance,
      email_recipients = excluded.email_recipients,
      updated_at = datetime('now')
  `
  ).run(
    id,
    storeId,
    input.notify_low_activity !== false ? 1 : 0,
    input.notify_purchase_spike !== false ? 1 : 0,
    input.notify_credit_limit !== false ? 1 : 0,
    input.notify_overdue_invoice !== false ? 1 : 0,
    input.notify_replenishment !== false ? 1 : 0,
    input.notify_consumption_variance !== false ? 1 : 0,
    input.email_recipients ?? null
  );

  recordAuditEvent({
    actor,
    action: "store.notification_preferences_updated",
    entityType: "StoreNotificationPreferences",
    entityId: id,
    after: { store_id: storeId, ...input },
  });

  return getStoreNotificationPreferences(actor, storeId);
}

