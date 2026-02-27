export const dynamic = "force-dynamic";

import { NuqsAdapter } from "nuqs/adapters/next/app";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/app-shell";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider>
      <NuqsAdapter>
        <AppShell>{children}</AppShell>
      </NuqsAdapter>
    </TooltipProvider>
  );
}
