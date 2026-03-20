"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { ChevronRight, Loader2, Play, Clock, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const AgentRunsPage = dynamic(() => import("@/app/(admin)/agent-runs/page"), {
  ssr: false,
  loading: () => <SectionLoader />,
});
const BackgroundTasksPage = dynamic(() => import("@/app/(admin)/background-tasks/page"), {
  ssr: false,
  loading: () => <SectionLoader />,
});
const LinkedInQueuePage = dynamic(() => import("@/app/(admin)/linkedin-queue/page"), {
  ssr: false,
  loading: () => <SectionLoader />,
});
const OOOQueuePage = dynamic(() => import("@/app/(admin)/ooo-queue/page"), {
  ssr: false,
  loading: () => <SectionLoader />,
});
const SignalsPage = dynamic(() => import("@/app/(admin)/signals/page"), {
  ssr: false,
  loading: () => <SectionLoader />,
});
const WebhookLogPage = dynamic(() => import("@/app/(admin)/webhook-log/page"), {
  ssr: false,
  loading: () => <SectionLoader />,
});

function SectionLoader() {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manual Triggers — task metadata
// ---------------------------------------------------------------------------

const TASKS = [
  { id: "bounce-monitor", label: "Bounce Monitor", type: "scheduled", schedule: "Daily 9am UTC" },
  { id: "campaign-deploy", label: "Campaign Deploy", type: "event", schedule: "On demand" },
  { id: "deliverability-digest", label: "Deliverability Digest", type: "scheduled", schedule: "Daily 4pm UTC" },
  { id: "domain-health", label: "Domain Health", type: "scheduled", schedule: "8am + 8pm UTC" },
  { id: "generate-suggestion", label: "Generate Suggestion", type: "event", schedule: "On reply" },
  { id: "generate-insights", label: "Generate Insights", type: "scheduled", schedule: "Daily 9am UTC" },
  { id: "inbox-check", label: "Inbox Check", type: "scheduled", schedule: "Every 15 min" },
  { id: "invoice-processor", label: "Invoice Processor", type: "scheduled", schedule: "Monthly 1st" },
  { id: "linkedin-fast-track", label: "LinkedIn Fast Track", type: "event", schedule: "On demand" },
  { id: "ooo-reengage", label: "OOO Re-engage", type: "scheduled", schedule: "Daily" },
  { id: "poll-replies", label: "Poll Replies", type: "scheduled", schedule: "Every 5 min" },
  { id: "postmaster-stats-sync", label: "Postmaster Sync", type: "scheduled", schedule: "Daily 10am UTC" },
  { id: "process-reply", label: "Process Reply", type: "event", schedule: "On webhook" },
  { id: "retry-classification", label: "Retry Classification", type: "scheduled", schedule: "Every 10 min" },
  { id: "smoke-test", label: "Smoke Test", type: "scheduled", schedule: "Daily 8am UTC" },
  { id: "sync-senders", label: "Sync Inboxes", type: "scheduled", schedule: "Daily 8am UTC" },
] as const;

// ---------------------------------------------------------------------------
// Manual Triggers section component
// ---------------------------------------------------------------------------

function ManualTriggersSection() {
  const [loadingTask, setLoadingTask] = useState<string | null>(null);
  const [cooldowns, setCooldowns] = useState<Record<string, boolean>>({});

  const triggerTask = useCallback(async (taskId: string, label: string) => {
    setLoadingTask(taskId);
    try {
      const res = await fetch("/api/admin/tasks/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to trigger task");
        return;
      }
      toast.success(`${label} triggered successfully`);
      // 5-second cooldown to prevent double-clicks
      setCooldowns((prev) => ({ ...prev, [taskId]: true }));
      setTimeout(() => {
        setCooldowns((prev) => ({ ...prev, [taskId]: false }));
      }, 5000);
    } catch {
      toast.error("Network error — failed to trigger task");
    } finally {
      setLoadingTask(null);
    }
  }, []);

  return (
    <div className="p-4 space-y-4">
      <div>
        <h3 className="text-sm font-medium">Manual Triggers</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Manually run background tasks on demand
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="pb-2 pr-4 font-medium text-muted-foreground">Task</th>
              <th className="pb-2 pr-4 font-medium text-muted-foreground">Type</th>
              <th className="pb-2 pr-4 font-medium text-muted-foreground">Schedule</th>
              <th className="pb-2 font-medium text-muted-foreground text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {TASKS.map((task) => {
              const isLoading = loadingTask === task.id;
              const isCooldown = cooldowns[task.id];
              const isDisabled = isLoading || isCooldown;

              return (
                <tr key={task.id} className="border-b border-border/50 last:border-0">
                  <td className="py-2.5 pr-4 font-medium">{task.label}</td>
                  <td className="py-2.5 pr-4">
                    <Badge
                      variant={task.type === "scheduled" ? "secondary" : "outline"}
                      className={cn(
                        "text-xs",
                        task.type === "event" && "border-[#635BFF]/30 text-[#635BFF] bg-[#635BFF]/10",
                      )}
                    >
                      {task.type === "scheduled" ? (
                        <Clock className="mr-1 h-3 w-3" />
                      ) : (
                        <Zap className="mr-1 h-3 w-3" />
                      )}
                      {task.type}
                    </Badge>
                  </td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{task.schedule}</td>
                  <td className="py-2.5 text-right">
                    <ConfirmDialog
                      trigger={
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isDisabled}
                          className="h-7 px-2.5 text-xs"
                        >
                          {isLoading ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          ) : (
                            <Play className="mr-1 h-3 w-3" />
                          )}
                          {isCooldown ? "Triggered" : "Run Now"}
                        </Button>
                      }
                      title={`Run ${task.label}?`}
                      description="This will manually trigger the task immediately."
                      confirmLabel="Run Now"
                      onConfirm={() => triggerTask(task.id, task.label)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible sections
// ---------------------------------------------------------------------------

const SECTIONS = [
  { key: "agent-runs", label: "Agent Runs", Component: AgentRunsPage },
  { key: "background-tasks", label: "Background Tasks", Component: BackgroundTasksPage },
  { key: "linkedin-queue", label: "LinkedIn Queue", Component: LinkedInQueuePage },
  { key: "manual-triggers", label: "Manual Triggers", Component: ManualTriggersSection },
  { key: "ooo-queue", label: "OOO Queue", Component: OOOQueuePage },
  { key: "signals", label: "Signals", Component: SignalsPage },
  { key: "webhook-log", label: "Webhook Log", Component: WebhookLogPage },
] as const;

export default function OperationsTab() {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    "agent-runs": true,
  });

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-3">
      {SECTIONS.map(({ key, label, Component }) => (
        <div key={key} className="rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => toggleSection(key)}
            className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors cursor-pointer"
          >
            <ChevronRight
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform duration-150",
                openSections[key] && "rotate-90",
              )}
            />
            {label}
          </button>
          {openSections[key] && (
            <div className="border-t border-border">
              <Component />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
