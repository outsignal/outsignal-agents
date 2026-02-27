"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getEnrichmentStatus,
  ENRICHMENT_COLORS,
  ENRICHMENT_LABELS,
} from "@/lib/enrichment/status";

interface PersonInList {
  id: string; // TargetListPerson.id
  personId: string;
  addedAt: string;
  person: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    jobTitle: string | null;
    vertical: string | null;
    linkedinUrl: string | null;
    companyDomain: string | null;
  };
}

interface ListDetail {
  id: string;
  name: string;
  workspaceSlug: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ListSummary {
  total: number;
  withEmail: number;
  withLinkedin: number;
  withCompany: number;
}

interface ListDetailData {
  list: ListDetail;
  people: PersonInList[];
  total: number;
  page: number;
  pageSize: number;
  summary: ListSummary;
}

function InlineEnrichmentBadge({
  person,
}: {
  person: { email: string | null; linkedinUrl: string | null; companyDomain: string | null };
}) {
  const status = getEnrichmentStatus(person);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span
        className="inline-block w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: ENRICHMENT_COLORS[status] }}
      />
      {ENRICHMENT_LABELS[status]}
    </span>
  );
}

function SummaryBar({
  label,
  value,
  total,
}: {
  label: string;
  value: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted-foreground w-20 shrink-0">{label}</span>
      <div className="flex-1 h-2.5 rounded-full bg-muted max-w-xs">
        <div
          className="h-2.5 rounded-full transition-all bg-brand"
          style={{
            width: `${pct}%`,
          }}
        />
      </div>
      <span className="text-sm text-foreground w-10 text-right shrink-0">
        {pct}%
      </span>
      <span className="text-xs text-muted-foreground shrink-0">
        ({value} / {total})
      </span>
    </div>
  );
}

interface Props {
  listId: string;
}

