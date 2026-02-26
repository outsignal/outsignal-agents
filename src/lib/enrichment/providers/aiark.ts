/**
 * AI Ark company data provider adapter.
 *
 * Fetches structured company data (headcount, industry, description, etc.)
 * from the AI Ark API given a company domain.
 *
 * IMPORTANT: AI Ark auth header name is LOW confidence (docs say "Header" security
 * scheme without specifying the literal name). Currently using "X-TOKEN" as the most
 * common pattern. If calls return 401/403, check https://ai-ark.com/docs and update
 * AUTH_HEADER_NAME below to match the actual header name.
 */

import { z } from "zod";
import { PROVIDER_COSTS } from "../costs";
import type { CompanyAdapter, CompanyProviderResult } from "../types";

const AIARK_ENDPOINT = "https://api.ai-ark.com/api/developer-portal/v1/companies";

/**
 * Auth header literal name for AI Ark API.
 * LOW CONFIDENCE — update if you get 401/403 responses.
 * Candidates: "X-TOKEN", "Authorization" (Bearer), "X-API-Key"
 */
const AUTH_HEADER_NAME = "X-TOKEN";

const REQUEST_TIMEOUT_MS = 10_000;

function getApiKey(): string {
  const key = process.env.AIARK_API_KEY;
  if (!key) {
    throw new Error("AIARK_API_KEY environment variable is not set");
  }
  return key;
}

/** Loose validation schema — AI Ark response shape is LOW confidence. */
const AiArkCompanySchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    industry: z.string().optional(),
    staff: z.object({ total: z.number().optional() }).optional(),
    links: z.object({ website: z.string().optional() }).optional(),
    headquarter: z.string().optional(),
    founded_year: z.number().optional(),
  })
  .passthrough();

type AiArkCompany = z.infer<typeof AiArkCompanySchema>;

/**
 * Normalize raw API response to an array of company records.
 * AI Ark may return a single object, an array, or wrap results in a `data` key.
 */
function extractCompanies(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (obj.data !== undefined) {
      return Array.isArray(obj.data) ? obj.data : [obj.data];
    }
  }
  return [raw];
}

function mapToResult(company: AiArkCompany, raw: unknown): CompanyProviderResult {
  return {
    name: company.name,
    industry: company.industry,
    headcount: company.staff?.total,
    description: company.description,
    website: company.links?.website,
    location: company.headquarter,
    yearFounded: company.founded_year,
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

    if (response.status === 401 || response.status === 403) {
      console.warn(
        `AI Ark auth failed (${response.status}) — verify AUTH_HEADER_NAME in aiark.ts matches API docs. ` +
          `Currently using "${AUTH_HEADER_NAME}". Check https://ai-ark.com/docs for the correct header name.`,
      );
      throw new Error(`AI Ark auth error: HTTP ${response.status}`);
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

  const companies = extractCompanies(raw);
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
