"use client";

import { useState } from "react";
import { Mail, Linkedin } from "lucide-react";
import { cn } from "@/lib/utils";
import { CampaignListTable, type MergedCampaign } from "@/components/portal/campaign-list-table";
import { EmptyState } from "@/components/ui/empty-state";

type Channel = "all" | "email" | "linkedin";

function getAvailableChannels(pkg: string): ("email" | "linkedin")[] {
  if (pkg === "email") return ["email"];
  if (pkg === "linkedin") return ["linkedin"];
  return ["email", "linkedin"];
}

interface CampaignChannelTabsProps {
  campaigns: MergedCampaign[];
  workspacePackage: string;
  initialChannel?: string;
}

export function CampaignChannelTabs({
  campaigns,
  workspacePackage,
  initialChannel,
}: CampaignChannelTabsProps) {
  const channels = getAvailableChannels(workspacePackage);
  const showTabs = channels.length > 1;

  const defaultChannel: Channel = initialChannel === "email" || initialChannel === "linkedin"
    ? initialChannel
    : showTabs
      ? "all"
      : channels[0];

  const [activeChannel, setActiveChannel] = useState<Channel>(defaultChannel);

  // Single channel — render directly
  if (!showTabs) {
    if (channels[0] === "linkedin") {
      return (
        <EmptyState
          icon={Linkedin}
          title="LinkedIn campaigns coming soon"
          description="LinkedIn campaign management will be available here shortly."
        />
      );
    }
    return <CampaignListTable campaigns={campaigns} className="h-full" />;
  }

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Tab bar */}
      <div className="shrink-0 inline-flex w-fit items-center gap-0.5 p-0.5 rounded-lg bg-muted">
        <button
          onClick={() => setActiveChannel("all")}
          className={cn(
            "px-3 py-1.5 text-sm rounded-md transition-all duration-150 cursor-pointer",
            activeChannel === "all"
              ? "bg-background text-foreground font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          All
        </button>
        <button
          onClick={() => setActiveChannel("email")}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-all duration-150 cursor-pointer",
            activeChannel === "email"
              ? "bg-background text-foreground font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Mail className="h-3.5 w-3.5" />
          Email
        </button>
        <button
          onClick={() => setActiveChannel("linkedin")}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-all duration-150 cursor-pointer",
            activeChannel === "linkedin"
              ? "bg-background text-foreground font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Linkedin className="h-3.5 w-3.5" />
          LinkedIn
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
      {activeChannel === "linkedin" ? (
        <EmptyState
          icon={Linkedin}
          title="LinkedIn campaigns coming soon"
          description="LinkedIn campaign management will be available here shortly."
        />
      ) : (
        <CampaignListTable campaigns={campaigns} className="h-full" />
      )}
      </div>
    </div>
  );
}
