"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, FileText } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PageSummary {
  id: string;
  slug: string;
  title: string;
  clientId: string | null;
  clientName: string | null;
  updatedAt: string;
  createdAt: string;
}

interface ClientOption {
  id: string;
  name: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ─── Skeleton Cards ──────────────────────────────────────────────────────────

function SkeletonCards() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-md bg-muted animate-pulse shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3.5 bg-muted rounded animate-pulse w-3/4" />
                <div className="h-3 bg-muted rounded animate-pulse w-1/2" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </>
  );
}

// ─── Add Page Dialog ─────────────────────────────────────────────────────────

function AddPageDialog({ onCreated }: { onCreated: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState("");
  const [clients, setClients] = useState<ClientOption[]>([]);

  // Fetch clients when dialog opens
  useEffect(() => {
    if (!open) return;
    async function fetchClients() {
      try {
        const res = await fetch("/api/clients?isPipeline=false");
        const json = await res.json();
        setClients(
          (json.clients ?? []).map((c: { id: string; name: string }) => ({
            id: c.id,
            name: c.name,
          }))
        );
      } catch {
        // silently fail
      }
    }
    fetchClients();
  }, [open]);

  function resetForm() {
    setTitle("");
    setClientId("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { title: title.trim() };
      if (clientId && clientId !== "none") body.clientId = clientId;

      const res = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const json = await res.json();
        resetForm();
        setOpen(false);
        onCreated();
        toast.success("Page created");
        router.push(`/pages/${json.page?.slug ?? json.slug}`);
      } else {
        toast.error("Failed to create page");
      }
    } catch {
      toast.error("Failed to create page");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-2" />
          Add Page
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Page</DialogTitle>
            <DialogDescription>
              Create a new internal document or knowledge base page.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="page-title">Title *</Label>
              <Input
                id="page-title"
                placeholder="Getting Started Guide"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label>Client (optional)</Label>
              <Select
                value={clientId || "none"}
                onValueChange={(val) =>
                  setClientId(val === "none" ? "" : val)
                }
              >
                <SelectTrigger aria-label="Link to client">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim() || submitting}>
              {submitting ? "Creating..." : "Create Page"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PagesListPage() {
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pages");
      const json = await res.json();
      setPages(json.pages ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPages();
  }, [fetchPages]);

  return (
    <div>
      <Header
        title="Pages"
        description="Internal documents and knowledge base"
        actions={<AddPageDialog onCreated={fetchPages} />}
      />

      <div className="p-6 space-y-6">
        {/* Summary */}
        {!loading && (
          <div className="mb-6">
            <span className="text-xs text-muted-foreground">
              {pages.length} page{pages.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}

        {/* Card Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <SkeletonCards />
          </div>
        ) : pages.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No pages yet"
            description="Create your first internal document or knowledge base page to get started."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pages.map((page) => (
              <Link key={page.id} href={`/pages/${page.slug}`}>
                <Card className="hover:border-primary/40 transition-colors cursor-pointer h-full">
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-3">
                      <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">
                          {page.title}
                        </p>
                        {page.clientName ? (
                          <p className="text-xs text-primary/70 mt-0.5 truncate">
                            {page.clientName}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground/50 mt-0.5">
                            No client
                          </p>
                        )}
                        <p className="text-xs font-mono text-muted-foreground mt-1">
                          Updated {formatDate(page.updatedAt)}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
