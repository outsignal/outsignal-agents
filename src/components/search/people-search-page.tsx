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
import { FilterSidebar } from "./filter-sidebar";
import { EnrichmentBadge } from "./enrichment-badge";

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
        <TableRow key={i} className="border-gray-800">
          <TableCell>
            <div className="h-3.5 bg-gray-700 rounded animate-pulse w-28" />
          </TableCell>
          <TableCell>
            <div className="h-3.5 bg-gray-700 rounded animate-pulse w-40" />
          </TableCell>
          <TableCell>
            <div className="h-3.5 bg-gray-700 rounded animate-pulse w-32" />
          </TableCell>
          <TableCell>
            <div className="h-3.5 bg-gray-700 rounded animate-pulse w-28" />
          </TableCell>
          <TableCell>
            <div className="h-3.5 bg-gray-700 rounded animate-pulse w-20" />
          </TableCell>
          <TableCell>
            <div className="h-3.5 bg-gray-700 rounded animate-pulse w-16" />
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
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-800 border border-gray-700 text-xs text-gray-300 rounded-full">
      {label}
      <button
        onClick={onRemove}
        className="text-gray-500 hover:text-white ml-0.5 leading-none"
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

  return (
    <div className="bg-gray-950 min-h-screen text-white">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-5">
        <div>
          <h1 className="text-xl font-semibold">People</h1>
          <p className="text-sm text-gray-400 mt-0.5">
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
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
            <input
              type="text"
              placeholder="Search name, email, company, title…"
              defaultValue={params.q}
              onChange={(e) => debouncedSetQ(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 text-sm text-white placeholder-gray-500 rounded-md pl-9 pr-4 py-2 focus:outline-none focus:ring-1 focus:ring-[#F0FF7A]"
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
                className="text-xs text-gray-500 hover:text-gray-300 underline underline-offset-2 px-1"
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

          {/* Results table */}
          <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-800 hover:bg-transparent">
                  <TableHead className="text-xs text-gray-400 uppercase tracking-wide font-medium py-3">
                    Name
                  </TableHead>
                  <TableHead className="text-xs text-gray-400 uppercase tracking-wide font-medium py-3">
                    Email
                  </TableHead>
                  <TableHead className="text-xs text-gray-400 uppercase tracking-wide font-medium py-3">
                    Company
                  </TableHead>
                  <TableHead className="text-xs text-gray-400 uppercase tracking-wide font-medium py-3">
                    Title
                  </TableHead>
                  <TableHead className="text-xs text-gray-400 uppercase tracking-wide font-medium py-3">
                    Vertical
                  </TableHead>
                  <TableHead className="text-xs text-gray-400 uppercase tracking-wide font-medium py-3">
                    Enrichment
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <SkeletonRows />
                ) : !data || data.people.length === 0 ? (
                  <TableRow className="border-gray-800">
                    <TableCell
                      colSpan={6}
                      className="text-center py-12 text-gray-500 text-sm"
                    >
                      No people found matching your search
                    </TableCell>
                  </TableRow>
                ) : (
                  data.people.map((person) => (
                    <TableRow
                      key={person.id}
                      className="border-gray-800 hover:bg-gray-800/50"
                    >
                      <TableCell className="py-2 font-medium text-sm text-white">
                        {[person.firstName, person.lastName]
                          .filter(Boolean)
                          .join(" ") || (
                          <span className="text-gray-600">—</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2 text-sm text-gray-300">
                        {person.email}
                      </TableCell>
                      <TableCell className="py-2 text-sm text-gray-300">
                        {person.company ?? (
                          <span className="text-gray-600">—</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2 text-sm text-gray-400">
                        {person.jobTitle ?? (
                          <span className="text-gray-600">—</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2 text-sm text-gray-400">
                        {person.vertical ?? (
                          <span className="text-gray-600">—</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2">
                        <EnrichmentBadge person={person} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {!loading && data && data.total > 0 && (
            <div className="flex items-center justify-between text-sm">
              <p className="text-gray-400 text-xs">
                Showing {startRow.toLocaleString()}–{endRow.toLocaleString()} of{" "}
                {data.total.toLocaleString()} results
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void setParams({ page: params.page - 1 })}
                  disabled={params.page <= 1}
                  className="px-3 py-1.5 text-xs rounded border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="text-xs text-gray-500">
                  Page {params.page} of {totalPages}
                </span>
                <button
                  onClick={() => void setParams({ page: params.page + 1 })}
                  disabled={params.page >= totalPages}
                  className="px-3 py-1.5 text-xs rounded border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
