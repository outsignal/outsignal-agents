"use client";

import { useState, useCallback } from "react";
import { getSessionStatus } from "@/lib/linkedin/actions";
import { ConnectModal } from "@/components/linkedin/connect-modal";

interface ConnectButtonProps {
  senderId: string;
  senderName: string;
  sessionStatus: string;
  hasProxy: boolean;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  active: { label: "Connected", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400" },
  expired: { label: "Expired", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-400" },
  not_setup: { label: "Not Set Up", className: "bg-stone-100 text-stone-800 dark:bg-stone-800 dark:text-stone-300" },
};

export function ConnectButton({ senderId, senderName, sessionStatus, hasProxy }: ConnectButtonProps) {
  const [status, setStatus] = useState(sessionStatus);
  const [modalOpen, setModalOpen] = useState(false);

  const handleModalChange = useCallback(
    (open: boolean) => {
      setModalOpen(open);
      if (!open) {
        getSessionStatus(senderId).then((result) => {
          if (result) setStatus(result.status);
        });
      }
    },
    [senderId],
  );

  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.not_setup;

  return (
    <>
      <div className="flex items-center gap-3">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.className}`}
        >
          {config.label}
        </span>

        {hasProxy ? (
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            {status === "active" ? "Reconnect" : "Connect LinkedIn"}
          </button>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 dark:bg-stone-800 px-2.5 py-0.5 text-xs font-medium text-stone-600 dark:text-stone-400">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-400 animate-pulse" />
            Proxy setup in progress
          </span>
        )}
      </div>

      <ConnectModal
        open={modalOpen}
        onOpenChange={handleModalChange}
        senderId={senderId}
        senderName={senderName}
      />
    </>
  );
}
