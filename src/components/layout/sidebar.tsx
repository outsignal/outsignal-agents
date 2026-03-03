"use client";

import { useState, useEffect, useCallback } from "react";
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
  LinkedinIcon,
  Building2,
  ListChecks,
  Briefcase,
  Target,
  Bell,
  PanelLeftClose,
  PanelLeftOpen,
  Activity,
  Webhook,
  ListOrdered,
  Megaphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { OutsignalLogo } from "@/components/brand/outsignal-logo";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

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

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STORAGE_KEY = "sidebar-collapsed";

// Navigation organized into logical groups with dividers between them
const navGroups: NavItem[][] = [
  // Group 1 — Core
  [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/people", label: "People", icon: Users },
    { href: "/companies", label: "Companies", icon: Building2 },
    { href: "/lists", label: "Lists", icon: ListChecks },
  ],
  // Group 2 — Business
  [
    { href: "/clients", label: "Clients", icon: Briefcase },
    { href: "/campaigns", label: "Campaigns", icon: Megaphone },
    { href: "/pipeline", label: "Pipeline", icon: Target },
    { href: "/onboard", label: "Proposals", icon: UserPlus },
    { href: "/onboarding", label: "Onboarding", icon: ClipboardList },
  ],
  // Group 3 — LinkedIn
  [
    { href: "/senders", label: "Senders", icon: LinkedinIcon },
    { href: "/linkedin-queue", label: "LinkedIn Queue", icon: ListOrdered },
  ],
  // Group 4 — Operations
  [
    { href: "/agent-runs", label: "Agent Runs", icon: Activity },
    { href: "/webhook-log", label: "Webhook Log", icon: Webhook },
    { href: "/notifications", label: "Notifications", icon: Bell },
  ],
  // Group 5 — Config
  [
    { href: "/settings", label: "Settings", icon: Settings },
  ],
];

export function Sidebar({ workspaces }: SidebarProps) {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Hydrate collapsed state from localStorage after mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "true") setCollapsed(true);
    } catch {}
    setMounted(true);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    let active = true;
    async function fetchUnread() {
      try {
        const res = await fetch("/api/notifications?page=1");
        const json = await res.json();
        if (active) {
          setUnreadCount(
            json.notifications?.filter((n: { read: boolean }) => !n.read).length ?? 0,
          );
        }
      } catch {}
    }
    fetchUnread();
    const interval = setInterval(fetchUnread, 60_000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  // Prevent layout shift: render expanded width until client hydration completes
  const isCollapsed = mounted ? collapsed : false;

  function renderNavItem(item: NavItem) {
    const isActive =
      item.href === "/"
        ? pathname === "/"
        : pathname === item.href || pathname.startsWith(item.href + "/");

    const linkContent = (
      <Link
        href={item.href}
        className={cn(
          "flex items-center rounded-lg text-sm transition-colors duration-150",
          isCollapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground border-l-2 border-brand"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground border-l-2 border-transparent",
        )}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        {!isCollapsed && <>{item.label}</>}
        {item.href === "/notifications" && unreadCount > 0 && (
          <span
            className={cn(
              "flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white",
              isCollapsed ? "absolute -top-1 -right-1" : "ml-auto",
            )}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Link>
    );

    if (isCollapsed) {
      return (
        <Tooltip key={item.href}>
          <TooltipTrigger asChild>
            <div className="relative">
              {linkContent}
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {item.label}
            {item.href === "/notifications" && unreadCount > 0 && (
              <span className="ml-1.5 text-red-400">({unreadCount})</span>
            )}
          </TooltipContent>
        </Tooltip>
      );
    }

    return (
      <div key={item.href}>
        {linkContent}
      </div>
    );
  }

  return (
    <aside
      className={cn(
        "flex h-screen flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-all duration-200",
        isCollapsed ? "w-16" : "w-64",
      )}
    >
      {/* Logo header */}
      <div
        className={cn(
          "flex h-14 items-center border-b border-sidebar-border/50 text-white",
          isCollapsed ? "justify-center px-2" : "px-6",
        )}
      >
        {isCollapsed ? (
          <OutsignalLogo variant="mark" className="h-7 w-7" />
        ) : (
          <OutsignalLogo className="h-7 w-auto" />
        )}
      </div>

      {/* Scrollable nav */}
      <ScrollArea className={cn("flex-1 py-4", isCollapsed ? "px-1.5" : "px-3")}>
        <nav>
          {navGroups.map((group, groupIndex) => (
            <div key={groupIndex}>
              {/* Divider between groups (not before first group) */}
              {groupIndex > 0 && (
                <div className={cn("h-px bg-sidebar-border my-2", isCollapsed ? "mx-1" : "mx-3")} />
              )}
              <div className="space-y-1">
                {group.map((item) => renderNavItem(item))}
              </div>
            </div>
          ))}
        </nav>

        {/* Workspaces section */}
        <div className="mt-6">
          <div className={cn("h-px bg-sidebar-border mb-4", isCollapsed ? "mx-1" : "mx-3")} />
          {!isCollapsed && (
            <p className="px-3 text-xs font-medium text-sidebar-foreground/50 uppercase tracking-wider mb-2">
              Workspaces
            </p>
          )}
          <nav className="space-y-1">
            {workspaces.map((ws) => {
              const wsPath = `/workspace/${ws.slug}`;
              const isActive = pathname.startsWith(wsPath);
              const isPending = !ws.hasApiToken;

              if (isCollapsed) {
                return (
                  <Tooltip key={ws.slug}>
                    <TooltipTrigger asChild>
                      <Link
                        href={wsPath}
                        className={cn(
                          "flex items-center justify-center rounded-lg px-2 py-2 transition-colors",
                          isActive
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                          isPending && "opacity-70",
                        )}
                      >
                        <Mail className="h-4 w-4 shrink-0" />
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      {ws.name}
                      {isPending && (
                        <span className="ml-1.5 text-yellow-300">(Setup)</span>
                      )}
                    </TooltipContent>
                  </Tooltip>
                );
              }

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
                        href={`${wsPath}/linkedin`}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors",
                          pathname === `${wsPath}/linkedin`
                            ? "text-sidebar-accent-foreground"
                            : "text-sidebar-foreground/50 hover:text-sidebar-foreground/70",
                        )}
                      >
                        <LinkedinIcon className="h-3 w-3" />
                        LinkedIn
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

      {/* Collapse/expand toggle footer */}
      <div className="border-t border-sidebar-border/50 p-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleCollapsed}
              className={cn(
                "flex w-full items-center rounded-lg py-2 text-sm text-sidebar-foreground/50 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors duration-150",
                isCollapsed ? "justify-center px-2" : "gap-3 px-3",
              )}
            >
              {isCollapsed ? (
                <PanelLeftOpen className="h-4 w-4 shrink-0" />
              ) : (
                <>
                  <PanelLeftClose className="h-4 w-4 shrink-0" />
                  <span>Collapse</span>
                </>
              )}
            </button>
          </TooltipTrigger>
          {isCollapsed && (
            <TooltipContent side="right" sideOffset={8}>
              Expand sidebar
            </TooltipContent>
          )}
        </Tooltip>
      </div>
    </aside>
  );
}
