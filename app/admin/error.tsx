"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCw, ShieldAlert } from "lucide-react";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin] render error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-2xl border border-red-200 bg-card p-8 text-center shadow-card">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-red-50 text-red-600">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <h1 className="mt-4 text-xl font-bold tracking-tight text-foreground">
          The administration view couldn’t load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A recoverable error occurred in the interface. Your data is safe — nothing was changed.
          Try again, or head back to the overview.
        </p>
        {error?.message ? (
          <p className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-left font-mono text-[11px] leading-5 text-muted-foreground">
            {error.message.slice(0, 240)}
          </p>
        ) : null}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button type="button" onClick={reset} className="btn btn-primary gap-1.5">
            <RotateCw className="h-4 w-4" /> Try again
          </button>
          <Link href="/" className="btn btn-secondary gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Back to overview
          </Link>
        </div>
      </div>
    </div>
  );
}
