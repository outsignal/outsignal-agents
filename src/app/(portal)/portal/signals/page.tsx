import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Zap } from "lucide-react";

const SIGNAL_TYPE_LABELS: Record<string, string> = {
  funding: "Funding",
  job_change: "Job Change",
  hiring_spike: "Hiring Spike",
  tech_adoption: "Tech Adoption",
  news: "News",
  social_mention: "Social",
};

const SIGNAL_TYPE_BADGE_STYLES: Record<string, string> = {
  funding: "bg-emerald-100 text-emerald-800",
  job_change: "bg-blue-100 text-blue-800",
  hiring_spike: "bg-violet-100 text-violet-800",
  tech_adoption: "bg-cyan-100 text-cyan-800",
  news: "bg-amber-100 text-amber-800",
  social_mention: "bg-rose-100 text-rose-800",
};

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export default async function PortalSignalsPage() {
  const { workspaceSlug } = await getPortalSession();

  // Last 30 days
  const since30d = new Date();
  since30d.setDate(since30d.getDate() - 30);

  // Last 7 days
  const since7d = new Date();
  since7d.setDate(since7d.getDate() - 7);

  // Today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Fetch signals for last 30 days
  const signals = await prisma.signalEvent.findMany({
    where: {
      workspaceSlug,
      detectedAt: { gte: since30d },
      status: "active",
    },
    orderBy: { detectedAt: "desc" },
    take: 200,
  });

  // KPI calculations
  const signals7d = signals.filter((s) => s.detectedAt >= since7d);
  const signalsToday = signals.filter((s) => s.detectedAt >= todayStart);
  const highIntentCount = signals7d.filter((s) => s.isHighIntent).length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-heading font-bold">Signal Activity</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Intent signals detected for your accounts in the last 30 days
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          label="Signals (7d)"
          value={signals7d.length.toLocaleString()}
          trend={signals7d.length > 0 ? "up" : "neutral"}
          density="compact"
        />
        <MetricCard
          label="Signals Today"
          value={signalsToday.length.toLocaleString()}
          density="compact"
        />
        <MetricCard
          label="High Intent (7d)"
          value={highIntentCount.toLocaleString()}
          trend={highIntentCount > 0 ? "up" : "neutral"}
          detail={
            highIntentCount > 0
              ? "Multiple signal types on same company"
              : undefined
          }
          density="compact"
        />
      </div>

      {/* Signals Table */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading">Recent Signals</CardTitle>
        </CardHeader>
        <CardContent>
          {signals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <Zap className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No signals detected yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Signal intelligence will appear here once monitoring is
                configured for your workspace.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Signal Type</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signals.map((signal) => {
                  const badgeStyle =
                    SIGNAL_TYPE_BADGE_STYLES[signal.signalType] ??
                    "bg-gray-100 text-gray-800";
                  const typeLabel =
                    SIGNAL_TYPE_LABELS[signal.signalType] ?? signal.signalType;
                  return (
                    <TableRow key={signal.id}>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap tabular-nums">
                        {formatRelativeTime(signal.detectedAt)}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">
                          {signal.companyName ?? signal.companyDomain}
                        </div>
                        {signal.companyName && (
                          <div className="text-xs text-muted-foreground">
                            {signal.companyDomain}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${badgeStyle}`}>
                          {typeLabel}
                        </Badge>
                        {signal.isHighIntent && (
                          <Badge className="text-xs ml-1 bg-brand/20 text-brand-strong">
                            High Intent
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-md truncate">
                        {signal.title ?? signal.summary ?? "\u2014"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
