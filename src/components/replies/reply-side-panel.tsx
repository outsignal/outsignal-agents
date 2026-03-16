"use client";

import { useState } from "react";
import { X, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { IntentBadge } from "./intent-badge";
import { SentimentBadge } from "./sentiment-badge";
import type { Reply } from "./reply-table";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReplySidePanelProps {
  reply: Reply | null;
  onClose: () => void;
  onOverrideSuccess: (updatedReply: Reply) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReplySidePanel({
  reply,
  onClose,
  onOverrideSuccess,
}: ReplySidePanelProps) {
  const [overriding, setOverriding] = useState(false);
  const [showOutbound, setShowOutbound] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isOpen = !!reply;

  async function handleOverride(newIntent: string) {
    if (!reply || overriding) return;
    setOverriding(true);
    setSuccessMessage(null);
    try {
      const res = await fetch(`/api/replies/${reply.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrideIntent: newIntent }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = (await res.json()) as { reply: Reply };
      onOverrideSuccess(updated.reply);
      setSuccessMessage("Classification updated");
      setTimeout(() => setSuccessMessage(null), 2000);
    } catch (err) {
      console.error("Override failed:", err);
    } finally {
      setOverriding(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col border-l bg-background shadow-xl transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        {reply && (
          <>
            {/* Header */}
            <div className="flex items-start justify-between border-b px-6 py-4">
              <div className="min-w-0">
                <h2 className="text-base font-semibold truncate">
                  {reply.senderName ?? reply.senderEmail}
                </h2>
                {reply.senderName && (
                  <p className="text-sm text-muted-foreground">
                    {reply.senderEmail}
                  </p>
                )}
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {new Date(reply.receivedAt).toLocaleString()}
                  </span>
                  <span className="inline-flex items-center rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium">
                    {reply.source}
                  </span>
                </div>
              </div>
              <button
                onClick={onClose}
                className="ml-4 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
              {/* Classification section */}
              <section>
                <h3 className="text-xs font-medium text-muted-foreground mb-2">
                  Classification
                </h3>
                <div className="flex items-center gap-2 flex-wrap">
                  <IntentBadge
                    intent={reply.intent}
                    overrideIntent={reply.overrideIntent}
                    editable
                    onOverride={handleOverride}
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
                {overriding && (
                  <p className="mt-1 text-xs text-muted-foreground animate-pulse">
                    Updating...
                  </p>
                )}
                {successMessage && (
                  <p className="mt-1 text-xs text-green-600">
                    {successMessage}
                  </p>
                )}
                {reply.classificationSummary && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {reply.classificationSummary}
                  </p>
                )}
              </section>

              {/* Reply content */}
              <section>
                <h3 className="text-xs font-medium text-muted-foreground mb-2">
                  Reply
                </h3>
                {reply.subject && (
                  <p className="text-sm font-medium mb-1">{reply.subject}</p>
                )}
                <div className="whitespace-pre-wrap rounded-lg bg-muted/50 p-4 text-sm font-mono leading-relaxed">
                  {reply.bodyText}
                </div>
              </section>

              {/* Original outbound */}
              {(reply.outboundSubject || reply.outboundBody) && (
                <section>
                  <button
                    onClick={() => setShowOutbound(!showOutbound)}
                    className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Original Outbound
                    {showOutbound ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                  </button>
                  {showOutbound && (
                    <div className="mt-2 rounded-lg bg-muted/30 p-4 text-sm">
                      {reply.outboundSubject && (
                        <p className="font-medium mb-1 text-muted-foreground">
                          {reply.outboundSubject}
                        </p>
                      )}
                      {reply.outboundBody && (
                        <div className="whitespace-pre-wrap text-muted-foreground text-xs leading-relaxed">
                          {reply.outboundBody}
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )}

              {/* Campaign info */}
              {(reply.campaignName || reply.sequenceStep != null) && (
                <section>
                  <h3 className="text-xs font-medium text-muted-foreground mb-2">
                    Campaign
                  </h3>
                  <div className="space-y-1 text-sm">
                    {reply.campaignName && (
                      <p>
                        <span className="text-muted-foreground">Name: </span>
                        {reply.campaignName}
                      </p>
                    )}
                    {reply.sequenceStep != null && (
                      <p>
                        <span className="text-muted-foreground">Step: </span>
                        {reply.sequenceStep}
                      </p>
                    )}
                  </div>
                </section>
              )}
            </div>

            {/* Footer */}
            <div className="border-t px-6 py-4">
              <Button asChild variant="outline" size="sm" className="w-full">
                <a
                  href="https://app.outsignal.ai/inbox"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Reply in Outsignal
                </a>
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
