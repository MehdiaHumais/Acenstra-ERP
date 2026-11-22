"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BrainCircuit, CheckCircle2, ShieldAlert, X } from "lucide-react";
import { Badge, ProgressBar } from "@/components/ui";
import { titleCase } from "@/lib/format";
import type { Insight } from "@/lib/types";

type Decision = "approved" | "rejected";
type InsightWithDecision = Insight & { decision?: "pending" | "approved" | "rejected" };

export function InsightList({ insights }: { insights: InsightWithDecision[] }) {
  const router = useRouter();
  const [decisions, setDecisions] = useState<Record<number, Decision>>(() => {
    const initial: Record<number, Decision> = {};
    for (const item of insights) {
      if (item.decision === "approved" || item.decision === "rejected") {
        initial[item.id] = item.decision;
      }
    }
    return initial;
  });
  const [feedback, setFeedback] = useState<string | null>(null);

  const decide = async (insight: Insight, decision: Decision) => {
    setDecisions((current) => ({ ...current, [insight.id]: decision }));
    try {
      const res = await fetch("/api/v1/ai/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          insight_id: insight.id,
          decision,
          reason:
            decision === "approved"
              ? "Approved via Governed AI console"
              : "Rejected by operator review",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback(data?.error?.message ?? "Unable to record AI governance decision.");
      } else {
        setFeedback(
          decision === "approved"
            ? `Approved: ${insight.title}. Action persisted with maker-checker audit trail.`
            : `Rejected: ${insight.title}. Governance rejection logged in audit trail.`,
        );
        router.refresh();
      }
    } catch {
      setFeedback("Network error while recording AI decision.");
    }
    window.setTimeout(() => setFeedback(null), 4000);
  };

  return (
    <div>
      {feedback && (
        <div className="flex items-center gap-2 border-b border-marine-ocean/60 bg-marine-ocean/20 px-5 py-2 text-[11px] font-medium text-marine-mid/90">
          <CheckCircle2 className="h-3.5 w-3.5" /> {feedback}
        </div>
      )}
      <div className="divide-y divide-border">
        {insights.length === 0 && (
          <p className="px-5 py-8 text-center text-xs text-muted-foreground">
            No AI recommendations awaiting approval.
          </p>
        )}
        {insights.map((insight) => {
          const decision = decisions[insight.id];
          return (
            <article key={insight.id} className="p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={insight.requires_approval ? "warning" : "info"} dot>
                  {titleCase(insight.kind)}
                </Badge>
                <span className="text-[11px] font-medium text-muted-foreground">
                  {Math.round(insight.confidence * 100)}% confidence
                </span>
                {insight.requires_approval && !decision && (
                  <span className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                    <ShieldAlert className="h-3.5 w-3.5" /> Approval required
                  </span>
                )}
                {decision && (
                  <Badge tone={decision === "approved" ? "ok" : "critical"} className="ml-auto">
                    {titleCase(decision)}
                  </Badge>
                )}
              </div>
              <h3 className="mt-2.5 text-sm font-semibold leading-6">{insight.title}</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{insight.detail}</p>
              <div className="mt-3">
                <ProgressBar value={insight.confidence * 100} tone={insight.confidence > 0.9 ? "ok" : "info"} />
              </div>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {insight.evidence.map((item) => (
                  <li
                    key={item}
                    className="rounded-md border border-border bg-muted/50 px-2 py-1 text-[10px] font-medium text-muted-foreground"
                  >
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-secondary/70 p-2.5">
                {insight.requires_approval ? (
                  <BrainCircuit className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                )}
                <p className="text-[11px] leading-5 text-secondary-foreground">{insight.action}</p>
              </div>
              {insight.requires_approval && !decision && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => decide(insight, "approved")}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Approve action
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => decide(insight, "rejected")}>
                    <X className="h-3.5 w-3.5" /> Reject
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
