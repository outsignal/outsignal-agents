"use client";

import dynamic from "next/dynamic";
import { useQueryState } from "nuqs";
import { PageShell } from "@/components/layout/page-shell";
import { cn } from "@/lib/utils";

const InboxTab = dynamic(() => import("@/components/inbox/inbox-tab"), {
  ssr: false,
  loading: () => <TabSkeleton />,
});

const ClassificationsTab = dynamic(
  () => import("@/components/inbox/classifications-tab"),
  {
    ssr: false,
    loading: () => <TabSkeleton />,
  }
);

function TabSkeleton() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="h-8 w-8 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
      <p className="text-sm text-muted-foreground mt-3">Loading...</p>
    </div>
  );
}

const VIEWS = ["inbox", "classifications"] as const;
type View = (typeof VIEWS)[number];

export default function AdminInboxPage() {
  const [view, setView] = useQueryState("view", {
    defaultValue: "inbox",
    parse: (v) => (VIEWS.includes(v as View) ? (v as View) : "inbox"),
    serialize: (v) => v,
  });

  const tabs: { key: View; label: string }[] = [
    { key: "inbox", label: "Inbox" },
    { key: "classifications", label: "Classifications" },
  ];

  return (
    <PageShell title="Inbox" noPadding>
      {/* Tab switcher */}
      <div className="px-6 pt-4 pb-0">
        <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5 w-fit">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => void setView(tab.key)}
              className={cn(
                "px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-150",
                view === tab.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {view === "inbox" ? <InboxTab /> : <ClassificationsTab />}
    </PageShell>
  );
}
