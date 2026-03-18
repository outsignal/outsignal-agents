"use client";

import { cn } from "@/lib/utils";
import { SENTIMENT_COLORS, type Sentiment } from "@/lib/classification/types";

interface SentimentBadgeProps {
  sentiment: string | null;
  overrideSentiment: string | null;
}

const DOT_COLORS: Record<Sentiment, string> = {
  positive: "bg-green-500 dark:bg-green-400",
  neutral: "bg-stone-400 dark:bg-stone-500",
  negative: "bg-red-500 dark:bg-red-400",
};

const SENTIMENT_LABELS: Record<Sentiment, string> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
};

export function SentimentBadge({
  sentiment,
  overrideSentiment,
}: SentimentBadgeProps) {
  const effective = (overrideSentiment ?? sentiment) as Sentiment | null;

  if (!effective) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 dark:bg-stone-800 px-2.5 py-0.5 text-xs font-medium text-stone-500 dark:text-stone-400">
        <span className="h-1.5 w-1.5 rounded-full bg-stone-300 dark:bg-stone-600" />
        Unknown
      </span>
    );
  }

  const label = SENTIMENT_LABELS[effective] ?? effective;
  const colorClasses =
    SENTIMENT_COLORS[effective] ?? "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300";
  const dotColor = DOT_COLORS[effective] ?? "bg-stone-400 dark:bg-stone-500";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        colorClasses,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dotColor)} />
      {label}
    </span>
  );
}
