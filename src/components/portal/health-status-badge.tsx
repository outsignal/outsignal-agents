"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const healthTooltips: Record<string, string> = {
  healthy: "Account is active and operating normally",
  warning: "Account has reduced activity — may need attention",
  paused: "Account has been temporarily paused",
  blocked: "LinkedIn has restricted this account — our team is working on it",
  session_expired: "Session needs to be refreshed — our team has been notified",
};

interface HealthStatusBadgeProps {
  status: string;
  className?: string;
}

export function HealthStatusBadge({ status, className }: HealthStatusBadgeProps) {
  const tooltip = healthTooltips[status] ?? status;

  const HEALTH_VARIANT: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
    healthy: "success",
    warning: "warning",
    paused: "warning",
    blocked: "destructive",
    session_expired: "destructive",
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant={HEALTH_VARIANT[status] ?? "secondary"} className={`text-xs cursor-help ${className ?? ""}`}>
            {status.replace("_", " ")}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px]">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
