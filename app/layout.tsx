import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { ErpChatAssistant } from "@/components/erp-chat-assistant";
import { BuildWatcher } from "@/components/build-watcher";
import { ServiceWorker } from "@/components/service-worker";
import { getBuildId } from "@/lib/build-id";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL("https://erp.ascentraconsulting.co.uk"),
  title: {
    default: "Ascentra | AI-Powered Food Distribution ERP",
    template: "%s | Ascentra ERP",
  },
  description:
    "Integrated warehouse, food traceability, delivery, finance, analytics and AI operating platform for food distribution.",
  applicationName: "Ascentra Food Distribution ERP",
  authors: [{ name: "Ascentra Global Ltd" }],
  creator: "Ascentra Global Ltd",
  publisher: "Ascentra Global Ltd",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/logo.png", type: "image/png" }],
    apple: [{ url: "/logo.png", type: "image/png" }],
  },
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    locale: "en_GB",
    siteName: "Ascentra Food Distribution ERP",
    title: "Ascentra | AI-Powered Food Distribution ERP",
    description:
      "From supplier sourcing and temperature-controlled receiving to FEFO warehouse fulfilment, route delivery, finance and governed AI.",
  },
  twitter: {
    card: "summary",
    title: "Ascentra | AI-Powered Food Distribution ERP",
    description:
      "Connected food distribution operations: warehouse, traceability, delivery, finance and AI.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#061222" }],
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const buildId = getBuildId();
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
        >
          Skip to main content
        </a>
        <div id="main-content">
          <AppShell>{children}</AppShell>
        </div>
        <ErpChatAssistant />
        <BuildWatcher buildId={buildId} />
        <ServiceWorker />
      </body>
    </html>
  );
}
