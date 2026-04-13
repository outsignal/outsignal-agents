"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Subtask {
  id: string;
  status: string;
}

interface TaskClient {
  id: string;
  name: string;
}

interface Task {
  id: string;
  title: string;
  stage: string;
  status: string;
  assignee: string;
  dueDate: string | null;
  notes: string | null;
  client: TaskClient;
  subtasks: Subtask[];
}

interface TasksOverviewTableProps {
  tasks: Task[];
}

// ─── Mappings ───────────────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  onboarding: "Onboarding",
  campaign_setup: "Setup",
  campaign_launch: "Launch",
  customer_success: "Success",
};

const STAGE_VARIANTS: Record<string, "info" | "purple" | "brand" | "success"> = {
  onboarding: "info",
  campaign_setup: "purple",
  campaign_launch: "brand",
  customer_success: "success",
};

const STATUS_LABELS: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  complete: "Complete",
};

const STATUS_VARIANTS: Record<string, "secondary" | "warning" | "success"> = {
  todo: "secondary",
  in_progress: "warning",
  complete: "success",
};

const ASSIGNEE_LABELS: Record<string, string> = {
  pm: "PM",
  nova: "Nova",
  monty: "Monty",
  client: "Client",
};

const ASSIGNEE_VARIANTS: Record<string, "info" | "purple" | "warning" | "success"> = {
  pm: "info",
  nova: "purple",
  monty: "warning",
  client: "success",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function isOverdue(task: Task): boolean {
  return !!(
    task.dueDate &&
    new Date(task.dueDate) < new Date() &&
    task.status !== "complete"
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ─── Component ──────────────────────────────────────────────────────────────

export function TasksOverviewTable({ tasks }: TasksOverviewTableProps) {
  const [stageFilter, setStageFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);

  // Unique client names for filter dropdown
  const clientNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const t of tasks) {
      names.set(t.client.id, t.client.name);
    }
    return Array.from(names.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => ({ id, name }));
  }, [tasks]);

  // Filtered tasks
  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (stageFilter !== "all" && t.stage !== stageFilter) return false;
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (clientFilter !== "all" && t.client.id !== clientFilter) return false;
      if (assigneeFilter !== "all" && t.assignee !== assigneeFilter) return false;
      if (overdueOnly && !isOverdue(t)) return false;
      return true;
    });
  }, [tasks, stageFilter, statusFilter, clientFilter, assigneeFilter, overdueOnly]);

  // KPI counts (from filtered set)
  const counts = useMemo(() => {
    let todo = 0;
    let inProgress = 0;
    let complete = 0;
    let overdue = 0;
    for (const t of filtered) {
      if (t.status === "todo") todo++;
      else if (t.status === "in_progress") inProgress++;
      else if (t.status === "complete") complete++;
      if (isOverdue(t)) overdue++;
    }
    return { todo, inProgress, complete, overdue };
  }, [filtered]);

  // Unique client count
  const uniqueClientCount = useMemo(() => {
    return new Set(filtered.map((t) => t.client.id)).size;
  }, [filtered]);

  return (
    <div>
      {/* Header */}
      <header className="flex flex-col gap-3 border-b border-border/50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Tasks</h1>
          <p className="text-sm text-muted-foreground">
            {filtered.length} task{filtered.length !== 1 ? "s" : ""} across{" "}
            {uniqueClientCount} client{uniqueClientCount !== 1 ? "s" : ""}
          </p>
        </div>

        {/* KPI chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            {counts.todo} To Do
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
            {counts.inProgress} In Progress
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
            {counts.complete} Complete
          </span>
          {counts.overdue > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-400">
              {counts.overdue} Overdue
            </span>
          )}
        </div>
      </header>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-8">
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Stage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stages</SelectItem>
            <SelectItem value="onboarding">Onboarding</SelectItem>
            <SelectItem value="campaign_setup">Campaign Setup</SelectItem>
            <SelectItem value="campaign_launch">Campaign Launch</SelectItem>
            <SelectItem value="customer_success">Customer Success</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="todo">To Do</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="complete">Complete</SelectItem>
          </SelectContent>
        </Select>

        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Client" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Clients</SelectItem>
            {clientNames.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Assignee" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Assignees</SelectItem>
            <SelectItem value="pm">PM</SelectItem>
            <SelectItem value="nova">Nova</SelectItem>
            <SelectItem value="monty">Monty</SelectItem>
            <SelectItem value="client">Client</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant={overdueOnly ? "destructive" : "outline"}
          size="sm"
          onClick={() => setOverdueOnly((v) => !v)}
        >
          Overdue only
        </Button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <CheckSquare className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="mt-4 text-sm font-medium">No tasks found</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Tasks are auto-created when clients move to active status
          </p>
        </div>
      ) : (
        <div className="mx-4 rounded-lg border border-border overflow-hidden sm:mx-8">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Subtasks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((task) => {
                const overdue = isOverdue(task);
                const completedSubtasks = task.subtasks.filter(
                  (s) => s.status === "complete"
                ).length;
                const totalSubtasks = task.subtasks.length;
                const progressPercent =
                  totalSubtasks > 0
                    ? Math.round((completedSubtasks / totalSubtasks) * 100)
                    : 0;

                return (
                  <TableRow key={task.id}>
                    {/* Client */}
                    <TableCell>
                      <Link
                        href={`/clients/${task.client.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {task.client.name}
                      </Link>
                    </TableCell>

                    {/* Task title */}
                    <TableCell className="text-sm max-w-[280px] truncate">
                      {task.title}
                    </TableCell>

                    {/* Stage */}
                    <TableCell>
                      <Badge
                        variant={STAGE_VARIANTS[task.stage] ?? "secondary"}
                        size="xs"
                      >
                        {STAGE_LABELS[task.stage] ?? task.stage}
                      </Badge>
                    </TableCell>

                    {/* Status */}
                    <TableCell>
                      <Badge
                        variant={STATUS_VARIANTS[task.status] ?? "secondary"}
                        size="xs"
                      >
                        {STATUS_LABELS[task.status] ?? task.status}
                      </Badge>
                    </TableCell>

                    {/* Assignee */}
                    <TableCell>
                      <Badge
                        variant={ASSIGNEE_VARIANTS[task.assignee] ?? "secondary"}
                        size="xs"
                      >
                        {ASSIGNEE_LABELS[task.assignee] ?? task.assignee}
                      </Badge>
                    </TableCell>

                    {/* Due Date */}
                    <TableCell>
                      {task.dueDate ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={cn(
                              "text-sm",
                              overdue && "text-red-600 dark:text-red-400"
                            )}
                          >
                            {formatDate(task.dueDate)}
                          </span>
                          {overdue && (
                            <Badge variant="destructive" size="xs">
                              Overdue
                            </Badge>
                          )}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">--</span>
                      )}
                    </TableCell>

                    {/* Subtasks */}
                    <TableCell>
                      {totalSubtasks > 0 ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {completedSubtasks}/{totalSubtasks}
                          </span>
                          <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                              style={{ width: `${progressPercent}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">--</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
