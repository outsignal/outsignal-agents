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
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
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

type StatusType = "new" | "awaiting_reply";

const STATUS_DOT: Record<StatusType, string> = {
  new: "bg-blue-500",
  awaiting_reply: "bg-amber-400",
};

const STATUS_LABEL: Record<StatusType, string> = {
  new: "New",
  awaiting_reply: "Awaiting reply",
};

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
        <p className="text-sm font-medium">No LinkedIn conversations yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Conversations will appear here once synced from LinkedIn.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {conversations.map((convo) => {
        const isSelected = convo.id === selectedConversationId;
        const displayName = convo.participantName ?? "Unknown";
        const subtitle = buildSubtitle(convo.jobTitle, convo.company);
        const snippet = convo.lastMessageSnippet?.slice(0, 80) ?? "";
        const status: StatusType =
          convo.unreadCount > 0 ? "new" : "awaiting_reply";

        return (
          <button
            key={convo.id}
            onClick={() => onSelectConversation(convo.id)}
            className={cn(
              "w-full text-left px-4 py-3 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isSelected && "bg-accent"
            )}
          >
            <div className="flex items-start gap-2">
              {/* Channel icon */}
              <Linkedin className="mt-1.5 h-3.5 w-3.5 text-muted-foreground shrink-0" />

              {/* Status dot */}
              <span
                className={cn(
                  "mt-1.5 h-2 w-2 rounded-full shrink-0",
                  STATUS_DOT[status]
                )}
                title={STATUS_LABEL[status]}
              />

              <div className="flex-1 min-w-0">
                {/* Top row: name + timestamp */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold truncate">
                    {displayName}
                  </span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                    {timeAgo(convo.lastActivityAt)}
                  </span>
                </div>

                {/* Job Title @ Company subtitle */}
                {subtitle && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {subtitle}
                  </p>
                )}

                {/* Snippet */}
                {snippet && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {snippet}
                  </p>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
