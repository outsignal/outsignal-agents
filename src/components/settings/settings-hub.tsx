"use client";

import { useQueryState } from "nuqs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import dynamic from "next/dynamic";

// Lazy-load each tab's content
const GeneralTab = dynamic(() => import("./general-tab"), { ssr: false });
const OperationsTab = dynamic(() => import("./operations-tab"), { ssr: false });
const IntegrationsTab = dynamic(() => import("./integrations-tab"), { ssr: false });
const NotificationsTab = dynamic(() => import("./notifications-tab"), { ssr: false });
const CostsTab = dynamic(() => import("./costs-tab"), { ssr: false });
const PackagesTab = dynamic(() => import("./packages-tab"), { ssr: false });
const ContentTab = dynamic(() => import("./content-tab"), { ssr: false });
const GuideTab = dynamic(() => import("./guide-tab"), { ssr: false });

const TABS = [
  { value: "general", label: "General" },
  { value: "operations", label: "Operations" },
  { value: "integrations", label: "Integrations" },
  { value: "notifications", label: "Notifications" },
  { value: "costs", label: "Costs" },
  { value: "packages", label: "Packages" },
  { value: "content", label: "Content" },
  { value: "guide", label: "Guide" },
] as const;

export function SettingsHub() {
  const [tab, setTab] = useQueryState("tab", { defaultValue: "general" });

  return (
    <div className="p-6">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line" className="w-full justify-start border-b border-border pb-0 mb-6">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
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
