"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Workspace {
  slug: string;
  name: string;
}

interface WorkspaceSwitcherProps {
  currentSlug: string;
  currentName: string;
}

export function WorkspaceSwitcher({ currentSlug, currentName }: WorkspaceSwitcherProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/portal/workspaces")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Workspace[]) => setWorkspaces(data))
      .catch(() => {});
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Single workspace — static display
  if (workspaces.length <= 1) {
    return (
      <div className="px-6 py-3 border-b border-sidebar-border/50">
        <p className="text-xs font-medium text-sidebar-foreground/50">Client Portal</p>
        <p className="text-sm font-medium text-sidebar-foreground truncate mt-0.5">
          {currentName}
        </p>
      </div>
    );
  }

  const handleSwitch = async (slug: string) => {
    if (slug === currentSlug || switching) return;
    setSwitching(true);
    try {
      const res = await fetch("/api/portal/switch-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug: slug }),
      });
      if (res.ok) {
        window.location.reload();
      }
    } catch {
      setSwitching(false);
    }
  };

  return (
    <div ref={ref} className="relative px-6 py-3 border-b border-sidebar-border/50">
      <p className="text-xs font-medium text-sidebar-foreground/50">Client Portal</p>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 mt-0.5 w-full text-left cursor-pointer group"
        disabled={switching}
      >
        <span className="text-sm font-medium text-sidebar-foreground truncate flex-1">
          {switching ? "Switching…" : currentName}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-sidebar-foreground/50 shrink-0 transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="absolute left-3 right-3 top-full mt-1 z-50 rounded-lg border border-border bg-popover shadow-lg py-1">
          {workspaces.map((w) => (
            <button
              key={w.slug}
              onClick={() => handleSwitch(w.slug)}
              className={cn(
                "flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors cursor-pointer",
                w.slug === currentSlug
                  ? "text-foreground bg-muted"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              <span className="truncate flex-1">{w.name}</span>
              {w.slug === currentSlug && (
                <Check className="h-3.5 w-3.5 text-brand shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
