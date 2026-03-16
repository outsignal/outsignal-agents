"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

const CYCLE: Array<"light" | "dark" | "system"> = ["light", "dark", "system"];

const META: Record<string, { icon: typeof Sun; label: string }> = {
  light: { icon: Sun, label: "Light" },
  dark: { icon: Moon, label: "Dark" },
  system: { icon: Monitor, label: "System" },
};

export function ThemeToggle({ collapsed }: { collapsed?: boolean }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Avoid hydration mismatch — render nothing meaningful until mounted
  if (!mounted) {
    return (
      <div
        className={cn(
          "flex w-full items-center rounded-md transition-all duration-150 ease-out",
          collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-[7px]",
          "text-[13px] text-muted-foreground",
        )}
      >
        <Monitor className="shrink-0 h-4 w-4" />
        {!collapsed && <span>System</span>}
      </div>
    );
  }

  const current = (theme as "light" | "dark" | "system") ?? "system";
  const { icon: Icon, label } = META[current] ?? META.system;

  function cycle() {
    const idx = CYCLE.indexOf(current);
    const next = CYCLE[(idx + 1) % CYCLE.length];
    setTheme(next);
  }

  const button = (
    <button
      onClick={cycle}
      aria-label={`Theme: ${label}. Click to change.`}
      className={cn(
        "flex w-full items-center rounded-md transition-all duration-150 ease-out cursor-pointer",
        collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-[7px]",
        "text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="shrink-0 h-4 w-4" />
      {!collapsed && <span>{label}</span>}
    </button>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div>{button}</div>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8} className="text-xs">
          Theme: {label}
        </TooltipContent>
      </Tooltip>
    );
  }

  return button;
}
