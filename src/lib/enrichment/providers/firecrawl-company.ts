/**
 * Firecrawl company data provider adapter.
 *
 * Uses Firecrawl's extract() method with a Zod schema to get structured
 * company data (headcount, industry, description, etc.) from a company website.
 *
 * This is the fallback provider in the company enrichment waterfall (AI Ark → Firecrawl).
 * It creates its own Firecrawl client instance — does NOT modify src/lib/firecrawl/client.ts.
 *
 * Note: Firecrawl's extract() endpoint is deprecated but still functional.
 * If it stops working, migrate to their scrape() + json format approach.
 */

import Firecrawl from "@mendable/firecrawl-js";
import { z } from "zod";
import { PROVIDER_COSTS } from "../costs";
import type { CompanyAdapter, CompanyProviderResult } from "../types";

/** Safety timeout for Firecrawl extract — it can be slow on large sites. */
const EXTRACT_TIMEOUT_MS = 30_000;

/** Schema for structured company data extraction. */
const CompanyExtractSchema = z.object({
  headcount: z.number().optional(),
  industry: z.string().optional(),
  description: z.string().optional(),
  yearFounded: z.number().optional(),
  location: z.string().optional(),
  name: z.string().optional(),
});

type CompanyExtract = z.infer<typeof CompanyExtractSchema>;

const EXTRACT_PROMPT =
  "Extract the company name, number of employees (as a number), industry, a one-paragraph description, " +
  "year the company was founded, and headquarters location from this website.";

function getClient(): Firecrawl {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY environment variable is not set");
  }
  return new Firecrawl({ apiKey });
}

/**
 * Firecrawl company extract adapter.
 * Implements CompanyAdapter — takes a domain, returns structured company data.
 */
export const firecrawlCompanyAdapter: CompanyAdapter = async (
  domain: string,
): Promise<CompanyProviderResult> => {
  const client = getClient();

  let result: Awaited<ReturnType<typeof client.extract>>;

  try {
    result = await Promise.race([
      // The default Firecrawl export (v2 FirecrawlClient) bundles urls + params into one arg.
      // Cast schema to `any` — the Firecrawl SDK type uses its own bundled zod v4 ZodTypeAny
      // which is not assignable from our project's zod v3 types. At runtime this works fine.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.extract({
        urls: [`https://${domain}`],
        prompt: EXTRACT_PROMPT,
        schema: CompanyExtractSchema as any,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Firecrawl extract timeout after 30s")),
          EXTRACT_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (err) {
    console.error(`Firecrawl extract failed for domain "${domain}":`, err);
    throw err;
  }

  // result.data is typed as the inferred schema when a ZodSchema is passed
  const data = (result as { success: boolean; data?: CompanyExtract }).data ?? {};

  return {
    name: data.name,
    industry: data.industry,
    headcount: data.headcount,
    description: data.description,
    yearFounded: data.yearFounded,
    location: data.location,
    source: "firecrawl",
    rawResponse: result,
    costUsd: PROVIDER_COSTS.firecrawl,
  };
};
