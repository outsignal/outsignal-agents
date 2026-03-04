import { Sidebar } from "./sidebar";
import { MobileMenuButton } from "./mobile-menu-button";
import { getAllWorkspaces } from "@/lib/workspaces";
import { ChatPanel } from "@/components/chat/chat-panel";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const workspaces = await getAllWorkspaces();

  const workspaceItems = workspaces.map((w) => ({
    slug: w.slug,
    name: w.name,
    vertical: w.vertical,
    status: w.status,
    hasApiToken: w.hasApiToken,
  }));

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar — hidden on mobile */}
      <div className="hidden md:flex">
        <Sidebar workspaces={workspaceItems} />
      </div>

      {/* Mobile sidebar overlay */}
      <MobileMenuButton workspaces={workspaceItems} />

      <ChatPanel>
        <main className="flex-1 overflow-auto">{children}</main>
      </ChatPanel>
    </div>
  );
}
