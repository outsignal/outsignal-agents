"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
} from "recharts";

interface MetricCardProps {
  label: string;
  value: string | number;
  trend?: "up" | "down" | "warning" | "neutral";
  detail?: string;
  density?: "default" | "compact";
  /** When true, renders the value larger and the card with a subtle highlight */
  featured?: boolean;
  /** Card size variant — hero renders larger values and taller card */
  variant?: "default" | "hero";
  /** Tiny sparkline rendered at the bottom of the card */
  sparklineData?: number[];
  /** Sparkline stroke/fill colour (defaults to brand purple #635BFF) */
  sparklineColor?: string;
  /** Prefix shown before the value, e.g. "£" */
  prefix?: string;
  /** Suffix shown after the value in lighter weight, e.g. "%" */
  suffix?: string;
  /** Show skeleton loading state */
  loading?: boolean;
  /** Makes the entire card a clickable link */
  href?: string;
  /** Optional icon shown next to the label */
  icon?: LucideIcon;
  className?: string;
}

const trendPill: Record<string, { text: string; bg: string }> = {
  up: { text: "text-green-600", bg: "bg-green-50" },
  down: { text: "text-red-600", bg: "bg-red-50" },
  warning: { text: "text-amber-600", bg: "bg-amber-50" },
  neutral: { text: "text-stone-600", bg: "bg-stone-100" },
};

export function MetricCard({
  label,
  value,
  trend,
  detail,
  density = "default",
  featured,
  variant: variantProp,
  sparklineData,
  sparklineColor = "#635BFF",
  prefix,
  suffix,
  loading = false,
  href,
  icon: Icon,
  className,
}: MetricCardProps) {
  // Map featured → hero for backward compat
  const variant = variantProp ?? (featured ? "hero" : "default");
  const isHero = variant === "hero";

  const sparklineHeight = isHero ? 56 : 40;

  const cardContent = (
    <Card
      density={density}
      className={cn(
        "relative overflow-hidden transition-all duration-200",
        href && "cursor-pointer hover:shadow-md hover:scale-[1.01]",
        className,
      )}
    >
      <CardContent className={cn(density === "compact" ? "pt-3" : "pt-6", "pb-0")}>
        {/* Label row */}
        <div className="flex items-center gap-1.5">
          {Icon && !loading && (
            <Icon className="h-3.5 w-3.5 text-stone-400" />
          )}
          {loading ? (
            <Skeleton className="h-3 w-24" />
          ) : (
            <p className="text-xs font-medium uppercase tracking-wider text-stone-500">
              {label}
            </p>
          )}
        </div>

        {/* Value row */}
        <div className="flex items-baseline gap-2 mt-1.5">
          {loading ? (
            <Skeleton className={cn("h-8", isHero ? "w-40" : "w-32")} />
          ) : (
            <>
              <p
                className={cn(
                  "font-mono font-semibold tabular-nums tracking-tight text-foreground",
                  isHero ? "text-5xl font-bold" : "text-3xl",
                )}
              >
                {prefix && (
                  <span className="font-mono">{prefix}</span>
                )}
                {value}
                {suffix && (
                  <span className="font-mono font-normal text-stone-400 ml-0.5">
                    {suffix}
                  </span>
                )}
              </p>

              {/* Trend pill */}
              {trend && trend !== "neutral" && (
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium",
                    trendPill[trend]?.text,
                    trendPill[trend]?.bg,
                  )}
                >
                  {trend === "up" && "↑"}
                  {trend === "down" && "↓"}
                  {trend === "warning" && "⚠"}
                </span>
              )}
            </>
          )}
        </div>

        {/* Detail text */}
        {loading ? (
          <Skeleton className="h-3.5 w-28 mt-1.5" />
        ) : (
          detail && (
            <p className="text-sm text-stone-500 mt-1">{detail}</p>
          )
        )}

        {/* Spacer for sparkline or bottom padding */}
        <div className={cn(
          sparklineData && sparklineData.length > 1 ? "mt-3" : (density === "compact" ? "pb-3" : "pb-5"),
        )} />
      </CardContent>

      {/* Sparkline */}
      {loading && sparklineData ? (
        <div className="px-6">
          <Skeleton className="w-full h-10 mb-0 rounded-b-lg rounded-t-none" />
        </div>
      ) : (
        sparklineData &&
        sparklineData.length > 1 && (
          <div className="-mb-[1px]">
            <ResponsiveContainer width="100%" height={sparklineHeight}>
              <AreaChart
                data={sparklineData.map((v) => ({ v }))}
                margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient id={`sparkGrad-${label.replace(/\s+/g, "")}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={sparklineColor} stopOpacity={0.1} />
                    <stop offset="100%" stopColor={sparklineColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={sparklineColor}
                  strokeWidth={1.5}
                  strokeOpacity={0.6}
                  fill={`url(#sparkGrad-${label.replace(/\s+/g, "")})`}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )
      )}
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {cardContent}
      </Link>
    );
  }

  return cardContent;
}
