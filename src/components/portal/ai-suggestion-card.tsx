"use client";

import { useState } from "react";
import { Sparkles, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AISuggestionCardProps {
  suggestion: string;
  onUse: (text: string) => void;
}

export function AISuggestionCard({ suggestion, onUse }: AISuggestionCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="border border-[#F0FF7A]/60 bg-[#F0FF7A]/5 dark:bg-[#F0FF7A]/5 rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-[#F0FF7A]/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-yellow-600 dark:text-yellow-400 shrink-0" />
          <span className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
            AI suggestion available
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          <pre className="whitespace-pre-wrap text-sm text-foreground bg-background/50 rounded-md p-3 border border-border/50 font-sans">
            {suggestion}
          </pre>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="brand"
              onClick={() => onUse(suggestion)}
              className="text-xs"
            >
              Use this
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDismissed(true)}
              className="text-xs"
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
