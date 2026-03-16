"use client";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types (match API response shape)
// ---------------------------------------------------------------------------

interface SignalType {
  type: string;
  sent: number;
  replied: number;
  interested: number;
  replyRate: number;
  interestedRate: number;
  lowConfidence: boolean;
}

interface SignalComparison {
  signalAvg: {
    replyRate: number;
    interestedRate: number;
    campaigns: number;
  };
  staticAvg: {
    replyRate: number;
    interestedRate: number;
    campaigns: number;
  };
  multiplier: { replyRate: number; interestedRate: number };
}

interface SignalEffectivenessData {
  signalTypes: SignalType[];
  comparison: SignalComparison | null;
  workspace: string | null;
  isGlobal: boolean;
}

interface SignalEffectivenessSectionProps {
  data: SignalEffectivenessData;
  onToggleGlobal: (global: boolean) => void;
  isGlobal: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSignalType(type: string) {
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function multiplierColor(m: number): string {
  if (m > 1.1) return "text-green-600 dark:text-green-400";
  if (m < 0.9) return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SignalEffectivenessSection({
  data,
  onToggleGlobal,
  isGlobal,
}: SignalEffectivenessSectionProps) {
  return (
    <div className="space-y-4">
      {/* Toggle */}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => onToggleGlobal(false)}
          className={cn(
            "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            !isGlobal
              ? "bg-brand text-brand-foreground border-brand-strong"
              : "bg-secondary text-muted-foreground border-border hover:bg-muted",
          )}
        >
          Per Workspace
        </button>
        <button
          onClick={() => onToggleGlobal(true)}
          className={cn(
            "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            isGlobal
              ? "bg-brand text-brand-foreground border-brand-strong"
              : "bg-secondary text-muted-foreground border-border hover:bg-muted",
          )}
        >
          Global
        </button>
      </div>

      {/* Empty state */}
      {data.signalTypes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No signal campaigns configured. Set up signal-triggered campaigns to
          track signal effectiveness.
        </div>
      ) : (
        <>
          {/* Signal type ranking cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.signalTypes.map((signal) => (
              <div
                key={signal.type}
                className="rounded-lg border p-4 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">
                    {formatSignalType(signal.type)}
                  </h4>
                  {signal.lowConfidence && (
                    <span className="inline-flex items-center rounded-full bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border border-yellow-500/30 px-2 py-0.5 text-[10px] font-medium">
                      Low confidence
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-lg font-bold tabular-nums">
                      {signal.replyRate.toFixed(1)}%
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Reply Rate
                    </p>
                  </div>
                  <div>
                    <p className="text-lg font-bold tabular-nums">
                      {signal.interestedRate.toFixed(1)}%
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Interested Rate
                    </p>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  {signal.sent.toLocaleString()} leads
                </p>
              </div>
            ))}
          </div>

          {/* Signal vs static comparison */}
          {data.comparison === null ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Need both signal and static campaigns with data to compare
              performance.
            </div>
          ) : (
            <div className="rounded-lg border p-4 space-y-4">
              <h4 className="text-sm font-semibold">
                Signal vs Static Campaigns
              </h4>

              <div className="grid grid-cols-2 gap-4">
                {/* Signal column */}
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    Signal Campaigns
                  </p>
                  <p className="text-sm tabular-nums">
                    Reply:{" "}
                    <span className="font-semibold">
                      {data.comparison.signalAvg.replyRate.toFixed(1)}%
                    </span>
                  </p>
                  <p className="text-sm tabular-nums">
                    Interested:{" "}
                    <span className="font-semibold">
                      {data.comparison.signalAvg.interestedRate.toFixed(1)}%
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {data.comparison.signalAvg.campaigns} campaigns
                  </p>
                </div>

                {/* Static column */}
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    Static Campaigns
                  </p>
                  <p className="text-sm tabular-nums">
                    Reply:{" "}
                    <span className="font-semibold">
                      {data.comparison.staticAvg.replyRate.toFixed(1)}%
                    </span>
                  </p>
                  <p className="text-sm tabular-nums">
                    Interested:{" "}
                    <span className="font-semibold">
                      {data.comparison.staticAvg.interestedRate.toFixed(1)}%
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {data.comparison.staticAvg.campaigns} campaigns
                  </p>
                </div>
              </div>

              {/* Multiplier highlight */}
              <div className="pt-2 border-t border-border text-center">
                <p
                  className={cn(
                    "text-lg font-bold",
                    multiplierColor(data.comparison.multiplier.interestedRate),
                  )}
                >
                  Signal campaigns generate{" "}
                  {data.comparison.multiplier.interestedRate.toFixed(1)}x more
                  interested replies
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
