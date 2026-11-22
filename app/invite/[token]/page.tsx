"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, Loader2, Lock } from "lucide-react";

interface InviteDetails {
  name: string;
  email: string;
  roles: string[];
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  company_admin: "Company Admin",
  finance_manager: "Finance Manager",
  operations_manager: "Operations Manager",
  warehouse_manager: "Warehouse Manager",
  inventory_manager: "Inventory Manager",
  sales_manager: "Sales Manager",
  sales_representative: "Sales Representative",
  warehouse_staff: "Warehouse Staff",
  picker: "Picker",
  driver: "Driver",
  qaqc_inspector: "QA/QC Inspector",
  payroll_specialist: "Payroll Specialist",
  hr_manager: "HR Manager",
  store_vendor: "Store Vendor",
  finance_admin: "Finance Admin",
  hr_admin: "HR Admin"
};

function roleLabel(code: string): string {
  return ROLE_LABELS[code] ?? code.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function InviteAcceptPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";

  const [step, setStep] = useState<"loading" | "invalid" | "ready" | "done">("loading");
  const [details, setDetails] = useState<InviteDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setStep("invalid");
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/v1/auth/invitation?token=${encodeURIComponent(token)}`, {
          credentials: "include"
        });
        if (res.status === 429) {
          setError("Too many attempts. Please try again later.");
          setStep("invalid");
          return;
        }
        if (!res.ok) {
          setStep("invalid");
          return;
        }
        const body = (await res.json()) as InviteDetails;
        setDetails(body);
        setStep("ready");
      } catch {
        setStep("invalid");
      }
    })();
  }, [token]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/v1/auth/invitation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error?.message ?? "Could not accept the invitation.");
        return;
      }
      setStep("done");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col justify-center bg-background px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-md">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center">
            <img src="/logo.png" alt="Ascentra Logo" className="h-full w-full object-contain" />
          </div>
          <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
            Ascentra Global Ltd
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
            You’ve been invited
          </h1>
        </div>

        <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          {step === "loading" && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking your invitation…
            </div>
          )}

          {step === "invalid" && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <span>{error ?? "This invitation is invalid, expired or revoked. Ask your administrator to resend it."}</span>
              </div>
              <Link href="/login" className="btn btn-secondary w-full justify-center">
                Back to sign in
              </Link>
            </div>
          )}

          {step === "ready" && details && (
            <form onSubmit={submit} className="space-y-4">
              <div className="rounded-xl border border-border bg-muted/40 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Invited</p>
                <p className="truncate text-sm font-bold text-foreground">{details.name}</p>
                <p className="text-[11px] text-muted-foreground">{details.email}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {details.roles.map((role) => (
                    <span key={role} className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      {roleLabel(role)}
                    </span>
                  ))}
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  <span>{error}</span>
                </div>
              )}

              <label className="block">
                <span className="field-label">Choose a password</span>
                <div className="relative mt-1">
                  <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="input pl-9 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-2.5 top-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>

              <label className="block">
                <span className="field-label">Confirm password</span>
                <div className="relative mt-1">
                  <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat your password"
                    className="input pl-9"
                  />
                </div>
              </label>

              <button type="submit" disabled={busy} className="btn btn-primary w-full justify-center py-2.5">
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Creating your account…
                  </>
                ) : (
                  <>
                    Accept invitation & create account <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>
          )}

          {step === "done" && (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
              <p className="text-sm text-muted-foreground">
                Your account is ready. You can now sign in with <span className="font-semibold text-foreground">{details?.email}</span>.
              </p>
              <Link href="/login" className="btn btn-primary w-full justify-center py-2.5">
                Continue to sign in <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
