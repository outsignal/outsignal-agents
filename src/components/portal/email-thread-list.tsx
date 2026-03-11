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
        <p className="text-sm font-medium">No email conversations yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Reply threads from your campaigns will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {threads.map((thread) => {
        const isSelected = thread.threadId === selectedThreadId;
        const displayName = thread.leadName || thread.leadEmail;
        const snippet = thread.lastSnippet.slice(0, 80);

        return (
          <button
            key={thread.threadId}
            onClick={() => onSelectThread(thread.threadId)}
            className={cn(
              "w-full text-left px-4 py-3 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isSelected && "bg-accent",
              thread.interested &&
                !isSelected &&
                "bg-yellow-50 dark:bg-yellow-950/20 hover:bg-yellow-100/60 dark:hover:bg-yellow-950/30"
            )}
          >
            <div className="flex items-start gap-2">
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
                  <span className="text-sm font-semibold truncate">
                    {displayName}
                  </span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                    {timeAgo(thread.lastMessageAt)}
                  </span>
                </div>

                {/* Subject */}
                {thread.subject && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {thread.subject}
                  </p>
                )}

                {/* Snippet */}
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {snippet}
                </p>

                {/* Tags row */}
                <div className="flex items-center gap-1.5 mt-1">
                  {thread.interested && (
                    <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-[#F0FF7A]/30 text-yellow-800 dark:text-yellow-300 border border-[#F0FF7A]/50">
                      Interested
                    </span>
                  )}
                  {thread.hasAiSuggestion && (
                    <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300">
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
