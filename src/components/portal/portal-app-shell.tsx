import { prisma } from "@/lib/db";
import { PortalSidebar } from "@/components/portal/portal-sidebar";
import { PortalMobileMenu } from "@/components/portal/portal-mobile-menu";
import { PageTransition } from "@/components/layout/page-transition";
import { TooltipProvider } from "@/components/ui/tooltip";

interface PortalAppShellProps {
  workspaceSlug: string;
  children: React.ReactNode;
}

export async function PortalAppShell({ workspaceSlug, children }: PortalAppShellProps) {
  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    select: { name: true },
  });

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-screen overflow-hidden">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-4 focus:left-4 focus:bg-white focus:text-black focus:px-4 focus:py-2 focus:rounded-lg focus:shadow-lg focus:text-sm focus:font-medium"
        >
          Skip to main content
        </a>

        <div className="hidden md:flex">
          <PortalSidebar
            workspaceSlug={workspaceSlug}
            workspaceName={workspace?.name ?? workspaceSlug}
          />
        </div>
        <PortalMobileMenu
          workspaceSlug={workspaceSlug}
          workspaceName={workspace?.name ?? workspaceSlug}
        />
        <main id="main-content" className="flex-1 overflow-auto">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </TooltipProvider>
  );
}
