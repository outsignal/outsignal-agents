// PredictLeads — News Events adapter
// Endpoint: GET /companies/{domain}/news_events
// Returns company news signals.

import { predictLeadsGet, predictLeadsCostPerCall } from "./client.js";
import { NewsEventSchema, PredictLeadsListResponseSchema } from "./types.js";
import type { SignalInput } from "../types.js";

export interface FetchNewsEventsResult {
  signals: SignalInput[];
  costUsd: number;
  rawResponse: unknown;
}

/**
 * Fetch news events for a domain from PredictLeads and convert to SignalInput records.
 *
 * @param domain     - Company domain, e.g. "acme.com"
 * @param sinceDate  - Optional ISO date string to filter for records first_seen_at >= sinceDate
 * @returns Signals, cost, and raw response
 */
export async function fetchNewsEvents(
  domain: string,
  sinceDate?: string,
): Promise<FetchNewsEventsResult> {
  let path = `/companies/${encodeURIComponent(domain)}/news_events`;
  if (sinceDate) {
    path += `?first_seen_at_from=${encodeURIComponent(sinceDate)}`;
  }

  let rawResponse: unknown;
  try {
    rawResponse = await predictLeadsGet(path);
  } catch (error) {
    // 404 = company not found in PredictLeads — return empty, no cost charged
    if (error instanceof Error && error.message.includes("HTTP 404")) {
      return { signals: [], costUsd: 0, rawResponse: null };
    }
    throw error;
  }

  const ResponseSchema = PredictLeadsListResponseSchema(NewsEventSchema);
  const parsed = ResponseSchema.safeParse(rawResponse);

  if (!parsed.success) {
    console.warn(
      `[PredictLeads] fetchNewsEvents: failed to parse response for ${domain}:`,
      parsed.error.message,
    );
    return { signals: [], costUsd: predictLeadsCostPerCall(), rawResponse };
  }

  const signals: SignalInput[] = [];

  for (const item of parsed.data.data) {
    const itemParsed = NewsEventSchema.safeParse(item);
    if (!itemParsed.success) {
      console.warn(
        `[PredictLeads] fetchNewsEvents: skipping invalid news event for ${domain}:`,
        itemParsed.error.message,
      );
      continue;
    }

    const event = itemParsed.data;

    signals.push({
      signalType: "news",
      source: "predictleads",
      externalId: event.id,
      companyDomain: domain,
      title: event.title,
      summary: event.summary,
      sourceUrl: event.source_url,
      rawResponse: JSON.stringify(event),
    });
  }

  return {
    signals,
    costUsd: predictLeadsCostPerCall(),
    rawResponse,
  };
}
