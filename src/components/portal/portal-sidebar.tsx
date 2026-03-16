"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Megaphone,
  Inbox,
  LinkedinIcon,
  Mail,
  ShieldCheck,
  Receipt,
  LifeBuoy,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { OutsignalLogo } from "@/components/brand/outsignal-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { WorkspaceSwitcher } from "@/components/portal/workspace-switcher";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

interface PortalSidebarProps {
  workspaceSlug: string;
  workspaceName: string;
}

interface NavItem {
  href?: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const STORAGE_KEY = "portal-sidebar-collapsed";

const navGroups: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/portal", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Outreach",
    items: [
      { href: "/portal/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/portal/inbox", label: "Inbox", icon: Inbox },
      { href: "/portal/linkedin", label: "LinkedIn", icon: LinkedinIcon },
    ],
  },
  {
    label: "Health",
    items: [
      { href: "/portal/email-health", label: "Email Health", icon: Mail },
      { href: "/portal/deliverability", label: "Deliverability", icon: ShieldCheck },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/portal/billing", label: "Billing", icon: Receipt },
      {
        label: "Support",
        icon: LifeBuoy,
        onClick: () => window.dispatchEvent(new Event("open-support-widget")),
      },
    ],
  },
];

export function PortalSidebar({ workspaceSlug, workspaceName }: PortalSidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Hydrate collapsed state from localStorage after mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "true") setCollapsed(true);
    } catch {}
    setMounted(true);
  }, []);

  // Poll unread count every 30s for nav badge
  useEffect(() => {
    let active = true;
    async function fetchUnread() {
      try {
        const res = await fetch("/api/portal/inbox/unread-count");
        const json = await res.json();
        if (active) setUnreadCount(json.total ?? 0);
      } catch {}
    }
    fetchUnread();
    const interval = setInterval(fetchUnread, 30_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
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

  // Prevent layout shift: render expanded width until client hydration completes
  const isCollapsed = mounted ? collapsed : false;

  const handleLogout = async () => {
    await fetch("/api/portal/logout", { method: "POST" });
    window.location.href = "/portal/login";
  };

  function isItemActive(item: NavItem) {
    if (!item.href) return false;
    return item.href === "/portal"
      ? pathname === "/portal"
      : pathname === item.href || pathname.startsWith(item.href + "/");
  }

  function renderNavItem(item: NavItem) {
    const isActive = isItemActive(item);
    const isInbox = item.href === "/portal/inbox";

    const sharedClasses = cn(
      "flex items-center rounded-lg text-sm transition-colors duration-150 cursor-pointer",
      isCollapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
      isActive
        ? "bg-sidebar-accent text-sidebar-accent-foreground border-l-2 border-sidebar-primary"
        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground border-l-2 border-transparent",
    );

    const innerContent = (
      <>
        <item.icon className="h-4 w-4 shrink-0" />
        {!isCollapsed && (
          <>
            <span>{item.label}</span>
            {isInbox && unreadCount > 0 && (
              <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand text-white text-[10px] font-semibold px-1">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </>
        )}
      </>
    );

    const element = item.href ? (
      <Link href={item.href} className={sharedClasses}>
        {innerContent}
      </Link>
    ) : (
      <button onClick={item.onClick} className={cn(sharedClasses, "w-full")}>
        {innerContent}
      </button>
    );

    const key = item.href ?? item.label;

    if (isCollapsed) {
      return (
        <Tooltip key={key}>
          <TooltipTrigger asChild>
            <div className="relative">
              {element}
              {isInbox && unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand text-white text-[9px] font-bold px-0.5">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {item.label}
            {isInbox && unreadCount > 0 && (
              <span className="ml-1.5 text-primary">({unreadCount})</span>
            )}
          </TooltipContent>
        </Tooltip>
      );
    }

    return <div key={key}>{element}</div>;
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
          "flex h-14 items-center border-b border-sidebar-border/50 text-sidebar-foreground",
          isCollapsed ? "justify-center px-2" : "px-6",
        )}
      >
        {isCollapsed ? (
          <OutsignalLogo variant="mark" className="h-7 w-7" />
        ) : (
          <OutsignalLogo className="h-7 w-auto" />
        )}
      </div>

      {/* Workspace switcher */}
      {!isCollapsed && (
        <WorkspaceSwitcher currentSlug={workspaceSlug} currentName={workspaceName} />
      )}

      {/* Navigation */}
      <nav aria-label="Portal navigation" className={cn("flex-1 py-4 overflow-y-auto", isCollapsed ? "px-1.5" : "px-3")}>
        <div className="space-y-4">
          {navGroups.map((group) => (
            <div key={group.label}>
              {!isCollapsed && (
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

      {/* Footer: logout + collapse toggle */}
      <div className="border-t border-sidebar-border/50 p-2 space-y-1">
        {/* Logout button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleLogout}
              aria-label="Sign out"
              className={cn(
                "flex w-full items-center rounded-lg py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors duration-150",
                isCollapsed ? "justify-center px-2" : "gap-3 px-3",
              )}
            >
              <LogOut className="h-4 w-4 shrink-0" />
              {!isCollapsed && <span>Sign Out</span>}
            </button>
          </TooltipTrigger>
          {isCollapsed && (
            <TooltipContent side="right" sideOffset={8}>
              Sign Out
            </TooltipContent>
          )}
        </Tooltip>

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
