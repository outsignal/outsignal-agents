"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TrendingUp } from "lucide-react";

interface WarmupBadgeProps {
  warmupDay: number;
}

export function WarmupBadge({ warmupDay }: WarmupBadgeProps) {
  if (warmupDay <= 0 || warmupDay >= 22) return null;

  const progress = Math.round((warmupDay / 21) * 100);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="warning" className="text-xs cursor-help gap-1.5">
            <TrendingUp className="h-3 w-3" />
            Warming up &middot; Day {warmupDay}
            <span className="ml-1 inline-flex h-1.5 w-8 rounded-full bg-amber-200 dark:bg-amber-800 overflow-hidden">
              <span
                className="h-full rounded-full bg-amber-500 dark:bg-amber-400 transition-all"
                style={{ width: `${progress}%` }}
              />
            </span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[240px]">
          Daily limits are gradually increased over 21 days to build a natural sending reputation.
          Currently on day {warmupDay} of 21.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
