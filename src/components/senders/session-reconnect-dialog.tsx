"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SessionReconnectDialogProps {
  senderId: string;
  senderName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SessionReconnectDialog({
  senderId,
  senderName,
  open,
  onOpenChange,
}: SessionReconnectDialogProps) {
  const router = useRouter();
  const [liAt, setLiAt] = useState("");
  const [jsessionId, setJsessionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    if (!liAt.trim() || !jsessionId.trim()) {
      setError("Both fields are required");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/linkedin/senders/${senderId}/reconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liAt: liAt.trim(), jsessionId: jsessionId.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to reconnect");
      }
      setLiAt("");
      setJsessionId("");
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reconnect");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reconnect LinkedIn — {senderName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Paste cookies from a logged-in LinkedIn browser session. Open DevTools &rarr; Application &rarr; Cookies &rarr; linkedin.com.
          </p>
          <div className="space-y-2">
            <Label htmlFor="li-at">li_at cookie</Label>
            <Input
              id="li-at"
              placeholder="AQEDAb..."
              value={liAt}
              onChange={(e) => setLiAt(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="jsession">JSESSIONID cookie</Label>
            <Input
              id="jsession"
              placeholder="ajax:123456789"
              value={jsessionId}
              onChange={(e) => setJsessionId(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Reconnecting..." : "Reconnect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
