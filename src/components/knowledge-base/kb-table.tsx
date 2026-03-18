"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import { BookOpen, Info, Search, Trash2 } from "lucide-react";
import { Header } from "@/components/layout/header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KBDocument {
  id: string;
  title: string;
  source: string;
  tags: string | null;
  chunkCount: number;
  createdAt: string;
}

interface KBStats {
  totalDocs: number;
  totalChunks: number;
  uniqueTags: number;
  lastIngested: string | null;
}

interface KBTableProps {
  documents: KBDocument[];
  stats: KBStats;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KBTable({ documents: initialDocs, stats }: KBTableProps) {
  const [documents, setDocuments] = useState(initialDocs);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return documents;
    const q = search.toLowerCase();
    return documents.filter(
      (doc) =>
        doc.title.toLowerCase().includes(q) ||
        (doc.tags && doc.tags.toLowerCase().includes(q)),
    );
  }, [documents, search]);

  async function handleDelete(doc: KBDocument) {
    setDeleting(doc.id);
    try {
      const res = await fetch(`/api/admin/knowledge-base/${doc.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Delete failed");
      }
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      toast.success(`Deleted "${doc.title}"`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete document",
      );
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      <Header
        title="Knowledge Base"
        description={`${stats.totalDocs} documents ingested`}
      />

      <div className="p-4 sm:p-8 space-y-6">
        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="Total Documents"
            value={stats.totalDocs}
            icon="FileText"
            accentColor="#635BFF"
          />
          <MetricCard
            label="Total Chunks"
            value={stats.totalChunks.toLocaleString()}
            icon="BookOpen"
            accentColor="#635BFF"
          />
          <MetricCard
            label="Unique Tags"
            value={stats.uniqueTags}
            icon="Star"
            accentColor="#635BFF"
          />
          <MetricCard
            label="Last Ingested"
            value={stats.lastIngested ? relativeTime(stats.lastIngested) : "Never"}
            icon="Activity"
            accentColor="#635BFF"
          />
        </div>

        {/* Info banner */}
        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Documents are ingested via CLI — run{" "}
            <code className="rounded bg-blue-100 px-1.5 py-0.5 font-mono text-xs dark:bg-blue-900">
              npx tsx scripts/ingest-document.ts &lt;file&gt;
            </code>
          </span>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by title or tags..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Result count */}
        <p className="text-sm text-muted-foreground">
          Showing {filtered.length} of {documents.length} documents
        </p>

        {/* Table */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <BookOpen className="h-10 w-10 mb-3 opacity-40" />
            <p className="text-sm font-medium">
              {documents.length === 0
                ? "No documents ingested yet"
                : "No documents match your search"}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead className="text-right">Chunks</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="font-medium max-w-[300px] truncate">
                      {doc.title}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={doc.source === "url" ? "info" : "secondary"}
                      >
                        {doc.source}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {doc.tags
                          ? doc.tags.split(",").map((tag) => (
                              <Badge
                                key={tag.trim()}
                                variant="outline"
                                size="xs"
                              >
                                {tag.trim()}
                              </Badge>
                            ))
                          : <span className="text-muted-foreground text-xs">--</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {doc.chunkCount}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(doc.createdAt)}
                    </TableCell>
                    <TableCell>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                            disabled={deleting === doc.id}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete document?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will remove &ldquo;{doc.title}&rdquo; and all
                              its {doc.chunkCount} chunks. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDelete(doc)}
                              className="bg-destructive text-white hover:bg-destructive/90"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </>
  );
}
