/**
 * Shared copy quality validation.
 *
 * Centralised banned-pattern list used by:
 *   - Reply suggestion generation (trigger/generate-suggestion.ts)
 *   - Campaign copy generation (writer agent tools)
 *   - Campaign content approval (portal approve-content route)
 */

export interface BannedPattern {
  pattern: RegExp;
  name: string;
}

export const BANNED_PATTERNS: BannedPattern[] = [
  { pattern: /quick question/i, name: "quick question" },
  { pattern: /\u2014/, name: "em dash" },
  { pattern: /\u2013/, name: "en dash" },
  { pattern: / - /, name: "hyphen separator" },
  { pattern: /I'd love to/i, name: "I'd love to" },
  { pattern: /I hope this email finds you/i, name: "hope this email finds you" },
  { pattern: /just following up/i, name: "just following up" },
  { pattern: /no worries/i, name: "no worries" },
  { pattern: /we'd love to/i, name: "we'd love to" },
  { pattern: /feel free to/i, name: "feel free to" },
  { pattern: /pick your brain/i, name: "pick your brain" },
];

export interface CopyQualityResult {
  violations: string[];
  clean: boolean;
}

/**
 * Check a text string for banned patterns.
 *
 * @param text - The copy to validate
 * @returns An object with the list of violation names and a `clean` boolean
 */
export function checkCopyQuality(text: string): CopyQualityResult {
  if (!text) return { violations: [], clean: true };

  const violations: string[] = [];
  for (const { pattern, name } of BANNED_PATTERNS) {
    // Reset lastIndex for global/sticky regex safety
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      violations.push(name);
    }
  }

  return { violations, clean: violations.length === 0 };
}

export interface SequenceStepViolation {
  step: number;
  field: string; // "subject" | "subjectVariantB" | "body"
  violations: string[];
}

/**
 * Check all steps of a campaign email sequence for banned patterns.
 *
 * @param sequence - Array of email sequence step objects
 * @returns Array of per-step violations (empty if all clean)
 */
export function checkSequenceQuality(
  sequence: Array<{
    position?: number;
    subjectLine?: string;
    subjectVariantB?: string;
    body?: string;
  }>,
): SequenceStepViolation[] {
  const results: SequenceStepViolation[] = [];

  for (let i = 0; i < sequence.length; i++) {
    const step = sequence[i];
    const stepNum = step.position ?? i + 1;

    for (const [field, value] of [
      ["subject", step.subjectLine],
      ["subjectVariantB", step.subjectVariantB],
      ["body", step.body],
    ] as const) {
      if (!value) continue;
      const { violations } = checkCopyQuality(value);
      if (violations.length > 0) {
        results.push({ step: stepNum, field, violations });
      }
    }
  }

  return results;
}

/**
 * Format sequence violations into a human-readable summary string.
 */
export function formatSequenceViolations(
  violations: SequenceStepViolation[],
): string {
  return violations
    .map(
      (v) =>
        `Step ${v.step} (${v.field}): ${v.violations.join(", ")}`,
    )
    .join("; ");
}
