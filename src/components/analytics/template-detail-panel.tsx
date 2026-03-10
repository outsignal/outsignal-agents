"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Template } from "./copy-tab";
import type { BodyElements } from "@/lib/analytics/body-elements";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TemplateDetailPanelProps {
  template: Template | null;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ELEMENT_LABELS: Record<keyof BodyElements, string> = {
  hasCtaType: "CTA",
  ctaSubtype: "CTA Subtype",
  hasProblemStatement: "Problem Statement",
  hasValueProposition: "Value Proposition",
  hasCaseStudy: "Case Study",
  hasSocialProof: "Social Proof",
  hasPersonalization: "Personalization",
};

const BOOLEAN_ELEMENTS: (keyof BodyElements)[] = [
  "hasCtaType",
  "hasProblemStatement",
  "hasValueProposition",
  "hasCaseStudy",
  "hasSocialProof",
  "hasPersonalization",
];

const CTA_LABELS: Record<string, string> = {
  book_a_call: "Book a Call",
  reply_to_email: "Reply to Email",
  visit_link: "Visit Link",
  download_resource: "Download Resource",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TemplateDetailPanel({
  template,
  onClose,
}: TemplateDetailPanelProps) {
  // Close on Escape key
  useEffect(() => {
    if (!template) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [template, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity duration-200",
          template ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={cn(
          "fixed top-0 right-0 z-50 h-full w-full max-w-lg bg-background border-l border-border shadow-xl transition-transform duration-200 ease-out overflow-y-auto",
          template ? "translate-x-0" : "translate-x-full",
        )}
      >
        {template && (
          <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">{template.campaignName}</h3>
                <p className="text-sm text-muted-foreground">
                  {template.workspaceSlug} &middot; Step {template.step}
                </p>
              </div>
              <button
                onClick={onClose}
                className="flex-none p-1 rounded hover:bg-muted transition-colors"
              >
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>

            {/* Subject line */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                Subject Line
              </p>
              <p className="text-sm font-medium">{template.subjectLine}</p>
            </div>

            {/* Email body */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                Email Body
              </p>
              <div className="rounded-lg border border-border bg-muted/20 p-4 max-h-80 overflow-y-auto">
                <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">
                  {template.body}
                </pre>
              </div>
            </div>

            {/* Element tags */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Structural Elements
              </p>
              <div className="flex flex-wrap gap-2">
                {BOOLEAN_ELEMENTS.map((key) => {
                  const present = template.elements[key] as boolean;
                  return (
                    <span
                      key={key}
                      className={cn(
                        "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border",
                        present
                          ? "bg-green-500/20 text-green-400 border-green-500/30"
                          : "bg-secondary text-muted-foreground/50 border-border",
                      )}
                    >
                      {ELEMENT_LABELS[key]}
                    </span>
                  );
                })}
                {template.elements.ctaSubtype && (
                  <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border bg-blue-500/20 text-blue-400 border-blue-500/30">
                    {CTA_LABELS[template.elements.ctaSubtype] ??
                      template.elements.ctaSubtype}
                  </span>
                )}
              </div>
            </div>

            {/* Performance metrics */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Performance
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="text-xs text-muted-foreground">Reply Rate</p>
                  <p className="text-xl font-bold tabular-nums">
                    {template.replyRate.toFixed(1)}
                    <span className="text-sm text-muted-foreground">%</span>
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="text-xs text-muted-foreground">
                    Interested Rate
                  </p>
                  <p className="text-xl font-bold tabular-nums">
                    {template.interestedRate.toFixed(1)}
                    <span className="text-sm text-muted-foreground">%</span>
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="text-xs text-muted-foreground">
                    Composite Score
                  </p>
                  <p className="text-xl font-bold tabular-nums">
                    {template.compositeScore.toFixed(1)}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="text-xs text-muted-foreground">Total Sends</p>
                  <p className="text-xl font-bold tabular-nums">
                    {template.totalSends.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
