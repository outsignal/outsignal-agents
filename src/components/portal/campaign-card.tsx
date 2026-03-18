"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mail, Linkedin, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface CampaignCardProps {
  campaign: {
    id: string;
    name: string;
    status: string;
    channels: string[];
    leadsApproved: boolean;
    contentApproved: boolean;
  };
}

const statusConfig: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-stone-100 dark:bg-stone-800 text-stone-800 dark:text-stone-200" },
  internal_review: {
    label: "In Review",
    className: "bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200",
  },
  pending_approval: {
    label: "Needs Approval",
    className: "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200",
  },
  approved: { label: "Approved", className: "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200" },
  deployed: { label: "Deployed", className: "bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-200" },
  active: { label: "Active", className: "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200" },
  paused: { label: "Paused", className: "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200" },
  completed: {
    label: "Completed",
    className: "bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200",
  },
};

export function CampaignCard({ campaign }: CampaignCardProps) {
  const config = statusConfig[campaign.status] ?? {
    label: campaign.status,
    className: "bg-stone-100 dark:bg-stone-800 text-stone-800 dark:text-stone-200",
  };

  const isPending =
    campaign.status === "pending_approval" &&
    (!campaign.leadsApproved || !campaign.contentApproved);

  return (
    <Link href={`/portal/campaigns/${campaign.id}`}>
      <Card
        className={cn(
          "transition-shadow hover:shadow-md cursor-pointer relative overflow-visible",
          isPending && "border-2 border-amber-300",
        )}
      >
        {/* Notification dot for pending campaigns */}
        {isPending && (
          <span className="absolute -top-1.5 -right-1.5 h-3 w-3 rounded-full bg-amber-500" />
        )}

        <CardContent className="pt-5 pb-4 px-5">
          <div className="flex items-start justify-between">
            <h3 className="font-heading font-semibold text-sm truncate pr-2">
              {campaign.name}
            </h3>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          </div>

          <div className="flex items-center gap-2 mt-3">
            <Badge className={cn("text-xs", config.className)}>
              {config.label}
            </Badge>

            {/* Channel icons */}
            <div className="flex items-center gap-1 ml-auto">
              {campaign.channels.includes("email") && (
                <Mail className="h-3.5 w-3.5 text-foreground/70" />
              )}
              {campaign.channels.includes("linkedin") && (
                <Linkedin className="h-3.5 w-3.5 text-foreground/70" />
              )}
            </div>
          </div>

          {/* Approval indicators */}
          <div className="flex items-center gap-2 mt-3">
            <Badge variant={campaign.leadsApproved ? "success" : "warning"}>
              Leads: {campaign.leadsApproved ? "Approved" : "Pending"}
            </Badge>
            <Badge variant={campaign.contentApproved ? "success" : "warning"}>
              Content: {campaign.contentApproved ? "Approved" : "Pending"}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
