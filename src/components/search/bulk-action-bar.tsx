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
    <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none">
      <div className="pointer-events-auto mb-4 mx-4 bg-stone-900 text-white rounded-lg px-5 py-3 flex items-center gap-4 shadow-xl animate-slide-up max-w-2xl w-full">
        {/* Left side: count + clear */}
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-medium whitespace-nowrap">
            {selectAllMatching
              ? `All ${totalMatching.toLocaleString()} selected`
              : `${selectedCount.toLocaleString()} selected`}
          </span>
          <button
            onClick={onClearSelection}
            className="text-sm text-stone-400 hover:text-white transition-colors underline underline-offset-2 whitespace-nowrap"
          >
            Clear
          </button>
        </div>

        {/* Separator */}
        <div className="w-px h-5 bg-stone-700 flex-shrink-0" />

        {/* Right side: action buttons */}
        <div className="flex items-center gap-2 ml-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
