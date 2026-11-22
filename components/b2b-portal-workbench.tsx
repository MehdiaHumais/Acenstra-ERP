"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Building2,
  Calendar,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  Clock,
  CreditCard,
  Download,
  Eye,
  FileCheck2,
  FileText,
  Filter,
  History,
  Info,
  Package,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Store,
  Tag,
  Trash2,
  Truck,
  UserCheck,
  X
} from "lucide-react";
import { Badge, KpiCard, SectionHeader, Surface, statusTone } from "@/components/ui";
import { Can, ViewOnlyBadge } from "@/components/access-gate";
import { money, number, titleCase, dateTime } from "@/lib/format";
import type {
  CatalogProductItem,
  CustomerOrderRecord,
  CustomerOrderDocumentSummary,
  CustomerNotificationRecord,
  CustomerContract
} from "@/server/services/customer-order.service";

interface CustomerOption {
  id: string;
  name: string;
  segment: string;
  customer_type: string;
  city: string;
  credit_limit_cents: number;
  current_exposure_cents: number;
  delivery_address: string;
  payment_terms: string;
  status: string;
  credit_evaluation: {
    credit_limit_cents: number;
    current_exposure_cents: number;
    remaining_credit_cents: number;
    credit_status: "clear" | "warning" | "exceeded" | "blocked";
    is_allowed: boolean;
    reason: string | null;
  };
}

interface CartItem {
  sku: string;
  productName: string;
  category: string;
  cases: number;
  uom: string;
  unitPriceCents: number;
  originalListPriceCents: number;
  discountCents: number;
  pricingSource: string;
  vatRatePct: number;
  availableCases: number;
  minShelfLifeDays: number;
}

const AMENDABLE_ORDER_STATUSES = [
  "draft",
  "submitted",
  "pending_approval",
  "confirmed",
  "partially_confirmed",
  "backordered"
];

interface AmendLineDraft {
  sku: string;
  productName: string;
  cases: number;
  uom: string;
}

