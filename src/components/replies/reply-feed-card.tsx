"use client";

import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { IntentBadge } from "./intent-badge";
import { SentimentBadge } from "./sentiment-badge";
import type { FeedReply } from "./types";

// Deterministic color for workspace badges
const WORKSPACE_COLORS = [
  "bg-violet-100 text-violet-700",
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
  "bg-fuchsia-100 text-fuchsia-700",
  "bg-lime-100 text-lime-700",
  "bg-orange-100 text-orange-700",
  "bg-teal-100 text-teal-700",
];

function getWorkspaceColor(slug: string): string {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = slug.charCodeAt(i) + ((hash << 5) - hash);
  }
  return WORKSPACE_COLORS[Math.abs(hash) % WORKSPACE_COLORS.length];
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

interface ReplyFeedCardProps {
  reply: FeedReply;
  onClick: () => void;
}

export function ReplyFeedCard({ reply, onClick }: ReplyFeedCardProps) {
  const wsColor = getWorkspaceColor(reply.workspaceSlug);

  return (
    <div
      onClick={onClick}
      className="group flex flex-col gap-2 rounded-lg border border-border bg-card p-4 cursor-pointer transition-all duration-150 hover:border-[#635BFF]/30 hover:shadow-sm"
    >
      {/* Top row: workspace badge + timestamp + portal link */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              "shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              wsColor,
            )}
          >
            {reply.workspaceName}
          </span>
          {reply.campaignName && (
            <span className="truncate text-xs text-muted-foreground">
              {reply.campaignName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground">
            {relativeTime(reply.receivedAt)}
          </span>
          <a
            href={reply.portalUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-muted-foreground hover:text-[#635BFF] transition-colors"
            title="View in portal"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      {/* Sender info */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium truncate">
          {reply.senderName ?? reply.senderEmail}
        </span>
        {reply.senderName && (
          <span className="text-xs text-muted-foreground truncate">
            {reply.senderEmail}
          </span>
        )}
      </div>

      {/* Subject + body preview */}
      {reply.subject && (
        <p className="text-sm font-medium truncate text-foreground">
          {reply.subject}
        </p>
      )}
      <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
        {reply.bodyText}
      </p>

      {/* Classification badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <IntentBadge
          intent={reply.intent}
          overrideIntent={reply.overrideIntent}
        />
        <SentimentBadge
          sentiment={reply.sentiment}
          overrideSentiment={reply.overrideSentiment}
        />
        {(reply.overrideObjSubtype ?? reply.objectionSubtype) && (
          <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-800">
            {reply.overrideObjSubtype ?? reply.objectionSubtype}
          </span>
        )}
      </div>
    </div>
  );
}
