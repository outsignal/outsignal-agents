"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const AgentRunsPage = dynamic(() => import("@/app/(admin)/agent-runs/page"), {
  ssr: false,
  loading: () => <SectionLoader />,
});
const BackgroundTasksPage = dynamic(() => import("@/app/(admin)/background-tasks/page"), {
  ssr: false,
  loading: () => <SectionLoader />,
});
const LinkedInQueuePage = dynamic(() => import("@/app/(admin)/linkedin-queue/page"), {
  ssr: false,
  loading: () => <SectionLoader />,
});
const OOOQueuePage = dynamic(() => import("@/app/(admin)/ooo-queue/page"), {
  ssr: false,
  loading: () => <SectionLoader />,
});
const SignalsPage = dynamic(() => import("@/app/(admin)/signals/page"), {
  ssr: false,
  loading: () => <SectionLoader />,
});
const WebhookLogPage = dynamic(() => import("@/app/(admin)/webhook-log/page"), {
  ssr: false,
  loading: () => <SectionLoader />,
});

function SectionLoader() {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

const SECTIONS = [
  { key: "agent-runs", label: "Agent Runs", Component: AgentRunsPage },
  { key: "background-tasks", label: "Background Tasks", Component: BackgroundTasksPage },
  { key: "linkedin-queue", label: "LinkedIn Queue", Component: LinkedInQueuePage },
  { key: "ooo-queue", label: "OOO Queue", Component: OOOQueuePage },
  { key: "signals", label: "Signals", Component: SignalsPage },
  { key: "webhook-log", label: "Webhook Log", Component: WebhookLogPage },
] as const;

export default function OperationsTab() {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    "agent-runs": true,
  });

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-3">
      {SECTIONS.map(({ key, label, Component }) => (
        <div key={key} className="rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => toggleSection(key)}
            className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors cursor-pointer"
          >
            <ChevronRight
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform duration-150",
                openSections[key] && "rotate-90",
              )}
            />
            {label}
          </button>
          {openSections[key] && (
            <div className="border-t border-border">
              <Component />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
