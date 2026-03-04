// PredictLeads — Technology Detections adapter
// Endpoint: GET /companies/{domain}/technology_detections
// Returns technology adoption/removal signals.

import { predictLeadsGet, predictLeadsCostPerCall } from "./client.js";
import { TechnologyDetectionSchema, PredictLeadsListResponseSchema } from "./types.js";
import type { SignalInput } from "../types.js";

export interface FetchTechnologyDetectionsResult {
  signals: SignalInput[];
  costUsd: number;
  rawResponse: unknown;
}

/**
 * Fetch technology detections for a domain from PredictLeads and convert to SignalInput records.
 *
 * @param domain     - Company domain, e.g. "acme.com"
 * @param sinceDate  - Optional ISO date string to filter for records first_seen_at >= sinceDate
 * @returns Signals, cost, and raw response
 */
export async function fetchTechnologyDetections(
  domain: string,
  sinceDate?: string,
): Promise<FetchTechnologyDetectionsResult> {
  let path = `/companies/${encodeURIComponent(domain)}/technology_detections`;
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

  const ResponseSchema = PredictLeadsListResponseSchema(TechnologyDetectionSchema);
  const parsed = ResponseSchema.safeParse(rawResponse);

  if (!parsed.success) {
    console.warn(
      `[PredictLeads] fetchTechnologyDetections: failed to parse response for ${domain}:`,
      parsed.error.message,
    );
    return { signals: [], costUsd: predictLeadsCostPerCall(), rawResponse };
  }

  const signals: SignalInput[] = [];

  for (const item of parsed.data.data) {
    const itemParsed = TechnologyDetectionSchema.safeParse(item);
    if (!itemParsed.success) {
      console.warn(
        `[PredictLeads] fetchTechnologyDetections: skipping invalid tech detection for ${domain}:`,
        itemParsed.error.message,
      );
      continue;
    }

    const detection = itemParsed.data;

    // Title: "Adopted {technology_name}" (or "Detected {technology_name}" for existing tech)
    const verb = detection.is_new === true ? "Adopted" : "Detected";
    const title = `${verb} ${detection.technology_name}`;

    signals.push({
      signalType: "tech_adoption",
      source: "predictleads",
      externalId: detection.id,
      companyDomain: domain,
      title,
      rawResponse: JSON.stringify(detection),
      metadata: JSON.stringify({
        technology_name: detection.technology_name,
        category: detection.category ?? null,
        is_new: detection.is_new ?? null,
      }),
    });
  }

  return {
    signals,
    costUsd: predictLeadsCostPerCall(),
    rawResponse,
  };
}
