"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Lock, Play, Search, UserPlus } from "lucide-react";
import { Badge, statusTone } from "@/components/ui";
import { dateTime, titleCase } from "@/lib/format";
import type { WarehouseTask } from "@/lib/types";

const statusFilters = ["all", "queued", "in_progress", "blocked", "done"];

export function TaskQueue({ tasks }: { tasks: WarehouseTask[] }) {
  const router = useRouter();
  const [items, setItems] = useState<WarehouseTask[]>(tasks);
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter((task) => {
      const statusMatch = status === "all" || task.status === status;
      const queryMatch =
        !term ||
        task.reference.toLowerCase().includes(term) ||
        task.detail.toLowerCase().includes(term) ||
        task.location.toLowerCase().includes(term);
      return statusMatch && queryMatch;
    });
  }, [items, status, query]);

  const notify = (message: string) => {
    setFeedback(message);
    window.setTimeout(() => setFeedback(null), 3500);
  };

  const applyTaskAction = async (
    task: WarehouseTask,
    action: "start" | "complete" | "assign_to_me" | "toggle_block",
    message: string
  ) => {
    try {
      const res = await fetch("/api/v1/warehouse/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: task.reference, action }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify(data?.error?.message ?? "Unable to update task.");
        return;
      }
      if (Array.isArray(data?.tasks)) {
        setItems(data.tasks as WarehouseTask[]);
      } else if (data?.task) {
        const updated = data.task as WarehouseTask;
        setItems((current) => current.map((t) => (t.reference === updated.reference ? updated : t)));
      }
      notify(message);
      router.refresh();
    } catch {
      notify("Network error while updating warehouse task.");
    }
  };

  const start = (task: WarehouseTask) =>
    applyTaskAction(task, "start", `${titleCase(task.task_type)} ${task.reference} started.`);

  const complete = (task: WarehouseTask) =>
    applyTaskAction(task, "complete", `${task.reference} completed. Stock ledger updated.`);

  const toggleBlock = (task: WarehouseTask) =>
    applyTaskAction(
      task,
      "toggle_block",
      task.status === "blocked"
        ? `${task.reference} unblocked and returned to queue.`
        : `${task.reference} blocked pending approval.`
    );

  const assignToMe = (task: WarehouseTask) =>
    applyTaskAction(task, "assign_to_me", `${task.reference} assigned to you.`);

  return (
    <div>
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative w-full sm:max-w-xs">
          <span className="sr-only">Search tasks</span>
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search task, batch or location"
            className="input pl-9"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {statusFilters.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setStatus(item)}
              className={`btn btn-sm ${status === item ? "btn-primary" : "btn-secondary"}`}
            >
              {titleCase(item)}
            </button>
          ))}
          <span className="text-xs text-muted-foreground">{filtered.length} tasks</span>
        </div>
      </div>

      {feedback && (
        <div className="flex items-center gap-2 border-b border-marine-ocean/60 bg-marine-ocean/20 px-4 py-2 text-[11px] font-medium text-marine-mid/90">
          <CheckCircle2 className="h-3.5 w-3.5" /> {feedback}
        </div>
      )}

      <div className="table-shell">
        <table className="data-table min-w-[1180px]">
          <thead>
            <tr>
              <th>Task</th>
              <th>Reference</th>
              <th>Location</th>
              <th>Assignee</th>
              <th>Priority</th>
              <th>Due</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((task) => (
              <tr key={task.id}>
                <td data-label="Task">
                  <p className="font-medium">{titleCase(task.task_type)}</p>
                  <p className="mt-0.5 max-w-[270px] text-[11px] text-muted-foreground">{task.detail}</p>
                </td>
                <td data-label="Reference" className="font-mono text-[11px]">{task.reference}</td>
                <td data-label="Location" className="font-mono text-[11px]">{task.location}</td>
                <td data-label="Assignee">{task.assignee}</td>
                <td data-label="Priority">
                  <Badge tone={task.priority === "high" ? "critical" : task.priority === "normal" ? "warning" : "neutral"}>
                    {titleCase(task.priority)}
                  </Badge>
                </td>
                <td data-label="Due" className="whitespace-nowrap text-[11px]">{dateTime(task.due_at)}</td>
                <td data-label="Status">
                  <Badge tone={statusTone(task.status)} dot>{titleCase(task.status)}</Badge>
                </td>
                <td data-label="Actions">
                  <div className="flex flex-wrap gap-1.5">
                    {task.status !== "done" && task.status !== "in_progress" && (
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => start(task)}>
                        <Play className="h-3 w-3" /> Start
                      </button>
                    )}
                    {task.status === "in_progress" && (
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => complete(task)}>
                        <CheckCircle2 className="h-3 w-3" /> Complete
                      </button>
                    )}
                    {task.status !== "done" && (
                      <>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => assignToMe(task)}>
                          <UserPlus className="h-3 w-3" /> Assign me
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm ${task.status === "blocked" ? "btn-secondary" : "btn-danger"}`}
                          onClick={() => toggleBlock(task)}
                        >
                          <Lock className="h-3 w-3" /> {task.status === "blocked" ? "Unblock" : "Block"}
                        </button>
                      </>
                    )}
                    {task.status === "done" && (
                      <span className="text-[10px] font-medium text-muted-foreground">No further action</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                  No tasks match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
