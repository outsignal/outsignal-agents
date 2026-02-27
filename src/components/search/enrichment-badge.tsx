"use client";

import {
  getEnrichmentStatus,
  ENRICHMENT_COLORS,
  ENRICHMENT_LABELS,
} from "@/lib/enrichment/status";

interface EnrichmentBadgeProps {
  person: {
    email: string | null;
    linkedinUrl: string | null;
    companyDomain: string | null;
  };
}

export function EnrichmentBadge({ person }: EnrichmentBadgeProps) {
  const status = getEnrichmentStatus(person);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span
        className="inline-block w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: ENRICHMENT_COLORS[status] }}
      />
      {ENRICHMENT_LABELS[status]}
    </span>
  );
}
