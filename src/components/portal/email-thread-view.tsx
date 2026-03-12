"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, AlertCircle, Linkedin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AISuggestionCard } from "@/components/portal/ai-suggestion-card";
import { EmailReplyComposer } from "@/components/portal/email-reply-composer";
import { cn } from "@/lib/utils";

interface ThreadMessage {
  id: string;
  direction: "inbound" | "outbound";
  senderEmail: string;
  senderName: string | null;
  subject: string | null;
  bodyText: string;
  htmlBody: string | null;
  receivedAt: string | null;
  intent: string | null;
  sentiment: string | null;
  interested: boolean;
  aiSuggestedReply: string | null;
  ebSenderEmailId: number | null;
  emailBisonReplyId: number | null;
  isOutboundContext: boolean;
}

interface ThreadDetail {
  messages: ThreadMessage[];
  threadMeta: {
    leadEmail: string;
    leadName: string | null;
    subject: string | null;
    interested: boolean;
  };
  crossChannel?: { type: "linkedin"; conversationId: string } | null;
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

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const INTENT_COLORS: Record<string, string> = {
  interested: "bg-emerald-100 text-emerald-800",
  positive: "bg-emerald-100 text-emerald-800",
  negative: "bg-red-100 text-red-800",
  neutral: "bg-gray-100 text-gray-700",
  question: "bg-blue-100 text-blue-800",
  not_interested: "bg-red-100 text-red-800",
  out_of_office: "bg-gray-100 text-gray-700",
};

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "text-emerald-600 dark:text-emerald-400",
  negative: "text-red-600 dark:text-red-400",
  neutral: "text-gray-500 dark:text-gray-400",
};

