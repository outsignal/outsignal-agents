"use client";

import { useState, useEffect, useCallback } from "react";

interface DomainStepProps {
  website: string;
  selectedDomains: string[];
  onChange: (domains: string[]) => void;
}

interface SuggestionsResponse {
  domains: string[] | { domain: string; available: boolean | null }[];
  checked: boolean;
}

interface CustomCheckResponse {
  domain: string;
  available: boolean | null;
  checked: boolean;
}

export function DomainStep({
  website,
  selectedDomains,
  onChange,
}: DomainStepProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availabilityChecked, setAvailabilityChecked] = useState(false);
  const [customDomain, setCustomDomain] = useState("");
  const [checkingCustom, setCheckingCustom] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  const fetchSuggestions = useCallback(async (site: string) => {
    setLoading(true);
    setError(null);
    setSuggestions([]);

    try {
      const res = await fetch(
        `/api/domains/suggestions?website=${encodeURIComponent(site)}`,
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to fetch suggestions (${res.status})`);
      }

      const data: SuggestionsResponse = await res.json();

      // Handle both response shapes (checked = array of strings, unchecked = array of objects)
      let domainList: string[];
      if (data.checked) {
        domainList = data.domains as string[];
      } else {
        domainList = (data.domains as { domain: string }[]).map((d) =>
          typeof d === "string" ? d : d.domain,
        );
      }

      setSuggestions(domainList);
      setAvailabilityChecked(data.checked);
    } catch (err) {
      console.error("[domain-step] Failed to fetch suggestions:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load domain suggestions. You can still add domains manually below.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (website && website.trim().length >= 2) {
      fetchSuggestions(website);
    }
  }, [website, fetchSuggestions]);

  function toggleDomain(domain: string) {
    if (selectedDomains.includes(domain)) {
      onChange(selectedDomains.filter((d) => d !== domain));
    } else if (selectedDomains.length < 5) {
      onChange([...selectedDomains, domain]);
    }
  }

  async function addCustomDomain() {
    const domain = customDomain.trim().toLowerCase();
    if (!domain || selectedDomains.includes(domain) || selectedDomains.length >= 5) return;
    if (!domain.includes(".")) {
      setCustomError("Enter a full domain (e.g. mydomain.com)");
      return;
    }

    setCheckingCustom(true);
    setCustomError(null);

    try {
      const res = await fetch("/api/domains/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });

      if (!res.ok) {
        // Fallback: add without check
        onChange([...selectedDomains, domain]);
        setCustomDomain("");
        return;
      }

      const data: CustomCheckResponse = await res.json();

      if (!data.checked) {
        // API keys not set, allow adding without availability info
        onChange([...selectedDomains, domain]);
        setCustomDomain("");
      } else if (data.available) {
        onChange([...selectedDomains, domain]);
        setCustomDomain("");
      } else {
        setCustomError(`${domain} is not available. Try a different domain.`);
      }
    } catch {
      // On error, still allow adding (graceful degradation)
      onChange([...selectedDomains, domain]);
      setCustomDomain("");
    } finally {
      setCheckingCustom(false);
    }
  }

  return (
    <div className="space-y-4">
      {website ? (
        <p className="text-sm text-gray-500">
          Based on: <span className="font-medium text-gray-700">{website}</span>
        </p>
      ) : (
        <p className="text-sm text-gray-500">
          Go back and enter your website URL first to get domain suggestions.
        </p>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-6">
          <svg
            className="h-4 w-4 animate-spin text-[#635BFF]"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <span className="text-sm text-gray-500">
            Checking domain availability...
          </span>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Suggestions list */}
      {!loading && suggestions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400">
            {availabilityChecked
              ? `${suggestions.length} available domain${suggestions.length === 1 ? "" : "s"} found. Select up to 5 (${selectedDomains.length}/5 selected).`
              : `Select up to 5 domains (${selectedDomains.length}/5 selected). Availability not verified.`}
          </p>
          <div className="grid gap-2 max-h-[300px] overflow-y-auto">
            {suggestions.map((domain) => (
              <button
                key={domain}
                type="button"
                onClick={() => toggleDomain(domain)}
                disabled={
                  selectedDomains.length >= 5 &&
                  !selectedDomains.includes(domain)
                }
                className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                  selectedDomains.includes(domain)
                    ? "border-[#635BFF] bg-[#635BFF] text-white"
                    : "border-gray-200 hover:border-gray-400 disabled:opacity-40"
                }`}
              >
                <span className="font-mono">{domain}</span>
                {selectedDomains.includes(domain) && (
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* No results */}
      {!loading && !error && suggestions.length === 0 && website && (
        <p className="text-sm text-gray-400">
          No available domains found from suggestions. Add your own below.
        </p>
      )}

      {/* Custom domain input */}
      <div className="space-y-1.5">
        <p className="text-xs text-gray-400">Or add your own domain:</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={customDomain}
            onChange={(e) => {
              setCustomDomain(e.target.value);
              setCustomError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                addCustomDomain();
              }
            }}
            placeholder="e.g. mycustomdomain.com"
            disabled={checkingCustom}
            className="flex-1 border-0 border-b-2 border-gray-300 bg-transparent px-0 pb-2 text-sm text-gray-900 placeholder:text-gray-300 focus:border-[#635BFF] focus:outline-none focus:ring-0 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={addCustomDomain}
            disabled={!customDomain.trim() || selectedDomains.length >= 5 || checkingCustom}
            className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-40"
          >
            {checkingCustom ? (
              <span className="flex items-center gap-1">
                <svg
                  className="h-3 w-3 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Checking
              </span>
            ) : (
              "Add"
            )}
          </button>
        </div>
        {customError && (
          <p className="text-xs text-red-500">{customError}</p>
        )}
      </div>

      {/* Selected summary */}
      {selectedDomains.length > 0 && (
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="mb-2 text-xs font-medium text-gray-500">Selected domains:</p>
          <div className="flex flex-wrap gap-2">
            {selectedDomains.map((d) => (
              <span
                key={d}
                className="inline-flex items-center gap-1 rounded-full bg-[#635BFF]/10 px-3 py-1 text-xs font-medium text-[#635BFF]"
              >
                {d}
                <button
                  type="button"
                  onClick={() => toggleDomain(d)}
                  className="ml-0.5 hover:text-red-500"
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
