"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ClientTaskDetail } from "@/lib/clients/operations";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientTaskCardProps {
  task: ClientTaskDetail;
  clientId: string;
  onUpdate: () => void;
}

type TaskStatus = "todo" | "in_progress" | "complete";

const ASSIGNEE_STYLES: Record<string, { label: string; className: string }> = {
  pm: { label: "PM", className: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  nova: { label: "Nova", className: "bg-purple-500/15 text-purple-600 dark:text-purple-400" },
  monty: { label: "Monty", className: "bg-orange-500/15 text-orange-600 dark:text-orange-400" },
  client: { label: "Client", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
};

// ─── Status helpers ───────────────────────────────────────────────────────────

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  todo: "in_progress",
  in_progress: "complete",
  complete: "todo",
};

function StatusIcon({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  switch (status) {
    case "complete":
      return (
        <CheckCircle2
          className={cn("h-4 w-4 text-emerald-500 shrink-0", className)}
        />
      );
    case "in_progress":
      return (
        <CircleDot
          className={cn("h-4 w-4 text-blue-400 shrink-0", className)}
        />
      );
    default:
      return (
        <Circle
          className={cn(
            "h-4 w-4 text-muted-foreground/40 shrink-0",
            className,
          )}
        />
      );
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ClientTaskCard({
  task,
  clientId,
  onUpdate,
}: ClientTaskCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [localStatus, setLocalStatus] = useState(task.status);
  const [localSubtasks, setLocalSubtasks] = useState(task.subtasks);
  const [updating, setUpdating] = useState(false);

  const hasSubtasks = task.subtasks.length > 0;
  const isComplete = localStatus === "complete";
  const isInProgress = localStatus === "in_progress";
  const isBlocked = task.blockedBy.length > 0;

  // Overdue check
  const isOverdue =
    task.dueDate && new Date(task.dueDate) < new Date() && !isComplete;

  // ─── Toggle parent task status ────────────────────────────────────────

  async function handleToggleTask() {
    if (updating) return;

    const newStatus = NEXT_STATUS[localStatus as TaskStatus] ?? "todo";
    const previousStatus = localStatus;

    // Optimistic update
    setLocalStatus(newStatus);
    setUpdating(true);

    try {
      const res = await fetch(`/api/clients/${clientId}/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) throw new Error("Failed to update task");

      onUpdate();
    } catch {
      // Rollback
      setLocalStatus(previousStatus);
    } finally {
      setUpdating(false);
    }
  }

  // ─── Toggle subtask status ────────────────────────────────────────────

  async function handleToggleSubtask(subtaskId: string, currentStatus: string) {
    if (updating) return;

    const newStatus = NEXT_STATUS[currentStatus as TaskStatus] ?? "todo";
    const previousSubtasks = [...localSubtasks];

    // Optimistic update
    setLocalSubtasks((prev) =>
      prev.map((s) => (s.id === subtaskId ? { ...s, status: newStatus } : s)),
    );
    setUpdating(true);

    try {
      const res = await fetch(
        `/api/clients/${clientId}/tasks/${task.id}/subtasks/${subtaskId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        },
      );

      if (!res.ok) throw new Error("Failed to update subtask");

      // Auto-sync parent status from server response
      onUpdate();
    } catch {
      // Rollback
      setLocalSubtasks(previousSubtasks);
    } finally {
      setUpdating(false);
    }
  }

  // ─── Subtask progress text ────────────────────────────────────────────

  const completedSubtasks = localSubtasks.filter(
    (s) => s.status === "complete",
  ).length;
  const totalSubtasks = localSubtasks.length;

  return (
    <Card
      className={cn(
        "py-3 gap-1 transition-opacity",
        isComplete && "opacity-60",
      )}
    >
      <div className="px-4">
        {/* Main row */}
        <div className="flex items-start gap-2">
          {/* Status checkbox */}
          <button
            type="button"
            onClick={handleToggleTask}
            disabled={updating}
            className="mt-0.5 hover:scale-110 transition-transform disabled:opacity-50"
            aria-label={`Mark task as ${NEXT_STATUS[localStatus as TaskStatus]}`}
          >
            <StatusIcon status={localStatus} />
          </button>

          {/* Title + meta */}
          <div className="flex-1 min-w-0">
            <p
              className={cn(
                "text-sm font-medium leading-tight",
                isComplete && "line-through text-muted-foreground",
                isInProgress && "text-foreground/80",
              )}
            >
              {task.title}
            </p>

            {/* Meta row */}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {hasSubtasks && (
                <span className="text-xs text-muted-foreground">
                  {completedSubtasks}/{totalSubtasks} subtasks
                </span>
              )}

              {task.dueDate && (
                <span
                  className={cn(
                    "text-xs",
                    isOverdue
                      ? "text-red-500 font-medium"
                      : "text-muted-foreground",
                  )}
                >
                  {isOverdue ? "Overdue: " : "Due: "}
                  {new Date(task.dueDate).toLocaleDateString()}
                </span>
              )}

              {isBlocked && (
                <Badge variant="warning" size="xs" className="py-0">
                  <AlertTriangle className="h-3 w-3 mr-0.5" />
                  Blocked
                </Badge>
              )}

              {task.recurring && (
                <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-sky-500/15 text-sky-600 dark:text-sky-400">
                  {task.recurring === "weekly" ? "Weekly" : "Monthly"}
                </span>
              )}

              {task.assignee && ASSIGNEE_STYLES[task.assignee] && (
                <span
                  className={cn(
                    "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
                    ASSIGNEE_STYLES[task.assignee].className,
                  )}
                >
                  {ASSIGNEE_STYLES[task.assignee].label}
                </span>
              )}
            </div>
          </div>

          {/* Expand/collapse toggle */}
          {hasSubtasks && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="p-0.5 rounded hover:bg-muted transition-colors shrink-0"
              aria-label={expanded ? "Collapse subtasks" : "Expand subtasks"}
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Subtask list */}
      {expanded && hasSubtasks && (
        <div className="px-4 pt-1 pb-1 border-t border-border/50 mt-1">
          <div className="space-y-1.5 pl-6">
            {localSubtasks.map((subtask) => (
              <div key={subtask.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    handleToggleSubtask(subtask.id, subtask.status)
                  }
                  disabled={updating}
                  className="hover:scale-110 transition-transform disabled:opacity-50"
                  aria-label={`Mark subtask as ${NEXT_STATUS[subtask.status as TaskStatus]}`}
                >
                  <StatusIcon status={subtask.status} className="h-3.5 w-3.5" />
                </button>
                <span
                  className={cn(
                    "text-xs",
                    subtask.status === "complete"
                      ? "line-through text-muted-foreground"
                      : "text-foreground/90",
                  )}
                >
                  {subtask.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