export function ListDetailPage({ listId }: Props) {
  const router = useRouter();
  const [data, setData] = useState<ListDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [page, setPage] = useState(1);
  const [showDeleteList, setShowDeleteList] = useState(false);
  const [deletingList, setDeletingList] = useState(false);
  const [removingPersonId, setRemovingPersonId] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const fetchData = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/lists/${listId}?page=${p}`);
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (res.ok) {
          const json = await res.json();
          setData(json);
          setNotFound(false);
        }
      } catch (err) {
        console.error("Failed to fetch list detail:", err);
      } finally {
        setLoading(false);
      }
    },
    [listId]
  );

  useEffect(() => {
    fetchData(page);
  }, [fetchData, page]);

  async function handleDeleteList() {
    setDeletingList(true);
    try {
      const res = await fetch(`/api/lists/${listId}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/lists");
      }
    } catch (err) {
      console.error("Failed to delete list:", err);
    } finally {
      setDeletingList(false);
    }
  }

  async function handleExportCsv() {
    setExportLoading(true);
    setExportError(null);
    try {
      const res = await fetch(`/api/lists/${listId}/export`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: "Export failed" }));
        setExportError(json.error ?? "Export failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const filename =
        res.headers.get("Content-Disposition")?.match(/filename="(.+?)"/)?.[1] ??
        "export.csv";
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setExportLoading(false);
    }
  }

  async function handleRemovePerson(personId: string) {
    setRemovingPersonId(personId);
    try {
      const res = await fetch(`/api/lists/${listId}/people`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId }),
      });
      if (res.ok) {
        // Refresh current page
        await fetchData(page);
      }
    } catch (err) {
      console.error("Failed to remove person:", err);
    } finally {
      setRemovingPersonId(null);
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  if (notFound) {
    return (
      <div className="p-6">
        <Link href="/lists" className="text-sm text-muted-foreground hover:text-foreground">
          &larr; Back to Lists
        </Link>
        <div className="mt-12 text-center text-muted-foreground">List not found.</div>
      </div>
    );
  }

  const list = data?.list;
  const summary = data?.summary;
  const people = data?.people ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 50;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <Link
            href="/lists"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            &larr; Back to Lists
          </Link>
          {loading && !list ? (
            <Skeleton className="h-8 w-48 bg-muted mt-2" />
          ) : (
            <div className="flex items-center gap-3 mt-2">
              <h1 className="text-2xl font-bold text-foreground">{list?.name}</h1>
              <Badge
                variant="outline"
                className="border-border text-foreground"
              >
                {list?.workspaceSlug}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {total.toLocaleString()} people
              </span>
            </div>
          )}
          {list?.description && (
            <p className="text-sm text-muted-foreground">{list.description}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-border text-foreground hover:text-foreground hover:bg-muted"
              onClick={handleExportCsv}
              disabled={exportLoading || (loading && !list)}
            >
              {exportLoading ? "Exporting..." : "Export CSV"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-red-400 hover:text-red-300 hover:bg-red-950"
              onClick={() => setShowDeleteList(true)}
              disabled={loading && !list}
            >
              Delete List
            </Button>
          </div>
          {exportError && (
            <p className="text-xs text-red-400">{exportError}</p>
          )}
        </div>
      </div>

      {/* Enrichment summary bars */}
      {(summary || (loading && !data)) && (
        <div className="border border-border rounded-lg p-4 space-y-2.5 bg-card">
          <h2 className="text-sm font-semibold text-foreground mb-3">
            Enrichment Coverage
          </h2>
          {loading && !data ? (
            <div className="space-y-2">
              {["Email", "LinkedIn", "Company"].map((label) => (
                <div key={label} className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground w-20">{label}</span>
                  <Skeleton className="flex-1 h-2.5 bg-muted max-w-xs" />
                  <Skeleton className="h-4 w-10 bg-muted" />
                </div>
              ))}
            </div>
          ) : (
            summary && (
              <>
                <SummaryBar
                  label="Email"
                  value={summary.withEmail}
                  total={summary.total}
                />
                <SummaryBar
                  label="LinkedIn"
                  value={summary.withLinkedin}
                  total={summary.total}
                />
                <SummaryBar
                  label="Company"
                  value={summary.withCompany}
                  total={summary.total}
                />
              </>
            )
          )}
        </div>
      )}

      {/* People table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">Name</TableHead>
              <TableHead className="text-muted-foreground">Email</TableHead>
              <TableHead className="text-muted-foreground">Company</TableHead>
              <TableHead className="text-muted-foreground">Title</TableHead>
              <TableHead className="text-muted-foreground">Vertical</TableHead>
              <TableHead className="text-muted-foreground">Enrichment</TableHead>
              <TableHead className="text-muted-foreground text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && people.length === 0 ? (
              Array.from({ length: 10 }).map((_, i) => (
                <TableRow key={i} className="border-border">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full bg-muted" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : people.length === 0 ? (
              <TableRow className="border-border">
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground py-12"
                >
                  No people in this list yet.
                </TableCell>
              </TableRow>
            ) : (
              people.map((entry) => {
                const p = entry.person;
                const fullName =
                  [p.firstName, p.lastName].filter(Boolean).join(" ") || null;
                const isRemoving = removingPersonId === p.id;

                return (
                  <TableRow key={entry.id} className="border-border hover:bg-muted/50">
                    <TableCell className="text-foreground">
                      {fullName || (
                        <span className="text-muted-foreground italic">Unknown</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm font-mono">
                      {p.email}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {p.company ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {p.jobTitle ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {p.vertical ? (
                        <Badge
                          variant="outline"
                          className="border-border text-foreground text-xs"
                        >
                          {p.vertical}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <InlineEnrichmentBadge person={p} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-red-300 hover:bg-red-950 text-xs"
                        onClick={() => handleRemovePerson(p.id)}
                        disabled={isRemoving}
                      >
                        {isRemoving ? "Removing..." : "Remove"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {((page - 1) * pageSize + 1).toLocaleString()}–
            {Math.min(page * pageSize, total).toLocaleString()} of{" "}
            {total.toLocaleString()} people
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => p - 1)}
              disabled={page <= 1 || loading}
              className="text-foreground hover:text-foreground"
            >
              Previous
            </Button>
            <span className="flex items-center px-2">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= totalPages || loading}
              className="text-foreground hover:text-foreground"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Delete list confirmation */}
      <Dialog open={showDeleteList} onOpenChange={setShowDeleteList}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Delete List</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Delete list &quot;{list?.name}&quot;? People will remain in the
              database — only the list container and its memberships will be
              removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setShowDeleteList(false)}
              disabled={deletingList}
              className="text-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteList}
              disabled={deletingList}
            >
              {deletingList ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
