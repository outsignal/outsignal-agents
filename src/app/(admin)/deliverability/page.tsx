"use client";

export const dynamic = "force-dynamic";

import dynamic_ from "next/dynamic";
import { useQueryState } from "nuqs";
import { PageShell } from "@/components/layout/page-shell";

// Lazy-load each tab's content
const DeliverabilityTab = dynamic_(
  () =>
    import("@/components/deliverability/deliverability-tab").then((m) => ({
      default: m.DeliverabilityTab,
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

const SendersTab = dynamic_(
  () =>
    import("@/components/deliverability/senders-tab").then((m) => ({
      default: m.SendersTab,
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

const TAB_VALUES = ["deliverability", "email-health", "senders"] as const;
type TabValue = (typeof TAB_VALUES)[number];

const TAB_LABELS: Record<TabValue, string> = {
  deliverability: "Deliverability",
  "email-health": "Email Health",
  senders: "Senders",
};

export default function DeliverabilityPage() {
  const [tab, setTab] = useQueryState("tab", {
    defaultValue: "deliverability",
    parse: (v) =>
      TAB_VALUES.includes(v as TabValue) ? (v as TabValue) : "deliverability",
    serialize: (v) => v,
  });

  return (
    <PageShell title="Deliverability" noPadding>
      <div className="px-6 pt-4 space-y-6">
        {/* Tab buttons */}
        <div className="flex items-center gap-1 border-b border-border">
          {TAB_VALUES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => void setTab(value)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === value
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
              }`}
            >
              {TAB_LABELS[value]}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="pb-6">
          {tab === "deliverability" && <DeliverabilityTab />}
          {tab === "email-health" && <EmailHealthTab />}
          {tab === "senders" && <SendersTab />}
        </div>
      </div>
    </PageShell>
  );
}
