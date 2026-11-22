"use client";

/**
 * Shared client-side permission layer for Ascentra ERP.
 *
 * Backed by GET /api/v1/auth/me (issued by the backend RBAC engine). Frontend
 * checks here are UX only — every API endpoint independently re-verifies
 * authentication, module, action permission and data scope server-side.
 *
 * The result is cached module-internally and revalidated whenever the window
 * regains focus, so a permission revoked by an administrator stops applying
 * without requiring a manual refresh or workaround.
 */

import {
  Children,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import type { ReactElement, ReactNode } from "react";
import { Lock, Eye } from "lucide-react";

interface AuthorizationPayload {
  loaded: boolean;
  permissions: string[];
  isSuperAdmin: boolean;
}

interface AuthorizationContextValue extends AuthorizationPayload {
  /** True when the named permission is granted (supports "."/":" equivalence and "*"). */
  has: (permission: string) => boolean;
  /** True when any of the permissions is granted. */
  canAny: (permissions: string[]) => boolean;
  /** True when all of the permissions are granted. */
  canAll: (permissions: string[]) => boolean;
  /** True when the user may view a section but has none of the given modify permissions. */
  isViewOnly: (modifyPermissions: string[]) => boolean;
  /** Force a refresh of the cached authorization. */
  refresh: () => void;
}

const AuthorizationContext = createContext<AuthorizationContextValue | null>(null);

let cachedPermissions: string[] | null = null;
let cachedIsSuperAdmin = false;
let inflight: Promise<string[] | null> | null = null;
let listeners: Array<() => void> = [];

function notify() {
  const current = listeners.slice();
  listeners = [];
  for (const listener of current) listener();
}

function normalizeForLookup(permission: string): string {
  return permission.trim();
}

function permissionMatches(have: string[], needed: string): boolean {
  if (have.includes("*")) return true;
  const needle = normalizeForLookup(needed);
  if (have.includes(needle)) return true;
  const alt = needle.includes(".")
    ? needle.replace(/\./g, ":")
    : needle.replace(/:/g, ".");
  return alt !== needle && have.includes(alt);
}

async function fetchAuthorization(force: boolean): Promise<string[] | null> {
  if (!force && cachedPermissions) return cachedPermissions;
  if (inflight) return inflight;

  inflight = fetch("/api/v1/auth/me", { credentials: "include" })
    .then(async (res) => {
      if (!res.ok) return null;
      const data = await res.json();
      const perms = Array.isArray(data?.permissions) ? (data.permissions as string[]) : [];
      cachedPermissions = perms;
      cachedIsSuperAdmin = Boolean(
        data?.is_super_admin || perms.includes("*") || (data?.user?.role === "super_admin")
      );
      return perms;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
      notify();
    });

  return inflight;
}

export function useUserAuthorization(): AuthorizationContextValue {
  // Always render identically on the server and on the first client paint.
  // Seeding from the module-level cache on first render broke hydration:
  // SSR shows the "loading" branch, SPA-navigated client renders the full UI.
  const [state, setState] = useState<AuthorizationPayload>({
    loaded: false,
    permissions: [],
    isSuperAdmin: false
  });

  useEffect(() => {
    let alive = true;
    const hydrate = () => {
      if (cachedPermissions !== null) {
        setState({ loaded: true, permissions: cachedPermissions, isSuperAdmin: cachedIsSuperAdmin });
      }
    };
    const load = async () => {
      const perms = await fetchAuthorization(false);
      if (!alive) return;
      if (perms) {
        setState({ loaded: true, permissions: perms, isSuperAdmin: cachedIsSuperAdmin });
      } else {
        setState((prev) => ({ ...prev, loaded: true }));
      }
    };
    hydrate();
    load();
    const onFocus = () => {
      // Invalidate the cache so a permission revoked by an admin stops applying.
      cachedPermissions = null;
      fetchAuthorization(true);
    };
    const onInvalidate = () => {
      cachedPermissions = null;
      fetchAuthorization(true);
    };
    const listener = () => {
      if (cachedPermissions) {
        setState({ loaded: true, permissions: cachedPermissions, isSuperAdmin: cachedIsSuperAdmin });
      }
    };
    listeners.push(listener);
    window.addEventListener("focus", onFocus);
    window.addEventListener("ascentra:authorization-invalidate", onInvalidate as EventListener);
    return () => {
      alive = false;
      listeners = listeners.filter((l) => l !== listener);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("ascentra:authorization-invalidate", onInvalidate as EventListener);
    };
  }, []);

  const has = useCallback(
    (permission: string) => {
      if (!permission) return true;
      if (state.isSuperAdmin || state.permissions.includes("*")) return true;
      return permissionMatches(state.permissions, permission);
    },
    [state.permissions, state.isSuperAdmin]
  );

  const canAny = useCallback(
    (permissions: string[]) => permissions.some((p) => has(p)),
    [has]
  );
  const canAll = useCallback(
    (permissions: string[]) => permissions.every((p) => has(p)),
    [has]
  );
  const isViewOnly = useCallback(
    (modifyPermissions: string[]) => !canAny(modifyPermissions),
    [canAny]
  );
  const refresh = useCallback(() => {
    cachedPermissions = null;
    void fetchAuthorization(true);
  }, []);

  return useMemo(
    () => ({
      loaded: state.loaded,
      permissions: state.permissions,
      isSuperAdmin: state.isSuperAdmin,
      has,
      canAny,
      canAll,
      isViewOnly,
      refresh
    }),
    [state, has, canAny, canAll, isViewOnly, refresh]
  );
}

/** Request the next mount to re-fetch authorization (e.g. after a role change). */
export function invalidateAuthorizationCache() {
  if (typeof window !== "undefined") {
    cachedPermissions = null;
    window.dispatchEvent(new Event("ascentra:authorization-invalidate"));
  }
}

interface CanProps {
  /** Single permission required for this action. */
  permission?: string;
  /** Any one of these permissions grants access (alternative to `permission`). */
  anyOf?: string[];
  /**
   * "hide" removes the action entirely (used for dangerous/secondary actions).
   * "disable" renders the button non-interactive with an explanatory tooltip.
   * Defaults to "disable" so view-only users can see the action exists.
   */
  mode?: "hide" | "disable";
  /** Tooltip shown on disabled actions. */
  reason?: string;
  children: ReactNode;
}

const DEFAULT_REASON =
  "You do not have permission to perform this action. Contact your administrator if you need additional permissions.";

/**
 * Action-level gate. Hides or disables the wrapped control when the user lacks
 * the required permission. The backend independently enforces the same
 * permission, so bypassing this gate is never sufficient to mutate data.
 */
export function Can({ permission, anyOf, mode = "disable", reason, children }: CanProps) {
  const { has, canAny, loaded } = useUserAuthorization();
  const allowed = permission ? has(permission) : anyOf ? canAny(anyOf) : true;

  // Avoid flashing unauthorized controls before we know the role.
  if (!loaded) return null;
  if (allowed) return <>{children}</>;
  if (mode === "hide") return null;

  const child = Children.only(children) as ReactElement<Record<string, unknown>> | null;
  if (!child) return null;

  const existing = (child.props.className as string | undefined) ?? "";
  const title = (child.props.title as string | undefined) ?? reason ?? DEFAULT_REASON;

  // For anchor/Link children, neutralise navigation instead of confirming a
  // route the user cannot legitimately complete.
  if (typeof (child.type as { name?: string })?.name === "string" &&
      String((child.type as { name?: string }).name).toLowerCase().includes("link")) {
    return (
      <span
        title={title}
        aria-disabled="true"
        className="inline-flex cursor-not-allowed items-center gap-1 opacity-50"
      >
        <span aria-hidden="true" className="pointer-events-none inline-flex items-center">
          {children}
        </span>
        <Lock className="h-3.5 w-3.5 text-muted-foreground" />
      </span>
    );
  }

  const childWithDisabled = {
    ...child,
    props: {
      ...child.props,
      disabled: true,
      "aria-disabled": true,
      title,
      className: `${existing} opacity-50 cursor-not-allowed`.trim()
    }
  };

  return (
    <>
      {childWithDisabled as ReactElement}
      <span className="sr-only">{DEFAULT_REASON}</span>
    </>
  );
}

interface ViewOnlyBadgeProps {
  /** Permissions that, if any one is present, unlock modify access. */
  modifyPermissions: string[];
  /** Optional extra description (used as tooltip). */
  hint?: string;
}

/**
 * Subtle "View only" indicator rendered next to page titles when the user has
 * view permission but none of the modify permissions for the page.
 */
export function ViewOnlyBadge({ modifyPermissions, hint }: ViewOnlyBadgeProps) {
  const { isViewOnly, loaded } = useUserAuthorization();
  if (!loaded) return null;
  if (!isViewOnly(modifyPermissions)) return null;

  return (
    <span
      role="status"
      title={
        hint ??
        "You have view-only access to this section. Contact your administrator if you need additional permissions."
      }
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
    >
      <Eye className="h-3 w-3" aria-hidden="true" />
      View only
    </span>
  );
}

/** One-line helper message, used only where a page needs the explicit guidance text. */
export function ViewOnlyNotice({ modifyPermissions }: ViewOnlyBadgeProps) {
  const { isViewOnly, loaded } = useUserAuthorization();
  if (!loaded) return null;
  if (!isViewOnly(modifyPermissions)) return null;

  return (
    <p className="text-xs text-muted-foreground">
      You have view-only access to this section. Contact your administrator if you need additional permissions.
    </p>
  );
}
