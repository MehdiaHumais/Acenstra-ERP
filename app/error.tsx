"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCw, AlertTriangle } from "lucide-react";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] render error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-card">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-lg font-bold tracking-tight text-foreground">
          Something went wrong on this screen
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The interface hit an unexpected error. Nothing you did was lost. Please try again.
        </p>
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
