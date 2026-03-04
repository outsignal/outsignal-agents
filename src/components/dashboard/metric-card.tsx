import { Card, CardContent } from "@/components/ui/card";
import { ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string | number;
  trend?: "up" | "down" | "warning" | "neutral";
  detail?: string;
}

const trendBorderColor: Record<string, string> = {
  up: "oklch(0.696 0.17 162.48)",    // emerald-500
  down: "oklch(0.637 0.237 25.331)", // red-500
  warning: "oklch(0.795 0.184 86.047)", // amber-500
};

export function MetricCard({ label, value, trend, detail }: MetricCardProps) {
  return (
    <Card
      style={{
        borderTopWidth: "2px",
        borderTopColor: (trend && trendBorderColor[trend]) || "transparent",
      }}
    >
      <CardContent className="pt-6">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <div className="flex items-center gap-1 mt-1">
          <p
            className={cn(
              "text-2xl font-heading font-semibold tabular-nums tracking-tight",
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
