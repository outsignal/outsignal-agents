"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { RefreshCw, ExternalLink, Activity } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

type ConnectionStatus = "connected" | "disconnected" | "degraded" | "no_api";

interface ProviderStatus {
  id: string;
  name: string;
  category: "enrichment" | "ai" | "discovery" | "scraping" | "notifications" | "infrastructure";
  status: ConnectionStatus;
  configured: boolean;
  credits?: { used?: number; remaining?: number; total?: number };
  plan?: string;
  billing?: { nextDate?: string; period?: string };
  dashboardUrl?: string;
  error?: string;
  lastChecked: string;
}

interface WebhookHealth {
  id: string;
  name: string;
  lastEventAt: string | null;
  last24hCount: number;
  status: "healthy" | "warning" | "inactive";
}

interface IntegrationsResponse {
  providers: ProviderStatus[];
  webhooks: WebhookHealth[];
  checkedAt: string;
}

interface NotifSummary {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  failureRate: number;
}

interface NotifTypeRow {
  notificationType: string;
  label: string;
  channels: string;
  audience: string;
  total: number;
  sent: number;
  failed: number;
  lastFiredAt: string | null;
  status: "green" | "amber" | "red" | "neutral";
}

interface NotifFailureRow {
  id: string;
  notificationType: string;
  channel: string;
  recipient: string | null;
  errorMessage: string | null;
  workspaceSlug: string | null;
  createdAt: string;
}

interface NotifHealthData {
  summary: NotifSummary;
  byType: NotifTypeRow[];
  recentFailures: NotifFailureRow[];
}

type NotifRange = "24h" | "7d" | "30d";

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORY_ORDER: ProviderStatus["category"][] = [
  "infrastructure", "enrichment", "discovery", "ai", "scraping", "notifications",
];

const CATEGORY_LABELS: Record<ProviderStatus["category"], string> = {
  infrastructure: "Infrastructure",
  enrichment: "Enrichment",
  discovery: "Discovery",
  ai: "AI / LLM",
  scraping: "Scraping",
  notifications: "Notifications",
};

