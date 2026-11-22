"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Eye, EyeOff, Loader2, Lock, Mail, User } from "lucide-react";

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  roles?: string[];
  warehouse?: string | null;
}

export default function UserSettingsPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyName, setBusyName] = useState(false);

  // Password form
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busyPassword, setBusyPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);

  const loadUser = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/me", { credentials: "include" });
      if (res.ok) {
        const body = await res.json();
        if (body?.user) {
          setUser(body.user as AuthUser);
          setName(body.user.name ?? "");
        }
      }
    } catch {
      setError("Could not load your profile. Please sign in again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveName = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Your name is required.");
      return;
    }
    setBusyName(true);
    try {
      const res = await fetch("/api/v1/auth/me", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error?.message ?? "Could not save your name.");
        return;
      }
      if (body?.user) setUser(body.user as AuthUser);
      setNotice(`Your name is now ${trimmed}.`);
    } catch {
      setError("Network error while saving your name. Please try again.");
    } finally {
      setBusyName(false);
    }
  };

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError(null);
    if (newPassword.length < 8) {
      setPasswordError("The new password must be at least 8 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("The passwords do not match.");
      return;
    }
    setBusyPassword(true);
    try {
      const res = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPasswordError(body?.error?.message ?? "Could not change your password.");
        return;
      }
      setPasswordNotice("Your password has been changed.");
      setNewPassword("");
      setConfirmPassword("");
      setCurrentPassword("");
    } catch {
      setPasswordError("Network error while changing your password. Please try again.");
    } finally {
      setBusyPassword(false);
    }
  };

  const roleLabel = user?.role ? user.role.replace(/_/g, " ").toUpperCase() : "—";

  return (
    <div className="flex min-h-screen flex-col bg-background px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center">
            <img src="/logo.png" alt="Ascentra Logo" className="h-full w-full object-contain" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">Ascentra Global Ltd</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">My settings</h1>
            <p className="mt-1 text-xs text-muted-foreground">Update your name and set your own password.</p>
          </div>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">
            {notice}
          </div>
        )}
        {passwordError && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <span>{passwordError}</span>
          </div>
        )}
        {passwordNotice && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">
            {passwordNotice}
          </div>
        )}

        <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <form onSubmit={saveName} className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-foreground">Account</p>
              <dl className="mt-2 grid gap-1.5 text-sm sm:grid-cols-2">
                <div className="flex gap-3">
                  <span className="text-[10px] font-semibold uppercase text-muted-foreground">Role</span>
                  <span className="text-xs font-semibold text-foreground">{roleLabel}</span>
                </div>
                <div className="flex gap-3">
                  <span className="text-[10px] font-semibold uppercase text-muted-foreground">Email</span>
                  <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                    {user?.email ?? "—"}
                  </span>
                </div>
              </dl>
            </div>

            <label className="block">
              <span className="field-label">Full name</span>
              <div className="relative mt-1">
                <User className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. shirts, shookai"
                  className="input pl-9"
                />
              </div>
            </label>

            <button type="submit" disabled={busyName || loading} className="btn btn-primary justify-center py-2">
              {busyName ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
              ) : (
                "Save name"
              )}
            </button>
          </form>
        </div>

        <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <p className="text-xs font-semibold text-foreground">Change password</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Your new password is used from the next sign-in. You must change it if you were given a temporary one.
          </p>
          <form onSubmit={savePassword} className="mt-4 space-y-4">
            <label className="block">
              <span className="field-label">Current password</span>
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
                  onClick={() => setShowPassword((v) => !v)}
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
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat your new password"
                  className="input pl-9"
                />
              </div>
            </label>
            <button type="submit" disabled={busyPassword} className="btn btn-primary justify-center py-2">
              {busyPassword ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Saving password…</>
              ) : (
                "Save password"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
