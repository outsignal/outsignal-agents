"use client";

import { useEffect, useState, useCallback } from "react";
import { useQueryStates, parseAsString, parseAsInteger, parseAsArrayOf } from "nuqs";
import { useDebounce } from "use-debounce";
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
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

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
      <span className="text-xs text-gray-400">{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// CompaniesSearchPage
// ---------------------------------------------------------------------------

export function CompaniesSearchPage() {
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

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;

  return (
    <div className="flex flex-col h-full bg-gray-950 min-h-screen">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-white">Companies</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {data
                ? `${data.total.toLocaleString()} companies`
                : "Loading..."}
            </p>
          </div>
        </div>
        {/* Search bar */}
        <div className="mt-4">
          <input
            type="text"
            placeholder="Search by name, domain, or industry..."
            value={params.q}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full max-w-lg rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
          />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar filters */}
        <aside className="w-56 border-r border-gray-800 bg-gray-900 overflow-y-auto flex-shrink-0 p-4 space-y-6">
          {/* Enrichment status filter */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Enrichment
            </h3>
            <div className="space-y-1.5">
              {(["full", "partial", "missing"] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => handleEnrichmentChange(status)}
                  className={`flex items-center gap-2 w-full text-left rounded px-2 py-1.5 text-sm transition-colors ${
                    params.enrichment === status
                      ? "bg-gray-700 text-white"
                      : "text-gray-400 hover:text-white hover:bg-gray-800"
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

          {/* Vertical / Industry filter */}
          {allIndustries.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Vertical
              </h3>
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {allIndustries.slice(0, 50).map((industry) => (
                  <button
                    key={industry}
                    onClick={() => handleVerticalToggle(industry)}
                    className={`flex items-center gap-2 w-full text-left rounded px-2 py-1.5 text-sm transition-colors ${
                      params.vertical.includes(industry)
                        ? "bg-gray-700 text-white"
                        : "text-gray-400 hover:text-white hover:bg-gray-800"
                    }`}
                  >
                    <span
                      className={`inline-block w-3 h-3 rounded border flex-shrink-0 transition-colors ${
                        params.vertical.includes(industry)
                          ? "bg-brand border-brand"
                          : "border-gray-600"
                      }`}
                    />
                    <span className="truncate">{industry}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Active filter chips */}
          {(params.vertical.length > 0 || params.enrichment || params.q) && (
            <div>
              <button
                onClick={() => setParams({ q: "", vertical: [], enrichment: "", page: 1 })}
                className="text-xs text-gray-500 hover:text-red-400 transition-colors"
              >
                Clear all filters
              </button>
            </div>
          )}
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto">
          {/* Active filter chips */}
          {(params.vertical.length > 0 || params.enrichment) && (
            <div className="flex flex-wrap gap-2 px-6 pt-4">
              {params.enrichment && (
                <span className="inline-flex items-center gap-1 rounded-full bg-gray-800 border border-gray-700 px-2.5 py-1 text-xs text-gray-300">
                  Enrichment: {ENRICHMENT_LABELS[params.enrichment as EnrichmentStatus]}
                  <button
                    onClick={() => setParams({ enrichment: "", page: 1 })}
                    className="ml-1 text-gray-500 hover:text-white"
                  >
                    x
                  </button>
                </span>
              )}
              {params.vertical.map((v) => (
                <span
                  key={v}
                  className="inline-flex items-center gap-1 rounded-full bg-gray-800 border border-gray-700 px-2.5 py-1 text-xs text-gray-300"
                >
                  {v}
                  <button
                    onClick={() => handleVerticalToggle(v)}
                    className="ml-1 text-gray-500 hover:text-white"
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="px-6 py-4">
            {error && (
              <div className="rounded-md bg-red-900/20 border border-red-800 p-4 text-sm text-red-400 mb-4">
                {error}
              </div>
            )}

            {/* Table */}
            <div className="rounded-md border border-gray-800 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800 hover:bg-transparent">
                    <TableHead className="text-gray-400 bg-gray-900">Name</TableHead>
                    <TableHead className="text-gray-400 bg-gray-900">Domain</TableHead>
                    <TableHead className="text-gray-400 bg-gray-900">Industry</TableHead>
                    <TableHead className="text-gray-400 bg-gray-900 text-right">Headcount</TableHead>
                    <TableHead className="text-gray-400 bg-gray-900">Location</TableHead>
                    <TableHead className="text-gray-400 bg-gray-900 text-right">Founded</TableHead>
                    <TableHead className="text-gray-400 bg-gray-900">Enrichment</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading
                    ? Array.from({ length: 10 }).map((_, i) => (
                        <TableRow key={i} className="border-gray-800">
                          <TableCell><Skeleton className="h-4 w-32 bg-gray-800" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-28 bg-gray-800" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-24 bg-gray-800" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-12 bg-gray-800 ml-auto" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-20 bg-gray-800" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-10 bg-gray-800 ml-auto" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-16 bg-gray-800" /></TableCell>
                        </TableRow>
                      ))
                    : data?.companies.map((company) => (
                        <TableRow
                          key={company.id}
                          className="border-gray-800 hover:bg-gray-900/50"
                        >
                          <TableCell className="font-medium text-white text-sm">
                            {company.name}
                          </TableCell>
                          <TableCell className="text-gray-400 text-sm">
                            {company.website ? (
                              <a
                                href={company.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-white transition-colors"
                              >
                                {company.domain}
                              </a>
                            ) : (
                              company.domain
                            )}
                          </TableCell>
                          <TableCell className="text-gray-400 text-sm">
                            {company.industry ?? <span className="text-gray-600">—</span>}
                          </TableCell>
                          <TableCell className="text-gray-400 text-sm text-right">
                            {company.headcount != null
                              ? company.headcount.toLocaleString()
                              : <span className="text-gray-600">—</span>}
                          </TableCell>
                          <TableCell className="text-gray-400 text-sm">
                            {company.location ?? <span className="text-gray-600">—</span>}
                          </TableCell>
                          <TableCell className="text-gray-400 text-sm text-right">
                            {company.yearFounded ?? <span className="text-gray-600">—</span>}
                          </TableCell>
                          <TableCell>
                            <CompanyEnrichmentBadge company={company} />
                          </TableCell>
                        </TableRow>
                      ))}

                  {!loading && data?.companies.length === 0 && (
                    <TableRow className="border-gray-800">
                      <TableCell
                        colSpan={7}
                        className="text-center py-12 text-gray-500 text-sm"
                      >
                        No companies found. Try adjusting your search or filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {!loading && totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-gray-500">
                  Page {data?.page} of {totalPages} &mdash;{" "}
                  {data?.total.toLocaleString()} companies
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setParams({ page: params.page - 1 })}
                    disabled={params.page <= 1}
                    className="inline-flex h-8 items-center justify-center rounded-md border border-gray-700 bg-gray-900 px-3 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setParams({ page: params.page + 1 })}
                    disabled={params.page >= totalPages}
                    className="inline-flex h-8 items-center justify-center rounded-md border border-gray-700 bg-gray-900 px-3 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
