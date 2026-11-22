/**
 * Ascentra Food Distribution ERP - Live Grounded AI Assistant Service
 *
 * Combines real-time database grounding (customers, orders, inventory, products, recalls)
 * with comprehensive system architectural knowledge, powered by the centralized OmniRoute Gateway.
 */

import { getDb } from "@/server/db/connection";
import { omniRouteChatCompletion, OmniRouteChatMessage, aiLogger, getOmniRouteConfig } from "@/lib/ai";

export interface LiveErpSnapshot {
  stats: {
    totalCustomers: number;
    totalOrders: number;
    totalProducts: number;
    totalLots: number;
    activeRecalls: number;
    timestamp: string;
  };
  recentCustomers: Array<{
    id: string;
    name: string;
    segment: string;
    city: string;
    creditLimitEur: number;
  }>;
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    customerName: string;
    status: string;
    totalEur: number;
    createdAt: string;
  }>;
  topProducts: Array<{
    sku: string;
    name: string;
    category: string;
    storageTemp: string;
    isCatchWeight: boolean;
  }>;
  inventoryStatus: Array<{
    batchId: string;
    productName: string;
    status: string;
    expiryDate: string;
    currentQuantity: number;
    zone: string;
  }>;
}

/**
 * Extracts a fresh, real-time snapshot of live ERP database state.
 * Always reflects the latest orders, customers, and inventory changes.
 */
export function getLiveErpSnapshot(): LiveErpSnapshot {
  const db = getDb();
  const timestamp = new Date().toISOString();

  // 1. Customers
  const totalCustomers = (db.prepare("SELECT COUNT(*) as c FROM customers").get() as any)?.c || 0;
  const rawCustomers = db
    .prepare("SELECT id, name, segment, city, credit_limit_cents FROM customers ORDER BY created_at DESC LIMIT 20")
    .all() as any[];

  const recentCustomers = rawCustomers.map((c) => ({
    id: c.id,
    name: c.name,
    segment: c.segment || "Standard",
    city: c.city || "Milan",
    creditLimitEur: Math.round((c.credit_limit_cents || 0) / 100),
  }));

  // 2. Orders
  const totalOrders = (db.prepare("SELECT COUNT(*) as c FROM sales_orders").get() as any)?.c || 0;
  const rawOrders = db
    .prepare(`
      SELECT so.id, so.order_number, so.customer_id, c.name as customer_name, so.status, so.total_cents, so.created_at
      FROM sales_orders so
      LEFT JOIN customers c ON so.customer_id = c.id
      ORDER BY so.created_at DESC
      LIMIT 20
    `)
    .all() as any[];

  const recentOrders = rawOrders.map((o) => ({
    id: o.id,
    orderNumber: o.order_number,
    customerName: o.customer_name || `Customer #${o.customer_id}`,
    status: o.status,
    totalEur: Math.round(((o.total_cents || 0) / 100) * 100) / 100,
    createdAt: o.created_at,
  }));

  // 3. Products
  const totalProducts = (db.prepare("SELECT COUNT(*) as c FROM products").get() as any)?.c || 0;
  const rawProducts = db
    .prepare("SELECT sku, name, category, temp_zone, catch_weight FROM products LIMIT 25")
    .all() as any[];

  const topProducts = rawProducts.map((p) => ({
    sku: p.sku,
    name: p.name,
    category: p.category || "General",
    storageTemp: p.temp_zone || "ambient",
    isCatchWeight: Boolean(p.catch_weight),
  }));

  // 4. Inventory Lots
  const totalLots = (db.prepare("SELECT COUNT(*) as c FROM inventory_lots").get() as any)?.c || 0;
  const rawLots = db
    .prepare(`
      SELECT batch_id, product_name, quality_status as status, expiry_date, quantity_cases as current_quantity, zone
      FROM inventory_lots
      ORDER BY expiry_date ASC
      LIMIT 15
    `)
    .all() as any[];

  const inventoryStatus = rawLots.map((l) => ({
    batchId: l.batch_id,
    productName: l.product_name || "Unknown Product",
    status: l.status || "released",
    expiryDate: l.expiry_date,
    currentQuantity: l.current_quantity,
    zone: l.zone || "Default Zone",
  }));

  // 5. Active Recalls
  const activeRecalls = (db.prepare("SELECT COUNT(*) as c FROM recalls WHERE status != 'closed'").get() as any)?.c || 0;

  return {
    stats: {
      totalCustomers,
      totalOrders,
      totalProducts,
      totalLots,
      activeRecalls,
      timestamp,
    },
    recentCustomers,
    recentOrders,
    topProducts,
    inventoryStatus,
  };
}

