"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useQueryStates, parseAsString, parseAsArrayOf, parseAsInteger } from "nuqs";
import { useDebouncedCallback } from "use-debounce";
import { Search } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { FilterSidebar } from "./filter-sidebar";
import { EnrichmentBadge } from "./enrichment-badge";
import { BulkActionBar } from "./bulk-action-bar";
import { AddToListDropdown } from "./add-to-list-dropdown";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PersonResult {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  jobTitle: string | null;
  vertical: string | null;
  linkedinUrl: string | null;
  companyDomain: string | null;
  workspaces: Array<{ workspace: string; vertical: string | null }>;
}

interface SearchResponse {
  people: PersonResult[];
  total: number;
  page: number;
  pageSize: number;
  filterOptions: {
    verticals: string[];
    workspaces: string[];
  };
}

// ─── Skeleton rows ────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <TableRow key={i} className="border-border">
          <TableCell className="w-10">
            <div className="h-4 w-4 bg-muted rounded animate-pulse" />
          </TableCell>
          <TableCell>
            <div className="h-3.5 bg-muted rounded animate-pulse w-28" />
          </TableCell>
          <TableCell>
            <div className="h-3.5 bg-muted rounded animate-pulse w-40" />
          </TableCell>
          <TableCell>
            <div className="h-3.5 bg-muted rounded animate-pulse w-32" />
          </TableCell>
          <TableCell>
            <div className="h-3.5 bg-muted rounded animate-pulse w-28" />
          </TableCell>
          <TableCell>
            <div className="h-3.5 bg-muted rounded animate-pulse w-20" />
          </TableCell>
          <TableCell>
            <div className="h-3.5 bg-muted rounded animate-pulse w-16" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

// ─── Filter Chip ──────────────────────────────────────────────────────────────

function FilterChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-secondary border border-border text-xs text-foreground rounded-full">
      {label}
      <button
        onClick={onRemove}
        className="text-muted-foreground hover:text-foreground ml-0.5 leading-none"
        aria-label={`Remove ${label} filter`}
      >
        ×
      </button>
    </span>
  );
}

const ENRICHMENT_LABELS: Record<string, string> = {
  full: "Enriched",
  partial: "Partial",
  missing: "Missing",
};

// ─── Main Component ───────────────────────────────────────────────────────────

