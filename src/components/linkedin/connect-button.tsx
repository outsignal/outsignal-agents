"use client";

import { useState, useEffect, useCallback } from "react";
import { startLoginSession, getSessionStatus } from "@/lib/linkedin/actions";

interface ConnectButtonProps {
  senderId: string;
  sessionStatus: string;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  active: { label: "Connected", className: "bg-emerald-100 text-emerald-800" },
  expired: { label: "Expired", className: "bg-yellow-100 text-yellow-800" },
  not_setup: { label: "Not Set Up", className: "bg-gray-100 text-gray-800" },
};

export function ConnectButton({ senderId, sessionStatus }: ConnectButtonProps) {
  const [status, setStatus] = useState(sessionStatus);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);

  // Poll for status changes when a login session is active
  const poll = useCallback(async () => {
    const result = await getSessionStatus(senderId);
    if (result?.status === "active" && status !== "active") {
      setStatus("active");
      setLoading(false);
      setPolling(false);
      setLoginUrl(null);
    }
  }, [senderId, status]);

  useEffect(() => {
    if (!polling) return;

    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [polling, poll]);

  const handleConnect = async () => {
    setLoading(true);
    try {
      const { loginUrl: url } = await startLoginSession(senderId);
      setLoginUrl(url);
      setPolling(true);
    } catch (err) {
      setLoading(false);
      alert(err instanceof Error ? err.message : "Failed to start login session");
    }
  };

  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.not_setup;

  return (
    <div className="flex items-center gap-3">
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.className}`}
      >
        {config.label}
      </span>

      {loginUrl ? (
        <a
          href={loginUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center rounded-md border px-3 py-1.5 text-xs font-medium text-white bg-[#F0FF7A] text-black hover:bg-[#d9e66e] transition-colors"
        >
          Open Login Window
        </a>
      ) : (
        <button
          onClick={handleConnect}
          disabled={loading}
          className="inline-flex items-center rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
        >
          {loading
            ? "Starting session..."
            : status === "active"
              ? "Reconnect"
              : "Connect LinkedIn"}
        </button>
      )}
    </div>
  );
}
