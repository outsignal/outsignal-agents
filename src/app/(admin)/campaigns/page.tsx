import { PageShell } from "@/components/layout/page-shell";
import { Pagination } from "@/components/ui/pagination";
import { prisma } from "@/lib/db";
import { CampaignFilters } from "@/components/campaigns/campaign-filters";
import {
  CampaignsTable,
  type CampaignRow,
} from "@/components/campaigns/campaigns-table";

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

  const [campaigns, totalCount, workspaces] = await Promise.all([
    prisma.campaign.findMany({
      where: whereClause,
      include: {
        workspace: {
          select: { name: true },
        },
        targetList: {
          select: {
            name: true,
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
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

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

  function buildHref(page: number) {
    return `/campaigns?${new URLSearchParams({
      ...(workspace ? { workspace } : {}),
      ...(status ? { status } : {}),
      page: String(page),
    }).toString()}`;
  }

  return (
    <PageShell
      title="Campaigns"
      description="All campaigns across workspaces"
      actions={<CampaignFilters workspaces={workspaces} />}
    >
      <div className="space-y-4">
        {/* Summary */}
        <div>
          <span className="text-xs text-muted-foreground">
            {totalCount} campaign{totalCount !== 1 ? "s" : ""}
            {totalPages > 1 && ` · Page ${currentPage} of ${totalPages}`}
          </span>
        </div>

        {/* Table */}
        <CampaignsTable campaigns={rows} />

        {/* Pagination */}
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={PAGE_SIZE}
          buildHref={buildHref}
        />
      </div>
    </PageShell>
  );
}
