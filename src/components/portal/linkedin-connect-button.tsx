"use client";

import { useState, useCallback } from "react";
import { PortalConnectModal } from "@/components/portal/linkedin-connect-modal";

interface PortalConnectButtonProps {
  senderId: string;
  senderName: string;
  sessionStatus: string;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  active: { label: "Connected", className: "bg-emerald-100 text-emerald-800" },
  expired: { label: "Expired", className: "bg-yellow-100 text-yellow-800" },
  not_setup: { label: "Not Set Up", className: "bg-gray-100 text-gray-800" },
};

export function PortalConnectButton({ senderId, senderName, sessionStatus }: PortalConnectButtonProps) {
  const [status, setStatus] = useState(sessionStatus);
  const [modalOpen, setModalOpen] = useState(false);

  const handleModalChange = useCallback(
    (open: boolean) => {
      setModalOpen(open);
      if (!open) {
        fetch("/api/portal/linkedin/status")
          .then((r) => r.json())
          .then((senders: { id: string; sessionStatus: string }[]) => {
            const match = senders.find((s) => s.id === senderId);
            if (match) setStatus(match.sessionStatus);
          })
          .catch(() => {
            // Silently ignore — status will refresh on next page load
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

        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          {status === "active" ? "Reconnect" : "Connect LinkedIn"}
        </button>
      </div>

      <PortalConnectModal
        open={modalOpen}
        onOpenChange={handleModalChange}
        senderId={senderId}
        senderName={senderName}
      />
    </>
  );
}
