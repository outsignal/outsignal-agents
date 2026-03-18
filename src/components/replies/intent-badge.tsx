"use client";

import { useState, useRef, useEffect } from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  INTENTS,
  INTENT_LABELS,
  INTENT_COLORS,
  type Intent,
} from "@/lib/classification/types";

interface IntentBadgeProps {
  intent: string | null;
  overrideIntent: string | null;
  editable?: boolean;
  onOverride?: (intent: string) => void;
}

export function IntentBadge({
  intent,
  overrideIntent,
  editable = false,
  onOverride,
}: IntentBadgeProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const effective = (overrideIntent ?? intent) as Intent | null;
  const isOverridden = !!overrideIntent;

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (!effective) {
    return (
      <span className="inline-flex items-center rounded-full bg-stone-100 dark:bg-stone-800 px-2.5 py-0.5 text-xs font-medium text-stone-500 dark:text-stone-400">
        Unclassified
      </span>
    );
  }

  const label = INTENT_LABELS[effective] ?? effective;
  const colorClasses = INTENT_COLORS[effective] ?? "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300";

  if (!editable) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
          colorClasses,
        )}
      >
        {label}
        {isOverridden && <Pencil className="h-2.5 w-2.5 opacity-60" />}
      </span>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium cursor-pointer transition-opacity hover:opacity-80",
          colorClasses,
        )}
      >
        {label}
        {isOverridden && <Pencil className="h-2.5 w-2.5 opacity-60" />}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-44 rounded-md border bg-popover p-1 shadow-md">
          {INTENTS.map((i) => {
            const iLabel = INTENT_LABELS[i];
            const iColor = INTENT_COLORS[i];
            const isSelected = i === effective;
            return (
              <button
                key={i}
                onClick={() => {
                  onOverride?.(i);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none",
                  isSelected
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <span
                  className={cn(
                    "inline-block h-2 w-2 rounded-full",
                    iColor.replace(/text-\S+/, ""),
                  )}
                />
                {iLabel}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
