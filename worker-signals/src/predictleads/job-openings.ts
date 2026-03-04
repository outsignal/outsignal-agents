// PredictLeads — Job Openings adapter
// Endpoint: GET /companies/{domain}/job_openings
// Returns job change signals and total job count for hiring spike detection.

import { predictLeadsGet, predictLeadsCostPerCall } from "./client.js";
import { JobOpeningSchema, PredictLeadsListResponseSchema } from "./types.js";
import type { SignalInput } from "../types.js";

export interface FetchJobOpeningsResult {
  signals: SignalInput[];
  costUsd: number;
  rawResponse: unknown;
  /** Total job openings returned — used by caller to detect hiring spikes (>10 threshold). */
  totalJobCount: number;
}

/**
 * Fetch job openings for a domain from PredictLeads and convert to SignalInput records.
 *
 * @param domain     - Company domain, e.g. "acme.com"
 * @param sinceDate  - Optional ISO date string to filter for records first_seen_at >= sinceDate
 * @returns Signals, cost, raw response, and total job count for hiring spike detection
 */
export async function fetchJobOpenings(
  domain: string,
  sinceDate?: string,
): Promise<FetchJobOpeningsResult> {
  let path = `/companies/${encodeURIComponent(domain)}/job_openings`;
  if (sinceDate) {
    path += `?first_seen_at_from=${encodeURIComponent(sinceDate)}`;
  }

  let rawResponse: unknown;
  try {
    rawResponse = await predictLeadsGet(path);
  } catch (error) {
    // 404 = company not found in PredictLeads — return empty, no cost charged
    if (error instanceof Error && error.message.includes("HTTP 404")) {
      return { signals: [], costUsd: 0, rawResponse: null, totalJobCount: 0 };
    }
    throw error;
  }

  const ResponseSchema = PredictLeadsListResponseSchema(JobOpeningSchema);
  const parsed = ResponseSchema.safeParse(rawResponse);

  if (!parsed.success) {
    console.warn(
      `[PredictLeads] fetchJobOpenings: failed to parse response for ${domain}:`,
      parsed.error.message,
    );
    return { signals: [], costUsd: predictLeadsCostPerCall(), rawResponse, totalJobCount: 0 };
  }

  const signals: SignalInput[] = [];

  for (const item of parsed.data.data) {
    const itemParsed = JobOpeningSchema.safeParse(item);
    if (!itemParsed.success) {
      console.warn(
        `[PredictLeads] fetchJobOpenings: skipping invalid job opening for ${domain}:`,
        itemParsed.error.message,
      );
      continue;
    }

    const job = itemParsed.data;

    signals.push({
      signalType: "job_change",
      source: "predictleads",
      externalId: job.id,
      companyDomain: domain,
      title: job.title,
      rawResponse: JSON.stringify(job),
      metadata: JSON.stringify({
        location: job.location ?? null,
        seniority: job.seniority ?? null,
        department: job.department ?? null,
      }),
    });
  }

  return {
    signals,
    costUsd: predictLeadsCostPerCall(),
    rawResponse,
    totalJobCount: parsed.data.data.length,
  };
}
