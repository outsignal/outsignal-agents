"use client";

import { useState, useCallback } from "react";
import { Eye, EyeOff, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { STAGES } from "@/lib/clients/task-templates";
import type { ClientTaskDetail } from "@/lib/clients/operations";
import { ClientTaskCard } from "./client-task-card";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientTaskBoardProps {
  tasks: ClientTaskDetail[];
  clientId: string;
  onTaskUpdate: () => void;
}

// ─── Column component ─────────────────────────────────────────────────────────

function StageColumn({
  stage,
  label,
  tasks,
  clientId,
  onTaskUpdate,
  hideCompleted,
}: {
  stage: string;
  label: string;
  tasks: ClientTaskDetail[];
  clientId: string;
  onTaskUpdate: () => void;
  hideCompleted: boolean;
}) {
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const completedCount = tasks.filter((t) => t.status === "complete").length;
  const totalCount = tasks.length;
  const progressPercent =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const visibleTasks = hideCompleted
    ? tasks.filter((t) => t.status !== "complete")
    : tasks;

  async function handleAddTask() {
    if (!newTaskTitle.trim() || submitting) return;

    setSubmitting(true);

    try {
      const res = await fetch(`/api/clients/${clientId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage, title: newTaskTitle.trim() }),
      });

      if (!res.ok) throw new Error("Failed to add task");

      setNewTaskTitle("");
      setAddingTask(false);
      onTaskUpdate();
    } catch {
      // Could show an error toast here
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddTask();
    }
    if (e.key === "Escape") {
      setAddingTask(false);
      setNewTaskTitle("");
    }
  }

  return (
    <div className="flex flex-col min-h-0">
      {/* Column header */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-sm font-semibold tracking-tight">{label}</h3>
          <span className="text-xs text-muted-foreground">
            {completedCount}/{totalCount}
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Task cards */}
      <div className="space-y-2 flex-1">
        {visibleTasks.map((task) => (
          <ClientTaskCard
            key={task.id}
            task={task}
            clientId={clientId}
            onUpdate={onTaskUpdate}
          />
        ))}

        {visibleTasks.length === 0 && (
          <p className="text-xs text-muted-foreground/60 text-center py-4">
            {tasks.length > 0 ? "All tasks complete" : "No tasks yet"}
          </p>
        )}
      </div>

      {/* Add task */}
      <div className="mt-2">
        {addingTask ? (
          <div className="flex items-center gap-1.5">
            <Input
              autoFocus
              placeholder="Task title..."
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-8 text-sm"
            />
            <Button
              size="xs"
              onClick={handleAddTask}
              disabled={!newTaskTitle.trim() || submitting}
            >
              Add
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setAddingTask(false);
                setNewTaskTitle("");
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground hover:text-foreground"
            onClick={() => setAddingTask(true)}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add task
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Board component ──────────────────────────────────────────────────────────

export function ClientTaskBoard({
  tasks,
  clientId,
  onTaskUpdate,
}: ClientTaskBoardProps) {
  const [hideCompleted, setHideCompleted] = useState(true);

  // Group tasks by stage
  const tasksByStage = useCallback(() => {
    const grouped: Record<string, ClientTaskDetail[]> = {};
    for (const stage of STAGES) {
      grouped[stage.value] = [];
    }
    for (const task of tasks) {
      if (grouped[task.stage]) {
        grouped[task.stage].push(task);
      }
    }
    return grouped;
  }, [tasks])();

  return (
    <>
      {/* Toggle bar */}
      <div className="flex justify-end mb-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setHideCompleted((prev) => !prev)}
          className="text-xs text-muted-foreground hover:text-foreground gap-1.5"
        >
          {hideCompleted ? (
            <>
              <Eye className="h-3.5 w-3.5" />
              Show completed
            </>
          ) : (
            <>
              <EyeOff className="h-3.5 w-3.5" />
              Hide completed
            </>
          )}
        </Button>
      </div>

      {/* Desktop: 4-column grid (xl) / 2-column (lg) */}
      <div className="hidden lg:grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
        {STAGES.map((stage) => (
          <div
            key={stage.value}
            className="rounded-lg bg-muted/30 p-3 border border-border/30"
          >
            <StageColumn
              stage={stage.value}
              label={stage.label}
              tasks={tasksByStage[stage.value] ?? []}
              clientId={clientId}
              onTaskUpdate={onTaskUpdate}
              hideCompleted={hideCompleted}
            />
          </div>
        ))}
      </div>

      {/* Mobile/tablet: tabs */}
      <div className="lg:hidden">
        <Tabs defaultValue="onboarding">
          <TabsList className="w-full">
            {STAGES.map((stage) => {
              const stageTasks = tasksByStage[stage.value] ?? [];
              const completed = stageTasks.filter(
                (t) => t.status === "complete",
              ).length;
              return (
                <TabsTrigger key={stage.value} value={stage.value}>
                  {stage.label}
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    {completed}/{stageTasks.length}
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>

          {STAGES.map((stage) => (
            <TabsContent key={stage.value} value={stage.value}>
              <div className="rounded-lg bg-muted/30 p-3 border border-border/30">
                <StageColumn
                  stage={stage.value}
                  label={stage.label}
                  tasks={tasksByStage[stage.value] ?? []}
                  clientId={clientId}
                  onTaskUpdate={onTaskUpdate}
                  hideCompleted={hideCompleted}
                />
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </>
  );
}
