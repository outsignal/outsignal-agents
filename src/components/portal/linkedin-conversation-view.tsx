"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { RefreshCw, AlertCircle, Linkedin, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface LinkedInMessageItem {
  id: string;
  eventUrn: string;
  senderUrn: string;
  senderName: string | null;
  body: string;
  isOutbound: boolean;
  deliveredAt: string;
}

interface OptimisticMessage {
  id: string;
  body: string;
  isOutbound: true;
  deliveredAt: string;
  queueStatus: "Queued" | "Sent" | "Failed";
  actionId: string | null;
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

const QUEUE_STATUS_BADGE: Record<
  OptimisticMessage["queueStatus"],
  { label: string; className: string }
> = {
  Queued: {
    label: "Queued",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  },
  Sent: {
    label: "Sent",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  Failed: {
    label: "Failed",
    className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  },
};

interface LinkedInConversationViewProps {
  conversationId: string;
  onMessageSent: () => void;
  onSwitchChannel?: (threadId: number) => void;
  crossChannel?: { type: "email"; threadId: number } | null;
  /** Override messages API path (admin mode). */
  messagesBasePath?: string;
  /** Override reply endpoint (admin mode). */
  replyEndpoint?: string;
  /** Extra body fields for reply (admin mode). */
  replyExtraBody?: Record<string, string>;
}

export function LinkedInConversationView({
  conversationId,
  onMessageSent,
  onSwitchChannel,
  crossChannel,
  messagesBasePath = "/api/portal/inbox/linkedin/conversations",
  replyEndpoint = "/api/portal/inbox/linkedin/reply",
  replyExtraBody = {},
}: LinkedInConversationViewProps) {
  const [messages, setMessages] = useState<LinkedInMessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [participantName, setParticipantName] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<
    OptimisticMessage[]
  >([]);
  const [composerText, setComposerText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [newMessageIds, setNewMessageIds] = useState<Set<string>>(new Set());

  const bottomRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const fetchMessages = useCallback(
    async (refresh = false) => {
      try {
        const url = `${messagesBasePath}/${conversationId}/messages${refresh ? "?refresh=true" : ""}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load messages");
        const data = (await res.json()) as {
          messages: LinkedInMessageItem[];
          participantName: string | null;
        };
        return data;
      } catch (err) {
        throw err;
      }
    },
    [conversationId, messagesBasePath]
  );

  // Initial load
  useEffect(() => {
    setLoading(true);
    setError(null);
    setOptimisticMessages([]);
    setComposerText("");
    setSendError(null);
    setNewMessageIds(new Set());

    fetchMessages()
      .then((data) => {
        setMessages(data.messages);
        setParticipantName(data.participantName);
      })
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : "Failed to load messages"
        );
      })
      .finally(() => {
        setLoading(false);
        setTimeout(scrollToBottom, 100);
      });
  }, [conversationId, fetchMessages, scrollToBottom]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(scrollToBottom, 50);
    }
  }, [messages.length, scrollToBottom]);

  // Scroll to bottom when optimistic message added
  useEffect(() => {
    if (optimisticMessages.length > 0) {
      setTimeout(scrollToBottom, 50);
    }
  }, [optimisticMessages.length, scrollToBottom]);

  // Start polling for a specific actionId
  const startPolling = useCallback(
    (actionId: string, optimisticId: string) => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }

      pollingRef.current = setInterval(async () => {
        try {
          const res = await fetch(
            `/api/portal/inbox/linkedin/actions/${actionId}/status`
          );
          if (!res.ok) return;
          const data = (await res.json()) as {
            status: string;
            completedAt: string | null;
          };

          if (data.status === "complete" || data.status === "completed") {
            clearInterval(pollingRef.current!);
            pollingRef.current = null;
            setOptimisticMessages((prev) =>
              prev.map((m) =>
                m.id === optimisticId ? { ...m, queueStatus: "Sent" } : m
              )
            );
          } else if (data.status === "failed") {
            clearInterval(pollingRef.current!);
            pollingRef.current = null;
            setOptimisticMessages((prev) =>
              prev.map((m) =>
                m.id === optimisticId ? { ...m, queueStatus: "Failed" } : m
              )
            );
          }
        } catch {
          // Silently ignore polling errors
        }
      }, 5000);
    },
    []
  );

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  const handleQueueMessage = async () => {
    const text = composerText.trim();
    if (!text || sending) return;

    setSending(true);
    setSendError(null);

    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticMsg: OptimisticMessage = {
      id: optimisticId,
      body: text,
      isOutbound: true,
      deliveredAt: new Date().toISOString(),
      queueStatus: "Queued",
      actionId: null,
    };

    setOptimisticMessages((prev) => [...prev, optimisticMsg]);
    setComposerText("");

    try {
      const res = await fetch(replyEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: text, ...replyExtraBody }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error || "Failed to queue message"
        );
      }

      const data = (await res.json()) as { actionId: string };
      const actionId = data.actionId;

      setOptimisticMessages((prev) =>
        prev.map((m) => (m.id === optimisticId ? { ...m, actionId } : m))
      );

      startPolling(actionId, optimisticId);
      onMessageSent();
    } catch (err) {
      setSendError(
        err instanceof Error ? err.message : "Failed to queue message"
      );
      setOptimisticMessages((prev) =>
        prev.map((m) =>
          m.id === optimisticId ? { ...m, queueStatus: "Failed" } : m
        )
      );
    } finally {
      setSending(false);
    }
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);

    try {
      const res = await fetch("/api/portal/inbox/linkedin/sync", {
        method: "POST",
      });
      const data = (await res.json()) as {
        syncing: boolean;
        lastSyncedAt?: string | null;
      };

      if (data.lastSyncedAt) {
        setLastSyncedAt(data.lastSyncedAt);
      }

      if (data.syncing) {
        // Worker is syncing — wait 5s then re-fetch
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }

      // Re-fetch messages to show latest
      const oldIds = new Set(messages.map((m) => m.id));
      const refreshedData = await fetchMessages(true);
      const newIds = new Set<string>();
      for (const m of refreshedData.messages) {
        if (!oldIds.has(m.id)) {
          newIds.add(m.id);
        }
      }

      setMessages(refreshedData.messages);
      setParticipantName(refreshedData.participantName);

      // Clear optimistic messages — DB messages replace them
      setOptimisticMessages([]);

      // Highlight new messages briefly
      if (newIds.size > 0) {
        setNewMessageIds(newIds);
        setTimeout(() => {
          setNewMessageIds(new Set());
        }, 1100);
      }

      if (!data.lastSyncedAt) {
        setLastSyncedAt(new Date().toISOString());
      }
    } catch {
      // Silently degrade — refresh failed
    } finally {
      setRefreshing(false);
    }
  };

  // Merge DB + optimistic messages and sort by deliveredAt
  const allMessages = [
    ...messages.map((m) => ({ ...m, isOptimistic: false as const })),
    ...optimisticMessages.map((m) => ({ ...m, isOptimistic: true as const })),
  ].sort(
    (a, b) =>
      new Date(a.deliveredAt).getTime() - new Date(b.deliveredAt).getTime()
  );

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        {/* Skeleton header */}
        <div className="px-5 py-3 border-b border-border shrink-0">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-20 mt-1" />
        </div>
        {/* Skeleton bubbles */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {[
            { out: false, w: "w-48" },
            { out: true, w: "w-56" },
            { out: false, w: "w-40" },
            { out: true, w: "w-64" },
            { out: false, w: "w-52" },
          ].map(({ out, w }, i) => (
            <div
              key={i}
              className={cn("flex", out ? "justify-end" : "justify-start")}
            >
              <Skeleton className={cn("h-10 rounded-2xl", w)} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <AlertCircle className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setLoading(true);
            setError(null);
            fetchMessages()
              .then((data) => {
                setMessages(data.messages);
                setParticipantName(data.participantName);
              })
              .catch((err) =>
                setError(
                  err instanceof Error ? err.message : "Failed to load messages"
                )
              )
              .finally(() => setLoading(false));
          }}
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Conversation header */}
      <div className="px-5 py-3 border-b border-border shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate">
              {participantName ?? "LinkedIn Conversation"}
            </h2>
            {lastSyncedAt && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Last synced {timeAgo(lastSyncedAt)}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh messages from LinkedIn"
          >
            <RefreshCw
              className={cn("h-4 w-4", refreshing && "animate-spin")}
            />
            <span className="sr-only">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {/* Cross-channel indicator */}
        {crossChannel?.type === "email" && onSwitchChannel && (
          <div>
            <button
              onClick={() => onSwitchChannel(crossChannel.threadId)}
              className="inline-flex items-center gap-1.5 text-xs text-blue-600 border border-blue-200 rounded-full px-2.5 py-1 hover:bg-blue-50 dark:hover:bg-blue-950/30 dark:border-blue-800 dark:text-blue-400 mb-1"
            >
              <Mail className="h-3 w-3" /> Also on Email →
            </button>
          </div>
        )}

        {allMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-3">
              <Linkedin className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">No messages yet</p>
          </div>
        )}

        {allMessages.map((msg) => {
          const isHighlighted =
            !msg.isOptimistic && newMessageIds.has(msg.id);

          if (msg.isOutbound) {
            const queueStatus = msg.isOptimistic
              ? (msg as OptimisticMessage).queueStatus
              : null;
            const badge = queueStatus
              ? QUEUE_STATUS_BADGE[queueStatus]
              : null;

            return (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-[70%]">
                  <div
                    className={cn(
                      "px-4 py-2.5 rounded-2xl rounded-br-sm bg-brand text-white",
                      isHighlighted && "ring-2 ring-brand/30"
                    )}
                  >
                    <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                  </div>
                  <div className="flex items-center justify-end gap-1.5 mt-1">
                    <span className="text-[10px] opacity-60">
                      {timeAgo(msg.deliveredAt)}
                    </span>
                    {badge && (
                      <Badge
                        className={cn(
                          "text-[10px] px-1.5 py-0 h-auto",
                          badge.className
                        )}
                      >
                        {badge.label}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={msg.id} className="flex justify-start">
              <div className="max-w-[70%]">
                <div
                  className={cn(
                    "px-4 py-2.5 rounded-2xl rounded-bl-sm bg-muted text-foreground",
                    isHighlighted && "ring-2 ring-brand/30"
                  )}
                >
                  <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                </div>
                <span className="text-[10px] opacity-60 ml-1 mt-1 block">
                  {timeAgo(msg.deliveredAt)}
                </span>
              </div>
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-border bg-background p-4 space-y-2 shrink-0">
        <Textarea
          placeholder="Type your message... (Cmd+Enter to queue)"
          value={composerText}
          onChange={(e) => setComposerText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleQueueMessage();
            }
          }}
          disabled={sending}
          rows={3}
          className="resize-none"
        />
        {sendError && (
          <p className="text-xs text-destructive">{sendError}</p>
        )}
        <div className="flex justify-end">
          <Button
            onClick={handleQueueMessage}
            disabled={!composerText.trim() || sending}
            size="sm"
          >
            {sending ? (
              <>
                <Loader2 className="animate-spin" />
                Queuing...
              </>
            ) : (
              "Queue Message"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
