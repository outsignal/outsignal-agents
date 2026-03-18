"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Loader2, Bell, MessageSquare, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Skeleton,
  SkeletonText,
  SkeletonMetricCard,
  SkeletonTableRow,
} from "@/components/ui/skeleton";

const NotificationHealthPage = dynamic(() => import("@/app/(admin)/notification-health/page"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  ),
});

const NotificationsPage = dynamic(() => import("@/app/(admin)/notifications/page"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  ),
});

// ---------- Types ----------

interface GlobalChannels {
  alerts: { channelId: string | null; configured: boolean };
  replies: { channelId: string | null; configured: boolean };
  ops: { channelId: string | null; configured: boolean };
}

interface WorkspaceConfig {
  slug: string;
  name: string;
  slackChannelId: string | null;
  notificationEmails: string[];
  approvalsSlackChannelId: string | null;
  missingConfig: string[];
}

interface NotificationConfig {
  globalChannels: GlobalChannels;
  workspaces: WorkspaceConfig[];
}

// ---------- Channel Card ----------

function ChannelCard({
  icon: Icon,
  label,
  channelId,
  configured,
}: {
  icon: typeof Bell;
  label: string;
  channelId: string | null;
  configured: boolean;
}) {
  return (
    <Card density="compact">
      <CardContent className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {channelId ? (
            <p className="font-mono text-xs text-foreground truncate">{channelId}</p>
          ) : (
            <p className="text-xs text-muted-foreground">Not set</p>
          )}
        </div>
        <Badge variant={configured ? "success" : "destructive"} size="xs">
          {configured ? "Configured" : "Missing"}
        </Badge>
      </CardContent>
    </Card>
  );
}

// ---------- Loading Skeleton ----------

function ConfigSkeleton() {
  return (
    <div className="space-y-6">
      {/* Global channels skeleton */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30">
          <SkeletonText width="120px" className="h-4" />
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SkeletonMetricCard />
          <SkeletonMetricCard />
          <SkeletonMetricCard />
        </div>
      </div>
      {/* Workspace table skeleton */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30">
          <SkeletonText width="180px" className="h-4" />
        </div>
        <div>
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonTableRow key={i} columns={5} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Main Component ----------

export default function NotificationsTab() {
  const [config, setConfig] = useState<NotificationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/notification-config")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load notification config");
        return res.json();
      })
      .then((data) => setConfig(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      {/* Section 1 + 2: Notification Config */}
      {loading ? (
        <ConfigSkeleton />
      ) : error ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : config ? (
        <>
          {/* Section 1: Global Channels */}
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/30">
              <h3 className="text-sm font-medium">Global Channels</h3>
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <ChannelCard
                icon={Bell}
                label="Alerts Channel"
                channelId={config.globalChannels.alerts.channelId}
                configured={config.globalChannels.alerts.configured}
              />
              <ChannelCard
                icon={MessageSquare}
                label="Replies Channel"
                channelId={config.globalChannels.replies.channelId}
                configured={config.globalChannels.replies.configured}
              />
              <ChannelCard
                icon={Wrench}
                label="Ops Channel"
                channelId={config.globalChannels.ops.channelId}
                configured={config.globalChannels.ops.configured}
              />
            </div>
          </div>

          {/* Section 2: Workspace Notification Config */}
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-muted/30">
              <h3 className="text-sm font-medium">Workspace Notification Config</h3>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Slack Channel</TableHead>
                  <TableHead>Notification Emails</TableHead>
                  <TableHead>Approvals Channel</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {config.workspaces.map((ws) => {
                  const isComplete = ws.missingConfig.length === 0;
                  return (
                    <TableRow
                      key={ws.slug}
                      className={
                        !isComplete
                          ? "border-l-2 border-l-amber-400 dark:border-l-amber-600 bg-amber-50/30 dark:bg-amber-950/10 cursor-pointer"
                          : "cursor-pointer"
                      }
                    >
                      <TableCell>
                        <Link
                          href={`/workspace/${ws.slug}/settings`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {ws.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {ws.slackChannelId ? (
                          <span className="font-mono text-xs">{ws.slackChannelId}</span>
                        ) : (
                          <span className="text-xs text-amber-600 dark:text-amber-400">
                            &mdash;
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {ws.notificationEmails.length > 0 ? (
                          <span
                            className="text-xs truncate max-w-[200px] inline-block"
                            title={ws.notificationEmails.join(", ")}
                          >
                            {ws.notificationEmails.length === 1
                              ? ws.notificationEmails[0]
                              : `${ws.notificationEmails[0]} +${ws.notificationEmails.length - 1}`}
                          </span>
                        ) : (
                          <span className="text-xs text-amber-600 dark:text-amber-400">
                            None
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {ws.approvalsSlackChannelId ? (
                          <span className="font-mono text-xs">
                            {ws.approvalsSlackChannelId}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">&mdash;</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant={isComplete ? "success" : "warning"}
                          size="xs"
                          dot
                        >
                          {isComplete ? "Complete" : "Incomplete"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      ) : null}

      {/* Existing sections */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30">
          <h3 className="text-sm font-medium">Notification Health</h3>
        </div>
        <NotificationHealthPage />
      </div>
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30">
          <h3 className="text-sm font-medium">Notifications</h3>
        </div>
        <NotificationsPage />
      </div>
    </div>
  );
}
