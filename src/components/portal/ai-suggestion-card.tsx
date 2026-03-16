"use client";

import { useState } from "react";
import { Sparkles, Check, Pencil, X, ChevronUp, ChevronDown } from "lucide-react";
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
    <div className="rounded-lg border border-brand/20 border-l-2 border-l-brand bg-brand/[0.03] overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-brand/[0.05] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand shrink-0" />
          <span className="text-sm font-semibold text-foreground">
            AI Suggested Reply
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
          <div className="border-l-2 border-border pl-3 py-1">
            <p className="text-[15px] leading-relaxed text-foreground whitespace-pre-wrap">
              {suggestion}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="brand"
              onClick={() => onUse(suggestion)}
              className="text-xs gap-1.5"
            >
              <Check className="h-3.5 w-3.5" />
              Accept
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onUse(suggestion)}
              className="text-xs gap-1.5"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDismissed(true)}
              className="text-xs text-muted-foreground hover:text-foreground gap-1.5"
            >
              <X className="h-3.5 w-3.5" />
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