export function B2bPortalWorkbench() {
  const [activeTab, setActiveTab] = useState<"catalog" | "cart" | "orders" | "approvals" | "contracts">("catalog");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Customers & active customer
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");

  // Catalog
  const [catalogProducts, setCatalogProducts] = useState<CatalogProductItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedTempZone, setSelectedTempZone] = useState("all");

  // Selected product modal
  const [viewingProduct, setViewingProduct] = useState<CatalogProductItem | null>(null);

  // Cart / Basket
  const [cart, setCart] = useState<CartItem[]>([]);
  const [deliveryDate, setDeliveryDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1); // default tomorrow
    return d.toISOString().slice(0, 10);
  });
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [poReference, setPoReference] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [allowBackorders, setAllowBackorders] = useState(true);
  const [submittingOrder, setSubmittingOrder] = useState(false);

  // Orders
  const [orders, setOrders] = useState<CustomerOrderRecord[]>([]);
  const [orderFilterStatus, setOrderFilterStatus] = useState("all");
  const [orderSearch, setOrderSearch] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<CustomerOrderRecord | null>(null);
  const [orderDocuments, setOrderDocuments] = useState<CustomerOrderDocumentSummary[]>([]);

  // Notifications (in-app, customer scoped by the backend)
  const [notifications, setNotifications] = useState<CustomerNotificationRecord[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);

  // Current effective permissions — used only to hide actions the backend
  // would reject. Every action is still re-authorized server-side.
  const [permissions, setPermissions] = useState<string[]>([]);
  const [sessionRole, setSessionRole] = useState<string>("");

  // Amendment form
  const [amendFormOpen, setAmendFormOpen] = useState(false);
  const [amendDeliveryDate, setAmendDeliveryDate] = useState("");
  const [amendPoReference, setAmendPoReference] = useState("");
  const [amendDeliveryNotes, setAmendDeliveryNotes] = useState("");
  const [amendAllowBackorders, setAmendAllowBackorders] = useState(true);
  const [amendLines, setAmendLines] = useState<AmendLineDraft[]>([]);
  const [amending, setAmending] = useState(false);
  const [transitioningStatus, setTransitioningStatus] = useState(false);

  // Contracts
  const [contracts, setContracts] = useState<CustomerContract[]>([]);

  // Maker-checker approval modal
  const [approvingOrderId, setApprovingOrderId] = useState<string | null>(null);
  const [approvalReason, setApprovalReason] = useState("");
  const [submittingApproval, setSubmittingApproval] = useState(false);

  // 1. Initial Load: Fetch Customers list and effective permissions
  useEffect(() => {
    loadCustomers();
    (async () => {
      try {
        const res = await fetch("/api/v1/auth/me");
        if (res.ok) {
          const body = await res.json();
          setPermissions(Array.isArray(body.permissions) ? body.permissions : []);
          setSessionRole(body.user?.role || "");
        }
      } catch {
        // Permission discovery is best-effort; the backend remains authoritative.
      }
    })();
  }, []);

  // 2. When Selected Customer Changes, Reload Catalog, Orders, Contracts
  useEffect(() => {
    if (selectedCustomerId) {
      loadCustomerData(selectedCustomerId);
    }
  }, [selectedCustomerId]);

  const activeCustomer = useMemo(() => {
    return customers.find((c) => c.id === selectedCustomerId) || customers[0] || null;
  }, [customers, selectedCustomerId]);

  // Sync delivery address when customer changes
  useEffect(() => {
    if (activeCustomer) {
      setDeliveryAddress(activeCustomer.delivery_address || `${activeCustomer.name}, Milan`);
    }
  }, [activeCustomer]);

  const notify = (msg: string) => {
    setSuccessMsg(msg);
    window.setTimeout(() => setSuccessMsg(null), 5000);
  };

  const loadCustomers = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/v1/customer-portal/customers");
      if (!res.ok) throw new Error("Failed to load customer profile");
      const data: CustomerOption[] = await res.json();
      setCustomers(data);
      if (data.length > 0) {
        setSelectedCustomerId(data[0].id);
      }
    } catch (err: any) {
      setError(err.message || "Failed to initialize B2B portal");
    } finally {
      setLoading(false);
    }
  };

  const loadCustomerData = async (custId: string) => {
    try {
      setLoading(true);
      setError(null);

      // Concurrent fetch of catalog, orders, contracts and notifications
      const [catRes, ordRes, ctrRes, notifRes] = await Promise.all([
        fetch(`/api/v1/customer-portal/catalog?customer_id=${encodeURIComponent(custId)}`),
        fetch(`/api/v1/customer-portal/orders?customer_id=${encodeURIComponent(custId)}`),
        fetch(`/api/v1/customer-portal/contracts?customer_id=${encodeURIComponent(custId)}`),
        fetch(`/api/v1/customer-portal/notifications?customer_id=${encodeURIComponent(custId)}&limit=50`)
      ]);

      if (catRes.ok) {
        const catData = await catRes.json();
        setCatalogProducts(catData.products || []);
      }
      if (ordRes.ok) {
        const ordData = await ordRes.json();
        setOrders(ordData || []);
      }
      if (ctrRes.ok) {
        const ctrData = await ctrRes.json();
        setContracts(ctrData || []);
      }
      if (notifRes.ok) {
        const notifData = await notifRes.json();
        setNotifications(notifData.notifications || []);
        setUnreadNotifications(Number(notifData.unread) || 0);
      }
    } catch (err: any) {
      setError(err.message || "Error refreshing customer data");
    } finally {
      setLoading(false);
    }
  };

  // Add SKU to Basket
  const addToCart = (product: CatalogProductItem, quantity = 1) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.sku === product.sku);
      if (existing) {
        return prev.map((item) =>
          item.sku === product.sku
            ? { ...item, cases: item.cases + quantity }
            : item
        );
      }
      return [
        ...prev,
        {
          sku: product.sku,
          productName: product.name,
          category: product.category,
          cases: quantity,
          uom: product.uom,
          unitPriceCents: product.pricing.unit_price_cents,
          originalListPriceCents: product.pricing.original_list_price_cents,
          discountCents: product.pricing.discount_cents,
          pricingSource: product.pricing.pricing_source,
          vatRatePct: product.vat_rate_pct,
          availableCases: product.stock_cases_available,
          minShelfLifeDays: product.min_shelf_life_days_required
        }
      ];
    });
    notify(`Added ${quantity} case(s) of ${product.name} to basket.`);
  };

  const updateCartQuantity = (sku: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.sku === sku) {
            const newQty = item.cases + delta;
            return newQty > 0 ? { ...item, cases: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const removeFromCart = (sku: string) => {
    setCart((prev) => prev.filter((item) => item.sku !== sku));
  };

  // Cart Totals calculation
  const cartTotals = useMemo(() => {
    let subtotalCents = 0;
    let taxCents = 0;
    let casesCount = 0;
    let hasBackorder = false;

    cart.forEach((item) => {
      const lineSub = item.unitPriceCents * item.cases;
      const lineTax = Math.round(lineSub * (item.vatRatePct / 100));
      subtotalCents += lineSub;
      taxCents += lineTax;
      casesCount += item.cases;
      if (item.cases > item.availableCases) {
        hasBackorder = true;
      }
    });

    const totalCents = subtotalCents + taxCents;

    // Projected credit impact
    const currentExp = activeCustomer?.current_exposure_cents || 0;
    const creditLimit = activeCustomer?.credit_limit_cents || 0;
    const projectedExp = currentExp + totalCents;
    const isCreditExceeded = projectedExp > creditLimit;
    const excessCents = Math.max(0, projectedExp - creditLimit);

    return {
      subtotalCents,
      taxCents,
      totalCents,
      casesCount,
      hasBackorder,
      projectedExp,
      isCreditExceeded,
      excessCents,
      remainingCreditCents: creditLimit - projectedExp
    };
  }, [cart, activeCustomer]);

  // Submit Order to Backend
  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCustomer || cart.length === 0) return;

    try {
      setSubmittingOrder(true);
      setError(null);

      const payload = {
        customer_id: activeCustomer.id,
        channel: "b2b_portal",
        po_reference: poReference || undefined,
        delivery_date: deliveryDate,
        delivery_address: deliveryAddress,
        delivery_notes: deliveryNotes || undefined,
        allow_backorders: allowBackorders,
        lines: cart.map((item) => ({
          sku: item.sku,
          cases: item.cases,
          uom: item.uom
        }))
      };

      const res = await fetch("/api/v1/customer-portal/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || "Failed to submit customer order");
      }

      setCart([]);
      setPoReference("");
      setDeliveryNotes("");
      notify(`Order ${data.order_number} submitted successfully! Status: ${data.status.toUpperCase()}`);

      // Refresh customer data and open the newly created order
      await loadCustomerData(activeCustomer.id);
      await openOrderDetail(data);
      setActiveTab("orders");
    } catch (err: any) {
      setError(err.message || "Order submission error");
    } finally {
      setSubmittingOrder(false);
    }
  };

  // Cancel Order
  const handleCancelOrder = async (order: CustomerOrderRecord) => {
    const reason = window.prompt("Please enter cancellation reason:", "Customer requested cancellation via portal");
    if (!reason) return;

    try {
      const res = await fetch(`/api/v1/customer-portal/orders/${order.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to cancel order");

      notify(`Order ${order.order_number} cancelled. Reserved stock released.`);
      if (selectedCustomerId) {
        await loadCustomerData(selectedCustomerId);
      }
      await openOrderDetail(data);
    } catch (err: any) {
      alert(err.message || "Cancellation error");
    }
  };

  // Maker-Checker Credit Approval
  const handleApproveCredit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approvingOrderId || !approvalReason.trim()) return;

    try {
      setSubmittingApproval(true);
      const res = await fetch(`/api/v1/customer-portal/orders/${approvingOrderId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: approvalReason.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Approval failed");

      notify(`Order ${data.order_number} approved! Stock reserved and status set to CONFIRMED.`);
      setApprovingOrderId(null);
      setApprovalReason("");
      if (selectedCustomerId) {
        await loadCustomerData(selectedCustomerId);
      }
      await openOrderDetail(data);
    } catch (err: any) {
      alert(err.message || "Approval error");
    } finally {
      setSubmittingApproval(false);
    }
  };

  // Effective permission check (wildcard aware, dot/colon equivalent)
  const can = (permission: string): boolean => {
    if (permissions.includes("*")) return true;
    return (
      permissions.includes(permission) ||
      permissions.includes(permission.replace(".", ":")) ||
      permissions.includes(permission.replace(":", "."))
    );
  };

  // Hide internal credit controls until we know the role (staff-only feature).
  // `sessionRole === ""` means the role hasn't resolved yet — treat as hidden.
  const isStoreAccount = !sessionRole || sessionRole === "store_vendor" || sessionRole === "store_user";

  const isPreConfirmationStatus = (status: string): boolean =>
    status === "draft" || status === "submitted" || status === "pending_approval";

  const canAmendOrder = (order: CustomerOrderRecord | null): boolean => {
    if (!order) return false;
    if (!AMENDABLE_ORDER_STATUSES.includes(order.status)) return false;
    if (!can("orders.manage") && !can("orders:manage") && !can("orders:write")) return false;
    if (isPreConfirmationStatus(order.status)) return true;
    return can("orders.amend");
  };

  // Fulfilment transitions are an internal operations action, not a customer one.
  const canManageFulfilment =
    can("orders.manage") && sessionRole !== "store_vendor" && sessionRole !== "store_user";

  // Load a full order detail (timeline + notifications) and its documents.
  const openOrderDetail = async (order: CustomerOrderRecord) => {
    setSelectedOrder(order);
    setOrderDocuments([]);
    setAmendFormOpen(false);
    setAmendDeliveryDate(order.delivery_date);
    setAmendPoReference(order.po_reference || "");
    setAmendDeliveryNotes(order.delivery_notes || "");
    setAmendAllowBackorders(true);
    setAmendLines(
      order.lines.map((line) => ({
        sku: line.sku,
        productName: line.product_name,
        cases: line.cases_ordered,
        uom: line.uom
      }))
    );

    try {
      const [detailRes, docsRes] = await Promise.all([
        fetch(`/api/v1/customer-portal/orders/${order.id}`),
        fetch(`/api/v1/customer-portal/orders/${order.id}/documents`)
      ]);
      if (detailRes.ok) {
        const detail: CustomerOrderRecord = await detailRes.json();
        setSelectedOrder(detail);
        setAmendDeliveryDate(detail.delivery_date);
        setAmendPoReference(detail.po_reference || "");
        setAmendDeliveryNotes(detail.delivery_notes || "");
        setAmendLines(
          detail.lines.map((line) => ({
            sku: line.sku,
            productName: line.product_name,
            cases: line.cases_ordered,
            uom: line.uom
          }))
        );
      }
      if (docsRes.ok) {
        const docs = await docsRes.json();
        setOrderDocuments(Array.isArray(docs.documents) ? docs.documents : []);
      }
    } catch {
      // Detail enrichment is best-effort; the order summary is already displayed.
    }
  };

  const markNotificationRead = async (notification: CustomerNotificationRecord) => {
    if (notification.read_at) return;
    try {
      const res = await fetch(
        `/api/v1/customer-portal/notifications/${encodeURIComponent(notification.id)}/read`,
        { method: "POST" }
      );
      if (!res.ok) return;
      const updated: CustomerNotificationRecord = await res.json();
      setNotifications((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
      setUnreadNotifications((prev) => Math.max(0, prev - 1));
    } catch {
      // Ignore read-receipt failures; the badge stays until the next refresh.
    }
  };

  const markAllNotificationsRead = async () => {
    const unread = notifications.filter((entry) => !entry.read_at);
    for (const entry of unread) {
      await markNotificationRead(entry);
    }
  };

  const handleAmendOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder) return;
    const lines = amendLines.filter((line) => line.cases > 0);
    if (lines.length === 0) {
      alert("The amended order must contain at least one line.");
      return;
    }

    try {
      setAmending(true);
      const res = await fetch(
        `/api/v1/customer-portal/orders/${encodeURIComponent(selectedOrder.id)}/amend`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            delivery_date: amendDeliveryDate,
            po_reference: amendPoReference || null,
            delivery_notes: amendDeliveryNotes || null,
            allow_backorders: amendAllowBackorders,
            lines: lines.map((line) => ({ sku: line.sku, cases: line.cases, uom: line.uom }))
          })
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || "Failed to amend order");
      }

      notify(
        `Order ${data.order_number} amended. New total ${money(data.total_cents)} · Status ${String(
          data.status
        )
          .replace(/_/g, " ")
          .toUpperCase()}`
      );
      setAmendFormOpen(false);
      if (selectedCustomerId) await loadCustomerData(selectedCustomerId);
      await openOrderDetail(data);
    } catch (err: any) {
      alert(err.message || "Amendment error");
    } finally {
      setAmending(false);
    }
  };

  const handleTransitionStatus = async (toStatus: "processing" | "completed") => {
    if (!selectedOrder) return;
    try {
      setTransitioningStatus(true);
      const res = await fetch(
        `/api/v1/customer-portal/orders/${encodeURIComponent(selectedOrder.id)}/status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to_status: toStatus,
            reason:
              toStatus === "processing"
                ? "Warehouse picking started from operations console"
                : "Fulfilment completed and delivery confirmed"
          })
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || "Failed to update order status");
      }
      notify(`Order ${data.order_number} is now ${String(data.status).replace(/_/g, " ").toUpperCase()}.`);
      if (selectedCustomerId) await loadCustomerData(selectedCustomerId);
      await openOrderDetail(data);
    } catch (err: any) {
      alert(err.message || "Status transition error");
    } finally {
      setTransitioningStatus(false);
    }
  };

  // Filtered Products
  const filteredProducts = useMemo(() => {
    return catalogProducts.filter((p) => {
      const matchesSearch =
        !searchQuery.trim() ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.category.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategory === "all" || p.category.toLowerCase() === selectedCategory.toLowerCase();
      const matchesTemp = selectedTempZone === "all" || p.temp_zone.toLowerCase().includes(selectedTempZone.toLowerCase());
      return matchesSearch && matchesCategory && matchesTemp;
    });
  }, [catalogProducts, searchQuery, selectedCategory, selectedTempZone]);

  // Categories list
  const categories = useMemo(() => {
    const set = new Set(catalogProducts.map((p) => p.category));
    return ["all", ...Array.from(set)];
  }, [catalogProducts]);

  // Orders Filtered
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const matchesStatus = orderFilterStatus === "all" || o.status === orderFilterStatus;
      const matchesSearch =
        !orderSearch.trim() ||
        o.order_number.toLowerCase().includes(orderSearch.toLowerCase()) ||
        o.po_reference?.toLowerCase().includes(orderSearch.toLowerCase());
      return matchesStatus && matchesSearch;
    });
  }, [orders, orderFilterStatus, orderSearch]);

  const pendingApprovals = useMemo(() => {
    return orders.filter((o) => o.status === "pending_approval" || o.credit_hold);
  }, [orders]);

  return (
    <div className="space-y-6">
      {/* Feedback alerts */}
      {successMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-marine-ocean/60 bg-marine-ocean/25 px-4 py-3 text-sm font-medium text-marine-navy shadow-sm animate-in fade-in">
          <CheckCircle2 className="h-5 w-5 text-marine-mid shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-900 shadow-sm animate-in fade-in">
          <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Top Customer Header & Account Exposure */}
      <Surface className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
                B2B Customer Account
              </span>
              {activeCustomer && !isStoreAccount && (
                <Badge tone={activeCustomer.credit_evaluation.credit_status === "clear" ? "ok" : activeCustomer.credit_evaluation.credit_status === "warning" ? "warning" : "critical"} dot>
                  Credit: {activeCustomer.credit_evaluation.credit_status.toUpperCase()}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                {activeCustomer?.name || "Customer Portal"}
              </h1>
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                {activeCustomer?.segment} · {activeCustomer?.city}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {activeCustomer?.delivery_address} · Payment Terms: <span className="font-semibold text-foreground">{activeCustomer?.payment_terms}</span>
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {/* In-app notifications */}
            <div className="relative self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setShowNotifications((prev) => !prev)}
                className="relative flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-semibold shadow-sm hover:bg-muted"
              >
                <Bell className="h-3.5 w-3.5" />
                <span>Notifications</span>
                {unreadNotifications > 0 && (
                  <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {unreadNotifications}
                  </span>
                )}
              </button>

              {showNotifications && (
                <div className="absolute right-0 z-40 mt-2 w-80 max-h-96 overflow-y-auto rounded-xl border border-border bg-background shadow-2xl">
                  <div className="flex items-center justify-between border-b border-border px-3 py-2">
                    <span className="text-xs font-bold text-foreground">Customer Notifications</span>
                    <Can permission="orders.read" mode="disable">
                      <button
                        type="button"
                        onClick={markAllNotificationsRead}
                        disabled={unreadNotifications === 0}
                        className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline disabled:opacity-40"
                      >
                        <CheckCheck className="h-3 w-3" /> Mark all read
                      </button>
                    </Can>
                  </div>

                  {notifications.length === 0 ? (
                    <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
                      No notifications yet.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {notifications.map((entry) => (
                        <li
                          key={entry.id}
                          className={`px-3 py-2.5 text-xs ${entry.read_at ? "bg-background" : "bg-primary/5"}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground">{entry.title}</p>
                              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                                {entry.body}
                              </p>
                              <p className="mt-1 text-[10px] text-muted-foreground">
                                {dateTime(entry.created_at)}
                                {entry.order_number ? ` · ${entry.order_number}` : ""}
                                {entry.read_at ? " · Read" : " · Unread"}
                              </p>
                            </div>
                            {!entry.read_at && (
                              <Can permission="orders.read" mode="disable">
                                <button
                                  type="button"
                                  onClick={() => markNotificationRead(entry)}
                                  className="shrink-0 rounded bg-muted px-2 py-1 text-[10px] font-semibold hover:bg-muted/80"
                                >
                                  Mark read
                                </button>
                              </Can>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Customer Switcher (for authorized staff order-entry on behalf of customer) */}
            {customers.length > 1 && (
              <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
                <label htmlFor="customer-select" className="text-xs font-medium text-muted-foreground">
                  Ordering as / on behalf of:
                </label>
                <select
                  id="customer-select"
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(e.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-xs font-semibold shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.segment}{isStoreAccount ? "" : ` · Credit ${money(c.credit_limit_cents)}`})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Live Credit Exposure KPI bar (staff only — vendors cannot see Ascentra credit internals) */}
        {activeCustomer && (
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4 sm:grid-cols-4 lg:grid-cols-5">
            {!isStoreAccount && (
              <>
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground">Credit Limit</p>
                  <p className="text-base font-bold text-foreground">{money(activeCustomer.credit_limit_cents)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground">Current Exposure</p>
                  <p className="text-base font-bold text-amber-700">{money(activeCustomer.current_exposure_cents)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground">Remaining Credit</p>
                  <p className={`text-base font-bold ${activeCustomer.credit_evaluation.remaining_credit_cents > 0 ? "text-marine-mid" : "text-red-600"}`}>
                    {money(activeCustomer.credit_evaluation.remaining_credit_cents)}
                  </p>
                </div>
              </>
            )}
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Active Contracts</p>
              <p className="text-base font-bold text-foreground">{contracts.length} agreements</p>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <p className="text-[11px] font-medium text-muted-foreground">Basket Items</p>
              <button
                onClick={() => setActiveTab("cart")}
                className="flex items-center gap-1.5 text-sm font-bold text-primary hover:underline"
              >
                <ShoppingCart className="h-4 w-4" />
                {cart.length} SKUs ({cartTotals.casesCount} cases) · {money(cartTotals.totalCents)}
              </button>
            </div>
          </div>
        )}
      </Surface>

      {/* Navigation Tabs */}
      <div className="flex border-b border-border bg-background">
        <button
          onClick={() => setActiveTab("catalog")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-xs font-semibold transition-colors ${
            activeTab === "catalog"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Package className="h-4 w-4" />
          <span>Product Catalogue</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">{catalogProducts.length}</span>
        </button>

        <button
          onClick={() => setActiveTab("cart")}
          className={`relative flex items-center gap-2 border-b-2 px-5 py-3 text-xs font-semibold transition-colors ${
            activeTab === "cart"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <ShoppingCart className="h-4 w-4" />
          <span>Shopping Basket</span>
          {cart.length > 0 && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] text-white">
              {cart.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("orders")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-xs font-semibold transition-colors ${
            activeTab === "orders"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileText className="h-4 w-4" />
          <span>Order History & Tracking</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">{orders.length}</span>
        </button>

        {pendingApprovals.length > 0 && (
          <button
            onClick={() => setActiveTab("approvals")}
            className={`flex items-center gap-2 border-b-2 px-5 py-3 text-xs font-semibold transition-colors ${
              activeTab === "approvals"
                ? "border-amber-600 text-amber-700"
                : "border-transparent text-amber-700 hover:text-amber-800"
            }`}
          >
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            <span>Credit Approvals</span>
            <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] text-amber-900 font-bold">
              {pendingApprovals.length}
            </span>
          </button>
        )}

        <button
          onClick={() => setActiveTab("contracts")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-xs font-semibold transition-colors ${
            activeTab === "contracts"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Tag className="h-4 w-4" />
          <span>Pricing & Contracts</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: PRODUCT CATALOGUE                                                  */}
      {/* ========================================================================= */}
      {activeTab === "catalog" && (
        <div className="space-y-4">
          {/* Search & Category Filter Bar */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 sm:max-w-md">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products by name, SKU or category..."
                className="w-full rounded-md border border-input bg-background pl-9 pr-4 py-2 text-xs shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">Category:</span>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="rounded-md border border-input bg-background px-2.5 py-1.5 text-xs shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c === "all" ? "All Categories" : c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">Zone:</span>
                <select
                  value={selectedTempZone}
                  onChange={(e) => setSelectedTempZone(e.target.value)}
                  className="rounded-md border border-input bg-background px-2.5 py-1.5 text-xs shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="all">All Zones</option>
                  <option value="chilled">Chilled</option>
                  <option value="frozen">Frozen</option>
                  <option value="ambient">Ambient</option>
                </select>
              </div>
            </div>
          </div>

          {/* Product Cards Grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredProducts.map((p) => {
              const inCart = cart.find((item) => item.sku === p.sku);
              const pricing = p.pricing;
              const hasDiscount = pricing.discount_cents > 0;

              return (
                <Surface key={p.sku} className="flex flex-col justify-between overflow-hidden p-4 transition-all hover:shadow-md">
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {p.category} · {p.sku}
                      </span>
                      <Badge tone={p.is_in_stock ? "ok" : "warning"} dot>
                        {p.is_in_stock ? `${p.stock_cases_available} in stock` : "Backorder"}
                      </Badge>
                    </div>

                    <h3
                      onClick={() => setViewingProduct(p)}
                      className="cursor-pointer text-sm font-semibold text-foreground hover:text-primary transition-colors line-clamp-2"
                      title={p.name}
                    >
                      {p.name}
                    </h3>

                    <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                      <span>{p.uom}</span>
                      <span>·</span>
                      <span>{p.temp_zone}</span>
                    </div>

                    {/* Shelf-life & compliance tag */}
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Clock className="h-3 w-3 text-primary" />
                      <span>Min shelf-life at delivery: <strong>{p.min_shelf_life_days_required} days</strong></span>
                    </div>

                    {/* Pricing Badge */}
                    <div className="rounded-lg bg-muted/60 p-2.5 space-y-1">
                      <div className="flex items-baseline justify-between">
                        <div>
                          <span className="text-base font-bold text-foreground">
                            {money(pricing.unit_price_cents)}
                          </span>
                          <span className="text-[10px] text-muted-foreground"> / {p.uom}</span>
                        </div>
                        {hasDiscount && (
                          <span className="text-xs text-muted-foreground line-through">
                            {money(pricing.original_list_price_cents)}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        {pricing.pricing_source === "promotion" && (
                          <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800">
                            <Tag className="h-2.5 w-2.5" /> Promo Rate (-{pricing.discount_pct}%)
                          </span>
                        )}
                        {pricing.pricing_source === "contract_tier" && (
                          <span className="inline-flex items-center gap-1 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-800">
                            Volume Tier (-{pricing.discount_pct}%)
                          </span>
                        )}
                        {pricing.pricing_source === "contract_base" && (
                          <span className="inline-flex items-center gap-1 rounded bg-marine-ocean/35 px-1.5 py-0.5 text-[10px] font-bold text-marine-mid/90">
                            Contract Rate
                          </span>
                        )}
                        {pricing.pricing_source === "segment" && (
                          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">
                            Segment Price
                          </span>
                        )}
                        {pricing.pricing_source === "standard" && (
                          <span className="rounded bg-marine-ocean/35 px-1.5 py-0.5 text-[10px] font-medium text-marine-mid/80">
                            Standard Catalog
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions: Add to Cart & Inspect */}
                  <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
                    <button
                      onClick={() => setViewingProduct(p)}
                      className="text-xs font-semibold text-muted-foreground hover:text-foreground"
                    >
                      Details
                    </button>

                    {inCart ? (
                      <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-2 py-1">
                        <button
                          onClick={() => updateCartQuantity(p.sku, -1)}
                          className="h-6 w-6 rounded bg-background text-xs font-bold shadow-sm hover:bg-muted"
                        >
                          -
                        </button>
                        <span className="min-w-[1.5rem] text-center text-xs font-bold text-primary">
                          {inCart.cases}
                        </span>
                        <button
                          onClick={() => updateCartQuantity(p.sku, 1)}
                          className="h-6 w-6 rounded bg-background text-xs font-bold shadow-sm hover:bg-muted"
                        >
                          +
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => addToCart(p, 1)}
                        className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-opacity hover:opacity-90"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add to basket
                      </button>
                    )}
                  </div>
                </Surface>
              );
            })}
          </div>

          {filteredProducts.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-12 text-center">
              <Package className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-semibold">No products found</p>
              <p className="text-xs text-muted-foreground">Try adjusting your search or category filters.</p>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: SHOPPING BASKET & ORDER SUBMISSION                                 */}
      {/* ========================================================================= */}
      {activeTab === "cart" && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Cart Items List */}
          <Surface className="lg:col-span-2 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h2 className="text-base font-bold text-foreground">Order Items Basket</h2>
                <p className="text-xs text-muted-foreground">Review products, verified contract prices, and quantities</p>
              </div>
              {cart.length > 0 && (
                <button
                  onClick={() => setCart([])}
                  className="flex items-center gap-1 text-xs font-semibold text-red-600 hover:underline"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Clear basket
                </button>
              )}
            </div>

            {cart.length === 0 ? (
              <div className="py-12 text-center space-y-3">
                <ShoppingCart className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="text-sm font-semibold">Your basket is currently empty</p>
                <button
                  onClick={() => setActiveTab("catalog")}
                  className="rounded-md bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm hover:opacity-90"
                >
                  Browse Catalogue
                </button>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {cart.map((item) => {
                  const lineSubtotal = item.unitPriceCents * item.cases;
                  const isStockShortfall = item.cases > item.availableCases;

                  return (
                    <div key={item.sku} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-foreground">{item.productName}</span>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                            {item.sku}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{money(item.unitPriceCents)} / {item.uom}</span>
                          {item.discountCents > 0 && (
                            <span className="text-marine-mid font-medium">
                              (Contract discount: {money(item.discountCents)})
                            </span>
                          )}
                        </div>

                        {isStockShortfall && (
                          <div className="flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            <span>
                              Stock notice: {item.availableCases} available today. Remainder ({item.cases - item.availableCases} cases) will be backordered.
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Quantity Stepper & Line Total */}
                      <div className="flex items-center justify-between sm:justify-end gap-4">
                        <div className="flex items-center gap-1 rounded-md border border-input bg-background p-1">
                          <button
                            type="button"
                            onClick={() => updateCartQuantity(item.sku, -1)}
                            className="h-7 w-7 rounded bg-muted/60 text-xs font-bold hover:bg-muted"
                          >
                            -
                          </button>
                          <span className="w-10 text-center text-xs font-bold">{item.cases}</span>
                          <button
                            type="button"
                            onClick={() => updateCartQuantity(item.sku, 1)}
                            className="h-7 w-7 rounded bg-muted/60 text-xs font-bold hover:bg-muted"
                          >
                            +
                          </button>
                        </div>

                        <div className="min-w-[5rem] text-right">
                          <p className="text-sm font-bold text-foreground">{money(lineSubtotal)}</p>
                          <p className="text-[10px] text-muted-foreground">+VAT {item.vatRatePct}%</p>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeFromCart(item.sku)}
                          className="text-muted-foreground hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Surface>

          {/* Checkout & Delivery Controls */}
          <Surface className="p-5 space-y-5">
            <h2 className="text-base font-bold text-foreground border-b border-border pb-3">
              Delivery & Order Confirmation
            </h2>

            <form onSubmit={handleSubmitOrder} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground">
                  Requested Delivery Date (Promise Date) *
                </label>
                <div className="relative mt-1">
                  <Calendar className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <input
                    type="date"
                    required
                    value={deliveryDate}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setDeliveryDate(e.target.value)}
                    className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-xs font-semibold shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground">
                  Delivery Destination Address *
                </label>
                <input
                  type="text"
                  required
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  placeholder="Street, City, Postal Code"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-xs shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground">
                  Customer PO / Reference Number
                </label>
                <input
                  type="text"
                  value={poReference}
                  onChange={(e) => setPoReference(e.target.value)}
                  placeholder="e.g. PO-CRACCO-8812"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-xs shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground">
                  Special Delivery Instructions
                </label>
                <textarea
                  rows={2}
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                  placeholder="e.g. Kitchen rear dock loading door 2, ring chef on arrival."
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-xs shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="backorders"
                  checked={allowBackorders}
                  onChange={(e) => setAllowBackorders(e.target.checked)}
                  className="rounded border-input text-primary focus:ring-primary"
                />
                <label htmlFor="backorders" className="text-xs font-medium text-foreground cursor-pointer">
                  Allow partial shipments & backorders if stock is short
                </label>
              </div>

              {/* Order Cost Summary */}
              <div className="rounded-lg bg-muted/60 p-4 space-y-2 text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>Lines Subtotal</span>
                  <span className="font-semibold text-foreground">{money(cartTotals.subtotalCents)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Applicable VAT</span>
                  <span className="font-semibold text-foreground">{money(cartTotals.taxCents)}</span>
                </div>
                <div className="flex justify-between border-t border-border/80 pt-2 text-sm font-bold text-foreground">
                  <span>Total Payable</span>
                  <span className="text-primary">{money(cartTotals.totalCents)}</span>
                </div>
              </div>

              {/* Credit Limit Verification Box (staff only; vendors see a neutral eligibility note) */}
              {!isStoreAccount && (
                <div className="rounded-lg border p-3 text-xs space-y-1.5">
                  <div className="flex items-center justify-between font-semibold">
                    <span>Credit Limit Check</span>
                    {cartTotals.isCreditExceeded ? (
                      <Badge tone="critical" dot>EXCEEDED</Badge>
                    ) : (
                      <Badge tone="ok" dot>CLEAR</Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Credit Limit: {money(activeCustomer?.credit_limit_cents || 0)} · Current: {money(activeCustomer?.current_exposure_cents || 0)}
                  </p>
                  {cartTotals.isCreditExceeded ? (
                    <div className="rounded bg-red-50 p-2 text-red-800 text-[11px]">
                      <strong>Requires Maker-Checker Approval:</strong> This order exceeds permitted limit by {money(cartTotals.excessCents)}. Order will be placed into <em>Pending Approval</em>.
                    </div>
                  ) : (
                    <p className="text-[11px] text-marine-mid/90">
                      Remaining after order: <strong>{money(cartTotals.remainingCreditCents)}</strong>. Instant confirmation and FEFO lot allocation.
                    </p>
                  )}
                </div>
              )}
              {isStoreAccount && (
                <div className="rounded-lg border border-marine-ocean/40 bg-marine-ocean/10 p-3 text-[11px] leading-5 text-marine-navy">
                  Eligibility (credit status, capacity and shelf-life rules) is validated automatically when you submit. You will be notified if any item needs review.
                </div>
              )}

              <Can permission="orders.manage" mode="disable">
                <button
                  type="submit"
                  disabled={cart.length === 0 || submittingOrder}
                  className="w-full rounded-md bg-primary py-2.5 text-xs font-bold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {submittingOrder ? "Validating & Submitting..." : "Submit Customer Order"}
                </button>
              </Can>
            </form>
          </Surface>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: ORDER HISTORY & TRACKING                                           */}
      {/* ========================================================================= */}
      {activeTab === "orders" && (
        <Surface className="p-5 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
            <div>
              <h2 className="text-base font-bold text-foreground">Customer Order Ledger</h2>
              <p className="text-xs text-muted-foreground">
                Live order state machine, FEFO lot genealogy allocations, delivery routes & POD
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  placeholder="Filter order number / PO..."
                  className="rounded-md border border-input bg-background pl-8 pr-3 py-1 text-xs shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <select
                value={orderFilterStatus}
                onChange={(e) => setOrderFilterStatus(e.target.value)}
                className="rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="all">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
                <option value="pending_approval">Pending Approval</option>
                <option value="confirmed">Confirmed</option>
                <option value="partially_confirmed">Partially Confirmed</option>
                <option value="backordered">Backordered</option>
                <option value="processing">Processing</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {filteredOrders.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-xs">
              No orders found matching the filter criteria.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-[11px] font-bold text-muted-foreground">
                    <th className="py-2.5 px-3">Order Number</th>
                    <th className="py-2.5 px-3">Customer</th>
                    <th className="py-2.5 px-3">Delivery Date</th>
                    <th className="py-2.5 px-3">Items / Cases</th>
                    <th className="py-2.5 px-3">Total</th>
                    <th className="py-2.5 px-3">Workflow Status</th>
                    <th className="py-2.5 px-3">Credit Check</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredOrders.map((ord) => {
                    return (
                      <tr key={ord.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-3 font-mono font-bold text-primary">
                          <button
                            onClick={() => openOrderDetail(ord)}
                            className="hover:underline flex items-center gap-1"
                          >
                            {ord.order_number}
                          </button>
                        </td>
                        <td className="py-3 px-3 font-semibold text-foreground">
                          {ord.customer_name}
                        </td>
                        <td className="py-3 px-3 text-muted-foreground">
                          {ord.delivery_date}
                        </td>
                        <td className="py-3 px-3">
                          {ord.items_count} lines ({ord.cases_total} cs)
                        </td>
                        <td className="py-3 px-3 font-bold text-foreground">
                          {money(ord.total_cents)}
                        </td>
                        <td className="py-3 px-3">
                          <Badge tone={statusTone(ord.status)} dot>
                            {ord.status.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="py-3 px-3">
                          {ord.credit_hold ? (
                            <span className="text-[11px] font-bold text-red-600 flex items-center gap-1">
                              <ShieldAlert className="h-3.5 w-3.5" /> Hold
                            </span>
                          ) : (
                            <span className="text-[11px] font-semibold text-marine-mid flex items-center gap-1">
                              <ShieldCheck className="h-3.5 w-3.5" /> Approved
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right space-x-2">
                          <button
                            onClick={() => openOrderDetail(ord)}
                            className="rounded bg-muted px-2.5 py-1 text-xs font-semibold hover:bg-muted/80"
                          >
                            Inspect
                          </button>
                          {ord.status !== "cancelled" && (ord.status as string) !== "delivered" && ord.status !== "completed" && (
                            <Can permission="orders.manage" mode="hide">
                              <button
                                onClick={() => handleCancelOrder(ord)}
                                className="rounded bg-red-50 text-red-700 px-2.5 py-1 text-xs font-semibold hover:bg-red-100"
                              >
                                Cancel
                              </button>
                            </Can>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Surface>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: MAKER-CHECKER CREDIT APPROVALS                                     */}
      {/* ========================================================================= */}
      {activeTab === "approvals" && (
        <Surface className="p-5 space-y-4">
          <SectionHeader
            eyebrow="Maker-Checker Governance"
            title="Pending Credit & Order Approvals"
            description="Orders exceeding standard customer credit limits require authorized override approval with audit rationale before warehouse picking release."
            action={(
              <span className="flex items-center gap-2">
                <ViewOnlyBadge modifyPermissions={["orders.manage", "orders:credit_override"]} />
                <Badge tone="critical">{pendingApprovals.length} pending approval</Badge>
              </span>
            )}
          />

          <div className="space-y-4 pt-2">
            {pendingApprovals.map((ord) => (
              <div key={ord.id} className="rounded-lg border border-amber-300 bg-amber-50/40 p-4 space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-primary">{ord.order_number}</span>
                      <span className="text-xs font-semibold text-foreground">· {ord.customer_name}</span>
                      <Badge tone="critical">Credit Hold</Badge>
                    </div>
                    <p className="text-xs text-amber-900 mt-1">
                      {ord.credit_hold_reason || "Projected customer credit exposure exceeds ceiling."}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-base font-bold text-foreground">{money(ord.total_cents)}</p>
                    <p className="text-[11px] text-muted-foreground">{ord.cases_total} cases · Due {ord.delivery_date}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-amber-200 pt-3">
                  <button
                    onClick={() => openOrderDetail(ord)}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    View order line breakdown
                  </button>

                  <div className="flex items-center gap-2">
                    <Can permission="orders.manage" mode="hide">
                      <button
                        onClick={() => handleCancelOrder(ord)}
                        className="rounded bg-white px-3 py-1.5 text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50"
                      >
                        Reject Order
                      </button>
                    </Can>
                    <Can permission="orders:credit_override" mode="hide">
                      <button
                        onClick={() => setApprovingOrderId(ord.id)}
                        className="rounded bg-marine-steel px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-marine-steelLight"
                      >
                        Approve Override
                      </button>
                    </Can>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Surface>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: CUSTOMER CONTRACTS & PRICING                                       */}
      {/* ========================================================================= */}
      {activeTab === "contracts" && (
        <Surface className="p-5 space-y-5">
          <SectionHeader
            eyebrow="Commercial Terms"
            title="Customer Pricing & Supply Contracts"
            description="Governed customer contract pricing, tiered volume discounts, and seasonal promotional rates."
            action={(
              <span className="flex items-center gap-2">
                <ViewOnlyBadge modifyPermissions={["orders.manage", "orders:credit_override"]} />
                <Badge tone="ok">{contracts.length} active agreements</Badge>
              </span>
            )}
          />

          <div className="space-y-6">
            {contracts.map((ctr) => (
              <div key={ctr.id} className="rounded-xl border border-border p-4 space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-primary">{ctr.contract_number}</span>
                      <h3 className="text-sm font-bold text-foreground">{ctr.title}</h3>
                      <Badge tone={ctr.status === "active" ? "ok" : "warning"}>{ctr.status.toUpperCase()}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Valid: {ctr.start_date} to {ctr.end_date} · Currency: {ctr.currency} · Payment Terms: {ctr.payment_terms}
                    </p>
                  </div>
                </div>

                {/* Items in this contract */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/30 text-[10px] font-bold text-muted-foreground uppercase">
                        <th className="py-2 px-3">SKU</th>
                        <th className="py-2 px-3">Product Name</th>
                        <th className="py-2 px-3">Min Qty (Tier)</th>
                        <th className="py-2 px-3">Contract Rate</th>
                        <th className="py-2 px-3">Discount</th>
                        <th className="py-2 px-3">Active Promo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {ctr.items.map((it) => (
                        <tr key={it.id}>
                          <td className="py-2.5 px-3 font-mono font-semibold">{it.sku}</td>
                          <td className="py-2.5 px-3 font-medium text-foreground">{it.product_name || it.sku}</td>
                          <td className="py-2.5 px-3 font-semibold">
                            {it.min_quantity > 1 ? `>= ${it.min_quantity} cases` : "1 case (base)"}
                          </td>
                          <td className="py-2.5 px-3 font-bold text-primary">{money(it.unit_price_cents)}</td>
                          <td className="py-2.5 px-3 text-marine-mid font-semibold">
                            {it.discount_pct > 0 ? `-${it.discount_pct}%` : "Standard"}
                          </td>
                          <td className="py-2.5 px-3">
                            {it.promotional_price_cents ? (
                              <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800">
                                {money(it.promotional_price_cents)} ({it.promo_start?.slice(0, 10)} to {it.promo_end?.slice(0, 10)})
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </Surface>
      )}

      {/* ========================================================================= */}
      {/* MODAL: PRODUCT DETAIL INSPECTION                                          */}
      {/* ========================================================================= */}
      {viewingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-background p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-start justify-between border-b border-border pb-3">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                  {viewingProduct.category} · {viewingProduct.sku}
                </span>
                <h3 className="text-lg font-bold text-foreground">{viewingProduct.name}</h3>
              </div>
              <button onClick={() => setViewingProduct(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg bg-muted/60 p-3">
                <p className="text-[10px] text-muted-foreground">Unit of Measure & Pack</p>
                <p className="font-semibold">{viewingProduct.uom}</p>
              </div>
              <div className="rounded-lg bg-muted/60 p-3">
                <p className="text-[10px] text-muted-foreground">Storage Zone</p>
                <p className="font-semibold">{viewingProduct.temp_zone}</p>
              </div>
              <div className="rounded-lg bg-muted/60 p-3">
                <p className="text-[10px] text-muted-foreground">Standard Shelf Life</p>
                <p className="font-semibold">{viewingProduct.shelf_life_days} days</p>
              </div>
              <div className="rounded-lg bg-muted/60 p-3">
                <p className="text-[10px] text-muted-foreground">Min Customer Shelf Life</p>
                <p className="font-semibold text-marine-mid/90">{viewingProduct.min_shelf_life_days_required} days guaranteed</p>
              </div>
            </div>

            {/* Pricing details */}
            <div className="rounded-lg border border-border p-3 text-xs space-y-1.5">
              <div className="flex justify-between font-bold">
                <span>Contract Unit Price</span>
                <span className="text-primary text-sm">{money(viewingProduct.pricing.unit_price_cents)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Catalog List Price</span>
                <span>{money(viewingProduct.pricing.original_list_price_cents)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Pricing Rule Applied</span>
                <span className="font-semibold uppercase">{viewingProduct.pricing.pricing_source}</span>
              </div>
            </div>

            {/* Allergens */}
            {viewingProduct.allergens.length > 0 && (
              <div className="text-xs space-y-1">
                <p className="text-[11px] font-semibold text-muted-foreground">Allergen Declarations:</p>
                <div className="flex flex-wrap gap-1">
                  {viewingProduct.allergens.map((alg) => (
                    <span key={alg} className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                      {alg}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <button
                onClick={() => setViewingProduct(null)}
                className="rounded-md border border-input bg-background px-4 py-2 text-xs font-semibold hover:bg-muted"
              >
                Close
              </button>
              <button
                onClick={() => {
                  addToCart(viewingProduct, 1);
                  setViewingProduct(null);
                }}
                className="rounded-md bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm hover:opacity-90"
              >
                Add 1 Case to Basket
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ORDER DETAILS, TIMELINE, DOCUMENTS & AMENDMENTS                     */}
      {/* ========================================================================= */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-background p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-start justify-between border-b border-border pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-foreground">Order Workspace · {selectedOrder.order_number}</h3>
                  <Badge tone={statusTone(selectedOrder.status)} dot>{selectedOrder.status.toUpperCase()}</Badge>
                  {selectedOrder.is_backorder && <Badge tone="warning">Backorder</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Placed {dateTime(selectedOrder.created_at)} · Channel: {selectedOrder.channel}
                </p>
              </div>
              <button onClick={() => setSelectedOrder(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Header summary grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <span className="text-[10px] text-muted-foreground">Customer</span>
                <p className="font-semibold">{selectedOrder.customer_name}</p>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground">Promise Delivery Date</span>
                <p className="font-semibold text-primary">{selectedOrder.delivery_date}</p>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground">Customer PO Ref</span>
                <p className="font-mono font-semibold">{selectedOrder.po_reference || "None"}</p>
              </div>
              <div className="col-span-2">
                <span className="text-[10px] text-muted-foreground">Delivery Destination</span>
                <p className="font-semibold">{selectedOrder.delivery_address}</p>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground">Credit Check</span>
                <p className={`font-semibold ${selectedOrder.credit_hold ? "text-red-600" : "text-marine-mid"}`}>
                  {selectedOrder.credit_hold ? "Credit Hold" : "Approved"}
                </p>
              </div>
            </div>

            {/* Line items table */}
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-[10px] font-bold text-muted-foreground uppercase">
                    <th className="py-2 px-3">SKU</th>
                    <th className="py-2 px-3">Product Name</th>
                    <th className="py-2 px-3 text-right">Ordered</th>
                    <th className="py-2 px-3 text-right">Allocated</th>
                    <th className="py-2 px-3 text-right">Backorder</th>
                    <th className="py-2 px-3 text-right">Unit Price</th>
                    <th className="py-2 px-3 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {selectedOrder.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2.5 px-3 font-mono">{l.sku}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-foreground">{l.product_name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {l.pricing_source.replace(/_/g, " ")}
                          {l.batch_id ? ` · Lot ${l.batch_id}` : ""}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium">{l.cases_ordered}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-marine-mid">{l.cases_allocated}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-amber-700">{l.cases_backordered}</td>
                      <td className="py-2.5 px-3 text-right">{money(l.unit_price_cents)}</td>
                      <td className="py-2.5 px-3 text-right font-bold">{money(l.line_total_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Total breakdown */}
            <div className="flex justify-end">
              <div className="w-64 space-y-1.5 text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="font-semibold text-foreground">{money(selectedOrder.subtotal_cents)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Tax (VAT)</span>
                  <span className="font-semibold text-foreground">{money(selectedOrder.tax_cents)}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-2 text-sm font-bold text-foreground">
                  <span>Total Payable</span>
                  <span className="text-primary">{money(selectedOrder.total_cents)}</span>
                </div>
              </div>
            </div>

            {/* Server-generated documents (confirmation / delivery note / invoice) */}
            <div className="rounded-lg border border-border p-3 text-xs space-y-2">
              <p className="font-bold text-foreground flex items-center gap-1.5">
                <FileText className="h-4 w-4 text-primary" /> Documents
              </p>
              {orderDocuments.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  Confirmation documents are issued once the order is confirmed.
                </p>
              ) : (
                orderDocuments.map((doc) => (
                  <div
                    key={`${doc.type}-${doc.document_number}`}
                    className="flex items-center justify-between gap-3"
                  >
                    <div>
                      <p className="font-semibold text-foreground">{doc.title}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {doc.document_number} · Issued {dateTime(doc.issued_at)}
                      </p>
                    </div>
                    <Can permission="orders.read" mode="hide">
                      <a
                        href={doc.download_url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 rounded border border-input px-2 py-1 text-[11px] font-semibold hover:bg-muted"
                      >
                        <Download className="h-3 w-3" /> Open
                      </a>
                    </Can>
                  </div>
                ))
              )}
            </div>

            {/* Immutable status / amendment timeline */}
            {selectedOrder.events && selectedOrder.events.length > 0 && (
              <div className="rounded-lg border border-border p-3 text-xs space-y-2">
                <p className="font-bold text-foreground flex items-center gap-1.5">
                  <History className="h-4 w-4 text-primary" /> Order Timeline
                </p>
                <ol className="space-y-2 border-l border-border pl-3">
                  {selectedOrder.events.map((event) => (
                    <li key={event.id} className="relative">
                      <span className="absolute -left-[17px] top-1 h-2 w-2 rounded-full bg-primary" />
                      <p className="font-semibold text-foreground">
                        {titleCase(event.event_type.replace(/_/g, " "))}
                        {event.from_status && event.to_status && event.from_status !== event.to_status
                          ? `: ${event.from_status.replace(/_/g, " ")} → ${event.to_status.replace(/_/g, " ")}`
                          : event.to_status
                            ? ` → ${event.to_status.replace(/_/g, " ")}`
                            : ""}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {dateTime(event.created_at)} · {event.actor_email || "system"}
                        {event.actor_role ? ` (${event.actor_role})` : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Authorized amendment — hidden unless the role may amend this status */}
            {canAmendOrder(selectedOrder) && (
              <div className="rounded-lg border border-border p-3 text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-foreground flex items-center gap-1.5">
                    <Pencil className="h-4 w-4 text-primary" /> Amend Order
                  </p>
                  <button
                    type="button"
                    onClick={() => setAmendFormOpen((prev) => !prev)}
                    className="rounded-md border border-input px-2.5 py-1 text-[11px] font-semibold hover:bg-muted"
                  >
                    {amendFormOpen ? "Hide amendment form" : "Edit delivery / quantities"}
                  </button>
                </div>

                {amendFormOpen && (
                  <form onSubmit={handleAmendOrder} className="space-y-3 border-t border-border pt-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <label className="space-y-1">
                        <span className="text-[10px] font-semibold text-muted-foreground">Delivery date</span>
                        <input
                          type="date"
                          required
                          value={amendDeliveryDate}
                          onChange={(e) => setAmendDeliveryDate(e.target.value)}
                          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] font-semibold text-muted-foreground">Customer PO ref</span>
                        <input
                          type="text"
                          value={amendPoReference}
                          onChange={(e) => setAmendPoReference(e.target.value)}
                          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] font-semibold text-muted-foreground">Delivery notes</span>
                        <input
                          type="text"
                          value={amendDeliveryNotes}
                          onChange={(e) => setAmendDeliveryNotes(e.target.value)}
                          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                        />
                      </label>
                    </div>

                    <div className="space-y-1.5">
                      {amendLines.map((line) => (
                        <div key={line.sku} className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold text-foreground">{line.productName}</p>
                            <p className="font-mono text-[10px] text-muted-foreground">
                              {line.sku} · {line.uom}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground">cases</span>
                            <input
                              type="number"
                              min={0}
                              value={line.cases}
                              onChange={(e) => {
                                const cases = Math.max(0, Number(e.target.value) || 0);
                                setAmendLines((prev) =>
                                  prev.map((entry) =>
                                    entry.sku === line.sku ? { ...entry, cases } : entry
                                  )
                                );
                              }}
                              className="w-20 rounded-md border border-input bg-background px-2 py-1 text-right text-xs"
                            />
                          </div>
                        </div>
                      ))}
                      <p className="text-[10px] text-muted-foreground">
                        Setting a quantity to 0 removes that line. Stock, shelf-life and credit are
                        revalidated and line prices re-snapshotted on save.
                      </p>
                    </div>

                    <label className="flex items-center gap-2 text-[11px] font-medium">
                      <input
                        type="checkbox"
                        checked={amendAllowBackorders}
                        onChange={(e) => setAmendAllowBackorders(e.target.checked)}
                      />
                      Allow backorders for unavailable quantities
                    </label>

                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setAmendFormOpen(false)}
                        className="rounded-md border border-input px-3 py-1.5 text-[11px] font-semibold hover:bg-muted"
                      >
                        Discard
                      </button>
                      <Can permission="orders.manage" mode="disable">
                        <button
                          type="submit"
                          disabled={amending}
                          className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-bold text-white hover:opacity-90 disabled:opacity-50"
                        >
                          {amending ? "Revalidating & saving..." : "Save amendment"}
                        </button>
                      </Can>
                    </div>
                  </form>
                )}
              </div>
            )}

            {/* Delivery & Route Tracking */}
            {selectedOrder.deliveries && selectedOrder.deliveries.length > 0 && (
              <div className="rounded-lg border border-border p-3 text-xs space-y-2">
                <p className="font-bold text-foreground flex items-center gap-1.5">
                  <Truck className="h-4 w-4 text-primary" /> Delivery Fleet Manifest
                </p>
                {selectedOrder.deliveries.map((del) => (
                  <div key={del.id} className="flex justify-between text-muted-foreground">
                    <span>Route: <strong>{del.route_code}</strong> ({del.vehicle}) · Driver: {del.driver}</span>
                    <Badge tone={statusTone(del.status)}>{del.status.toUpperCase()}</Badge>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap justify-between items-center gap-2 border-t border-border pt-4">
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted"
              >
                <Printer className="h-3.5 w-3.5" /> Print Confirmation Slip
              </button>

              <div className="flex items-center gap-2">
                {canManageFulfilment &&
                  (selectedOrder.status === "confirmed" ||
                    selectedOrder.status === "partially_confirmed") && (
                    <Can permission="orders.manage" mode="disable">
                      <button
                        onClick={() => handleTransitionStatus("processing")}
                        disabled={transitioningStatus}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
                      >
                        {transitioningStatus ? "Updating..." : "Start Processing"}
                      </button>
                    </Can>
                  )}
                {canManageFulfilment && selectedOrder.status === "processing" && (
                  <Can permission="orders.manage" mode="disable">
                    <button
                      onClick={() => handleTransitionStatus("completed")}
                      disabled={transitioningStatus}
                      className="rounded-md bg-marine-steel px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-marine-steelLight disabled:opacity-50"
                    >
                      {transitioningStatus ? "Updating..." : "Mark Completed"}
                    </button>
                  </Can>
                )}
                <button
                  onClick={() => setSelectedOrder(null)}
                  className="rounded-md bg-muted px-4 py-1.5 text-xs font-semibold hover:bg-muted/80"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: MAKER-CHECKER APPROVE MODAL                                        */}
      {/* ========================================================================= */}
      {approvingOrderId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleApproveCredit}
            className="w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95"
          >
            <div className="flex items-center gap-2 text-amber-700 font-bold text-base">
              <ShieldAlert className="h-5 w-5" />
              <span>Maker-Checker Credit Override Approval</span>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              You are authorizing order <strong>{approvingOrderId}</strong> to proceed despite exceeding the customer&apos;s credit limit ceiling. An immutable audit record will log your rationale.
            </p>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                Approval Reason & Audit Justification *
              </label>
              <textarea
                required
                rows={3}
                value={approvalReason}
                onChange={(e) => setApprovalReason(e.target.value)}
                placeholder="e.g. Verified pending bank transfer of €12,500; customer VIP fine-dining partner."
                className="w-full rounded-md border border-input bg-background p-2.5 text-xs shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setApprovingOrderId(null)}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted"
              >
                Cancel
              </button>
              <Can permission="orders:credit_override" mode="hide">
                <button
                  type="submit"
                  disabled={submittingApproval || approvalReason.trim().length < 5}
                  className="rounded-md bg-marine-steel px-4 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-marine-steelLight disabled:opacity-50"
                >
                  {submittingApproval ? "Recording Approval..." : "Confirm & Allocate Stock"}
                </button>
              </Can>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
