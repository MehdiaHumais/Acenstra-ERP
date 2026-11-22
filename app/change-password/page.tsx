"use client";

import { useState } from "react";
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Lock } from "lucide-react";

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters long.");
      return;
    }
    if (newPassword !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error?.message ?? "Could not change your password.");
        return;
      }
      window.location.assign("/");
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
            Choose a new password
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Your account was created with a temporary password. Set your own to continue.
          </p>
        </div>

        <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}
          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="field-label">Current (temporary) password</span>
              <div className="relative mt-1">
                <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
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
              <span className="field-label">New password</span>
              <div className="relative mt-1">
                <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="input pl-9"
                />
              </div>
            </label>

            <label className="block">
              <span className="field-label">Confirm new password</span>
              <div className="relative mt-1">
                <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat your new password"
                  className="input pl-9"
                />
              </div>
            </label>

            <button type="submit" disabled={busy} className="btn btn-primary w-full justify-center py-2.5">
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Updating password…
                </>
              ) : (
                <>
                  Save password & enter ERP <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
