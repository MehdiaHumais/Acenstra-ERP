"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BadgeCheck,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Inbox,
  MessageSquare,
  MessageCircleReply,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Loader2,
  Mail,
  Pause,
  Pencil,
  Play,
  Search,
  ShieldCheck,
  Trash2,
  UserCog,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { SectionHeader, Surface } from "@/components/ui";
import { Can } from "@/components/access-gate";
import { cn } from "@/lib/format";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface AdminUser {
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
  must_change_password: boolean;
  locked: boolean;
  permissions: string[];
  scopes: Record<string, string[]>;
  created_at: string;
  last_login_at: string | null;
}

interface AdminRole {
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

type InvitationStatus = "pending" | "expired" | "revoked" | "accepted";

interface AccessRequestRow {
  id: string;
  name: string;
  email: string;
  company: string;
  phone: string | null;
  requested_role: string;
  reason: string;
  additional_info: string | null;
  status: "pending" | "additional_info" | "approved" | "rejected";
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  invitation_id: string | null;
  created_user_id: string | null;
  created_at: string;
}

interface ContactMessageRow {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  user_role: string;
  subject: string;
  message: string;
  direction: "to_admin" | "to_user";
  status: "new" | "read" | "replied";
  admin_reply: string | null;
  replied_by: string | null;
  replied_by_name: string | null;
  replied_at: string | null;
  created_at: string;
}

interface InvitationRow {
  id: string;
  email: string;
  name: string;
  roles: string[];
  warehouse: string | null;
  store_id: string | null;
  status: InvitationStatus;
  created_at: string;
  expires_at: string;
  invited_by_name: string | null;
}

type Tab = "users" | "invitations" | "access" | "requests" | "messages";

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const code = payload?.error?.code as string | undefined;
    if (res.status === 401 && typeof window !== "undefined" &&
        (code === "ACCOUNT_DELETED" || code === "ACCOUNT_DISABLED" || code === "UNAUTHORIZED")) {
      // Session is gone (deleted/disabled account, or expiry). Clear the
      // httpOnly cookies first — awaiting guarantees the Set-Cookie response
      // is applied, so the /login navigation is not bounced back by
      // middleware (which only checks for a cookie being present).
      const reason =
        code === "ACCOUNT_DELETED" ? "account_deleted" :
        code === "ACCOUNT_DISABLED" ? "account_disabled" : "session_expired";
      try {
        await fetch("/api/v1/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "logout" }),
        });
      } catch {
        // Ignore — the middleware ?reason bypass still lets the user in.
      }
      window.location.href = `/login?reason=${reason}`;
    }
    const message =
      (payload && (payload.error?.message || payload.message)) ||
      `Request failed (${res.status})`;
    throw new Error(message);
  }
  return payload as T;
}

const inputClass =
  "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60";
const selectClass = inputClass;

// ---------------------------------------------------------------------------
// Avatar helper — deterministic pastel initials
// ---------------------------------------------------------------------------
const AVATAR_PALETTE = [
  "bg-teal-100 text-teal-700",
  "bg-rose-100 text-rose-700",
  "bg-amber-100 text-amber-800",
  "bg-indigo-100 text-indigo-700",
  "bg-emerald-100 text-emerald-700",
  "bg-sky-100 text-sky-700",
  "bg-fuchsia-100 text-fuchsia-700",
  "bg-lime-100 text-lime-700",
];
function initials(s: string): string {
  const words = s.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}
