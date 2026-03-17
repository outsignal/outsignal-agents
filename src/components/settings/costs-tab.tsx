"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

const EnrichmentCostsPage = dynamic(() => import("@/app/(admin)/enrichment-costs/page"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  ),
});

export default function CostsTab() {
  return <EnrichmentCostsPage />;
}
