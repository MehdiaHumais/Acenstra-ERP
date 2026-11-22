"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, MessageSquare, Reply, Send, Trash2, X } from "lucide-react";
import { cn } from "@/lib/format";

const SUBJECTS = [
  "Request access change",
  "Report a problem",
  "Ask a question",
  "Something else",
] as const;

type Direction = "to_admin" | "to_user";
type MsgStatus = "new" | "read" | "replied";

interface ContactMessage {
  id: string;
  direction: Direction;
  subject: string;
  message: string;
  status: MsgStatus;
  admin_reply: string | null;
  replied_by_name: string | null;
  replied_at: string | null;
  created_at: string;
}

function StatusPill({ status, direction }: { status: MsgStatus; direction: Direction }) {
  const map: Record<string, Record<string, { label: string; cls: string }>> = {
    to_admin: {
      new: { label: "Sent", cls: "border-amber-300 bg-amber-50 text-amber-800" },
      read: { label: "Seen", cls: "border-sky-300 bg-sky-50 text-sky-800" },
      replied: { label: "Answered", cls: "border-emerald-300 bg-emerald-50 text-emerald-800" },
    },
    to_user: {
      new: { label: "New", cls: "border-red-300 bg-red-50 text-red-800" },
      read: { label: "Read", cls: "border-sky-300 bg-sky-50 text-sky-800" },
      replied: { label: "Answered", cls: "border-emerald-300 bg-emerald-50 text-emerald-800" },
    },
  };
  const m = map[direction][status];
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold", m.cls)}>{m.label}</span>;
}

