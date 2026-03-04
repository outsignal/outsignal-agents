"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Rocket } from "lucide-react";

interface DeployButtonProps {
  campaignId: string;
  campaignName: string;
  status: string;
  leadsApproved: boolean;
  contentApproved: boolean;
  channels: string[];
  leadCount: number;
  emailStepCount: number;
  linkedinStepCount: number;
}

export function DeployButton({
  campaignId,
  campaignName,
  status,
  leadsApproved,
  contentApproved,
  channels,
  leadCount,
  emailStepCount,
  linkedinStepCount,
}: DeployButtonProps) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Only render when all conditions are met
  if (status !== "approved" || !leadsApproved || !contentApproved) {
    return null;
  }

  async function handleDeploy() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/deploy`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Deploy failed (${res.status})`);
      }
      setSuccess(true);
      // Refresh page data after short delay so user can read success message
      setTimeout(() => {
        setModalOpen(false);
        setSuccess(false);
        router.refresh();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deploy failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Deploy button */}
      <button
        onClick={() => {
          setError(null);
          setSuccess(false);
          setModalOpen(true);
        }}
        className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2"
      >
        <Rocket className="h-4 w-4" />
        Deploy Campaign
      </button>

      {/* Confirmation modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => {
            if (!loading) setModalOpen(false);
          }}
        >
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div
            className="relative w-full max-w-md rounded-xl bg-zinc-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-lg font-semibold text-zinc-50">
              Deploy Campaign
            </h2>
            <p className="mb-4 font-bold text-zinc-100">{campaignName}</p>

            {/* Stats grid */}
            <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg bg-zinc-800 p-4">
              <div>
                <p className="text-xs text-zinc-400">Leads</p>
                <p className="text-sm font-semibold text-zinc-100">
                  {leadCount.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-400">Channels</p>
                <p className="text-sm font-semibold text-zinc-100">
                  {channels.join(", ")}
                </p>
              </div>
              {channels.includes("email") && (
                <div>
                  <p className="text-xs text-zinc-400">Email Steps</p>
                  <p className="text-sm font-semibold text-zinc-100">
                    {emailStepCount}
                  </p>
                </div>
              )}
              {channels.includes("linkedin") && (
                <div>
                  <p className="text-xs text-zinc-400">LinkedIn Steps</p>
                  <p className="text-sm font-semibold text-zinc-100">
                    {linkedinStepCount}
                  </p>
                </div>
              )}
            </div>

            {/* Warning */}
            <p className="mb-5 text-xs text-zinc-400">
              This will push leads and content to the selected channels. This
              action cannot be undone.
            </p>

            {/* Error message */}
            {error && (
              <p className="mb-4 rounded-md bg-red-900/40 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}

            {/* Success message */}
            {success && (
              <p className="mb-4 rounded-md bg-emerald-900/40 px-3 py-2 text-sm text-emerald-300">
                Deploy started. Refreshing...
              </p>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={loading}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-zinc-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeploy}
                disabled={loading || success}
                className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-900/40 border-t-zinc-900" />
                    Deploying...
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4" />
                    Deploy Now
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
