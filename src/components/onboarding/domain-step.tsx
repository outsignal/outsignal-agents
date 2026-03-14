"use client";

import { useState } from "react";

interface DomainSuggestion {
  domain: string;
  available: boolean;
}

interface DomainStepProps {
  website: string;
  selectedDomains: string[];
  onChange: (domains: string[]) => void;
}

export function DomainStep({
  website,
  selectedDomains,
  onChange,
}: DomainStepProps) {
  const [suggestions] = useState<DomainSuggestion[]>([]);

  function toggleDomain(domain: string) {
    if (selectedDomains.includes(domain)) {
      onChange(selectedDomains.filter((d) => d !== domain));
    } else if (selectedDomains.length < 5) {
      onChange([...selectedDomains, domain]);
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

      {suggestions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400">
            Select up to 5 domains ({selectedDomains.length}/5 selected)
          </p>
          <div className="grid gap-2">
            {suggestions.map((s) => (
              <button
                key={s.domain}
                onClick={() => s.available && toggleDomain(s.domain)}
                disabled={
                  !s.available ||
                  (selectedDomains.length >= 5 &&
                    !selectedDomains.includes(s.domain))
                }
                className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                  selectedDomains.includes(s.domain)
                    ? "border-gray-900 bg-gray-900 text-white"
                    : s.available
                      ? "border-gray-200 hover:border-gray-400"
                      : "border-gray-100 bg-gray-50 text-gray-400"
                }`}
              >
                <span className="font-mono">{s.domain}</span>
                {s.available ? (
                  selectedDomains.includes(s.domain) ? (
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
                  ) : (
                    <span className="text-xs text-emerald-600">Available</span>
                  )
                ) : (
                  <span className="text-xs">Taken</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="text-sm text-gray-500">
        Domain suggestions coming soon. You can skip this step for now.
      </p>
    </div>
  );
}
