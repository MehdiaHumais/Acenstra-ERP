"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CheckCheck,
  CircleHelp,
  CornerDownLeft,
  Globe,
  MoreHorizontal,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  UserCog,
  X,
} from "lucide-react";
import type { Alert, Lot, Product, SalesOrder } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

async function load<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(`${API_URL}/api/v1${path}`, {
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) return fallback;
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

type SearchResult = {
  key: string;
  label: string;
  detail: string;
  href: string;
  kind: "Order" | "Lot" | "Product";
};

type UserNotification = {
  id: string;
  severity: "critical" | "warning" | "info";
  module: string;
  title: string;
  detail: string;
  href: string | null;
  is_read: boolean;
  created_at: string;
};

type AuthUserInfo = {
  id: string;
  email: string;
  name: string;
  role: string;
};

export function HeaderActions({
  locale = "en",
  onToggleLocale,
}: {
  locale?: "en" | "it";
  onToggleLocale?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchRef = useRef<HTMLDivElement>(null);
  const mobileSearchRef = useRef<HTMLDivElement>(null);
  const notificationsPanelRef = useRef<HTMLDivElement | null>(null);
  const notificationsButtonRef = useRef<HTMLButtonElement | null>(null);
  const morePanelRef = useRef<HTMLDivElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [readIds, setReadIds] = useState<number[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [userNotifications, setUserNotifications] = useState<UserNotification[]>([]);
  const [currentUser, setCurrentUser] = useState<AuthUserInfo | null>(null);
  const [availableRoles, setAvailableRoles] = useState<AuthUserInfo[]>([]);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const authData = await load<{
        authenticated?: boolean;
        user?: AuthUserInfo | null;
        available_roles?: AuthUserInfo[];
      }>("/auth", {});
      if (cancelled) return;
      setCurrentUser(authData?.user ? authData.user : null);
      if (Array.isArray(authData?.available_roles)) setAvailableRoles(authData.available_roles);
      setAuthReady(true);
      if (!authData?.authenticated) return;
      const [orderRows, lotRows, productRows, overview, mine] = await Promise.all([
        load<SalesOrder[]>("/orders", []),
        load<Lot[]>("/inventory/lots", []),
        load<Product[]>("/products", []),
        load<{ alerts: Alert[] }>("/dashboard/overview", { alerts: [] }),
        load<{ notifications: UserNotification[]; unread_count: number }>("/notifications", { notifications: [], unread_count: 0 }),
      ]);
      if (cancelled) return;
      setOrders(orderRows);
      setLots(lotRows);
      setProducts(productRows);
      setAlerts(overview.alerts ?? []);
      setUserNotifications(mine.notifications ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    setSearchOpen(false);
    setMobileSearchOpen(false);
    setNotificationsOpen(false);
    setHelpOpen(false);
    setMenuOpen(false);
    setMoreOpen(false);
  }, [pathname]);

  // Live notification polling: new messages/requests must reach the bell
  // without a manual page reload. Also acts as the "your account was deleted"
  // signal — a deleted session gets a precise 401 and is signed out at once.
  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;

    const refresh = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      let res: Response;
      try {
        res = await fetch("/api/v1/notifications", { cache: "no-store" });
      } catch {
        return;
      }
      if (cancelled) return;
      if (res.status === 401) {
        const data = await res.json().catch(() => null);
        const code = data?.error?.code;
        if (code === "ACCOUNT_DELETED" || code === "ACCOUNT_DISABLED") {
          // Clear the httpOnly cookies first so /login is reachable.
          await fetch("/api/v1/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "logout" }),
          }).catch(() => null);
          window.location.href =
            code === "ACCOUNT_DELETED"
              ? "/login?reason=account_deleted"
              : "/login?reason=account_disabled";
        }
        return;
      }
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (!cancelled && Array.isArray(data?.notifications)) {
          setUserNotifications(data.notifications as UserNotification[]);
        }
      }
    };

    const timer = window.setInterval(refresh, 12000);
    const onFocus = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [authReady]);

  const results = useMemo<SearchResult[]>(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    const matches: SearchResult[] = [];

    orders.forEach((order) => {
      if (order.number.toLowerCase().includes(term) || order.customer_name.toLowerCase().includes(term)) {
        matches.push({
          key: `order-${order.id}`,
          label: `${order.number} · ${order.customer_name}`,
          detail: `${order.status} · ${order.lines.length} lines`,
          href: "/orders",
          kind: "Order",
        });
      }
    });

    lots.forEach((lot) => {
      if (
        lot.batch_code.toLowerCase().includes(term) ||
        lot.product_name.toLowerCase().includes(term) ||
        lot.sku.toLowerCase().includes(term)
      ) {
        matches.push({
          key: `lot-${lot.id}`,
          label: `${lot.batch_code} · ${lot.product_name}`,
          detail: `${lot.location} · ${lot.remaining_kg} kg · ${lot.quality_status}`,
          href: "/traceability",
          kind: "Lot",
        });
      }
    });

    products.forEach((product) => {
      if (
        product.name.toLowerCase().includes(term) ||
        product.sku.toLowerCase().includes(term) ||
        product.category.toLowerCase().includes(term)
      ) {
        matches.push({
          key: `product-${product.id}`,
          label: `${product.sku} · ${product.name}`,
          detail: `${product.category} · ${product.temperature_profile}`,
          href: "/products",
          kind: "Product",
        });
      }
    });

    return matches.slice(0, 8);
  }, [lots, orders, products, query]);

  // Notifications: closing by clicking the side/backdrop (outside the panel),
  // in addition to the bell button and the existing Escape handling.
  useEffect(() => {
    if (!notificationsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const panel = notificationsPanelRef.current;
      const button = notificationsButtonRef.current;
      if (panel && event.target instanceof Node && panel.contains(event.target)) return;
      if (button && event.target instanceof Node && button.contains(event.target)) return;
      setNotificationsOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [notificationsOpen]);

  // The mobile "more" and user menus need the same outside-tap behavior as
  // notifications; the header no longer traps fixed overlays, but this also
  // covers taps that start on a nested element.
  useEffect(() => {
    if (!moreOpen && !menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (moreOpen) {
        if (morePanelRef.current?.contains(target) || moreButtonRef.current?.contains(target)) return;
        setMoreOpen(false);
      }
      if (menuOpen) {
        if (menuPanelRef.current?.contains(target) || menuButtonRef.current?.contains(target)) return;
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [moreOpen, menuOpen]);

  const globalUnread = alerts.filter((alert) => !readIds.includes(alert.id)).length;
  const unread = globalUnread + userNotifications.filter((n) => !n.is_read).length;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSearchOpen(false);
        setMobileSearchOpen(false);
        setNotificationsOpen(false);
        setHelpOpen(false);
        setMenuOpen(false);
        setMoreOpen(false);
      }
    };
    const closeOnOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setSearchOpen(false);
      }
      if (mobileSearchRef.current && !mobileSearchRef.current.contains(event.target as Node)) {
        setMobileSearchOpen(false);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("mousedown", closeOnOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("mousedown", closeOnOutside);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const toggleLocaleWithNotice = () => {
    if (!onToggleLocale) return;
    onToggleLocale();
    setNotice(
      locale === "en"
        ? "Lingua impostata su Italiano (IT) · Localizzazione attiva."
        : "Language switched to English (EN) · Localisation active."
    );
    setMoreOpen(false);
  };

  const openResult = (result: SearchResult) => {
    setSearchOpen(false);
    setMobileSearchOpen(false);
    setQuery("");
    router.push(result.href);
  };

  const renderSearchResults = () => {
    if (!query.trim()) return null;
    if (results.length === 0) {
      return (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          Nothing matched. Try an order number, batch code or product.
        </p>
      );
    }
    return (
      <ul className="max-h-[min(60vh,20rem)] overflow-y-auto py-1">
        {results.map((result) => (
          <li key={result.key}>
            <button
              type="button"
              onClick={() => openResult(result)}
              className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-muted"
            >
              <span className="mt-0.5 rounded-md bg-secondary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-secondary-foreground">
                {result.kind}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold">{result.label}</span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {result.detail}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (results.length > 0) {
      openResult(results[0]);
      return;
    }
    if (query.trim()) {
      setSearchOpen(false);
      setMobileSearchOpen(false);
      router.push("/orders");
    }
  };

  return (
    <>
      <div className="flex items-center gap-1.5 sm:gap-2">
        <div ref={mobileSearchRef} className="relative md:hidden">
          <button
            type="button"
            aria-label="Search the ERP"
            aria-expanded={mobileSearchOpen}
            onClick={() => {
              setMobileSearchOpen((open) => !open);
              setMoreOpen(false);
              setNotificationsOpen(false);
              setMenuOpen(false);
            }}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground sm:h-9 sm:w-9"
          >
            <Search className="h-4 w-4" />
          </button>
          {mobileSearchOpen && (
            <div className="fixed inset-x-2 top-14 z-50 overflow-hidden rounded-xl border border-border bg-card shadow-xl md:hidden">
              <label className="relative block p-3 pb-2">
                <span className="sr-only">Search the ERP</span>
                <Search className="pointer-events-none absolute left-5 top-5 h-4 w-4 text-muted-foreground" />
                <input
                  type="search"
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={onSearchKeyDown}
                  placeholder={locale === "it" ? "Cerca ordini, lotti, prodotti…" : "Search orders, lots, products…"}
                  className="input pl-9"
                />
              </label>
              {renderSearchResults()}
              <div className="flex items-center justify-between border-t border-border bg-muted/40 px-3 py-2 text-[10px] text-muted-foreground">
                <span>{results.length} results</span>
                <span className="flex items-center gap-1">
                  <CornerDownLeft className="h-3 w-3" /> open first
                </span>
              </div>
            </div>
          )}
        </div>

        <div ref={searchRef} className="relative hidden md:block">
          <label className="relative block">
            <span className="sr-only">Search the ERP</span>
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={onSearchKeyDown}
              placeholder={locale === "it" ? "Cerca ordini, lotti, prodotti…" : "Search orders, lots, products…"}
              className="h-9 w-56 rounded-lg border border-input bg-card pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground/70 lg:w-64"
            />
          </label>
          {searchOpen && query.trim() && (
            <div className="absolute left-0 top-11 z-50 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-card shadow-lg">
              {renderSearchResults()}
              <div className="flex items-center justify-between border-t border-border bg-muted/40 px-3 py-2 text-[10px] text-muted-foreground">
                <span>{results.length} results</span>
                <span className="flex items-center gap-1">
                  <CornerDownLeft className="h-3 w-3" /> open first
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            ref={notificationsButtonRef}
            aria-label="Notifications"
            aria-expanded={notificationsOpen}
            onClick={() => {
              setNotificationsOpen((open) => !open);
              setMenuOpen(false);
            }}
            className="relative flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground sm:h-9 sm:w-9"
          >
            <Bell className="h-4 w-4" />
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
                {unread}
              </span>
            )}
          </button>
          <div ref={notificationsPanelRef} className="relative z-50">
            {notificationsOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close notifications"
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setNotificationsOpen(false)}
                />
                <div className="fixed inset-x-2 top-14 z-50 max-h-[calc(100dvh-4rem)] overflow-hidden rounded-xl border border-border bg-card shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:max-h-none sm:w-80">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div>
                    <p className="text-xs font-semibold">Notifications</p>
                    <p className="text-[10px] text-muted-foreground">{unread} unread</p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      setReadIds(alerts.map((alert) => alert.id));
                      setUserNotifications((current) => current.map((n) => ({ ...n, is_read: true })));
                      await Promise.all([
                        fetch("/api/v1/dashboard/overview", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({}),
                        }).catch(() => null),
                        fetch("/api/v1/notifications", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "mark_all_read" }),
                        }).catch(() => null),
                      ]);
                      router.refresh();
                    }}
                    disabled={alerts.length === 0 && userNotifications.every((n) => n.is_read)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary disabled:opacity-40"
                  >
                    <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                  </button>
                </div>
                <ul className="scrollbar-thin max-h-[min(24rem,calc(100dvh-11rem))] overflow-y-auto sm:max-h-96">
                  {userNotifications.length > 0 && (
                    <li className="border-b border-border/60 px-4 py-2">
                      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">For you</p>
                    </li>
                  )}
                  {userNotifications.slice(0, 8).map((n) => (
                    <li key={n.id} className="border-b border-border/60 last:border-0">
                      <Link
                        href={n.href ?? "/admin"}
                        onClick={() => {
                          setNotificationsOpen(false);
                          setUserNotifications((current) =>
                            current.map((row) => (row.id === n.id ? { ...row, is_read: true } : row))
                          );
                          fetch("/api/v1/notifications", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ ids: [n.id] }),
                          }).catch(() => null);
                        }}
                        className="block px-4 py-3 hover:bg-muted"
                      >
                        <div className="flex items-start gap-2">
                          <span
                            className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                              n.severity === "critical" ? "bg-red-500" : n.severity === "warning" ? "bg-amber-500" : "bg-sky-500"
                            } ${n.is_read ? "opacity-30" : ""}`}
                          />
                          <div className={n.is_read ? "opacity-60" : undefined}>
                            <p className="text-xs font-semibold">{n.title}</p>
                            <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{n.detail}</p>
                            <p className="mt-1 text-[10px] text-muted-foreground">{n.module}</p>
                          </div>
                        </div>
                      </Link>
                    </li>
                  ))}
                  {alerts.length > 0 &&
                    userNotifications.length > 0 && (
                      <li className="border-b border-border/60 px-4 py-2">
                        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Company</p>
                      </li>
                    )}
                  {alerts.length === 0 && userNotifications.length === 0 && (
                    <li className="px-4 py-6 text-center text-xs text-muted-foreground">
                      No notifications.
                    </li>
                  )}
                  {alerts.map((alert) => {
                    const isRead = readIds.includes(alert.id);
                    return (
                      <li key={alert.id} className="border-b border-border/60 last:border-0">
                        <Link
                          href={alert.href}
                          onClick={() => {
                            setNotificationsOpen(false);
                            setReadIds((current) => (current.includes(alert.id) ? current : [...current, alert.id]));
                          }}
                          className="block px-4 py-3 hover:bg-muted"
                        >
                          <div className="flex items-start gap-2">
                            <span
                              className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                                alert.severity === "critical" ? "bg-red-500" : "bg-amber-500"
                              } ${isRead ? "opacity-30" : ""}`}
                            />
                            <div className={isRead ? "opacity-60" : undefined}>
                              <p className="text-xs font-semibold">{alert.title}</p>
                              <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{alert.detail}</p>
                              <p className="mt-1 text-[10px] text-muted-foreground">{alert.age} ago</p>
                            </div>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                </div>
              </>
            )}
          </div>
        </div>

        {onToggleLocale && (
          <button
            type="button"
            aria-label="Toggle language (Italian / English)"
            title={locale === "it" ? "Passa a Inglese (EN)" : "Switch to Italian (IT)"}
            onClick={toggleLocaleWithNotice}
            className="hidden h-9 items-center gap-1 rounded-lg border border-border bg-card px-2.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground hover:border-primary/40 hover:text-foreground sm:flex"
          >
            <Globe className="h-3.5 w-3.5 text-primary" />
            <span>{locale === "it" ? "IT" : "EN"}</span>
          </button>
        )}

        <button
          type="button"
          aria-label="Ask Ascentra AI"
          onClick={() => window.dispatchEvent(new Event("ascentra:open-ai"))}
          className="hidden h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground sm:flex"
        >
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="hidden sm:inline">Ask AI</span>
        </button>

        <button
          type="button"
          aria-label="Help"
          onClick={() => setHelpOpen(true)}
          className="hidden h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground sm:flex"
        >
          <CircleHelp className="h-4 w-4" />
        </button>

        <div className="relative sm:hidden">
          <button
            type="button"
            ref={moreButtonRef}
            aria-label="More header actions"
            aria-expanded={moreOpen}
            onClick={() => {
              setMoreOpen((open) => !open);
              setNotificationsOpen(false);
              setMobileSearchOpen(false);
              setMenuOpen(false);
            }}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground sm:h-9 sm:w-9"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {moreOpen && (
            <>
              <button
                type="button"
                aria-label="Close more actions"
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setMoreOpen(false)}
              />
              <div
                ref={morePanelRef}
                className="absolute right-0 top-11 z-50 max-h-[calc(100dvh-4rem)] w-[min(15rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-card py-1 shadow-lg"
              >
                <button
                  type="button"
                  onClick={() => {
                    window.dispatchEvent(new Event("ascentra:open-ai"));
                    setMoreOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs hover:bg-muted"
                >
                  <Sparkles className="h-3.5 w-3.5 text-primary" /> Ask Ascentra AI
                </button>
                {onToggleLocale && (
                  <button
                    type="button"
                    onClick={toggleLocaleWithNotice}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs hover:bg-muted"
                  >
                    <Globe className="h-3.5 w-3.5 text-primary" /> Switch to {locale === "en" ? "Italian" : "English"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setHelpOpen(true);
                    setMoreOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs hover:bg-muted"
                >
                  <CircleHelp className="h-3.5 w-3.5 text-primary" /> Help & shortcuts
                </button>
              </div>
            </>
          )}
        </div>

        <div className="relative ml-0 flex min-h-[36px] items-center gap-2 border-l border-border pl-1.5 sm:ml-1 sm:pl-2">
          {!authReady ? (
            <div className="h-8 w-24 animate-pulse rounded-lg bg-muted" aria-hidden="true" />
          ) : !currentUser ? (
            <div className="flex items-center gap-1.5">
              <Link href="/login" className="btn btn-secondary btn-sm">
                Log in
              </Link>
              <Link href="/signup" className="btn btn-primary btn-sm">
                Sign up
              </Link>
            </div>
          ) : (
            <>
              <button
                ref={menuButtonRef}
                type="button"
                onClick={() => {
                  setMenuOpen((open) => !open);
                  setNotificationsOpen(false);
                }}
                aria-expanded={menuOpen}
                className="flex min-h-[36px] items-center gap-2 rounded-lg px-1 py-1 hover:bg-muted"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#061222] text-xs font-bold text-white">
                  {currentUser.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
                <span className="hidden text-left lg:block">
                  <span className="block text-xs font-semibold leading-4">{currentUser.name}</span>
                  <span className="block text-[10px] text-muted-foreground">{currentUser.role.replace("_", " ")}</span>
                </span>
              </button>
              {menuOpen && (
                <>
                  <button
                    type="button"
                    aria-label="Close user menu"
                    className="fixed inset-0 z-40 cursor-default"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div
                    ref={menuPanelRef}
                    className="absolute right-0 top-12 z-50 max-h-[calc(100dvh-4rem)] w-[min(16rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-card shadow-lg"
                  >
                    <div className="border-b border-border px-4 py-3">
                      <p className="text-xs font-semibold">{currentUser.name}</p>
                      <p className="text-[11px] text-muted-foreground">{currentUser.email}</p>
                      <p className="mt-1 inline-flex rounded-full border border-marine-ocean/25 bg-marine-ocean/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-marine-mid">
                        Role: {currentUser.role.replace("_", " ")}
                      </p>
                    </div>
                    {availableRoles.length > 1 && (
                      <div className="border-b border-border px-4 py-2.5">
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Switch Account
                        </label>
                        <select
                          value={currentUser.email}
                          onChange={async (e) => {
                            const email = e.target.value;
                            const res = await fetch("/api/v1/auth", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "switch_role", email }),
                            });
                            const data = await res.json();
                            if (res.ok && data?.user) {
                              setCurrentUser(data.user);
                              setNotice(`Switched active session to ${data.user.name} (${data.user.role}).`);
                              setMenuOpen(false);
                              router.refresh();
                            }
                          }}
                          className="mt-1.5 h-11 w-full max-w-full rounded-md border border-input bg-background px-2 text-xs outline-none sm:h-8"
                        >
                          {availableRoles.map((u) => (
                            <option key={u.email} value={u.email}>
                              {u.role.replace("_", " ")} — {u.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="py-1">
                      <Link
                        href="/user-settings"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2 px-4 py-2 text-xs hover:bg-muted"
                      >
                        <UserCog className="h-3.5 w-3.5" /> My settings
                      </Link>
                      <Link
                        href="/settings"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2 px-4 py-2 text-xs hover:bg-muted"
                      >
                        <Settings className="h-3.5 w-3.5" /> Platform settings
                      </Link>
                      <Link
                        href="/proposal"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2 px-4 py-2 text-xs hover:bg-muted"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" /> Proposal & scope
                      </Link>
                    </div>
                    <div className="border-t border-border p-2">
                      <button
                        type="button"
                        onClick={async () => {
                          setMenuOpen(false);
                          await fetch("/api/v1/auth", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "logout" }),
                          });
                          setCurrentUser(null);
                          router.push("/login");
                          router.refresh();
                        }}
                        className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        Sign out
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {helpOpen && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Help and keyboard shortcuts"
            className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border bg-card shadow-xl sm:max-h-[90vh] sm:overflow-visible sm:rounded-xl"
          >
            <div className="flex items-start justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold">Help & keyboard shortcuts</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Ascentra ERP · Version 1.0
                </p>
              </div>
              <button type="button" aria-label="Close help" onClick={() => setHelpOpen(false)} className="btn btn-ghost btn-sm">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 px-5 py-4 text-xs">
              {[
                { keys: "Enter", detail: "Open the first search result" },
                { keys: "Esc", detail: "Close menus and dialogs" },
                { keys: "Tab", detail: "Move through interactive controls" },
              ].map((item) => (
                <div key={item.keys} className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">{item.detail}</span>
                  <kbd className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-[10px] font-semibold">
                    {item.keys}
                  </kbd>
                </div>
              ))}
              <div className="rounded-lg bg-secondary/70 p-3 text-[11px] leading-5">
                Support: <span className="font-semibold">support@ascentraconsulting.co.uk</span>
                <br />
                Scope and acceptance: see the revised proposal in the sidebar.
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <Link href="/proposal" onClick={() => setHelpOpen(false)} className="btn btn-secondary">
                Open proposal
              </Link>
              <button type="button" onClick={() => setHelpOpen(false)} className="btn btn-primary">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && (
        <div className="fixed bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-3 right-3 z-[80] rounded-xl border border-border bg-[#061222] px-4 py-3 text-xs font-medium text-white shadow-xl sm:bottom-5 sm:left-auto sm:right-5 sm:max-w-sm">
          {notice}
        </div>
      )}
    </>
  );
}
