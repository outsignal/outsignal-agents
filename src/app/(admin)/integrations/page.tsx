"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { RefreshCw, ExternalLink } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type ConnectionStatus = "connected" | "disconnected" | "degraded" | "no_api";

interface ProviderStatus {
  id: string;
  name: string;
  category:
    | "enrichment"
    | "ai"
    | "discovery"
    | "scraping"
    | "notifications"
    | "infrastructure";
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

// ─── Category config ──────────────────────────────────────────────────────────

const CATEGORY_ORDER: ProviderStatus["category"][] = [
  "infrastructure",
  "enrichment",
  "discovery",
  "ai",
  "scraping",
  "notifications",
];

const CATEGORY_LABELS: Record<ProviderStatus["category"], string> = {
  infrastructure: "Infrastructure",
  enrichment: "Enrichment",
  discovery: "Discovery",
  ai: "AI / LLM",
  scraping: "Scraping",
  notifications: "Notifications",
};

// ─── Helper components ────────────────────────────────────────────────────────

function StatusDot({ status }: { status: ConnectionStatus }) {
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 rounded-full shrink-0",
        status === "connected" && "bg-emerald-500",
        status === "degraded" && "bg-amber-500",
        status === "disconnected" && "bg-red-500",
        status === "no_api" && "bg-zinc-400",
      )}
    />
  );
}

function StatusBadge({ status }: { status: ConnectionStatus }) {
  const variantMap: Record<
    ConnectionStatus,
    "success" | "warning" | "destructive" | "secondary"
  > = {
    connected: "success",
    degraded: "warning",
    disconnected: "destructive",
    no_api: "secondary",
  };

  const labelMap: Record<ConnectionStatus, string> = {
    connected: "Connected",
    degraded: "Degraded",
    disconnected: "Disconnected",
    no_api: "Dashboard",
  };

  return (
    <Badge variant={variantMap[status]} size="xs">
      {labelMap[status]}
    </Badge>
  );
}

function creditBarColor(remaining: number, total: number): string {
  const pct = total > 0 ? remaining / total : 0;
  if (pct > 0.25) return "bg-emerald-500";
  if (pct > 0.1) return "bg-amber-500";
  return "bg-red-500";
}

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

function SummaryDot({ color }: { color: string }) {
  return <span className={cn("inline-block h-2 w-2 rounded-full", color)} />;
}

// ─── Skeleton (inline, for initial load with no data) ─────────────────────────

