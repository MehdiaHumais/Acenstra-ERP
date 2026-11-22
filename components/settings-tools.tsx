"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, Loader2, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

type CheckResult = {
  ok: boolean;
  message: string;
  checkedAt: string;
};

export function SettingsTools() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);

  const runChecks = async () => {
    setRunning(true);
    setResult(null);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const response = await fetch(`${API_URL}/health`, { signal: controller.signal, cache: "no-store" });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as {
        status?: string;
        version?: string;
        database?: { status?: string; active_skus?: number };
      };
      setResult({
        ok: true,
        message: `API reachable · status ${payload.status ?? "ok"} · DB ${payload.database?.status ?? "connected"} (${payload.database?.active_skus ?? 0} SKUs) · v${payload.version ?? "1.0.0"}.`,
        checkedAt: new Date().toISOString(),
      });
    } catch {
      setResult({
        ok: false,
        message: "Backend API is not reachable.",
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setRunning(false);
    }
  };

  const manageDataset = async (action: "clear_all_data" | "restore_demo_data") => {
    setRunning(true);
    setResult(null);
    try {
      const response = await fetch(`${API_URL}/health`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json()) as { status?: string; message?: string };
      if (!response.ok) throw new Error(payload.message ?? `HTTP ${response.status}`);
      setResult({
        ok: true,
        message: payload.message ?? "Database updated.",
        checkedAt: new Date().toISOString(),
      });
      router.refresh();
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : "Failed to update dataset.",
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setRunning(false);
    }
  };

  const downloadConfig = () => {
    const config = {
      product: "Ascentra Food Distribution ERP",
      version: "1.0.0",
      environment: "self-hosted",
      security: { mfa: true, rbac: true, sod: true, encryptionAtRest: true, tls: "1.3" },
      compliance: { gdpr: "by design", sdiProvider: "sandbox", haccp: "evidence model" },
      integrations: ["SdI adapter", "IoT temperature", "EDI/ASN mapping", "Barcode/GS1", "Bank import"],
      generatedAt: new Date().toISOString(),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "ascentra-platform-config.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => manageDataset("restore_demo_data")}
          disabled={running}
          title="Rebuild the seeded proposal demo dataset (products, orders, lots, invoices, tasks)"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Restore demo data
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => manageDataset("clear_all_data")}
          disabled={running}
          title="Permanently remove all products, orders, lots and invoices so the ERP starts empty"
        >
          <Trash2 className="h-3.5 w-3.5" /> Clear all data
        </button>
        <button type="button" className="btn btn-secondary" onClick={downloadConfig}>
          <Download className="h-3.5 w-3.5" /> Download config
        </button>
        <button type="button" className="btn btn-primary" onClick={runChecks} disabled={running}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          {running ? "Running checks" : "Run health check"}
        </button>
      </div>
      {result && (
        <div
          className={`max-w-md rounded-lg border px-3 py-2 text-left text-[11px] leading-5 ${
            result.ok
              ? "border-marine-ocean/60 bg-marine-ocean/20 text-marine-mid/90"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          <p className="flex items-start gap-1.5 font-medium">
            {result.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            {result.message}
          </p>
          <p className="mt-1 opacity-70">Checked {new Date(result.checkedAt).toLocaleTimeString()}</p>
        </div>
      )}
    </div>
  );
}
