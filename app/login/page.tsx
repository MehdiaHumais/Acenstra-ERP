"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertCircle, ArrowRight, Download, Eye, EyeOff, KeyRound, Loader2, Lock, Mail, WifiOff } from "lucide-react";

function safeRedirect() {
  if (typeof window === "undefined") return "/";
  const target = new URLSearchParams(window.location.search).get("redirect");
  // Only allow same-site absolute paths, to avoid open redirects.
  if (!target || !target.startsWith("/") || target.startsWith("//")) return "/";
  return target;
}

async function readError(res: Response) {
  const data = await res.json().catch(() => ({}));
  return data?.error?.message ?? `Request failed (HTTP ${res.status}).`;
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);

  // Track connectivity for the offline banner.
  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // Explain why the user was signed out (deleted/disabled/session ended).
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("reason");
    if (!reason) return;
    if (reason === "account_deleted") {
      setError("Your account was deleted by an administrator. Contact your administrator if you need access again.");
    } else if (reason === "account_disabled") {
      setError("Your account has been disabled. Please contact your administrator.");
    } else if (reason === "session_expired") {
      setError("Your session ended. Please sign in again.");
    }
  }, []);

  // Offer the PWA install prompt only while the browser considers the app
  // installable. Do not nag someone already running the installed PWA.
  useEffect(() => {
    const detectInstalled = () => {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as any).standalone === true;
      if (standalone) {
        setInstalled(true);
        setInstallPrompt(null);
      }
      return standalone;
    };

    const handler = (event: any) => {
      if (detectInstalled()) return;
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", handler);

    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener("appinstalled", onInstalled);

    detectInstalled();
    const getRelatedApps = (navigator as any).getInstalledRelatedApps;
    if (typeof getRelatedApps === "function") {
      getRelatedApps.call(navigator)
        .then((apps: any[]) => {
          if (Array.isArray(apps) && apps.some((app) => app?.platform === "web")) onInstalled();
        })
        .catch(() => { /* API unavailable — display-mode check is still authoritative */ });
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const submitCredentials = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password })
      });

      if (!res.ok) {
        setError(await readError(res));
        return;
      }

      const data = await res.json().catch(() => ({}));

      if (data?.mfa_required) {
        setMfaToken(data.mfa_token as string);
        return;
      }

      // Temporary-password accounts must pick their own password first.
      if (data?.must_change_password) {
        window.location.assign("/change-password");
        return;
      }

      window.location.assign(safeRedirect());
    } catch {
      setError("Network error while signing in. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitMfa = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mfaToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/mfa/verify-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mfa_token: mfaToken, code: code.trim() })
      });

      if (!res.ok) {
        setError(await readError(res));
        return;
      }

      window.location.assign(safeRedirect());
    } catch {
      setError("Network error while verifying the code. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const subtitle = mfaToken
    ? "Enter the 6-digit code from your authenticator app"
    : "Use your work email and password";

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
            Sign in to your ERP
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        </div>

        <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          {!isOnline && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
              <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <span>You’re offline. Ascentra needs a network connection to sign you in and load live data.</span>
            </div>
          )}
          {installPrompt && !installed && (
            <button
              type="button"
              onClick={async () => {
                try {
                  installPrompt.prompt();
                  await installPrompt.userChoice;
                } catch {
                  // user dismissed the native prompt — nothing to do
                } finally {
                  setInstallPrompt(null);
                }
              }}
              className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/15"
            >
              <Download className="h-4 w-4" /> Install Ascentra app
            </button>
          )}
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {mfaToken ? (
            /* ------------------------------------------------------ MFA step */
            <form onSubmit={submitMfa} className="space-y-4">
              <label className="block">
                <span className="field-label">Verification code</span>
                <div className="relative mt-1">
                  <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="123456"
                    className="input pl-9"
                  />
                </div>
              </label>

              <button type="submit" disabled={busy} className="btn btn-primary w-full justify-center py-2.5">
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Verifying…
                  </>
                ) : (
                  <>
                    Verify & continue <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setMfaToken(null);
                  setCode("");
                  setError(null);
                }}
                className="w-full text-center text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Back to sign in
              </button>
            </form>
          ) : (
            /* -------------------------------------- Email & password form */
            <form onSubmit={submitCredentials} className="space-y-4">
              <label className="block">
                <span className="field-label">Work email</span>
                <div className="relative mt-1">
                  <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <input
                    type="email"
                    required
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="input pl-9"
                  />
                </div>
              </label>

              <label className="block">
                <span className="field-label">Password</span>
                <div className="relative mt-1">
                  <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
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

              <button type="submit" disabled={busy} className="btn btn-primary w-full justify-center py-2.5">
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Signing in…
                  </>
                ) : (
                  <>
                    Sign in <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>
          )}

          <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-xs">
            <Link href="/forgot-password" className="font-medium text-muted-foreground hover:text-foreground">
              Forgot password?
            </Link>
            <p className="text-muted-foreground">
              Need access?{" "}
              <Link href="/request-access" className="font-semibold text-primary hover:underline">
                Request access
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
