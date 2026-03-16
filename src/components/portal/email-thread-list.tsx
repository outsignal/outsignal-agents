"use client";

import { Mail } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ThreadSummary {
  threadId: number;
  leadEmail: string;
  leadName: string | null;
  subject: string | null;
  lastSnippet: string;
  lastMessageAt: string;
  messageCount: number;
  interested: boolean;
  replyStatus: "awaiting_reply" | "replied" | "new";
  hasAiSuggestion: boolean;
  isRead?: boolean;
  intent?: string | null;
  sentiment?: string | null;
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

const STATUS_DOT: Record<ThreadSummary["replyStatus"], string> = {
  new: "bg-blue-500",
  awaiting_reply: "bg-amber-400",
  replied: "bg-emerald-500",
};

const STATUS_LABEL: Record<ThreadSummary["replyStatus"], string> = {
  new: "New",
  awaiting_reply: "Awaiting reply",
  replied: "Replied",
};

function getIntentBadgeColor(intent: string): string {
  switch (intent) {
    case "interested":
    case "meeting_booked":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
    case "objection":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    case "out_of_office":
    case "auto_reply":
    case "not_now":
    case "referral":
      return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400";
    case "unsubscribe":
    case "not_relevant":
      return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    default:
      return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400";
  }
}

function formatIntent(intent: string): string {
  switch (intent) {
    case "meeting_booked": return "Meeting";
    case "out_of_office": return "OOO";
    case "auto_reply": return "Auto";
    case "not_relevant": return "Not Relevant";
    case "not_interested": return "Not Interested";
    case "not_now": return "Not Now";
    default:
      return intent.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

interface EmailThreadListProps {
  threads: ThreadSummary[];
  selectedThreadId: number | null;
  onSelectThread: (threadId: number) => void;
}

export function EmailThreadList({
  threads,
  selectedThreadId,
  onSelectThread,
}: EmailThreadListProps) {
  if (threads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 text-center px-4">
        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
          <Mail className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">All caught up</p>
        <p className="text-xs text-muted-foreground mt-1">
          No replies to review right now.
        </p>
      </div>
    );
  }

  return (
    <div>
      {threads.map((thread) => {
        const isSelected = thread.threadId === selectedThreadId;
        const displayName = thread.leadName || thread.leadEmail;
        const snippet = thread.lastSnippet.slice(0, 100);
        const isUnread = thread.isRead === false;

        return (
          <button
            key={thread.threadId}
            onClick={() => onSelectThread(thread.threadId)}
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
              {/* Status dot */}
              <span
                className={cn(
                  "mt-1.5 h-2 w-2 rounded-full shrink-0",
                  STATUS_DOT[thread.replyStatus]
                )}
                title={STATUS_LABEL[thread.replyStatus]}
              />

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
                    {timeAgo(thread.lastMessageAt)}
                  </span>
                </div>

                {/* Subject */}
                {thread.subject && (
                  <p
                    className={cn(
                      "text-xs truncate mt-0.5",
                      isUnread
                        ? "font-medium text-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {thread.subject}
                  </p>
                )}

                {/* Snippet */}
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {snippet}
                </p>

                {/* Tags row */}
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  {thread.workspaceName && (
                    <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground border border-border">
                      {thread.workspaceName}
                    </span>
                  )}
                  {thread.interested && (
                    <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Interested
                    </span>
                  )}
                  {thread.intent && (
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                        getIntentBadgeColor(thread.intent)
                      )}
                    >
                      {formatIntent(thread.intent)}
                    </span>
                  )}
                  {thread.hasAiSuggestion && (
                    <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-purple-50 text-purple-600 border border-purple-200">
                      AI ready
                    </span>
                  )}
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
