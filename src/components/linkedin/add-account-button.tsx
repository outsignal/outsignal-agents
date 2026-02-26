"use client";

import { useState } from "react";
import { addLinkedInAccount } from "@/lib/linkedin/actions";
import { useRouter } from "next/navigation";

interface AddAccountButtonProps {
  workspaceSlug: string;
}

export function AddAccountButton({ workspaceSlug }: AddAccountButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    try {
      await addLinkedInAccount(workspaceSlug, name.trim());
      setOpen(false);
      setName("");
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add account");
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
        style={{ backgroundColor: "#F0FF7A", color: "#18181b" }}
      >
        + Add LinkedIn Account
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Full name (e.g. Jane Smith)"
        className="rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <button
        type="submit"
        disabled={loading || !name.trim()}
        className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
        style={{ backgroundColor: "#F0FF7A", color: "#18181b" }}
      >
        {loading ? "Adding..." : "Add"}
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setName(""); }}
        className="rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        Cancel
      </button>
    </form>
  );
}
