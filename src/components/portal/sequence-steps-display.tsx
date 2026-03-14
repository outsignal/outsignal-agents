"use client";

import { useState } from "react";
import { ChevronDown, Mail, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SequenceStep } from "@/lib/emailbison/types";

interface Props {
  steps: SequenceStep[];
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
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function SequenceStepsDisplay({ steps }: Props) {
  const [openStep, setOpenStep] = useState<number>(0);

  const sorted = [...steps].sort((a, b) => a.position - b.position);

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
                {step.body && (
                  <div className={step.subject ? "" : "pt-3"}>
                    <p className="text-xs text-muted-foreground mb-1">Body</p>
                    <div className="whitespace-pre-wrap text-sm leading-relaxed bg-muted/30 rounded-md p-3">
                      {stripHtml(step.body)}
                    </div>
                  </div>
                )}
                {!step.body && (
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
