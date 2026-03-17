"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

const AgentGuidePage = dynamic(() => import("@/app/(admin)/agent-guide/page"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  ),
});

export default function GuideTab() {
  return <AgentGuidePage />;
}
