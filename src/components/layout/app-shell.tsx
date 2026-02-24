import { Sidebar } from "./sidebar";
import { getAllWorkspaces } from "@/lib/workspaces";
import { ChatPanel } from "@/components/chat/chat-panel";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const workspaces = await getAllWorkspaces();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        workspaces={workspaces.map((w) => ({
          slug: w.slug,
          name: w.name,
          vertical: w.vertical,
          status: w.status,
          hasApiToken: w.hasApiToken,
        }))}
      />
      <ChatPanel>
        <main className="flex-1 overflow-auto">{children}</main>
      </ChatPanel>
    </div>
  );
}
