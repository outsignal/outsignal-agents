import { Card, CardContent } from "@/components/ui/card";
import { ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string | number;
  trend?: "up" | "down" | "warning" | "neutral";
  detail?: string;
  density?: "default" | "compact";
  /** When true, renders the value larger and the card with a subtle highlight */
  featured?: boolean;
  className?: string;
}

const trendBorderColor: Record<string, string> = {
  up: "oklch(0.696 0.17 162.48)",    // emerald-500
  down: "oklch(0.637 0.237 25.331)", // red-500
  warning: "oklch(0.795 0.184 86.047)", // amber-500
};

export function MetricCard({ label, value, trend, detail, density = "default", featured, className }: MetricCardProps) {
  return (
    <Card
      density={density}
      className={className}
      style={{
        borderTopWidth: "2px",
        borderTopColor: (trend && trendBorderColor[trend]) || "transparent",
      }}
    >
      <CardContent className={density === "compact" ? "pt-3" : "pt-6"}>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <div className="flex items-center gap-1 mt-1">
          <p
            className={cn(
              "font-heading font-semibold tabular-nums tracking-tight",
              featured ? "text-3xl" : "text-2xl",
              trend === "warning" && "text-amber-600",
              trend === "down" && "text-red-600",
              trend === "up" && "text-emerald-600",
            )}
          >
            {value}
          </p>
          {trend === "up" && <ArrowUp className="h-4 w-4 text-emerald-600" />}
          {trend === "down" && (
            <ArrowDown className="h-4 w-4 text-red-600" />
          )}
        </div>
        {detail && (
          <p className="text-xs text-muted-foreground mt-1">{detail}</p>
        )}
      </CardContent>
    </Card>
  );
}