/**
 * Builds the comprehensive system architecture documentation injected into the assistant.
 */
function getSystemWorkflowDocumentation(): string {
  return `
Ascentra Food Distribution ERP — Architecture & Workflow Knowledge:

1. Products & Procurement:
   - Manages food catalogue with shelf-life rules, GS1 GTINs, storage temperatures (ambient, chilled 0-4°C, frozen -18°C), and catch-weight configuration.
   - Sourcing & supplier management, price lists, purchase orders (PO), landed cost calculations.

2. Inbound & Quality Gate:
   - Shipment intake, temperature probe logs, seal verification, expiry date capture, HACCP compliance checks.
   - QA release vs. quarantine holding zone (QUAR-ZONE-01).

3. Warehouse & Inventory:
   - Dynamic bin locations across ambient, chiller, and freezer zones.
   - FEFO (First-Expired, First-Out) picking allocation algorithm.
   - Lot/batch tracking with minimum remaining shelf life enforcement.

4. Customer Orders & B2B Portal:
   - Multi-channel ordering: internal sales staff entry and dedicated B2B restaurant portal.
   - Credit limit verification, customer pricing tiers, real-time FEFO stock allocation.

5. Picking & Packing:
   - Guided warehouse picking using FEFO logic, barcode verification, catch-weight scale capture at pick, order carton packing, and dispatch staging.

6. Loading & Delivery:
   - Manifest loading into refrigerated vehicles, vehicle reefer temperature verification.
   - Driver route execution, digital Proof of Delivery (POD) with signature capture and delivery exception handling (e.g. refused items, temperature issues).

7. Finance & SdI (Sistema di Interscambio):
   - Invoicing from delivered quantities with catch-weight adjustments.
   - Italian FatturaPA XML (v1.2.2) transmission for SdI, VAT calculation, bank payment reconciliation, delivered gross margin analytics.

8. Traceability & Recall:
   - Bi-directional mass-balance traceability compliant with EC Reg. 178/2002.
   - Instant lot tracing from supplier to warehouse to customer. Mock and live recall workflows with automated quarantine.

9. Store Monitoring:
   - Multi-unit restaurant franchise visibility (e.g. fast-food chains, bistro groups).
   - Order history, cadence tracking, spending analytics, and estimated product consumption rates.

10. Executive & AI:
    - Real-time CEO dashboard (revenue, margins, collection rates, recalls).
    - Statistical demand forecasting, operational anomaly detection, automated replenishment suggestions.
    - Governed Maker-Checker AI safety rule: AI only proposes actions; human managers must approve purchase orders, lot quarantines, or credit holds.

11. Settings & Platform Governance:
    - Role-Based Access Control (RBAC), Multi-Factor Authentication (MFA), disaster recovery drills, data migration rehearsal.
    - Centralized OmniRoute AI Gateway integration with dynamic model routing.
`;
}

