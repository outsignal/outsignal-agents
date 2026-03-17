"use client";

import dynamic from "next/dynamic";
import { useQueryState } from "nuqs";
import { PageShell } from "@/components/layout/page-shell";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Lazy-load tab content
// ---------------------------------------------------------------------------

function TabSkeleton() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="h-8 w-8 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
      <p className="text-sm text-muted-foreground mt-3">Loading...</p>
    </div>
  );
}

const AnalyticsTab = dynamic(
  () => import("@/components/analytics/analytics-tab"),
  { ssr: false, loading: () => <TabSkeleton /> },
);

const IntelligenceTab = dynamic(
  () => import("@/components/analytics/intelligence-tab"),
  { ssr: false, loading: () => <TabSkeleton /> },
);

// ---------------------------------------------------------------------------
// View values
// ---------------------------------------------------------------------------

const VIEW_VALUES = ["analytics", "intelligence"] as const;
type ViewValue = (typeof VIEW_VALUES)[number];

// ---------------------------------------------------------------------------
// Top-level tab chip
// ---------------------------------------------------------------------------

function ViewChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-md border px-4 py-1.5 text-sm font-medium transition-colors focus:outline-none",
        active
          ? "bg-brand text-brand-foreground border-brand-strong"
          : "bg-secondary text-muted-foreground border-border hover:bg-muted hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  const [view, setView] = useQueryState("view", {
    defaultValue: "analytics",
    parse: (v) => (VIEW_VALUES.includes(v as ViewValue) ? v : "analytics"),
    serialize: (v) => v,
  });

  const activeView = (view ?? "analytics") as ViewValue;

  return (
    <PageShell
      title="Analytics"
      description="Campaign analytics, intelligence, and performance insights"
    >
      {/* Top-level view switcher */}
      <div className="flex items-center gap-2">
        <ViewChip
          label="Analytics"
          active={activeView === "analytics"}
          onClick={() => void setView("analytics")}
        />
        <ViewChip
          label="Intelligence"
          active={activeView === "intelligence"}
          onClick={() => void setView("intelligence")}
        />
      </div>

      {/* Tab content */}
      {activeView === "analytics" && <AnalyticsTab />}
      {activeView === "intelligence" && <IntelligenceTab />}
    </PageShell>
  );
}
