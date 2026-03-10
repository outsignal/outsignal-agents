"use client";

import { cn } from "@/lib/utils";
import type { Template } from "./copy-tab";
import type { BodyElements } from "@/lib/analytics/body-elements";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TopTemplatesListProps {
  templates: Template[];
  total: number;
  onSelectTemplate: (t: Template | null) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ELEMENT_LABELS: Record<keyof BodyElements, string> = {
  hasCtaType: "CTA",
  ctaSubtype: "CTA Type",
  hasProblemStatement: "Problem Statement",
  hasValueProposition: "Value Prop",
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

const STRATEGY_LABELS: Record<string, string> = {
  "creative-ideas": "Creative Ideas",
  pvp: "PVP",
  "one-liner": "One-Liner",
  custom: "Custom",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TopTemplatesList({
  templates,
  total,
  onSelectTemplate,
}: TopTemplatesListProps) {
  if (templates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Insufficient data for template ranking
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Showing top {templates.length} of {total} template
        {total !== 1 ? "s" : ""}
      </p>

      <div className="space-y-3">
        {templates.map((t, idx) => (
          <button
            key={`${t.campaignId}-${t.step}`}
            onClick={() => onSelectTemplate(t)}
            className="w-full text-left rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/30 hover:border-border/80"
          >
            <div className="flex items-start gap-4">
              {/* Rank badge */}
              <div className="flex-none flex items-center justify-center w-8 h-8 rounded-full bg-muted text-sm font-bold tabular-nums">
                {idx + 1}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 space-y-2">
                {/* Campaign + step */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm truncate">
                    {t.campaignName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Step {t.step}
                  </span>
                  {t.copyStrategy && (
                    <span className="inline-flex items-center rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 text-[10px] font-medium">
                      {STRATEGY_LABELS[t.copyStrategy] ?? t.copyStrategy}
                    </span>
                  )}
                </div>

                {/* Subject line */}
                <p
                  className="text-sm text-muted-foreground truncate"
                  title={t.subjectLine}
                >
                  {t.subjectLine}
                </p>

                {/* Element pills */}
                <div className="flex flex-wrap gap-1.5">
                  {BOOLEAN_ELEMENTS.map((key) => {
                    const present = t.elements[key] as boolean;
                    return (
                      <span
                        key={key}
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border",
                          present
                            ? "bg-green-500/20 text-green-400 border-green-500/30"
                            : "bg-secondary text-muted-foreground/50 border-border",
                        )}
                      >
                        {ELEMENT_LABELS[key]}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Metrics */}
              <div className="flex-none text-right space-y-1">
                <div>
                  <span className="inline-flex items-center rounded-full bg-brand/20 text-brand-foreground border border-brand-strong/30 px-2.5 py-0.5 text-xs font-bold tabular-nums">
                    {t.compositeScore.toFixed(1)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground tabular-nums">
                    {t.replyRate.toFixed(1)}%
                  </span>{" "}
                  reply
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground tabular-nums">
                    {t.interestedRate.toFixed(1)}%
                  </span>{" "}
                  interested
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.totalSends.toLocaleString()} sends
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
