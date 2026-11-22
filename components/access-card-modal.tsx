"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Printer,
  QrCode,
  ShieldCheck,
  ShieldOff,
  RefreshCw,
  X,
  CheckCircle2,
  AlertTriangle,
  Ban
} from "lucide-react";
export interface AccessCardUser {
  id: string;
  email: string;
  name: string;
  role: string;
  roles: string[];
  role_names: string[];
  store_id: string | null;
  warehouse: string | null;
}

interface CredentialSummary {
  id: string;
  user_id: string;
  type: string;
  label: string;
  status: "active" | "inactive" | "revoked" | "expired";
  secret_hint: string;
  created_at: string;
  created_by: string | null;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error?.message ?? `Request failed (HTTP ${res.status}).`);
  }
  return body as T;
}

function statusTone(status: CredentialSummary["status"]) {
  switch (status) {
    case "active":
      return "border-emerald-600/30 bg-emerald-50 text-emerald-800";
    case "inactive":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "revoked":
      return "border-red-200 bg-red-50 text-red-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

export function AccessCardModal({
  user,
  onClose
}: {
  user: AccessCardUser;
  onClose: () => void;
}) {
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ qr_data_uri: string; qr_svg: string; secret: string } | null>(null);

  const activeCredential = credentials.find((c) => c.status === "active") ?? credentials[0] ?? null;
  const hasActive = credentials.some((c) => c.status === "active");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ credentials: CredentialSummary[] }>(
        `/api/v1/admin/users/${user.id}/credentials`
      );
      setCredentials(data.credentials ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Unable to load credentials.");
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    load();
  }, [load]);

  const issue = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api<{
        ok: boolean;
        credential: CredentialSummary;
        qr_data_uri: string;
        qr_svg: string;
        secret: string;
      }>(`/api/v1/admin/users/${user.id}/credentials`, {
        method: "POST",
        body: JSON.stringify({ label: "Personal Access Card" })
      });
      setIssued({ qr_data_uri: data.qr_data_uri, qr_svg: data.qr_svg, secret: data.secret });
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not generate the barcode.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/admin/users/${user.id}/credentials/revoke`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setIssued(null);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not revoke the barcode.");
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async (credential: CredentialSummary) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/admin/users/${user.id}/credentials/status`, {
        method: "POST",
        body: JSON.stringify({
          credential_id: credential.id,
          status: credential.status === "active" ? "inactive" : "active"
        })
      });
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not update the barcode status.");
    } finally {
      setBusy(false);
    }
  };

  const print = () => window.print();

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="barcode-print-area flex w-full max-w-4xl flex-col gap-4 rounded-2xl bg-white p-5 text-foreground shadow-2xl lg:flex-row lg:p-6 print:max-w-none print:rounded-none print:bg-[#061222] print:p-8">
        {/* ===== Left — the physical ID access card ===== */}
        <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl bg-gradient-to-br from-[#061222] via-[#123249] to-[#2D5B75] p-4 text-white print:min-h-[340px] print:w-[520px] print:max-w-none print:gap-3 print:rounded-xl print:p-5">
          {/* Card header */}
          <div className="flex w-full items-center justify-between border-b border-white/10 pb-3 print:pb-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center">
                <img src="/logo.png" alt="Ascentra Logo" className="h-full w-full object-contain" />
              </div>
              <div className="text-left">
                <p className="text-[12px] font-bold leading-none tracking-[0.18em]">ASCENTRA</p>
                <p className="mt-0.5 text-[7px] font-semibold uppercase tracking-[0.24em] text-white/55">Food Distribution</p>
              </div>
            </div>
            <p className="rounded border border-white/20 bg-white/5 px-2 py-1 text-[7px] font-bold uppercase tracking-[0.3em] text-white/75">Employee</p>
          </div>

          {/* Card body */}
          <div className="grid w-full flex-1 grid-cols-[1fr_auto] items-center gap-4 print:gap-3">
            <div className="flex flex-col gap-3">
              {/* Avatar initials */}
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/15 bg-gradient-to-br from-[#2D5B75] to-[#123249] text-xl font-bold tracking-tight text-white print:h-14 print:w-14">
                {user.name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("")}
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-white/45">Personnel</p>
                <h3 className="mt-0.5 max-w-[220px] text-lg font-bold leading-tight tracking-tight">{user.name}</h3>
                <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/70">
                  {user.role_names?.[0] ?? user.role?.replace(/_/g, " ")}
                </p>
              </div>
              <div className="mt-auto grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[8px] font-bold uppercase tracking-[0.2em] text-white/35">Employee ID</p>
                  <p className="font-mono text-[11px] font-semibold text-white/85">{user.id}</p>
                </div>
                <div>
                  <p className="text-[8px] font-bold uppercase tracking-[0.2em] text-white/35">Warehouse</p>
                  <p className="text-[11px] font-semibold text-white/85">{user.warehouse ?? "—"}</p>
                </div>
                {user.store_id && (
                  <div className="col-span-2">
                    <p className="text-[8px] font-bold uppercase tracking-[0.2em] text-white/35">Store / Customer</p>
                    <p className="font-mono text-[11px] font-semibold text-white/85">{user.store_id}</p>
                  </div>
                )}
              </div>
            </div>

            {/* QR block */}
            <div className="flex flex-col items-center gap-1.5">
              <div className="rounded-xl bg-white p-2.5 shadow-[0_0_0_1px_rgba(255,255,255,0.2)]">
                {issued ? (
                  <img
                    src={issued.qr_data_uri}
                    alt="Personal access QR code"
                    className="h-36 w-36 print:h-28 print:w-28"
                  />
                ) : activeCredential?.status === "active" ? (
                  <div className="flex h-36 flex-col items-center justify-center gap-1 text-slate-400 print:h-28">
                    <ShieldCheck className="h-8 w-8 text-slate-300" />
                    <p className="text-[9px] font-semibold text-slate-500">QR hidden</p>
                  </div>
                ) : (
                  <div className="flex h-36 flex-col items-center justify-center gap-1 text-slate-400 print:h-28">
                    <QrCode className="h-8 w-8 text-slate-300" />
                    <p className="text-[9px] font-semibold text-slate-500">No QR yet</p>
                  </div>
                )}
              </div>
              <p className="text-[7px] font-bold uppercase tracking-[0.26em] text-white/40">Scan to sign in</p>
            </div>
          </div>

          {/* Card footer */}
          <div className="flex w-full items-center justify-between border-t border-white/10 pt-3 text-[7px] font-bold uppercase tracking-[0.22em] text-white/35 print:pt-2">
            <span>Ascentra Food Distribution</span>
            <span>Property of Ascentra Global Ltd</span>
            <span>Issued {new Date().toISOString().slice(0, 10)}</span>
          </div>
        </div>

        {/* ===== Right — management controls ===== */}
        <div className="flex flex-1 flex-col print:hidden">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">Credentials</p>
              <h2 className="mt-0.5 text-lg font-bold tracking-tight text-foreground">Barcode management</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Barcode identifies the user. Your RBAC permissions are read live — the code never carries a role.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="button"
            onClick={issue}
            disabled={busy || loading}
            className="btn btn-primary mt-4 w-full justify-center gap-2 py-2.5"
          >
            <RefreshCw className={busy ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            {hasActive ? "Regenerate barcode" : "Generate barcode"}
          </button>

          {issued && (
            <button
              type="button"
              onClick={print}
              className="btn btn-secondary mt-2 w-full justify-center gap-2 py-2.5"
            >
              <Printer className="h-4 w-4" /> Print / Save as PDF
            </button>
          )}

          <div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-xl border border-border">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Issued</th>
                  <th className="px-3 py-2">Last used</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                )}
                {!loading && credentials.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                      No barcode issued yet. Generate one to create a personal access card.
                    </td>
                  </tr>
                )}
                {credentials.map((credential) => (
                  <tr key={credential.id} className="align-top">
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${statusTone(credential.status)}`}>
                        {credential.status}
                      </span>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">···{credential.secret_hint}</p>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{new Date(credential.created_at).toLocaleDateString()}</td>
                    <td className="px-3 py-2 text-muted-foreground">{credential.last_used_at ? new Date(credential.last_used_at).toLocaleString() : "Never"}</td>
                    <td className="px-3 py-2 text-right">
                      {(credential.status === "active" || credential.status === "inactive") && (
                        <button
                          type="button"
                          disabled={busy || credential.status === "active"}
                          onClick={() => toggleStatus(credential)}
                          className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                          title={credential.status === "active" ? "Deactivate" : "Reactivate"}
                        >
                          {credential.status === "active" ? <ShieldOff className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasActive && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-900">
              <Ban className="h-4 w-4 shrink-0" />
              <span>
                Regenerating revokes the current card immediately — the old card stops working at once.
              </span>
            </div>
          )}

          <button type="button" onClick={onClose} className="btn btn-secondary mt-3 w-full justify-center py-2.5">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
