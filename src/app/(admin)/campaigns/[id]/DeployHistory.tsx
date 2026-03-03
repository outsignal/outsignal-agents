"use client";

import { useEffect, useState } from "react";

interface CampaignDeploy {
  id: string;
  campaignId: string;
  campaignName: string;
  workspaceSlug: string;
  status: string;
  emailStatus: string | null;
  linkedinStatus: string | null;
  leadCount: number;
  emailStepCount: number;
  linkedinStepCount: number;
  emailBisonCampaignId: number | null;
  emailError: string | null;
  linkedinError: string | null;
  error: string | null;
  channels: string; // JSON array string
  retryChannel: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface DeployHistoryProps {
  campaignId: string;
}

// ─── Status badge ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; label: string }> = {
    complete: { bg: "bg-emerald-900/60 text-emerald-300", label: "Complete" },
    partial_failure: { bg: "bg-amber-900/60 text-amber-300", label: "Partial Failure" },
    failed: { bg: "bg-red-900/60 text-red-300", label: "Failed" },
    running: { bg: "bg-blue-900/60 text-blue-300", label: "Running" },
    pending: { bg: "bg-zinc-700 text-zinc-300", label: "Pending" },
  };
  const cfg = map[status] ?? { bg: "bg-zinc-700 text-zinc-400", label: status };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cfg.bg}`}>
      {cfg.label}
    </span>
  );
}

// ─── Error cell with truncation + tooltip ────────────────────────────────────

function ErrorCell({ text }: { text: string | null }) {
  if (!text) return <span className="text-zinc-600">—</span>;
  const truncated = text.length > 50 ? text.slice(0, 50) + "…" : text;
  return (
    <span className="text-red-400" title={text}>
      {truncated}
    </span>
  );
}

// ─── Retry button ─────────────────────────────────────────────────────────────

function RetryButton({
  campaignId,
  channel,
  onSuccess,
}: {
  campaignId: string;
  channel: "email" | "linkedin";
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);

  async function handleRetry() {
    setLoading(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/deploy?retry=${channel}`, {
        method: "POST",
      });
      onSuccess();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleRetry}
      disabled={loading}
      className="ml-2 rounded px-2 py-0.5 text-xs font-medium text-zinc-300 border border-zinc-700 hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-50 transition-colors"
    >
      {loading ? "..." : `Retry ${channel === "email" ? "Email" : "LinkedIn"}`}
    </button>
  );
}

// ─── Parse channels JSON ──────────────────────────────────────────────────────

function parseChannels(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : ["email"];
  } catch {
    return ["email"];
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DeployHistory({ campaignId }: DeployHistoryProps) {
  const [deploys, setDeploys] = useState<CampaignDeploy[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchHistory() {
    setLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/deploys`);
      if (res.ok) {
        const data = await res.json();
        setDeploys(data.deploys ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-zinc-500">
        Loading deploy history...
      </div>
    );
  }

  if (deploys.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-zinc-500">
        No deploys yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-zinc-800 text-xs text-zinc-400 uppercase tracking-wide">
            <th className="px-4 py-3 text-left font-medium">Timestamp</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-left font-medium">Channels</th>
            <th className="px-4 py-3 text-right font-medium">Leads</th>
            <th className="px-4 py-3 text-right font-medium">Email Steps</th>
            <th className="px-4 py-3 text-right font-medium">LI Steps</th>
            <th className="px-4 py-3 text-left font-medium">Error</th>
          </tr>
        </thead>
        <tbody>
          {deploys.map((deploy, i) => {
            const channels = parseChannels(deploy.channels);
            const isFailedDeploy =
              deploy.status === "partial_failure" || deploy.status === "failed";
            const errorText = deploy.emailError ?? deploy.linkedinError ?? deploy.error;

            return (
              <tr
                key={deploy.id}
                className={
                  i % 2 === 0
                    ? "bg-zinc-900 hover:bg-zinc-800/50"
                    : "bg-zinc-950 hover:bg-zinc-800/50"
                }
              >
                {/* Timestamp */}
                <td className="px-4 py-3 text-zinc-300 whitespace-nowrap">
                  {new Date(deploy.createdAt).toLocaleString()}
                </td>

                {/* Status */}
                <td className="px-4 py-3">
                  <StatusBadge status={deploy.status} />
                </td>

                {/* Channels — colored badges */}
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {channels.map((ch) => (
                      <span
                        key={ch}
                        className="rounded-full bg-zinc-700 px-2 py-0.5 text-xs text-zinc-300"
                      >
                        {ch}
                      </span>
                    ))}
                  </div>
                </td>

                {/* Leads */}
                <td className="px-4 py-3 text-right text-zinc-300">
                  {deploy.leadCount.toLocaleString()}
                </td>

                {/* Email steps */}
                <td className="px-4 py-3 text-right text-zinc-300">
                  {deploy.emailStepCount}
                </td>

                {/* LinkedIn steps */}
                <td className="px-4 py-3 text-right text-zinc-300">
                  {deploy.linkedinStepCount}
                </td>

                {/* Error + Retry buttons */}
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1">
                    <ErrorCell text={errorText ?? null} />
                    {isFailedDeploy && deploy.emailStatus === "failed" && (
                      <RetryButton
                        campaignId={campaignId}
                        channel="email"
                        onSuccess={fetchHistory}
                      />
                    )}
                    {isFailedDeploy && deploy.linkedinStatus === "failed" && (
                      <RetryButton
                        campaignId={campaignId}
                        channel="linkedin"
                        onSuccess={fetchHistory}
                      />
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
