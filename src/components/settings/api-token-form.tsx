"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function ApiTokenForm({ slug }: { slug: string }) {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/workspace/${slug}/configure`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiToken: token.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to save token");
        return;
      }

      router.refresh();
    } catch {
      setError("Failed to save token");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <Input
        type="text"
        placeholder="Paste API token..."
        value={token}
        onChange={(e) => setToken(e.target.value)}
        className="h-7 text-xs w-40"
      />
      <Button type="submit" size="sm" className="h-7 text-xs" disabled={loading}>
        {loading ? "Saving..." : "Save"}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
