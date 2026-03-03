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

export default async function CampaignsPage() {
  const campaigns = await prisma.campaign.findMany({
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
  });

  return (
    <div>
      <Header
        title="Campaigns"
        description="All campaigns across workspaces"
      />

      <div className="p-8">
        {/* Summary */}
        <div className="mb-6">
          <span className="text-xs text-muted-foreground">
            {campaigns.length} campaign{campaigns.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Channels</TableHead>
                  <TableHead>Target List</TableHead>
                  <TableHead>Created</TableHead>
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
                        </TableCell>
                        <TableCell>
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
                          <div className="flex gap-1">
                            {channels.map((ch) => (
                              <Badge
                                key={ch}
                                variant="secondary"
                                className="text-[10px] capitalize"
                              >
                                {ch}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
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
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(campaign.createdAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-12 text-center text-muted-foreground"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <Megaphone className="h-8 w-8 text-muted-foreground/40" />
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
      </div>
    </div>
  );
}
