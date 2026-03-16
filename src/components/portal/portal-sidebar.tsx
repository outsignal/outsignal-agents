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
  MessageSquareText,
  Zap,
  Users,
  Building2,
  BarChart3,
  FileText,
  ClipboardCheck,
  Receipt,
  BookOpen,
  ShieldCheck,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { OutsignalLogo } from "@/components/brand/outsignal-logo";
import { ThemeToggle } from "@/components/theme-toggle";
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
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STORAGE_KEY = "portal-sidebar-collapsed";

const navItems: NavItem[] = [
  { href: "/portal", label: "Dashboard", icon: LayoutDashboard },
  { href: "/portal/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/portal/inbox", label: "Inbox", icon: Inbox },
  { href: "/portal/replies", label: "Replies", icon: MessageSquareText },
  { href: "/portal/linkedin", label: "LinkedIn", icon: LinkedinIcon },
  { href: "/portal/email-health", label: "Email Health", icon: Mail },
  { href: "/portal/signals", label: "Signals", icon: Zap },
  { href: "/portal/people", label: "People", icon: Users },
  { href: "/portal/companies", label: "Companies", icon: Building2 },
  { href: "/portal/data", label: "Data", icon: Users },
  { href: "/portal/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/portal/deliverability", label: "Deliverability", icon: ShieldCheck },
  { href: "/portal/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/portal/pages", label: "Pages", icon: FileText },
  { href: "/portal/onboarding", label: "Onboarding", icon: ClipboardCheck },
  { href: "/portal/billing", label: "Billing", icon: Receipt },
  { href: "/portal/settings", label: "Settings", icon: Settings },
];

export function PortalSidebar({ workspaceName }: PortalSidebarProps) {
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

  function renderNavItem(item: NavItem) {
    const isActive =
      item.href === "/portal"
        ? pathname === "/portal"
        : pathname === item.href || pathname.startsWith(item.href + "/");

    const isInbox = item.href === "/portal/inbox";

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
        {!isCollapsed && (
          <>
            <span>{item.label}</span>
            {isInbox && unreadCount > 0 && (
              <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-semibold px-1">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </>
        )}
      </Link>
    );

    if (isCollapsed) {
      return (
        <Tooltip key={item.href}>
          <TooltipTrigger asChild>
            <div className="relative">
              {linkContent}
              {isInbox && unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary text-primary-foreground text-[9px] font-bold px-0.5">
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

      {/* Workspace name */}
      {!isCollapsed && (
        <div className="px-6 py-3 border-b border-sidebar-border/50">
          <p className="text-xs font-medium text-sidebar-foreground/50 uppercase tracking-wider">
            Client Portal
          </p>
          <p className="text-sm font-medium text-sidebar-foreground truncate mt-0.5">
            {workspaceName}
          </p>
        </div>
      )}

      {/* Navigation */}
      <nav aria-label="Portal navigation" className={cn("flex-1 py-4", isCollapsed ? "px-1.5" : "px-3")}>
        <div className="space-y-1">
          {navItems.map((item) => renderNavItem(item))}
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
