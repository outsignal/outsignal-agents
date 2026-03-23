import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-session";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { prisma } from "@/lib/db";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  CalendarClock,
  Clock,
  CheckCircle,
  AlertCircle,
  Palmtree,
  Thermometer,
  Building2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OooRecord {
  id: string;
  personEmail: string;
  personName: string | null;
  oooUntil: Date;
  oooReason: string;
  eventName: string | null;
  status: string;
  sentAt: Date | null;
  confidence: string | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatReturnDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function formatReengagementDate(oooUntil: Date): string {
  const reengageDate = new Date(oooUntil);
  reengageDate.setDate(reengageDate.getDate() + 1);
  return reengageDate.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function formatSentDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function reasonConfig(reason: string) {
  switch (reason) {
    case "holiday":
      return {
        label: "Holiday",
        icon: Palmtree,
        variant: "info" as const,
      };
    case "illness":
      return {
        label: "Illness",
        icon: Thermometer,
        variant: "warning" as const,
      };
    case "conference":
      return {
        label: "Conference",
        icon: Building2,
        variant: "purple" as const,
      };
    default:
      return {
        label: "Away",
        icon: Clock,
        variant: "secondary" as const,
      };
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function PortalOooPage() {
  let session;
  try {
    session = await getPortalSession();
  } catch {
    redirect("/portal/login");
  }
  const { workspaceSlug } = session;
  const workspace = await getWorkspaceBySlug(workspaceSlug);

  if (!workspace) {
    return (
      <div className="p-6">
        <div className="text-center py-12 text-muted-foreground">
          Your workspace is being set up. Check back soon.
        </div>
      </div>
    );
  }

  // ---- Fetch OOO records for this workspace ----
  const rawRecords = await prisma.oooReengagement.findMany({
    where: { workspaceSlug },
    orderBy: { oooUntil: "asc" },
  });

  // ---- Get person names via email lookup ----
  const emails = [...new Set(rawRecords.map((r) => r.personEmail))];
  const people =
    emails.length > 0
      ? await prisma.person.findMany({
          where: { email: { in: emails } },
          select: { email: true, firstName: true, lastName: true },
        })
      : [];

  const nameMap = new Map(
    people.map((p) => [
      p.email,
      [p.firstName, p.lastName].filter(Boolean).join(" ") || null,
    ]),
  );

  // ---- Build typed records ----
  const records: OooRecord[] = rawRecords.map((r) => ({
    id: r.id,
    personEmail: r.personEmail,
    personName: nameMap.get(r.personEmail) ?? null,
    oooUntil: r.oooUntil,
    oooReason: r.oooReason,
    eventName: r.eventName,
    status: r.status,
    sentAt: r.sentAt,
    confidence: (r as Record<string, unknown>).confidence as string | null,
    createdAt: r.createdAt,
  }));

  // ---- Sort: pending first, then sent, then failed; within each group by oooUntil asc ----
  const statusOrder: Record<string, number> = {
    pending: 0,
    sent: 1,
    cancelled: 2,
    failed: 3,
  };
  records.sort((a, b) => {
    const orderDiff =
      (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
    if (orderDiff !== 0) return orderDiff;
    return a.oooUntil.getTime() - b.oooUntil.getTime();
  });

  // ---- Compute KPIs ----
  const now = new Date();
  const oneWeekFromNow = new Date(now);
  oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);

  const currentlyAway = records.filter((r) => r.status === "pending").length;
  const returningThisWeek = records.filter(
    (r) =>
      r.status === "pending" &&
      r.oooUntil >= now &&
      r.oooUntil <= oneWeekFromNow,
  ).length;
  const reengaged = records.filter((r) => r.status === "sent").length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-medium text-foreground">Out of Office</h1>
        <p className="text-sm text-muted-foreground mt-1">
          We automatically detect when contacts are away and schedule
          re-engagement for their return
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          label="Currently Away"
          value={currentlyAway}
          icon="Users"
          trend="neutral"
          detail={currentlyAway === 0 ? "None" : `${currentlyAway} contact${currentlyAway !== 1 ? "s" : ""}`}
          density="compact"
        />
        <MetricCard
          label="Returning This Week"
          value={returningThisWeek}
          icon="Activity"
          trend={returningThisWeek > 0 ? "warning" : "neutral"}
          detail={
            returningThisWeek === 0
              ? "None upcoming"
              : `${returningThisWeek} returning soon`
          }
          density="compact"
          accentColor="#d97706"
        />
        <MetricCard
          label="Successfully Re-engaged"
          value={reengaged}
          icon="CheckCircle"
          trend={reengaged > 0 ? "up" : "neutral"}
          detail={reengaged === 0 ? "None yet" : `${reengaged} re-engaged`}
          density="compact"
          accentColor="#059669"
        />
      </div>

      {/* OOO Cards or Empty State */}
      {records.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No out-of-office replies detected"
          description="When contacts send auto-replies, we'll track their absence and schedule re-engagement automatically."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {records.map((record) => {
            const reason = reasonConfig(record.oooReason);
            const ReasonIcon = reason.icon;

            return (
              <div
                key={record.id}
                className="rounded-lg border border-border bg-card p-4 space-y-3 transition-all duration-150 hover:border-border/80 hover:shadow-sm"
              >
                {/* Person info */}
                <div className="min-w-0">
                  <p className="font-medium text-sm text-foreground truncate">
                    {record.personName || record.personEmail}
                  </p>
                  {record.personName && (
                    <p className="text-xs text-muted-foreground truncate">
                      {record.personEmail}
                    </p>
                  )}
                </div>

                {/* Badges row */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={reason.variant} size="xs">
                    <ReasonIcon className="h-3 w-3" />
                    {reason.label}
                  </Badge>
                  {record.eventName && (
                    <Badge variant="outline" size="xs">
                      {record.eventName}
                    </Badge>
                  )}
                </div>

                {/* Return date */}
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Returns {formatReturnDate(record.oooUntil)}
                    {record.confidence === "defaulted" && (
                      <span className="text-xs text-muted-foreground font-normal ml-1">
                        (estimated)
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Will email on {formatReengagementDate(record.oooUntil)}
                  </p>
                </div>

                {/* Status */}
                <div className="flex items-center gap-1.5 pt-1 border-t border-border/50">
                  {record.status === "pending" && (
                    <>
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        Scheduled
                      </span>
                    </>
                  )}
                  {record.status === "sent" && (
                    <>
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span className="text-xs text-emerald-600 dark:text-emerald-400">
                        Re-engaged
                        {record.sentAt && (
                          <span className="text-muted-foreground ml-1">
                            on {formatSentDate(record.sentAt)}
                          </span>
                        )}
                      </span>
                    </>
                  )}
                  {record.status === "failed" && (
                    <>
                      <AlertCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                      <span className="text-xs text-red-600 dark:text-red-400">
                        Failed
                      </span>
                    </>
                  )}
                  {record.status === "cancelled" && (
                    <>
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        Cancelled
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
