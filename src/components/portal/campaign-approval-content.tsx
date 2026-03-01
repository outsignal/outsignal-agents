"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, MessageSquare, ChevronDown, Mail, Linkedin } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveSpintax, substituteTokens } from "@/lib/content-preview";

interface EmailStep {
  position: number;
  subjectLine: string;
  subjectVariantB?: string;
  body: string;
  delayDays: number;
  notes?: string;
}

interface LinkedInStep {
  position: number;
  type: string;
  body: string;
  delayDays: number;
  notes?: string;
}

interface Props {
  campaignId: string;
  emailSequence: unknown[] | null;
  linkedinSequence: unknown[] | null;
  channels: string[];
  contentApproved: boolean;
  contentFeedback: string | null;
  isPending: boolean;
}

/**
 * Render text with spintax resolved and merge tokens highlighted.
 */
function PreviewText({ raw }: { raw: string }) {
  const afterSpintax = resolveSpintax(raw);
  const { tokensFound } = substituteTokens(afterSpintax);

  if (tokensFound.length === 0) {
    return <span>{afterSpintax}</span>;
  }

  // Replace tokens one at a time, building highlighted JSX
  const EXAMPLE_DATA: Record<string, string> = {
    FIRSTNAME: "Alex",
    LASTNAME: "Smith",
    COMPANYNAME: "Acme Corp",
    COMPANY: "Acme Corp",
    JOBTITLE: "Head of Operations",
    WEBSITE: "acmecorp.com",
    TITLE: "Head of Operations",
    LOCATION: "London, UK",
  };

  const parts: React.ReactNode[] = [];
  const tokenRegex = /\{([A-Z_]+)\}/g;
  let lastIndex = 0;
  let key = 0;
  let match;

  while ((match = tokenRegex.exec(afterSpintax)) !== null) {
    const token = match[1];
    const replacement = EXAMPLE_DATA[token];

    if (replacement) {
      // Add text before the token
      if (match.index > lastIndex) {
        parts.push(
          <span key={key++}>{afterSpintax.slice(lastIndex, match.index)}</span>,
        );
      }
      // Add highlighted replacement
      parts.push(
        <mark
          key={key++}
          className="bg-[#F0FF7A]/30 text-foreground rounded px-0.5"
          title={`{${token}}`}
        >
          {replacement}
        </mark>,
      );
      lastIndex = match.index + match[0].length;
    }
  }

  // Add remaining text
  if (lastIndex < afterSpintax.length) {
    parts.push(<span key={key++}>{afterSpintax.slice(lastIndex)}</span>);
  }

  return <>{parts}</>;
}

export function CampaignApprovalContent({
  campaignId,
  emailSequence,
  linkedinSequence,
  channels,
  contentApproved,
  contentFeedback,
  isPending,
}: Props) {
  const router = useRouter();
  const [openStep, setOpenStep] = useState<number>(0); // First step open by default
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);

  const canAct = isPending && !contentApproved;

  const emailSteps = (emailSequence ?? []) as EmailStep[];
  const linkedinSteps = (linkedinSequence ?? []) as LinkedInStep[];

  const hasEmail = channels.includes("email") && emailSteps.length > 0;
  const hasLinkedIn = channels.includes("linkedin") && linkedinSteps.length > 0;

  async function handleApprove() {
    setLoading(true);
    await fetch(`/api/portal/campaigns/${campaignId}/approve-content`, {
      method: "POST",
    });
    setLoading(false);
    router.refresh();
  }

  async function handleRequestChanges() {
    if (!feedback.trim()) return;
    setLoading(true);
    await fetch(
      `/api/portal/campaigns/${campaignId}/request-changes-content`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: feedback.trim() }),
      },
    );
    setLoading(false);
    setShowFeedback(false);
    setFeedback("");
    router.refresh();
  }

  const typeLabels: Record<string, string> = {
    connection_request: "Connection Request",
    follow_up: "Follow-Up Message",
    message: "Message",
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="font-heading text-lg">Content</CardTitle>
          {contentApproved && (
            <span className="inline-flex items-center gap-1 text-sm text-emerald-700 font-medium">
              <CheckCircle2 className="h-4 w-4" /> Approved
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* Previous feedback banner */}
        {contentFeedback && !contentApproved && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 mb-4 text-sm">
            <p className="font-medium text-amber-800 mb-1">Changes Requested</p>
            <p className="text-amber-700">{contentFeedback}</p>
          </div>
        )}

        {!hasEmail && !hasLinkedIn ? (
          <p className="text-center py-8 text-muted-foreground">
            No content has been added to this campaign yet.
          </p>
        ) : (
          <div className="space-y-6">
            {/* Email Sequence Accordion */}
            {hasEmail && (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                  <Mail className="h-4 w-4" /> Email Sequence
                </h3>
                <div className="space-y-2">
                  {emailSteps.map((step, idx) => (
                    <div key={idx} className="border rounded-lg">
                      <button
                        onClick={() =>
                          setOpenStep(openStep === idx ? -1 : idx)
                        }
                        className="w-full flex items-center justify-between px-4 py-3 text-left cursor-pointer hover:bg-muted/30 transition-colors"
                      >
                        <span className="font-medium text-sm">
                          Step {step.position} (Day {step.delayDays})
                        </span>
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 transition-transform text-muted-foreground",
                            openStep === idx && "rotate-180",
                          )}
                        />
                      </button>
                      {openStep === idx && (
                        <div className="px-4 pb-4 space-y-3 border-t">
                          <div className="pt-3">
                            <p className="text-xs text-muted-foreground mb-1">
                              Subject
                            </p>
                            <p className="font-medium text-sm">
                              <PreviewText raw={step.subjectLine} />
                            </p>
                            {step.subjectVariantB && (
                              <p className="text-xs text-muted-foreground mt-2">
                                Variant B:{" "}
                                <span className="text-foreground">
                                  <PreviewText raw={step.subjectVariantB} />
                                </span>
                              </p>
                            )}
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">
                              Body
                            </p>
                            <div className="whitespace-pre-wrap text-sm leading-relaxed">
                              <PreviewText raw={step.body} />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* LinkedIn Messages */}
            {hasLinkedIn && (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                  <Linkedin className="h-4 w-4" /> LinkedIn Messages
                </h3>
                <div className="space-y-3">
                  {linkedinSteps.map((step, idx) => (
                    <div key={idx} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">
                          {typeLabels[step.type] ?? step.type} (Day{" "}
                          {step.delayDays})
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Step {step.position}
                        </span>
                      </div>
                      <div className="whitespace-pre-wrap text-sm leading-relaxed">
                        <PreviewText raw={step.body} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Approval buttons */}
        {canAct && (hasEmail || hasLinkedIn) && (
          <div className="mt-6 space-y-3">
            <div className="flex items-center gap-3">
              <Button
                onClick={handleApprove}
                disabled={loading}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                Approve Content
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowFeedback(!showFeedback)}
                disabled={loading}
              >
                <MessageSquare className="h-4 w-4 mr-1" />
                Request Changes
              </Button>
            </div>

            {showFeedback && (
              <div className="space-y-2">
                <Textarea
                  placeholder="Describe what changes you'd like (e.g., 'too formal, simplify the CTA')..."
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  rows={3}
                />
                <Button
                  onClick={handleRequestChanges}
                  disabled={loading || !feedback.trim()}
                  variant="destructive"
                  size="sm"
                >
                  Submit Feedback
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
