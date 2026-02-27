"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ListEnrichment {
  withEmail: number;
  withLinkedin: number;
  withCompany: number;
}

interface TargetList {
  id: string;
  name: string;
  workspaceSlug: string;
  description: string | null;
  createdAt: string;
  peopleCount: number;
  enrichment: ListEnrichment;
}

function EnrichmentBars({
  enrichment,
  peopleCount,
}: {
  enrichment: ListEnrichment;
  peopleCount: number;
}) {
  if (peopleCount === 0) {
    return <span className="text-xs text-muted-foreground">No people</span>;
  }

  const bars = [
    { label: "Email", value: enrichment.withEmail },
    { label: "LinkedIn", value: enrichment.withLinkedin },
    { label: "Co.", value: enrichment.withCompany },
  ];

  return (
    <div className="flex flex-col gap-1 min-w-[120px]">
      {bars.map(({ label, value }) => {
        const pct = Math.round((value / peopleCount) * 100);
        return (
          <div key={label} className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground w-10 shrink-0">
              {label}
            </span>
            <div className="flex-1 h-1.5 rounded-full bg-muted">
              <div
                className="h-1.5 rounded-full bg-brand"
                style={{
                  width: `${pct}%`,
                }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground w-7 text-right shrink-0">
              {pct}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ListIndexPage() {
  const router = useRouter();
  const [lists, setLists] = useState<TargetList[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<TargetList | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function fetchLists() {
    setLoading(true);
    try {
      const res = await fetch("/api/lists");
      if (res.ok) {
        const data = await res.json();
        setLists(data.lists ?? []);
      }
    } catch (err) {
      console.error("Failed to fetch lists:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLists();
  }, []);

  const filteredLists = lists.filter((list) =>
    list.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/lists/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setDeleteTarget(null);
        await fetchLists();
      }
    } catch (err) {
      console.error("Failed to delete list:", err);
    } finally {
      setDeleting(false);
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Target Lists</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Named lists of prospects ready for export
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="max-w-sm">
        <Input
          placeholder="Search lists by name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="border-border text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Name</TableHead>
              <TableHead className="text-muted-foreground">Workspace</TableHead>
              <TableHead className="text-muted-foreground text-right">People</TableHead>
              <TableHead className="text-muted-foreground">Enrichment</TableHead>
              <TableHead className="text-muted-foreground">Created</TableHead>
              <TableHead className="text-muted-foreground text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i} className="border-border">
                  <TableCell>
                    <Skeleton className="h-4 w-32 bg-muted" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-20 bg-muted" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-10 bg-muted" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-10 w-28 bg-muted" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-24 bg-muted" />
                  </TableCell>
                  <TableCell />
                </TableRow>
              ))
            ) : filteredLists.length === 0 ? (
              <TableRow className="border-border">
                <TableCell
                  colSpan={6}
                  className="text-center text-muted-foreground py-12"
                >
                  {searchQuery
                    ? `No lists matching "${searchQuery}"`
                    : "No lists yet. Add people from search results to create your first list."}
                </TableCell>
              </TableRow>
            ) : (
              filteredLists.map((list) => (
                <TableRow
                  key={list.id}
                  className="border-border hover:bg-muted/50 cursor-pointer"
                  onClick={() => router.push(`/lists/${list.id}`)}
                >
                  <TableCell className="font-medium text-foreground">
                    {list.name}
                    {list.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 font-normal">
                        {list.description}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="border-border text-foreground text-xs"
                    >
                      {list.workspaceSlug}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-foreground">
                    {list.peopleCount.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <EnrichmentBars
                      enrichment={list.enrichment}
                      peopleCount={list.peopleCount}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDate(list.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(list);
                      }}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Delete List</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Delete list &quot;{deleteTarget?.name}&quot;? People will remain
              in the database — only the list container will be removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="text-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
