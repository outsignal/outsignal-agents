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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

// ─── Skeleton Rows ───────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <TableRow key={i} className="border-border">
          <TableCell>
            <div className="h-3.5 bg-muted rounded animate-pulse w-40" />
          </TableCell>
          <TableCell>
            <div className="h-3.5 bg-muted rounded animate-pulse w-24" />
          </TableCell>
          <TableCell>
            <div className="h-3.5 bg-muted rounded animate-pulse w-20" />
          </TableCell>
        </TableRow>
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

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Last Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <SkeletonRows />
                ) : pages.length > 0 ? (
                  pages.map((page) => (
                    <TableRow key={page.id} className="border-border">
                      <TableCell>
                        <Link
                          href={`/pages/${page.slug}`}
                          className="font-medium text-sm hover:underline"
                        >
                          {page.title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {page.clientName ? (
                          <Link
                            href={`/clients/${page.clientId}`}
                            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                          >
                            {page.clientName}
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(page.updatedAt)}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="py-12 text-center text-muted-foreground"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <FileText
                          className="h-8 w-8 text-muted-foreground/40"
                          aria-hidden="true"
                        />
                        <p className="text-sm">
                          No pages yet. Create your first internal document.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
