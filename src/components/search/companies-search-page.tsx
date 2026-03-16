"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryStates, parseAsString, parseAsInteger, parseAsArrayOf } from "nuqs";
import { useDebounce } from "use-debounce";
import { Search, Building2 } from "lucide-react";
import {
  getCompanyEnrichmentStatus,
  ENRICHMENT_COLORS,
  ENRICHMENT_LABELS,
  type EnrichmentStatus,
} from "@/lib/enrichment/status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  SortableTableHead,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Company {
  id: string;
  name: string;
  domain: string;
  industry: string | null;
  headcount: number | null;
  location: string | null;
  description: string | null;
  website: string | null;
  yearFounded: number | null;
  enrichmentStatus: EnrichmentStatus;
}

interface SearchResponse {
  companies: Company[];
  total: number;
  page: number;
  pageSize: number;
  filterOptions: {
    industries: string[];
  };
}

// ---------------------------------------------------------------------------
// CompanyEnrichmentBadge
// ---------------------------------------------------------------------------

function CompanyEnrichmentBadge({ company }: {
  company: Pick<Company, "industry" | "headcount" | "description">;
}) {
  const status = getCompanyEnrichmentStatus(company);
  const color = ENRICHMENT_COLORS[status];
  const label = ENRICHMENT_LABELS[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: color }}
      />
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Enrichment filter options
// ---------------------------------------------------------------------------

const ENRICHMENT_OPTIONS = [
  { value: "full", label: "Enriched" },
  { value: "partial", label: "Partial" },
  { value: "missing", label: "Missing" },
] as const;

// ---------------------------------------------------------------------------
// Skeleton rows
// ---------------------------------------------------------------------------

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <TableRow key={i} className="border-border">
          <TableCell><Skeleton className="h-4 w-32" /></TableCell>
          <TableCell><Skeleton className="h-4 w-28" /></TableCell>
          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
          <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
          <TableCell><Skeleton className="h-4 w-20" /></TableCell>
          <TableCell><Skeleton className="h-4 w-10 ml-auto" /></TableCell>
          <TableCell><Skeleton className="h-4 w-16" /></TableCell>
        </TableRow>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// CompaniesSearchPage
// ---------------------------------------------------------------------------

