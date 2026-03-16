"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Building2,
  CheckCircle,
  Circle,
  Eye,
  FileText,
  LinkedinIcon,
  Mail,
  Megaphone,
  MessageSquare,
  MessageSquareText,
  Send,
  ShieldCheck,
  Star,
  TrendingUp,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from "recharts";

const ICON_MAP: Record<string, LucideIcon> = {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Building2,
  CheckCircle,
  Circle,
  Eye,
  FileText,
  LinkedinIcon,
  Mail,
  Megaphone,
  MessageSquare,
  MessageSquareText,
  Send,
  ShieldCheck,
  Star,
  TrendingUp,
  UserPlus,
  Users,
  Zap,
};

interface MetricCardProps {
  label: string;
  value: string | number;
  trend?: "up" | "down" | "warning" | "neutral";
  detail?: string;
  density?: "default" | "compact";
  featured?: boolean;
  variant?: "default" | "hero";
  sparklineData?: number[];
  sparklineColor?: string;
  prefix?: string;
  suffix?: string;
  loading?: boolean;
  href?: string;
  icon?: string;
  className?: string;
}

export function MetricCard({
  label,
  value,
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
  icon,
  className,
}: MetricCardProps) {
  const IconComponent = icon ? ICON_MAP[icon] : undefined;
  const variant = variantProp ?? (featured ? "hero" : "default");
  const isHero = variant === "hero";
  const sparklineHeight = isHero ? 96 : 80;
  const hasSparkline = sparklineData && sparklineData.length > 1;
  const gradId = useId().replace(/:/g, "");

  // Y domain: centre the data in the middle of the chart with equal
  // padding above and below so the line never clips at troughs.
  let yDomain: [number, number] = [0, 1];
  if (hasSparkline) {
    const min = Math.min(...sparklineData);
    const max = Math.max(...sparklineData);
    const range = max - min || 1;
    yDomain = [min - range * 0.15, max + range * 0.15];
  }

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
        <div className="flex items-center gap-1.5">
          {IconComponent && !loading && (
            <IconComponent className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          {loading ? (
            <Skeleton className="h-3 w-24" />
          ) : (
            <p className="text-xs font-medium text-muted-foreground">
              {label}
            </p>
          )}
        </div>

        <div className="flex items-baseline gap-2 mt-1.5">
          {loading ? (
            <Skeleton className={cn("h-8", isHero ? "w-40" : "w-32")} />
          ) : (
            <p
              className={cn(
                "font-mono font-semibold tabular-nums tracking-tight text-foreground",
                isHero ? "text-4xl font-semibold" : "text-2xl",
              )}
            >
              {prefix && <span className="font-mono">{prefix}</span>}
              {value}
              {suffix && (
                <span className="font-mono font-normal text-muted-foreground ml-0.5">
                  {suffix}
                </span>
              )}
            </p>
          )}
        </div>

        {loading ? (
          <Skeleton className="h-3.5 w-28 mt-1.5" />
        ) : (
          detail && (
            <p className="text-sm text-muted-foreground mt-1">{detail}</p>
          )
        )}

        {/* Bottom spacer — provides spacing when no sparkline, or
            reserves vertical space for the absolutely-positioned chart */}
        <div style={{ height: hasSparkline ? sparklineHeight : undefined }}
          className={cn(!hasSparkline && (density === "compact" ? "pb-3" : "pb-4"))}
        />
      </CardContent>

      {/* Sparkline — absolutely positioned to card bottom edge.
          Bypasses all card padding / gap issues entirely. */}
      {loading && sparklineData ? (
        <div className="px-6">
          <Skeleton className="w-full h-10 mb-0 rounded-b-lg rounded-t-none" />
        </div>
      ) : (
        hasSparkline && (
          <div className="absolute bottom-0 left-0 right-0">
            <ResponsiveContainer width="100%" height={sparklineHeight}>
              <AreaChart
                data={sparklineData.map((v) => ({ v }))}
                margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient id={`sparkGrad-${gradId}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={sparklineColor} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={sparklineColor} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <YAxis domain={yDomain} hide />
                <Tooltip
                  cursor={{ stroke: sparklineColor, strokeOpacity: 0.3, strokeWidth: 1 }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const val = payload[0].value as number;
                    return (
                      <div className="rounded-md bg-popover px-2.5 py-1.5 text-xs font-mono tabular-nums text-popover-foreground shadow-md border border-border">
                        {suffix === "%" ? `${val.toFixed(1)}%` : val.toLocaleString()}
                      </div>
                    );
                  }}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={sparklineColor}
                  strokeWidth={2}
                  strokeOpacity={1}
                  fill={`url(#sparkGrad-${gradId})`}
                  dot={false}
                  activeDot={{ r: 3, fill: sparklineColor, stroke: "#fff", strokeWidth: 1.5 }}
                  isAnimationActive={false}
                  baseValue={yDomain[0]}
                  fillOpacity={1}
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
