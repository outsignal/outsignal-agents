"use client";

import dynamic from "next/dynamic";
import { useQueryState } from "nuqs";
import { PageShell } from "@/components/layout/page-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

function TabSkeleton() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="h-8 w-8 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
      <p className="text-sm text-muted-foreground mt-3">Loading...</p>
    </div>
  );
}

const ClientsTab = dynamic(
  () => import("@/components/clients/clients-tab"),
  { ssr: false, loading: () => <TabSkeleton /> },
);

const OnboardTab = dynamic(
  () => import("@/components/clients/onboard-tab"),
  { ssr: false, loading: () => <TabSkeleton /> },
);

const TAB_VALUES = ["clients", "onboard"] as const;
type TabValue = (typeof TAB_VALUES)[number];

export default function ClientsPage() {
  const [tab, setTab] = useQueryState("tab", {
    defaultValue: "clients",
    parse: (v) => (TAB_VALUES.includes(v as TabValue) ? v : "clients"),
    serialize: (v) => v,
  });

  return (
    <PageShell
      title="Clients"
      description="Manage active clients and onboarding"
      noPadding
    >
      <div className="px-6 pt-4">
        <Tabs value={tab} onValueChange={(v) => void setTab(v)}>
          <TabsList>
            <TabsTrigger value="clients">Clients</TabsTrigger>
            <TabsTrigger value="onboard">Onboard</TabsTrigger>
          </TabsList>

          <TabsContent value="clients">
            <div className="py-4">
              <ClientsTab />
            </div>
          </TabsContent>

          <TabsContent value="onboard">
            <div className="py-4 space-y-6">
              <OnboardTab />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}