export function CompaniesSearchPage() {
  const router = useRouter();
  const [params, setParams] = useQueryStates({
    q: parseAsString.withDefault(""),
    vertical: parseAsArrayOf(parseAsString).withDefault([]),
    enrichment: parseAsString.withDefault(""),
    page: parseAsInteger.withDefault(1),
  });

  const [debouncedQ] = useDebounce(params.q, 300);

  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // All industries returned from the API (persisted across filter changes)
  const [allIndustries, setAllIndustries] = useState<string[]>([]);

  // Sidebar collapsed state
  const [filtersExpanded, setFiltersExpanded] = useState(true);

  // Sort state
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);

  const handleSort = useCallback((key: string) => {
    setSort((prev) => {
      if (prev?.key === key) {
        if (prev.direction === "asc") return { key, direction: "desc" };
        return null;
      }
      return { key, direction: "asc" };
    });
  }, []);

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/companies/search", window.location.origin);
      if (debouncedQ) url.searchParams.set("q", debouncedQ);
      params.vertical.forEach((v) => url.searchParams.append("vertical", v));
      if (params.enrichment) url.searchParams.set("enrichment", params.enrichment);
      url.searchParams.set("page", String(params.page));

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Failed to fetch companies");
      const json: SearchResponse = await res.json();
      setData(json);
      // Populate industries filter from first load (or any load without vertical filter)
      if (json.filterOptions.industries.length > 0) {
        setAllIndustries((prev) =>
          prev.length > 0 ? prev : json.filterOptions.industries
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, params.vertical, params.enrichment, params.page]);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  // Reset to page 1 when filters/search changes
  const handleSearchChange = (value: string) => {
    setParams({ q: value, page: 1 });
  };

  const handleVerticalToggle = (industry: string) => {
    const next = params.vertical.includes(industry)
      ? params.vertical.filter((v) => v !== industry)
      : [...params.vertical, industry];
    setParams({ vertical: next, page: 1 });
  };

  const handleEnrichmentChange = (value: string) => {
    setParams({ enrichment: params.enrichment === value ? "" : value, page: 1 });
  };

  const handleClearAllFilters = () => {
    setParams({ q: "", vertical: [], enrichment: "", page: 1 });
  };

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;
  const startRow = data ? (params.page - 1) * data.pageSize + 1 : 0;
  const endRow = data ? Math.min(params.page * data.pageSize, data.total) : 0;

  const activeFilterCount =
    params.vertical.length + (params.enrichment ? 1 : 0);

  // Client-side sort
  const sortedCompanies = (() => {
    if (!data || !sort) return data?.companies ?? [];
    return [...data.companies].sort((a, b) => {
      let aVal: string | number | null = null;
      let bVal: string | number | null = null;

      if (sort.key === "name") { aVal = a.name; bVal = b.name; }
      else if (sort.key === "domain") { aVal = a.domain; bVal = b.domain; }
      else if (sort.key === "industry") { aVal = a.industry; bVal = b.industry; }
      else if (sort.key === "headcount") { aVal = a.headcount; bVal = b.headcount; }

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      let cmp = 0;
      if (typeof aVal === "number" && typeof bVal === "number") {
        cmp = aVal - bVal;
      } else {
        cmp = String(aVal).localeCompare(String(bVal));
      }
      return sort.direction === "asc" ? cmp : -cmp;
    });
  })();

  // Quick pills for collapsed filter bar
  const quickPills: Array<{ label: string; active: boolean; onToggle: () => void }> = [];
  ENRICHMENT_OPTIONS.forEach((opt) => {
    quickPills.push({
      label: opt.label,
      active: params.enrichment === opt.value,
      onToggle: () => handleEnrichmentChange(opt.value),
    });
  });
  allIndustries.slice(0, 6).forEach((ind) => {
    quickPills.push({
      label: ind,
      active: params.vertical.includes(ind),
      onToggle: () => handleVerticalToggle(ind),
    });
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-4 py-4 sm:px-6 sm:py-5">
        <h1 className="text-xl font-semibold text-foreground">Companies</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {data
            ? `${data.total.toLocaleString()} companies${loading ? " (refreshing...)" : ""}`
            : loading
            ? "Loading..."
            : "Search and filter your company database"}
        </p>
      </div>

      <div className="p-4 sm:p-6 space-y-4">
        {/* Filter toggle + collapsed pill bar / expanded sidebar wrapper */}
        <div className="flex flex-col md:flex-row gap-4 md:gap-6">
          {/* Filter area */}
          <div className="flex-shrink-0">
            {/* Toggle button */}
            <button
              onClick={() => setFiltersExpanded(!filtersExpanded)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-border rounded-md bg-secondary text-foreground hover:bg-muted transition-colors mb-3"
            >
              {filtersExpanded ? (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
              )}
              {filtersExpanded ? "Hide filters" : "Filters"}
              {activeFilterCount > 0 && (
                <span className="ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 rounded-full bg-brand text-white text-[10px] font-bold px-1">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {/* Expanded sidebar */}
            {filtersExpanded && (
              <aside className="w-[280px] space-y-5 animate-fade-in">
                {/* Clear all */}
                {activeFilterCount > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {activeFilterCount} active filter{activeFilterCount !== 1 ? "s" : ""}
                    </span>
                    <button
                      onClick={handleClearAllFilters}
                      className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                    >
                      Clear all
                    </button>
                  </div>
                )}

                {/* Enrichment status filter */}
                <div>
                  <h3 className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-3">
                    Enrichment
                  </h3>
                  <div className="space-y-1">
                    {(["full", "partial", "missing"] as const).map((status) => (
                      <button
                        key={status}
                        onClick={() => handleEnrichmentChange(status)}
                        className={`flex items-center gap-2 w-full text-left rounded px-2 py-1.5 text-sm transition-colors ${
                          params.enrichment === status
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        }`}
                      >
                        <span
                          className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: ENRICHMENT_COLORS[status] }}
                        />
                        {ENRICHMENT_LABELS[status]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border" />

                {/* Vertical / Industry filter */}
                {allIndustries.length > 0 && (
                  <div>
                    <h3 className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-3">
                      Vertical
                    </h3>
                    <div className="space-y-1 max-h-80 overflow-y-auto">
                      {allIndustries.slice(0, 50).map((industry) => (
                        <button
                          key={industry}
                          onClick={() => handleVerticalToggle(industry)}
                          className={`flex items-center gap-2 w-full text-left rounded px-2 py-1.5 text-sm transition-colors ${
                            params.vertical.includes(industry)
                              ? "bg-muted text-foreground"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted"
                          }`}
                        >
                          <span
                            className={`inline-block w-3 h-3 rounded border flex-shrink-0 transition-colors ${
                              params.vertical.includes(industry)
                                ? "bg-brand border-brand"
                                : "border-border"
                            }`}
                          />
                          <span className="truncate">{industry}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </aside>
            )}

            {/* Collapsed: horizontal pill bar */}
            {!filtersExpanded && (
              <div className="flex flex-wrap gap-1.5 animate-fade-in">
                {quickPills.map((pill) => (
                  <button
                    key={pill.label}
                    onClick={pill.onToggle}
                    className={`inline-flex items-center px-2.5 py-1 text-xs rounded-full border transition-colors ${
                      pill.active
                        ? "bg-brand/10 border-brand/30 text-brand-strong font-medium"
                        : "bg-secondary border-border text-muted-foreground hover:text-foreground hover:border-stone-300"
                    }`}
                  >
                    {pill.label}
                  </button>
                ))}
                {activeFilterCount > 0 && (
                  <button
                    onClick={handleClearAllFilters}
                    className="inline-flex items-center px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                  >
                    Clear all
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0 space-y-4">
            {/* Search bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
              <input
                type="text"
                placeholder="Search by name, domain, or industry..."
                value={params.q}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="w-full border border-border text-sm text-foreground placeholder-muted-foreground rounded-md pl-9 pr-4 py-2 focus:outline-none focus:ring-1 focus:ring-brand"
              />
            </div>

            {/* Active filter chips */}
            {(params.vertical.length > 0 || params.enrichment) && (
              <div className="flex flex-wrap gap-1.5">
                {params.enrichment && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-secondary border border-border px-2.5 py-0.5 text-xs text-foreground">
                    Enrichment: {ENRICHMENT_LABELS[params.enrichment as EnrichmentStatus]}
                    <button
                      onClick={() => setParams({ enrichment: "", page: 1 })}
                      className="ml-0.5 text-muted-foreground hover:text-foreground"
                    >
                      ×
                    </button>
                  </span>
                )}
                {params.vertical.map((v) => (
                  <span
                    key={v}
                    className="inline-flex items-center gap-1 rounded-full bg-secondary border border-border px-2.5 py-0.5 text-xs text-foreground"
                  >
                    {v}
                    <button
                      onClick={() => handleVerticalToggle(v)}
                      className="ml-0.5 text-muted-foreground hover:text-foreground"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <button
                  onClick={handleClearAllFilters}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 px-1"
                >
                  Clear all
                </button>
              </div>
            )}

            {error && <ErrorBanner message={error} />}

            {/* Table */}
            <div className="bg-card rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <SortableTableHead sortKey="name" currentSort={sort} onSort={handleSort}>
                      Name
                    </SortableTableHead>
                    <SortableTableHead sortKey="domain" currentSort={sort} onSort={handleSort}>
                      Domain
                    </SortableTableHead>
                    <SortableTableHead sortKey="industry" currentSort={sort} onSort={handleSort}>
                      Industry
                    </SortableTableHead>
                    <SortableTableHead sortKey="headcount" currentSort={sort} onSort={handleSort} className="text-right">
                      Headcount
                    </SortableTableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">Founded</TableHead>
                    <TableHead>Enrichment</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <SkeletonRows />
                  ) : !data || data.companies.length === 0 ? (
                    <TableRow className="border-border hover:bg-transparent">
                      <TableCell
                        colSpan={7}
                        className="text-center py-16"
                      >
                        <div className="flex flex-col items-center gap-2 animate-fade-in">
                          <div className="h-14 w-14 rounded-full bg-stone-100 flex items-center justify-center mb-1">
                            <Building2 className="h-6 w-6 text-stone-400" aria-hidden="true" />
                          </div>
                          <p className="text-lg font-semibold text-foreground">
                            No companies found
                          </p>
                          <p className="text-sm text-muted-foreground max-w-sm">
                            {params.q || params.vertical.length > 0 || params.enrichment
                              ? "Try adjusting your search or filters to find what you're looking for."
                              : "Companies will appear here once they're imported or enriched."}
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedCompanies.map((company) => (
                      <TableRow
                        key={company.id}
                        className="border-border cursor-pointer"
                        onClick={() => router.push(`/companies/${company.id}`)}
                      >
                        <TableCell className="font-medium text-foreground text-sm">
                          <Link
                            href={`/companies/${company.id}`}
                            className="hover:underline underline-offset-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {company.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm font-mono">
                          {company.website ? (
                            <a
                              href={company.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-foreground transition-colors"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {company.domain}
                            </a>
                          ) : (
                            company.domain
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {company.industry ?? <span className="text-muted-foreground">--</span>}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm text-right">
                          {company.headcount != null
                            ? company.headcount.toLocaleString()
                            : <span className="text-muted-foreground">--</span>}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {company.location ?? <span className="text-muted-foreground">--</span>}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm text-right">
                          {company.yearFounded ?? <span className="text-muted-foreground">--</span>}
                        </TableCell>
                        <TableCell>
                          <CompanyEnrichmentBadge company={company} />
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
                <p className="text-muted-foreground text-xs">
                  Showing {startRow.toLocaleString()}--{endRow.toLocaleString()} of{" "}
                  {data.total.toLocaleString()} companies
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setParams({ page: params.page - 1 })}
                    disabled={params.page <= 1}
                    className="px-3 py-1.5 text-xs rounded border border-border bg-secondary text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Previous
                  </button>
                  <span className="text-xs text-muted-foreground">
                    Page {params.page} of {totalPages}
                  </span>
                  <button
                    onClick={() => setParams({ page: params.page + 1 })}
                    disabled={params.page >= totalPages}
                    className="px-3 py-1.5 text-xs rounded border border-border bg-secondary text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