function isSimpleGreeting(text: string): boolean {
  const cleaned = text.trim().toLowerCase().replace(/[!?.,;:'"\-]/g, "");
  const greetings = [
    "hi",
    "hello",
    "hey",
    "hiya",
    "hola",
    "ciao",
    "salut",
    "salam",
    "good morning",
    "good afternoon",
    "good evening",
    "howdy",
    "sup",
    "yo",
  ];
  return greetings.includes(cleaned);
}

/* ------------------------------------------------------------------ */
/* READ-ONLY GUARD: the assistant can never create/modify ERP records. */
/* ------------------------------------------------------------------ */

const WRITE_VERBS =
  /\b(add|adding|create|creating|insert|place|placing|put|make|book|enter|register|delete|remove|cancel|update|edit|change|modify|approve|reject|release|quarantine|dispatch|refund|confirm|activate)\b/i;
const ERP_ENTITIES =
  /\b(orders?|customers?|clients?|products?|items?|skus?|lots?|batch(es)?|stock|inventory|po|purchase orders?|suppliers?|invoices?|payments?|prices?|credit|recalls?|deliver(y|ies)|capa|users?)\b/i;

const ENTITY_PAGES: Array<{ re: RegExp; label: string; path: string }> = [
  { re: /\border/i, label: "Customer Orders", path: "/orders" },
  { re: /\b(customer|client)/i, label: "Customer Orders (customer accounts)", path: "/orders" },
  { re: /\b(product|item|sku|price)/i, label: "Products", path: "/products" },
  { re: /\b(lot|batch|stock|inventory)/i, label: "Inventory", path: "/inventory" },
  { re: /\b(po|purchase|supplier)/i, label: "Suppliers & Purchasing", path: "/suppliers" },
  { re: /\b(invoice|payment|credit|refund)/i, label: "Finance", path: "/finance" },
  { re: /\b(recall|capa|quarantine)/i, label: "Exceptions & Recall", path: "/exceptions-recall" },
  { re: /\b(deliver|dispatch|ship)/i, label: "Deliveries", path: "/deliveries" },
];

/** True when the user asks the assistant to perform (or whether it can perform) a write action. */
export function isActionRequest(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!(WRITE_VERBS.test(t) && ERP_ENTITIES.test(t))) return false;
  // "How do I add an order?" / "how does dispatch work" are how-to questions, not commands to the bot.
  if (/\b(how (do|can|should|would) (i|we)|how to|how does|how do|what happens when|explain)\b/.test(t)) return false;
  const addressedToBot = /\b(you|u|ur|can|could|would|will|please|pls|plz|kindly|i want|i would like|i'd like|go ahead|do it|for me)\b/.test(t);
  const startsImperative = new RegExp(`^(yes|yeah|ok|okay|sure|now|then|just|${WRITE_VERBS.source.replace(/\\b/g, "")})\\b`).test(t);
  return addressedToBot || startsImperative;
}

function buildReadOnlyReply(text: string): string {
  const page = ENTITY_PAGES.find((p) => p.re.test(text));
  const where = page
    ? `You can do it yourself on the **${page.label}** page (${page.path}).`
    : "You can do it yourself from the matching module in the sidebar.";
  return (
    "I can't do that — I'm a **read-only** assistant. I can look up and explain data " +
    "(orders, customers, stock, lots, recalls), but I can't add, edit, delete or approve anything in the ERP.\n\n" +
    `${where} Once it's saved, ask me and I'll see it straight away.`
  );
}

/** Detects replies where the model falsely claims to have changed data. */
const FALSE_ACTION_CLAIM =
  /\b(i('ve| have)?|we('ve| have)?)\s+(just\s+|now\s+|successfully\s+)?(added|created|inserted|placed|updated|deleted|removed|cancel?led|changed|modified|saved|recorded|approved|booked)\b|\b(has|have) been (successfully )?(added|created|inserted|placed|updated|deleted|removed|saved)\b|\bupdated list\b|\bi can add\b/i;

function wantsOrderList(text: string): boolean {
  return /\border/i.test(text) && /\b(which|what|list|show|all|tell|see|view|display|how many|orders? (are|r) (in|there))\b/i.test(text);
}

function wantsCustomerList(text: string): boolean {
  return /\b(customer|client)/i.test(text) && !/\border/i.test(text) &&
    /\b(which|what|list|show|all|tell|see|view|display|how many|who)\b/i.test(text);
}

function formatOrderList(snapshot: LiveErpSnapshot): string {
  if (snapshot.recentOrders.length === 0) return "There are no customer orders in the system yet.";
  const lines = snapshot.recentOrders.map(
    (o, i) => `${i + 1}. **${o.orderNumber}** — ${o.customerName} — €${o.totalEur.toFixed(2)} (${o.status})`
  );
  const more = snapshot.stats.totalOrders > snapshot.recentOrders.length
    ? `\n\nShowing the latest ${snapshot.recentOrders.length} of ${snapshot.stats.totalOrders}.`
    : "";
  return `There are **${snapshot.stats.totalOrders}** orders in Customer Orders:\n\n${lines.join("\n")}${more}`;
}

function formatCustomerList(snapshot: LiveErpSnapshot): string {
  if (snapshot.recentCustomers.length === 0) return "There are no customers in the system yet.";
  const lines = snapshot.recentCustomers.map(
    (c, i) => `${i + 1}. **${c.name}** — ${c.city} (${c.segment})`
  );
  const more = snapshot.stats.totalCustomers > snapshot.recentCustomers.length
    ? `\n\nShowing the latest ${snapshot.recentCustomers.length} of ${snapshot.stats.totalCustomers}.`
    : "";
  return `There are **${snapshot.stats.totalCustomers}** customers:\n\n${lines.join("\n")}${more}`;
}

export interface AssistantChatResponse {
  reply: string;
  provider: string;
  model: string;
  liveStats: LiveErpSnapshot["stats"];
}

/**
 * Answers a user question about the system or live ERP data using OmniRoute.
 */
export async function askErpAssistant(
  conversationMessages: Array<{ role: "user" | "assistant"; content: string }>
): Promise<AssistantChatResponse> {
  const snapshot = getLiveErpSnapshot();
  const workflowsDoc = getSystemWorkflowDocumentation();
  const config = getOmniRouteConfig();

  const lastUserMsg = conversationMessages[conversationMessages.length - 1]?.content || "";

  // 1. FAST-PATH: Simple greetings (e.g. "hi", "hello") receive an instant, concise friendly reply.
  if (isSimpleGreeting(lastUserMsg)) {
    return {
      reply: "Hello! How can I help you with Ascentra ERP today? Feel free to ask about any customer, order, stock, or how any specific feature works.",
      provider: "omniroute",
      model: "GLM-5",
      liveStats: snapshot.stats,
    };
  }

  // 2. READ-ONLY GUARD: requests to add/edit/delete/approve are answered honestly, never "faked".
  if (isActionRequest(lastUserMsg)) {
    return {
      reply: buildReadOnlyReply(lastUserMsg),
      provider: "ascentra_guard",
      model: "read_only_policy",
      liveStats: snapshot.stats,
    };
  }

  // 3. DATA LISTS: answered straight from the database so nothing is invented or dropped.
  if (wantsOrderList(lastUserMsg)) {
    return { reply: formatOrderList(snapshot), provider: "ascentra_live_db", model: "sqlite", liveStats: snapshot.stats };
  }
  if (wantsCustomerList(lastUserMsg)) {
    return { reply: formatCustomerList(snapshot), provider: "ascentra_live_db", model: "sqlite", liveStats: snapshot.stats };
  }

  // 4. Strict system prompt forcing strict relevance and concise answers.
  const systemPrompt = `You are Ascentra Food Distribution ERP's Assistant, powered by OmniRoute.

CRITICAL RULES:
0. You are STRICTLY READ-ONLY. You CANNOT add, create, edit, delete, approve or change ANY record (orders, customers, products, stock, prices, payments...). You have no tools to do so.
   - NEVER say "I've added", "I have created", "updated list", or show a list containing items that are not in the LIVE DATA below.
   - If asked to change data, say clearly that you can't, and tell the user which page to use (orders: /orders, products: /products, inventory: /inventory, finance: /finance).
   - Only list records exactly as they appear in the LIVE DATA. Never invent, merge or rename records.
   - Orders live in the "Customer Orders" page (/orders), not a "Customers tab".
1. Answer ONLY what the user specifically asked. Do not volunteer unsolicited information.
2. NEVER explain the entire architecture or list all 11 modules unless the user explicitly asks: "How does the whole system work?" or "Explain the architecture".
3. If the user asks about orders, answer ONLY about orders.
4. If the user asks about customers, answer ONLY about customers.
5. If the user asks about a specific feature (like "how does picking work?" or "what is FEFO?"), answer ONLY about that specific feature in 2-3 concise paragraphs.
6. Keep all answers direct, practical, and focused. Avoid unnecessary filler or preamble.

LIVE DATABASE DATA (Reference this ONLY when the user asks about data):
- Total Customers: ${snapshot.stats.totalCustomers}
- Total Orders: ${snapshot.stats.totalOrders}
- Total Products: ${snapshot.stats.totalProducts}
- Total Lots: ${snapshot.stats.totalLots}
- Active Recalls: ${snapshot.stats.activeRecalls}

LIVE CUSTOMERS:
${snapshot.recentCustomers.map((c) => `• ${c.name} (${c.segment}, ${c.city}) - Credit limit: €${c.creditLimitEur.toLocaleString()}`).join("\n")}

LIVE RECENT ORDERS:
${snapshot.recentOrders.map((o) => `• ${o.orderNumber}: ${o.customerName} - €${o.totalEur.toFixed(2)} [Status: ${o.status}] (Date: ${o.createdAt.slice(0, 10)})`).join("\n")}

LIVE PRODUCTS:
${snapshot.topProducts.map((p) => `• ${p.sku}: ${p.name} (${p.category}, Temp: ${p.storageTemp}, Catch-weight: ${p.isCatchWeight ? "Yes" : "No"})`).join("\n")}

LIVE INVENTORY LOTS:
${snapshot.inventoryStatus.map((l) => `• Batch ${l.batchId}: ${l.productName} [Expires: ${l.expiryDate}] - Available: ${l.currentQuantity} (${l.zone})`).join("\n")}

SYSTEM REFERENCE (Reference ONLY the specific section the user asks about):
${workflowsDoc}`;

  const messages: OmniRouteChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...conversationMessages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  ];

  if (config.enabled && config.apiKey) {
    try {
      const completion = await omniRouteChatCompletion(messages, {
        model: config.defaultModel || "GLM-5",
        temperature: 0.2,
        timeoutMs: 35000,
      });

      const reply = completion.choices?.[0]?.message?.content?.trim();
      if (reply) {
        // Post-filter: AI output is untrusted. Block any claim that data was changed.
        if (FALSE_ACTION_CLAIM.test(reply)) {
          aiLogger.warn("Assistant reply blocked: model claimed to perform a write action it cannot do");
          return {
            reply: buildReadOnlyReply(lastUserMsg),
            provider: "ascentra_guard",
            model: "read_only_policy",
            liveStats: snapshot.stats,
          };
        }
        return {
          reply,
          provider: "omniroute",
          model: completion.omniroute_metadata?.model_resolved || completion.model || "GLM-5",
          liveStats: snapshot.stats,
        };
      }
    } catch (err: unknown) {
      aiLogger.warn("OmniRoute assistant query encountered an error, falling back to local grounded synthesizer", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Targeted local fallback: answer ONLY what is asked
  const queryLower = lastUserMsg.toLowerCase();
  let localReply = "";

  if (queryLower.includes("order")) {
    localReply = `We currently have **${snapshot.stats.totalOrders} orders** in the system.\n\n` +
      `Here are the latest orders:\n` +
      snapshot.recentOrders.slice(0, 5).map((o) => `• **${o.orderNumber}** — ${o.customerName}: €${o.totalEur.toFixed(2)} (${o.status})`).join("\n");
  } else if (queryLower.includes("customer")) {
    localReply = `We currently have **${snapshot.stats.totalCustomers} registered customers**.\n\n` +
      `Recent accounts:\n` +
      snapshot.recentCustomers.slice(0, 5).map((c) => `• **${c.name}** (${c.city}, ${c.segment}) — Credit limit: €${c.creditLimitEur.toLocaleString()}`).join("\n");
  } else if (queryLower.includes("pick") || queryLower.includes("pack")) {
    localReply = `**Picking & Packing in Ascentra ERP:**\n\n` +
      `1. Warehouse pickers receive picking lists prioritized by **FEFO (First-Expired, First-Out)** to prevent food waste.\n` +
      `2. Items are verified by barcode scanning to confirm lot/batch numbers.\n` +
      `3. For meat, cheese, and seafood, actual weights are captured using calibrated scales (catch-weight pricing).\n` +
      `4. Picked items are packed into barcoded cartons and staged in the refrigerated dock for dispatch.`;
  } else if (queryLower.includes("fefo") || queryLower.includes("cold chain") || queryLower.includes("temperature")) {
    localReply = `**FEFO & Cold Chain:**\n\n` +
      `• **FEFO (First-Expired, First-Out):** The system automatically allocates batches with the nearest expiration date to orders first.\n` +
      `• **Cold Chain Monitoring:** Temperature probes track goods during receiving, storage zones (Ambient, Chilled 0–4°C, Frozen -18°C), and delivery trucks. Excursions automatically trigger quarantine holds.`;
  } else if (queryLower.includes("sdi") || queryLower.includes("invoic")) {
    localReply = `**Italian SdI Electronic Invoicing:**\n\n` +
      `• Upon confirmed delivery, the ERP automatically generates invoices reflecting actual delivered and catch-weighted quantities.\n` +
      `• Invoices are converted to official **FatturaPA v1.2.2 XML** and transmitted to the Italian tax agency's **Sistema di Interscambio (SdI)** with 10-year statutory archiving.`;
  } else if (queryLower.includes("how it works") || queryLower.includes("system") || queryLower.includes("architecture")) {
    localReply = `Ascentra ERP connects the entire food distribution chain across 10 stages:\n\n` +
      `1. **Products & Procurement** (Catalogue, catch-weight, supplier POs)\n` +
      `2. **Inbound & Quality Gate** (HACCP temperature check, lot intake)\n` +
      `3. **Warehouse & Inventory** (Bin locations, FEFO rotation)\n` +
      `4. **Customer Orders** (B2B portal, credit checks)\n` +
      `5. **Picking & Packing** (FEFO allocation, catch-weight scales)\n` +
      `6. **Loading & Delivery** (Driver route app, reefer temperature, POD)\n` +
      `7. **Finance & SdI** (FatturaPA XML, bank reconciliation, margins)\n` +
      `8. **Traceability & Recall** (EC 178/2002 batch tracing)\n` +
      `9. **Store Monitoring** (Restaurant chain consumption & orders)\n` +
      `10. **Executive & AI** (CEO KPIs, demand forecasts, Maker-Checker AI approvals)`;
  } else {
    localReply = `I am your Ascentra ERP Assistant. How can I help you? You can ask about our orders, customers, inventory stock, or how any specific feature works.`;
  }

  return {
    reply: localReply,
    provider: "local_grounded_synthesizer",
    model: "ascentra_live_data_engine",
    liveStats: snapshot.stats,
  };
}
