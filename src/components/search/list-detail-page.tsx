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
      <span className="text-sm text-zinc-400 w-20 shrink-0">{label}</span>
      <div className="flex-1 h-2.5 rounded-full bg-zinc-800 max-w-xs">
        <div
          className="h-2.5 rounded-full transition-all"
          style={{
            width: `${pct}%`,
            backgroundColor: "#F0FF7A",
          }}
        />
      </div>
      <span className="text-sm text-zinc-300 w-10 text-right shrink-0">
        {pct}%
      </span>
      <span className="text-xs text-zinc-500 shrink-0">
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
        <Link href="/lists" className="text-sm text-zinc-400 hover:text-white">
          &larr; Back to Lists
        </Link>
        <div className="mt-12 text-center text-zinc-500">List not found.</div>
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
            className="text-sm text-zinc-400 hover:text-white"
          >
            &larr; Back to Lists
          </Link>
          {loading && !list ? (
            <Skeleton className="h-8 w-48 bg-zinc-800 mt-2" />
          ) : (
            <div className="flex items-center gap-3 mt-2">
              <h1 className="text-2xl font-bold text-white">{list?.name}</h1>
              <Badge
                variant="outline"
                className="border-zinc-700 text-zinc-300"
              >
                {list?.workspaceSlug}
              </Badge>
              <span className="text-sm text-zinc-400">
                {total.toLocaleString()} people
              </span>
            </div>
          )}
          {list?.description && (
            <p className="text-sm text-zinc-400">{list.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-800"
            onClick={() => {
              window.open(`/api/lists/${listId}/export`, "_blank");
            }}
            disabled={loading && !list}
          >
            Export CSV
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
      </div>

      {/* Enrichment summary bars */}
      {(summary || (loading && !data)) && (
        <div className="border border-zinc-800 rounded-lg p-4 space-y-2.5 bg-zinc-950">
          <h2 className="text-sm font-semibold text-zinc-300 mb-3">
            Enrichment Coverage
          </h2>
          {loading && !data ? (
            <div className="space-y-2">
              {["Email", "LinkedIn", "Company"].map((label) => (
                <div key={label} className="flex items-center gap-3">
                  <span className="text-sm text-zinc-400 w-20">{label}</span>
                  <Skeleton className="flex-1 h-2.5 bg-zinc-800 max-w-xs" />
                  <Skeleton className="h-4 w-10 bg-zinc-800" />
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
      <div className="border border-zinc-800 rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-800 hover:bg-transparent">
              <TableHead className="text-zinc-400">Name</TableHead>
              <TableHead className="text-zinc-400">Email</TableHead>
              <TableHead className="text-zinc-400">Company</TableHead>
              <TableHead className="text-zinc-400">Title</TableHead>
              <TableHead className="text-zinc-400">Vertical</TableHead>
              <TableHead className="text-zinc-400">Enrichment</TableHead>
              <TableHead className="text-zinc-400 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && people.length === 0 ? (
              Array.from({ length: 10 }).map((_, i) => (
                <TableRow key={i} className="border-zinc-800">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full bg-zinc-800" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : people.length === 0 ? (
              <TableRow className="border-zinc-800">
                <TableCell
                  colSpan={7}
                  className="text-center text-zinc-500 py-12"
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
                  <TableRow key={entry.id} className="border-zinc-800 hover:bg-zinc-900">
                    <TableCell className="text-white">
                      {fullName || (
                        <span className="text-zinc-500 italic">Unknown</span>
                      )}
                    </TableCell>
                    <TableCell className="text-zinc-300 text-sm font-mono">
                      {p.email}
                    </TableCell>
                    <TableCell className="text-zinc-300 text-sm">
                      {p.company ?? (
                        <span className="text-zinc-600">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-zinc-300 text-sm">
                      {p.jobTitle ?? (
                        <span className="text-zinc-600">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {p.vertical ? (
                        <Badge
                          variant="outline"
                          className="border-zinc-700 text-zinc-300 text-xs"
                        >
                          {p.vertical}
                        </Badge>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <InlineEnrichmentBadge person={p} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-zinc-400 hover:text-red-300 hover:bg-red-950 text-xs"
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
        <div className="flex items-center justify-between text-sm text-zinc-400">
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
              className="text-zinc-300 hover:text-white"
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
              className="text-zinc-300 hover:text-white"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Delete list confirmation */}
      <Dialog open={showDeleteList} onOpenChange={setShowDeleteList}>
        <DialogContent className="bg-zinc-900 border-zinc-700">
          <DialogHeader>
            <DialogTitle className="text-white">Delete List</DialogTitle>
            <DialogDescription className="text-zinc-400">
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
              className="text-zinc-300 hover:text-white"
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
