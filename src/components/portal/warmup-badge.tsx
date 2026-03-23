"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TrendingUp, Link2Off, FileSearch } from "lucide-react";

interface WarmupBadgeProps {
  warmupDay: number;
  sessionStatus: string;
  hasLiveCampaign: boolean;
}

export function WarmupBadge({ warmupDay, sessionStatus, hasLiveCampaign }: WarmupBadgeProps) {
  // Fully ramped — no badge needed
  if (warmupDay >= 22) return null;

  const isConnected = sessionStatus === "active";

  // Not connected yet
  if (!isConnected) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" className="text-xs cursor-help gap-1.5">
              <Link2Off className="h-3 w-3" />
              Awaiting connection
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[240px]">
            This account needs to be connected before warmup can begin. Once connected, daily limits will gradually increase over 21 days.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Connected but no live campaign
  if (!hasLiveCampaign) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" className="text-xs cursor-help gap-1.5">
              <FileSearch className="h-3 w-3" />
              Awaiting campaign
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[240px]">
            This account is connected and ready. Warmup will begin once a LinkedIn campaign is live.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Active warmup
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
