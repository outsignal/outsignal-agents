import Link from "next/link";
import { Header } from "@/components/layout/header";
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

  return (
    <div>
      <Header
        title="Campaigns"
        description="All campaigns across workspaces"
        actions={<CampaignFilters workspaces={workspaces} />}
      />

      <div className="p-6 space-y-4">
        {/* Summary */}
        <div>
          <span className="text-xs text-stone-500">
            {totalCount} campaign{totalCount !== 1 ? "s" : ""}
            {totalPages > 1 && ` · Page ${currentPage} of ${totalPages}`}
          </span>
        </div>

        {/* Table */}
        <CampaignsTable campaigns={rows} />

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            {currentPage > 1 && (
              <Link
                href={`/campaigns?${new URLSearchParams({
                  ...(workspace ? { workspace } : {}),
                  ...(status ? { status } : {}),
                  page: String(currentPage - 1),
                }).toString()}`}
                className="px-3 py-1.5 text-xs rounded-md border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
              >
                Previous
              </Link>
            )}
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(
                (p) =>
                  p === 1 ||
                  p === totalPages ||
                  Math.abs(p - currentPage) <= 1,
              )
              .reduce<(number | "...")[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] ?? 0) > 1) acc.push("...");
                acc.push(p);
                return acc;
              }, [])
              .map((p, idx) =>
                p === "..." ? (
                  <span
                    key={`ellipsis-${idx}`}
                    className="px-1 text-xs text-stone-400"
                  >
                    ...
                  </span>
                ) : (
                  <Link
                    key={p}
                    href={`/campaigns?${new URLSearchParams({
                      ...(workspace ? { workspace } : {}),
                      ...(status ? { status } : {}),
                      page: String(p),
                    }).toString()}`}
                    className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                      p === currentPage
                        ? "bg-stone-900 text-white border-stone-900"
                        : "border-stone-200 text-stone-600 hover:bg-stone-50"
                    }`}
                  >
                    {p}
                  </Link>
                ),
              )}
            {currentPage < totalPages && (
              <Link
                href={`/campaigns?${new URLSearchParams({
                  ...(workspace ? { workspace } : {}),
                  ...(status ? { status } : {}),
                  page: String(currentPage + 1),
                }).toString()}`}
                className="px-3 py-1.5 text-xs rounded-md border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
              >
                Next
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
