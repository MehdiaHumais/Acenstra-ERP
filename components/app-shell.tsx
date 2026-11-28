"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BrainCircuit,
  ChevronRight,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Package,
  Receipt,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Snowflake,
  Sprout,
  Store,
  Truck,
  UserCog,
  Users,
  Warehouse,
  X,
} from "lucide-react";
import { HeaderActions } from "@/components/header-actions";
import { cn } from "@/lib/format";

interface NavItem {
  title: string;
  titleIt: string;
  href: string;
  aliases?: string[];
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
}

interface NavGroup {
  label: string;
  labelIt: string;
  module: string;
  items: NavItem[];
}

/**
 * The five required sidebar groups. Each item is individually permission-gated
 * so unauthorized links are hidden, and each group carries the module code used
 * to decide whether the module is available at all.
 */
const groups: NavGroup[] = [
  {
    label: "Commercial & Portals",
    labelIt: "Commerciale e Portali",
    module: "module.commercial",
    items: [
      {
        title: "Overview",
        titleIt: "Panoramica",
        href: "/",
        icon: LayoutDashboard,
        permission: "dashboard:read",
      },
      {
        title: "Customer Orders",
        titleIt: "Ordini Clienti",
        href: "/orders",
        icon: ShoppingBag,
        permission: "orders.read",
      },
      {
        title: "B2B Customer Portal",
        titleIt: "Portale Clienti B2B",
        href: "/portal",
        icon: ShoppingCart,
        permission: "orders.read",
      },
      {
        title: "Store Monitoring",
        titleIt: "Monitoraggio Punti Vendita",
        href: "/stores",
        icon: Store,
        permission: "stores.read",
      },
    ],
  },
  {
    label: "Warehouse & Logistics",
    labelIt: "Magazzino e Logistica",
    module: "module.warehouse",
    items: [
      {
        title: "Warehouse & Inventory",
        titleIt: "Magazzino e Inventario FEFO",
        href: "/inventory",
        aliases: ["/putaway"],
        icon: Snowflake,
        permission: "inventory.read",
      },
      {
        title: "Picking & Packing",
        titleIt: "Prelievo e Imballo",
        href: "/warehouse",
        aliases: ["/warehouse/picking"],
        icon: Warehouse,
        permission: "warehouse:read",
      },
      {
        title: "Loading & Delivery",
        titleIt: "Carico e Consegne (POD)",
        href: "/deliveries",
        icon: Truck,
        permission: "deliveries.read",
      },
      {
        title: "Inbound & Quality Gate",
        titleIt: "Ricevimento e Controllo Qualità",
        href: "/inbound",
        aliases: ["/quality"],
        icon: ShieldCheck,
        permission: "inbound.read",
      },
    ],
  },
  {
    label: "Catalog Supply & Safety",
    labelIt: "Catalogo, Approvvigionamento e Sicurezza",
    module: "module.catalog",
    items: [
      {
        title: "Products & Procurement",
        titleIt: "Prodotti e Acquisti",
        href: "/products",
        aliases: ["/suppliers"],
        icon: Package,
        permission: "products.read",
      },
      {
        title: "Traceability & Recall",
        titleIt: "Tracciabilità e Richiami",
        href: "/traceability",
        aliases: ["/exceptions-recall"],
        icon: ShieldAlert,
        permission: "traceability:read",
      },
    ],
  },
  {
    label: "Finance & Management",
    labelIt: "Finanza e Direzione",
    module: "module.finance",
    items: [
      {
        title: "Finance & SdI",
        titleIt: "Finanza e FatturaPA / SdI",
        href: "/finance",
        icon: Receipt,
        permission: "invoices.read",
      },
      {
        title: "Executive & AI",
        titleIt: "Direzione e AI",
        href: "/management",
        aliases: ["/analytics"],
        icon: BrainCircuit,
        permission: "ai.recommendations.read",
      },
    ],
  },
  {
    label: "Settings & Architecture",
    labelIt: "Impostazioni e Architettura",
    module: "module.settings",
    items: [
      {
        title: "Administration",
        titleIt: "Amministrazione",
        href: "/admin",
        aliases: ["/admin/users", "/admin/invitations"],
        icon: UserCog,
        permission: "users.read",
      },
      {
        title: "Contact Administration",
        titleIt: "Contatta Amministrazione",
        href: "/contact",
        icon: MessageSquare,
        permission: "dashboard.read",
      },
      {
        title: "Settings & Architecture",
        titleIt: "Impostazioni e Architettura",
        href: "/settings",
        aliases: ["/proposal"],
        icon: Settings,
        permission: "module.settings",
      },
    ],
  },
];