export function PeopleSearchPage() {
  // URL state via nuqs — all filters live in URL (bookmarkable)
  const [params, setParams] = useQueryStates({
    q: parseAsString.withDefault(""),
    vertical: parseAsArrayOf(parseAsString).withDefault([]),
    enrichment: parseAsString.withDefault(""),
    workspace: parseAsString.withDefault(""),
    company: parseAsString.withDefault(""),
    page: parseAsInteger.withDefault(1),
  });

  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Cache filter options from first successful response — they're relatively static
  const [filterOptions, setFilterOptions] = useState<{
    verticals: string[];
    workspaces: string[];
  }>({ verticals: [], workspaces: [] });

  // Track if we've loaded filter options at least once
  const filterOptionsLoaded = useRef(false);

  // ─── Selection state (ephemeral UI state, not in URL) ─────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);

  // Clear selection when filters/search change
  const filterKey = [
    params.q,
    params.vertical.join(","),
    params.enrichment,
    params.workspace,
    params.company,
  ].join("|");

  const prevFilterKey = useRef(filterKey);
  useEffect(() => {
    if (prevFilterKey.current !== filterKey) {
      setSelectedIds(new Set());
      setSelectAllMatching(false);
      prevFilterKey.current = filterKey;
    }
  }, [filterKey]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (params.q) sp.set("q", params.q);
      params.vertical.forEach((v) => sp.append("vertical", v));
      if (params.enrichment) sp.set("enrichment", params.enrichment);
      if (params.workspace) sp.set("workspace", params.workspace);
      if (params.company) sp.set("company", params.company);
      sp.set("page", String(params.page));

      const res = await fetch(`/api/people/search?${sp.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as SearchResponse;
      setData(json);

      // Cache filter options on first load (or if they're empty so far)
      if (!filterOptionsLoaded.current || filterOptions.verticals.length === 0) {
        setFilterOptions(json.filterOptions);
        filterOptionsLoaded.current = true;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [params, filterOptions.verticals.length]);

  useEffect(() => {
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.q, params.vertical, params.enrichment, params.workspace, params.company, params.page]);

  // Debounced search input — updates URL after 300ms idle
  const debouncedSetQ = useDebouncedCallback((value: string) => {
    void setParams({ q: value, page: 1 });
  }, 300);

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;
  const startRow = data ? (params.page - 1) * data.pageSize + 1 : 0;
  const endRow = data ? Math.min(params.page * data.pageSize, data.total) : 0;

  // ─── Selection helpers ────────────────────────────────────────────────────

  const currentPageIds = data?.people.map((p) => p.id) ?? [];
  const allCurrentPageSelected =
    currentPageIds.length > 0 &&
    currentPageIds.every((id) => selectedIds.has(id));
  const someCurrentPageSelected =
    currentPageIds.some((id) => selectedIds.has(id)) && !allCurrentPageSelected;

  const handleHeaderCheckbox = (checked: boolean) => {
    if (checked) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        currentPageIds.forEach((id) => next.add(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        currentPageIds.forEach((id) => next.delete(id));
        return next;
      });
      setSelectAllMatching(false);
    }
  };

  const handleRowCheckbox = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
        setSelectAllMatching(false);
      }
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
    setSelectAllMatching(false);
  };

  const handleAddComplete = () => {
    handleClearSelection();
  };

  // Current filter params for "select all matching" mode
  const currentFilterParams: Record<string, unknown> = {};
  if (params.q) currentFilterParams.q = params.q;
  if (params.vertical.length > 0) currentFilterParams.vertical = params.vertical;
  if (params.enrichment) currentFilterParams.enrichment = params.enrichment;
  if (params.workspace) currentFilterParams.workspace = params.workspace;
  if (params.company) currentFilterParams.company = params.company;

  // Active filter chips — shown above results
  const activeChips: Array<{ label: string; onRemove: () => void }> = [];
  params.vertical.forEach((v) => {
    activeChips.push({
      label: `Vertical: ${v}`,
      onRemove: () => {
        void setParams({
          vertical: params.vertical.filter((x) => x !== v),
          page: 1,
        });
      },
    });
  });
  if (params.enrichment) {
    activeChips.push({
      label: `Enrichment: ${ENRICHMENT_LABELS[params.enrichment] ?? params.enrichment}`,
      onRemove: () => void setParams({ enrichment: "", page: 1 }),
    });
  }
  if (params.workspace) {
    activeChips.push({
      label: `Workspace: ${params.workspace}`,
      onRemove: () => void setParams({ workspace: "", page: 1 }),
    });
  }
  if (params.company) {
    activeChips.push({
      label: `Company: ${params.company}`,
      onRemove: () => void setParams({ company: "", page: 1 }),
    });
  }

  const showBulkBar = selectedIds.size > 0 || selectAllMatching;

  return (
    <div>
      {/* Header */}
      <div className="border-b border-border px-6 py-5">
        <div>
          <h1 className="text-xl font-semibold text-foreground">People</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data
              ? `${data.total.toLocaleString()} people${loading ? " (refreshing…)" : ""}`
              : loading
              ? "Loading…"
              : "Search and filter your lead database"}
          </p>
        </div>
      </div>

      <div className="flex gap-6 p-6">
        {/* Left sidebar */}
        <FilterSidebar
          verticals={filterOptions.verticals}
          workspaces={filterOptions.workspaces}
          selectedVerticals={params.vertical}
          selectedEnrichment={params.enrichment}
          selectedWorkspace={params.workspace}
          companyFilter={params.company}
          onVerticalToggle={(v) => {
            const next = params.vertical.includes(v)
              ? params.vertical.filter((x) => x !== v)
              : [...params.vertical, v];
            void setParams({ vertical: next, page: 1 });
          }}
          onEnrichmentChange={(v) => void setParams({ enrichment: v, page: 1 })}
          onWorkspaceChange={(v) => void setParams({ workspace: v, page: 1 })}
          onCompanyChange={(v) => void setParams({ company: v, page: 1 })}
        />

        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search name, email, company, title…"
              defaultValue={params.q}
              onChange={(e) => debouncedSetQ(e.target.value)}
              className="w-full border border-border text-sm text-foreground placeholder-muted-foreground rounded-md pl-9 pr-4 py-2 focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>

          {/* Active filter chips */}
          {activeChips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {activeChips.map((chip) => (
                <FilterChip
                  key={chip.label}
                  label={chip.label}
                  onRemove={chip.onRemove}
                />
              ))}
              <button
                onClick={() =>
                  void setParams({
                    q: "",
                    vertical: [],
                    enrichment: "",
                    workspace: "",
                    company: "",
                    page: 1,
                  })
                }
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 px-1"
              >
                Clear all
              </button>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="bg-red-900/40 border border-red-700 rounded-lg p-4 flex items-center justify-between">
              <p className="text-red-300 text-sm">Failed to load people: {error}</p>
              <button
                onClick={() => void fetchData()}
                className="text-xs bg-red-700 hover:bg-red-600 text-white px-3 py-1.5 rounded"
              >
                Retry
              </button>
            </div>
          )}

          {/* Select all matching banner */}
          {allCurrentPageSelected && !selectAllMatching && data && data.total > (data.pageSize) && (
            <div className="bg-muted border border-border rounded-lg px-4 py-2.5 flex items-center justify-between text-sm">
              <span className="text-foreground">
                All {currentPageIds.length} people on this page are selected.
              </span>
              <button
                onClick={() => setSelectAllMatching(true)}
                className="text-brand-strong hover:text-foreground font-medium ml-3 whitespace-nowrap"
              >
                Select all {data.total.toLocaleString()} matching people
              </button>
            </div>
          )}

          {/* "All matching selected" confirmation banner */}
          {selectAllMatching && data && (
            <div className="bg-brand/10 border border-brand/30 rounded-lg px-4 py-2.5 flex items-center justify-between text-sm">
              <span className="text-brand-strong">
                All {data.total.toLocaleString()} matching people are selected.
              </span>
              <button
                onClick={handleClearSelection}
                className="text-muted-foreground hover:text-foreground underline underline-offset-2 ml-3"
              >
                Clear selection
              </button>
            </div>
          )}

          {/* Results table */}
          <div className="bg-card rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="w-10 py-3">
                    <Checkbox
                      checked={selectAllMatching || (allCurrentPageSelected && currentPageIds.length > 0)}
                      data-state={someCurrentPageSelected ? "indeterminate" : undefined}
                      onCheckedChange={(checked) => handleHeaderCheckbox(!!checked)}
                      aria-label="Select all on page"
                      className="border-border data-[state=checked]:bg-brand data-[state=checked]:border-brand data-[state=checked]:text-brand-foreground"
                    />
                  </TableHead>
                  <TableHead className="text-xs text-muted-foreground uppercase tracking-wide font-medium py-3">
                    Name
                  </TableHead>
                  <TableHead className="text-xs text-muted-foreground uppercase tracking-wide font-medium py-3">
                    Email
                  </TableHead>
                  <TableHead className="text-xs text-muted-foreground uppercase tracking-wide font-medium py-3">
                    Company
                  </TableHead>
                  <TableHead className="text-xs text-muted-foreground uppercase tracking-wide font-medium py-3">
                    Title
                  </TableHead>
                  <TableHead className="text-xs text-muted-foreground uppercase tracking-wide font-medium py-3">
                    Vertical
                  </TableHead>
                  <TableHead className="text-xs text-muted-foreground uppercase tracking-wide font-medium py-3">
                    Enrichment
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <SkeletonRows />
                ) : !data || data.people.length === 0 ? (
                  <TableRow className="border-border">
                    <TableCell
                      colSpan={7}
                      className="text-center py-12 text-muted-foreground text-sm"
                    >
                      No people found matching your search
                    </TableCell>
                  </TableRow>
                ) : (
                  data.people.map((person) => {
                    const isSelected = selectAllMatching || selectedIds.has(person.id);
                    return (
                      <TableRow
                        key={person.id}
                        className={`border-border hover:bg-muted/50 cursor-pointer ${isSelected ? "bg-muted/30" : ""}`}
                        onClick={() => handleRowCheckbox(person.id, !isSelected)}
                      >
                        <TableCell
                          className="py-2 w-10"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(checked) =>
                              handleRowCheckbox(person.id, !!checked)
                            }
                            aria-label={`Select ${person.email}`}
                            className="border-border data-[state=checked]:bg-brand data-[state=checked]:border-brand data-[state=checked]:text-brand-foreground"
                          />
                        </TableCell>
                        <TableCell className="py-2 font-medium text-sm text-foreground">
                          {[person.firstName, person.lastName]
                            .filter(Boolean)
                            .join(" ") || (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2 text-sm text-muted-foreground">
                          {person.email}
                        </TableCell>
                        <TableCell className="py-2 text-sm text-muted-foreground">
                          {person.company ?? (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2 text-sm text-muted-foreground">
                          {person.jobTitle ?? (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2 text-sm text-muted-foreground">
                          {person.vertical ?? (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2">
                          <EnrichmentBadge person={person} />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {!loading && data && data.total > 0 && (
            <div className="flex items-center justify-between text-sm">
              <p className="text-muted-foreground text-xs">
                Showing {startRow.toLocaleString()}–{endRow.toLocaleString()} of{" "}
                {data.total.toLocaleString()} results
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void setParams({ page: params.page - 1 })}
                  disabled={params.page <= 1}
                  className="px-3 py-1.5 text-xs rounded border border-border bg-secondary text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="text-xs text-muted-foreground">
                  Page {params.page} of {totalPages}
                </span>
                <button
                  onClick={() => void setParams({ page: params.page + 1 })}
                  disabled={params.page >= totalPages}
                  className="px-3 py-1.5 text-xs rounded border border-border bg-secondary text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bulk action bar — renders outside the scrollable content, fixed to bottom */}
      {showBulkBar && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          selectAllMatching={selectAllMatching}
          totalMatching={data?.total ?? 0}
          onClearSelection={handleClearSelection}
        >
          <AddToListDropdown
            selectedPersonIds={[...selectedIds]}
            selectAllFilters={selectAllMatching ? currentFilterParams : null}
            workspaces={filterOptions.workspaces}
            onComplete={handleAddComplete}
          />
        </BulkActionBar>
      )}
    </div>
  );
}
