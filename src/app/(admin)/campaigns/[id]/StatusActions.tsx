"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowRight, ArrowLeft, Loader2 } from "lucide-react";

interface StatusActionsProps {
  campaignId: string;
  status: string;
}

export function StatusActions({ campaignId, status }: StatusActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function transitionStatus(newStatus: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update status");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function publishForReview() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/publish`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to publish");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (status === "draft") {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          onClick={() => transitionStatus("internal_review")}
          disabled={loading}
          className="bg-[#635BFF] hover:bg-[#635BFF]/90 text-white"
        >
          {loading ? (
            <Loader2 className="size-3.5 mr-1.5 animate-spin" />
          ) : (
            <ArrowRight className="size-3.5 mr-1.5" />
          )}
          Move to Review
        </Button>
        {error && <p className="text-xs text-red-600 max-w-[200px] text-right">{error}</p>}
      </div>
    );
  }

  if (status === "internal_review") {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          onClick={publishForReview}
          disabled={loading}
          className="bg-[#635BFF] hover:bg-[#635BFF]/90 text-white"
        >
          {loading ? (
            <Loader2 className="size-3.5 mr-1.5 animate-spin" />
          ) : (
            <ArrowRight className="size-3.5 mr-1.5" />
          )}
          Publish for Client Review
        </Button>
        {error && <p className="text-xs text-red-600 max-w-[200px] text-right">{error}</p>}
      </div>
    );
  }

  if (status === "pending_approval") {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          variant="outline"
          onClick={() => transitionStatus("internal_review")}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="size-3.5 mr-1.5 animate-spin" />
          ) : (
            <ArrowLeft className="size-3.5 mr-1.5" />
          )}
          Send Back to Review
        </Button>
        {error && <p className="text-xs text-red-600 max-w-[200px] text-right">{error}</p>}
      </div>
    );
  }

  return null;
}