function InlineSkeleton() {
  return (
    <div className="p-6 space-y-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} density="compact">
            <CardContent>
              <div className="h-3 bg-muted rounded w-24 mb-3 animate-pulse" />
              <div className="h-8 bg-muted rounded w-12 animate-pulse" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <Card key={i} density="compact">
            <CardContent>
              <div className="flex items-center gap-2 mb-3">
                <div className="h-2.5 w-2.5 bg-muted rounded-full animate-pulse" />
                <div className="h-4 w-28 bg-muted rounded animate-pulse" />
              </div>
              <div className="h-3 bg-muted rounded w-full mb-2 animate-pulse" />
              <div className="h-3 bg-muted rounded w-3/4 animate-pulse" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Integration card ─────────────────────────────────────────────────────────

function IntegrationCard({ provider }: { provider: ProviderStatus }) {
  const hasCredits =
    provider.credits && provider.credits.remaining != null;
  const hasTotal =
    hasCredits && provider.credits!.total != null && provider.credits!.total! > 0;

  return (
    <Card density="compact">
      <CardContent>
        {/* Top row: dot + name + badge + external link */}
        <div className="flex items-center gap-2">
          <StatusDot status={provider.status} />
          <span className="text-sm font-medium truncate flex-1">
            {provider.name}
          </span>
          <StatusBadge status={provider.status} />
          {provider.dashboardUrl && (
            <a
              href={provider.dashboardUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Open dashboard"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>

        {/* Credits */}
        {hasCredits && (
          <div className="mt-3 space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Credits</span>
              <span className="font-mono">
                {provider.credits!.remaining!.toLocaleString()}
                {hasTotal && (
                  <span> / {provider.credits!.total!.toLocaleString()}</span>
                )}
              </span>
            </div>
            {hasTotal ? (
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    creditBarColor(
                      provider.credits!.remaining!,
                      provider.credits!.total!,
                    ),
                  )}
                  style={{
                    width: `${Math.min(100, (provider.credits!.remaining! / provider.credits!.total!) * 100)}%`,
                  }}
                />
              </div>
            ) : (
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all w-full",
                    provider.credits!.remaining! > 0
                      ? "bg-emerald-500"
                      : "bg-red-500",
                  )}
                />
              </div>
            )}
          </div>
        )}

        {/* Plan */}
        {provider.plan && (
          <p className="mt-2 text-xs text-muted-foreground">
            Plan: <span className="text-foreground">{provider.plan}</span>
          </p>
        )}

        {/* Billing */}
        {provider.billing?.nextDate && (
          <p className="mt-1 text-xs text-muted-foreground">
            Next billing:{" "}
            <span className="text-foreground">
              {new Date(provider.billing.nextDate).toLocaleDateString(
                undefined,
                { month: "short", day: "numeric", year: "numeric" },
              )}
            </span>
            {provider.billing.period && (
              <span className="text-muted-foreground">
                {" "}
                ({provider.billing.period})
              </span>
            )}
          </p>
        )}

        {/* Dashboard only */}
        {provider.status === "no_api" && !provider.error && (
          <p className="mt-2 text-xs text-muted-foreground italic">
            Dashboard only &mdash; no API integration
          </p>
        )}

        {/* Not configured */}
        {!provider.configured &&
          provider.status === "disconnected" &&
          !provider.error && (
            <p className="mt-2 text-xs text-muted-foreground italic">
              Not configured
            </p>
          )}

        {/* Error */}
        {provider.error && (
          <p className="mt-2 text-xs text-red-600 line-clamp-2">
            {provider.error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Webhook row ──────────────────────────────────────────────────────────────

function WebhookRow({ webhook }: { webhook: WebhookHealth }) {
  const dotColor =
    webhook.status === "healthy"
      ? "bg-emerald-500"
      : webhook.status === "warning"
        ? "bg-amber-500"
        : "bg-zinc-400";

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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const [data, setData] = useState<IntegrationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/status");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // ─── Derived counts ──────────────────────────────────────────────────────────

  const summary = useMemo(() => {
    if (!data) return { connected: 0, attention: 0, disconnected: 0, dashboard: 0 };
    return data.providers.reduce(
      (acc, p) => {
        if (p.status === "connected") acc.connected++;
        else if (p.status === "degraded") acc.attention++;
        else if (p.status === "disconnected") acc.disconnected++;
        else if (p.status === "no_api") acc.dashboard++;
        return acc;
      },
      { connected: 0, attention: 0, disconnected: 0, dashboard: 0 },
    );
  }, [data]);

  // ─── Group providers by category ─────────────────────────────────────────────

  const grouped = useMemo(() => {
    if (!data) return [];
    const map = new Map<ProviderStatus["category"], ProviderStatus[]>();
    for (const p of data.providers) {
      const arr = map.get(p.category) ?? [];
      arr.push(p);
      map.set(p.category, arr);
    }
    return CATEGORY_ORDER.filter((cat) => map.has(cat)).map((cat) => ({
      category: cat,
      label: CATEGORY_LABELS[cat],
      providers: map.get(cat)!,
    }));
  }, [data]);

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div>
      <Header
        title="Integrations"
        description="External service connections and billing"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchData()}
            disabled={loading}
          >
            <RefreshCw
              className={cn("h-4 w-4 mr-2", loading && "animate-spin")}
            />
            Refresh
          </Button>
        }
      />

      {/* Error state */}
      {error && (
        <div className="p-6">
          <ErrorBanner
            message={`Failed to load integrations: ${error}`}
            onRetry={() => void fetchData()}
          />
        </div>
      )}

      {/* Loading skeleton when no data yet */}
      {loading && !data && <InlineSkeleton />}

      {/* Main content */}
      {data && (
        <div className="p-6 space-y-8">
          {/* Summary row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card density="compact">
              <CardContent>
                <div className="flex items-center gap-2 mb-1">
                  <SummaryDot color="bg-emerald-500" />
                  <span className="text-xs text-muted-foreground">
                    Connected
                  </span>
                </div>
                <p className="text-2xl font-semibold tabular-nums">
                  {summary.connected}
                </p>
              </CardContent>
            </Card>
            <Card density="compact">
              <CardContent>
                <div className="flex items-center gap-2 mb-1">
                  <SummaryDot color="bg-amber-500" />
                  <span className="text-xs text-muted-foreground">
                    Needs Attention
                  </span>
                </div>
                <p className="text-2xl font-semibold tabular-nums">
                  {summary.attention}
                </p>
              </CardContent>
            </Card>
            <Card density="compact">
              <CardContent>
                <div className="flex items-center gap-2 mb-1">
                  <SummaryDot color="bg-red-500" />
                  <span className="text-xs text-muted-foreground">
                    Disconnected
                  </span>
                </div>
                <p className="text-2xl font-semibold tabular-nums">
                  {summary.disconnected}
                </p>
              </CardContent>
            </Card>
            <Card density="compact">
              <CardContent>
                <div className="flex items-center gap-2 mb-1">
                  <SummaryDot color="bg-zinc-400" />
                  <span className="text-xs text-muted-foreground">
                    Dashboard Only
                  </span>
                </div>
                <p className="text-2xl font-semibold tabular-nums">
                  {summary.dashboard}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Provider sections by category */}
          {grouped.map((group) => (
            <div key={group.category}>
              <h2 className="text-xs font-medium text-muted-foreground mb-3">
                {group.label}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {group.providers.map((provider) => (
                  <IntegrationCard key={provider.id} provider={provider} />
                ))}
              </div>
            </div>
          ))}

          {/* Webhook Health */}
          {data.webhooks.length > 0 && (
            <div>
              <h2 className="text-xs font-medium text-muted-foreground mb-3">
                Webhook Health
              </h2>
              <Card density="compact">
                <CardContent className="!p-0">
                  <div className="divide-y divide-border">
                    {data.webhooks.map((wh) => (
                      <WebhookRow key={wh.id} webhook={wh} />
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Last checked timestamp */}
          <p className="text-xs text-muted-foreground text-right">
            Last checked {timeAgo(data.checkedAt)}
          </p>
        </div>
      )}
    </div>
  );
}
