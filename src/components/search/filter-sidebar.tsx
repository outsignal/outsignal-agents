"use client";

import { useDebouncedCallback } from "use-debounce";
import { useState } from "react";

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
}

const ENRICHMENT_OPTIONS = [
  { value: "", label: "All" },
  { value: "full", label: "Enriched" },
  { value: "partial", label: "Partial" },
  { value: "missing", label: "Missing" },
];

const ENRICHMENT_COLORS: Record<string, string> = {
  full: "#4ECDC4",
  partial: "#F0FF7A",
  missing: "#FF6B6B",
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
}: FilterSidebarProps) {
  const [companyInput, setCompanyInput] = useState(companyFilter);

  const debouncedCompanyChange = useDebouncedCallback((value: string) => {
    onCompanyChange(value);
  }, 300);

  return (
    <aside className="w-60 flex-shrink-0 space-y-6">
      {/* Vertical filter */}
      {verticals.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Vertical
          </h3>
          <div className="space-y-1.5">
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
                    className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 text-[#F0FF7A] accent-[#F0FF7A] cursor-pointer"
                  />
                  <span
                    className={`text-sm truncate ${
                      checked ? "text-white" : "text-gray-400 group-hover:text-gray-300"
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

      <div className="border-t border-gray-800" />

      {/* Enrichment status filter */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Enrichment
        </h3>
        <div className="space-y-1.5">
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
                  className="w-3.5 h-3.5 border-gray-600 bg-gray-800 accent-[#F0FF7A] cursor-pointer"
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
                      isSelected ? "text-white" : "text-gray-400 group-hover:text-gray-300"
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

      <div className="border-t border-gray-800" />

      {/* Workspace filter */}
      {workspaces.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Workspace
          </h3>
          <select
            value={selectedWorkspace}
            onChange={(e) => onWorkspaceChange(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 text-sm text-white rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#F0FF7A] appearance-none cursor-pointer"
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

      <div className="border-t border-gray-800" />

      {/* Company sub-filter */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
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
          className="w-full bg-gray-800 border border-gray-700 text-sm text-white placeholder-gray-500 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#F0FF7A]"
        />
      </div>
    </aside>
  );
}
