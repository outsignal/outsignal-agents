import Link from "next/link";
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
import { parseModules, getWorkspaceQuotaUsage } from "@/lib/workspaces/quota";
import type { WorkspaceModule } from "@/lib/workspaces/quota";

// Module badge configuration
const MODULE_CONFIG: Record<WorkspaceModule, { label: string; variant: "success" | "warning" }> = {
  "email": { label: "Email", variant: "success" },
  "email-signals": { label: "Email Signals", variant: "warning" },
  "linkedin": { label: "LinkedIn", variant: "success" },
  "linkedin-signals": { label: "LinkedIn Signals", variant: "warning" },
};

function QuotaBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const isHigh = pct >= 80;
  return (
    <div className="space-y-1">
      <span className="text-xs text-muted-foreground">
        {used.toLocaleString()} / {total.toLocaleString()}
      </span>
      <div className="h-1.5 w-24 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className={`h-1.5 rounded-full transition-all ${isHigh ? "bg-amber-400" : "bg-brand"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "active") {
    return <Badge variant="success" size="xs">Active</Badge>;
  }
  if (status === "inactive") {
    return <Badge variant="outline" size="xs">Inactive</Badge>;
  }
  return <Badge variant="secondary" size="xs">{status}</Badge>;
}

export default async function PackagesPage() {
  const workspaces = await prisma.workspace.findMany({
    orderBy: { name: "asc" },
    select: {
      slug: true,
      name: true,
      status: true,
      enabledModules: true,
      monthlyLeadQuota: true,
      monthlyLeadQuotaStatic: true,
      monthlyLeadQuotaSignal: true,
      monthlyCampaignAllowance: true,
    },
  });

  // Fetch quota usage for all workspaces in parallel
  const usageResults = await Promise.allSettled(
    workspaces.map((ws) => getWorkspaceQuotaUsage(ws.slug))
  );

  const rows = workspaces.map((ws, i) => {
    const usageResult = usageResults[i];
    const usage =
      usageResult.status === "fulfilled"
        ? usageResult.value
        : { totalLeadsUsed: 0, campaignsUsed: 0 };
    const modules = parseModules(ws.enabledModules);
    return { ws, usage, modules };
  });

  return (
    <div>
      <Header
        title="Workspace Packages"
        description="Campaign capabilities and quotas for all workspaces."
      />

      <div className="p-6 space-y-6">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Modules</TableHead>
                  <TableHead>Lead Quota</TableHead>
                  <TableHead>Campaigns</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-12 text-center text-muted-foreground text-sm">
                      No workspaces found.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map(({ ws, usage, modules }) => (
                    <TableRow key={ws.slug} className="border-border">
                      <TableCell>
                        <Link
                          href={`/workspace/${ws.slug}/settings`}
                          className="font-medium text-sm hover:underline"
                        >
                          {ws.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {modules.map((mod) => (
                            <Badge
                              key={mod}
                              variant={MODULE_CONFIG[mod].variant}
                              size="xs"
                            >
                              {MODULE_CONFIG[mod].label}
                            </Badge>
                          ))}
                          {modules.length === 0 && (
                            <span className="text-xs text-muted-foreground">None</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <QuotaBar
                          used={usage.totalLeadsUsed}
                          total={ws.monthlyLeadQuota}
                        />
                      </TableCell>
                      <TableCell>
                        <QuotaBar
                          used={usage.campaignsUsed}
                          total={ws.monthlyCampaignAllowance}
                        />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={ws.status} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
