"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertCircle, ArrowRight, Building2, CheckCircle2, Loader2, Mail, Phone, ShieldCheck, User } from "lucide-react";

const REQUESTED_ROLES = [
  "Warehouse Manager",
  "Manager / Supervisor",
  "Accountant / Finance",
  "Driver",
  "Warehouse Staff",
  "Picker",
  "Packer",
  "Sales / Commercial",
  "QA / Quality",
  "Other",
] as const;

export default function RequestAccessPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [requestedRole, setRequestedRole] = useState("");
  const [reason, setReason] = useState("");
  const [phone, setPhone] = useState("");
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/access-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          company: company.trim(),
          requested_role: requestedRole.trim(),
          reason: reason.trim(),
          phone: phone.trim(),
          additional_info: additionalInfo.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error?.message ?? "Unable to submit your request. Please try again.");
        setBusy(false);
        return;
      }
      setReference(data?.reference ?? null);
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
            Request ERP access
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Tell us who you are and why you need access — an administrator reviews every request.
          </p>
        </div>

        <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          {reference ? (
            <div className="text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              </span>
              <h2 className="mt-4 text-base font-bold text-foreground">Request submitted</h2>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Thank you. Your request has been received and is <span className="font-semibold text-foreground">awaiting admin review</span>.
                We will email you at <span className="font-semibold text-foreground">{email.trim()}</span> once a decision has been made.
              </p>
              {reference && (
                <p className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs text-foreground">
                  Reference: <span className="font-mono font-semibold">{reference}</span>
                </p>
              )}
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
                  <span className="field-label">Full name *</span>
                  <div className="relative mt-1">
                    <User className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input type="text" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chiara Ricci" autoComplete="name" className="input pl-9" />
                  </div>
                </label>

                <label className="block">
                  <span className="field-label">Work email *</span>
                  <div className="relative mt-1">
                    <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" className="input pl-9" />
                  </div>
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="field-label">Company / organization *</span>
                    <div className="relative mt-1">
                      <Building2 className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <input type="text" required maxLength={160} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Gourmet Market Brera" autoComplete="organization" className="input pl-9" />
                    </div>
                  </label>

                  <label className="block">
                    <span className="field-label">Phone <span className="font-normal text-muted-foreground">(optional)</span></span>
                    <div className="relative mt-1">
                      <Phone className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <input type="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+39 02 …" autoComplete="tel" className="input pl-9" />
                    </div>
                  </label>
                </div>

                <label className="block">
                  <span className="field-label">Requested position / role *</span>
                  <select
                    required
                    value={requestedRole}
                    onChange={(e) => setRequestedRole(e.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-xs outline-none"
                  >
                    <option value="">Select a position…</option>
                    {REQUESTED_ROLES.map((role) => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="field-label">Reason for access *</span>
                  <textarea
                    required
                    minLength={10}
                    maxLength={2000}
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. I manage inbound deliveries for the Milan cold hub and need POD verification and FEFO scanning in the inbound module…"
                    className="input mt-1 min-h-[84px] py-2 leading-5"
                  />
                </label>

                <label className="block">
                  <span className="field-label">Additional information <span className="font-normal text-muted-foreground">(optional)</span></span>
                  <textarea
                    maxLength={2000}
                    rows={2}
                    value={additionalInfo}
                    onChange={(e) => setAdditionalInfo(e.target.value)}
                    placeholder="Anything else we should know — site, team, start date…"
                    className="input mt-1 min-h-[56px] py-2 leading-5"
                  />
                </label>

                <button type="submit" disabled={busy} className="btn btn-primary w-full justify-center py-2.5">
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Submitting…
                    </>
                  ) : (
                    <>
                      Submit request <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </form>

              <p className="mt-4 text-center text-[10px] leading-4 text-muted-foreground">
                Submitting this form does <span className="font-semibold text-foreground">not</span> create an account.
                Access is granted only after an administrator reviews your request and sends an invitation.
              </p>
              <div className="mt-4 border-t border-border pt-4 text-center text-xs text-muted-foreground">
                Already have an account?{" "}
                <Link href="/login" className="font-semibold text-primary hover:underline">
                  Sign in
                </Link>
              </div>
            </>
          )}
        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          Requests are reviewed by Ascentra administrators; roles are assigned only by them.
        </p>
      </div>
    </div>
  );
}
