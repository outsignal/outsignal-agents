/**
 * AI Ark company data provider adapter.
 *
 * Fetches structured company data (headcount, industry, description, etc.)
 * from the AI Ark API given a company domain.
 *
 * Auth: X-TOKEN header with API key.
 */

import { z } from "zod";
import { CreditExhaustionError } from "@/lib/enrichment/credit-exhaustion";
import { PROVIDER_COSTS } from "../costs";
import type { CompanyAdapter, CompanyProviderResult } from "../types";
import type { RateLimits } from "@/lib/discovery/rate-limit";
import { extractAiArkCompanies, mapAiArkCompanyData } from "./aiark-mapping";

/**
 * AI Ark company enrichment rate limits.
 * Source: AI Ark API docs.
 *
 * All endpoints share the same limits:
 *   - 5 requests/second
 *   - 300 requests/minute
 *   - 18,000 requests/hour
 * Returns 429 when exceeded. Rate limits reset every 60 seconds.
 */
export const RATE_LIMITS: RateLimits = {
  maxBatchSize: 1,
  delayBetweenCalls: 200,        // 5 req/s — Source: AI Ark API docs
  maxConcurrent: 1,
  dailyCap: null,                // No daily cap; 18,000 req/hour limit
  cooldownOnRateLimit: 300_000,  // 5 min cooldown on 401/429
};

const AIARK_ENDPOINT = "https://api.ai-ark.com/api/developer-portal/v1/companies";

/** Auth header name for AI Ark API (confirmed working in production). */
const AUTH_HEADER_NAME = "X-TOKEN";

const REQUEST_TIMEOUT_MS = 10_000;

function getApiKey(): string {
  const key = process.env.AIARK_API_KEY;
  if (!key) {
    throw new Error("AIARK_API_KEY environment variable is not set");
  }
  return key;
}

/** Loose validation schema for a nested AI Ark company record. */
const AiArkCompanySchema = z
  .object({
    id: z.string().optional(),
    summary: z.object({}).passthrough().optional(),
    link: z.object({}).passthrough().optional(),
    location: z.object({}).passthrough().optional(),
    financial: z.object({}).passthrough().optional(),
    technologies: z.array(z.unknown()).optional(),
  })
  .passthrough();

type AiArkCompany = z.infer<typeof AiArkCompanySchema>;

function mapToResult(company: AiArkCompany, raw: unknown): CompanyProviderResult {
  const mapped = mapAiArkCompanyData(company);
  return {
    ...mapped.data,
    ...(mapped.domain ? { domain: mapped.domain } : {}),
    source: "aiark",
    rawResponse: raw,
    costUsd: PROVIDER_COSTS.aiark,
  };
}

/**
 * AI Ark company data adapter.
 * Implements CompanyAdapter — takes a domain, returns structured company data.
 */
export const aiarkAdapter: CompanyAdapter = async (domain: string): Promise<CompanyProviderResult> => {
  const apiKey = getApiKey();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let raw: unknown;

  try {
    const response = await fetch(AIARK_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [AUTH_HEADER_NAME]: apiKey,
      },
      body: JSON.stringify({
        account: { domain: { include: [domain] } },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 403) {
      throw new CreditExhaustionError("aiark", 403);
    }

    if (response.status === 401) {
      console.warn(`AI Ark auth failed: HTTP 401`);
      throw new Error(`AI Ark auth error: HTTP 401`);
    }

    if (response.status === 429) {
      throw Object.assign(new Error("AI Ark rate limit exceeded"), { status: 429 });
    }

    if (response.status === 404 || response.status === 422) {
      throw Object.assign(new Error(`AI Ark error: HTTP ${response.status}`), {
        status: response.status,
      });
    }

    if (!response.ok) {
      throw Object.assign(new Error(`AI Ark unexpected error: HTTP ${response.status}`), {
        status: response.status,
      });
    }

    raw = await response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }

  const companies = extractAiArkCompanies(raw);
  const firstCompany = companies[0];

  if (!firstCompany) {
    // No company data — return empty result (waterfall will try next provider)
    return {
      source: "aiark",
      rawResponse: raw,
      costUsd: PROVIDER_COSTS.aiark,
    };
  }

  const parsed = AiArkCompanySchema.safeParse(firstCompany);

  if (!parsed.success) {
    // Validation failed — still charge the cost, return empty result
    console.warn("AI Ark response failed validation:", parsed.error.message);
    return {
      source: "aiark",
      rawResponse: raw,
      costUsd: PROVIDER_COSTS.aiark,
    };
  }

  return mapToResult(parsed.data, raw);
};