function MessageCard({ msg }: { msg: ThreadMessage }) {
  const isOutbound = msg.direction === "outbound";
  const displayName = msg.senderName || msg.senderEmail;
  const timestamp = msg.receivedAt
    ? formatDate(msg.receivedAt)
    : "Unknown time";

  return (
    <div
      className={cn(
        "rounded-lg border bg-card overflow-hidden",
        isOutbound && "border-l-4 border-l-blue-500",
        msg.isOutboundContext && "border-l-4 border-l-muted-foreground/40"
      )}
    >
      {/* Message header */}
      <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          {msg.isOutboundContext && (
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Original Campaign Email
            </p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{displayName}</span>
            {isOutbound && !msg.isOutboundContext && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                Sent
              </span>
            )}
            {msg.intent && (
              <Badge
                className={cn(
                  "text-[10px] px-1.5 py-0",
                  INTENT_COLORS[msg.intent] ?? "bg-gray-100 text-gray-700"
                )}
              >
                {msg.intent.replace(/_/g, " ")}
              </Badge>
            )}
            {msg.interested && !msg.intent?.includes("interested") && (
              <Badge className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-800">
                Interested
              </Badge>
            )}
            {/* Sentiment indicator for inbound messages */}
            {!isOutbound && msg.sentiment && msg.sentiment !== "neutral" && (
              <span
                className={cn(
                  "text-[10px] font-medium",
                  SENTIMENT_COLORS[msg.sentiment] ?? "text-gray-500"
                )}
              >
                {msg.sentiment}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{msg.senderEmail}</p>
          {msg.subject && (
            <p className="text-xs text-muted-foreground truncate">
              Re: {msg.subject}
            </p>
          )}
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
          {timestamp}
        </span>
      </div>

      {/* Message body */}
      <div className="px-4 py-5">
        {msg.htmlBody ? (
          <iframe
            srcDoc={msg.htmlBody}
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            className="w-full min-h-[100px] border-0 rounded"
            onLoad={(e) => {
              const iframe = e.currentTarget;
              if (iframe.contentDocument?.body) {
                iframe.style.height = `${iframe.contentDocument.body.scrollHeight + 16}px`;
              }
            }}
          />
        ) : (
          <pre className="whitespace-pre-wrap text-sm font-sans text-foreground leading-relaxed">
            {msg.bodyText}
          </pre>
        )}
      </div>
    </div>
  );
}

interface EmailThreadViewProps {
  threadId: number;
  onReplySent: () => void;
  onSwitchChannel?: (conversationId: string) => void;
  /** Override thread detail API path (admin mode). */
  threadDetailBasePath?: string;
  /** Override reply endpoint (admin mode). */
  replyEndpoint?: string;
  /** Extra body fields for reply (admin mode). */
  replyExtraBody?: Record<string, string>;
}

export function EmailThreadView({
  threadId,
  onReplySent,
  onSwitchChannel,
  threadDetailBasePath = "/api/portal/inbox/email/threads",
  replyEndpoint,
  replyExtraBody,
}: EmailThreadViewProps) {
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composerText, setComposerText] = useState("");

  const fetchThread = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${threadDetailBasePath}/${threadId}`);
      if (!res.ok) throw new Error("Failed to load conversation");
      const data = await res.json() as ThreadDetail;
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversation");
    } finally {
      setLoading(false);
    }
  }, [threadId, threadDetailBasePath]);

  useEffect(() => {
    setDetail(null);
    setComposerText("");
    fetchThread();
  }, [fetchThread]);

  const handleReplySent = useCallback(() => {
    fetchThread();
    onReplySent();
  }, [fetchThread, onReplySent]);

  if (loading) {
    return (
      <div className="flex flex-col h-full p-4 space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <AlertCircle className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button size="sm" variant="outline" onClick={fetchThread}>
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }

  if (!detail) return null;

  const { messages, threadMeta, crossChannel } = detail;

  // Find the most recent inbound message with an AI suggestion
  const latestAiSuggestion = [...messages]
    .reverse()
    .find((m) => m.direction === "inbound" && m.aiSuggestedReply !== null);

  // Find the most recent inbound message to reply to
  const latestInbound = [...messages]
    .reverse()
    .find((m) => m.direction === "inbound");

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div className="px-5 py-4 border-b border-border shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate">
              {threadMeta.leadName || threadMeta.leadEmail}
            </h2>
            {threadMeta.leadName && (
              <p className="text-xs text-muted-foreground truncate">
                {threadMeta.leadEmail}
              </p>
            )}
            {threadMeta.subject && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {threadMeta.subject}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {threadMeta.interested && (
              <Badge className="text-xs bg-[#F0FF7A]/30 text-yellow-800 dark:text-yellow-300 border border-[#F0FF7A]/50">
                Interested
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {messages.length} message{messages.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Cross-channel indicator */}
        {crossChannel?.type === "linkedin" && onSwitchChannel && (
          <button
            onClick={() => onSwitchChannel(crossChannel.conversationId)}
            className="inline-flex items-center gap-1.5 text-xs text-blue-600 border border-blue-200 rounded-full px-2.5 py-1 hover:bg-blue-50 dark:hover:bg-blue-950/30 dark:border-blue-800 dark:text-blue-400 mb-1"
          >
            <Linkedin className="h-3 w-3" /> Also on LinkedIn →
          </button>
        )}

        {messages.map((msg) => (
          <MessageCard key={msg.id} msg={msg} />
        ))}

        {/* AI suggestion card above composer */}
        {latestAiSuggestion?.aiSuggestedReply && (
          <AISuggestionCard
            suggestion={latestAiSuggestion.aiSuggestedReply}
            onUse={(text) => setComposerText(text)}
          />
        )}
      </div>

      {/* Reply composer */}
      <div className="shrink-0 border-t border-border">
        <EmailReplyComposer
          replyId={latestInbound?.id ?? null}
          composerText={composerText}
          onComposerTextChange={setComposerText}
          onReplySent={handleReplySent}
          subject={threadMeta.subject ?? undefined}
          replyEndpoint={replyEndpoint}
          extraBody={replyExtraBody}
        />
      </div>
    </div>
  );
}
