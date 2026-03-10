"use client";

import { cn } from "@/lib/utils";
import type { Correlation, CtaSubtype } from "./copy-tab";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ElementMultiplierCardsProps {
  correlations: Correlation[];
  ctaSubtypes: CtaSubtype[];
  totalStepsAnalyzed: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function multiplierColor(value: number | null): string {
  if (value == null) return "text-muted-foreground";
  if (value > 1) return "text-green-500";
  if (value < 1) return "text-red-500";
  return "text-muted-foreground";
}

function formatMultiplier(value: number | null): string {
  if (value == null) return "N/A";
  return `${value.toFixed(1)}x`;
}

function multiplierTooltip(value: number | null): string | undefined {
  if (value == null)
    return "All emails contain this element, or no emails contain it — multiplier cannot be calculated";
  return undefined;
}

const CTA_LABELS: Record<string, string> = {
  book_a_call: "Book a Call",
  reply_to_email: "Reply to Email",
  visit_link: "Visit Link",
  download_resource: "Download Resource",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ElementMultiplierCards({
  correlations,
  ctaSubtypes,
  totalStepsAnalyzed,
}: ElementMultiplierCardsProps) {
  if (correlations.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No element correlation data available
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Element multiplier grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {correlations.map((c) => (
          <div
            key={c.element}
            className={cn(
              "rounded-lg border p-4 transition-colors bg-card border-border",
              c.lowConfidence && "opacity-50",
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold">{c.displayName}</h4>
              {c.lowConfidence && (
                <span className="inline-flex items-center rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 text-[10px] font-medium">
                  Low confidence
                </span>
              )}
            </div>

            {/* Global multiplier */}
            <div title={multiplierTooltip(c.globalMultiplier)}>
              <p className="text-xs text-muted-foreground mb-0.5">
                Global multiplier
              </p>
              <p
                className={cn(
                  "text-2xl font-bold tabular-nums",
                  multiplierColor(c.globalMultiplier),
                )}
              >
                {formatMultiplier(c.globalMultiplier)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Based on {c.globalSampleWith + c.globalSampleWithout} emails
              </p>
            </div>

            {/* Vertical multiplier */}
            {c.verticalName && (
              <div className="mt-3 pt-3 border-t border-border/50">
                <p className="text-xs text-muted-foreground mb-0.5">
                  {c.verticalName}
                </p>
                <p
                  className={cn(
                    "text-lg font-semibold tabular-nums",
                    multiplierColor(c.verticalMultiplier),
                  )}
                >
                  {formatMultiplier(c.verticalMultiplier)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Based on{" "}
                  {c.verticalSampleWith + c.verticalSampleWithout} emails
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* CTA subtype breakdown */}
      {ctaSubtypes.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">CTA Type Breakdown</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {ctaSubtypes.map((cta) => (
              <div
                key={cta.subtype}
                className="rounded-lg border border-border bg-card p-3"
              >
                <p className="text-xs text-muted-foreground mb-1">
                  {CTA_LABELS[cta.subtype] ?? cta.subtype}
                </p>
                <p className="text-xl font-bold tabular-nums">
                  {cta.avgReplyRate.toFixed(2)}
                  <span className="text-sm text-muted-foreground">%</span>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {cta.sampleSize} email{cta.sampleSize !== 1 ? "s" : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Total steps note */}
      <p className="text-xs text-muted-foreground">
        Analysis based on {totalStepsAnalyzed} sequence step
        {totalStepsAnalyzed !== 1 ? "s" : ""} with body element classification
      </p>
    </div>
  );
}
