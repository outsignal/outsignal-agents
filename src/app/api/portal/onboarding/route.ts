import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";

// GET /api/portal/onboarding — returns onboarding tasks for the authenticated portal user's workspace
export async function GET() {
  try {
    const { workspaceSlug } = await getPortalSession();

    const client = await prisma.client.findFirst({
      where: { workspaceSlug },
      select: {
        id: true,
        name: true,
        startedAt: true,
      },
    });

    if (!client) {
      return NextResponse.json({ client: null, stages: [] });
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

    // Group tasks by stage
    const stageOrder = ["onboarding", "campaign_setup", "campaign_launch", "customer_success"];
    const stageMap = new Map<string, typeof tasks>();

    for (const task of tasks) {
      const existing = stageMap.get(task.stage) ?? [];
      existing.push(task);
      stageMap.set(task.stage, existing);
    }

    const stages = stageOrder
      .filter((s) => stageMap.has(s))
      .map((stage) => {
        const stageTasks = stageMap.get(stage)!;
        const completed = stageTasks.filter((t) => t.status === "complete").length;
        return {
          stage,
          tasks: stageTasks,
          total: stageTasks.length,
          completed,
        };
      });

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((t) => t.status === "complete").length;

    return NextResponse.json({
      client: { id: client.id, name: client.name, startedAt: client.startedAt },
      totalTasks,
      completedTasks,
      stages,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    if (
      message === "No portal session cookie" ||
      message === "Invalid or expired portal session"
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[GET /api/portal/onboarding] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch onboarding data" },
      { status: 500 },
    );
  }
}
