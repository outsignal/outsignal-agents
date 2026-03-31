import { prisma } from "@/lib/db";
import { WorkspacesTable, type WorkspaceRow } from "@/components/workspaces/workspaces-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Building2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function WorkspacesPage() {
  const workspaces = await prisma.workspace.findMany({
    select: {
      slug: true,
      name: true,
      vertical: true,
      status: true,
      package: true,
      type: true,
      createdAt: true,
      _count: {
        select: {
          campaigns: true,
          members: true,
        },
      },
      senders: {
        select: { channel: true },
      },
    },
    orderBy: { name: "asc" },
  });

  // Batch-query last login across all members for activity tracking
  const memberActivity = await prisma.member.findMany({
    where: {
      lastLoginAt: { not: null },
      status: "active",
    },
    select: {
      workspaceSlug: true,
      lastLoginAt: true,
    },
    orderBy: { lastLoginAt: "desc" },
  });

  // Build a map of workspace slug -> most recent login
  const lastActivityByWorkspace = new Map<string, Date>();
  for (const m of memberActivity) {
    if (m.lastLoginAt && !lastActivityByWorkspace.has(m.workspaceSlug)) {
      lastActivityByWorkspace.set(m.workspaceSlug, m.lastLoginAt);
    }
  }

  const rows: WorkspaceRow[] = workspaces.map((w) => {
    const lastLogin = lastActivityByWorkspace.get(w.slug);

    return {
      slug: w.slug,
      name: w.name,
      vertical: w.vertical,
      status: w.status,
      package: w.package,
      type: w.type,
      createdAt: w.createdAt.toISOString(),
      inboxCount: w.senders.filter((s) => s.channel === "email" || s.channel === "both").length,
      linkedinAccountCount: w.senders.filter((s) => s.channel === "linkedin" || s.channel === "both").length,
      campaignCount: w._count.campaigns,
      memberCount: w._count.members,
      lastActivity: lastLogin?.toISOString() ?? null,
    };
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex flex-col gap-3 border-b border-border/50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-5">
        <div className="min-w-0">
          <h1 className="text-xl font-medium text-foreground">Workspaces</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {rows.length} workspace{rows.length !== 1 ? "s" : ""} total
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="brand" size="sm" disabled>
            <Plus className="size-4 mr-1.5" />
            Add Workspace
          </Button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 min-h-0 p-6 space-y-6 overflow-auto">
        {rows.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No workspaces yet"
            description="Create your first workspace to start managing clients."
          />
        ) : (
          <WorkspacesTable workspaces={rows} />
        )}
      </div>
    </div>
  );
}
