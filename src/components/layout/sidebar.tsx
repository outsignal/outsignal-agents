"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Settings,
  Building2,
  ListChecks,
  Briefcase,
  Target,
  PanelLeftClose,
  PanelLeftOpen,
  BarChart3,
  Megaphone,
  CircleDot,
  CircleDashed,
  FileText,
  ShieldCheck,
  Inbox,
  Search,
  LifeBuoy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { OutsignalLogo } from "@/components/brand/outsignal-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkspaceItem {
  slug: string;
  name: string;
  vertical?: string;
  status: string;
  hasApiToken: boolean;
}

export interface SidebarProps {
  workspaces: WorkspaceItem[];
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  key: string;
  label: string;
  /** If true, group header label is hidden (items rendered directly). */
  hideLabel?: boolean;
  items: NavItem[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIDEBAR_STORAGE_KEY = "sidebar-collapsed";

const STATIC_NAV_GROUPS: NavGroup[] = [
  {
    key: "core",
    label: "Core",
    hideLabel: true,
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/pipeline", label: "Pipeline", icon: Target },
      { href: "/inbox", label: "Inbox", icon: Inbox },
    ],
  },
  {
    key: "outreach",
    label: "Outreach",
    items: [
      { href: "/people", label: "People", icon: Users },
      { href: "/companies", label: "Companies", icon: Building2 },
      { href: "/lists", label: "Lists", icon: ListChecks },
    ],
  },
  {
    key: "health",
    label: "Health",
    items: [
      { href: "/deliverability", label: "Deliverability", icon: ShieldCheck },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    key: "business",
    label: "Business",
    items: [
      { href: "/clients", label: "Clients", icon: Briefcase },
      { href: "/financials", label: "Financials", icon: FileText },
    ],
  },
  // WORKSPACES group is inserted dynamically by buildNavGroups()
];

// ---------------------------------------------------------------------------
// Build nav groups with dynamic WORKSPACES group
// ---------------------------------------------------------------------------

function buildNavGroups(workspaces: WorkspaceItem[]): NavGroup[] {
  const workspacesGroup: NavGroup = {
    key: "workspaces",
    label: "Workspaces",
    items: workspaces.map((ws) => ({
      href: `/workspace/${ws.slug}`,
      label: ws.name,
      icon: ws.hasApiToken ? CircleDot : CircleDashed,
    })),
  };

  return [...STATIC_NAV_GROUPS, workspacesGroup];
}

// ---------------------------------------------------------------------------
// Main Sidebar
// ---------------------------------------------------------------------------

export function Sidebar({ workspaces }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  const navGroups = buildNavGroups(workspaces);

  // Support unread badge polling
  const [supportUnreadCount, setSupportUnreadCount] = useState(0);

  useEffect(() => {
    let active = true;
    async function fetchSupportUnread() {
      try {
        const res = await fetch("/api/support/unread-count");
        const json = await res.json();
        if (active) setSupportUnreadCount(json.count ?? 0);
      } catch {}
    }
    fetchSupportUnread();
    const interval = setInterval(fetchSupportUnread, 30_000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  // Hydrate collapsed state from localStorage after mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (stored === "true") setCollapsed(true);
    } catch {}
    setMounted(true);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  // Dispatch Cmd+K to open command palette
  const openCommandPalette = useCallback(() => {
    const event = new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      metaKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);
  }, []);

  // Prevent layout shift: render expanded width until client hydration completes
  const isCollapsed = mounted ? collapsed : false;

  // -----------------------------------------------------------------------
  // Render a single nav item
  // -----------------------------------------------------------------------
  function renderNavItem(item: NavItem) {
    const isActive =
      item.href === "/"
        ? pathname === "/"
        : pathname === item.href || pathname.startsWith(item.href + "/");

    const sharedClasses = cn(
      "flex items-center rounded-lg text-sm transition-colors duration-150 cursor-pointer",
      isCollapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
      isActive
        ? "bg-sidebar-accent text-sidebar-accent-foreground border-l-2 border-sidebar-primary"
        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground border-l-2 border-transparent",
    );

    const linkContent = (
      <Link href={item.href} className={sharedClasses}>
        <item.icon className="h-4 w-4 shrink-0" />
        {!isCollapsed && <span className="truncate">{item.label}</span>}
      </Link>
    );

    if (isCollapsed) {
      return (
        <Tooltip key={item.href}>
          <TooltipTrigger asChild>
            <div className="relative">{linkContent}</div>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {item.label}
          </TooltipContent>
        </Tooltip>
      );
    }

    return <div key={item.href}>{linkContent}</div>;
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
          "flex h-14 shrink-0 items-center border-b border-sidebar-border/50 text-sidebar-foreground",
          isCollapsed ? "justify-center px-2" : "px-6",
        )}
      >
        {isCollapsed ? (
          <Link href="/" title="Go to dashboard" aria-label="Go to dashboard">
            <OutsignalLogo variant="mark" className="h-7 w-7" />
          </Link>
        ) : (
          <Link href="/" aria-label="Go to dashboard">
            <OutsignalLogo className="h-7 w-auto" />
          </Link>
        )}
      </div>

      {/* Navigation */}
      <nav
        aria-label="Main navigation"
        className={cn("flex-1 py-4 overflow-y-auto", isCollapsed ? "px-1.5" : "px-3")}
      >
        <div className="space-y-4">
          {navGroups.map((group) => (
            <div key={group.key}>
              {!isCollapsed && !group.hideLabel && (
                <p className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => renderNavItem(item))}
              </div>
            </div>
          ))}
        </div>
      </nav>

      {/* Footer: Settings + Search + Theme + Collapse */}
      <div className="shrink-0 border-t border-sidebar-border/50 p-2 space-y-1">
        {/* Support link */}
        {(() => {
          const isSupportActive = pathname === "/support" || pathname.startsWith("/support/");
          const supportContent = (
            <Link
              href="/support"
              className={cn(
                "flex items-center rounded-lg text-sm transition-colors duration-150",
                isCollapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
                isSupportActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
              )}
            >
              <LifeBuoy className="h-4 w-4 shrink-0" />
              {!isCollapsed && <span className="truncate">Support</span>}
              {supportUnreadCount > 0 && (
                <span
                  className={cn(
                    "flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white leading-none",
                    isCollapsed ? "absolute -top-1 -right-1" : "ml-auto",
                  )}
                >
                  {supportUnreadCount > 99 ? "99+" : supportUnreadCount}
                </span>
              )}
            </Link>
          );
          if (isCollapsed) {
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="relative">{supportContent}</div>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  Support
                  {supportUnreadCount > 0 && (
                    <span className="ml-1.5 text-primary">({supportUnreadCount})</span>
                  )}
                </TooltipContent>
              </Tooltip>
            );
          }
          return supportContent;
        })()}

        {/* Settings link */}
        {(() => {
          const isSettingsActive = pathname === "/settings" || pathname.startsWith("/settings/");
          const settingsContent = (
            <Link
              href="/settings"
              className={cn(
                "flex items-center rounded-lg text-sm transition-colors duration-150",
                isCollapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
                isSettingsActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
              )}
            >
              <Settings className="h-4 w-4 shrink-0" />
              {!isCollapsed && <span>Settings</span>}
            </Link>
          );
          if (isCollapsed) {
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>{settingsContent}</div>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  Settings
                </TooltipContent>
              </Tooltip>
            );
          }
          return settingsContent;
        })()}

        {/* Search (Cmd+K) */}
        {(() => {
          const cmdKContent = (
            <button
              onClick={openCommandPalette}
              className={cn(
                "flex w-full items-center rounded-lg text-sm transition-colors duration-150 cursor-pointer",
                isCollapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
                "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
              )}
            >
              <Search className="h-4 w-4 shrink-0" />
              {!isCollapsed && (
                <>
                  <span>Search</span>
                  <kbd className="ml-auto inline-flex items-center gap-0.5 rounded border border-sidebar-border bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-medium text-sidebar-foreground/50 font-mono">
                    <span className="text-[11px]">&#8984;</span>K
                  </kbd>
                </>
              )}
            </button>
          );
          if (isCollapsed) {
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>{cmdKContent}</div>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  Search (&#8984;K)
                </TooltipContent>
              </Tooltip>
            );
          }
          return cmdKContent;
        })()}

        {/* Theme toggle */}
        <ThemeToggle collapsed={isCollapsed} />

        {/* Collapse/expand toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleCollapsed}
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
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