const titles: Record<
  string,
  { title: string; titleIt: string; description: string; descriptionIt: string }
> = {
  "/": {
    title: "Operations overview",
    titleIt: "Panoramica Operativa",
    description: "Supplier to customer, in one control tower",
    descriptionIt: "Dal fornitore al cliente, in un'unica torre di controllo",
  },
  "/products": {
    title: "Products & Procurement",
    titleIt: "Prodotti e Approvvigionamento",
    description:
      "Configure products, storage temperatures, shelf-life rules, UOM and catch-weight settings. Manage suppliers and create purchase orders.",
    descriptionIt:
      "Configura prodotti, temperature di stoccaggio, regole di shelf-life, UOM e peso variabile. Gestisci i fornitori e crea ordini d'acquisto.",
  },
  "/suppliers": {
    title: "Products & Procurement",
    titleIt: "Prodotti e Approvvigionamento",
    description:
      "Configure products, storage temperatures, shelf-life rules, UOM and catch-weight settings. Manage suppliers and create purchase orders.",
    descriptionIt:
      "Configura prodotti, temperature di stoccaggio, regole di shelf-life, UOM e peso variabile. Gestisci i fornitori e crea ordini d'acquisto.",
  },
  "/inbound": {
    title: "Inbound & Quality Gate",
    titleIt: "Ricevimento e Controllo Qualità",
    description:
      "Record arriving shipments, verify quantities, temperature, expiry, certificates and HACCP checks. QA releases accepted quantities and holds or quarantines unsafe goods.",
    descriptionIt:
      "Registra spedizioni in arrivo, verifica quantità, temperatura, scadenza, certificati e controlli HACCP. Il QA rilascia le quantità accettate e blocca le merci non conformi.",
  },
  "/quality": {
    title: "Inbound & Quality Gate",
    titleIt: "Ricevimento e Controllo Qualità",
    description:
      "Record arriving shipments, verify quantities, temperature, expiry, certificates and HACCP checks. QA releases accepted quantities and holds or quarantines unsafe goods.",
    descriptionIt:
      "Registra spedizioni in arrivo, verifica quantità, temperatura, scadenza, certificati e controlli HACCP. Il QA rilascia le quantità accettate e blocca le merci non conformi.",
  },
  "/inventory": {
    title: "Warehouse & Inventory",
    titleIt: "Magazzino e Inventario",
    description:
      "Put approved goods into suitable warehouse bins. Track batches, expiry dates, locations and stock availability using FEFO.",
    descriptionIt:
      "Stocca le merci approvate nelle ubicazioni idonee. Traccia lotti, scadenze, posizioni e disponibilità secondo la logica FEFO.",
  },
  "/putaway": {
    title: "Warehouse & Inventory",
    titleIt: "Magazzino e Inventario",
    description:
      "Put approved goods into suitable warehouse bins. Track batches, expiry dates, locations and stock availability using FEFO.",
    descriptionIt:
      "Stocca le merci approvate nelle ubicazioni idonee. Traccia lotti, scadenze, posizioni e disponibilità secondo la logica FEFO.",
  },
  "/orders": {
    title: "Customer Orders",
    titleIt: "Ordini Clienti",
    description:
      "Restaurants order through the B2B portal, or sales staff create orders internally. The system checks pricing, credit limits, stock and shelf-life requirements before confirmation.",
    descriptionIt:
      "I ristoranti ordinano tramite il portale B2B o il team commerciale inserisce gli ordini. Il sistema verifica listini, fido, scorte e shelf-life prima della conferma.",
  },
  "/portal": {
    title: "B2B Customer Ordering Portal",
    titleIt: "Portale Ordini B2B Clienti",
    description:
      "Restaurants order through the B2B portal with contract pricing, live FEFO availability, shelf-life validation, and repeat ordering.",
    descriptionIt:
      "Catalogo self-service per ristoranti con listini contrattuali, disponibilità FEFO in tempo reale e riordino rapido.",
  },
  "/warehouse": {
    title: "Picking & Packing",
    titleIt: "Prelievo e Imballo",
    description:
      "Warehouse staff pick eligible stock using FEFO, verify batches and quantities, record catch weights, pack orders and prepare them for dispatch.",
    descriptionIt:
      "Il personale preleva i lotti idonei secondo FEFO, verifica barcode e quantità, registra il peso variabile (catch-weight), imballa gli ordini e li prepara per la spedizione.",
  },
  "/warehouse/picking": {
    title: "Picking & Packing",
    titleIt: "Prelievo e Imballo",
    description:
      "Warehouse staff pick eligible stock using FEFO, verify batches and quantities, record catch weights, pack orders and prepare them for dispatch.",
    descriptionIt:
      "Il personale preleva i lotti idonei secondo FEFO, verifica barcode e quantità, registra il peso variabile (catch-weight), imballa gli ordini e li prepara per la spedizione.",
  },
  "/deliveries": {
    title: "Loading & Delivery",
    titleIt: "Carico e Consegne",
    description:
      "Drivers load verified packages, record vehicle temperatures, deliver orders and collect Proof of Delivery (POD), including signatures and delivery exceptions.",
    descriptionIt:
      "Gli autisti caricano i colli verificati, registrano le temperature del mezzo, consegnano gli ordini e raccolgono la Prova di Consegna (POD) con firme ed eccezioni.",
  },
  "/finance": {
    title: "Finance & SdI",
    titleIt: "Finanza e Fatturazione SdI",
    description:
      "Generate invoices from delivered quantities, prepare FatturaPA XML for Italy's SdI integration, record payments, reconcile bank transactions and calculate margins using actual costs.",
    descriptionIt:
      "Genera fatture dalle quantità consegnate, prepara l'XML FatturaPA per lo SdI, registra i pagamenti, riconcilia i movimenti bancari e calcola i margini reali.",
  },
  "/traceability": {
    title: "Traceability & Recall",
    titleIt: "Tracciabilità e Richiami",
    description:
      "Trace products from suppliers and batches to warehouse locations and customers. Quarantine affected stock and manage recalls, recovery and corrective actions.",
    descriptionIt:
      "Traccia i prodotti da fornitori e lotti fino alle ubicazioni di magazzino e ai clienti. Metti in quarantena le scorte coinvolte e gestisci richiami, ritiri e azioni correttive.",
  },
  "/exceptions-recall": {
    title: "Traceability & Recall",
    titleIt: "Tracciabilità e Richiami",
    description:
      "Trace products from suppliers and batches to warehouse locations and customers. Quarantine affected stock and manage recalls, recovery and corrective actions.",
    descriptionIt:
      "Traccia i prodotti da fornitori e lotti fino alle ubicazioni di magazzino e ai clienti. Metti in quarantena le scorte coinvolte e gestisci richiami, ritiri e azioni correttive.",
  },
  "/stores": {
    title: "Store Monitoring",
    titleIt: "Monitoraggio Punti Vendita",
    description:
      "Partner fast-food stores view their purchases, deliveries, order history, spending and product analytics. Consumption is estimated unless actual POS or inventory data is integrated.",
    descriptionIt:
      "I fast-food affiliati visualizzano acquisti, consegne, storico ordini, spesa e analisi prodotti. I consumi sono stimati salvo integrazione POS o inventario reale.",
  },
  "/contact": {
    title: "Contact Administration",
    titleIt: "Contatta Amministrazione",
    description:
      "Send a message to administrators — request access changes, report a problem, or ask a question. Administrators reply from the admin dashboard.",
    descriptionIt:
      "Invia un messaggio agli amministratori — richiedi modifiche agli accessi, segnala un problema o fai una domanda. Gli amministratori rispondono dalla dashboard di amministrazione.",
  },
  "/management": {
    title: "Executive & AI",
    titleIt: "Direzione e AI",
    description:
      "Management views business performance, financial metrics, inventory alerts, forecasts and AI recommendations. Consequential actions require authorized approval.",
    descriptionIt:
      "La direzione visualizza performance aziendali, metriche finanziarie, avvisi scorte, previsioni e raccomandazioni AI. Le azioni consequenziali richiedono approvazione.",
  },
  "/analytics": {
    title: "Executive & AI",
    titleIt: "Direzione e AI",
    description:
      "Management views business performance, financial metrics, inventory alerts, forecasts and AI recommendations. Consequential actions require authorized approval.",
    descriptionIt:
      "La direzione visualizza performance aziendali, metriche finanziarie, avvisi scorte, previsioni e raccomandazioni AI. Le azioni consequenziali richiedono approvazione.",
  },
  "/admin": {
    title: "Administration — User Management",
    titleIt: "Amministrazione — Gestione Utenti",
    description:
      "Invite people by email or create accounts manually, track invitation status, and manage access — every action is audited.",
    descriptionIt:
      "Invita l'utente via email o crea l'account manualmente, traccia lo stato degli inviti e gestisci gli accessi — ogni azione è auditata.",
  },
  "/settings": {
    title: "Platform Settings, Proposal & Governance",
    titleIt: "Impostazioni Piattaforma, Proposta e Governance",
    description:
      "Security, RBAC, CRM/workforce, DR/migration rehearsal, and complete revised client proposal",
    descriptionIt:
      "Sicurezza, RBAC, CRM/attività, test DR/migrazione e proposta tecnica revisionata completa",
  },
  "/proposal": {
    title: "Revised Proposal, Architecture & Acceptance",
    titleIt: "Proposta Revisionata, Architettura e Collaudo UAT",
    description:
      "Ascentra Global Ltd Revised Proposal for M. Arshad · €8,000 baseline · 12-step ERP journey",
    descriptionIt:
      "Proposta Revisionata Ascentra Global Ltd per M. Arshad · Baseline €8.000 · Percorso ERP 12 fasi",
  },
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Public, unauthenticated pages render bare — no sidebar, no top bar.
  const isStandalone =
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/request-access" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname.startsWith("/invite/");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [locale, setLocale] = useState<"en" | "it">("en");

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Escape is the expected way to dismiss a full-screen phone drawer.
  useEffect(() => {
    if (!mobileOpen || isStandalone) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen, isStandalone]);

  // A phone drawer covers the whole app; stop the page behind it from scrolling.
  useEffect(() => {
    if (isStandalone || !mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isStandalone, mobileOpen]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("ascentra_locale");
      if (saved === "it" || saved === "en") {
        setLocale(saved);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const toggleLocale = () => {
    setLocale((prev) => {
      const next = prev === "en" ? "it" : "en";
      try {
        window.localStorage.setItem("ascentra_locale", next);
      } catch {
        // ignore
      }
      return next;
    });
  };

  useEffect(() => {
    if (isStandalone) {
      return;
    }
    let cancelled = false;

    const refreshAuthorization = async () => {
      try {
        const res = await fetch("/api/v1/auth", { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as {
          authenticated?: boolean;
          permissions?: string[];
          reason?: string;
        } | null;
        if (cancelled) return;

        if (data?.authenticated === true && Array.isArray(data.permissions)) {
          setUserPermissions(data.permissions);
        } else if (data?.authenticated === false) {
          // An explicitly unauthenticated response means the cookie is stale
          // (deleted/disabled account). Never inherit permissions from a
          // "default" user — clear the session and show the precise reason.
          setUserPermissions([]);
          try {
            // Await cookie clearance so middleware does not bounce /login back.
            await fetch("/api/v1/auth", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "logout" }),
            });
          } catch {
            // Ignore — the ?reason parameter still lets /login through.
          }
          if (cancelled) return;
          const reason =
            data.reason === "account_deleted" ? "account_deleted" :
            data.reason === "account_disabled" ? "account_disabled" : "session_expired";
          window.location.href = `/login?reason=${reason}`;
          return;
        }
      } catch {
        // A network failure is not proof of logout — keep existing permissions.
      } finally {
        if (!cancelled) setPermissionsLoaded(true);
      }
    };

    void refreshAuthorization();
    return () => {
      cancelled = true;
    };
  }, [pathname, isStandalone]);

  if (isStandalone) {
    return <div className="min-h-screen bg-background">{children}</div>;
  }

  const page = titles[pathname] ?? {
    title: "Ascentra ERP",
    titleIt: "Ascentra ERP",
    description: "Food distribution operating platform",
    descriptionIt: "Piattaforma operativa per la distribuzione alimentare",
  };

  const hasPermission = (permission?: string) => {
    if (!permission) return true;
    if (!permissionsLoaded) return true;
    if (userPermissions.includes("*")) return true;
    if (userPermissions.includes(permission)) return true;
    const alt = permission.includes(".")
      ? permission.replace(/\./g, ":")
      : permission.replace(/:/g, ".");
    return userPermissions.includes(alt);
  };

  const isItemVisible = (item: NavItem) => {
    // Contact / Support is meant for regular users to reach administrators —
    // super admins don't need a composer to themselves.
    if (item.href === "/contact" && userPermissions.includes("*")) return false;
    return hasPermission(item.permission);
  };

  const currentItem = groups
    .flatMap((group) => group.items)
    .find((item) => item.href === pathname || item.aliases?.includes(pathname));

  const accessDenied = permissionsLoaded && currentItem !== undefined && !isItemVisible(currentItem);

  const isItemActive = (item: NavItem) => {
    if (pathname === item.href) return true;
    if (item.aliases?.includes(pathname)) return true;
    return false;
  };

  return (
    <div className="min-h-screen bg-background">
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="ERP navigation"
        className={cn(
          "fixed inset-y-0 left-0 z-[60] flex w-[272px] max-w-[86vw] flex-col border-r border-white/10 bg-marine-navy text-marine-ice transition-transform duration-200 lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center">
              <img src="/logo.png" alt="Ascentra Logo" className="h-full w-full object-contain" />
            </span>
            <span>
              <span className="block text-[13px] font-bold tracking-[0.16em] text-marine-ice">ASCENTRA</span>
              <span className="block text-[10px] uppercase tracking-[0.14em] text-marine-ice/55">
                {locale === "it" ? "ERP Distribuzione Alimentare" : "Food Distribution ERP"}
              </span>
            </span>
          </Link>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
            className="flex h-11 w-11 items-center justify-center rounded-md text-white/70 hover:bg-marine-mid/10 lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 py-4">
          {groups.map((group) => {
            const visibleItems = group.items.filter(isItemVisible);
            const groupVisible = hasPermission(group.module) || visibleItems.length > 0;
            if (!groupVisible || visibleItems.length === 0) return null;

            return (
              <div key={group.label} className="mb-5">
                <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-marine-ice/40">
                  {locale === "it" ? group.labelIt : group.label}
                </p>
                <ul className="space-y-1">
                  {visibleItems.map((item) => {
                    const active = isItemActive(item);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={() => setMobileOpen(false)}
                          className={cn(
                            "group flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                            active
                              ? "bg-marine-ocean/70 text-marine-ice shadow-sm"
                              : "text-marine-ice/70 hover:bg-marine-mid/[0.06] hover:text-marine-ice",
                          )}
                        >
                          <item.icon className={cn("h-4 w-4 shrink-0", active && "text-marine-steelLight")} />
                          <span className="flex-1">{locale === "it" ? item.titleIt : item.title}</span>
                          {active && <ChevronRight className="h-3.5 w-3.5 text-marine-steelLight" />}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-white/10 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="rounded-lg border border-marine-ocean/70 bg-marine-ocean/25 p-3">
            <p className="flex items-center gap-2 text-xs font-semibold text-marine-ice">
              <span className="h-2 w-2 rounded-full bg-marine-steelLight" />
              {locale === "it" ? "Intelligenza Governata" : "Governed intelligence"}
            </p>
            <p className="mt-1 text-[11px] leading-4 text-marine-ice/55">
              {locale === "it"
                ? "Le raccomandazioni AI si basano sui dati ERP. Nessuna azione critica viene eseguita senza approvazione umana."
                : "AI recommendations are grounded in ERP data. No consequential action runs without human approval."}
            </p>
            <Link
              href="/management"
              onClick={() => setMobileOpen(false)}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-marine-steelLight hover:text-marine-ice"
            >
              {locale === "it" ? "Coda approvazioni" : "Review queue"} <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <p className="mt-3 text-[10px] text-white/35">
            Ascentra Global Ltd · v1.0.0 ({locale.toUpperCase()})
          </p>
        </div>
      </aside>

      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation overlay"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-[55] bg-black/40 lg:hidden"
        />
      )}

      <div className="flex min-h-screen flex-col lg:pl-[272px]">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background px-3 sm:px-4 md:h-16 md:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <button
              type="button"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:text-foreground lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-[13px] font-semibold tracking-tight sm:text-base">
                {locale === "it" ? page.titleIt : page.title}
              </h1>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">
                {locale === "it" ? page.descriptionIt : page.description}
              </p>
            </div>
          </div>

          <HeaderActions locale={locale} onToggleLocale={toggleLocale} />
        </header>

        <main className="min-w-0 flex-1 px-3 py-4 sm:px-4 sm:py-5 md:px-6 md:py-6">
          <div className="mx-auto w-full max-w-[1320px]">
            {permissionsLoaded && accessDenied ? (
              <div className="mx-auto flex max-w-xl flex-col items-center rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-14 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                  <ShieldAlert className="h-7 w-7" />
                </span>
                <h2 className="mt-4 text-lg font-semibold">
                  {locale === "it" ? "Accesso negato" : "Access denied"}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {locale === "it"
                    ? "Non disponi dei permessi necessari per questa sezione. Contatta un amministratore se ritieni che si tratti di un errore."
                    : "You do not have the permissions required for this section. Contact an administrator if you believe this is an error."}
                </p>
                <Link
                  href="/"
                  className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
                >
                  {locale === "it" ? "Torna alla panoramica" : "Back to overview"}
                </Link>
              </div>
            ) : (
              children
            )}
          </div>
        </main>

        <footer className="border-t border-border px-3 py-4 text-xs text-muted-foreground sm:px-4 md:px-6">
          <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <p>
              {locale === "it"
                ? "© 2026 Ascentra Global Ltd · ERP Distribuzione Alimentare con Intelligenza Artificiale"
                : "© 2026 Ascentra Global Ltd · AI-powered food distribution ERP"}
            </p>
            <p className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              {locale === "it"
                ? "MFA · RBAC · Registro di Audit · GDPR by design · FatturaPA / SdI"
                : "MFA · RBAC · audit trail · GDPR by design · FatturaPA / SdI"}
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
