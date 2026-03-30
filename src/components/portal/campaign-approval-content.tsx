"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, MessageSquare, ChevronDown, Mail, Loader2, Info, AlertTriangle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveSpintax, substituteTokens } from "@/lib/content-preview";
import { SequenceStepsDisplay } from "@/components/portal/sequence-steps-display";
import { SequenceFlowTimeline, type TimelineStep } from "@/components/portal/sequence-flow-timeline";
import type { SequenceStep } from "@/lib/emailbison/types";

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
  ebSequenceSteps?: SequenceStep[];
}

/**
 * Render text with spintax resolved and merge tokens highlighted.
 */
function PreviewText({ raw }: { raw: string }) {
  const afterSpintax = resolveSpintax(raw);
  const { tokensFound } = substituteTokens(afterSpintax);

  if (tokensFound.length === 0) {
    return <span className="whitespace-pre-line">{afterSpintax}</span>;
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
          className="bg-brand/30 text-foreground rounded px-0.5"
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

  return <span className="whitespace-pre-line">{parts}</span>;
}

export function CampaignApprovalContent({
  campaignId,
  emailSequence,
  linkedinSequence,
  channels,
  contentApproved,
  contentFeedback,
  isPending,
  ebSequenceSteps = [],
}: Props) {
  const router = useRouter();
  const [openStep, setOpenStep] = useState<number>(0); // First step open by default
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [violations, setViolations] = useState<Array<{ step: number; field: string; violation: string }> | null>(null);
  const [softWarnings, setSoftWarnings] = useState<Array<{ step: number; field: string; violation: string }> | null>(null);

  const canAct = isPending && !contentApproved;

  const emailSteps = (emailSequence ?? []) as EmailStep[];
  const linkedinSteps = (linkedinSequence ?? []) as LinkedInStep[];

  const hasEbSteps = ebSequenceSteps.length > 0;
  const hasEmail = channels.includes("email") && emailSteps.length > 0;
  const hasLinkedIn = channels.includes("linkedin") && linkedinSteps.length > 0;

  const timelineSteps: TimelineStep[] = [
    ...emailSteps.map((s) => ({
      type: "email" as const,
      position: s.position,
      subject: s.subjectLine,
      subjectVariantB: s.subjectVariantB,
      body: s.body,
      delayDays: s.delayDays,
    })),
    ...linkedinSteps.map((s) => ({
      type: "linkedin" as const,
      position: s.position,
      actionType: (s.type || "message") as "profile_view" | "connect_request" | "message" | "follow_up" | "like_post" | "inmail",
      body: s.body,
      delayDays: s.delayDays,
    })),
  ].sort((a, b) => a.position - b.position);

  async function handleApprove() {
    setLoading(true);
    setError(null);
    setViolations(null);
    setSoftWarnings(null);
    try {
      const res = await fetch(`/api/portal/campaigns/${campaignId}/approve-content`, {
        method: "POST",
      });

      const data = await res.json();

      if (res.status === 422) {
        // Hard violations — approval blocked
        setViolations(data.violations ?? []);
        if (data.warnings?.length > 0) {
          setSoftWarnings(data.warnings);
        }
        return;
      }

      if (!res.ok) {
        throw new Error(data.error ?? "Failed to approve content");
      }

      // Success — check for soft warnings
      if (data.warnings?.length > 0) {
        setSoftWarnings(data.warnings);
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong approving the content. Please try again.");
    } finally {
      setLoading(false);
      setConfirmApprove(false);
    }
  }

  async function handleRequestChanges() {
    if (!feedback.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/portal/campaigns/${campaignId}/request-changes-content`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feedback: feedback.trim() }),
        },
      );
      if (!res.ok) throw new Error("Failed to submit feedback");
      setShowFeedback(false);
      setFeedback("");
      router.refresh();
    } catch {
      setError("Something went wrong submitting your feedback. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-heading text-lg font-semibold">Content</h2>
        {contentApproved && (
          <span className="inline-flex items-center gap-1 text-sm text-emerald-700 font-medium">
            <CheckCircle2 className="h-4 w-4" /> Approved
          </span>
        )}
      </div>

      {/* Previous feedback banner */}
      {contentFeedback && !contentApproved && (
        <div className="border-l-4 border-amber-400 bg-amber-50/50 p-3 mb-4 text-sm">
          <p className="font-medium text-amber-800 mb-1">Changes Requested</p>
          <p className="text-amber-700">{contentFeedback}</p>
        </div>
      )}

      {!hasEbSteps && !hasEmail && !hasLinkedIn ? (
        <p className="text-center py-8 text-muted-foreground">
          No content has been added to this campaign yet.
        </p>
      ) : (
        <div className="space-y-6">
          {/* EB Sequence Steps (live data from EmailBison) */}
          {hasEbSteps && (
            <SequenceStepsDisplay steps={ebSequenceSteps} />
          )}

          {/* Visual timeline for LinkedIn / multi-channel (local data) */}
          {hasLinkedIn && !hasEbSteps && (
            <SequenceFlowTimeline steps={timelineSteps} />
          )}

          {/* Local Email-only Sequence Accordion (fallback when no EB steps and no LinkedIn) */}
          {hasEmail && !hasLinkedIn && !hasEbSteps && (
            <div>
              {/* Spintax explanation banner */}
              <div className="flex items-start gap-2.5 bg-muted/50 border border-border rounded-md p-3 mb-4">
                <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Email content uses dynamic variations — different recipients may see
                  slightly different wording. The preview below shows one possible version.
                </p>
              </div>

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
        </div>
      )}

      {/* Copy quality violation banner (422 response) */}
      {violations && violations.length > 0 && (
        <div className="mt-4 border border-red-300 bg-red-50/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <XCircle className="h-5 w-5 text-red-600 shrink-0" />
            <p className="font-medium text-red-800">
              Content cannot be approved — quality violations must be fixed first
            </p>
          </div>
          <ul className="space-y-1.5 ml-7">
            {violations.map((v, idx) => (
              <li key={idx} className="text-sm text-red-700">
                <span className="font-medium">Step {v.step}</span>{" "}
                <span className="text-red-500">({v.field})</span>:{" "}
                {v.violation}
              </li>
            ))}
          </ul>
          <p className="mt-3 ml-7 text-sm text-red-600">
            Request changes below to ask the team to fix these issues.
          </p>
        </div>
      )}

      {/* Soft warnings banner (200 with warnings) */}
      {!violations && softWarnings && softWarnings.length > 0 && (
        <div className="mt-4 border border-amber-300 bg-amber-50/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
            <p className="font-medium text-amber-800">
              Content approved with warnings
            </p>
          </div>
          <ul className="space-y-1.5 ml-7">
            {softWarnings.map((w, idx) => (
              <li key={idx} className="text-sm text-amber-700">
                <span className="font-medium">Step {w.step}</span>{" "}
                <span className="text-amber-500">({w.field})</span>:{" "}
                {w.violation}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Approval buttons — hidden when hard violations are displayed */}
      {canAct && !violations && (hasEbSteps || hasEmail || hasLinkedIn) && (
        <div className="mt-6 space-y-3">
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          {confirmApprove ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">Approve the content for this campaign?</span>
              <Button
                onClick={handleApprove}
                disabled={loading}
                className="bg-[#635BFF] hover:bg-[#635BFF]/90 text-white"
                size="sm"
              >
                {loading && (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                )}
                Yes, Approve
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmApprove(false)}
                disabled={loading}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Button
                onClick={() => setConfirmApprove(true)}
                disabled={loading}
                className="bg-[#635BFF] hover:bg-[#635BFF]/90 text-white"
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
          )}

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
                className="bg-[#635BFF] hover:bg-[#635BFF]/90 text-white"
                size="sm"
              >
                {loading && showFeedback && (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                )}
                Submit Feedback
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Request Changes when violations block approval */}
      {canAct && violations && violations.length > 0 && (
        <div className="mt-6 space-y-3">
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <Button
            variant="outline"
            onClick={() => setShowFeedback(!showFeedback)}
            disabled={loading}
          >
            <MessageSquare className="h-4 w-4 mr-1" />
            Request Changes
          </Button>

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
                className="bg-[#635BFF] hover:bg-[#635BFF]/90 text-white"
                size="sm"
              >
                {loading && showFeedback && (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                )}
                Submit Feedback
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
