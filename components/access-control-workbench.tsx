"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Copy,
  History,
  KeyRound,
  Loader2,
  Mail,
  Plus,
  QrCode,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserCog,
  Users,
  UserPlus,
  Send,
  CheckCircle2,
} from "lucide-react";
import { Badge, SectionHeader, StatRow, Surface } from "@/components/ui";
import { Can, ViewOnlyBadge, invalidateAuthorizationCache } from "@/components/access-gate";
import { AccessCardModal } from "@/components/access-card-modal";
import { cn } from "@/lib/format";

interface AccessUser {
  id: string;
  email: string;
  name: string;
  role: string;
  roles: string[];
  role_names: string[];
  store_id: string | null;
  warehouse: string | null;
  active: boolean;
  mfa_enabled: boolean;
  locked: boolean;
  permissions: string[];
  scopes: Record<string, string[]>;
  created_at: string;
  last_login_at: string | null;
}

interface AccessRole {
  code: string;
  name: string;
  description: string;
  role_type: "system" | "custom";
  base_role: string | null;
  is_system: boolean;
  protected: boolean;
  active: boolean;
  assigned_users: number;
  permissions: string[];
}

interface PermissionDescriptor {
  code: string;
  module: string;
  action: string;
  label: string;
  description: string;
  sensitive: boolean;
}

interface PermissionMatrix {
  modules: Array<{ code: string; name: string; description: string; permissions: PermissionDescriptor[] }>;
  permissions: PermissionDescriptor[];
}

interface ApprovalThreshold {
  action_code: string;
  label: string;
  amount_cents: number | null;
  requires_permission: string;
  maker_checker: boolean;
  active: boolean;
  updated_by: string | null;
  updated_at: string;
}

interface SecurityEvent {
  id: string;
  actor_email: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  ip_address: string | null;
  created_at: string;
}

interface InvitationRow {
  id: string;
  email: string;
  name: string;
  roles: string[];
  status: "pending" | "expired" | "revoked" | "accepted";
  created_at: string;
  expires_at: string;
  invited_by_name: string | null;
}

type Tab = "users" | "roles" | "permissions" | "approvals" | "security";

const TABS: Array<{ id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "users", label: "Users", icon: Users },
  { id: "roles", label: "Roles", icon: UserCog },
  { id: "permissions", label: "Permission Matrix", icon: KeyRound },
  { id: "approvals", label: "Approval Authority", icon: BadgeCheck },
  { id: "security", label: "Security & Audit", icon: History },
];

