import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";

export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);

  const status = url.searchParams.get("status");
  const actionType = url.searchParams.get("actionType");
  const workspace = url.searchParams.get("workspace");
  const sender = url.searchParams.get("sender");
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "50")),
  );

  // Build where clause for actions list (all filters)
  const actionWhere: Record<string, unknown> = {};
  if (status) actionWhere.status = status;
  if (actionType) actionWhere.actionType = actionType;
  if (workspace) actionWhere.workspaceSlug = workspace;
  if (sender) actionWhere.senderId = sender;

  // Build where clause for counts (all filters except status)
  const countWhere: Record<string, unknown> = {};
  if (actionType) countWhere.actionType = actionType;
  if (workspace) countWhere.workspaceSlug = workspace;
  if (sender) countWhere.senderId = sender;

  // Fetch actions (filtered by all params) + status counts (filtered by workspace/sender/actionType only)
  const [actions, total, pendingCount, runningCount, completeCount, failedCount, cancelledCount, expiredCount] =
    await Promise.all([
      prisma.linkedInAction.findMany({
        where: actionWhere,
        include: {
          sender: {
            select: {
              id: true,
              name: true,
              workspaceSlug: true,
              status: true,
              healthStatus: true,
              dailyConnectionLimit: true,
              dailyMessageLimit: true,
              dailyProfileViewLimit: true,
            },
          },
        },
        orderBy: [{ priority: "asc" }, { scheduledFor: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.linkedInAction.count({ where: actionWhere }),
      prisma.linkedInAction.count({ where: { ...countWhere, status: "pending" } }),
      prisma.linkedInAction.count({ where: { ...countWhere, status: "running" } }),
      prisma.linkedInAction.count({ where: { ...countWhere, status: "complete" } }),
      prisma.linkedInAction.count({ where: { ...countWhere, status: "failed" } }),
      prisma.linkedInAction.count({ where: { ...countWhere, status: "cancelled" } }),
      prisma.linkedInAction.count({ where: { ...countWhere, status: "expired" } }),
    ]);

  // Collect unique personIds and batch-fetch person info
  const personIds = [...new Set(actions.map((a) => a.personId))];

  const people =
    personIds.length > 0
      ? await prisma.person.findMany({
          where: { id: { in: personIds } },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        })
      : [];

  const personMap = new Map(
    people.map((p) => [
      p.id,
      {
        email: p.email,
        name: [p.firstName, p.lastName].filter(Boolean).join(" ") || null,
      },
    ]),
  );

  // Attach person info to each action
  const enrichedActions = actions.map((action) => {
    const person = personMap.get(action.personId);
    return {
      ...action,
      personEmail: person?.email ?? null,
      personName: person?.name ?? null,
    };
  });

  const totalPages = Math.ceil(total / limit);
  const counts = {
    pending: pendingCount,
    running: runningCount,
    complete: completeCount,
    failed: failedCount,
    cancelled: cancelledCount,
    expired: expiredCount,
    total: pendingCount + runningCount + completeCount + failedCount + cancelledCount + expiredCount,
  };

  return NextResponse.json({
    actions: enrichedActions,
    counts,
    total,
    page,
    totalPages,
  });
}
