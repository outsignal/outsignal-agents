"use client";

import { useQueryState } from "nuqs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import dynamic from "next/dynamic";
import {
  Building,
  Wrench,
  Plug,
  Bell,
  DollarSign,
  Package,
  FileText,
  BookOpen,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Lazy-load each tab's content
const GeneralTab = dynamic(() => import("./general-tab"), { ssr: false });
const OperationsTab = dynamic(() => import("./operations-tab"), { ssr: false });
const IntegrationsTab = dynamic(() => import("./integrations-tab"), { ssr: false });
const NotificationsTab = dynamic(() => import("./notifications-tab"), { ssr: false });
const CostsTab = dynamic(() => import("./costs-tab"), { ssr: false });
const PackagesTab = dynamic(() => import("./packages-tab"), { ssr: false });
const ContentTab = dynamic(() => import("./content-tab"), { ssr: false });
const GuideTab = dynamic(() => import("./guide-tab"), { ssr: false });

const TABS: readonly { value: string; label: string; icon: LucideIcon }[] = [
  { value: "general", label: "General", icon: Building },
  { value: "operations", label: "Operations", icon: Wrench },
  { value: "integrations", label: "Integrations", icon: Plug },
  { value: "notifications", label: "Notifications", icon: Bell },
  { value: "costs", label: "Costs", icon: DollarSign },
  { value: "packages", label: "Packages", icon: Package },
  { value: "content", label: "Content", icon: FileText },
  { value: "guide", label: "Guide", icon: BookOpen },
] as const;

export function SettingsHub() {
  const [tab, setTab] = useQueryState("tab", { defaultValue: "general" });

  return (
    <div className="px-4 py-6 sm:px-8">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList
          variant="line"
          className="w-full justify-start border-b border-border/50 pb-0 mb-8 gap-1 overflow-x-auto"
        >
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="gap-2 px-3 py-2"
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t.label}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value="general">
          <GeneralTab />
        </TabsContent>
        <TabsContent value="operations">
          <OperationsTab />
        </TabsContent>
        <TabsContent value="integrations">
          <IntegrationsTab />
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationsTab />
        </TabsContent>
        <TabsContent value="costs">
          <CostsTab />
        </TabsContent>
        <TabsContent value="packages">
          <PackagesTab />
        </TabsContent>
        <TabsContent value="content">
          <ContentTab />
        </TabsContent>
        <TabsContent value="guide">
          <GuideTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
