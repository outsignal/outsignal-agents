"use client";

import { Linkedin } from "lucide-react";
import { cn } from "@/lib/utils";

export interface LinkedInConversationSummary {
  id: string;
  participantName: string | null;
  lastMessageSnippet: string | null;
  lastActivityAt: string;
  unreadCount: number;
  jobTitle: string | null;
  company: string | null;
  initiatedByWorker?: boolean;
  workspaceName?: string; // For admin mode
  workspaceSlug?: string; // For admin mode
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;

  const months = Math.floor(days / 30);
  return `${months}mo`;
}

function buildSubtitle(
  jobTitle: string | null,
  company: string | null
): string | null {
  if (jobTitle && company) return `${jobTitle} @ ${company}`;
  if (jobTitle) return jobTitle;
  if (company) return company;
  return null;
}

interface LinkedInConversationListProps {
  conversations: LinkedInConversationSummary[];
  selectedConversationId: string | null;
  onSelectConversation: (id: string) => void;
}

export function LinkedInConversationList({
  conversations,
  selectedConversationId,
  onSelectConversation,
}: LinkedInConversationListProps) {
  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 text-center px-4">
        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
          <Linkedin className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">All caught up</p>
        <p className="text-xs text-muted-foreground mt-1">
          No LinkedIn conversations to review right now.
        </p>
      </div>
    );
  }

  return (
    <div>
      {conversations.map((convo) => {
        const isSelected = convo.id === selectedConversationId;
        const displayName = convo.participantName ?? "Unknown";
        const subtitle = buildSubtitle(convo.jobTitle, convo.company);
        const snippet = convo.lastMessageSnippet?.slice(0, 100) ?? "";
        const isUnread = convo.unreadCount > 0;

        return (
          <button
            key={convo.id}
            onClick={() => onSelectConversation(convo.id)}
            className={cn(
              "w-full text-left px-4 py-3 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring relative",
              // Unread: purple left border
              isUnread && "border-l-2 border-l-brand",
              !isUnread && "border-l-2 border-l-transparent",
              // Selected state
              isSelected && "bg-muted",
              // Hover state
              !isSelected && "hover:bg-muted"
            )}
          >
            <div className="flex items-start gap-2.5">
              {/* LinkedIn icon */}
              <Linkedin className="mt-1 h-3.5 w-3.5 text-muted-foreground shrink-0" />

              <div className="flex-1 min-w-0">
                {/* Top row: name + timestamp */}
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "text-sm truncate",
                      isUnread
                        ? "font-semibold text-foreground"
                        : "font-normal text-foreground"
                    )}
                  >
                    {displayName}
                  </span>
                  <span className="text-[11px] font-mono text-muted-foreground whitespace-nowrap shrink-0 tabular-nums">
                    {timeAgo(convo.lastActivityAt)}
                  </span>
                </div>

                {/* Job Title @ Company subtitle */}
                {subtitle && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {subtitle}
                  </p>
                )}

                {/* Outreach / Organic badge */}
                {convo.initiatedByWorker != null && (
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium mt-0.5 mr-auto",
                      convo.initiatedByWorker
                        ? "bg-[#635BFF]/10 text-[#635BFF]"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {convo.initiatedByWorker ? "Outreach" : "Organic"}
                  </span>
                )}

                {/* Snippet */}
                {snippet && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {snippet}
                  </p>
                )}

                {/* Workspace badge — admin mode */}
                {convo.workspaceName && (
                  <div className="mt-1.5">
                    <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground border border-border">
                      {convo.workspaceName}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
