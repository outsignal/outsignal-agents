"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Settings,
  ChevronRight,
  Linkedin,
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
  BarChart3,
  Megaphone,
  Package,
  Plug,
  HeartPulse,
  Mail,
  DollarSign,
  ClipboardList,
  CircleDot,
  CircleDashed,
  Zap,
  FileText,
  TrendingUp,
  BookOpen,
  MessageSquareText,
  Brain,
  ShieldCheck,
  Inbox,
  Cpu,
  CalendarClock,
  Wallet,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { OutsignalLogo } from "@/components/brand/outsignal-logo";
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
  collapsible: boolean;
  defaultCollapsed?: boolean;
  items: NavItem[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIDEBAR_STORAGE_KEY = "sidebar-collapsed";
const GROUPS_STORAGE_KEY = "sidebar-collapsed-groups";

const STATIC_NAV_GROUPS: NavGroup[] = [
  {
    key: "core",
    label: "Core",
    collapsible: false,
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/pipeline", label: "Pipeline", icon: Target },
      { href: "/inbox", label: "Inbox", icon: Inbox },
    ],
  },
  {
    key: "data",
    label: "Data",
    collapsible: true,
    items: [
      { href: "/people", label: "People", icon: Users },
      { href: "/companies", label: "Companies", icon: Building2 },
      { href: "/lists", label: "Lists", icon: ListChecks },
      { href: "/replies", label: "Replies", icon: MessageSquareText },
    ],
  },
  {
    key: "email-health",
    label: "Email Health",
    collapsible: true,
    items: [
      { href: "/email", label: "Email Health", icon: Mail },
      { href: "/deliverability", label: "Deliverability", icon: ShieldCheck },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/intelligence", label: "Intelligence Hub", icon: Brain },
      { href: "/senders", label: "Senders", icon: Linkedin },
      { href: "/linkedin-queue", label: "LinkedIn Queue", icon: ListOrdered },
    ],
  },
  {
    key: "business",
    label: "Business",
    collapsible: true,
    items: [
      { href: "/clients", label: "Clients", icon: Briefcase },
      { href: "/financials", label: "Invoices", icon: FileText },
      { href: "/revenue", label: "Revenue", icon: TrendingUp },
      { href: "/platform-costs", label: "Costs", icon: Wallet },
      { href: "/cashflow", label: "Cashflow", icon: BarChart3 },
      { href: "/onboard", label: "Onboard", icon: ClipboardList },
      { href: "/pages", label: "Pages", icon: FileText },
    ],
  },
  // WORKSPACES group is inserted dynamically by buildNavGroups()
  {
    key: "system",
    label: "System",
    collapsible: true,
    defaultCollapsed: true,
    items: [
      { href: "/agent-runs", label: "Agent Runs", icon: Activity },
      { href: "/background-tasks", label: "Background Tasks", icon: Cpu },
      { href: "/enrichment-costs", label: "Enrichment Costs", icon: DollarSign },
      { href: "/integrations", label: "Integrations", icon: Plug },
      { href: "/notification-health", label: "Notification Health", icon: HeartPulse },
      { href: "/notifications", label: "Notifications", icon: Bell },
      { href: "/ooo-queue", label: "OOO Queue", icon: CalendarClock },
      { href: "/signals", label: "Signals", icon: Zap },
      { href: "/webhook-log", label: "Webhook Log", icon: Webhook },
      { href: "/packages", label: "Packages", icon: Package },
      { href: "/agent-guide", label: "Agent Guide", icon: BookOpen },
    ],
  },
];

// ---------------------------------------------------------------------------
// Build nav groups with dynamic WORKSPACES group
// ---------------------------------------------------------------------------

