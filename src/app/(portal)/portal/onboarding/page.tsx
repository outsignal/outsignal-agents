import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { CheckCircle2, CheckCircle, Circle, AlertCircle, Clock } from "lucide-react";

const STAGE_LABELS: Record<string, string> = {
  onboarding: "Onboarding",
  campaign_setup: "Campaign Setup",
  campaign_launch: "Campaign Launch",
  customer_success: "Customer Success",
};

const STAGE_ORDER = ["onboarding", "campaign_setup", "campaign_launch", "customer_success"];

function formatDate(date: Date | null): string | null {
  if (!date) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function isOverdue(date: Date | null): boolean {
  if (!date) return false;
  return date < new Date();
}

export default async function PortalOnboardingPage() {
  let session;
  try {
    session = await getPortalSession();
  } catch {
    redirect("/portal/login");
  }
  const { workspaceSlug } = session;

  const client = await prisma.client.findFirst({
    where: { workspaceSlug },
    select: { id: true, name: true },
  });

  if (!client) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900">Onboarding Progress</h1>
          <p className="text-sm text-stone-500 mt-1">
            Track your onboarding and campaign setup progress
          </p>
        </div>
        <EmptyState
          icon={Circle}
          title="No onboarding data yet"
          description="Your onboarding tasks will appear here once your account is set up."
        />
      </div>
    );
  }

  const tasks = await prisma.clientTask.findMany({
    where: { clientId: client.id },
    orderBy: [{ stage: "asc" }, { order: "asc" }],
    select: {
      id: true,
      stage: true,
      title: true,
      status: true,
      order: true,
      dueDate: true,
    },
  });

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === "complete").length;
  const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const allComplete = totalTasks > 0 && completedTasks === totalTasks;

  // Group by stage
  const stageMap = new Map<string, typeof tasks>();
  for (const task of tasks) {
    const existing = stageMap.get(task.stage) ?? [];
    existing.push(task);
    stageMap.set(task.stage, existing);
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-stone-900">Onboarding Progress</h1>
        <p className="text-sm text-stone-500 mt-1">
          Track your onboarding and campaign setup progress
        </p>
      </div>

      {/* All tasks complete */}
      {allComplete ? (
        <EmptyState
          icon={CheckCircle}
          title="All tasks complete"
          description="Your onboarding is fully complete. Your campaigns are live."
        />
      ) : (
        <>
          {/* Overall Progress */}
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Overall Progress</p>
                  <p className="text-sm font-mono text-stone-500 tabular-nums">
                    {completedTasks} / {totalTasks} tasks completed
                  </p>
                </div>
                <div className="h-3 w-full rounded-full bg-stone-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="text-xs font-mono text-stone-500 text-right tabular-nums">
                  {progressPct}%
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Stage Cards */}
          <div className="grid gap-4">
            {STAGE_ORDER.filter((s) => stageMap.has(s)).map((stage) => {
              const stageTasks = stageMap.get(stage)!;
              const stageCompleted = stageTasks.filter((t) => t.status === "complete").length;
              const stageTotal = stageTasks.length;

              return (
                <Card key={stage}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="font-heading text-lg">
                        {STAGE_LABELS[stage] ?? stage}
                      </CardTitle>
                      <span className="text-xs font-mono text-stone-500 tabular-nums">
                        {stageCompleted} / {stageTotal}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-3">
                      {stageTasks.map((task) => {
                        const completed = task.status === "complete";
                        const inProgress = task.status === "in_progress";
                        const overdue = !completed && !inProgress && isOverdue(task.dueDate);
                        const dueDateStr = formatDate(task.dueDate);

                        return (
                          <li key={task.id} className="flex items-start gap-3">
                            {completed ? (
                              <CheckCircle2 className="h-5 w-5 text-emerald-500 mt-0.5 shrink-0" />
                            ) : inProgress ? (
                              <Clock className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                            ) : overdue ? (
                              <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
                            ) : (
                              <Circle className="h-5 w-5 text-stone-400 mt-0.5 shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p
                                className={`text-sm ${
                                  completed
                                    ? "text-stone-400 line-through"
                                    : inProgress
                                      ? "text-amber-700 font-medium"
                                      : "text-stone-900"
                                }`}
                              >
                                {task.title}
                              </p>
                              {dueDateStr && (
                                <p
                                  className={`text-xs font-mono mt-0.5 ${
                                    overdue ? "text-red-500 font-medium" : "text-stone-500"
                                  }`}
                                >
                                  {overdue ? "Overdue" : "Due"}: {dueDateStr}
                                </p>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
