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
      clientEmails: true,
      _count: {
        select: {
          senders: true,
          campaigns: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  // Collect all client emails across workspaces to batch-query last activity
  const allEmails: string[] = [];
  const workspaceEmails = new Map<string, string[]>();
  for (const w of workspaces) {
    let emails: string[] = [];
    if (w.clientEmails) {
      try {
        const parsed = JSON.parse(w.clientEmails);
        if (Array.isArray(parsed)) emails = parsed;
      } catch {
        // ignore malformed JSON
      }
    }
    workspaceEmails.set(w.slug, emails);
    allEmails.push(...emails);
  }

  // Query most recent used magic link token per email
  const lastActivityByEmail = new Map<string, Date>();
  if (allEmails.length > 0) {
    const tokens = await prisma.magicLinkToken.findMany({
      where: {
        email: { in: allEmails },
        used: true,
      },
      select: {
        email: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    for (const t of tokens) {
      if (!lastActivityByEmail.has(t.email)) {
        lastActivityByEmail.set(t.email, t.createdAt);
      }
    }
  }

  const rows: WorkspaceRow[] = workspaces.map((w) => {
    const emails = workspaceEmails.get(w.slug) ?? [];
    // Find most recent activity across all workspace members
    let lastActivity: string | null = null;
    for (const email of emails) {
      const date = lastActivityByEmail.get(email);
      if (date) {
        if (!lastActivity || date.toISOString() > lastActivity) {
          lastActivity = date.toISOString();
        }
      }
    }

    return {
      slug: w.slug,
      name: w.name,
      vertical: w.vertical,
      status: w.status,
      package: w.package,
      type: w.type,
      createdAt: w.createdAt.toISOString(),
      senderCount: w._count.senders,
      campaignCount: w._count.campaigns,
      memberCount: emails.length,
      lastActivity,
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
