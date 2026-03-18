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
  active: { label: "Connected", className: "bg-emerald-100 text-emerald-800" },
  expired: { label: "Expired", className: "bg-yellow-100 text-yellow-800" },
  not_setup: { label: "Not Set Up", className: "bg-gray-100 text-gray-800" },
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
          <div className="flex flex-col">
            <button
              disabled
              className="inline-flex items-center rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground/50 bg-muted cursor-not-allowed"
            >
              Connect LinkedIn
            </button>
            <span className="text-[11px] text-muted-foreground mt-1">
              We&apos;re setting up a proxy for your account
            </span>
          </div>
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
