import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { PersonHeader } from "@/components/people/person-header";
import { PersonTimeline, type TimelineEvent } from "@/components/people/person-timeline";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

// ─── Timeline builder (inline to avoid extra HTTP round trip) ─────────────────

function mapWebhookType(eventType: string): TimelineEvent["type"] {
  const map: Record<string, TimelineEvent["type"]> = {
    EMAIL_SENT: "email_sent",
    EMAIL_OPENED: "email_opened",
    LEAD_REPLIED: "email_replied",
    LEAD_INTERESTED: "email_replied",
    BOUNCED: "email_bounced",
    EMAIL_BOUNCED: "email_bounced",
    UNTRACKED_REPLY_RECEIVED: "email_replied",
  };
  return map[eventType] ?? "other";
}

function mapWebhookTitle(eventType: string): string {
  const map: Record<string, string> = {
    EMAIL_SENT: "Email sent",
    EMAIL_OPENED: "Email opened",
    LEAD_REPLIED: "Replied to email",
    LEAD_INTERESTED: "Marked interested",
    BOUNCED: "Email bounced",
    EMAIL_BOUNCED: "Email bounced",
    UNTRACKED_REPLY_RECEIVED: "Reply received",
  };
  return map[eventType] ?? eventType.replace(/_/g, " ").toLowerCase();
}

function mapLinkedInType(actionType: string): TimelineEvent["type"] {
  const map: Record<string, TimelineEvent["type"]> = {
    connect: "linkedin_connect",
    message: "linkedin_message",
    profile_view: "linkedin_profile_view",
    check_connection: "linkedin_profile_view",
  };
  return map[actionType] ?? "other";
}

