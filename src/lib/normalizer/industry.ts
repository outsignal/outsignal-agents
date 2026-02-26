/**
 * Industry/vertical classifier.
 * Maps raw industry strings to canonical verticals from the controlled vocabulary.
 * Uses exact match first (free), escalates to Claude Haiku for ambiguous cases.
 */
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { CANONICAL_VERTICALS } from "./vocabulary";

const IndustrySchema = z.object({
  canonical: z.enum(CANONICAL_VERTICALS as unknown as [string, ...string[]]),
  confidence: z.enum(["high", "medium", "low"]),
});

export async function classifyIndustry(raw: string): Promise<string | null> {
  if (!raw?.trim()) return null;

  // Rule-based fast path: exact match (case-insensitive)
  const lower = raw.toLowerCase().trim();
  const exactMatch = CANONICAL_VERTICALS.find(
    (v) => v.toLowerCase() === lower,
  );
  if (exactMatch) return exactMatch;

  // AI fallback
  try {
    const { object } = await generateObject({
      model: anthropic("claude-haiku-4-5-20251001"),
      schema: IndustrySchema,
      prompt: `Map this industry/vertical to the closest canonical value from the list below.
Raw value: "${raw}"
Canonical verticals: ${CANONICAL_VERTICALS.join(", ")}
Return "Other" if no reasonable match exists. Set confidence to "low" if the match is a stretch.`,
    });

    return object.confidence === "low" ? null : object.canonical;
  } catch (error) {
    console.error("Industry classification failed:", error);
    return null;
  }
}
