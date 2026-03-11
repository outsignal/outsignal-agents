"use client";

import { useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface EmailReplyComposerProps {
  replyId: string | null;
  composerText: string;
  onComposerTextChange: (text: string) => void;
  onReplySent: () => void;
  subject?: string;
  /** Override the POST endpoint (admin mode). Defaults to portal reply endpoint. */
  replyEndpoint?: string;
  /** Extra body fields to include in the POST (admin mode). */
  extraBody?: Record<string, string>;
}

export function EmailReplyComposer({
  replyId,
  composerText,
  onComposerTextChange,
  onReplySent,
  subject,
  replyEndpoint = "/api/portal/inbox/email/reply",
  extraBody = {},
}: EmailReplyComposerProps) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!replyId) return null;

  const handleSend = async () => {
    const message = composerText.trim();
    if (!message || sending) return;

    setSending(true);
    setError(null);

    try {
      const res = await fetch(replyEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replyId, message, ...extraBody }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to send reply");
      }

      onComposerTextChange("");
      onReplySent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-border bg-background">
      {/* Channel mode label */}
      <div className="px-3 py-1.5 border-b border-border">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          Email Reply
        </span>
      </div>

      {/* Subject line (read-only) */}
      {subject && (
        <div className="px-3 py-2 border-b border-border text-sm">
          <span className="text-muted-foreground">Subject:</span>{" "}
          <span className="text-foreground">Re: {subject}</span>
        </div>
      )}

      <div className="p-4 space-y-2">
        <Textarea
          placeholder="Type your reply... (Cmd+Enter to send)"
          value={composerText}
          onChange={(e) => onComposerTextChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
          rows={3}
          className="resize-none"
        />
        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}
        <div className="flex justify-end">
          <Button
            onClick={handleSend}
            disabled={!composerText.trim() || sending}
            size="sm"
          >
            {sending ? (
              <>
                <Loader2 className="animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send />
                Send
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
