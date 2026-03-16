"use client";

import { useState } from "react";
import { Sparkles, Check, Pencil, X, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AISuggestionCardProps {
  suggestion: string;
  onUse: (text: string) => void;
}

function parseReplyBody(raw: string): string {
  // Strip reasoning after --- separator
  const parts = raw.split(/\n---\n/);
  const main = parts[0];
  // Extract body text after **Body:** marker
  const bodyMatch = main.match(/\*\*Body:\*\*\s*([\s\S]*)/i);
  if (bodyMatch) return bodyMatch[1].trim();
  // Fallback: strip preamble before "Subject:" if present
  const subjectMatch = main.match(/\*\*Subject:\*\*.*?\n\s*([\s\S]*)/i);
  if (subjectMatch) return subjectMatch[1].trim();
  // Last resort: return first part as-is
  return main.trim();
}

export function AISuggestionCard({ suggestion, onUse }: AISuggestionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const cleanBody = parseReplyBody(suggestion);

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
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-4 pb-3 space-y-0">
          <div className="rounded-md bg-white dark:bg-card border-l-2 border-brand/30 p-3">
            <p className="text-[15px] leading-relaxed text-foreground whitespace-pre-wrap">
              {cleanBody}
            </p>
          </div>
          <div className="flex items-center gap-2 border-t border-border pt-3 mt-3">
            <Button
              size="sm"
              variant="brand"
              onClick={() => onUse(cleanBody)}
              className="text-xs gap-1.5"
            >
              <Check className="h-3.5 w-3.5" />
              Accept
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onUse(cleanBody)}
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