function avatarTone(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

// ---------------------------------------------------------------------------
// KPI tile — compact stat
// ---------------------------------------------------------------------------
function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "neutral" | "ok" | "warning" | "danger" | "info";
}) {
  const valueCls =
    tone === "ok"
      ? "text-emerald-700"
      : tone === "warning"
        ? "text-amber-700"
        : tone === "danger"
          ? "text-red-700"
          : tone === "info"
            ? "text-sky-700"
            : "text-foreground";
  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card p-3 shadow-sm transition-shadow hover:shadow-md">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className={cn("mt-1 text-2xl font-extrabold tracking-tight", valueCls)}>{value}</p>
      {hint ? <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One-time secret reveal box
// ---------------------------------------------------------------------------
function loginUrl(): string {
  return `${window.location.origin}/login`;
}

function RevealBox({
  tone,
  title,
  secret,
  meta,
  onCopy,
  copied,
  onDismiss,
  extra,
}: {
  tone: "amber" | "emerald";
  title: string;
  secret: string;
  meta?: string;
  onCopy: () => void;
  copied: boolean;
  onDismiss: () => void;
  extra?: React.ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  const styles =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-emerald-200 bg-emerald-50 text-emerald-900";
  const sub = tone === "amber" ? "text-amber-800" : "text-emerald-800";
  return (
    <div className={cn("mt-3 rounded-xl border p-3", styles)}>
      <p className="flex items-center justify-between gap-2 text-xs font-bold">
        <span>{title}</span>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="rounded-md p-1 hover:bg-black/5">
          <X className="h-4 w-4" />
        </button>
      </p>
      <div className="mt-2 flex items-stretch gap-2">
        <code className="flex flex-1 items-center overflow-x-auto rounded-lg border border-black/10 bg-white/70 px-2.5 py-1.5 font-mono text-[11px] tracking-wide">
          {revealed ? secret : "••••••••"}
        </code>
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          className="btn btn-secondary btn-sm shrink-0 gap-1"
        >
          {revealed ? <><EyeOff className="h-3 w-3" /> Hide</> : <><Eye className="h-3 w-3" /> Show</>}
        </button>
        <button type="button" onClick={onCopy} className="btn btn-secondary btn-sm shrink-0 gap-1">
          <Copy className="h-3.5 w-3.5" />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {meta ? <p className={cn("mt-1.5 text-[10px]", sub)}>{meta}</p> : null}
      {extra ? <div className="mt-2">{extra}</div> : null}
    </div>
  );
}

/** Copyable "log in here" link — what an admin can give a manually created user. */
function LoginLinkRow({ url, copied, onCopy }: { url: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="flex items-stretch gap-2 rounded-lg border border-black/10 bg-white/70 p-2">
      <code className="flex flex-1 items-center overflow-x-auto font-mono text-[10px] text-muted-foreground">
        {url}
      </code>
      <button type="button" onClick={onCopy} className="btn btn-secondary btn-sm shrink-0 gap-1">
        <Copy className="h-3 w-3" /> {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}

function statusBadge(active: boolean, locked: boolean): { label: string; cls: string } {
  if (locked)
    return { label: "Locked", cls: "border-red-200 bg-red-50 text-red-700" };
  if (active)
    return { label: "Active", cls: "border-emerald-200 bg-emerald-50 text-emerald-800" };
  return { label: "Deactivated", cls: "border-slate-300 bg-slate-100 text-slate-600" };
}

function inviteBadge(status: InvitationStatus): { label: string; cls: string } {
  switch (status) {
    case "pending":
      return { label: "Pending", cls: "border-amber-300 bg-amber-50 text-amber-800" };
    case "expired":
      return { label: "Expired", cls: "border-slate-300 bg-slate-100 text-slate-600" };
    case "revoked":
      return { label: "Revoked", cls: "border-red-300 bg-red-50 text-red-700" };
    case "accepted":
      return { label: "Accepted", cls: "border-emerald-300 bg-emerald-50 text-emerald-800" };
  }
}

export function AdminDashboard() {
  const [tab, setTab] = useState<Tab>("users");
  const searchParams = useSearchParams();

  useEffect(() => {
    const t = searchParams?.get("tab");
    if (t && ["users", "invitations", "access", "requests", "messages"].includes(t)) {
      setTab(t as Tab);
    }
  }, [searchParams]);
  const [accessSearch, setAccessSearch] = useState("");
  const [expandedRole, setExpandedRole] = useState<string | null>(null);
  const [viewerRole, setViewerRole] = useState<string | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [viewerError, setViewerError] = useState<boolean>(false);

  // Delete-user confirmation
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Edit user dialog
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editUserForm, setEditUserForm] = useState({ name: "", email: "", role: "picker", warehouse: "", store_id: "", active: true });
  const [savingUser, setSavingUser] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<{ password: string; email: string } | null>(null);

  // Edit invitation dialog
  const [editingInvite, setEditingInvite] = useState<InvitationRow | null>(null);
  const [editInviteForm, setEditInviteForm] = useState({ name: "", roles: ["picker"], warehouse: "", store_id: "" });
  const [savingInvite, setSavingInvite] = useState(false);

  // Users list
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "active" | "deactivated" | "locked">("");

  // Invitations list
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [invitesTotal, setInvitesTotal] = useState(0);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [requests, setRequests] = useState<AccessRequestRow[]>([]);
  const [requestsTotal, setRequestsTotal] = useState(0);
  const [requestCounts, setRequestCounts] = useState<{ pending: number; additional_info: number; approved: number; rejected: number; total: number }>({ pending: 0, additional_info: 0, approved: 0, rejected: 0, total: 0 });
  const [requestsStatus, setRequestsStatus] = useState<"" | "pending" | "additional_info" | "approved" | "rejected">("");
  const [requestSearch, setRequestSearch] = useState("");
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<AccessRequestRow | null>(null);
  const [reviewMode, setReviewMode] = useState<"approve" | "reject" | "info">("approve");
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewRole, setReviewRole] = useState("picker");
  const [reviewWarehouse, setReviewWarehouse] = useState("Milan Cold Hub");
  const [reviewing, setReviewing] = useState(false);
  const [approvedAccount, setApprovedAccount] = useState<{ password: string; email: string; name: string; delivery: "smtp_sent" | "send_failed" | "smtp_not_configured" } | null>(null);

  // Contact messages
  const [messages, setMessages] = useState<ContactMessageRow[]>([]);
  const [messagesTotal, setMessagesTotal] = useState(0);
  const [messageCounts, setMessageCounts] = useState<{ new: number; read: number; replied: number; total: number }>({ new: 0, read: 0, replied: 0, total: 0 });
  const [messageSearch, setMessageSearch] = useState("");
  const [messageStatus, setMessageStatus] = useState<"" | "new" | "read" | "replied">("");
  const [messageDirection, setMessageDirection] = useState<"" | "to_admin" | "to_user">("");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ContactMessageRow | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [composeTarget, setComposeTarget] = useState<AdminUser | null>(null);
  const [composeInlinePicker, setComposeInlinePicker] = useState(false);
  const [composeRecipientId, setComposeRecipientId] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeMessage, setComposeMessage] = useState("");
  const [composing, setComposing] = useState(false);

  const closeCompose = useCallback(() => {
    setComposeTarget(null);
    setComposeInlinePicker(false);
    setComposeRecipientId("");
    setComposeSubject("");
    setComposeMessage("");
  }, []);

  const composeOpen = composeTarget !== null || composeInlinePicker;
  const [inviteSearch, setInviteSearch] = useState("");
  const [inviteStatus, setInviteStatus] = useState<"" | InvitationStatus>("");

  // Roles
  const [roles, setRoles] = useState<AdminRole[]>([]);

  // Page feedback
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Modals
  const [inviteOpen, setInviteOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  // Create forms (shared)
  const [form, setForm] = useState({
    name: "",
    email: "",
    role: "picker",
    warehouse: "Milan Cold Hub",
    store_id: "",
  });
  const [creating, setCreating] = useState(false);

  // One-time results
  const [inviteResult, setInviteResult] = useState<{ url: string; email: string; expires_at: string; delivery: string } | null>(null);
  const [manualResult, setManualResult] = useState<{ password: string; email: string; name: string } | null>(null);
  const [copiedOnce, setCopiedOnce] = useState<"invite" | "manual" | null>(null);

  const showError = useCallback((m: string) => {
    setErrorBanner(m);
    setNotice(null);
  }, []);
  const showNotice = useCallback((m: string) => {
    setNotice(m);
    setErrorBanner(null);
    window.setTimeout(() => setNotice(null), 3500);
  }, []);

  // -------------------------------------------------------------------------
  // Loaders
  // -------------------------------------------------------------------------
  const loadUsers = useCallback(async (silent = false) => {
    if (!silent) setLoadingUsers(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (roleFilter) params.set("role", roleFilter);
      if (statusFilter) params.set("status", statusFilter);
      params.set("limit", "50");
      const data = await api<{ users: AdminUser[]; total: number }>(`/api/v1/admin/users?${params.toString()}`);
      setUsers(data.users ?? []);
      setUserTotal(data.total ?? (data.users?.length ?? 0));
    } catch (err) {
      if (!silent) showError((err as Error).message);
    } finally {
      if (!silent) setLoadingUsers(false);
    }
  }, [search, roleFilter, statusFilter, showError]);

  const loadInvitations = useCallback(async (silent = false) => {
    if (!silent) setLoadingInvites(true);
    try {
      const params = new URLSearchParams();
      if (inviteSearch) params.set("search", inviteSearch);
      if (inviteStatus) params.set("status", inviteStatus);
      params.set("limit", "50");
      const data = await api<{ invitations: InvitationRow[]; total: number }>(
        `/api/v1/admin/invitations?${params.toString()}`,
      );
      setInvitations(data.invitations ?? []);
      setInvitesTotal(data.total ?? (data.invitations?.length ?? 0));
    } catch (err) {
      if (!silent) showError((err as Error).message);
    } finally {
      if (!silent) setLoadingInvites(false);
    }
  }, [inviteSearch, inviteStatus, showError]);

  const loadRoles = useCallback(async () => {
    try {
      const data = await api<{ roles: AdminRole[] }>("/api/v1/admin/roles");
      setRoles((data.roles ?? []).filter((r) => r.active));
    } catch {
      setRoles([]);
    }
  }, []);

  const loadRequests = useCallback(async (silent = false) => {
    if (!silent) setLoadingRequests(true);
    try {
      const params = new URLSearchParams();
      if (requestSearch) params.set("search", requestSearch);
      if (requestsStatus) params.set("status", requestsStatus);
      params.set("limit", "50");
      const data = await api<{ requests: AccessRequestRow[]; total: number; counts: typeof requestCounts }>(
        `/api/v1/admin/access-requests?${params.toString()}`,
      );
      setRequests(data.requests ?? []);
      setRequestsTotal(data.total ?? (data.requests?.length ?? 0));
      if (data.counts) setRequestCounts(data.counts);
    } catch (err) {
      if (!silent) showError((err as Error).message);
    } finally {
      if (!silent) setLoadingRequests(false);
    }
  }, [requestSearch, requestsStatus, showError]);

  const loadMessages = useCallback(async (silent = false) => {
    if (!silent) setLoadingMessages(true);
    try {
      const params = new URLSearchParams();
      if (messageSearch) params.set("search", messageSearch);
      if (messageStatus) params.set("status", messageStatus);
      if (messageDirection) params.set("direction", messageDirection);
      params.set("limit", "50");
      const data = await api<{ messages: ContactMessageRow[]; total: number; counts: typeof messageCounts }>(
        `/api/v1/admin/contact-messages?${params.toString()}`,
      );
      setMessages(data.messages ?? []);
      setMessagesTotal(data.total ?? (data.messages?.length ?? 0));
      if (data.counts) setMessageCounts(data.counts);
    } catch (err) {
      if (!silent) showError((err as Error).message);
    } finally {
      if (!silent) setLoadingMessages(false);
    }
  }, [messageSearch, messageStatus, messageDirection, showError]);

  const deleteMessage = useCallback(async (message: ContactMessageRow) => {
    setDeletingMessageId(message.id);
    try {
      await api(`/api/v1/admin/contact-messages/${message.id}`, {
        method: "POST",
        body: JSON.stringify({ action: "delete" }),
      });
      showNotice("Message deleted.");
      loadMessages();
    } catch (err) {
      showError((err as Error).message);
    } finally {
      setDeletingMessageId(null);
    }
  }, [loadMessages, showError]);

  const openReply = useCallback((message: ContactMessageRow) => {
    setReplyTarget(message);
    setReplyText(message.admin_reply ?? "");
    if (message.status === "new") {
      api(`/api/v1/admin/contact-messages/${message.id}`, {
        method: "POST",
        body: JSON.stringify({ action: "read" }),
      }).catch(() => null);
    }
  }, []);

  const sendReply = useCallback(async () => {
    if (!replyTarget) return;
    if (replyText.trim().length < 2) {
      showError("Write a reply first.");
      return;
    }
    setReplying(true);
    try {
      const updated = await api<ContactMessageRow>(
        `/api/v1/admin/contact-messages/${replyTarget.id}`,
        {
          method: "POST",
          body: JSON.stringify({ action: "reply", reply: replyText.trim() }),
        },
      );
      setReplyTarget(null);
      setReplyText("");
      showNotice(`Reply sent to ${updated.user_email}.`);
      loadMessages();
    } catch (err) {
      showError((err as Error).message);
    } finally {
      setReplying(false);
    }
  }, [replyTarget, replyText, loadMessages, showError]);

  const markMessageRead = useCallback(async (message: ContactMessageRow) => {
    try {
      await api(`/api/v1/admin/contact-messages/${message.id}`, {
        method: "POST",
        body: JSON.stringify({ action: "read" }),
      });
      loadMessages();
    } catch (err) {
      showError((err as Error).message);
    }
  }, [loadMessages, showError]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await api<{ user: { role: string; id: string } | null }>("/api/v1/auth/me");
        if (!cancelled) {
          setViewerRole(me?.user?.role ?? "");
          setViewerId(me?.user?.id ?? null);
        }
      } catch {
        if (!cancelled) setViewerError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!viewerRole) return;
    loadRoles();
  }, [viewerRole, loadRoles]);
  useEffect(() => {
    if (tab === "users") loadUsers();
    if (tab === "access") loadRoles();
    if (tab === "requests") loadRequests();
    if (tab === "messages") loadMessages();
  }, [tab, loadUsers, loadRequests, loadMessages]);
  useEffect(() => {
    if (tab === "invitations") loadInvitations();
  }, [tab, loadInvitations]);

  // Keep the open admin tab live (silent refresh — no loading flicker), so a
  // message or access request posted by a user appears without a reload.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      if (tab === "users") void loadUsers(true);
      else if (tab === "invitations") void loadInvitations(true);
      else if (tab === "requests") void loadRequests(true);
      else if (tab === "messages") void loadMessages(true);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [tab, loadUsers, loadInvitations, loadRequests, loadMessages]);

  const refreshAll = useCallback(() => {
    loadUsers();
    loadInvitations();
  }, [loadUsers, loadInvitations]);

  // Derived stats
  const stats = useMemo(() => {
    const total = users.length || userTotal;
    const active = users.filter((u) => u.active && !u.locked).length;
    const deactivated = users.filter((u) => !u.active).length;
    const locked = users.filter((u) => u.locked).length;
    const pendingInvites = invitations.filter((i) => i.status === "pending").length;
    return { total, active, deactivated, locked, pendingInvites };
  }, [users, userTotal, invitations]);

  // ------------------------------------------------ Access view helpers
  // Roles assignable through the access-request approval path:
  // never super_admin (public requests must not grant it), and protected
  // roles only to a super_admin actor — mirrors backend enforcement.
  const assignableRoles = useMemo(() => {
    const isSuper = viewerRole === "super_admin";
    return roles.filter((r) => r.code !== "super_admin" && (isSuper || !r.protected));
  }, [roles, viewerRole]);

  const openReview = useCallback((req: AccessRequestRow) => {
    setReviewTarget(req);
    setReviewMode("approve");
    setReviewNotes(req.review_notes ?? "");
    // Pre-select the role the applicant actually asked for when it is still
    // grantable — instead of blindly defaulting to "ceo".
    const preferred = assignableRoles.find((r) => r.code === req.requested_role);
    setReviewRole(preferred ? preferred.code : (assignableRoles[0]?.code ?? "picker"));
    setReviewWarehouse("Milan Cold Hub");
  }, [assignableRoles]);

  const deleteRequest = useCallback(async (req: AccessRequestRow) => {
    const okConfirm = window.confirm(
      req.status === "approved"
        ? `Delete the access request for ${req.email}? The created account is NOT deleted — only the request record is removed.`
        : `Delete this access request for ${req.email}?`
    );
    if (!okConfirm) return;
    try {
      await api(`/api/v1/admin/access-requests/${req.id}`, { method: "DELETE" });
      showNotice(`Request deleted: ${req.email}`);
      loadRequests(true);
    } catch (err) {
      showError((err as Error).message);
    }
  }, [loadRequests, showError]);

  const submitReview = useCallback(async () => {
    if (!reviewTarget) return;
    setReviewing(true);
    try {
      if (reviewMode === "approve" && !reviewRole) {
        showError("Choose the actual ERP role to grant.");
        setReviewing(false);
        return;
      }
      const payload: Record<string, unknown> = { action: reviewMode };
      if (reviewMode === "approve") {
        payload.roles = [reviewRole];
        payload.warehouse = reviewWarehouse.trim() || "Milan Cold Hub";
        payload.notes = reviewNotes.trim() || undefined;
      } else {
        payload.notes = reviewNotes.trim() || undefined;
      }
      const res = await api<{
        request: AccessRequestRow;
        temporary_password?: string;
        created_user_id?: string;
        email_delivery?: "smtp_sent" | "send_failed" | "smtp_not_configured";
      }>(`/api/v1/admin/access-requests/${reviewTarget.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setReviewTarget(null);
      loadRequests();
      if (reviewMode === "approve") {
        setApprovedAccount({
          password: res.temporary_password ?? "",
          email: reviewTarget.email,
          name: reviewTarget.name,
          delivery: res.email_delivery ?? "smtp_not_configured",
        });
      } else if (reviewMode === "reject") {
        showNotice(`${reviewTarget.email} rejected — applicant notified by email.`);
      } else {
        showNotice(`Information requested from ${reviewTarget.email}.`);
      }
    } catch (err) {
      showError((err as Error).message);
    } finally {
      setReviewing(false);
    }
  }, [reviewTarget, reviewMode, reviewRole, reviewWarehouse, reviewNotes, assignableRoles, loadRequests, showError]);

  const resumeRequest = useCallback(async (req: AccessRequestRow) => {
    try {
      await api(`/api/v1/admin/access-requests/${req.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "resume" }),
      });
      showNotice("Request moved back to pending.");
      loadRequests();
    } catch (err) {
      showError((err as Error).message);
    }
  }, [loadRequests, showError]);

  const groupPermissions = useCallback((perms: string[]) => {
    const groups = new Map<string, string[]>();
    for (const p of perms) {
      const key = p.includes("*") ? "*" : p.split(/[:._-]/)[0] || p;
      const list = groups.get(key);
      if (list) list.push(p);
      else groups.set(key, [p]);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, []);

  const accessFiltered = useMemo(() => {
    const term = accessSearch.trim().toLowerCase();
    const sorted = [...roles].sort((a, b) => (b.permissions?.length ?? 0) - (a.permissions?.length ?? 0) || a.code.localeCompare(b.code));
    if (!term) return sorted;
    return sorted.filter((r) =>
      [r.name, r.code, r.description ?? "", r.base_role ?? "", ...(r.permissions ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [roles, accessSearch]);

  const roleOptions = useMemo(() => {
    const custom = roles.filter((r) => !r.is_system);
    const system = roles.filter((r) => r.is_system);
    return { custom, system };
  }, [roles]);

  const selectedRole = useMemo(
    () => roles.find((r) => r.code === expandedRole) ?? null,
    [roles, expandedRole]
  );

  useEffect(() => {
    if (!expandedRole) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedRole(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedRole]);

  const resetForm = () =>
    setForm({ name: "", email: "", role: "picker", warehouse: "Milan Cold Hub", store_id: "" });

  const createInvitation = async () => {
    if (!form.name.trim() || !form.email.trim()) {
      showError("Full name and a valid email are required.");
      return;
    }
    setCreating(true);
    try {
      const created = await api<{ invite_url: string | null; invitation: InvitationRow; email_delivery?: string }>(
        "/api/v1/admin/invitations",
        {
          method: "POST",
          body: JSON.stringify({
            name: form.name.trim(),
            email: form.email.trim(),
            roles: [form.role],
            warehouse: form.warehouse || "Milan Cold Hub",
            store_id: form.store_id || null,
          }),
        },
      );
      setInviteResult({
        url: created.invite_url ?? `${window.location.origin}/invite/<token>`,
        email: form.email.trim(),
        expires_at: created.invitation?.expires_at ?? "",
        delivery: created.email_delivery ?? "smtp_not_configured",
      });
      resetForm();
      setInviteOpen(false);
      if (created.email_delivery === "smtp_sent") {
        showNotice(`Invitation email sent to ${form.email.trim()}.`);
      } else if (created.email_delivery === "send_failed") {
        showError("Email could not be delivered — share the invitation link directly.");
      } else {
        showNotice("Invitation created — email is not configured; share the link.");
      }
      loadInvitations();
      if (tab !== "invitations") setTab("invitations");
    } catch (err) {
      showError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const createManualAccount = async () => {
    if (!form.name.trim() || !form.email.trim()) {
      showError("Full name and a valid email are required.");
      return;
    }
    setCreating(true);
    try {
      const created = await api<{ id: string; email: string; temporary_password: string }>(
        "/api/v1/admin/users/manual",
        {
          method: "POST",
          body: JSON.stringify({
            name: form.name.trim(),
            email: form.email.trim(),
            roles: [form.role],
            warehouse: form.warehouse || "Milan Cold Hub",
            store_id: form.store_id || null,
          }),
        },
      );
      setManualResult({ password: created.temporary_password, email: created.email, name: form.name.trim() });
      resetForm();
      showNotice("Account created — temporary password shown below.");
      loadUsers();
    } catch (err) {
      showError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (user: AdminUser) => {
    try {
      await api(`/api/v1/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !user.active }),
      });
      showNotice(`${user.email} ${user.active ? "deactivated" : "reactivated"}.`);
      loadUsers();
    } catch (err) {
      showError((err as Error).message);
    }
  };

  const openEditUser = (user: AdminUser) => {
    setEditingUser(user);
    setConfirmingReset(false);
    setResetResult(null);
    setEditUserForm({
      name: user.name,
      email: user.email,
      role: user.role,
      warehouse: user.warehouse ?? "Milan Cold Hub",
      store_id: user.store_id ?? "",
      active: user.active,
    });
  };

  const openComposeFor = useCallback((user: AdminUser) => {
    setComposeTarget(user);
    setComposeInlinePicker(false);
    setComposeRecipientId("");
    setComposeSubject("");
    setComposeMessage("");
  }, []);

  const openComposePicker = useCallback(() => {
    setComposeTarget(null);
    setComposeInlinePicker(true);
    setComposeRecipientId("");
    setComposeSubject("");
    setComposeMessage("");
  }, []);

  const sendComposedMessage = useCallback(async () => {
    const recipient: AdminUser | undefined =
      composeTarget ?? users.find((u) => u.id === composeRecipientId);
    if (!recipient) {
      showError("Choose who to send the message to.");
      return;
    }
    const subject = composeSubject.trim();
    const message = composeMessage.trim();
    if (subject.length < 2) {
      showError("Enter a subject.");
      return;
    }
    if (message.length < 5) {
      showError("Write at least a few words.");
      return;
    }
    setComposing(true);
    try {
      await api(`/api/v1/admin/contact-messages`, {
        method: "POST",
        body: JSON.stringify({ action: "compose", user_id: recipient.id, subject, message }),
      });
      showNotice(`Message sent to ${recipient.email} — they will see it in Contact Administration.`);
      closeCompose();
      loadMessages();
    } catch (err) {
      showError((err as Error).message);
    } finally {
      setComposing(false);
    }
  }, [composeTarget, composeRecipientId, users, composeSubject, composeMessage, showError, loadMessages, closeCompose]);

  const resetUserPassword = async () => {
    if (!editingUser) return;
    if (!confirmingReset) {
      setConfirmingReset(true);
      return;
    }
    setResetting(true);
    try {
      const res = await api<{ id: string; email: string; temporary_password: string }>(
        `/api/v1/admin/users/${editingUser.id}/reset-password`,
        { method: "POST", body: JSON.stringify({}) }
      );
      setResetResult({ password: res.temporary_password, email: res.email });
      setConfirmingReset(false);
      showNotice(`Temporary password issued for ${res.email} — shown once.`);
      loadUsers();
    } catch (err) {
      showError((err as Error).message);
    } finally {
      setResetting(false);
    }
  };

  const saveEditUser = async () => {
    if (!editingUser) return;
    const name = editUserForm.name.trim();
    if (!name) {
      showError("Full name is required.");
      return;
    }
    setSavingUser(true);
    try {
      await api(`/api/v1/admin/users/${editingUser.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          roles: [editUserForm.role],
          primary_role: editUserForm.role,
          warehouse: editUserForm.warehouse || "Milan Cold Hub",
          store_id: editUserForm.store_id || null,
          active: editUserForm.active,
        }),
      });
      showNotice(`${editingUser.email} updated.`);
      setEditingUser(null);
      loadUsers();
    } catch (err) {
      showError((err as Error).message);
    } finally {
      setSavingUser(false);
    }
  };

  const confirmDeleteUser = async () => {
    if (!deleteTarget) return;
    if (deleteConfirmText.trim().toLowerCase() !== deleteTarget.email.toLowerCase()) {
      showError(`Type ${deleteTarget.email} to confirm deletion.`);
      return;
    }
    setDeleting(true);
    try {
      await api(`/api/v1/admin/users/${deleteTarget.id}`, { method: "DELETE" });
      showNotice(`${deleteTarget.email} permanently deleted — the email address can be used again.`);
      setDeleteTarget(null);
      setDeleteConfirmText("");
      loadUsers();
    } catch (err) {
      showError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const openEditInvite = (inv: InvitationRow) => {
    setEditingInvite(inv);
    setEditInviteForm({
      name: inv.name,
      roles: inv.roles && inv.roles.length ? [...inv.roles] : ["picker"],
      warehouse: inv.warehouse ?? "Milan Cold Hub",
      store_id: inv.store_id ?? "",
    });
  };

  const saveEditInvite = async () => {
    if (!editingInvite) return;
    const name = editInviteForm.name.trim();
    if (!name) {
      showError("Name is required.");
      return;
    }
    setSavingInvite(true);
    try {
      await api(`/api/v1/admin/invitations/${editingInvite.id}`, {
        method: "POST",
        body: JSON.stringify({
          action: "update",
          name,
          roles: editInviteForm.roles,
          warehouse: editInviteForm.warehouse || "Milan Cold Hub",
          store_id: editInviteForm.store_id || null,
        }),
      });
      showNotice(`Invitation for ${editingInvite.email} updated.`);
      setEditingInvite(null);
      loadInvitations();
    } catch (err) {
      showError((err as Error).message);
    } finally {
      setSavingInvite(false);
    }
  };

  const deleteInvite = async (id: string, email: string, status?: InvitationStatus) => {
    const acceptedNote =
      status === "accepted"
        ? " This is an accepted invitation — the account created from it will NOT be deleted."
        : "";
    if (!window.confirm(`Delete invitation for ${email}? This cannot be undone.${acceptedNote}`)) return;
    try {
      await api(`/api/v1/admin/invitations/${id}`, {
        method: "POST",
        body: JSON.stringify({ action: "delete" }),
      });
      setInvitations((cur) => cur.filter((i) => i.id !== id));
      showNotice(`Invitation for ${email} deleted.`);
    } catch (err) {
      showError((err as Error).message);
    }
  };

  const resendInvitation = async (id: string) => {
    try {
      const created = await api<{ invite_url: string | null; invitation: InvitationRow; email_delivery?: string }>(
        `/api/v1/admin/invitations/${id}`,
        { method: "POST", body: JSON.stringify({ action: "resend" }) },
      );
      setInviteResult({
        url: created.invite_url ?? `${window.location.origin}/invite/<token>`,
        email: created.invitation?.email ?? "",
        expires_at: created.invitation?.expires_at ?? "",
        delivery: created.email_delivery ?? "smtp_not_configured",
      });
      showNotice(
        created.email_delivery === "smtp_sent"
          ? `Invitation email re-sent to ${created.invitation?.email ?? "the recipient"}.`
          : "Email could not be delivered — share the link directly.",
      );
      loadInvitations();
    } catch (err) {
      showError((err as Error).message);
    }
  };

  const revokeInvitation = async (id: string) => {
    try {
      await api(`/api/v1/admin/invitations/${id}`, {
        method: "POST",
        body: JSON.stringify({ action: "revoke" }),
      });
      setInvitations((cur) => cur.map((inv) => (inv.id === id ? { ...inv, status: "revoked" } : inv)));
      showNotice("Invitation revoked.");
    } catch (err) {
      showError((err as Error).message);
    }
  };

  const copyText = async (text: string, kind: "invite" | "manual") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedOnce(kind);
      window.setTimeout(() => setCopiedOnce(null), 2000);
    } catch {
      showError("Could not copy to the clipboard.");
    }
  };

  const field = (label: string, input: React.ReactNode, hint?: string) => (
    <label className="block">
      <span className="field-label">{label}</span>
      <div className="mt-1">{input}</div>
      {hint ? <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p> : null}
    </label>
  );

  const rolePicker = (
    <select
      value={form.role}
      onChange={(e) => setForm({ ...form, role: e.target.value })}
      className={selectClass}
    >
      {roleOptions.custom.map((r) => (
        <option key={r.code} value={r.code}>
          {r.name}
        </option>
      ))}
      {roleOptions.system.length > 0 && (
        <optgroup label="System roles">
          {roleOptions.system.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );

  const sharedFields = (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {field("Full name", <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Chiara Ricci" className={inputClass} autoFocus />)}
      {field("Work email", <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@company.com" className={inputClass} />)}
      {field("Role", rolePicker)}
      {field("Warehouse", <input value={form.warehouse} onChange={(e) => setForm({ ...form, warehouse: e.target.value })} className={inputClass} />)}
      {field("Store / customer ID (optional)", <input value={form.store_id} onChange={(e) => setForm({ ...form, store_id: e.target.value })} placeholder="e.g. STR-MIL-01" className={inputClass} />)}
    </div>
  );

  // Access guard — null means the /auth/me lookup has not resolved yet.
  if (viewerError) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-red-200 bg-card p-8 text-center shadow-card">
          <h1 className="text-lg font-bold text-foreground">Couldn’t verify your access</h1>
        </div>
      </div>
    );
  }
  if (viewerRole === null) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking your permissions…
        </div>
      </div>
    );
  }
  if (viewerRole !== "super_admin" && viewerRole !== "company_admin") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-card">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-secondary text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-lg font-bold text-foreground">Access restricted</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Administration is limited to Super Admin and Company Admin accounts. Your role: <span className="font-semibold text-foreground">{viewerRole || "unknown"}</span>
          </p>
        </div>
      </div>
    );
  }

  const roleAccessModal = selectedRole ? (() => {
    const perms = selectedRole.permissions ?? [];
    const isSuper = perms.includes("*");
    const groups = groupPermissions(perms);
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" role="presentation" onClick={() => setExpandedRole(null)}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="role-access-title"
          className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <KeyRound className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <h2 id="role-access-title" className="text-lg font-bold leading-tight text-foreground">{selectedRole.name}</h2>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {selectedRole.code}{selectedRole.base_role ? ` · base: ${selectedRole.base_role}` : ""}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold", selectedRole.is_system ? "border-slate-300 bg-slate-100 text-slate-600" : "border-violet-200 bg-violet-50 text-violet-700")}>
                    {selectedRole.is_system ? "System role" : "Custom role"}
                  </span>
                  {selectedRole.protected && (
                    <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Protected</span>
                  )}
                  <span className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-foreground">
                    {selectedRole.assigned_users ?? 0} account{(selectedRole.assigned_users ?? 0) === 1 ? "" : "s"} assigned
                  </span>
                </div>
              </div>
            </div>
            <button type="button" onClick={() => setExpandedRole(null)} aria-label="Close role access" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
          {/* Body */}
          <div className="overflow-y-auto px-6 py-5">
            {selectedRole.description && (
              <p className="text-sm leading-6 text-foreground">{selectedRole.description}</p>
            )}
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Permissions · {isSuper ? "unrestricted (*)" : perms.length}
              </p>
              {isSuper && (
                <span className="inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-[10px] font-bold uppercase text-primary-foreground">All *</span>
              )}
            </div>
            {isSuper ? (
              <p className="mt-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm font-semibold text-primary">This role holds every permission in the system.</p>
            ) : perms.length === 0 ? (
              <p className="mt-3 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">No permissions — this role cannot perform any guarded action.</p>
            ) : (
              <div className="mt-3 space-y-4">
                {groups.map(([module, codes]) => (
                  <div key={module}>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-primary">
                      {module} <span className="ml-1 font-semibold text-muted-foreground">· {codes.length}</span>
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {codes.map((code) => (
                        <code key={code} className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] leading-4 text-foreground">{code}</code>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Footer */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-6 py-3">
            <p className="text-[11px] text-muted-foreground">Effective access granted to every account with the <span className="font-semibold text-foreground">{selectedRole.code}</span> role.</p>
            <button type="button" onClick={() => setExpandedRole(null)} className="btn btn-secondary btn-sm">Close</button>
          </div>
        </div>
      </div>
    );
  })() : null;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-3 px-4 py-4 sm:px-6">
      {/* ------------------------------------------------ Compact page header */}
      <div className="flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Users className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-foreground">Administration</h1>
            <p className="text-[11px] text-muted-foreground">Users &amp; invitations — every action audited</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Can permission="users.manage" mode="disable">
            <button type="button" onClick={() => { setManualResult(null); setManualOpen(true); }} className="btn btn-secondary btn-sm gap-1.5 whitespace-nowrap">
              <UserCog className="h-3.5 w-3.5" /> Create manually
            </button>
          </Can>
          <Can permission="users.manage" mode="disable">
            <button type="button" onClick={() => setInviteOpen(true)} className="btn btn-primary btn-sm gap-1.5 whitespace-nowrap">
              <UserPlus className="h-3.5 w-3.5" /> Invite
            </button>
          </Can>
        </div>
      </div>

      {/* ------------------------------------------- Inline feedback */}
      {notice && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] text-emerald-900">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <span>{notice}</span>
        </div>
      )}
      {errorBanner && (
        <div className="flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] text-red-800">
          <span className="leading-5">{errorBanner}</span>
          <button type="button" onClick={() => setErrorBanner(null)} aria-label="Dismiss error" className="rounded-md p-1 hover:bg-red-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ------------------------------------------------ KPI strip (compact) */}
      <div className="grid grid-cols-3 gap-2 md:grid-cols-5">
        <StatTile label="Users" value={stats.total} tone="neutral" />
        <StatTile label="Active" value={stats.active} tone="ok" />
        <StatTile label="Deactivated" value={stats.deactivated} tone="warning" />
        <StatTile label="Locked" value={stats.locked} tone="danger" />
        <StatTile label="Invites" value={stats.pendingInvites} tone="info" />
      </div>

      {/* ------------------------------------------------- Tabs (compact) */}
      <div className="flex flex-wrap items-center gap-1.5">
        {([
          { id: "users" as Tab, label: "Users", icon: Users },
          { id: "invitations" as Tab, label: "Invitations", icon: Mail },
          { id: "access" as Tab, label: "Access", icon: KeyRound },
          { id: "requests" as Tab, label: "Requests", icon: Inbox },
          { id: "messages" as Tab, label: "Messages", icon: MessageSquare },
        ]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors",
              tab === t.id ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
            {t.id === "requests" && requestCounts.pending > 0 && (
              <span className={cn(
                "ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold tabular-nums",
                tab === "requests" ? "bg-primary-foreground text-primary" : "bg-amber-400 text-amber-950"
              )}>
                {requestCounts.pending}
              </span>
            )}
            {t.id === "messages" && messageCounts.new > 0 && (
              <span className={cn(
                "ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold tabular-nums",
                tab === "messages" ? "bg-primary-foreground text-primary" : "bg-red-500 text-white"
              )}>
                {messageCounts.new}
              </span>
            )}
          </button>
        ))}
        <div className="ml-auto text-[10px] text-muted-foreground">
          {tab === "users"
            ? `${userTotal} account${userTotal === 1 ? "" : "s"}`
            : tab === "invitations"
              ? `${invitesTotal} invitation${invitesTotal === 1 ? "" : "s"}`
              : tab === "requests"
                ? `${requestsTotal} request${requestsTotal === 1 ? "" : "s"}`
                : tab === "messages"
                  ? `${messagesTotal} message${messagesTotal === 1 ? "" : "s"}`
                  : `${accessFiltered.length} shown`}
        </div>
      </div>

      {/* --------------------------------------------- USERS TAB (compact table) */}
      {tab === "users" && (
        <Surface className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2">
            <div className="relative min-w-[180px] flex-1">
              <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="h-8 w-full rounded-lg border border-input bg-background pl-7 pr-2 text-xs outline-none"
              />
            </div>
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="h-8 rounded-lg border border-input bg-background px-2 text-xs">
              <option value="">All roles</option>
              {roleOptions.custom.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
              {roleOptions.system.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="h-8 rounded-lg border border-input bg-background px-2 text-xs">
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="deactivated">Deactivated</option>
              <option value="locked">Locked</option>
            </select>
            <button type="button" onClick={refreshAll} className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground" title="Refresh">
              <Loader2 className={cn("h-4 w-4", loadingUsers && "animate-spin")} />
            </button>
          </div>
          <div className="table-shell">
            <table className="table-fit">
              <colgroup>
                <col style={{ width: "190px" }} />
                <col />
                <col style={{ width: "140px" }} />
                <col style={{ width: "100px" }} />
                <col style={{ width: "110px" }} />
                <col style={{ width: "90px" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Password</th><th>Joined</th><th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loadingUsers && (
                  <tr><td colSpan={7} className="py-5 text-center text-xs text-muted-foreground">Loading…</td></tr>
                )}
                {!loadingUsers && users.length === 0 && (
                  <tr><td colSpan={7} className="py-5 text-center text-xs text-muted-foreground">No accounts match the filters.</td></tr>
                )}
                {users.map((user) => {
                  const status = statusBadge(user.active, user.locked);
                  const roleLabel = (user.role || user.roles?.[0] || "").replace(/[_-]+/g, " ").toUpperCase();
                  const roleTooltip = user.role_names?.length ? user.role_names.join(", ") : roleLabel;
                  return (
                    <tr key={user.id} className="group">
                      <td>
                        <div className="flex items-center gap-2">
                          <span aria-hidden="true" className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase", avatarTone(user.name))}>
                            {initials(user.name)}
                          </span>
                          <span className="truncate text-[12px] font-semibold text-foreground">{user.name}{user.id === viewerId ? " (you)" : ""}</span>
                        </div>
                      </td>
                      <td className="text-[11px] text-muted-foreground">{user.email}</td>
                      <td>
                        <span title={roleTooltip} className="inline-flex max-w-full items-center truncate rounded-md bg-primary px-1.5 py-0.5 text-[9px] font-bold uppercase text-primary-foreground">
                          {roleLabel || "—"}
                        </span>
                      </td>
                      <td>
                        <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold", status.cls)}>
                          {status.label}
                        </span>
                      </td>
                      <td>
                        {user.must_change_password ? (
                          <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                            Temporary
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                            Set
                          </span>
                        )}
                      </td>
                      <td className="text-[11px] text-muted-foreground">{new Date(user.created_at).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })}</td>
                      <td className="text-right">
                        <Can permission="users.manage" mode="hide">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => openComposeFor(user)}
                              title="Message this user"
                              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[10px] font-semibold text-emerald-800 transition-colors hover:bg-emerald-100"
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">Message</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleActive(user)}
                              title={user.active ? "Deactivate account" : "Reactivate account"}
                              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-amber-50 hover:text-amber-700"
                            >
                              {user.active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditUser(user)}
                              title="Edit user & access"
                              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-sky-50 hover:text-sky-700"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(user)}
                              disabled={user.id === viewerId}
                              title={user.id === viewerId ? "You cannot delete your own account" : "Delete account"}
                              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </Can>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Surface>
      )}

      {/* ----------------------------------------- INVITATIONS TAB (compact table) */}
      {tab === "invitations" && (
        <Surface className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2">
            <div className="relative min-w-[180px] flex-1">
              <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
              <input
                value={inviteSearch}
                onChange={(e) => setInviteSearch(e.target.value)}
                placeholder="Search invitee…"
                className="h-8 w-full rounded-lg border border-input bg-background pl-7 pr-2 text-xs outline-none"
              />
            </div>
            <select value={inviteStatus} onChange={(e) => setInviteStatus(e.target.value as typeof inviteStatus)} className="h-8 rounded-lg border border-input bg-background px-2 text-xs">
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="expired">Expired</option>
              <option value="revoked">Revoked</option>
              <option value="accepted">Accepted</option>
            </select>
            <Can permission="users.manage" mode="disable">
              <button type="button" onClick={() => setInviteOpen(true)} className="btn btn-primary btn-sm gap-1">
                <UserPlus className="h-3.5 w-3.5" /> New
              </button>
            </Can>
            <button type="button" onClick={() => void loadInvitations()} className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground" title="Refresh">
              <Loader2 className={cn("h-4 w-4", loadingInvites && "animate-spin")} />
            </button>
          </div>
          <div className="table-shell">
            <table className="table-fit">
              <colgroup>
                <col style={{ width: "190px" }} />
                <col />
                <col style={{ width: "100px" }} />
                <col style={{ width: "130px" }} />
                <col style={{ width: "130px" }} />
                <col style={{ width: "110px" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Invitee</th><th>Roles</th><th>Status</th><th>Expires</th><th>By</th><th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loadingInvites && (
                  <tr><td colSpan={7} className="py-5 text-center text-xs text-muted-foreground">Loading…</td></tr>
                )}
                {!loadingInvites && invitations.length === 0 && (
                  <tr><td colSpan={6} className="py-5 text-center text-xs text-muted-foreground">No invitations yet.</td></tr>
                )}
                {invitations.map((inv) => {
                  const badge = inviteBadge(inv.status);
                  return (
                    <tr key={inv.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <span aria-hidden="true" className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase", avatarTone(inv.name))}>
                            {initials(inv.name)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-semibold leading-tight text-foreground">{inv.name}</p>
                            <p className="truncate text-[10px] leading-tight text-muted-foreground">{inv.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="text-[11px] text-muted-foreground"><span className="block truncate" title={inv.roles.join(", ")}>{inv.roles.map((r) => r.replace(/[_-]+/g, " ")).join(", ")}</span></td>
                      <td>
                        <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold", badge.cls)}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="text-[11px] text-muted-foreground">{new Date(inv.expires_at).toLocaleDateString("en-US", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                      <td className="text-[11px] text-muted-foreground"><span className="block truncate">{inv.invited_by_name ?? "—"}</span></td>
                      <td className="text-right">
                        <Can permission="users.manage" mode="hide">
                          <div className="flex items-center justify-end gap-1">
                            {inv.status === "pending" && (
                              <>
                                <button type="button" onClick={() => openEditInvite(inv)} title="Edit invitation" className="rounded-md p-1.5 text-muted-foreground hover:bg-sky-50 hover:text-sky-700">
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button type="button" onClick={() => resendInvitation(inv.id)} title="Resend link" className="rounded-md p-1.5 text-muted-foreground hover:bg-amber-50 hover:text-amber-700">
                                  <Mail className="h-3.5 w-3.5" />
                                </button>
                                <button type="button" onClick={() => revokeInvitation(inv.id)} title="Revoke" className="rounded-md p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600">
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                            <button type="button" onClick={() => deleteInvite(inv.id, inv.email, inv.status)} title={inv.status === "accepted" ? "Delete invitation (keeps the account)" : "Delete invitation"} className="rounded-md p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </Can>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Surface>
      )}

      {/* ------------------------------------------ INVITE MODAL */}
      {inviteOpen && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6" role="presentation" onClick={() => setInviteOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="invite-title" className="max-h-[94vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-border bg-card p-4 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="invite-title" className="text-base font-bold text-foreground">Invite by email</h2>
                <p className="text-[10px] text-muted-foreground">Link: single-use, 72 h expiry, hashed at rest.</p>
              </div>
              <button type="button" onClick={() => setInviteOpen(false)} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-2 space-y-2">{sharedFields}</div>
            <button type="button" onClick={createInvitation} disabled={creating} className="btn btn-primary btn-sm mt-3 w-full justify-center py-2">
              {creating ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : <><UserPlus className="h-4 w-4" /> Send invitation</>}
            </button>
            {inviteResult && (
              <RevealBox
                tone={inviteResult.delivery === "smtp_sent" ? "emerald" : "amber"}
                title={inviteResult.delivery === "smtp_sent" ? `Email sent to ${inviteResult.email}` : `Invitation link for ${inviteResult.email}`}
                secret={inviteResult.url}
                meta={inviteResult.delivery === "smtp_sent" ? `Delivered. Expires in 72 hours.` : `Share via a secure channel. Expires in 72 hours.`}
                onCopy={() => copyText(inviteResult.url, "invite")}
                copied={copiedOnce === "invite"}
                onDismiss={() => setInviteResult(null)}
              />
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------ MANUAL MODAL */}
      {manualOpen && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6" role="presentation" onClick={() => setManualOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="manual-title" className="max-h-[94vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-border bg-card p-4 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="manual-title" className="text-base font-bold text-foreground">Create account</h2>
                <p className="text-[10px] text-muted-foreground">A temporary password is generated at creation and shown once below — share it privately.</p>
              </div>
              <button type="button" onClick={() => setManualOpen(false)} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-2 space-y-2">{sharedFields}</div>
            <button type="button" onClick={createManualAccount} disabled={creating} className="btn btn-primary btn-sm mt-3 w-full justify-center py-2">
              {creating ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</> : <><UserCog className="h-4 w-4" /> Create account</>}
            </button>
            {manualResult && (
              <RevealBox
                tone="amber"
                title={`Temporary password for ${manualResult.email}`}
                secret={manualResult.password}
                meta="Share privately. Employee will set a new password on first sign-in."
                onCopy={() => copyText(manualResult.password, "manual")}
                copied={copiedOnce === "manual"}
                onDismiss={() => setManualResult(null)}
                extra={
                  <>
                    <LoginLinkRow
                      url={loginUrl()}
                      copied={copiedOnce === "manual"}
                      onCopy={() => copyText(loginUrl(), "invite")}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          `Email: ${manualResult?.email ?? approvedAccount?.email ?? ""}\nTemporary password: ${manualResult?.password ?? approvedAccount?.password ?? ""}\nLogin: ${loginUrl()}`,
                          "manual"
                        )
                      }
                      className="btn btn-secondary btn-sm gap-1.5 mt-2"
                    >
                      <Copy className="h-3.5 w-3.5" /> Share credentials
                    </button>
                  </>
                }
              />
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------ EDIT USER MODAL */}
      {editingUser && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" role="presentation" onClick={() => setEditingUser(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="edit-user-title" className="w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="edit-user-title" className="text-base font-bold text-foreground">Edit {editingUser.name}</h2>
                <p className="text-[10px] text-muted-foreground">{editingUser.email}</p>
              </div>
              <button type="button" onClick={() => { setEditingUser(null); setConfirmingReset(false); setResetResult(null); }} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-3 space-y-2">
              {field("Full name", <input value={editUserForm.name} onChange={(e) => setEditUserForm({ ...editUserForm, name: e.target.value })} className={inputClass} autoFocus />)}
              {field("Role", (
                <select value={editUserForm.role} onChange={(e) => setEditUserForm({ ...editUserForm, role: e.target.value })} className={selectClass}>
                  {roleOptions.custom.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                  {roleOptions.system.length > 0 && (
                    <optgroup label="System roles">
                      {roleOptions.system.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                    </optgroup>
                  )}
                </select>
              ))}
              {field("Warehouse", <input value={editUserForm.warehouse} onChange={(e) => setEditUserForm({ ...editUserForm, warehouse: e.target.value })} className={inputClass} />)}
              {field("Store / customer ID", <input value={editUserForm.store_id} onChange={(e) => setEditUserForm({ ...editUserForm, store_id: e.target.value })} placeholder="e.g. STR-MIL-01" className={inputClass} />)}
              <label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-2.5">
                <span>
                  <span className="field-label">Account status</span>
                  <span className="block text-[10px] text-muted-foreground">Reactive users can sign in</span>
                </span>
                <input
                  type="checkbox"
                  checked={editUserForm.active}
                  onChange={(e) => setEditUserForm({ ...editUserForm, active: e.target.checked })}
                  className="h-5 w-5 rounded"
                />
              </label>
              {resetResult ? (
                <RevealBox
                  tone="amber"
                  title={`Temporary password for ${resetResult.email}`}
                  secret={resetResult.password}
                  meta="Share privately — the user must choose their own password on next sign-in."
                  onCopy={() => copyText(resetResult.password, "manual")}
                  copied={copiedOnce === "manual"}
                  onDismiss={() => setResetResult(null)}
                    extra={
                      <>
                        <LoginLinkRow
                          url={loginUrl()}
                          copied={copiedOnce === "manual"}
                          onCopy={() => copyText(loginUrl(), "invite")}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            copyText(
                              `Email: ${resetResult.email}\nTemporary password: ${resetResult.password}\nLogin: ${loginUrl()}`,
                              "manual"
                            )
                          }
                          className="btn btn-secondary btn-sm gap-1.5 mt-2"
                        >
                          <Copy className="h-3.5 w-3.5" /> Share credentials
                        </button>
                      </>
                    }
                  />
              ) : (
                <button
                  type="button"
                  onClick={resetUserPassword}
                  disabled={resetting}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800 transition-colors hover:bg-amber-100"
                >
                  {resetting ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Resetting…</>
                  ) : confirmingReset ? (
                    <><KeyRound className="h-3.5 w-3.5" /> Click again to confirm — password resets to a one-time code</>
                  ) : (
                    <><KeyRound className="h-3.5 w-3.5" /> Reset password</>
                  )}
                </button>
              )}
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button type="button" onClick={() => { setEditingUser(null); setConfirmingReset(false); setResetResult(null); }} className="btn btn-secondary btn-sm">Cancel</button>
              <button type="button" onClick={saveEditUser} disabled={savingUser} className="btn btn-primary btn-sm">
                {savingUser ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <><CheckCircle2 className="h-4 w-4" /> Save changes</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------ EDIT INVITE MODAL */}
      {editingInvite && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" role="presentation" onClick={() => setEditingInvite(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="edit-invite-title" className="w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="edit-invite-title" className="text-base font-bold text-foreground">Edit invitation</h2>
                <p className="text-[10px] text-muted-foreground">{editingInvite.email}</p>
              </div>
              <button type="button" onClick={() => setEditingInvite(null)} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-3 space-y-2">
              {field("Invitee name", <input value={editInviteForm.name} onChange={(e) => setEditInviteForm({ ...editInviteForm, name: e.target.value })} className={inputClass} autoFocus />)}
              {field("Role", (
                <select value={editInviteForm.roles[0]} onChange={(e) => setEditInviteForm({ ...editInviteForm, roles: [e.target.value] })} className={selectClass}>
                  {roleOptions.custom.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                  {roleOptions.system.length > 0 && <optgroup label="System roles">{roleOptions.system.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</optgroup>}
                </select>
              ))}
              {field("Warehouse", <input value={editInviteForm.warehouse} onChange={(e) => setEditInviteForm({ ...editInviteForm, warehouse: e.target.value })} className={inputClass} />)}
              {field("Store / customer ID", <input value={editInviteForm.store_id} onChange={(e) => setEditInviteForm({ ...editInviteForm, store_id: e.target.value })} className={inputClass} />)}
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setEditingInvite(null)} className="btn btn-secondary btn-sm">Cancel</button>
              <button type="button" onClick={saveEditInvite} disabled={savingInvite} className="btn btn-primary btn-sm">
                {savingInvite ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <><CheckCircle2 className="h-4 w-4" /> Save invitation</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------ MESSAGES TAB (contact requests) */}
      {tab === "messages" && (
        <Surface className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2">
            <div className="relative min-w-[180px] flex-1">
              <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
              <input
                value={messageSearch}
                onChange={(e) => setMessageSearch(e.target.value)}
                placeholder="Search by user, email, subject or content…"
                className="h-8 w-full rounded-lg border border-input bg-background pl-7 pr-2 text-xs outline-none"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <select value={messageDirection} onChange={(e) => setMessageDirection(e.target.value as typeof messageDirection)} className="h-8 rounded-lg border border-input bg-background px-2 text-xs">
                <option value="">All directions</option>
                <option value="to_admin">From users</option>
                <option value="to_user">To users</option>
              </select>
              <select value={messageStatus} onChange={(e) => setMessageStatus(e.target.value as typeof messageStatus)} className="h-8 rounded-lg border border-input bg-background px-2 text-xs">
                <option value="new">New ({messageCounts.new})</option>
                <option value="read">Read ({messageCounts.read})</option>
                <option value="replied">Answered ({messageCounts.replied})</option>
                <option value="">All ({messageCounts.total})</option>
              </select>
            </div>
            <button type="button" onClick={() => void loadMessages()} className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground" title="Refresh">
              <Loader2 className={cn("h-4 w-4", loadingMessages && "animate-spin")} />
            </button>
            <Can permission="users.manage" mode="hide">
              <button type="button" onClick={openComposePicker} className="btn btn-primary btn-sm gap-1.5 whitespace-nowrap">
                <MessageSquare className="h-3.5 w-3.5" /> New message
              </button>
            </Can>
          </div>
          <div className="table-shell">
            <table className="table-fit">
              <colgroup>
                <col style={{ width: "215px" }} />
                <col style={{ width: "95px" }} />
                <col />
                <col style={{ width: "135px" }} />
                <col style={{ width: "100px" }} />
                <col style={{ width: "56px" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Sender</th>
                  <th>Type</th>
                  <th>Subject</th>
                  <th>Received</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loadingMessages && (
                  <tr><td colSpan={7} className="py-5 text-center text-xs text-muted-foreground">Loading…</td></tr>
                )}
                {!loadingMessages && messages.length === 0 && (
                  <tr><td colSpan={6} className="py-5 text-center text-xs text-muted-foreground">
                    No messages here — users reach you from the Contact page in the sidebar.
                  </td></tr>
                )}
                {messages.map((msg) => {
                  const statusPill =
                    msg.status === "new"
                      ? { label: "New", cls: "border-amber-300 bg-amber-50 text-amber-800" }
                      : msg.status === "read"
                        ? { label: "Read", cls: "border-sky-300 bg-sky-50 text-sky-800" }
                        : { label: "Answered", cls: "border-emerald-300 bg-emerald-50 text-emerald-800" };
                  return (
                    <tr key={msg.id} className={cn("cursor-pointer", msg.status === "new" && msg.direction === "to_admin" && "bg-amber-50/40")} onClick={() => { openReply(msg); }}>
                      <td>
                        <div className="flex items-center gap-2">
                          <span aria-hidden="true" className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase", avatarTone(msg.user_name))}>
                            {initials(msg.user_name)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-semibold leading-tight text-foreground">{msg.user_name}</p>
                            <p className="truncate text-[10px] leading-tight text-muted-foreground">{msg.user_email}</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold",
                          msg.direction === "to_admin" ? "border-sky-300 bg-sky-50 text-sky-800" : "border-violet-300 bg-violet-50 text-violet-800"
                        )}>
                          {msg.direction === "to_admin" ? "From user" : "To user"}
                        </span>
                      </td>
                      <td><span className="block truncate text-[11px] text-foreground" title={msg.message}>{msg.subject} — {msg.message}</span></td>
                      <td className="text-[10px] text-muted-foreground">{new Date(msg.created_at).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                      <td>
                        <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold", statusPill.cls)}>
                          {statusPill.label}
                        </span>
                      </td>
                      <td className="text-right">
                        <button type="button" onClick={(e) => { e.stopPropagation(); deleteMessage(msg); }} disabled={deletingMessageId === msg.id} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40" title="Delete message" aria-label="Delete message">
                          {deletingMessageId === msg.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Surface>
      )}

      {/* ------------------------------------------ REQUESTS TAB (public access requests) */}
      {tab === "requests" && (
        <Surface className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2">
            <div className="relative min-w-[180px] flex-1">
              <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
              <input
                value={requestSearch}
                onChange={(e) => setRequestSearch(e.target.value)}
                placeholder="Search by name, email, company or requested role…"
                className="h-8 w-full rounded-lg border border-input bg-background pl-7 pr-2 text-xs outline-none"
              />
            </div>
            <select value={requestsStatus} onChange={(e) => setRequestsStatus(e.target.value as typeof requestsStatus)} className="h-8 rounded-lg border border-input bg-background px-2 text-xs">
              <option value="pending">Pending ({requestCounts.pending})</option>
              <option value="additional_info">Info requested ({requestCounts.additional_info})</option>
              <option value="approved">Approved ({requestCounts.approved})</option>
              <option value="rejected">Rejected ({requestCounts.rejected})</option>
              <option value="">All statuses ({requestCounts.total})</option>
            </select>
            <button type="button" onClick={() => void loadRequests()} className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground" title="Refresh">
              <Loader2 className={cn("h-4 w-4", loadingRequests && "animate-spin")} />
            </button>
          </div>
          <div className="table-shell">
            <table className="table-fit">
              <colgroup>
                <col style={{ width: "215px" }} />
                <col />
                <col style={{ width: "155px" }} />
                <col style={{ width: "135px" }} />
                <col style={{ width: "110px" }} />
                <col style={{ width: "56px" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Requester</th>
                  <th>Company</th>
                  <th>Requested role</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th className="text-right">Review</th>
                </tr>
              </thead>
              <tbody>
                {loadingRequests && (
                  <tr><td colSpan={7} className="py-5 text-center text-xs text-muted-foreground">Loading…</td></tr>
                )}
                {!loadingRequests && requests.length === 0 && (
                  <tr><td colSpan={6} className="py-5 text-center text-xs text-muted-foreground">
                    {requestsStatus === "pending" ? "No pending requests — the queue is clear." : "No requests match this filter."}
                  </td></tr>
                )}
                {requests.map((req) => {
                  const pill =
                    req.status === "pending"
                      ? { label: "Pending", cls: "border-amber-300 bg-amber-50 text-amber-800" }
                      : req.status === "additional_info"
                        ? { label: "Info needed", cls: "border-sky-300 bg-sky-50 text-sky-800" }
                        : req.status === "approved"
                          ? { label: "Approved", cls: "border-emerald-300 bg-emerald-50 text-emerald-800" }
                          : { label: "Rejected", cls: "border-red-300 bg-red-50 text-red-800" };
                  return (
                    <tr key={req.id} className="cursor-pointer" onClick={() => openReview(req)}>
                      <td>
                        <div className="flex items-center gap-2">
                          <span aria-hidden="true" className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase", avatarTone(req.name))}>
                            {initials(req.name)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-semibold leading-tight text-foreground">{req.name}</p>
                            <p className="truncate text-[10px] leading-tight text-muted-foreground">{req.email}</p>
                          </div>
                        </div>
                      </td>
                      <td><span className="block truncate text-[11px] text-muted-foreground" title={req.company}>{req.company}</span></td>
                      <td><span className="block truncate text-[11px] text-foreground" title={req.requested_role}>{req.requested_role}</span></td>
                      <td className="text-[10px] text-muted-foreground">{new Date(req.created_at).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                      <td>
                        <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold", pill.cls)}>
                          {pill.label}
                        </span>
                      </td>
                      <td className="text-right">
                        {(req.status === "pending" || req.status === "additional_info" || req.status === "approved") && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void deleteRequest(req); }}
                            className="mr-0.5 rounded-md p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                            title="Delete request"
                            aria-label="Delete request"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button type="button" onClick={(e) => { e.stopPropagation(); openReview(req); }} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Review request" aria-label="Review request">
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Surface>
      )}

      {/* ------------------------------------------ ACCESS TAB (role → access matrix) */}
      {tab === "access" && (
        <Surface className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2">
            <div className="relative min-w-[180px] flex-1">
              <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
              <input
                value={accessSearch}
                onChange={(e) => setAccessSearch(e.target.value)}
                placeholder="Filter by role, code or permission…"
                className="h-8 w-full rounded-lg border border-input bg-background pl-7 pr-2 text-xs outline-none"
              />
            </div>
            <button type="button" onClick={loadRoles} className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground" title="Refresh">
              <Loader2 className="h-4 w-4" />
            </button>
          </div>
          <div className="table-shell">
            <table className="table-fit">
              <colgroup>
                <col style={{ width: "235px" }} />
                <col style={{ width: "110px" }} />
                <col style={{ width: "100px" }} />
                <col style={{ width: "110px" }} />
                <col />
                <col style={{ width: "56px" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Type</th>
                  <th>Users</th>
                  <th>Permissions</th>
                  <th>Details</th>
                  <th className="text-right">Open</th>
                </tr>
              </thead>
              <tbody>
                {accessFiltered.length === 0 && (
                  <tr><td colSpan={6} className="py-5 text-center text-xs text-muted-foreground">No roles match the filter.</td></tr>
                )}
                {accessFiltered.map((role) => {
                  const perms = role.permissions ?? [];
                  const isSuper = perms.includes("*");
                  const expanded = expandedRole === role.code;
                  return (
                    <Fragment key={role.code}>
                      <tr className="cursor-pointer" onClick={() => setExpandedRole(expanded ? null : role.code)} aria-expanded={expanded}>
                        <td>
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-semibold leading-tight text-foreground">
                              {role.name}
                              {role.protected ? <span className="ml-1 align-1 text-[9px] text-muted-foreground" title="Protected system role — cannot be edited or deleted">🔒</span> : null}
                            </p>
                            <p className="truncate text-[9px] font-mono leading-tight text-muted-foreground">{role.code}{role.base_role ? ` · base: ${role.base_role}` : ""}</p>
                          </div>
                        </td>
                        <td>
                          <span className={cn(
                            "inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold",
                            role.is_system ? "border-slate-300 bg-slate-100 text-slate-600" : "border-violet-200 bg-violet-50 text-violet-700"
                          )}>
                            {role.is_system ? "System" : "Custom"}
                          </span>
                        </td>
                        <td className="text-[11px] tabular-nums text-foreground">{role.assigned_users ?? 0}</td>
                        <td>
                          {isSuper ? (
                            <span className="inline-flex items-center rounded-md bg-primary px-2 py-0.5 text-[9px] font-bold uppercase text-primary-foreground">All · *</span>
                          ) : (
                            <span className="text-[11px] font-semibold tabular-nums text-foreground">{perms.length} <span className="font-normal text-muted-foreground">perm{perms.length === 1 ? "" : "s"}</span></span>
                          )}
                        </td>
                        <td>
                          <span className="block truncate text-[10px] text-muted-foreground" title={role.description || undefined}>
                            {role.description || "—"}
                          </span>
                        </td>
                        <td className="text-right">
                          <button type="button" onClick={(e) => { e.stopPropagation(); setExpandedRole(expanded ? null : role.code); }} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title={expanded ? "Hide role access" : "Show full role access"} aria-label={expanded ? "Hide role access" : "Show full role access"}>
                            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </button>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Surface>
      )}

      {/* ------------------------------------------ ACCESS REQUEST REVIEW MODAL */}
      {reviewTarget && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" role="presentation" onClick={() => setReviewTarget(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="access-request-title"
            className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Inbox className="h-6 w-6" />
                </span>
                <div className="min-w-0">
                  <h2 id="access-request-title" className="text-lg font-bold leading-tight text-foreground">Access request — {reviewTarget.name}</h2>
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{reviewTarget.id} · submitted {new Date(reviewTarget.created_at).toLocaleString()}</p>
                </div>
              </div>
              <button type="button" onClick={() => setReviewTarget(null)} aria-label="Close" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            {/* Body */}
            <div className="overflow-y-auto px-6 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="field-label">Work email</p>
                  <p className="mt-0.5 text-sm font-medium text-foreground break-all">{reviewTarget.email}</p>
                </div>
                <div>
                  <p className="field-label">Company / organization</p>
                  <p className="mt-0.5 text-sm font-medium text-foreground">{reviewTarget.company}</p>
                </div>
                {reviewTarget.phone && (
                  <div>
                    <p className="field-label">Phone</p>
                    <p className="mt-0.5 text-sm text-foreground">{reviewTarget.phone}</p>
                  </div>
                )}
                <div>
                  <p className="field-label">Requested role</p>
                  <p className="mt-0.5 inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{reviewTarget.requested_role}</p>
                </div>
              </div>
              <div className="mt-4">
                <p className="field-label">Reason for access</p>
                <p className="mt-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs leading-5 text-foreground">{reviewTarget.reason}</p>
              </div>
              {reviewTarget.additional_info && (
                <div className="mt-3">
                  <p className="field-label">Additional information</p>
                  <p className="mt-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs leading-5 text-foreground">{reviewTarget.additional_info}</p>
                </div>
              )}

              {/* Decided states */}
              {reviewTarget.status === "approved" && (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                  <p className="flex items-center gap-1.5 font-bold"><CheckCircle2 className="h-4 w-4" /> Approved{reviewTarget.reviewed_by_name ? ` by ${reviewTarget.reviewed_by_name}` : ""}</p>
                  <p className="mt-1">Invitation sent to the applicant's email — they set their own password by opening the link.</p>
                  {reviewTarget.review_notes && <p className="mt-1 italic">Notes: {reviewTarget.review_notes}</p>}
                  <button type="button" onClick={() => { setReviewTarget(null); setTab("invitations"); }} className="btn btn-secondary btn-sm mt-2">Open Invitations tab</button>
                </div>
              )}
              {reviewTarget.status === "rejected" && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                  <p className="flex items-center gap-1.5 font-bold"><X className="h-4 w-4" /> Rejected{reviewTarget.reviewed_by_name ? ` by ${reviewTarget.reviewed_by_name}` : ""}</p>
                  {reviewTarget.review_notes && <p className="mt-1">Reason: {reviewTarget.review_notes}</p>}
                  {reviewTarget.reviewed_at && <p className="mt-1 text-[10px]">Reviewed at {new Date(reviewTarget.reviewed_at).toLocaleString()}</p>}
                </div>
              )}

              {/* Pending decisions */}
              {(reviewTarget.status === "pending" || reviewTarget.status === "additional_info") && (
                <>
                  {reviewTarget.status === "additional_info" && (
                    <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
                      <p className="font-bold">Waiting for more information</p>
                      <p className="mt-0.5">The applicant was asked for details — they will reply to the notification email.</p>
                      <button type="button" onClick={() => resumeRequest(reviewTarget)} className="mt-2 text-[11px] font-semibold text-sky-800 underline underline-offset-2">Move back to pending</button>
                    </div>
                  )}
                  <div className="mt-4">
                    <p className="field-label">Decision</p>
                    <div className="mt-1 grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted/40 p-1">
                      {([
                        { id: "approve" as const, label: "Approve" },
                        { id: "reject" as const, label: "Reject" },
                        { id: "info" as const, label: "Request info" },
                      ]).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setReviewMode(m.id)}
                          className={cn(
                            "rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors",
                            reviewMode === m.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {reviewMode === "approve" && (
                    <div className="mt-3 space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800"><BadgeCheck className="h-3.5 w-3.5" /> Make account — send invitation</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="block">
                          <span className="field-label">Full name</span>
                          <input type="text" value={reviewTarget.name} disabled readOnly className="input mt-1 cursor-not-allowed bg-muted/60 text-muted-foreground" />
                        </label>
                        <label className="block">
                          <span className="field-label">Work email <span className="font-normal text-muted-foreground">(from the request)</span></span>
                          <input type="email" value={reviewTarget.email} disabled readOnly className="input mt-1 cursor-not-allowed bg-muted/60 text-muted-foreground" />
                        </label>
                      </div>
                      <label className="block">
                        <span className="field-label">ERP role *</span>
                        <select value={reviewRole} onChange={(e) => setReviewRole(e.target.value)} className="select mt-1">
                          {assignableRoles.map((r) => (
                            <option key={r.code} value={r.code}>{r.name} ({r.code})</option>
                          ))}
                        </select>
                        {reviewTarget.requested_role && (
                          <p className="mt-1 rounded-md bg-muted/40 px-2.5 py-1.5 text-[10px] text-muted-foreground">
                            Role requested by applicant: <span className="font-semibold text-foreground">{reviewTarget.requested_role}</span>
                            {reviewRole !== reviewTarget.requested_role ? " — changing it is allowed" : " — kept by default"}
                          </p>
                        )}
                        <p className="mt-1 text-[9px] text-muted-foreground">The requester’s role is only a preference — you choose what they actually get. Super Admin can never be granted from here.</p>
                      </label>
                      <label className="block">
                        <span className="field-label">Warehouse / location</span>
                        <input value={reviewWarehouse} onChange={(e) => setReviewWarehouse(e.target.value)} className="input mt-1" />
                      </label>
                      <label className="block">
                        <span className="field-label">Notes (internal, optional)</span>
                        <textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} rows={2} className="input mt-1 py-2" placeholder="Why approved, any caveats…" />
                      </label>
                      <Can permission="users.manage" mode="disable">
                        <button type="button" disabled={reviewing} onClick={submitReview} className="btn btn-primary w-full justify-center py-2.5 text-sm">
                          {reviewing ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating account…</> : <><CheckCircle2 className="h-4 w-4" /> Create account &amp; send invitation</>}
                        </button>
                      </Can>
                    </div>
                  )}
                  {reviewMode === "reject" && (
                    <div className="mt-3 space-y-3 rounded-xl border border-red-200 bg-red-50/50 p-3">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-red-800">Reject request</p>
                      <label className="block">
                        <span className="field-label">Reason (emailed to the applicant, optional)</span>
                        <textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} rows={3} className="input mt-1 py-2" placeholder="e.g. We don't have a role matching this request right now…" />
                      </label>
                      <Can permission="users.manage" mode="disable">
                        <button type="button" disabled={reviewing} onClick={submitReview} className="btn btn-danger w-full justify-center py-2">
                          {reviewing ? <><Loader2 className="h-4 w-4 animate-spin" /> Rejecting…</> : <><X className="h-4 w-4" /> Reject request</>}
                        </button>
                      </Can>
                    </div>
                  )}
                  {reviewMode === "info" && (
                    <div className="mt-3 space-y-3 rounded-xl border border-sky-200 bg-sky-50/50 p-3">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-sky-800">Request more information</p>
                      <label className="block">
                        <span className="field-label">What do you need? *</span>
                        <textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} rows={3} className="input mt-1 py-2" placeholder="e.g. Which site and which shift will you work, who is your manager…" />
                      </label>
                      <Can permission="users.manage" mode="disable">
                        <button type="button" disabled={reviewing || reviewNotes.trim().length < 4} onClick={submitReview} className="btn btn-primary w-full justify-center py-2">
                          {reviewing ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : <><Mail className="h-4 w-4" /> Send request for information</>}
                        </button>
                      </Can>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------ ACCOUNT CREATED (temp password) */}
      {approvedAccount && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="account-created-title" className="w-full max-w-lg rounded-2xl border border-emerald-200 bg-card p-6 text-center shadow-2xl">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            </span>
            <h2 id="account-created-title" className="mt-4 text-lg font-bold text-foreground">Account created for {approvedAccount.name}</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {approvedAccount.delivery === "smtp_sent"
                ? `${approvedAccount.email} has been emailed that their access request was approved.`
                : `${approvedAccount.email}: email is not configured or could not be sent — share the password privately.`}
            </p>
            <div className="mt-4 text-left">
              <RevealBox
                tone="amber"
                title={`Temporary password for ${approvedAccount.email}`}
                secret={approvedAccount.password}
                meta="Share privately. The user will be forced to set their own password on first sign-in."
                onCopy={() => copyText(approvedAccount.password, "manual")}
                copied={copiedOnce === "manual"}
                onDismiss={() => setApprovedAccount(null)}
                extra={
                  <>
                    <LoginLinkRow
                      url={loginUrl()}
                      copied={copiedOnce === "manual"}
                      onCopy={() => copyText(loginUrl(), "invite")}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          `Email: ${manualResult?.email ?? approvedAccount?.email ?? ""}\nTemporary password: ${manualResult?.password ?? approvedAccount?.password ?? ""}\nLogin: ${loginUrl()}`,
                          "manual"
                        )
                      }
                      className="btn btn-secondary btn-sm gap-1.5 mt-2"
                    >
                      <Copy className="h-3.5 w-3.5" /> Share credentials
                    </button>
                  </>
                }
              />
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              They sign in at /login with their email and this temporary password — they must change it on first sign-in.
            </p>
            <button type="button" onClick={() => setApprovedAccount(null)} className="btn btn-primary mt-4 w-full justify-center py-2">
              Done
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------ COMPOSE MESSAGE MODAL */}
      {composeOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" role="presentation" onClick={closeCompose}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="compose-message-title"
            className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
              <div className="flex min-w-0 items-center gap-3">
                {composeTarget ? (
                  <>
                    <span aria-hidden="true" className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[12px] font-bold uppercase", avatarTone(composeTarget.name))}>
                      {initials(composeTarget.name)}
                    </span>
                    <div className="min-w-0">
                      <h2 id="compose-message-title" className="truncate text-base font-bold leading-tight text-foreground">Message {composeTarget.name}</h2>
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{composeTarget.email} · {composeTarget.role_names?.join(", ") || composeTarget.role}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <MessageSquare className="h-6 w-6" />
                    </span>
                    <div className="min-w-0">
                      <h2 id="compose-message-title" className="text-base font-bold leading-tight text-foreground">New message to a user</h2>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">Pick a recipient — the message lands in their Contact Administration inbox.</p>
                    </div>
                  </>
                )}
              </div>
              <button type="button" onClick={closeCompose} aria-label="Close" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-y-auto px-6 py-4">
              {!composeTarget && (
                <label className="block">
                  <span className="field-label">To (recipient) *</span>
                  <select
                    value={composeRecipientId}
                    onChange={(e) => setComposeRecipientId(e.target.value)}
                    className="select mt-1"
                    autoFocus
                  >
                    <option value="">Choose an account…</option>
                    {users.filter((u) => u.active).map((u) => (
                      <option key={u.id} value={u.id}>{u.name} — {u.email} ({(u.role_names?.[0] ?? u.role ?? "").replace(/_/g, " ")})</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="mt-3 block">
                <span className="field-label">Subject *</span>
                <input
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                  autoFocus={!!composeTarget}
                  placeholder="e.g. Your access request was approved / Shift change / Pick-up info…"
                  className="input mt-1"
                />
              </label>
              <label className="mt-3 block">
                <span className="field-label">Message *</span>
                <textarea
                  value={composeMessage}
                  onChange={(e) => setComposeMessage(e.target.value)}
                  rows={6}
                  placeholder="Write the message — it lands in the user's Contact Administration page and triggers a notification…"
                  className="input mt-1 min-h-[140px] py-2 leading-6"
                />
              </label>
              <p className="mt-2 text-[10px] text-muted-foreground">The user sees this in Contact Administration with an unread badge; clicking it opens the message and lets them reply to you.</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/30 px-6 py-3">
              <button type="button" onClick={closeCompose} className="btn btn-secondary btn-sm">Cancel</button>
              <button type="button" onClick={sendComposedMessage} disabled={composing || (!composeTarget && !composeRecipientId) || composeSubject.trim().length < 2 || composeMessage.trim().length < 5} className="btn btn-primary btn-sm gap-1.5">
                {composing ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : <><MessageSquare className="h-4 w-4" /> Send message</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------ MESSAGE REPLY MODAL */}
      {replyTarget && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" role="presentation" onClick={() => setReplyTarget(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="message-reply-title"
            className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
              <div className="flex min-w-0 items-start gap-3">
                <span aria-hidden="true" className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-[12px] font-bold uppercase text-primary", avatarTone(replyTarget.user_name))}>
                  {initials(replyTarget.user_name)}
                </span>
                <div className="min-w-0">
                  <h2 id="message-reply-title" className="truncate text-base font-bold leading-tight text-foreground">{replyTarget.subject}</h2>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {replyTarget.direction === "to_admin" ? "From" : "To"} {replyTarget.user_name} · {replyTarget.user_email} · {replyTarget.user_role} · {new Date(replyTarget.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => setReplyTarget(null)} aria-label="Close" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-y-auto px-6 py-4">
              <p className="field-label">{replyTarget.direction === "to_admin" ? "Their message" : "Your message to the user"}</p>
              <p className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm leading-6 text-foreground">{replyTarget.message}</p>
              {replyTarget.direction === "to_admin" ? (
                <label className="mt-4 block">
                  <span className="field-label">Your reply *</span>
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    rows={4}
                    autoFocus
                    placeholder="Write your answer — the sender gets notified by email and in-app."
                    className="input mt-1 min-h-[110px] py-2 leading-6"
                  />
                </label>
              ) : (
                <p className="mt-4 rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                  {replyTarget.status === "new" ? "Unread by the user." : replyTarget.status === "read" ? "Read by the user." : "Answered by the user."}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-6 py-3">
              <div className="flex items-center gap-2">
                <p className="text-[10px] text-muted-foreground">Reference <span className="font-mono">{replyTarget.id}</span></p>
                <button
                  type="button"
                  onClick={() => { deleteMessage(replyTarget); setReplyTarget(null); }}
                  className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 hover:bg-red-100"
                >
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              </div>
              {replyTarget.direction === "to_admin" && (
                <Can permission="users.manage" mode="disable">
                  <button type="button" onClick={sendReply} disabled={replying || replyText.trim().length < 2} className="btn btn-primary gap-1.5">
                    {replying ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : <><MessageCircleReply className="h-4 w-4" /> Send reply</>}
                  </button>
                </Can>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------ ROLE ACCESS MODAL */}
      {roleAccessModal}

      {/* ------------------------------------------ DELETE USER MODAL */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" role="presentation" onClick={() => { setDeleteTarget(null); setDeleteConfirmText(""); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="delete-title" className="w-full max-w-md rounded-2xl border border-border bg-card p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 id="delete-title" className="text-base font-bold text-foreground">Delete {deleteTarget.name}?</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {deleteTarget.email} — permanently deletes the account and frees this email address. The action is audited. Use Deactivate instead if the person may return.
            </p>
            <div className="mt-3">
              <label className="field-label" htmlFor="delete-confirm">Type the email to confirm</label>
              <input
                id="delete-confirm"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={deleteTarget.email}
                className="input mt-1"
                autoComplete="off"
              />
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button type="button" onClick={() => { setDeleteTarget(null); setDeleteConfirmText(""); }} className="btn btn-secondary btn-sm">Cancel</button>
              <button type="button" onClick={confirmDeleteUser} disabled={deleting || deleteConfirmText.trim().toLowerCase() !== deleteTarget.email.toLowerCase()} className="btn btn-danger btn-sm gap-1.5">
                {deleting ? <><Loader2 className="h-4 w-4 animate-spin" /> Deleting…</> : <><Trash2 className="h-4 w-4" /> Delete</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
