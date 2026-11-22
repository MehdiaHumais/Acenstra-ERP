"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, Mail, ShieldCheck } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error?.message ?? "Unable to process your request. Please try again.");
        setBusy(false);
        return;
      }
      setSent(true);
    } catch {
      setError("Network error while submitting your request. Please try again.");
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
            Reset your password
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Enter your work email and we will send you a secure reset link.
          </p>
        </div>

        <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          {sent ? (
            <div className="text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              </span>
              <h2 className="mt-4 text-base font-bold text-foreground">Check your inbox</h2>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                If an account exists for <span className="font-semibold text-foreground">{email.trim()}</span>,
                a reset link is on its way. The link expires in 60 minutes. If nothing arrives,
                ask any administrator to reset your password from Administration → Users → Edit.
              </p>
              <div className="mt-5">
                <Link href="/login" className="btn btn-primary w-full justify-center py-2.5">
                  Back to sign in <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
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
                  <span className="field-label">Work email</span>
                  <div className="relative mt-1">
                    <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      className="input pl-9"
                    />
                  </div>
                </label>
                <button type="submit" disabled={busy} className="btn btn-primary w-full justify-center py-2.5">
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Sending…
                    </>
                  ) : (
                    <>
                      Send reset link <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </form>
              <div className="mt-4 space-y-2 border-t border-border pt-4 text-center text-xs text-muted-foreground">
                <p>
                  Remembered it?{" "}
                  <Link href="/login" className="font-semibold text-primary hover:underline">
                    Sign in
                  </Link>
                </p>
                <p className="text-[11px] leading-5">
                  Didn’t receive the email? Ask an administrator to reset your password from{" "}
                  <span className="font-semibold text-foreground">Administration → Users → Edit → Reset password</span>,
                  or{" "}
                  <Link href="/contact" className="font-semibold text-primary hover:underline">
                    message administration
                  </Link>
                  .
                </p>
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
