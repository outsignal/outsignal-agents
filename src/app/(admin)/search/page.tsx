"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useDebouncedCallback } from "use-debounce";
import { Search, Users, Building2, ArrowRight } from "lucide-react";
import Link from "next/link";
import { PageShell } from "@/components/layout/page-shell";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PersonResult {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  companyDomain: string | null;
  workspaces: Array<{ name: string; slug: string }>;
}

interface CompanyResult {
  id: string;
  name: string;
  domain: string;
  industry: string | null;
  headcount: number | null;
}

interface SearchResponse {
  people: PersonResult[];
  companies: CompanyResult[];
  totalPeople: number;
  totalCompanies: number;
}

type SearchType = "all" | "people" | "companies";

// ---------------------------------------------------------------------------
// Skeleton loaders
// ---------------------------------------------------------------------------

function ResultSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 p-4 rounded-lg border border-border"
        >
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Person result card
// ---------------------------------------------------------------------------

function PersonCard({ person }: { person: PersonResult }) {
  const name = [person.firstName, person.lastName].filter(Boolean).join(" ");
  const displayName = name || person.email;

  return (
    <Link
      href={`/people/${person.id}`}
      className="group flex items-center gap-4 p-4 rounded-lg border border-border hover:border-[#635BFF]/40 hover:bg-[#635BFF]/5 transition-colors"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#635BFF]/10 text-[#635BFF]">
        <Users className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-foreground truncate">
          {displayName}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {name ? person.email : null}
          {person.companyDomain && (
            <span>
              {name ? " \u00B7 " : ""}
              {person.companyDomain}
            </span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {person.workspaces.slice(0, 3).map((ws) => (
          <Badge key={ws.slug} variant="secondary" size="xs">
            {ws.name}
          </Badge>
        ))}
        {person.workspaces.length > 3 && (
          <Badge variant="outline" size="xs">
            +{person.workspaces.length - 3}
          </Badge>
        )}
        <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Company result card
// ---------------------------------------------------------------------------

function CompanyCard({ company }: { company: CompanyResult }) {
  return (
    <Link
      href={`/companies/${company.id}`}
      className="group flex items-center gap-4 p-4 rounded-lg border border-border hover:border-[#635BFF]/40 hover:bg-[#635BFF]/5 transition-colors"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
        <Building2 className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-foreground truncate">
          {company.name}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {company.domain}
          {company.industry && <span> &middot; {company.industry}</span>}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {company.headcount != null && (
          <Badge variant="outline" size="xs">
            {company.headcount.toLocaleString()} employees
          </Badge>
        )}
        <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Type toggle
// ---------------------------------------------------------------------------

const TYPE_OPTIONS: { value: SearchType; label: string }[] = [
  { value: "all", label: "All" },
  { value: "people", label: "People" },
  { value: "companies", label: "Companies" },
];

function TypeToggle({
  value,
  onChange,
}: {
  value: SearchType;
  onChange: (v: SearchType) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-lg bg-muted p-1 gap-0.5">
      {TYPE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            value === opt.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<SearchType>("all");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-focus search input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const fetchResults = useCallback(
    async (q: string, t: SearchType) => {
      // Cancel previous request
      abortRef.current?.abort();

      if (q.trim().length < 2) {
        setResults(null);
        setLoading(false);
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);

      try {
        const params = new URLSearchParams({ q: q.trim(), type: t });
        const res = await fetch(`/api/search?${params}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Search failed");
        const data: SearchResponse = await res.json();
        setResults(data);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error("Search error:", err);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    []
  );

  const debouncedSearch = useDebouncedCallback(
    (q: string) => fetchResults(q, type),
    300
  );

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    debouncedSearch(val);
  };

  const handleTypeChange = (newType: SearchType) => {
    setType(newType);
    fetchResults(query, newType);
  };

  const hasQuery = query.trim().length >= 2;
  const hasResults =
    results && (results.people.length > 0 || results.companies.length > 0);
  const noResults = hasQuery && !loading && results && !hasResults;

  return (
    <PageShell title="Search">
      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleQueryChange}
          placeholder="Search people and companies..."
          className="w-full h-12 pl-12 pr-4 rounded-lg border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#635BFF]/40 focus:border-[#635BFF] transition-colors"
        />
      </div>

      {/* Type toggle */}
      <div className="flex items-center justify-between">
        <TypeToggle value={type} onChange={handleTypeChange} />
        {results && hasQuery && (
          <p className="text-xs text-muted-foreground">
            {results.totalPeople + results.totalCompanies} results
          </p>
        )}
      </div>

      {/* States */}
      {!hasQuery && !loading && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
            <Search className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">
            Start typing to search across people and companies...
          </p>
        </div>
      )}

      {loading && <ResultSkeleton />}

      {noResults && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-sm text-muted-foreground">
            No results found for &ldquo;{query.trim()}&rdquo;
          </p>
        </div>
      )}

      {/* Results */}
      {!loading && hasResults && (
        <div className="space-y-8">
          {/* People section */}
          {results.people.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Users className="h-4 w-4 text-[#635BFF]" />
                <h2 className="text-sm font-semibold text-foreground">
                  People
                </h2>
                <Badge variant="secondary" size="xs">
                  {results.totalPeople}
                </Badge>
              </div>
              <div className="space-y-2">
                {results.people.map((person) => (
                  <PersonCard key={person.id} person={person} />
                ))}
                {results.totalPeople > results.people.length && (
                  <p className="text-xs text-muted-foreground text-center pt-2">
                    Showing {results.people.length} of {results.totalPeople}{" "}
                    people
                  </p>
                )}
              </div>
            </section>
          )}

          {/* Companies section */}
          {results.companies.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Building2 className="h-4 w-4 text-emerald-600" />
                <h2 className="text-sm font-semibold text-foreground">
                  Companies
                </h2>
                <Badge variant="secondary" size="xs">
                  {results.totalCompanies}
                </Badge>
              </div>
              <div className="space-y-2">
                {results.companies.map((company) => (
                  <CompanyCard key={company.id} company={company} />
                ))}
                {results.totalCompanies > results.companies.length && (
                  <p className="text-xs text-muted-foreground text-center pt-2">
                    Showing {results.companies.length} of{" "}
                    {results.totalCompanies} companies
                  </p>
                )}
              </div>
            </section>
          )}
        </div>
      )}
    </PageShell>
  );
}