function mapLinkedInTitle(actionType: string, status: string): string {
  const titles: Record<string, string> = {
    connect: "Connection request sent",
    message: "LinkedIn message sent",
    profile_view: "Profile viewed",
    check_connection: "Connection checked",
  };
  const t = titles[actionType] ?? actionType;
  if (status === "failed") return `${t} (failed)`;
  if (status === "pending") return `${t} (pending)`;
  return t;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function PersonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const person = await prisma.person.findUnique({
    where: { id },
    include: {
      workspaces: true,
      lists: { include: { list: { select: { name: true } } } },
    },
  });

  if (!person) notFound();

  // Build timeline inline
  const [webhookEvents, linkedInActions, enrichmentLogs] = await Promise.all([
    prisma.webhookEvent.findMany({
      where: { leadEmail: person.email },
      orderBy: { receivedAt: "desc" },
      take: 100,
    }),
    prisma.linkedInAction.findMany({
      where: { personId: person.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.enrichmentLog.findMany({
      where: { entityId: person.id, entityType: "person" },
      orderBy: { runAt: "desc" },
      take: 50,
    }),
  ]);

  const allEvents: TimelineEvent[] = [];

  for (const ev of webhookEvents) {
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(ev.payload) as Record<string, unknown>; } catch {}

    const isReplyType = ["LEAD_REPLIED", "LEAD_INTERESTED", "UNTRACKED_REPLY_RECEIVED"].includes(ev.eventType);
    const isAutomated = ev.isAutomated && isReplyType;

    allEvents.push({
      id: ev.id,
      type: isAutomated ? "email_auto_reply" : mapWebhookType(ev.eventType),
      title: isAutomated ? `${mapWebhookTitle(ev.eventType)} (OOO)` : mapWebhookTitle(ev.eventType),
      detail: (payload.subject as string) ?? (payload.campaignName as string) ?? undefined,
      workspace: ev.workspace,
      timestamp: ev.receivedAt.toISOString(),
      metadata: { campaignId: ev.campaignId, senderEmail: ev.senderEmail, isAutomated: ev.isAutomated },
    });
  }

  for (const action of linkedInActions) {
    allEvents.push({
      id: action.id,
      type: mapLinkedInType(action.actionType),
      title: mapLinkedInTitle(action.actionType, action.status),
      detail: action.messageBody?.slice(0, 80) ?? undefined,
      workspace: action.workspaceSlug,
      timestamp: (action.completedAt ?? action.scheduledFor).toISOString(),
      metadata: { actionType: action.actionType, status: action.status },
    });
  }

  for (const log of enrichmentLogs) {
    let fieldsWritten: string[] = [];
    try { fieldsWritten = JSON.parse(log.fieldsWritten ?? "[]") as string[]; } catch {}
    allEvents.push({
      id: log.id,
      type: "enrichment",
      title: `Enriched via ${log.provider}`,
      detail: log.status === "error" ? `Error: ${log.errorMessage ?? "unknown"}` : fieldsWritten.length > 0 ? `Fields: ${fieldsWritten.join(", ")}` : undefined,
      workspace: log.workspaceSlug ?? undefined,
      timestamp: log.runAt.toISOString(),
      metadata: { provider: log.provider, costUsd: log.costUsd },
    });
  }

  allEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const emailEvents = allEvents.filter((e) => e.type.startsWith("email_"));
  const linkedInEvents = allEvents.filter((e) => e.type.startsWith("linkedin_"));

  // Parse enrichment data
  let enrichmentFields: Record<string, unknown> = {};
  try {
    if (person.enrichmentData) {
      enrichmentFields = JSON.parse(person.enrichmentData as string) as Record<string, unknown>;
    }
  } catch {}

  const fullName = [person.firstName, person.lastName].filter(Boolean).join(" ") || null;

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: "People", href: "/people" },
          { label: fullName ?? person.email },
        ]}
      />

      {/* Header */}
      <PersonHeader
        id={person.id}
        email={person.email}
        firstName={person.firstName}
        lastName={person.lastName}
        company={person.company}
        jobTitle={person.jobTitle}
        location={person.location}
        linkedinUrl={person.linkedinUrl}
        phone={person.phone}
        status={person.status ?? "new"}
        workspaces={person.workspaces.map((pw) => ({
          workspace: pw.workspace,
          icpScore: pw.icpScore,
          status: pw.status ?? "new",
        }))}
      />

      {/* Tabs */}
      <div className="flex-1 p-6">
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="email">Email History</TabsTrigger>
            <TabsTrigger value="linkedin">LinkedIn Activity</TabsTrigger>
            <TabsTrigger value="enrichment">Enrichment Data</TabsTrigger>
            <TabsTrigger value="workspaces">Workspaces</TabsTrigger>
          </TabsList>

          {/* Overview — unified timeline */}
          <TabsContent value="overview">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Activity Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                <PersonTimeline events={allEvents} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Email History */}
          <TabsContent value="email">
            <Card>
              <CardContent className="pt-6">
                {emailEvents.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No email history</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border">
                        <TableHead className="text-xs">Date</TableHead>
                        <TableHead className="text-xs">Type</TableHead>
                        <TableHead className="text-xs">Detail</TableHead>
                        <TableHead className="text-xs">Workspace</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {emailEvents.map((ev) => (
                        <TableRow key={ev.id} className="border-border">
                          <TableCell className="text-xs text-muted-foreground tabular-nums">
                            {new Date(ev.timestamp).toLocaleDateString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </TableCell>
                          <TableCell>
                            {ev.type === "email_auto_reply" ? (
                              <Badge variant="outline" size="xs" className="text-muted-foreground border-muted-foreground/30">replied (OOO)</Badge>
                            ) : (
                              <Badge variant="outline" size="xs">{ev.type.replace("email_", "")}</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">{ev.detail ?? "—"}</TableCell>
                          <TableCell className="text-[10px] text-muted-foreground font-mono">{ev.workspace ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* LinkedIn Activity */}
          <TabsContent value="linkedin">
            <Card>
              <CardContent className="pt-6">
                {linkedInEvents.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No LinkedIn activity</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border">
                        <TableHead className="text-xs">Date</TableHead>
                        <TableHead className="text-xs">Action</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs">Detail</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linkedInEvents.map((ev) => (
                        <TableRow key={ev.id} className="border-border">
                          <TableCell className="text-xs text-muted-foreground tabular-nums">
                            {new Date(ev.timestamp).toLocaleDateString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </TableCell>
                          <TableCell>
                            <Badge size="xs" className="bg-blue-500/10 text-blue-600 border-blue-200">
                              {(ev.metadata?.actionType as string) ?? ev.type.replace("linkedin_", "")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{(ev.metadata?.status as string) ?? "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">{ev.detail ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Enrichment Data */}
          <TabsContent value="enrichment">
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle>Enrichment Fields</CardTitle>
                </CardHeader>
                <CardContent>
                  {Object.keys(enrichmentFields).length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No enrichment data</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                      {Object.entries(enrichmentFields).map(([key, value]) => (
                        <div key={key} className="flex justify-between py-1 border-b border-border/50">
                          <span className="text-xs text-muted-foreground font-mono">{key}</span>
                          <span className="text-xs text-foreground text-right max-w-[200px] truncate">
                            {typeof value === "string" ? value : JSON.stringify(value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle>Enrichment History</CardTitle>
                </CardHeader>
                <CardContent>
                  {enrichmentLogs.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No enrichment runs</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border">
                          <TableHead className="text-xs">Date</TableHead>
                          <TableHead className="text-xs">Provider</TableHead>
                          <TableHead className="text-xs">Fields</TableHead>
                          <TableHead className="text-xs">Cost</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {enrichmentLogs.map((log) => {
                          let fields: string[] = [];
                          try { fields = JSON.parse(log.fieldsWritten ?? "[]") as string[]; } catch {}
                          return (
                            <TableRow key={log.id} className="border-border">
                              <TableCell className="text-xs text-muted-foreground tabular-nums">
                                {log.runAt.toLocaleDateString("en-GB", { month: "short", day: "numeric" })}
                              </TableCell>
                              <TableCell className="text-xs">{log.provider}</TableCell>
                              <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                                {fields.join(", ") || "—"}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground tabular-nums">
                                {log.costUsd ? `$${Number(log.costUsd).toFixed(3)}` : "—"}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={log.status === "error" ? "destructive" : "outline"}
                                  size="xs"
                                >
                                  {log.status}
                                </Badge>
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
          </TabsContent>

          {/* Workspaces */}
          <TabsContent value="workspaces">
            <Card>
              <CardContent className="pt-6">
                {person.workspaces.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Not assigned to any workspaces</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border">
                        <TableHead className="text-xs">Workspace</TableHead>
                        <TableHead className="text-xs">ICP Score</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs">Scored At</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {person.workspaces.map((pw) => (
                        <TableRow key={pw.id} className="border-border">
                          <TableCell className="text-xs font-medium">
                            {pw.workspace}
                          </TableCell>
                          <TableCell className="text-xs tabular-nums">
                            {pw.icpScore !== null ? pw.icpScore : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" size="xs">
                              {pw.status ?? "new"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {pw.icpScoredAt
                              ? new Date(pw.icpScoredAt).toLocaleDateString("en-GB", { month: "short", day: "numeric", year: "numeric" })
                              : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
