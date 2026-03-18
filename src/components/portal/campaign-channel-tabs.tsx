"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CampaignListTable, type MergedCampaign } from "@/components/portal/campaign-list-table";
import { Mail, Linkedin, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

type ChannelTab = "all" | "email" | "linkedin" | "multi-channel";

function getChannelType(channels: string[]): "email" | "linkedin" | "multi-channel" {
  const hasEmail = channels.includes("email");
  const hasLinkedin = channels.includes("linkedin");
  if (hasEmail && hasLinkedin) return "multi-channel";
  if (hasLinkedin) return "linkedin";
  return "email";
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
  const router = useRouter();
  const searchParams = useSearchParams();

  const counts = useMemo(() => {
    const c = { all: campaigns.length, email: 0, linkedin: 0, "multi-channel": 0 };
    for (const camp of campaigns) {
      c[getChannelType(camp.channels)]++;
    }
    return c;
  }, [campaigns]);

  // Only show tabs that have campaigns or match workspace package
  const hasMultipleChannels = counts.email > 0 && (counts.linkedin > 0 || counts["multi-channel"] > 0);

  // If only one channel type exists, skip tabs entirely
  if (!hasMultipleChannels) {
    return <CampaignListTable campaigns={campaigns} className="h-full" />;
  }

  const activeTab = (initialChannel as ChannelTab) || "all";

  function handleTabChange(value: ChannelTab) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("channel");
    } else {
      params.set("channel", value);
    }
    router.push(`/portal/campaigns?${params.toString()}`);
  }

  const filtered = useMemo(() => {
    if (activeTab === "all") return campaigns;
    return campaigns.filter((c) => getChannelType(c.channels) === activeTab);
  }, [campaigns, activeTab]);

  const pillClass = (tab: ChannelTab) =>
    cn(
      "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-all duration-150",
      activeTab === tab
        ? "bg-background text-foreground font-medium shadow-sm"
        : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Channel pill tabs — matches inbox tab styling */}
      <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-muted shrink-0 self-start">
        <button onClick={() => handleTabChange("all")} className={pillClass("all")}>
          All ({counts.all})
        </button>
        {counts.email > 0 && (
          <button onClick={() => handleTabChange("email")} className={pillClass("email")}>
            <Mail className="h-3.5 w-3.5" />
            Email ({counts.email})
          </button>
        )}
        {counts.linkedin > 0 && (
          <button onClick={() => handleTabChange("linkedin")} className={pillClass("linkedin")}>
            <Linkedin className="h-3.5 w-3.5" />
            LinkedIn ({counts.linkedin})
          </button>
        )}
        {counts["multi-channel"] > 0 && (
          <button onClick={() => handleTabChange("multi-channel")} className={pillClass("multi-channel")}>
            <Layers className="h-3.5 w-3.5" />
            Multi-channel ({counts["multi-channel"]})
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <CampaignListTable campaigns={filtered} className="h-full" />
      </div>
    </div>
  );
}
