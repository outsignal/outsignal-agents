"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Pencil, Trash2, Loader2, ArrowLeft } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/error-banner";
import { ControlledConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PageDetail {
  id: string;
  slug: string;
  title: string;
  content: string;
  clientId: string | null;
  clientName: string | null;
  updatedAt: string;
  createdAt: string;
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

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div>
      <header className="flex items-center justify-between border-b border-border/50 px-8 py-5">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 bg-muted rounded animate-pulse" />
          <div className="h-6 w-48 bg-muted rounded animate-pulse" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-8 w-16 bg-muted rounded animate-pulse" />
          <div className="h-8 w-16 bg-muted rounded animate-pulse" />
        </div>
      </header>
      <div className="p-6 space-y-6">
        <div className="h-6 w-32 bg-muted rounded animate-pulse" />
        <div className="space-y-3">
          <div className="h-4 bg-muted/50 rounded animate-pulse w-full" />
          <div className="h-4 bg-muted/50 rounded animate-pulse w-5/6" />
          <div className="h-4 bg-muted/50 rounded animate-pulse w-4/6" />
          <div className="h-4 bg-muted/50 rounded animate-pulse w-full" />
          <div className="h-4 bg-muted/50 rounded animate-pulse w-3/4" />
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PageDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;

  const [page, setPage] = useState<PageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  // Delete
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // ─── Fetch page ────────────────────────────────────────────────────

  const fetchPage = useCallback(async () => {
    try {
      const res = await fetch(`/api/pages/${slug}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError("Page not found");
          return;
        }
        throw new Error("Failed to fetch page");
      }
      const data = await res.json();
      setPage(data.page);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch page");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  // ─── Edit handlers ────────────────────────────────────────────────

  function handleStartEdit() {
    if (!page) return;
    setEditTitle(page.title);
    setEditContent(page.content ?? "");
    setEditing(true);
  }

  function handleCancelEdit() {
    setEditing(false);
    setEditTitle("");
    setEditContent("");
  }

  async function handleSave() {
    if (!page) return;
    setSaving(true);

    try {
      const res = await fetch(`/api/pages/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle, content: editContent }),
      });

      if (!res.ok) throw new Error("Failed to save page");

      const data = await res.json();
      setPage(data.page);
      setEditing(false);
      toast.success("Page saved");

      // If slug changed, redirect
      if (data.page?.slug && data.page.slug !== slug) {
        router.replace(`/pages/${data.page.slug}`);
      }
    } catch {
      toast.error("Failed to save page");
    } finally {
      setSaving(false);
    }
  }

  // ─── Delete handler ───────────────────────────────────────────────

  async function executeDelete() {
    setDeleteDialogOpen(false);
    setDeleting(true);

    try {
      const res = await fetch(`/api/pages/${slug}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete page");
      toast.success("Page deleted");
      router.push("/pages");
    } catch {
      toast.error("Failed to delete page");
      setDeleting(false);
    }
  }

  // ─── Loading / Error states ───────────────────────────────────────

  if (loading) return <PageSkeleton />;

  if (error || !page) {
    return (
      <div>
        <Header title="Page Not Found" />
        <div className="p-6 space-y-6">
          <ErrorBanner message={error ?? "Page not found"} />
          <Link
            href="/pages"
            className="mt-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Pages
          </Link>
        </div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <div>
      <Breadcrumb
        items={[
          { label: "Pages", href: "/pages" },
          { label: page.title },
        ]}
      />

      <Header
        title={editing ? "" : page.title}
        description={undefined}
        actions={
          editing ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelEdit}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={handleStartEdit}>
                <Pencil className="h-4 w-4 mr-1.5" />
                Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteDialogOpen(true)}
                disabled={deleting}
                className="text-destructive hover:text-destructive"
              >
                {deleting ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-1.5" />
                )}
                Delete
              </Button>
            </>
          )
        }
      />

      <div className="p-6 space-y-4">
        {/* Client badge */}
        {page.clientName && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Client:</span>
            <Badge variant="secondary" asChild>
              <Link href={`/clients/${page.clientId}`}>{page.clientName}</Link>
            </Badge>
          </div>
        )}

        {/* Content */}
        <Card>
          <CardContent className="pt-6">
            {editing ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label
                    htmlFor="edit-title"
                    className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
                  >
                    Title
                  </label>
                  <Input
                    id="edit-title"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="text-lg font-heading font-semibold"
                  />
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="edit-content"
                    className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
                  >
                    Content (Markdown)
                  </label>
                  <textarea
                    id="edit-content"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="flex min-h-[400px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
                    placeholder="Write your content in Markdown..."
                  />
                </div>
              </div>
            ) : (
              <div className="prose prose-sm max-w-none prose-headings:font-heading prose-headings:tracking-tight prose-a:text-primary prose-code:text-sm prose-pre:bg-muted prose-pre:border prose-pre:border-border">
                {page.content ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {page.content}
                  </ReactMarkdown>
                ) : (
                  <p className="text-muted-foreground italic">
                    No content yet. Click Edit to start writing.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Last updated */}
        {!editing && (
          <p className="text-xs text-muted-foreground">
            Last updated: {formatDate(page.updatedAt)}
          </p>
        )}
      </div>

      <ControlledConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Page"
        description="Are you sure you want to delete this page? This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={executeDelete}
      />
    </div>
  );
}
