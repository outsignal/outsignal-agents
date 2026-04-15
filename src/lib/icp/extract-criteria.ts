import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { NOVA_MODEL } from "@/lib/agents/types";

/**
 * Schema for structured ICP criteria extracted from natural language.
 */
export const icpCriteriaSchema = z.object({
  industries: z
    .array(z.string())
    .describe("Industry/vertical names (e.g. 'SaaS', 'Fintech', 'Healthcare')"),
  titles: z
    .array(z.string())
    .describe("Job titles to target (e.g. 'CEO', 'CTO', 'Head of Marketing')"),
  companySizes: z
    .array(z.string())
    .describe("Company size ranges (e.g. '11-50', '51-200', '201-500')"),
  locations: z
    .array(z.string())
    .describe("Geographic locations (e.g. 'United Kingdom', 'London', 'US')"),
  keywords: z
    .array(z.string())
    .optional()
    .describe("Additional keywords for filtering"),
});

/**
 * Extract structured ICP criteria from a natural language description.
 */
export async function extractIcpCriteria(
  description: string,
): Promise<z.infer<typeof icpCriteriaSchema>> {
  const { object } = await generateObject({
    model: anthropic(NOVA_MODEL),
    schema: icpCriteriaSchema,
    prompt: `Extract structured ICP (Ideal Customer Profile) criteria from this description. Return arrays for each field. If a field is not mentioned, return an empty array.\n\nDescription: "${description}"`,
  });
  return object;
}
