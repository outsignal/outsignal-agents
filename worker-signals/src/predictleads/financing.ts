// PredictLeads — Financing Events adapter
// Endpoint: GET /companies/{domain}/financing_events
// Returns funding round signals.

import { predictLeadsGet, predictLeadsCostPerCall } from "./client.js";
import { FinancingEventSchema, PredictLeadsListResponseSchema } from "./types.js";
import type { SignalInput } from "../types.js";

export interface FetchFinancingEventsResult {
  signals: SignalInput[];
  costUsd: number;
  rawResponse: unknown;
}

/**
 * Fetch financing events for a domain from PredictLeads and convert to SignalInput records.
 *
 * @param domain     - Company domain, e.g. "acme.com"
 * @param sinceDate  - Optional ISO date string to filter for records first_seen_at >= sinceDate
 * @returns Signals, cost, and raw response
 */
export async function fetchFinancingEvents(
  domain: string,
  sinceDate?: string,
): Promise<FetchFinancingEventsResult> {
  let path = `/companies/${encodeURIComponent(domain)}/financing_events`;
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

  const ResponseSchema = PredictLeadsListResponseSchema(FinancingEventSchema);
  const parsed = ResponseSchema.safeParse(rawResponse);

  if (!parsed.success) {
    console.warn(
      `[PredictLeads] fetchFinancingEvents: failed to parse response for ${domain}:`,
      parsed.error.message,
    );
    return { signals: [], costUsd: predictLeadsCostPerCall(), rawResponse };
  }

  const signals: SignalInput[] = [];

  for (const item of parsed.data.data) {
    const itemParsed = FinancingEventSchema.safeParse(item);
    if (!itemParsed.success) {
      console.warn(
        `[PredictLeads] fetchFinancingEvents: skipping invalid financing event for ${domain}:`,
        itemParsed.error.message,
      );
      continue;
    }

    const event = itemParsed.data;

    // Build a human-readable title from funding type + amount
    const amountStr = event.amount != null
      ? ` $${event.amount.toLocaleString()}${event.currency ? ` ${event.currency}` : ""}`
      : "";
    const title = `${event.funding_type}${amountStr} funding round`;

    signals.push({
      signalType: "funding",
      source: "predictleads",
      externalId: event.id,
      companyDomain: domain,
      title,
      rawResponse: JSON.stringify(event),
      metadata: JSON.stringify({
        funding_type: event.funding_type,
        amount: event.amount ?? null,
        currency: event.currency ?? null,
        investors: event.investors ?? [],
      }),
    });
  }

  return {
    signals,
    costUsd: predictLeadsCostPerCall(),
    rawResponse,
  };
}
