"use client";

export const dynamic = "force-dynamic";

import dynamic_ from "next/dynamic";
import { useQueryState } from "nuqs";
import {
  LayoutDashboard,
  Globe,
  Mail,
  Send,
  Activity,
} from "lucide-react";

// Lazy-load each tab's content
const OverviewTab = dynamic_(
  () =>
    import("@/components/deliverability/overview-tab").then((m) => ({
      default: m.OverviewTab,
    })),
  { ssr: false, loading: () => <TabSkeleton /> },
);

const DomainsTab = dynamic_(
  () =>
    import("@/components/deliverability/domains-tab").then((m) => ({
      default: m.DomainsTab,
    })),
  { ssr: false, loading: () => <TabSkeleton /> },
);

const EmailHealthTab = dynamic_(
  () =>
    import("@/components/deliverability/email-health-tab").then((m) => ({
      default: m.EmailHealthTab,
    })),
  { ssr: false, loading: () => <TabSkeleton /> },
);

const LinkedInSendersTab = dynamic_(
  () =>
    import("@/components/deliverability/senders-tab").then((m) => ({
      default: m.SendersTab,
    })),
  { ssr: false, loading: () => <TabSkeleton /> },
);

const ActivityTab = dynamic_(
  () =>
    import("@/components/deliverability/activity-tab").then((m) => ({
      default: m.ActivityTab,
    })),
  { ssr: false, loading: () => <TabSkeleton /> },
);

function TabSkeleton() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="h-8 w-8 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
      <p className="text-sm text-muted-foreground mt-3">Loading...</p>
    </div>
  );
}

const TAB_VALUES = [
  "overview",
  "domains",
  "email-health",
  "linkedin-senders",
  "activity",
] as const;
type TabValue = (typeof TAB_VALUES)[number];

const TAB_CONFIG: Record<
  TabValue,
  { label: string; icon: typeof LayoutDashboard }
> = {
  overview: { label: "Overview", icon: LayoutDashboard },
  domains: { label: "Domains", icon: Globe },
  "email-health": { label: "Email Health", icon: Mail },
  "linkedin-senders": { label: "LinkedIn Senders", icon: Send },
  activity: { label: "Activity", icon: Activity },
};

export default function DeliverabilityPage() {
  const [tab, setTab] = useQueryState("tab", {
    defaultValue: "overview",
    parse: (v) =>
      TAB_VALUES.includes(v as TabValue) ? (v as TabValue) : "overview",
    serialize: (v) => v,
  });

  return (
    <div className="flex-1 overflow-auto">
      {/* Page header */}
      <header className="border-b border-border bg-background px-6 py-5">
        <h1 className="text-2xl font-semibold tracking-tight">
          Deliverability
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monitor domain health, sender performance, and delivery activity
          across all workspaces.
        </p>
      </header>

      <div className="px-6 pt-4 space-y-6">
        {/* Tab bar */}
        <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
          {TAB_VALUES.map((value) => {
            const { label, icon: Icon } = TAB_CONFIG[value];
            return (
              <button
                key={value}
                type="button"
                onClick={() => void setTab(value)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
                  tab === value
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="pb-6">
          {tab === "overview" && <OverviewTab />}
          {tab === "domains" && <DomainsTab />}
          {tab === "email-health" && <EmailHealthTab />}
          {tab === "linkedin-senders" && <LinkedInSendersTab />}
          {tab === "activity" && <ActivityTab />}
        </div>
      </div>
    </div>
  );
}
