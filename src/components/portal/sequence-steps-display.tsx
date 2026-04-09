"use client";

import { useState } from "react";
import { ChevronDown, Mail, Clock, Linkedin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SequenceStep } from "@/lib/emailbison/types";

export interface LinkedInSequenceStep {
  type: string;
  body?: string;
  delayDays?: number;
  notes?: string;
  position?: number;
}

interface Props {
  steps?: SequenceStep[];
  linkedinSteps?: LinkedInSequenceStep[];
}

/**
 * Strip HTML tags for plain-text display of email body content.
 * Preserves line breaks by converting <br> and block elements to newlines.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function SequenceStepsDisplay({ steps, linkedinSteps }: Props) {
  const [openStep, setOpenStep] = useState<number>(0);

  // LinkedIn sequence path
  if (linkedinSteps && linkedinSteps.length > 0) {
    const sorted = [...linkedinSteps].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0),
    );

    const stepTypeLabel: Record<string, string> = {
      profile_view: "Profile View",
      connection_request: "Connection Request",
      connect: "Connection Request",
      message: "Message",
      follow_up: "Follow-up",
    };

    return (
      <div>
        <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
          <Linkedin className="h-4 w-4" /> LinkedIn Sequence ({sorted.length} steps)
        </h3>
        <div className="space-y-2">
          {sorted.map((step, idx) => {
            const label = stepTypeLabel[step.type] ?? step.type.replace(/_/g, " ");
            return (
              <div key={idx} className="border rounded-lg">
                <button
                  onClick={() => setOpenStep(openStep === idx ? -1 : idx)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left cursor-pointer hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Badge variant="outline" className="shrink-0 text-xs tabular-nums">
                      Step {idx + 1}
                    </Badge>
                    <span className="font-medium text-sm capitalize truncate">{label}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    {step.delayDays != null && step.delayDays > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {step.delayDays}d delay
                      </span>
                    )}
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 transition-transform text-muted-foreground",
                        openStep === idx && "rotate-180",
                      )}
                    />
                  </div>
                </button>
                {openStep === idx && (
                  <div className="px-4 pb-4 space-y-3 border-t">
                    <div className="pt-3">
                      <p className="text-xs text-muted-foreground mb-1">Type</p>
                      <p className="text-sm capitalize font-medium">{label}</p>
                    </div>
                    {step.body && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Message</p>
                        <div className="whitespace-pre-wrap text-sm leading-relaxed bg-muted/30 rounded-md p-3">
                          {step.body}
                        </div>
                      </div>
                    )}
                    {!step.body && (
                      <div>
                        <p className="text-sm text-muted-foreground italic">
                          {step.type === "connection_request" || step.type === "connect"
                            ? "Blank connection request (no note)."
                            : "No message content for this step."}
                        </p>
                      </div>
                    )}
                    {step.notes && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Notes</p>
                        <p className="text-sm text-muted-foreground">{step.notes}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Email sequence path (EmailBison steps)
  const sorted = [...(steps ?? [])].sort((a, b) => a.position - b.position);

  return (
    <div>
      <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
        <Mail className="h-4 w-4" /> Email Sequence ({sorted.length} steps)
      </h3>
      <div className="space-y-2">
        {sorted.map((step, idx) => (
          <div key={step.id} className="border rounded-lg">
            <button
              onClick={() => setOpenStep(openStep === idx ? -1 : idx)}
              className="w-full flex items-center justify-between px-4 py-3 text-left cursor-pointer hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Badge
                  variant="outline"
                  className="shrink-0 text-xs tabular-nums"
                >
                  Step {step.position}
                </Badge>
                <span className="font-medium text-sm truncate">
                  {step.subject || "(No subject)"}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-3">
                {step.delay_days != null && step.delay_days > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {step.delay_days}d delay
                  </span>
                )}
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform text-muted-foreground",
                    openStep === idx && "rotate-180",
                  )}
                />
              </div>
            </button>
            {openStep === idx && (
              <div className="px-4 pb-4 space-y-3 border-t">
                {step.subject && (
                  <div className="pt-3">
                    <p className="text-xs text-muted-foreground mb-1">
                      Subject
                    </p>
                    <p className="font-medium text-sm">{step.subject}</p>
                  </div>
                )}
                {(step.body ?? (step as unknown as { bodyText?: string }).bodyText ?? (step as unknown as { bodyHtml?: string }).bodyHtml) ? (
                  <div className={step.subject ? "" : "pt-3"}>
                    <p className="text-xs text-muted-foreground mb-1">Body</p>
                    <div className="whitespace-pre-wrap text-sm leading-relaxed bg-muted/30 rounded-md p-3">
                      {stripHtml(step.body ?? (step as unknown as { bodyText?: string }).bodyText ?? (step as unknown as { bodyHtml?: string }).bodyHtml ?? "")}
                    </div>
                  </div>
                ) : (
                  <div className="pt-3">
                    <p className="text-sm text-muted-foreground italic">
                      No body content for this step.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
