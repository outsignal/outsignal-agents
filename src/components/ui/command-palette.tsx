"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  LayoutDashboard,
  Megaphone,
  Target,
  Users,
  Building2,
  Inbox,
  Mail,
  ShieldCheck,
  BarChart3,
  Brain,
  MessageSquareText,
  ListOrdered,
  Linkedin,
  FileText,
  TrendingUp,
  Briefcase,
  Settings,
  Search,
  Plus,
  RefreshCw,
  Zap,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommandItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  onSelect: () => void;
}

interface CommandGroup {
  heading: string;
  items: CommandItem[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  // Global keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const navigate = useCallback(
    (path: string) => {
      setOpen(false);
      router.push(path);
    },
    [router],
  );

  const groups: CommandGroup[] = [
    {
      heading: "Navigation",
      items: [
        { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, onSelect: () => navigate("/") },
        { id: "campaigns", label: "Campaigns", icon: Megaphone, onSelect: () => navigate("/campaigns") },
        { id: "pipeline", label: "Pipeline", icon: Target, onSelect: () => navigate("/pipeline") },
        { id: "people", label: "People", icon: Users, onSelect: () => navigate("/people") },
        { id: "companies", label: "Companies", icon: Building2, onSelect: () => navigate("/companies") },
        { id: "inbox", label: "Inbox", icon: Inbox, onSelect: () => navigate("/inbox") },
        { id: "email-health", label: "Email Health", icon: Mail, onSelect: () => navigate("/email") },
        { id: "deliverability", label: "Deliverability", icon: ShieldCheck, onSelect: () => navigate("/deliverability") },
        { id: "analytics", label: "Analytics", icon: BarChart3, onSelect: () => navigate("/analytics") },
        { id: "intelligence", label: "Intelligence Hub", icon: Brain, onSelect: () => navigate("/intelligence") },
        { id: "replies", label: "Replies", icon: MessageSquareText, onSelect: () => navigate("/replies") },
        { id: "linkedin-queue", label: "LinkedIn Queue", icon: ListOrdered, onSelect: () => navigate("/linkedin-queue") },
        { id: "senders", label: "Senders", icon: Linkedin, onSelect: () => navigate("/senders") },
        { id: "signals", label: "Signals", icon: Zap, onSelect: () => navigate("/signals") },
        { id: "invoices", label: "Invoices", icon: FileText, onSelect: () => navigate("/financials") },
        { id: "revenue", label: "Revenue", icon: TrendingUp, onSelect: () => navigate("/revenue") },
        { id: "clients", label: "Clients", icon: Briefcase, onSelect: () => navigate("/clients") },
        { id: "settings", label: "Settings", icon: Settings, onSelect: () => navigate("/settings") },
      ],
    },
    {
      heading: "Actions",
      items: [
        { id: "new-campaign", label: "New Campaign", icon: Plus, onSelect: () => navigate("/campaigns/new") },
        { id: "new-client", label: "New Client", icon: Plus, onSelect: () => navigate("/clients/new") },
        { id: "sync-replies", label: "Sync Replies", icon: RefreshCw, onSelect: () => navigate("/replies?sync=1") },
        { id: "search-people", label: "Search People", icon: Search, onSelect: () => navigate("/people") },
        { id: "search-companies", label: "Search Companies", icon: Search, onSelect: () => navigate("/companies") },
      ],
    },
  ];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in duration-150"
        onClick={() => setOpen(false)}
      />

      {/* Dialog */}
      <div className="absolute inset-0 flex items-start justify-center pt-[min(20vh,200px)]">
        <div className="w-full max-w-[640px] mx-4 animate-in fade-in zoom-in-95 duration-150">
          <Command
            className="overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
            loop
          >
            {/* Search input */}
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Command.Input
                placeholder="Search or jump to..."
                className="flex-1 bg-transparent py-3.5 text-base text-foreground placeholder:text-muted-foreground outline-none"
                autoFocus
              />
              <kbd className="hidden sm:inline-flex h-5 items-center rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
                ESC
              </kbd>
            </div>

            {/* Results */}
            <Command.List className="max-h-[min(60vh,400px)] overflow-y-auto overscroll-contain p-2">
              <Command.Empty className="py-12 text-center text-sm text-muted-foreground">
                No results found.
              </Command.Empty>

              {groups.map((group) => (
                <Command.Group
                  key={group.heading}
                  heading={group.heading}
                  className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted-foreground"
                >
                  {group.items.map((item) => (
                    <Command.Item
                      key={item.id}
                      value={item.label}
                      onSelect={item.onSelect}
                      className="group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-foreground outline-none aria-selected:bg-brand-muted aria-selected:text-foreground data-[selected=true]:bg-brand-muted data-[selected=true]:text-foreground"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-secondary group-aria-selected:border-brand/20 group-aria-selected:bg-brand-muted group-data-[selected=true]:border-brand/20 group-data-[selected=true]:bg-brand-muted">
                        <item.icon className="h-4 w-4 text-muted-foreground group-aria-selected:text-brand group-data-[selected=true]:text-brand" />
                      </div>
                      <span className="flex-1">{item.label}</span>
                      {item.shortcut && (
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[11px] text-muted-foreground">
                          {item.shortcut}
                        </kbd>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-border px-4 py-2">
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">↑↓</kbd>
                  navigate
                </span>
                <span className="inline-flex items-center gap-1">
                  <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">↵</kbd>
                  select
                </span>
                <span className="inline-flex items-center gap-1">
                  <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">esc</kbd>
                  close
                </span>
              </div>
            </div>
          </Command>
        </div>
      </div>
    </div>
  );
}
