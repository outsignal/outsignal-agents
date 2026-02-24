import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string | number;
  trend?: "up" | "down" | "warning" | "neutral";
  detail?: string;
}

export function MetricCard({ label, value, trend, detail }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p
          className={cn(
            "text-3xl font-heading font-bold mt-1",
            trend === "warning" && "text-amber-600",
            trend === "down" && "text-red-600",
            trend === "up" && "text-emerald-600",
          )}
        >
          {value}
        </p>
        {detail && (
          <p className="text-xs text-muted-foreground mt-1">{detail}</p>
        )}
      </CardContent>
    </Card>
  );
}
