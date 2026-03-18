"use client";

import { useState } from "react";
import { RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type TestState = "idle" | "testing" | "success" | "error";

export function IPRoyalTestButton() {
  const [state, setState] = useState<TestState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleTest() {
    setState("testing");
    setMessage(null);

    try {
      const res = await fetch("/api/iproyal/status");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }

      const data = await res.json();

      if (data.connected) {
        setState("success");
        setMessage(`Balance: $${data.balance?.toFixed(2) ?? "N/A"}`);
      } else {
        setState("error");
        setMessage(data.error ?? "Connection failed");
      }
    } catch {
      setState("error");
      setMessage("Network error");
    }

    // Reset after 4 seconds
    setTimeout(() => {
      setState("idle");
      setMessage(null);
    }, 4000);
  }

  return (
    <div className="flex items-center gap-2">
      {message && (
        <span
          className={cn(
            "text-xs",
            state === "success" ? "text-emerald-600" : "text-destructive",
          )}
        >
          {message}
        </span>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={handleTest}
        disabled={state === "testing"}
      >
        {state === "testing" && (
          <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
        )}
        {state === "success" && (
          <CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-emerald-600" />
        )}
        {state === "error" && (
          <XCircle className="h-3.5 w-3.5 mr-1.5 text-destructive" />
        )}
        Test Connection
      </Button>
    </div>
  );
}