function buildNavGroups(workspaces: WorkspaceItem[]): NavGroup[] {
  const workspacesGroup: NavGroup = {
    key: "workspaces",
    label: "Workspaces",
    collapsible: true,
    items: workspaces.map((ws) => ({
      href: `/workspace/${ws.slug}`,
      label: ws.name,
      icon: ws.hasApiToken ? CircleDot : CircleDashed,
    })),
  };

  // Insert workspaces group before the system group (last static group)
  const groups = [...STATIC_NAV_GROUPS];
  const systemIndex = groups.findIndex((g) => g.key === "system");
  if (systemIndex !== -1) {
    groups.splice(systemIndex, 0, workspacesGroup);
  } else {
    groups.push(workspacesGroup);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Collapsible Nav Group
// ---------------------------------------------------------------------------

function CollapsibleGroup({
  group,
  isGroupOpen,
  onToggle,
  isSidebarCollapsed,
  renderItem,
}: {
  group: NavGroup;
  isGroupOpen: boolean;
  onToggle: () => void;
  isSidebarCollapsed: boolean;
  renderItem: (item: NavItem) => React.ReactNode;
}) {
  // When sidebar is collapsed, never show group headers -- just show icons
  if (isSidebarCollapsed) {
    if (!group.collapsible) {
      return (
        <div className="space-y-0.5">
          {group.items.map((item) => renderItem(item))}
        </div>
      );
    }
    if (!isGroupOpen) return null;
    return (
      <div className="space-y-0.5">
        {group.items.map((item) => renderItem(item))}
      </div>
    );
  }

  // Non-collapsible groups (Core): just show items, no header
  if (!group.collapsible) {
    return (
      <div className="space-y-0.5">
        {group.items.map((item) => renderItem(item))}
      </div>
    );
  }

  return (
    <div>
      {/* Group header */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 group cursor-pointer"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 text-[var(--stone-400)] transition-transform duration-150 ease-out",
            isGroupOpen && "rotate-90",
          )}
        />
        <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--stone-400)] font-medium select-none">
          {group.label}
        </span>
      </button>

      {/* Collapsible items with smooth height animation */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-150 ease-out",
          isGroupOpen ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0",
        )}
      >
        <div className="space-y-0.5">
          {group.items.map((item) => renderItem(item))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Sidebar
// ---------------------------------------------------------------------------

export function Sidebar({ workspaces }: SidebarProps) {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const navGroups = buildNavGroups(workspaces);

  // Hydrate collapsed states from localStorage after mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (stored === "true") setCollapsed(true);
    } catch {}

    // Hydrate group collapsed states
    try {
      const storedGroups = localStorage.getItem(GROUPS_STORAGE_KEY);
      if (storedGroups) {
        setCollapsedGroups(JSON.parse(storedGroups));
      } else {
        // Set defaults: collapse groups marked defaultCollapsed
        const defaults: Record<string, boolean> = {};
        for (const g of STATIC_NAV_GROUPS) {
          if (g.defaultCollapsed) defaults[g.key] = true;
        }
        setCollapsedGroups(defaults);
      }
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

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(next));
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

  // Fetch unread notification count
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
    return () => {
      active = false;
      clearInterval(interval);
    };
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

    const isNotification = item.href === "/notifications";

    const linkContent = (
      <Link
        href={item.href}
        className={cn(
          "group/item flex items-center rounded-md transition-all duration-150 ease-out",
          isCollapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-[7px]",
          "text-[13px]",
          isActive
            ? "bg-[color:oklch(0.55_0.25_275_/_0.08)] text-[color:var(--brand)] border-l-2 border-[color:var(--brand)]"
            : cn(
                "border-l-2 border-transparent",
                "text-[var(--stone-600)] hover:bg-[var(--stone-100)] hover:text-[var(--stone-900)]",
              ),
        )}
      >
        <item.icon
          className={cn(
            "shrink-0 h-4 w-4 transition-colors duration-150",
            isActive
              ? "text-[color:var(--brand)]"
              : "text-[var(--stone-400)] group-hover/item:text-[var(--stone-600)]",
          )}
        />
        {!isCollapsed && (
          <span className="truncate">{item.label}</span>
        )}
        {isNotification && unreadCount > 0 && (
          <span
            className={cn(
              "flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white leading-none",
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
            <div className="relative">{linkContent}</div>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8} className="text-xs">
            {item.label}
            {isNotification && unreadCount > 0 && (
              <span className="ml-1.5 text-red-400">({unreadCount})</span>
            )}
          </TooltipContent>
        </Tooltip>
      );
    }

    return <div key={item.href}>{linkContent}</div>;
  }

  return (
    <aside
      className={cn(
        "flex h-screen flex-col bg-white border-r border-[var(--sidebar-border)] transition-all duration-200 ease-out",
        isCollapsed ? "w-16" : "w-64",
      )}
      style={{
        // CSS custom properties for stone palette (warm neutrals matching the brand)
        // These map to the warm-stone system from globals.css
        ["--stone-50" as string]: "oklch(0.985 0.002 90)",
        ["--stone-100" as string]: "oklch(0.97 0.002 90)",
        ["--stone-200" as string]: "oklch(0.93 0.002 90)",
        ["--stone-300" as string]: "oklch(0.87 0.003 90)",
        ["--stone-400" as string]: "oklch(0.65 0.005 60)",
        ["--stone-500" as string]: "oklch(0.55 0.005 60)",
        ["--stone-600" as string]: "oklch(0.45 0.005 60)",
        ["--stone-700" as string]: "oklch(0.35 0.005 60)",
        ["--stone-800" as string]: "oklch(0.25 0.005 60)",
        ["--stone-900" as string]: "oklch(0.145 0.005 60)",
      }}
    >
      {/* Logo header */}
      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-b border-[var(--sidebar-border)]",
          isCollapsed ? "justify-center px-2" : "px-5",
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

      {/* Scrollable nav */}
      <ScrollArea className={cn("flex-1 py-3", isCollapsed ? "px-1.5" : "px-2.5")}>
        <nav aria-label="Main navigation" className="space-y-4">
          {navGroups.map((group) => {
            const isGroupOpen = !collapsedGroups[group.key];
            return (
              <CollapsibleGroup
                key={group.key}
                group={group}
                isGroupOpen={isGroupOpen}
                onToggle={() => toggleGroup(group.key)}
                isSidebarCollapsed={isCollapsed}
                renderItem={renderNavItem}
              />
            );
          })}
        </nav>
      </ScrollArea>

      {/* Bottom section: Settings + Cmd+K + Collapse toggle */}
      <div className="shrink-0 border-t border-[var(--sidebar-border)] p-2 space-y-0.5">
        {/* Settings link */}
        {(() => {
          const isSettingsActive = pathname === "/settings" || pathname.startsWith("/settings/");
          const settingsContent = (
            <Link
              href="/settings"
              className={cn(
                "group/item flex items-center rounded-md transition-all duration-150 ease-out",
                isCollapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-[7px]",
                "text-[13px]",
                isSettingsActive
                  ? "bg-[color:oklch(0.55_0.25_275_/_0.08)] text-[color:var(--brand)]"
                  : "text-[var(--stone-500)] hover:bg-[var(--stone-100)] hover:text-[var(--stone-700)]",
              )}
            >
              <Settings
                className={cn(
                  "shrink-0 h-4 w-4 transition-colors duration-150",
                  isSettingsActive
                    ? "text-[color:var(--brand)]"
                    : "text-[var(--stone-400)] group-hover/item:text-[var(--stone-500)]",
                )}
              />
              {!isCollapsed && <span>Settings</span>}
            </Link>
          );
          if (isCollapsed) {
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>{settingsContent}</div>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8} className="text-xs">
                  Settings
                </TooltipContent>
              </Tooltip>
            );
          }
          return settingsContent;
        })()}

        {/* Cmd+K shortcut hint */}
        {(() => {
          const cmdKContent = (
            <button
              onClick={openCommandPalette}
              className={cn(
                "flex w-full items-center rounded-md transition-all duration-150 ease-out cursor-pointer",
                isCollapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-[7px]",
                "text-[13px] text-[var(--stone-400)] hover:bg-[var(--stone-100)] hover:text-[var(--stone-600)]",
              )}
            >
              <Search className="shrink-0 h-4 w-4" />
              {!isCollapsed && (
                <>
                  <span>Search</span>
                  <kbd className="ml-auto inline-flex items-center gap-0.5 rounded border border-[var(--stone-200)] bg-[var(--stone-50)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--stone-400)] font-mono">
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
                <TooltipContent side="right" sideOffset={8} className="text-xs">
                  Search (&#8984;K)
                </TooltipContent>
              </Tooltip>
            );
          }
          return cmdKContent;
        })()}

        {/* Collapse/expand toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleCollapsed}
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={cn(
                "flex w-full items-center rounded-md py-2 text-[13px] transition-all duration-150 ease-out cursor-pointer",
                "text-[var(--stone-400)] hover:bg-[var(--stone-100)] hover:text-[var(--stone-600)]",
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
            <TooltipContent side="right" sideOffset={8} className="text-xs">
              Expand sidebar
            </TooltipContent>
          )}
        </Tooltip>
      </div>
    </aside>
  );
}
