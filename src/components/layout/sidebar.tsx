"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Mail,
  Inbox,
  HeartPulse,
  Settings,
  UserPlus,
  ClipboardList,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { OutsignalLogo } from "@/components/brand/outsignal-logo";

interface WorkspaceItem {
  slug: string;
  name: string;
  vertical?: string;
  status: string;
  hasApiToken: boolean;
}

interface SidebarProps {
  workspaces: WorkspaceItem[];
}

const mainNav = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/onboard", label: "Proposals", icon: UserPlus },
  { href: "/onboarding", label: "Onboarding", icon: ClipboardList },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ workspaces }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="flex h-16 items-center px-6 border-b border-sidebar-border text-white">
        <OutsignalLogo className="h-7 w-auto" />
      </div>

      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="space-y-1">
          {mainNav.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-6">
          <p className="px-3 text-xs font-medium text-sidebar-foreground/50 uppercase tracking-wider mb-2">
            Workspaces
          </p>
          <nav className="space-y-1">
            {workspaces.map((ws) => {
              const wsPath = `/workspace/${ws.slug}`;
              const isActive = pathname.startsWith(wsPath);
              const isPending = !ws.hasApiToken;
              return (
                <div key={ws.slug}>
                  <Link
                    href={wsPath}
                    className={cn(
                      "flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                      isPending && "opacity-70",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Mail className="h-4 w-4" />
                      <span className="truncate">{ws.name}</span>
                    </div>
                    {isPending ? (
                      <span className="text-[10px] font-medium bg-yellow-500/20 text-yellow-300 rounded px-1.5 py-0.5">
                        Setup
                      </span>
                    ) : (
                      <ChevronRight className="h-3 w-3 opacity-50" />
                    )}
                  </Link>
                  {isActive && ws.hasApiToken && (
                    <div className="ml-7 mt-1 space-y-1">
                      <Link
                        href={`${wsPath}`}
                        className={cn(
                          "block rounded-md px-3 py-1.5 text-xs transition-colors",
                          pathname === wsPath
                            ? "text-sidebar-accent-foreground"
                            : "text-sidebar-foreground/50 hover:text-sidebar-foreground/70",
                        )}
                      >
                        Campaigns
                      </Link>
                      <Link
                        href={`${wsPath}/inbox`}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors",
                          pathname === `${wsPath}/inbox`
                            ? "text-sidebar-accent-foreground"
                            : "text-sidebar-foreground/50 hover:text-sidebar-foreground/70",
                        )}
                      >
                        <Inbox className="h-3 w-3" />
                        Inbox
                      </Link>
                      <Link
                        href={`${wsPath}/inbox-health`}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors",
                          pathname === `${wsPath}/inbox-health`
                            ? "text-sidebar-accent-foreground"
                            : "text-sidebar-foreground/50 hover:text-sidebar-foreground/70",
                        )}
                      >
                        <HeartPulse className="h-3 w-3" />
                        Inbox Health
                      </Link>
                      <Link
                        href={`${wsPath}/settings`}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors",
                          pathname === `${wsPath}/settings`
                            ? "text-sidebar-accent-foreground"
                            : "text-sidebar-foreground/50 hover:text-sidebar-foreground/70",
                        )}
                      >
                        <Settings className="h-3 w-3" />
                        Settings
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>
      </ScrollArea>
    </aside>
  );
}
