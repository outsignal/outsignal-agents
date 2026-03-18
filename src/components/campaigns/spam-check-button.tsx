"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface SpamCheckResult {
  available: boolean;
  score?: number;
  verdict?: "clean" | "suspicious" | "spam";
  details?: string[];
  error?: string;
}

const VERDICT_STYLES = {
  clean: {
    badge: "bg-emerald-100 text-emerald-800 border-emerald-200",
    label: "Clean",
  },
  suspicious: {
    badge: "bg-amber-100 text-amber-800 border-amber-200",
    label: "Suspicious",
  },
  spam: {
    badge: "bg-red-100 text-red-800 border-red-200",
    label: "Spam",
  },
} as const;

interface Props {
  campaignId: string;
}

export function SpamCheckButton({ campaignId }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SpamCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCheck() {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/spam-check`, {
        method: "POST",
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: "Spam check failed" }));
        setError(json.error ?? "Spam check failed");
        return;
      }

      const data: SpamCheckResult = await res.json();
      setResult(data);
    } catch {
      setError("Network error - could not reach server");
    } finally {
      setLoading(false);
    }
  }

  // Not configured state
  if (result && !result.available) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/30" />
        Spam check not configured
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={handleCheck}
          disabled={loading}
          className="border-border text-foreground hover:text-foreground hover:bg-muted"
        >
          {loading ? "Checking..." : "Check for Spam"}
        </Button>

        {result?.verdict && (
          <Badge
            variant="outline"
            className={VERDICT_STYLES[result.verdict].badge}
          >
            {VERDICT_STYLES[result.verdict].label}
            {result.score !== undefined && ` (${result.score})`}
          </Badge>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      {result?.details && result.details.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs font-medium text-muted-foreground mb-2">Details</p>
          <ul className="space-y-1">
            {result.details.map((detail, i) => (
              <li key={i} className="text-sm text-foreground flex items-start gap-2">
                <span className="text-muted-foreground mt-1 shrink-0">-</span>
                {detail}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
