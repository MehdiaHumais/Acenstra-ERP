import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIES = ["ascentra_session", "ascentra_access"];

// Pages reachable without a session.
const PUBLIC_PAGES = new Set([
  "/login",
  "/signup",
  "/invite",
  "/request-access",
  "/forgot-password",
  "/reset-password",
]);

// Static files that must stay reachable on the login screen.
const PUBLIC_ASSETS = new Set([
  "/favicon.ico",
  "/icon.svg",
  "/logo.png",
  "/manifest.json",
  "/robots.txt",
  "/sw.js",
]);

// Brand and icon assets are requested by the unauthenticated login/signup
// screens, the PWA manifest and the service worker. Match by prefix so new
// logo/icon variants (logo.svg, icon-192.png, apple-touch-icon.png, ...) never
// redirect to /login and render as broken images.
const PUBLIC_ASSET_PREFIXES = ["/logo", "/icon", "/apple-touch-icon", "/favicon"];

// Public operational endpoints that must stay reachable without a session.
// GET /health is used by uptime monitors and the Settings diagnostics panel.
// Mutating requests (e.g. POST clear_all_data) still require a session because
// the matcher only short-circuits GET below.
const PUBLIC_PATHS = new Set(["/health"]);

// API endpoints needed before/while authenticating.
const PUBLIC_APIS = [
  "/api/v1/auth/login",
  "/api/v1/auth/logout",
  "/api/v1/auth/barcode",
  "/api/v1/auth/refresh",
  "/api/v1/auth/invitation",
  "/api/v1/auth/mfa",
  "/api/v1/auth/me",
  "/api/v1/auth/forgot-password",
  "/api/v1/auth/reset-password",
  "/api/v1/access-requests",
  "/api/v1/ai/assistant",
  "/api/v1/health",
  "/api/v1/openapi.json",
  "/api/health",
  "/api/version",
];

function isPublicApi(path: string, method: string) {
  // The combined /api/v1/auth endpoint handles signup/login/logout via POST.
  if (path === "/api/v1/auth" && method === "POST") return true;
  return PUBLIC_APIS.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Canonical public origin for redirects. Behind a reverse proxy/tunnel the
 * request URL can arrive as the internal bind address (e.g.
 * https://localhost:3016), which would send unauthenticated users to an
 * unreachable login page. When the public URL is configured, always use it.
 * Local development (no public URL configured) keeps using request.url.
 */
function appUrl(request: NextRequest, pathname: string): URL {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_APP_URL || "";
  if (configured) {
    try {
      const url = new URL(configured);
      if (
        /^https?:$/.test(url.protocol) &&
        !/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(url.hostname)
      ) {
        return new URL(pathname, url.origin);
      }
    } catch {
      // Ignore a malformed/placeholder value and fall back to request.url.
    }
  }
  return new URL(pathname, request.url);
}

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isApi = path.startsWith("/api/");
  const isLoggedIn = SESSION_COOKIES.some(
    (name) => Boolean(request.cookies.get(name)?.value),
  );

  // Signed-in users don't need the login/signup screens. Exception: a user
  // arriving with ?reason=… was just signed out (account deleted/disabled or
  // session expired). A stale cookie must never bounce them back into the app.
  const forcedLogout = path === "/login" && request.nextUrl.searchParams.has("reason");
  if (PUBLIC_PAGES.has(path)) {
    if (isLoggedIn && !forcedLogout) {
      return NextResponse.redirect(appUrl(request, "/"));
    }
    return NextResponse.next();
  }

  // Invitation acceptance pages are public (/invite/<token>).
  if (path.startsWith("/invite/")) {
    return NextResponse.next();
  }

  if (
    PUBLIC_ASSETS.has(path) ||
    PUBLIC_ASSET_PREFIXES.some((prefix) => path.startsWith(prefix))
  ) {
    return NextResponse.next();
  }
  if (PUBLIC_PATHS.has(path) && request.method === "GET") return NextResponse.next();
  if (isPublicApi(path, request.method)) return NextResponse.next();

  if (!isLoggedIn) {
    if (isApi) {
      return NextResponse.json(
        { error: { code: "UNAUTHENTICATED", message: "Authentication required." } },
        { status: 401 },
      );
    }
    const loginUrl = appUrl(request, "/login");
    loginUrl.searchParams.set("redirect", path + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next).*)"],
};
