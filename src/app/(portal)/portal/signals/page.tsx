import { redirect } from "next/navigation";
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
import { EmptyState } from "@/components/ui/empty-state";
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
  let session;
  try {
    session = await getPortalSession();
  } catch {
    redirect("/portal/login");
  }
  const { workspaceSlug } = session;

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
    <div className="relative min-h-screen p-6 space-y-6">
      {/* Coming Soon overlay */}
      <div className="absolute inset-0 bg-muted backdrop-blur-[2px] z-10 flex flex-col items-center justify-center">
        <div className="h-14 w-14 rounded-full bg-background shadow-sm flex items-center justify-center mb-4">
          <Zap className="h-7 w-7 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">Coming Soon</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Signal-based outreach is on the way
        </p>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-xl font-medium text-foreground">Signal Activity</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Intent signals detected for your accounts in the last 30 days
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          label="Signals (7d)"
          value={signals7d.length.toLocaleString()}
          icon="Zap"
          trend={signals7d.length > 0 ? "up" : "neutral"}
          density="compact"
        />
        <MetricCard
          label="Signals Today"
          value={signalsToday.length.toLocaleString()}
          icon="Zap"
          density="compact"
        />
        <MetricCard
          label="High Intent (7d)"
          value={highIntentCount.toLocaleString()}
          icon="Zap"
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
            <EmptyState
              icon={Zap}
              title="No signals detected"
              description="Signal intelligence will appear here once monitoring is configured for your workspace."
              variant="compact"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted">
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
                    <TableRow key={signal.id} className="hover:bg-muted border-border">
                      <TableCell className="text-sm font-mono text-muted-foreground whitespace-nowrap tabular-nums">
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
