/**
 * Company name classifier.
 * Extends existing rule-based normalizeCompanyName with AI fallback for ambiguous cases.
 */
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { normalizeCompanyName } from "@/lib/normalize";

const CompanyNameSchema = z.object({
  canonical: z.string().min(1).max(200),
  confidence: z.enum(["high", "medium", "low"]),
});

/**
 * Normalize a company name. Uses rule-based logic first, escalates to Claude
 * for inputs that look problematic (all caps > 4 chars, contains noise words, etc.).
 */
export async function classifyCompanyName(raw: string): Promise<string | null> {
  if (!raw?.trim()) return null;

  const trimmed = raw.trim();

  // Rule-based fast path handles most cases
  const ruleBased = normalizeCompanyName(trimmed);

  // If the input looks clean (mixed case or short acronym), rule-based is sufficient
  const isAllCaps = trimmed.length > 4 && trimmed === trimmed.toUpperCase();
  const hasNoiseWords = /\b(inc|corp|llc|ltd|gmbh|plc|pvt|pty|limited)\b/i.test(trimmed);
  const isGarbled = /[^a-zA-Z0-9\s\-.,&'()®™]/.test(trimmed);

  // Only escalate to AI for problematic inputs
  if (!isAllCaps && !hasNoiseWords && !isGarbled) {
    return ruleBased;
  }

  // AI fallback for ambiguous cases
  try {
    const { object } = await generateObject({
      model: anthropic("claude-haiku-4-5-20251001"),
      schema: CompanyNameSchema,
      prompt: `Clean up this company name. Remove legal suffixes (Inc, LLC, Ltd, Corp, GmbH, etc.), fix capitalization, and return the canonical company name as it would appear in professional communications.
Raw company name: "${trimmed}"
If the input is unrecognizable, return the best-effort cleanup. Set confidence to "low" if the result is a guess.`,
    });

    return object.confidence === "low" ? ruleBased : object.canonical;
  } catch (error) {
    console.error("Company name classification failed:", error);
    return ruleBased; // Fall back to rule-based on AI failure
  }
}