const NOTIF_RANGES: { value: NotifRange; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

const STATUS_SORT_ORDER: Record<string, number> = { red: 0, amber: 1, green: 2, neutral: 3 };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatType(type: string): string {
  return type.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function creditBarColor(remaining: number, total: number): string {
  const pct = total > 0 ? remaining / total : 0;
  if (pct > 0.25) return "bg-emerald-500";
  if (pct > 0.1) return "bg-amber-500";
  return "bg-red-500";
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function IntStatusDot({ status }: { status: ConnectionStatus }) {
  return (
    <span className={cn(
      "inline-block h-2.5 w-2.5 rounded-full shrink-0",
      status === "connected" && "bg-[#22c55e]",
      status === "degraded" && "bg-[#f59e0b]",
      status === "disconnected" && "bg-[#ef4444]",
      status === "no_api" && "bg-zinc-400",
    )} />
  );
}

function NotifStatusDot({ status }: { status: string }) {
  const color =
    status === "green" ? "bg-[#22c55e]" :
    status === "red" ? "bg-[#ef4444]" :
    status === "amber" ? "bg-[#f59e0b]" :
    "bg-zinc-400";
  return <span className={cn("inline-block h-2.5 w-2.5 rounded-full shrink-0", color)} />;
}

function IntStatusBadge({ status }: { status: ConnectionStatus }) {
  const map: Record<ConnectionStatus, { variant: "success" | "warning" | "destructive" | "secondary"; label: string }> = {
    connected: { variant: "success", label: "Connected" },
    degraded: { variant: "warning", label: "Degraded" },
    disconnected: { variant: "destructive", label: "Disconnected" },
    no_api: { variant: "secondary", label: "Dashboard" },
  };
  const c = map[status];
  return <Badge variant={c.variant} size="xs">{c.label}</Badge>;
}

function OverallBanner({ integrations, notifData }: { integrations: IntegrationsResponse | null; notifData: NotifHealthData | null }) {
  let downCount = 0;
  let degradedCount = 0;

  if (integrations) {
    for (const p of integrations.providers) {
      if (p.status === "disconnected" && p.configured) downCount++;
      if (p.status === "degraded") degradedCount++;
    }
  }

  if (notifData && notifData.summary.failureRate > 10) degradedCount++;

  const isDown = downCount > 0;
  const isDegraded = degradedCount > 0;

  const bgColor = isDown ? "bg-[#ef4444]/10 border-[#ef4444]/30" : isDegraded ? "bg-[#f59e0b]/10 border-[#f59e0b]/30" : "bg-[#22c55e]/10 border-[#22c55e]/30";
  const dotColor = isDown ? "bg-[#ef4444]" : isDegraded ? "bg-[#f59e0b]" : "bg-[#22c55e]";
  const textColor = isDown ? "text-[#ef4444]" : isDegraded ? "text-[#f59e0b]" : "text-[#22c55e]";
  const message = isDown
    ? `${downCount} service${downCount > 1 ? "s" : ""} down`
    : isDegraded
      ? `${degradedCount} service${degradedCount > 1 ? "s" : ""} degraded`
      : "All systems operational";

  return (
    <div className={cn("flex items-center gap-3 rounded-lg border px-4 py-3", bgColor)}>
      <span className={cn("h-3 w-3 rounded-full animate-pulse", dotColor)} />
      <span className={cn("text-sm font-medium", textColor)}>{message}</span>
      {integrations && (
        <span className="ml-auto text-xs text-muted-foreground">
          Checked {timeAgo(integrations.checkedAt)}
        </span>
      )}
    </div>
  );
}

function IntegrationCard({ provider }: { provider: ProviderStatus }) {
  const hasCredits = provider.credits && provider.credits.remaining != null;
  const hasTotal = hasCredits && provider.credits!.total != null && provider.credits!.total! > 0;

  return (
    <Card density="compact">
      <CardContent>
        <div className="flex items-center gap-2">
          <IntStatusDot status={provider.status} />
          <span className="text-sm font-medium truncate flex-1">{provider.name}</span>
          <IntStatusBadge status={provider.status} />
          {provider.dashboardUrl && (
            <a href={provider.dashboardUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors" title="Open dashboard">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
        {hasCredits && (
          <div className="mt-3 space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Credits</span>
              <span className="font-mono">
                {provider.credits!.remaining!.toLocaleString()}
                {hasTotal && <span> / {provider.credits!.total!.toLocaleString()}</span>}
              </span>
            </div>
            {hasTotal ? (
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", creditBarColor(provider.credits!.remaining!, provider.credits!.total!))}
                  style={{ width: `${Math.min(100, (provider.credits!.remaining! / provider.credits!.total!) * 100)}%` }}
                />
              </div>
            ) : (
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className={cn("h-full rounded-full w-full", provider.credits!.remaining! > 0 ? "bg-emerald-500" : "bg-red-500")} />
              </div>
            )}
          </div>
        )}
        {provider.plan && <p className="mt-2 text-xs text-muted-foreground">Plan: <span className="text-foreground">{provider.plan}</span></p>}
        {provider.status === "no_api" && !provider.error && <p className="mt-2 text-xs text-muted-foreground italic">Dashboard only</p>}
        {!provider.configured && provider.status === "disconnected" && !provider.error && <p className="mt-2 text-xs text-muted-foreground italic">Not configured</p>}
        {provider.error && <p className="mt-2 text-xs text-red-600 line-clamp-2">{provider.error}</p>}
      </CardContent>
    </Card>
  );
}

function WebhookRow({ webhook }: { webhook: WebhookHealth }) {
  const dotColor = webhook.status === "healthy" ? "bg-[#22c55e]" : webhook.status === "warning" ? "bg-[#f59e0b]" : "bg-zinc-400";
  return (
    <div className="flex items-center justify-between py-3 px-4">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={cn("inline-block h-2 w-2 rounded-full shrink-0", dotColor)} />
        <span className="text-sm font-medium truncate">{webhook.name}</span>
      </div>
      <div className="flex items-center gap-4 shrink-0 text-xs text-muted-foreground">
        <span>{webhook.last24hCount} events / 24h</span>
        <span className="w-20 text-right">{timeAgo(webhook.lastEventAt)}</span>
      </div>
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="p-6 space-y-6">
      <div className="h-12 bg-muted rounded-lg animate-pulse" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 bg-muted rounded-lg animate-pulse" />
        ))}
      </div>
      <div className="h-64 bg-muted rounded-lg animate-pulse" />
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function SystemUptimePage() {
  // Integration data
  const [intData, setIntData] = useState<IntegrationsResponse | null>(null);
  const [intLoading, setIntLoading] = useState(true);

  // Notification health data
  const [notifData, setNotifData] = useState<NotifHealthData | null>(null);
  const [notifLoading, setNotifLoading] = useState(true);
  const [notifRange, setNotifRange] = useState<NotifRange>("24h");

  const [error, setError] = useState<string | null>(null);

  const fetchIntegrations = useCallback(async () => {
    setIntLoading(true);
    try {
      const res = await fetch("/api/integrations/status");
      if (res.status === 401) { window.location.href = "/login"; return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setIntData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load integrations");
    } finally {
      setIntLoading(false);
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    setNotifLoading(true);
    try {
      const res = await fetch(`/api/notification-health?range=${notifRange}`);
      if (res.status === 401) { window.location.href = "/login"; return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: NotifHealthData = await res.json();
      json.byType.sort((a, b) => (STATUS_SORT_ORDER[a.status] ?? 3) - (STATUS_SORT_ORDER[b.status] ?? 3));
      setNotifData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notifications");
    } finally {
      setNotifLoading(false);
    }
  }, [notifRange]);

  useEffect(() => { fetchIntegrations(); }, [fetchIntegrations]);
  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  const handleRefresh = () => {
    setError(null);
    fetchIntegrations();
    fetchNotifications();
  };

  // Integration summary
  const intSummary = useMemo(() => {
    if (!intData) return { connected: 0, attention: 0, disconnected: 0, dashboard: 0 };
    return intData.providers.reduce((acc, p) => {
      if (p.status === "connected") acc.connected++;
      else if (p.status === "degraded") acc.attention++;
      else if (p.status === "disconnected") acc.disconnected++;
      else if (p.status === "no_api") acc.dashboard++;
      return acc;
    }, { connected: 0, attention: 0, disconnected: 0, dashboard: 0 });
  }, [intData]);

  // Group providers by category
  const grouped = useMemo(() => {
    if (!intData) return [];
    const map = new Map<ProviderStatus["category"], ProviderStatus[]>();
    for (const p of intData.providers) {
      const arr = map.get(p.category) ?? [];
      arr.push(p);
      map.set(p.category, arr);
    }
    return CATEGORY_ORDER.filter((cat) => map.has(cat)).map((cat) => ({
      category: cat,
      label: CATEGORY_LABELS[cat],
      providers: map.get(cat)!,
    }));
  }, [intData]);

  const isLoading = intLoading && notifLoading && !intData && !notifData;

  return (
    <div>
      <Header
        title="System Uptime"
        description="Integration health, webhook activity, and notification delivery"
        actions={
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={intLoading && notifLoading}>
            <RefreshCw className={cn("h-4 w-4 mr-2", (intLoading || notifLoading) && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      {error && (
        <div className="mx-6 mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {isLoading ? (
        <PageSkeleton />
      ) : (
        <div className="p-6 space-y-8">
          {/* Section A: Overall Status Banner */}
          <OverallBanner integrations={intData} notifData={notifData} />

          {/* Section B: Integration Health */}
          {intData && (
            <>
              <div>
                <h2 className="text-sm font-medium mb-4">Integration Health</h2>

                {/* Summary cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  <Card density="compact">
                    <CardContent>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="inline-block h-2 w-2 rounded-full bg-[#22c55e]" />
                        <span className="text-xs text-muted-foreground">Connected</span>
                      </div>
                      <p className="text-2xl font-semibold tabular-nums">{intSummary.connected}</p>
                    </CardContent>
                  </Card>
                  <Card density="compact">
                    <CardContent>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="inline-block h-2 w-2 rounded-full bg-[#f59e0b]" />
                        <span className="text-xs text-muted-foreground">Needs Attention</span>
                      </div>
                      <p className="text-2xl font-semibold tabular-nums">{intSummary.attention}</p>
                    </CardContent>
                  </Card>
                  <Card density="compact">
                    <CardContent>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="inline-block h-2 w-2 rounded-full bg-[#ef4444]" />
                        <span className="text-xs text-muted-foreground">Disconnected</span>
                      </div>
                      <p className="text-2xl font-semibold tabular-nums">{intSummary.disconnected}</p>
                    </CardContent>
                  </Card>
                  <Card density="compact">
                    <CardContent>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="inline-block h-2 w-2 rounded-full bg-zinc-400" />
                        <span className="text-xs text-muted-foreground">Dashboard Only</span>
                      </div>
                      <p className="text-2xl font-semibold tabular-nums">{intSummary.dashboard}</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Provider cards by category */}
                <div className="space-y-6">
                  {grouped.map((group) => (
                    <div key={group.category}>
                      <h3 className="text-xs font-medium text-muted-foreground mb-3">{group.label}</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        {group.providers.map((provider) => (
                          <IntegrationCard key={provider.id} provider={provider} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Webhook health */}
              {intData.webhooks.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground mb-3">Webhook Activity</h3>
                  <Card density="compact">
                    <CardContent className="!p-0">
                      <div className="divide-y divide-border">
                        {intData.webhooks.map((wh) => (
                          <WebhookRow key={wh.id} webhook={wh} />
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </>
          )}

          {/* Section C: Notification Health */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium">Notification Health</h2>
              <div className="flex items-center rounded-lg border border-border bg-muted/30 p-0.5">
                {NOTIF_RANGES.map((r) => (
                  <Button
                    key={r.value}
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                      notifRange === r.value && "bg-background shadow-sm text-foreground",
                    )}
                    onClick={() => setNotifRange(r.value)}
                  >
                    {r.label}
                  </Button>
                ))}
              </div>
            </div>

            {notifData && (
              <>
                {/* Summary stats */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <Card density="compact">
                    <CardContent>
                      <p className="text-xs text-muted-foreground mb-1">Total Sent</p>
                      <p className="text-2xl font-semibold tabular-nums">{notifData.summary.sent.toLocaleString()}</p>
                    </CardContent>
                  </Card>
                  <Card density="compact">
                    <CardContent>
                      <p className="text-xs text-muted-foreground mb-1">Total Failed</p>
                      <p className={cn("text-2xl font-semibold tabular-nums", notifData.summary.failed > 0 && "text-[#ef4444]")}>
                        {notifData.summary.failed.toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>
                  <Card density="compact">
                    <CardContent>
                      <p className="text-xs text-muted-foreground mb-1">Failure Rate</p>
                      <p className={cn(
                        "text-2xl font-semibold tabular-nums",
                        notifData.summary.failureRate > 5 ? "text-[#ef4444]" : notifData.summary.failureRate > 0 ? "text-[#f59e0b]" : "text-[#22c55e]",
                      )}>
                        {notifData.summary.failureRate.toFixed(1)}%
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Notification types + failures tabs */}
                <Tabs defaultValue="types">
                  <TabsList>
                    <TabsTrigger value="types">Types ({notifData.byType.length})</TabsTrigger>
                    <TabsTrigger value="failures">Failures ({notifData.recentFailures.length})</TabsTrigger>
                  </TabsList>

                  <TabsContent value="types">
                    <Card>
                      <CardContent className="pt-6">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-[220px]">Type</TableHead>
                              <TableHead>Channels</TableHead>
                              <TableHead>Audience</TableHead>
                              <TableHead>Last Fired</TableHead>
                              <TableHead className="text-right">Sent</TableHead>
                              <TableHead className="text-right">Failed</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {notifData.byType.map((row) => {
                              const failRate = row.total > 0 ? (row.failed / row.total) * 100 : 0;
                              return (
                                <TableRow key={row.notificationType} className={cn(failRate > 5 && "bg-[#ef4444]/5")}>
                                  <TableCell className="font-medium text-sm">
                                    <div className="flex items-center gap-2.5">
                                      <NotifStatusDot status={row.status} />
                                      {row.label}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-sm text-muted-foreground">{row.channels}</TableCell>
                                  <TableCell className="text-sm text-muted-foreground">{row.audience}</TableCell>
                                  <TableCell className="text-sm text-muted-foreground">{row.lastFiredAt ? timeAgo(row.lastFiredAt) : "\u2014"}</TableCell>
                                  <TableCell className="text-right tabular-nums">{row.sent.toLocaleString()}</TableCell>
                                  <TableCell className={cn("text-right tabular-nums", failRate > 5 && "text-[#ef4444] font-medium")}>
                                    {row.failed.toLocaleString()}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="failures">
                    <Card>
                      <CardContent className="pt-6">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Time</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead>Channel</TableHead>
                              <TableHead>Recipient</TableHead>
                              <TableHead>Error</TableHead>
                              <TableHead>Workspace</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {notifData.recentFailures.map((row) => (
                              <TableRow key={row.id}>
                                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{timeAgo(row.createdAt)}</TableCell>
                                <TableCell className="text-sm">{formatType(row.notificationType)}</TableCell>
                                <TableCell><Badge variant="outline" size="xs">{row.channel}</Badge></TableCell>
                                <TableCell className="text-sm max-w-[160px] truncate" title={row.recipient ?? ""}>{row.recipient ?? "-"}</TableCell>
                                <TableCell className="text-sm text-destructive max-w-[240px] truncate" title={row.errorMessage ?? ""}>{row.errorMessage ?? "-"}</TableCell>
                                <TableCell className="text-sm text-muted-foreground">{row.workspaceSlug ?? "-"}</TableCell>
                              </TableRow>
                            ))}
                            {notifData.recentFailures.length === 0 && (
                              <TableRow>
                                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                  No failures in this time range
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              </>
            )}

            {notifLoading && !notifData && (
              <div className="h-64 bg-muted rounded-lg animate-pulse" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