const SCOPE_KEYS = ["company", "warehouse", "store", "customer", "supplier", "delivery", "task"] as const;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (payload && (payload.error?.message || payload.message)) ||
      `Request failed (${res.status})`;
    throw new Error(message);
  }
  // Any non-GET admin change revokes/changes sessions or permissions. Ask the
  // client to re-fetch authorization on the next focus/mount so revoked
  // permissions stop applying without a manual refresh.
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET") invalidateAuthorizationCache();
  return payload as T;
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-border"
      />
      {label}
    </label>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block text-xs font-semibold text-muted-foreground">
      <span className="mb-1 block uppercase tracking-[0.08em]">{label}</span>
      {children}
      {hint && <span className="mt-1 block font-normal text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

export function AccessControlWorkbench() {
  const [tab, setTab] = useState<Tab>("users");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [users, setUsers] = useState<AccessUser[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [roles, setRoles] = useState<AccessRole[]>([]);
  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null);
  const [thresholds, setThresholds] = useState<ApprovalThreshold[]>([]);
  const [events, setEvents] = useState<SecurityEvent[]>([]);

  const [selectedRole, setSelectedRole] = useState<string>("");
  const [selectedUser, setSelectedUser] = useState<AccessUser | null>(null);
  const [barcodeUser, setBarcodeUser] = useState<AccessUser | null>(null);

  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    role: "picker",
    warehouse: "Milan Cold Hub",
    store_id: "",
    warehouseScope: "",
    storeScope: "",
  });
  const [createMode, setCreateMode] = useState<"invite" | "manual">("invite");
  const [inviteResult, setInviteResult] = useState<{ url: string; email: string; expires_at: string; delivery: string } | null>(null);
  const [manualResult, setManualResult] = useState<{ password: string; email: string; name: string } | null>(null);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [inviteSearch, setInviteSearch] = useState("");
  const [inviteStatus, setInviteStatus] = useState<"" | "pending" | "expired" | "revoked" | "accepted">("");
  const [copiedOnce, setCopiedOnce] = useState<"invite" | "manual" | null>(null);

  const [newRole, setNewRole] = useState({
    name: "",
    description: "",
    base_role: "",
  });

  const roleByCode = useMemo(() => new Map(roles.map((role) => [role.code, role])), [roles]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (roleFilter) params.set("role", roleFilter);
      if (statusFilter) params.set("status", statusFilter);
      const data = await api<{ users: AccessUser[]; total: number }>(
        `/api/v1/admin/users?${params.toString()}`,
      );
      setUsers(data.users);
      setUserTotal(data.total);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, statusFilter]);

  const loadRoles = useCallback(async () => {
    try {
      const data = await api<{ roles: AccessRole[] }>("/api/v1/admin/roles");
      setRoles(data.roles);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const loadMatrix = useCallback(async () => {
    try {
      const data = await api<PermissionMatrix>("/api/v1/admin/permissions");
      setMatrix(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const loadThresholds = useCallback(async () => {
    try {
      const data = await api<{ thresholds: ApprovalThreshold[] }>(
        "/api/v1/admin/approval-thresholds",
      );
      setThresholds(data.thresholds);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      const data = await api<{ events: SecurityEvent[] }>("/api/v1/admin/security-events?limit=100");
      setEvents(data.events);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const loadInvitations = useCallback(async () => {
    setInvitesLoading(true);
    try {
      const params = new URLSearchParams();
      if (inviteSearch) params.set("search", inviteSearch);
      if (inviteStatus) params.set("status", inviteStatus);
      params.set("limit", "50");
      const data = await api<{ invitations: InvitationRow[]; total: number }>(`/api/v1/admin/invitations?${params.toString()}`);
      setInvitations(Array.isArray(data?.invitations) ? data.invitations : []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setInvitesLoading(false);
    }
  }, [inviteSearch, inviteStatus]);

  useEffect(() => {
    loadRoles();
    loadMatrix();
  }, [loadRoles, loadMatrix]);

  useEffect(() => {
    if (tab === "users") {
      loadUsers();
      loadInvitations();
    }
    if (tab === "roles") loadRoles();
    if (tab === "permissions") loadMatrix();
    if (tab === "approvals") loadThresholds();
    if (tab === "security") loadEvents();
  }, [tab, loadUsers, loadRoles, loadMatrix, loadThresholds, loadEvents, loadInvitations]);

  const flash = (message: string) => {
    setNotice(message);
    setError(null);
    window.setTimeout(() => setNotice(null), 3200);
  };

  const buildScopes = (): Record<string, string[]> => {
    const scopes: Record<string, string[]> = {};
    if (newUser.warehouseScope) scopes.warehouse = [newUser.warehouseScope];
    if (newUser.storeScope) {
      scopes.store = [newUser.storeScope];
      scopes.customer = [newUser.storeScope];
    }
    return scopes;
  };

  const createInvitation = async () => {
    if (!newUser.name.trim() || !newUser.email.trim()) {
      setError("Full name and a valid email are required to send an invitation.");
      return;
    }
    try {
      const created = await api<{ invite_url: string | null; invitation: InvitationRow; email_delivery?: string }>(
        "/api/v1/admin/invitations",
        {
          method: "POST",
          body: JSON.stringify({
            name: newUser.name.trim(),
            email: newUser.email.trim(),
            roles: [newUser.role],
            warehouse: newUser.warehouse || "Milan Cold Hub",
            store_id: newUser.store_id || null,
            scopes: buildScopes(),
          }),
        }
      );
      setInviteResult({
        url: created.invite_url ?? `${window.location.origin}/invite/<token>`,
        email: newUser.email.trim(),
        expires_at: created.invitation?.expires_at ?? "",
        delivery: created.email_delivery ?? "smtp_not_configured",
      });
      setNewUser({ ...newUser, name: "", email: "", warehouseScope: "", storeScope: "", store_id: "" });
      flash(
        created.email_delivery === "smtp_sent"
          ? `Invitation email sent to ${newUser.email.trim()}. Share the backup link if needed — expires in 72 hours.`
          : "Email could not be delivered — share the invitation link directly; it expires in 72 hours."
      );
      loadInvitations();
      loadEvents();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const createManualAccount = async () => {
    if (!newUser.name.trim() || !newUser.email.trim()) {
      setError("Full name and a valid email are required to create an account.");
      return;
    }
    try {
      const created = await api<{ id: string; email: string; temporary_password: string }>(
        "/api/v1/admin/users/manual",
        {
          method: "POST",
          body: JSON.stringify({
            name: newUser.name.trim(),
            email: newUser.email.trim(),
            roles: [newUser.role],
            warehouse: newUser.warehouse || "Milan Cold Hub",
            store_id: newUser.store_id || null,
            scopes: buildScopes(),
          }),
        }
      );
      setManualResult({ password: created.temporary_password, email: created.email, name: newUser.name.trim() });
      setNewUser({ ...newUser, name: "", email: "", warehouseScope: "", storeScope: "", store_id: "" });
      flash("Account created. Share the temporary password — it will never be shown again.");
      loadUsers();
      loadEvents();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const resendInvitation = async (id: string) => {
    try {
      const created = await api<{ invite_url: string | null; invitation: InvitationRow; email_delivery?: string }>(
        `/api/v1/admin/invitations/${id}`,
        { method: "POST", body: JSON.stringify({ action: "resend" }) }
      );
      setInviteResult({
        url: created.invite_url ?? `${window.location.origin}/invite/<token>`,
        email: created.invitation?.email ?? "",
        expires_at: created.invitation?.expires_at ?? "",
        delivery: created.email_delivery ?? "smtp_not_configured",
      });
      flash(
        created.email_delivery === "smtp_sent"
          ? `Invitation email re-sent to ${created.invitation?.email ?? "the recipient"}.`
          : "Email could not be delivered — share the link directly."
      );
      loadInvitations();
      loadEvents();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const revokeInvitation = async (id: string) => {
    try {
      await api(`/api/v1/admin/invitations/${id}`, { method: "POST", body: JSON.stringify({ action: "revoke" }) });
      setInvitations((current) => current.map((inv) => (inv.id === id ? { ...inv, status: "revoked" } : inv)));
      flash("Invitation revoked.");
      loadEvents();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const copyText = async (text: string, kind: "invite" | "manual") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedOnce(kind);
      window.setTimeout(() => setCopiedOnce(null), 2000);
    } catch {
      setError("Could not copy to the clipboard.");
    }
  };

  const saveUser = async () => {
    if (!selectedUser) return;
    try {
      const scopes: Record<string, string[]> = {};
      for (const key of SCOPE_KEYS) {
        const values = selectedUser.scopes?.[key] ?? [];
        if (values.length > 0) scopes[key] = values;
      }
      await api(`/api/v1/admin/users/${selectedUser.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: selectedUser.name,
          email: selectedUser.email,
          roles: selectedUser.roles,
          primary_role: selectedUser.role,
          warehouse: selectedUser.warehouse,
          store_id: selectedUser.store_id,
          active: selectedUser.active,
          scopes,
        }),
      });
      flash(`Saved access for ${selectedUser.email}. Active sessions were revalidated.`);
      setSelectedUser(null);
      loadUsers();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const suspendUser = async (user: AccessUser) => {
    try {
      await api(`/api/v1/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !user.active }),
      });
      flash(`${user.email} ${user.active ? "suspended" : "reactivated"}.`);
      loadUsers();
      loadEvents();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const deleteUser = async (user: AccessUser) => {
    try {
      await api(`/api/v1/admin/users/${user.id}`, { method: "DELETE" });
      flash(`${user.email} deleted (retained in audit history).`);
      loadUsers();
      loadEvents();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const createRole = async () => {
    try {
      await api("/api/v1/admin/roles", {
        method: "POST",
        body: JSON.stringify({
          name: newRole.name,
          description: newRole.description,
          base_role: newRole.base_role || undefined,
        }),
      });
      setNewRole({ name: "", description: "", base_role: "" });
      flash("Custom role created from the selected base role.");
      loadRoles();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const duplicateRole = async (role: AccessRole) => {
    try {
      await api(`/api/v1/admin/roles/${role.code}/duplicate`, {
        method: "POST",
        body: JSON.stringify({ name: `${role.name} (Copy)` }),
      });
      flash(`Duplicated ${role.name}.`);
      loadRoles();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const deactivateRole = async (role: AccessRole) => {
    try {
      await api(`/api/v1/admin/roles/${role.code}`, { method: "DELETE" });
      flash(`${role.name} deactivated.`);
      loadRoles();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const saveRolePermissions = async (roleCode: string, permissions: string[]) => {
    try {
      await api(`/api/v1/admin/roles/${roleCode}`, {
        method: "PATCH",
        body: JSON.stringify({ permissions }),
      });
      flash(`Permissions updated for ${roleCode}. Assigned sessions were revoked.`);
      loadRoles();
      loadEvents();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const saveThreshold = async (threshold: ApprovalThreshold, patch: Partial<ApprovalThreshold>) => {
    try {
      await api("/api/v1/admin/approval-thresholds", {
        method: "PATCH",
        body: JSON.stringify({ action_code: threshold.action_code, ...patch }),
      });
      flash(`Approval authority updated for ${threshold.label}.`);
      loadThresholds();
      loadEvents();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const activeRole = selectedRole ? roleByCode.get(selectedRole) : undefined;

  return (
    <div className="space-y-5">
      <Surface>
        <SectionHeader
          eyebrow="Settings & Architecture"
          title="Users, Roles, Permissions & Security"
          description="Backend-enforced RBAC with module, action and data-scope layers. Every change is audited; sessions are revalidated after role changes."
          action={
            <div className="flex items-center gap-2">
              <ViewOnlyBadge modifyPermissions={["users.manage", "roles.manage", "approvals.manage"]} />
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  if (tab === "users") loadUsers();
                  if (tab === "roles") loadRoles();
                  if (tab === "permissions") loadMatrix();
                  if (tab === "approvals") loadThresholds();
                  if (tab === "security") loadEvents();
                }}
                className="btn btn-secondary btn-sm"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                Refresh
              </button>
            </div>
          }
        />
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          {TABS.map((entry) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
                  tab === entry.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {entry.label}
              </button>
            );
          })}
        </div>
        <div className="p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatRow label="Accounts" value={`${userTotal} managed users`} tone="ok" />
            <StatRow label="Roles" value={`${roles.length} system & custom roles`} tone="ok" />
            <StatRow
              label="Approval rules"
              value={`${thresholds.filter((t) => t.active).length} active thresholds`}
              tone="ok"
            />
          </div>
        </div>
      </Surface>

      {(error || notice) && (
        <div
          className={cn(
            "rounded-lg border px-4 py-3 text-sm",
            error
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : "border-marine-ocean/60 bg-marine-ocean/25 text-marine-navy",
          )}
        >
          {error ?? notice}
        </div>
      )}

      {tab === "users" && (
        <Surface>
          <SectionHeader
            eyebrow="Identity & access"
            title="User accounts"
            description="Create, suspend, soft-delete and re-scope accounts. Super Admin accounts are protected from non-Super-Admin modification."
          />
          <div className="space-y-4 p-5">
            <div className="grid gap-2 md:grid-cols-[1.4fr_1fr_1fr_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search name or email"
                  className={cn(inputClass, "pl-9")}
                />
              </div>
              <select
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value)}
                className={inputClass}
              >
                <option value="">All roles</option>
                {roles.map((role) => (
                  <option key={role.code} value={role.code}>
                    {role.name}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className={inputClass}
              >
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
              <button type="button" onClick={loadUsers} className="btn btn-primary btn-sm">
                Apply
              </button>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-muted/50 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">User</th>
                    <th className="px-3 py-2">Roles</th>
                    <th className="px-3 py-2">Warehouse / Store</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Last login</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-t border-border/70">
                      <td className="px-3 py-2">
                        <p className="font-semibold">{user.name}</p>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {(user.role_names.length ? user.role_names : user.roles).map((name) => (
                            <Badge key={name} tone="info">
                              {name}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        <p>{user.warehouse ?? "—"}</p>
                        {user.store_id && <p>{user.store_id}</p>}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={user.active ? "ok" : "critical"} dot>
                          {user.active ? "Active" : "Suspended"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {user.last_login_at ?? "Never"}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            title="Edit access"
                            onClick={() => setSelectedUser(user)}
                            className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground"
                          >
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                          </button>
                          <Can permission="users.manage" mode="hide">
                            <button
                              type="button"
                              title="Access card — generate, print, revoke barcode"
                              onClick={() => setBarcodeUser(user)}
                              className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground"
                            >
                              <QrCode className="h-3.5 w-3.5" />
                            </button>
                          </Can>
                          <Can permission="users.manage" mode="hide">
                            <button
                              type="button"
                              title={user.active ? "Suspend" : "Reactivate"}
                              onClick={() => suspendUser(user)}
                              className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground"
                            >
                              <ShieldCheck className="h-3.5 w-3.5" />
                            </button>
                          </Can>
                          <Can permission="users.manage" mode="hide">
                            <button
                              type="button"
                              title="Soft delete (retain audit history)"
                              onClick={() => deleteUser(user)}
                              className="rounded-md border border-border p-1.5 text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </Can>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                        No accounts match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* ---------------- Invite / Manual onboarding (two methods) ---------------- */}
            <div className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <UserPlus className="h-4 w-4" /> Create account
                </h3>
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                  <button
                    type="button"
                    onClick={() => setCreateMode("invite")}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors",
                      createMode === "invite" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Mail className="mr-1 inline h-3.5 w-3.5" /> Invite by email
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateMode("manual")}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors",
                      createMode === "manual" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <KeyRound className="mr-1 inline h-3.5 w-3.5" /> Create manually
                  </button>
                </div>
              </div>

              {createMode === "invite" && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Sends an expiring invitation link (72 h). This deployment has no SMTP/email service — the link is shown to you once to deliver through your own secure channel.
                </p>
              )}
              {createMode === "manual" && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Creates the account immediately with a system-generated temporary password. The employee must set a new password on first sign-in.
                </p>
              )}

              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <Field label="Full name">
                  <input
                    value={newUser.name}
                    onChange={(event) => setNewUser({ ...newUser, name: event.target.value })}
                    className={inputClass}
                  />
                </Field>
                <Field label="Email">
                  <input
                    type="email"
                    value={newUser.email}
                    onChange={(event) => setNewUser({ ...newUser, email: event.target.value })}
                    className={inputClass}
                  />
                </Field>
                <Field label="Primary role">
                  <select
                    value={newUser.role}
                    onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}
                    className={inputClass}
                  >
                    {roles
                      .filter((role) => role.active)
                      .map((role) => (
                        <option key={role.code} value={role.code}>
                          {role.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Warehouse">
                  <input
                    value={newUser.warehouse}
                    onChange={(event) => setNewUser({ ...newUser, warehouse: event.target.value })}
                    className={inputClass}
                  />
                </Field>
                <Field label="Store / customer ID">
                  <input
                    value={newUser.store_id}
                    onChange={(event) => setNewUser({ ...newUser, store_id: event.target.value })}
                    className={inputClass}
                  />
                </Field>
                <Field label="Warehouse scope" hint="Leave blank for default.">
                  <input
                    value={newUser.warehouseScope}
                    onChange={(event) => setNewUser({ ...newUser, warehouseScope: event.target.value })}
                    className={inputClass}
                  />
                </Field>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Can permission="users.manage" mode="disable">
                  {createMode === "invite" ? (
                    <button type="button" onClick={createInvitation} className="btn btn-primary btn-sm gap-1.5">
                      <Send className="h-3.5 w-3.5" /> Send invitation
                    </button>
                  ) : (
                    <button type="button" onClick={createManualAccount} className="btn btn-primary btn-sm gap-1.5">
                      <UserPlus className="h-3.5 w-3.5" /> Create account
                    </button>
                  )}
                </Can>
              </div>

              {/* One-time invitation link reveal */}
              {inviteResult && (
                <div className={cn(
                  "mt-3 rounded-lg border p-3",
                  inviteResult.delivery === "smtp_sent" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
                )}>
                  <p className={cn("flex items-center gap-1.5 text-xs font-semibold", inviteResult.delivery === "smtp_sent" ? "text-emerald-900" : "text-amber-900")}>
                    <CheckCircle2 className="h-4 w-4" /> {inviteResult.delivery === "smtp_sent" ? `Email sent to ${inviteResult.email}` : `Invitation for ${inviteResult.email}` + (inviteResult.delivery === "send_failed" ? " — email could NOT be delivered" : " — email not configured")}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <input readOnly value={inviteResult.url} className="input flex-1 font-mono text-[11px]" onFocus={(event) => event.target.select()} />
                    <button type="button" className="btn btn-secondary btn-sm shrink-0 gap-1" onClick={() => copyText(inviteResult.url, "invite")}>
                      <Copy className="h-3.5 w-3.5" /> {copiedOnce === "invite" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p className="mt-1.5 text-[10px] text-emerald-800">
                    {inviteResult.delivery === "smtp_sent"
                      ? `Invitation email delivered to ${inviteResult.email}. Expires: ${inviteResult.expires_at || "in 72 hours"}.`
                      : `Expires: ${inviteResult.expires_at || "in 72 hours"}. Share via Teams, email or SMS — never post it publicly.`}
                  </p>
                  <button type="button" className="mt-2 text-[10px] font-semibold text-emerald-900 underline" onClick={() => setInviteResult(null)}>
                    Dismiss
                  </button>
                </div>
              )}

              {/* One-time temporary password reveal */}
              {manualResult && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                    <ShieldCheck className="h-4 w-4" /> Account for {manualResult.email} — temporary password (shown once)
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <input readOnly value={manualResult.password} className="input flex-1 font-mono text-[12px] tracking-wider" onFocus={(event) => event.target.select()} />
                    <button type="button" className="btn btn-secondary btn-sm shrink-0 gap-1" onClick={() => copyText(manualResult.password, "manual")}>
                      <Copy className="h-3.5 w-3.5" /> {copiedOnce === "manual" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p className="mt-1.5 text-[10px] text-amber-800">Employee must set a new password on first sign-in. Never store or email this password — hand it over in person or by phone.</p>
                  <button type="button" className="mt-2 text-[10px] font-semibold text-amber-900 underline" onClick={() => setManualResult(null)}>
                    Dismiss
                  </button>
                </div>
              )}

              {/* Invitations list */}
              <div className="mt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pending & past invitations</h4>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
                      <input
                        value={inviteSearch}
                        onChange={(event) => setInviteSearch(event.target.value)}
                        placeholder="Search email or name…"
                        className="h-8 w-44 rounded-lg border border-input bg-background pl-7 pr-2 text-[11px] outline-none"
                      />
                    </div>
                    <select
                      value={inviteStatus}
                      onChange={(event) => setInviteStatus(event.target.value as typeof inviteStatus)}
                      className="h-8 rounded-lg border border-input bg-background px-2 text-[11px] outline-none"
                    >
                      <option value="">All statuses</option>
                      <option value="pending">Pending Invitation</option>
                      <option value="expired">Invitation Expired</option>
                      <option value="revoked">Revoked</option>
                      <option value="accepted">Accepted</option>
                    </select>
                    <button type="button" onClick={loadInvitations} className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground" title="Refresh">
                      <RefreshCw className={cn("h-3.5 w-3.5", invitesLoading && "animate-spin")} />
                    </button>
                  </div>
                </div>
                <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border">
                  <table className="data-table text-[11px]">
                    <thead>
                      <tr>
                        <th>Invitee</th><th>Role(s)</th><th>Status</th><th>Expires</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {invitations.map((inv) => (
                        <tr key={inv.id}>
                          <td>
                            <span className="font-medium">{inv.name}</span><br />
                            <span className="text-muted-foreground">{inv.email}</span>
                          </td>
                          <td>{inv.roles.join(", ")}</td>
                          <td>
                            <span className={cn(
                              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                              inv.status === "pending" && "border-amber-300 bg-amber-50 text-amber-800",
                              inv.status === "expired" && "border-slate-300 bg-slate-100 text-slate-700",
                              inv.status === "revoked" && "border-red-300 bg-red-50 text-red-700",
                              inv.status === "accepted" && "border-emerald-300 bg-emerald-50 text-emerald-800"
                            )}>
                              {inv.status === "pending" ? "Pending Invitation" : inv.status === "expired" ? "Invitation Expired" : inv.status === "revoked" ? "Revoked" : "Accepted"}
                            </span>
                          </td>
                          <td className="whitespace-nowrap">{new Date(inv.expires_at).toLocaleString()}</td>
                          <td className="whitespace-nowrap text-right">
                            {inv.status === "pending" && (
                              <div className="flex items-center justify-end gap-1">
                                <button type="button" title="Resend (new link, 72h)" className="rounded-md border border-border p-1 text-muted-foreground hover:text-foreground" onClick={() => resendInvitation(inv.id)}>
                                  <RefreshCw className="h-3.5 w-3.5" />
                                </button>
                                <button type="button" title="Revoke invitation" className="rounded-md border border-border p-1 text-muted-foreground hover:text-destructive" onClick={() => revokeInvitation(inv.id)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                      {invitations.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">
                            No invitations yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </Surface>
      )}

      {barcodeUser && (
        <AccessCardModal user={barcodeUser} onClose={() => setBarcodeUser(null)} />
      )}

      {selectedUser && (
        <Surface>
          <SectionHeader
            eyebrow="Access editor"
            title={`Access for ${selectedUser.name}`}
            description="Role assignments, data scopes and account status. Changes take effect immediately and revoke active refresh tokens when roles change."
            action={
              <button type="button" onClick={() => setSelectedUser(null)} className="btn btn-secondary btn-sm">
                Close
              </button>
            }
          />
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <Field label="Name">
              <input
                value={selectedUser.name}
                onChange={(event) => setSelectedUser({ ...selectedUser, name: event.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Email">
              <input
                value={selectedUser.email}
                onChange={(event) => setSelectedUser({ ...selectedUser, email: event.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Roles" hint="Ctrl/Cmd-click to assign multiple roles.">
              <select
                multiple
                value={selectedUser.roles}
                onChange={(event) => {
                  const values = Array.from(event.target.selectedOptions).map((o) => o.value);
                  setSelectedUser({
                    ...selectedUser,
                    roles: values,
                    role: values[0] ?? selectedUser.role,
                  });
                }}
                className={cn(inputClass, "h-28")}
              >
                {roles.map((role) => (
                  <option key={role.code} value={role.code}>
                    {role.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Primary role">
              <select
                value={selectedUser.role}
                onChange={(event) => setSelectedUser({ ...selectedUser, role: event.target.value })}
                className={inputClass}
              >
                {selectedUser.roles.map((code) => (
                  <option key={code} value={code}>
                    {roleByCode.get(code)?.name ?? code}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Warehouse">
              <input
                value={selectedUser.warehouse ?? ""}
                onChange={(event) => setSelectedUser({ ...selectedUser, warehouse: event.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Store / customer ID">
              <input
                value={selectedUser.store_id ?? ""}
                onChange={(event) =>
                  setSelectedUser({ ...selectedUser, store_id: event.target.value || null })
                }
                className={inputClass}
              />
            </Field>
            {SCOPE_KEYS.map((key) => (
              <Field key={key} label={`${key} scope`} hint="Comma-separated values. Use * for all.">
                <input
                  value={(selectedUser.scopes?.[key] ?? []).join(", ")}
                  onChange={(event) =>
                    setSelectedUser({
                      ...selectedUser,
                      scopes: {
                        ...selectedUser.scopes,
                        [key]: event.target.value
                          .split(",")
                          .map((value) => value.trim())
                          .filter(Boolean),
                      },
                    })
                  }
                  className={inputClass}
                />
              </Field>
            ))}
            <div className="flex items-end gap-4">
              <Toggle
                checked={selectedUser.active}
                onChange={(value) => setSelectedUser({ ...selectedUser, active: value })}
                label="Account active"
              />
              <Can permission="users.manage" mode="hide">
                <button type="button" onClick={saveUser} className="btn btn-primary btn-sm">
                  <Save className="h-3.5 w-3.5" /> Save access
                </button>
              </Can>
            </div>
          </div>
        </Surface>
      )}

      {tab === "roles" && (
        <Surface>
          <SectionHeader
            eyebrow="Role catalogue"
            title="Roles & custom roles"
            description="Create, rename, describe, duplicate and deactivate roles. System roles are protected; custom roles inherit from a base template and can be tuned."
          />
          <div className="space-y-4 p-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {roles.map((role) => (
                <div key={role.code} className="rounded-lg border border-border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{role.name}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">{role.code}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge tone={role.is_system ? "info" : "warning"}>
                        {role.is_system ? "System" : "Custom"}
                      </Badge>
                      {!role.active && <Badge tone="critical">Inactive</Badge>}
                    </div>
                  </div>
                  <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{role.description}</p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {role.permissions.length} permissions · {role.assigned_users} users
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedRole(role.code);
                        setTab("permissions");
                      }}
                      className="btn btn-secondary btn-sm"
                    >
                      <KeyRound className="h-3.5 w-3.5" /> Permissions
                    </button>
                    <Can permission="roles.manage" mode="hide">
                      <button
                        type="button"
                        onClick={() => duplicateRole(role)}
                        className="btn btn-secondary btn-sm"
                      >
                        <Copy className="h-3.5 w-3.5" /> Duplicate
                      </button>
                    </Can>
                    {!role.is_system && role.active && (
                      <Can permission="roles.manage" mode="hide">
                        <button
                          type="button"
                          onClick={() => deactivateRole(role)}
                          className="btn btn-secondary btn-sm text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Deactivate
                        </button>
                      </Can>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-border p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Plus className="h-4 w-4" /> Create custom role
              </h3>
              <div className="mt-3 grid gap-3 md:grid-cols-4">
                <Field label="Role name">
                  <input
                    value={newRole.name}
                    onChange={(event) => setNewRole({ ...newRole, name: event.target.value })}
                    className={inputClass}
                  />
                </Field>
                <Field label="Description">
                  <input
                    value={newRole.description}
                    onChange={(event) => setNewRole({ ...newRole, description: event.target.value })}
                    className={inputClass}
                  />
                </Field>
                <Field label="Base role" hint="Copies the template permissions.">
                  <select
                    value={newRole.base_role}
                    onChange={(event) => setNewRole({ ...newRole, base_role: event.target.value })}
                    className={inputClass}
                  >
                    <option value="">Start empty</option>
                    {roles.map((role) => (
                      <option key={role.code} value={role.code}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="flex items-end">
                  <Can permission="roles.manage" mode="hide">
                    <button type="button" onClick={createRole} className="btn btn-primary btn-sm w-full">
                      <Plus className="h-3.5 w-3.5" /> Create role
                    </button>
                  </Can>
                </div>
              </div>
            </div>
          </div>
        </Surface>
      )}

      {tab === "permissions" && (
        <Surface>
          <SectionHeader
            eyebrow="Granular permission matrix"
            title="Module & action permissions"
            description="Every endpoint denies by default. Select a role to inspect and, for custom roles, adjust its granted permissions. Non-Super-Admins cannot grant permissions they do not hold."
          />
          <div className="space-y-4 p-5">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Role">
                <select
                  value={selectedRole}
                  onChange={(event) => setSelectedRole(event.target.value)}
                  className={cn(inputClass, "min-w-[240px]")}
                >
                  <option value="">Select a role…</option>
                  {roles.map((role) => (
                    <option key={role.code} value={role.code}>
                      {role.name} ({role.code})
                    </option>
                  ))}
                </select>
              </Field>
              {activeRole && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge tone={activeRole.is_system ? "info" : "warning"}>
                    {activeRole.is_system ? "System role" : "Custom role"}
                  </Badge>
                  {activeRole.permissions.includes("*") && <Badge tone="critical">Wildcard *</Badge>}
                </div>
              )}
            </div>

            {activeRole && matrix && (
              <RolePermissionEditor
                key={activeRole.code}
                role={activeRole}
                matrix={matrix}
                onSave={(permissions) => saveRolePermissions(activeRole.code, permissions)}
              />
            )}

            {!activeRole && (
              <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                Choose a role to view its permission matrix.
              </p>
            )}
          </div>
        </Surface>
      )}

      {tab === "approvals" && (
        <Surface>
          <SectionHeader
            eyebrow="Approval authority"
            title="Configurable approval thresholds"
            description="Amounts and required permissions for purchase orders, stock adjustments, QA releases, credit limits, refunds, recalls and consequential AI actions. Maker-checker is enforced where configured."
          />
          <div className="overflow-x-auto p-5">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-muted/50 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Threshold (EUR)</th>
                  <th className="px-3 py-2">Required permission</th>
                  <th className="px-3 py-2">Maker-checker</th>
                  <th className="px-3 py-2">Active</th>
                  <th className="px-3 py-2 text-right">Save</th>
                </tr>
              </thead>
              <tbody>
                {thresholds.map((threshold) => (
                  <ThresholdRow
                    key={threshold.action_code}
                    threshold={threshold}
                    onSave={saveThreshold}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Surface>
      )}

      {tab === "security" && (
        <Surface>
          <SectionHeader
            eyebrow="Security & audit"
            title="Recent security events"
            description="User lifecycle, role/permission/scope changes, approvals, overrides, security failures and Super Admin actions. Secrets are redacted before writing."
          />
          <div className="overflow-x-auto p-5">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-muted/50 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Entity</th>
                  <th className="px-3 py-2">IP</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-t border-border/70">
                    <td className="px-3 py-2 text-xs text-muted-foreground">{event.created_at}</td>
                    <td className="px-3 py-2 text-xs">
                      <p className="font-medium">{event.actor_email}</p>
                      <p className="text-muted-foreground">{event.actor_role}</p>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]">{event.action}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {event.entity_type} · {event.entity_id}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{event.ip_address ?? "—"}</td>
                  </tr>
                ))}
                {events.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">
                      No security events recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Surface>
      )}
    </div>
  );
}

function RolePermissionEditor({
  role,
  matrix,
  onSave,
}: {
  role: AccessRole;
  matrix: PermissionMatrix;
  onSave: (permissions: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(role.permissions.filter((p) => p !== "*"));
  const [query, setQuery] = useState("");

  const toggle = (code: string) => {
    setSelected((prev) => (prev.includes(code) ? prev.filter((p) => p !== code) : [...prev, code]));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter permissions…"
            className={cn(inputClass, "pl-9")}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{selected.length} granted</span>
          <Can permission="roles.manage" mode="hide">
            <button type="button" onClick={() => onSave(selected)} className="btn btn-primary btn-sm">
              <Save className="h-3.5 w-3.5" /> Save permissions
            </button>
          </Can>
        </div>
      </div>

      <div className="space-y-4">
        {matrix.modules.map((module) => {
          const permissions = module.permissions.filter((permission) => {
            if (!query) return true;
            const term = query.toLowerCase();
            return (
              permission.code.toLowerCase().includes(term) ||
              permission.label.toLowerCase().includes(term)
            );
          });
          if (permissions.length === 0) return null;
          const granted = permissions.filter((permission) => selected.includes(permission.code)).length;
          return (
            <div key={module.code} className="rounded-lg border border-border">
              <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2">
                <div>
                  <p className="text-sm font-semibold">{module.name}</p>
                  <p className="text-[11px] text-muted-foreground">{module.description}</p>
                </div>
                <Badge tone="info">
                  {granted}/{permissions.length}
                </Badge>
              </div>
              <div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">
                {permissions.map((permission) => (
                  <label
                    key={permission.code}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-xs transition-colors",
                      selected.includes(permission.code)
                        ? "border-primary/40 bg-primary/5"
                        : "border-border hover:bg-muted/40",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(permission.code)}
                      onChange={() => toggle(permission.code)}
                      className="mt-0.5 h-4 w-4 rounded border-border"
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 font-semibold">
                        <span className="truncate">{permission.label}</span>
                        {permission.sensitive && <Badge tone="warning">sensitive</Badge>}
                      </span>
                      <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                        {permission.code}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ThresholdRow({
  threshold,
  onSave,
}: {
  threshold: ApprovalThreshold;
  onSave: (threshold: ApprovalThreshold, patch: Partial<ApprovalThreshold>) => void;
}) {
  const [amount, setAmount] = useState(
    threshold.amount_cents === null ? "" : String(threshold.amount_cents / 100),
  );
  const [permission, setPermission] = useState(threshold.requires_permission);
  const [makerChecker, setMakerChecker] = useState(threshold.maker_checker);
  const [active, setActive] = useState(threshold.active);

  return (
    <tr className="border-t border-border/70">
      <td className="px-3 py-2">
        <p className="font-medium">{threshold.label}</p>
        <p className="font-mono text-[10px] text-muted-foreground">{threshold.action_code}</p>
      </td>
      <td className="px-3 py-2">
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="Any amount"
          className={cn(inputClass, "w-32")}
        />
      </td>
      <td className="px-3 py-2">
        <input
          value={permission}
          onChange={(event) => setPermission(event.target.value)}
          className={cn(inputClass, "w-56 font-mono text-xs")}
        />
      </td>
      <td className="px-3 py-2">
        <Toggle checked={makerChecker} onChange={setMakerChecker} label="Enforce" />
      </td>
      <td className="px-3 py-2">
        <Toggle checked={active} onChange={setActive} label="Active" />
      </td>
      <td className="px-3 py-2 text-right">
        <Can permission="approvals.manage" mode="disable">
          <button
            type="button"
            onClick={() =>
              onSave(threshold, {
                amount_cents: amount.trim() === "" ? null : Math.round(Number(amount) * 100),
                requires_permission: permission,
                maker_checker: makerChecker,
                active,
              })
            }
            className="btn btn-secondary btn-sm"
          >
            <Save className="h-3.5 w-3.5" /> Save
          </button>
        </Can>
      </td>
    </tr>
  );
}
