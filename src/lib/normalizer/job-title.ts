/**
 * Job title classifier.
 * Extracts a canonical job title and seniority level from raw input.
 */
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { SENIORITY_LEVELS } from "./vocabulary";

const JobTitleSchema = z.object({
  canonical: z.string().min(1).max(200),
  seniority: z.enum(SENIORITY_LEVELS as unknown as [string, ...string[]]),
  confidence: z.enum(["high", "medium", "low"]),
});

export interface JobTitleResult {
  canonical: string;
  seniority: string;
}

/** Seniority keywords for rule-based fast path. */
const SENIORITY_PATTERNS: Array<{ pattern: RegExp; level: string }> = [
  { pattern: /\b(ceo|cto|cfo|coo|cmo|cpo|cio|chief)\b/i, level: "C-Suite" },
  { pattern: /\bvp\b|\bvice.?president\b/i, level: "VP" },
  { pattern: /\bdirector\b/i, level: "Director" },
  { pattern: /\bmanager\b|\bhead of\b/i, level: "Manager" },
  { pattern: /\bsenior\b|\bsr\.?\b|\blead\b|\bprincipal\b/i, level: "Senior IC" },
  { pattern: /\bjunior\b|\bjr\.?\b|\bassociate\b|\bentry\b/i, level: "Entry Level" },
];

/**
 * Classify a job title into a canonical form and seniority level.
 * Uses rule-based seniority detection for obvious cases, escalates to Claude for ambiguous titles.
 */
export async function classifyJobTitle(
  raw: string,
): Promise<JobTitleResult | null> {
  if (!raw?.trim()) return null;

  const trimmed = raw.trim();

  // Rule-based fast path: if the title is clean and seniority is detectable
  const isCleanTitle =
    trimmed.length < 60 &&
    /^[a-zA-Z\s,\-&/.()]+$/.test(trimmed) &&
    trimmed !== trimmed.toUpperCase();

  if (isCleanTitle) {
    for (const { pattern, level } of SENIORITY_PATTERNS) {
      if (pattern.test(trimmed)) {
        // Title case the trimmed input
        const canonical = trimmed
          .split(/\s+/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(" ");
        return { canonical, seniority: level };
      }
    }
  }

  // AI fallback for ambiguous/messy titles
  try {
    const { object } = await generateObject({
      model: anthropic("claude-haiku-4-5-20251001"),
      schema: JobTitleSchema,
      prompt: `Extract a clean, canonical job title and seniority level from this raw job title.
Raw title: "${trimmed}"
Seniority levels: ${SENIORITY_LEVELS.join(", ")}
Return the title in standard professional form (e.g., "Chief Executive Officer", "VP of Sales", "Software Engineer"). Use "Unknown" seniority if unclear.`,
    });

    return {
      canonical: object.canonical,
      seniority: object.seniority,
    };
  } catch (error) {
    console.error("Job title classification failed:", error);
    return { canonical: trimmed, seniority: "Unknown" };
  }
}
