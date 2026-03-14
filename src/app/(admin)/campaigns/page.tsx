import Link from "next/link";
import { Megaphone } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { CampaignFilters } from "@/components/campaigns/campaign-filters";

export const dynamic = "force-dynamic";

// ─── Status color map (matches campaign detail page) ────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-700 text-zinc-300",
  internal_review: "bg-purple-900/60 text-purple-300",
  pending_approval: "bg-amber-900/60 text-amber-300",
  approved: "bg-emerald-900/60 text-emerald-300",
  deployed: "bg-blue-900/60 text-blue-300",
  active: "bg-emerald-900/60 text-emerald-300",
  paused: "bg-yellow-900/60 text-yellow-300",
  completed: "bg-zinc-600 text-zinc-300",
  archived: "bg-zinc-800 text-zinc-400",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseChannels(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : ["email"];
  } catch {
    return ["email"];
  }
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

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

  return (
    <div>
      <Header
        title="Campaigns"
        description="All campaigns across workspaces"
        actions={<CampaignFilters workspaces={workspaces} />}
      />

      <div className="p-6 space-y-6">
        {/* Summary */}
        <div className="mb-6">
          <span className="text-xs text-muted-foreground">
            {totalCount} campaign{totalCount !== 1 ? "s" : ""}
            {totalPages > 1 && ` · Page ${currentPage} of ${totalPages}`}
          </span>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Workspace</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="hidden md:table-cell">Channels</TableHead>
                  <TableHead className="hidden md:table-cell">Target List</TableHead>
                  <TableHead className="hidden md:table-cell">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.length > 0 ? (
                  campaigns.map((campaign) => {
                    const channels = parseChannels(campaign.channels);
                    const leadCount =
                      campaign.targetList?._count.people ?? 0;

                    return (
                      <TableRow key={campaign.id} className="border-border">
                        <TableCell>
                          <Link
                            href={`/campaigns/${campaign.id}`}
                            className="font-medium text-sm hover:underline"
                          >
                            {campaign.name}
                          </Link>
                          {campaign.type === "signal" && campaign.dailyLeadCap && (
                            <p className="text-xs text-muted-foreground/60 mt-0.5">
                              Cap: {campaign.dailyLeadCap}/day
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <Link
                            href={`/workspace/${campaign.workspaceSlug}`}
                            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                          >
                            {campaign.workspace.name}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={`text-xs capitalize ${STATUS_COLORS[campaign.status] ?? ""}`}
                          >
                            {campaign.status.replace(/_/g, " ")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {campaign.type === "signal" ? (
                            <Badge className="bg-[#F0FF7A]/20 text-[#F0FF7A] text-xs">
                              Signal
                            </Badge>
                          ) : (
                            <Badge className="bg-zinc-700 text-zinc-300 text-xs">
                              Static
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <div className="flex gap-1">
                            {channels.map((ch) => (
                              <Badge
                                key={ch}
                                variant="secondary"
                                size="xs"
                                className="capitalize"
                              >
                                {ch}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {campaign.targetList ? (
                            <span className="text-xs text-muted-foreground">
                              {campaign.targetList.name}
                              <span className="ml-1 text-muted-foreground/60">
                                ({leadCount.toLocaleString()})
                              </span>
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/50">
                              --
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                          {formatDate(campaign.createdAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-12 text-center text-muted-foreground"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <Megaphone className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
                        <p className="text-sm">
                          No campaigns yet. Create one from a workspace page.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            {currentPage > 1 && (
              <Link
                href={`/campaigns?${new URLSearchParams({
                  ...(workspace ? { workspace } : {}),
                  ...(status ? { status } : {}),
                  page: String(currentPage - 1),
                }).toString()}`}
                className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-muted transition-colors"
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
                    className="px-1 text-xs text-muted-foreground"
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
                        ? "bg-foreground text-background border-foreground"
                        : "border-border hover:bg-muted"
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
                className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-muted transition-colors"
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
