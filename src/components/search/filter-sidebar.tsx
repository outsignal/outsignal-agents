"use client";

import { useDebouncedCallback } from "use-debounce";
import { useState } from "react";
import { SlidersHorizontal, X, ChevronLeft, ChevronRight } from "lucide-react";

interface FilterSidebarProps {
  verticals: string[];
  workspaces: string[];
  selectedVerticals: string[];
  selectedEnrichment: string;
  selectedWorkspace: string;
  companyFilter: string;
  onVerticalToggle: (vertical: string) => void;
  onEnrichmentChange: (value: string) => void;
  onWorkspaceChange: (value: string) => void;
  onCompanyChange: (value: string) => void;
  onClearAll?: () => void;
}

const ENRICHMENT_OPTIONS = [
  { value: "", label: "All" },
  { value: "full", label: "Enriched" },
  { value: "partial", label: "Partial" },
  { value: "missing", label: "Missing" },
];

const ENRICHMENT_COLORS: Record<string, string> = {
  full: "oklch(0.696 0.17 162.48)",    // emerald-500
  partial: "oklch(0.95 0.15 110)",     // brand
  missing: "oklch(0.577 0.245 27.325)", // destructive
};

export function FilterSidebar({
  verticals,
  workspaces,
  selectedVerticals,
  selectedEnrichment,
  selectedWorkspace,
  companyFilter,
  onVerticalToggle,
  onEnrichmentChange,
  onWorkspaceChange,
  onCompanyChange,
  onClearAll,
}: FilterSidebarProps) {
  const [companyInput, setCompanyInput] = useState(companyFilter);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const debouncedCompanyChange = useDebouncedCallback((value: string) => {
    onCompanyChange(value);
  }, 300);

  const activeFilterCount =
    selectedVerticals.length +
    (selectedEnrichment ? 1 : 0) +
    (selectedWorkspace ? 1 : 0) +
    (companyFilter ? 1 : 0);

  // Quick-select pills for collapsed mode
  const quickPills: Array<{ label: string; active: boolean; onToggle: () => void }> = [];

  // Add enrichment pills
  (["full", "partial", "missing"] as const).forEach((status) => {
    const labels: Record<string, string> = { full: "Enriched", partial: "Partial", missing: "Missing" };
    quickPills.push({
      label: labels[status],
      active: selectedEnrichment === status,
      onToggle: () => onEnrichmentChange(selectedEnrichment === status ? "" : status),
    });
  });

  // Add top workspace pills
  workspaces.slice(0, 4).forEach((ws) => {
    quickPills.push({
      label: ws,
      active: selectedWorkspace === ws,
      onToggle: () => onWorkspaceChange(selectedWorkspace === ws ? "" : ws),
    });
  });

  // Add top vertical pills
  verticals.slice(0, 4).forEach((v) => {
    quickPills.push({
      label: v,
      active: selectedVerticals.includes(v),
      onToggle: () => onVerticalToggle(v),
    });
  });

  const filterContent = (
    <>
      {/* Clear all link */}
      {activeFilterCount > 0 && onClearAll && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {activeFilterCount} active filter{activeFilterCount !== 1 ? "s" : ""}
          </span>
          <button
            onClick={onClearAll}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Vertical filter */}
      {verticals.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-muted-foreground mb-3">
            Vertical
          </h3>
          <div className="space-y-1">
            {verticals.map((vertical) => {
              const checked = selectedVerticals.includes(vertical);
              return (
                <label
                  key={vertical}
                  className="flex items-center gap-2 cursor-pointer group"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onVerticalToggle(vertical)}
                    className="w-3.5 h-3.5 rounded border-border bg-background text-brand accent-brand cursor-pointer"
                  />
                  <span
                    className={`text-sm truncate ${
                      checked ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
                    }`}
                  >
                    {vertical}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="border-t border-border" />

      {/* Enrichment status filter */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground mb-3">
          Enrichment
        </h3>
        <div className="space-y-1">
          {ENRICHMENT_OPTIONS.map((opt) => {
            const isSelected = selectedEnrichment === opt.value;
            return (
              <label
                key={opt.value}
                className="flex items-center gap-2 cursor-pointer group"
              >
                <input
                  type="radio"
                  name="enrichment"
                  value={opt.value}
                  checked={isSelected}
                  onChange={() => onEnrichmentChange(opt.value)}
                  className="w-3.5 h-3.5 border-border bg-background accent-brand cursor-pointer"
                />
                <span className="flex items-center gap-1.5">
                  {opt.value && (
                    <span
                      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: ENRICHMENT_COLORS[opt.value] }}
                    />
                  )}
                  <span
                    className={`text-sm ${
                      isSelected ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="border-t border-border" />

      {/* Workspace filter */}
      {workspaces.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-muted-foreground mb-3">
            Workspace
          </h3>
          <select
            value={selectedWorkspace}
            onChange={(e) => onWorkspaceChange(e.target.value)}
            className="w-full bg-background border border-border text-sm text-foreground rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand appearance-none cursor-pointer"
          >
            <option value="">All workspaces</option>
            {workspaces.map((ws) => (
              <option key={ws} value={ws}>
                {ws}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="border-t border-border" />

      {/* Company sub-filter */}
      <div>
        <h3 className="text-xs font-medium text-muted-foreground mb-3">
          Company
        </h3>
        <input
          type="text"
          value={companyInput}
          onChange={(e) => {
            setCompanyInput(e.target.value);
            debouncedCompanyChange(e.target.value);
          }}
          placeholder="Filter by company..."
          className="w-full bg-background border border-border text-sm text-foreground placeholder-muted-foreground rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand"
        />
      </div>
    </>
  );

  return (
    <>
      {/* Desktop: collapsible sidebar */}
      <div className="hidden md:block flex-shrink-0">
        {/* Toggle button */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-border rounded-md bg-secondary text-foreground hover:bg-muted transition-colors mb-3"
        >
          {expanded ? (
            <ChevronLeft className="w-3.5 h-3.5" />
          ) : (
            <SlidersHorizontal className="w-3.5 h-3.5" />
          )}
          {expanded ? "Hide filters" : "Filters"}
          {activeFilterCount > 0 && (
            <span className="ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 rounded-full bg-brand text-white text-[10px] font-bold px-1">
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* Expanded sidebar */}
        {expanded && (
          <aside className="w-[280px] space-y-5 animate-fade-in">
            {filterContent}
          </aside>
        )}

        {/* Collapsed: horizontal pill bar */}
        {!expanded && (
          <div className="flex flex-wrap gap-1.5 animate-fade-in">
            {quickPills.map((pill) => (
              <button
                key={pill.label}
                onClick={pill.onToggle}
                className={`inline-flex items-center px-2.5 py-1 text-xs rounded-full border transition-colors ${
                  pill.active
                    ? "bg-brand/10 border-brand/30 text-brand-strong font-medium"
                    : "bg-secondary border-border text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >
                {pill.label}
              </button>
            ))}
            {activeFilterCount > 0 && onClearAll && (
              <button
                onClick={onClearAll}
                className="inline-flex items-center px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {/* Mobile filter toggle button */}
      <div className="md:hidden flex-shrink-0">
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-md bg-secondary text-foreground hover:bg-muted transition-colors"
        >
          {mobileOpen ? (
            <X className="w-3.5 h-3.5" />
          ) : (
            <SlidersHorizontal className="w-3.5 h-3.5" />
          )}
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 rounded-full bg-brand text-white text-[10px] font-bold px-1">
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* Mobile expandable filter panel */}
        {mobileOpen && (
          <div className="mt-3 p-4 border border-border rounded-lg bg-card space-y-5 animate-fade-in">
            {filterContent}
          </div>
        )}
      </div>
    </>
  );
}
