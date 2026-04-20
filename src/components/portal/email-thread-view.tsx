"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, AlertCircle, Linkedin, ChevronDown, Mail, Shield, Trash2, Bot, Star, UserMinus, Tag, ArrowRight, MailX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { AISuggestionCard } from "@/components/portal/ai-suggestion-card";
import { EmailReplyComposer } from "@/components/portal/email-reply-composer";
import { isDestructiveEmailInboxAction } from "@/lib/email-inbox-actions";
import { cn } from "@/lib/utils";

/** Render URLs in text as clickable links */
function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.match(/^https?:\/\//) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand underline break-all hover:opacity-80"
          >
            {part}
          </a>
        ) : (
          part
        )
      )}
    </>
  );
}

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
  neutral: "bg-muted text-muted-foreground",
  question: "bg-blue-100 text-blue-800",
  not_interested: "bg-red-100 text-red-800",
  out_of_office: "bg-muted text-muted-foreground",
};

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "text-emerald-600 dark:text-emerald-400",
  negative: "text-red-600 dark:text-red-400",
  neutral: "text-muted-foreground",
};

const ACTION_LABELS: Record<string, string> = {
  mark_unread: "Marked as unread",
  mark_automated: "Marked as automated",
  mark_not_automated: "Unmarked automated",
  mark_interested: "Marked as interested",
  mark_not_interested: "Unmarked interested",
  blacklist_domain: "Domain blacklisted",
  blacklist_email: "Email blacklisted",
  delete_reply: "Reply deleted",
  unsubscribe: "Lead unsubscribed",
  remove_lead: "Lead removed",
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
            <p className="text-xs font-medium text-muted-foreground">
              Original Campaign Email
            </p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{displayName}</span>
            {isOutbound && !msg.isOutboundContext && (
              <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                Sent
              </span>
            )}
            {msg.intent && (
              <Badge
                className={cn(
                  "text-[10px] px-1.5 py-0",
                  INTENT_COLORS[msg.intent] ?? "bg-muted text-muted-foreground"
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
                  SENTIMENT_COLORS[msg.sentiment] ?? "text-muted-foreground"
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
        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 font-mono tabular-nums">
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
            <Linkify text={msg.bodyText} />
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
  /** Override actions endpoint (admin mode). */
  actionsEndpoint?: string;
  /** Extra body fields for actions (admin mode). */
  actionsExtraBody?: Record<string, string>;
}

export function EmailThreadView({
  threadId,
  onReplySent,
  onSwitchChannel,
  threadDetailBasePath = "/api/portal/inbox/email/threads",
  replyEndpoint,
  replyExtraBody,
  actionsEndpoint,
  actionsExtraBody,
}: EmailThreadViewProps) {
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composerText, setComposerText] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ action: string; label: string } | null>(null);

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

  const handleAction = useCallback(async (action: string, extra?: Record<string, unknown>) => {
    setActionLoading(action);
    try {
      const latestReply = [...(detail?.messages ?? [])].reverse().find(m => m.direction === "inbound");
      const body: Record<string, unknown> = { action, ...extra };

      // Add leadEmail for remove_lead
      if (action === "remove_lead") {
        body.value = detail?.threadMeta.leadEmail;
      }

      // Add replyId for reply-level actions
      if (["delete_reply", "mark_interested", "mark_not_interested", "mark_unread", "mark_automated", "mark_not_automated"].includes(action)) {
        const ebReplyId = latestReply?.emailBisonReplyId;
        if (!ebReplyId) { toast.error("No reply ID available"); return; }
        body.replyId = ebReplyId;
      }

      // Add value for blacklist actions
      if (action === "blacklist_email") {
        body.value = detail?.threadMeta.leadEmail;
      }
      if (action === "blacklist_domain") {
        const email = detail?.threadMeta.leadEmail;
        body.value = email?.split("@")[1];
      }

      const res = await fetch(actionsEndpoint ?? "/api/portal/inbox/email/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, leadEmail: detail?.threadMeta.leadEmail, ...actionsExtraBody }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Action failed");
      }

      toast.success(ACTION_LABELS[action] || "Done");
      onReplySent(); // refresh thread list
      if (["delete_reply", "remove_lead"].includes(action)) {
        // These remove content, so also re-fetch thread
        fetchThread();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(null);
      setConfirmAction(null);
    }
  }, [detail, onReplySent, fetchThread, actionsEndpoint, actionsExtraBody]);

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        {/* Skeleton header */}
        <div className="px-5 py-4 border-b border-border shrink-0 space-y-2">
          <SkeletonText width="40%" className="h-4" />
          <SkeletonText width="25%" className="h-3" />
        </div>
        {/* Skeleton messages */}
        <div className="flex-1 p-4 space-y-4">
          {[
            { w: "100%", h: "h-28" },
            { w: "100%", h: "h-20" },
            { w: "100%", h: "h-32" },
          ].map(({ w, h }, i) => (
            <div key={i} className="rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-3 bg-muted border-b border-border space-y-1.5">
                <SkeletonText width="30%" className="h-3.5" />
                <SkeletonText width="50%" className="h-3" />
              </div>
              <div className="px-4 py-4">
                <Skeleton className={cn("w-full rounded", h)} style={{ width: w }} />
              </div>
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
              <Badge className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200">
                Interested
              </Badge>
            )}

            {/* Actions dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={!!actionLoading}>
                  Actions <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleAction("mark_unread")} disabled={!!actionLoading}>
                  <Mail className="h-4 w-4" /> Mark unread
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setConfirmAction({ action: "blacklist_domain", label: "Blacklist this domain from future outreach? This affects all leads on the domain." })}
                  disabled={!!actionLoading}
                >
                  <Shield className="h-4 w-4" /> Blacklist domain
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setConfirmAction({ action: "blacklist_email", label: "Blacklist this email from future outreach? This cannot be undone from the inbox." })}
                  disabled={!!actionLoading}
                >
                  <Shield className="h-4 w-4" /> Blacklist email
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setConfirmAction({ action: "delete_reply", label: "Permanently delete this reply from your inbox? This cannot be undone." })}
                  disabled={!!actionLoading}
                >
                  <Trash2 className="h-4 w-4" /> Permanently Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Lead Actions bar */}
      <div className="px-5 py-2 border-b border-border shrink-0 flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{threadMeta.leadName || threadMeta.leadEmail}</span>
          {threadMeta.leadName && <span className="ml-1.5">{threadMeta.leadEmail}</span>}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={!!actionLoading}>
              Lead Actions <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleAction("mark_automated")} disabled={!!actionLoading}>
              <Bot className="h-4 w-4" /> Mark as automated
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <ArrowRight className="h-4 w-4" /> Push to followup campaign
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleAction("mark_interested")} disabled={!!actionLoading}>
              <Star className="h-4 w-4" /> Mark as interested
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setConfirmAction({ action: "unsubscribe", label: "Unsubscribe this lead from all scheduled emails? The lead record will remain intact." })}
              disabled={!!actionLoading}
            >
              <MailX className="h-4 w-4" /> Unsubscribe
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setConfirmAction({ action: "blacklist_email", label: "Blacklist this email from future outreach? This cannot be undone from the inbox." })}
              disabled={!!actionLoading}
            >
              <Shield className="h-4 w-4" /> Add to blacklist
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <Tag className="h-4 w-4" /> Manage lead tags
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setConfirmAction({ action: "remove_lead", label: "Remove this lead? This cannot be undone." })}
              disabled={!!actionLoading}
            >
              <UserMinus className="h-4 w-4" /> Remove lead
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
      </div>

      {/* AI suggestion — pinned between messages and composer */}
      {latestAiSuggestion?.aiSuggestedReply && (
        <div className="shrink-0 border-t border-border px-4 py-3 bg-muted/30">
          <AISuggestionCard
            suggestion={latestAiSuggestion.aiSuggestedReply}
            onUse={(text) => setComposerText(text)}
          />
        </div>
      )}

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

      {/* Confirmation dialog for destructive actions */}
      <AlertDialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>{confirmAction?.label}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!actionLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                confirmAction &&
                handleAction(confirmAction.action, {
                  confirmed: isDestructiveEmailInboxAction(confirmAction.action),
                })
              }
              disabled={!!actionLoading}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {actionLoading ? "Processing..." : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