export default function ContactPage() {
  const [subject, setSubject] = useState<string>(SUBJECTS[0]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalMessage, setModalMessage] = useState<ContactMessage | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/contact", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages ?? []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    // Mark admin messages as read when they arrive (unread badge clears)
    const unread = messages.filter((m) => m.direction === "to_user" && m.status === "new").map((m) => m.id);
    if (unread.length === 0) return;
    unread.forEach((id) => {
      fetch(`/api/v1/admin/contact-messages/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read" }),
      }).catch(() => null);
    });
  }, [messages]);

  // Escape closes the popup
  useEffect(() => {
    if (!modalMessage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalMessage(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalMessage]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const res = await fetch("/api/v1/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, message: message.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error?.message ?? "Could not send your message. Please try again.");
        setBusy(false);
        return;
      }
      setSent(data?.reference ?? null);
      setMessage("");
      await load();
    } catch {
      setError("Network error while sending your message. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const removeMessage = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/v1/admin/contact-messages/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete" }),
      });
      if (res.ok) {
        setMessages((current) => current.filter((m) => m.id !== id));
        setModalMessage((current) => (current?.id === id ? null : current));
      }
    } finally {
      setDeletingId(null);
    }
  };

  const replyToAdministration = (subjectToReply: string) => {
    setSubject("Ask a question");
    setMessage(`Re: ${subjectToReply}\n`);
    setModalMessage(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toUser = messages.filter((m) => m.direction === "to_user");
  const fromUser = messages.filter((m) => m.direction === "to_admin");

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-4 sm:px-6">
      <div className="flex items-center gap-3 border-b border-border pb-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <MessageSquare className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-foreground">Contact Administration</h1>
          <p className="text-[11px] text-muted-foreground">Ask for access changes, report a problem, or send any message to administrators. Click any message to open it.</p>
        </div>
      </div>

      {sent && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs text-emerald-900">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>Message sent (reference <span className="font-mono font-semibold">{sent}</span>). An administrator will see it in the dashboard.</span>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={submit} className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <label className="block">
          <span className="field-label">Subject *</span>
          <select value={subject} onChange={(e) => setSubject(e.target.value)} className="select mt-1">
            {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="mt-3 block">
          <span className="field-label">Your message *</span>
          <textarea
            required
            minLength={5}
            maxLength={4000}
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe what you need — e.g. ‘I need access to the Inbound & Picking modules for the Milan Cold Hub…’"
            className="input mt-1 min-h-[110px] py-2 leading-6"
          />
        </label>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[10px] text-muted-foreground">Messages go to administrators only — never visible to other users.</p>
          <button type="submit" disabled={busy} className="btn btn-primary gap-1.5">
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : <><Send className="h-4 w-4" /> Send to Administration</>}
          </button>
        </div>
      </form>

      {/* From Administration */}
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">From Administration</p>
        </div>
        <div className="divide-y divide-border/60">
          {loading && <p className="px-4 py-6 text-center text-xs text-muted-foreground">Loading…</p>}
          {!loading && toUser.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">Nothing from administration yet.</p>
          )}
          {toUser.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-4 py-3">
              <button type="button" onClick={() => setModalMessage(m)} className="flex min-w-0 flex-1 items-center gap-3 text-left hover:bg-muted/40">
                <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold uppercase text-primary">A</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-foreground">{m.subject}</p>
                  <p className="truncate text-[10px] text-muted-foreground">{m.message}</p>
                </div>
                <span className="text-[10px] text-muted-foreground">{new Date(m.created_at).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" })}</span>
                <StatusPill status={m.status} direction="to_user" />
              </button>
              <button type="button" onClick={() => removeMessage(m.id)} disabled={deletingId === m.id} aria-label="Delete message" title="Delete message" className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40">
                {deletingId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Your messages to Administration */}
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Your messages &amp; replies</p>
        </div>
        <div className="divide-y divide-border/60">
          {loading && <p className="px-4 py-6 text-center text-xs text-muted-foreground">Loading…</p>}
          {!loading && fromUser.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">No messages yet — your first message goes straight to administrators.</p>
          )}
          {fromUser.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-4 py-3">
              <button type="button" onClick={() => setModalMessage(m)} className="flex min-w-0 flex-1 items-center gap-3 text-left hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-foreground">{m.subject}</p>
                  <p className="truncate text-[10px] text-muted-foreground">{m.message}</p>
                </div>
                <span className="text-[10px] text-muted-foreground">{new Date(m.created_at).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" })}</span>
                <StatusPill status={m.status} direction="to_admin" />
              </button>
              <button type="button" onClick={() => removeMessage(m.id)} disabled={deletingId === m.id} aria-label="Delete message" title="Delete message" className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40">
                {deletingId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ------------------------------------------ MESSAGE DETAIL POPUP */}
      {modalMessage && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" role="presentation" onClick={() => setModalMessage(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="message-detail-title"
            className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
              <div className="flex min-w-0 items-start gap-3">
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[12px] font-bold uppercase",
                    modalMessage.direction === "to_user" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                  )}
                >
                  {modalMessage.direction === "to_user" ? "A" : "ME"}
                </span>
                <div className="min-w-0">
                  <h2 id="message-detail-title" className="text-base font-bold leading-tight text-foreground">{modalMessage.subject}</h2>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {modalMessage.direction === "to_user" ? "From Administration" : "To Administration"} · {new Date(modalMessage.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => setModalMessage(null)} aria-label="Close" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-y-auto px-6 py-5">
              <p className="field-label">Message</p>
              <p className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-muted/30 px-3 py-3 text-sm leading-6 text-foreground">{modalMessage.message}</p>
              {modalMessage.direction === "to_admin" && (
                <>
                  {modalMessage.admin_reply ? (
                    <>
                      <p className="field-label mt-4">Reply from {modalMessage.replied_by_name ?? "Administration"}{modalMessage.replied_at ? ` · ${new Date(modalMessage.replied_at).toLocaleString()}` : ""}</p>
                      <p className="mt-1 whitespace-pre-wrap rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-[12px] leading-6 text-emerald-900">{modalMessage.admin_reply}</p>
                    </>
                  ) : (
                    <p className="mt-4 text-[12px] text-muted-foreground">Awaiting a reply from administrators.</p>
                  )}
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-6 py-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => removeMessage(modalMessage.id)}
                  disabled={deletingId === modalMessage.id}
                  className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-40"
                >
                  {deletingId === modalMessage.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete
                </button>
                {modalMessage.direction === "to_user" && (
                  <button
                    type="button"
                    onClick={() => replyToAdministration(modalMessage.subject)}
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    <Reply className="h-3.5 w-3.5" /> Reply
                  </button>
                )}
                {modalMessage.direction === "to_admin" && (
                  <button
                    type="button"
                    onClick={() => replyToAdministration(modalMessage.subject)}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-semibold text-foreground hover:bg-muted"
                  >
                    <Reply className="h-3.5 w-3.5" /> Send follow-up
                  </button>
                )}
              </div>
              <button type="button" onClick={() => setModalMessage(null)} className="btn btn-secondary btn-sm">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
