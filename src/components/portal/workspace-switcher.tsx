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

function WorkspaceAvatar({
  name,
  size = "md",
  active = false,
}: {
  name: string;
  size?: "sm" | "md";
  active?: boolean;
}) {
  const initial = (name || "?").charAt(0).toUpperCase();
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-semibold shrink-0 select-none",
        "bg-brand text-brand-foreground",
        size === "sm" ? "h-7 w-7 text-xs rounded-md" : "h-8 w-8 text-sm",
        active && "ring-2 ring-brand/30 ring-offset-1 ring-offset-sidebar-primary-foreground",
      )}
    >
      {initial}
    </span>
  );
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

  // Single workspace — static display (collapsed: avatar only)
  if (workspaces.length <= 1) {
    return (
      <div className="px-4 py-3 border-b border-sidebar-border/50">
        <div className="flex items-center gap-3">
          <WorkspaceAvatar name={currentName} />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest font-semibold text-sidebar-foreground/40 leading-none">
              Client Portal
            </p>
            <p className="text-sm font-semibold text-sidebar-foreground truncate mt-1">
              {currentName}
            </p>
          </div>
        </div>
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
    <div ref={ref} className="relative px-4 py-3 border-b border-sidebar-border/50">
      <p className="text-[10px] uppercase tracking-widest font-semibold text-sidebar-foreground/40 leading-none mb-2">
        Client Portal
      </p>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-3 w-full text-left cursor-pointer rounded-lg p-1.5 -mx-1.5",
          "transition-colors duration-150",
          "hover:bg-sidebar-foreground/[0.06]",
          open && "bg-sidebar-foreground/[0.06]",
        )}
        disabled={switching}
      >
        <WorkspaceAvatar name={currentName} />
        <div className="min-w-0 flex-1">
          <span
            className={cn(
              "text-sm font-semibold text-sidebar-foreground truncate block",
              switching && "text-sidebar-foreground/50",
            )}
          >
            {switching ? "Switching\u2026" : currentName}
          </span>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-sidebar-foreground/40 shrink-0",
            "transition-transform duration-200 ease-out",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Dropdown */}
      <div
        className={cn(
          "absolute left-2 right-2 top-full mt-1 z-50",
          "rounded-xl border border-border bg-popover shadow-lg",
          "overflow-hidden",
          "transition-all duration-200 ease-out origin-top",
          open
            ? "opacity-100 scale-y-100 translate-y-0 pointer-events-auto"
            : "opacity-0 scale-y-95 -translate-y-1 pointer-events-none",
        )}
      >
        <div className="p-1.5">
          {workspaces.map((w) => {
            const isActive = w.slug === currentSlug;
            return (
              <button
                key={w.slug}
                onClick={() => handleSwitch(w.slug)}
                className={cn(
                  "flex items-center gap-2.5 w-full px-2.5 py-2 text-sm text-left rounded-lg cursor-pointer",
                  "transition-colors duration-100",
                  isActive
                    ? "bg-brand/10 text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                )}
              >
                <WorkspaceAvatar name={w.name} size="sm" active={isActive} />
                <span className="truncate flex-1">{w.name}</span>
                {isActive && (
                  <Check className="h-4 w-4 text-brand shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
