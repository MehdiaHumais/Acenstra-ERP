"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, Loader2, Lock, ShieldCheck } from "lucide-react";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [tokenReady, setTokenReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token") ?? "";
    setToken(t);
    setTokenReady(true);
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
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
      const res = await fetch("/api/v1/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error?.message ?? "This reset link is invalid or has expired.");
        setBusy(false);
        return;
      }
      setDone(true);
    } catch {
      setError("Network error while resetting your password. Please try again.");
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
            Choose a new password
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Set a strong password for your Ascentra ERP account.
          </p>
        </div>

        <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          {done ? (
            <div className="text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              </span>
              <h2 className="mt-4 text-base font-bold text-foreground">Password updated</h2>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Your password has been reset. All active sessions were signed out — sign in with your new password.
              </p>
              <div className="mt-5">
                <Link href="/login" className="btn btn-primary w-full justify-center py-2.5">
                  Sign in <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          ) : tokenReady && !token ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <span>
                This reset link is missing its token. Please use the link from your email, or{" "}
                <Link href="/forgot-password" className="font-semibold underline">request a new one</Link>.
              </span>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  <span>{error}</span>
                </div>
              )}
              <form onSubmit={handleSubmit} className="space-y-4">
                <label className="block">
                  <span className="field-label">New password (minimum 8 characters)</span>
                  <div className="relative mt-1">
                    <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
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
                  <span className="field-label">Confirm new password</span>
                  <div className="relative mt-1">
                    <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder="••••••••"
                      className="input pl-9"
                    />
                  </div>
                </label>
                <button type="submit" disabled={busy || !token} className="btn btn-primary w-full justify-center py-2.5">
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Updating…
                    </>
                  ) : (
                    <>
                      Update password <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </form>
              <div className="mt-4 border-t border-border pt-4 text-center text-xs text-muted-foreground">
                <Link href="/login" className="font-semibold text-primary hover:underline">
                  Back to sign in
                </Link>
              </div>
            </>
          )}
        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          Reset links are single-use and expire after 60 minutes.
        </p>
      </div>
    </div>
  );
}
