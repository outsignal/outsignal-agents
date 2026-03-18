"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface VerificationResult {
  available: boolean;
  verificationId?: number;
  name?: string;
  status?: "pending" | "processing" | "completed" | "failed";
  total?: number;
  verified?: number;
  invalid?: number;
  error?: string;
}

function StatBox({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-border p-3 text-center">
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{value.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

interface Props {
  listId: string;
}

export function VerifyEmailsButton({ listId }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const pollStatus = useCallback(
    async (verificationId: number) => {
      try {
        const res = await fetch(
          `/api/lists/${listId}/verify?verificationId=${verificationId}`,
        );
        if (!res.ok) return;

        const data: VerificationResult = await res.json();
        setResult(data);

        if (data.status === "completed" || data.status === "failed") {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          setLoading(false);
        }
      } catch {
        // Silently continue polling
      }
    },
    [listId],
  );

  async function handleVerify() {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`/api/lists/${listId}/verify`, {
        method: "POST",
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: "Verification failed" }));
        setError(json.error ?? "Verification failed");
        setLoading(false);
        return;
      }

      const data: VerificationResult = await res.json();
      setResult(data);

      if (!data.available) {
        setLoading(false);
        return;
      }

      // Start polling if pending/processing
      if (
        data.verificationId &&
        (data.status === "pending" || data.status === "processing")
      ) {
        pollRef.current = setInterval(() => {
          pollStatus(data.verificationId!);
        }, 5000);
      } else {
        setLoading(false);
      }
    } catch {
      setError("Network error - could not reach server");
      setLoading(false);
    }
  }

  // Not configured state
  if (result && !result.available) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/30" />
        Email verification not configured
      </div>
    );
  }

  const isPending = result?.status === "pending" || result?.status === "processing";
  const isComplete = result?.status === "completed";
  const isFailed = result?.status === "failed";

  // Calculate risky count (total - verified - invalid)
  const risky =
    isComplete && result.total !== undefined && result.verified !== undefined && result.invalid !== undefined
      ? Math.max(0, result.total - result.verified - result.invalid)
      : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={handleVerify}
          disabled={loading}
          className="border-border text-foreground hover:text-foreground hover:bg-muted"
        >
          {loading
            ? isPending
              ? "Verifying..."
              : "Starting..."
            : "Verify Emails"}
        </Button>

        {isPending && (
          <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-200">
            {result.status === "processing" ? "Processing" : "Queued"}
          </Badge>
        )}

        {isComplete && (
          <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-200">
            Complete
          </Badge>
        )}

        {isFailed && (
          <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">
            Failed
          </Badge>
        )}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {isPending && result.total !== undefined && (
        <p className="text-sm text-muted-foreground">
          Verifying {result.total.toLocaleString()} emails... This may take a few minutes.
        </p>
      )}

      {isComplete && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground">
            Verification Results
          </p>
          <div className="grid grid-cols-3 gap-3">
            <StatBox
              label="Valid"
              value={result.verified ?? 0}
              color="text-emerald-600"
            />
            <StatBox
              label="Invalid"
              value={result.invalid ?? 0}
              color="text-red-600"
            />
            <StatBox
              label="Risky / Unknown"
              value={risky}
              color="text-amber-600"
            />
          </div>
          {result.total !== undefined && result.verified !== undefined && result.total > 0 && (
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{
                    width: `${Math.round((result.verified / result.total) * 100)}%`,
                  }}
                />
              </div>
              <span className="text-sm font-medium text-foreground tabular-nums">
                {Math.round((result.verified / result.total) * 100)}% valid
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
