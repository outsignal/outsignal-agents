import { Pagination } from "@/components/ui/pagination";
import { prisma } from "@/lib/db";
import { CampaignFilters } from "@/components/campaigns/campaign-filters";
import {
  CampaignsTable,
  type CampaignRow,
} from "@/components/campaigns/campaigns-table";
import { MetricCard } from "@/components/dashboard/metric-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Megaphone } from "lucide-react";

export const dynamic = "force-dynamic";

// ─── Page ───────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

interface CampaignsPageProps {
  searchParams: Promise<{ workspace?: string; status?: string; page?: string }>;
}

export default async function CampaignsPage({
  searchParams,
}: CampaignsPageProps) {
  const { workspace, status, page } = await searchParams;

  const workspaceFilter = workspace && workspace !== "all" ? workspace : undefined;
  const statusFilter = status && status !== "all" ? status : undefined;
  const currentPage = Math.max(1, parseInt(page ?? "1", 10) || 1);
  const skip = (currentPage - 1) * PAGE_SIZE;

  const whereClause = {
    ...(workspaceFilter ? { workspaceSlug: workspaceFilter } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
  };

  const [campaigns, totalCount, workspaces, statusCounts] = await Promise.all([
    prisma.campaign.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        status: true,
        type: true,
        workspaceSlug: true,
        dailyLeadCap: true,
        updatedAt: true,
        createdAt: true,
        workspace: {
          select: { name: true },
        },
        targetList: {
          select: {
            _count: { select: { people: true } },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      skip,
      take: PAGE_SIZE,
    }),
    prisma.campaign.count({ where: whereClause }),
    prisma.workspace.findMany({
      select: { slug: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.campaign.groupBy({
      by: ["status"],
      _count: { _all: true },
      ...(workspaceFilter ? { where: { workspaceSlug: workspaceFilter } } : {}),
    }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Build status count map
  const countByStatus: Record<string, number> = {};
  let allCount = 0;
  for (const s of statusCounts) {
    countByStatus[s.status] = s._count._all;
    allCount += s._count._all;
  }

  const activeCount = countByStatus["active"] ?? 0;
  const pausedCount = countByStatus["paused"] ?? 0;
  const pendingCount = countByStatus["pending_approval"] ?? 0;
  const completedCount = countByStatus["completed"] ?? 0;

  // Serialize for client component
  const rows: CampaignRow[] = campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    type: c.type,
    workspaceSlug: c.workspaceSlug,
    workspaceName: c.workspace.name,
    leadCount: c.targetList?._count.people ?? 0,
    dailyLeadCap: c.dailyLeadCap,
    updatedAt: c.updatedAt.toISOString(),
    createdAt: c.createdAt.toISOString(),
  }));

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex flex-col gap-3 border-b border-border/50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-5">
        <div className="min-w-0">
          <h1 className="text-xl font-medium text-foreground flex items-center gap-2">
            Campaigns
            {pendingCount > 0 && (
              <span className="inline-flex items-center justify-center rounded-full bg-[#635BFF] px-2 py-0.5 text-xs font-semibold text-white leading-none">
                {pendingCount} Pending
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {pendingCount > 0
              ? `${pendingCount} campaign${pendingCount !== 1 ? "s" : ""} pending approval`
              : `${allCount} campaign${allCount !== 1 ? "s" : ""} across ${workspaces.length} workspace${workspaces.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <CampaignFilters workspaces={workspaces} />
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 min-h-0 p-6 space-y-6 overflow-auto">
        {/* Metric cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <MetricCard
            label="Total Campaigns"
            value={allCount}
            icon="Megaphone"
            density="compact"
            accentColor="#635BFF"
          />
          <MetricCard
            label="Active"
            value={activeCount}
            icon="Activity"
            density="compact"
            accentColor="#10b981"
            detail={allCount > 0 ? `${((activeCount / allCount) * 100).toFixed(0)}% of total` : undefined}
          />
          <MetricCard
            label="Paused"
            value={pausedCount}
            icon="AlertTriangle"
            density="compact"
            accentColor="#f59e0b"
          />
          <MetricCard
            label="Pending Approval"
            value={pendingCount}
            icon="Eye"
            density="compact"
            accentColor={pendingCount > 0 ? "#ef4444" : "#94a3b8"}
          />
          <MetricCard
            label="Completed"
            value={completedCount}
            icon="CheckCircle"
            density="compact"
            accentColor="#6366f1"
          />
        </div>

        {/* Table or empty state */}
        {rows.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="No campaigns found"
            description={
              workspaceFilter || statusFilter
                ? "No campaigns match your current filters. Try adjusting the workspace or status filter."
                : "Create your first campaign to start generating replies."
            }
          />
        ) : (
          <div className="space-y-4">
            {/* Result count */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Showing{" "}
                <span className="font-medium text-foreground">
                  {totalCount}
                </span>{" "}
                result{totalCount !== 1 ? "s" : ""}
                {totalPages > 1 && (
                  <span>
                    {" "}&middot; Page {currentPage} of {totalPages}
                  </span>
                )}
              </span>
            </div>

            {/* Table */}
            <CampaignsTable campaigns={rows} />

            {/* Pagination */}
            {totalPages > 1 && (
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalCount={totalCount}
                pageSize={PAGE_SIZE}
                basePath="/campaigns"
                searchParams={{
                  ...(workspace ? { workspace } : {}),
                  ...(status ? { status } : {}),
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
