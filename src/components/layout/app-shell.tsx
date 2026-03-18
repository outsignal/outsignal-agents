import { Sidebar } from "./sidebar";
import { MobileMenuButton } from "./mobile-menu-button";
import { PageTransition } from "./page-transition";
import { ChatPanel } from "@/components/chat/chat-panel";
import { CommandPalette } from "@/components/ui/command-palette";
import { PushNotificationPrompt } from "@/components/push-notification-prompt";

export function AppShell({ children }: { children: React.ReactNode }) {

  return (
    <div className="flex h-screen overflow-hidden">
      <CommandPalette />
      <PushNotificationPrompt vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-4 focus:left-4 focus:bg-background focus:text-foreground focus:px-4 focus:py-2 focus:rounded-lg focus:shadow-lg focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar — hidden on mobile */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay */}
      <MobileMenuButton />

      <ChatPanel>
        <main id="main-content" className="flex-1 overflow-auto pl-14 md:pl-0">
          <PageTransition>{children}</PageTransition>
        </main>
      </ChatPanel>
    </div>
  );
}
