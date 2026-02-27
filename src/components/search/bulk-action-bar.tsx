"use client";

import React from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BulkActionBarProps {
  selectedCount: number;           // number of individually selected IDs
  selectAllMatching: boolean;      // true if "select all X matching" is active
  totalMatching: number;           // total count from search results
  onClearSelection: () => void;    // clear all selections
  children: React.ReactNode;       // action buttons (Add to List)
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BulkActionBar({
  selectedCount,
  selectAllMatching,
  totalMatching,
  onClearSelection,
  children,
}: BulkActionBarProps) {
  const displayCount = selectAllMatching ? totalMatching : selectedCount;

  if (displayCount === 0 && !selectAllMatching) return null;

  return (
    <div className="fixed bottom-0 left-64 right-0 z-50 bg-card border-t border-border px-6 py-3 flex items-center justify-between shadow-lg">
      {/* Left side: count + clear */}
      <div className="flex items-center gap-4">
        <span className="text-sm text-foreground font-medium">
          {selectAllMatching
            ? `All ${totalMatching.toLocaleString()} matching selected`
            : `${selectedCount.toLocaleString()} selected`}
        </span>
        <button
          onClick={onClearSelection}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          Clear selection
        </button>
      </div>

      {/* Right side: action buttons */}
      <div className="flex items-center gap-2">
        {children}
      </div>
    </div>
  );
}
