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
  // Original 13 patterns (do not remove or reorder)
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
  { pattern: /\{\{[^}]+\}\}/, name: "double-brace variable (use {UPPERCASE} single braces)" },
  { pattern: /\{(firstName|lastName|companyName|jobTitle|location|lastEmailMonth)\}/, name: "lowercase variable (use {FIRSTNAME}, {COMPANYNAME}, etc.)" },

  // Expanded patterns from writer-rules.md
  { pattern: /genuine question/i, name: "genuine question" },
  { pattern: /honest question/i, name: "honest question" },
  { pattern: /curious if/i, name: "curious if" },
  { pattern: /curious whether/i, name: "curious whether" },
  { pattern: /ring any bells/i, name: "ring any bells" },
  { pattern: /sound familiar/i, name: "sound familiar" },
  { pattern: /My name is/i, name: "My name is" },
  { pattern: /I wanted to reach out/i, name: "I wanted to reach out" },
  { pattern: /touching base/i, name: "touching base" },
  { pattern: /circling back/i, name: "circling back" },
  { pattern: /circle back/i, name: "circle back" },
  { pattern: /synergy/i, name: "synergy" },
  { pattern: /leverage/i, name: "leverage" },
  { pattern: /streamline/i, name: "streamline" },
  { pattern: /game-changer/i, name: "game-changer" },
  { pattern: /revolutionary/i, name: "revolutionary" },
  { pattern: /guaranteed/i, name: "guaranteed" },
  { pattern: /act now/i, name: "act now" },
  { pattern: /limited time/i, name: "limited time" },
  { pattern: /exclusive offer/i, name: "exclusive offer" },
  { pattern: /no obligation/i, name: "no obligation" },
  { pattern: /\bfree\b/i, name: "free" },
  { pattern: /excited to/i, name: "excited to" },
  { pattern: /at your earliest convenience/i, name: "at your earliest convenience" },
  { pattern: /as per my last email/i, name: "as per my last email" },
  { pattern: /following up/i, name: "following up" },
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

// ---------------------------------------------------------------------------
// New types and check functions (Phase 52 — severity-tiered validation)
// ---------------------------------------------------------------------------

export type CopyStrategy =
  | "pvp"
  | "creative-ideas"
  | "one-liner"
  | "custom"
  | "linkedin";

export const WORD_COUNT_LIMITS: Record<CopyStrategy, number> = {
  pvp: 70,
  "creative-ideas": 90,
  "one-liner": 50,
  custom: 80,
  linkedin: 100,
};

export interface CheckResult {
  severity: "hard" | "soft";
  violation: string;
}

// ---------------------------------------------------------------------------
// Validation aggregator types (Phase 54)
// ---------------------------------------------------------------------------

export interface ValidateAllOptions {
  strategy: CopyStrategy;
  channel: "email" | "linkedin";
  isFirstStep: boolean;
}

export interface StepValidationResult {
  field: string; // "body" | "subject" | "subjectVariantB"
  checks: CheckResult[]; // All violations found
  hasHardViolation: boolean;
}

/**
 * Check word count against strategy-specific limit with 10% grace period.
 *
 * - At or under limit: null (clean)
 * - Over limit but within 10% grace: soft violation
 * - Over 10% grace: hard violation
 */
export function checkWordCount(
  text: string,
  strategy: CopyStrategy,
): CheckResult | null {
  if (!text) return null;

  const limit = WORD_COUNT_LIMITS[strategy];
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const softLimit = Math.floor(limit * 1.1);

  if (wordCount > softLimit) {
    return {
      severity: "hard",
      violation: `word count ${wordCount} exceeds ${softLimit} (${strategy} limit ${limit} + 10% grace)`,
    };
  }
  if (wordCount > limit) {
    return {
      severity: "soft",
      violation: `word count ${wordCount} is over ${limit} (${strategy} limit) — review recommended`,
    };
  }
  return null;
}

/**
 * Check that the first step of a sequence starts with an appropriate greeting.
 * Non-first steps are always clean (returns null).
 */
export function checkGreeting(
  text: string,
  isFirstStep: boolean,
): CheckResult | null {
  if (!isFirstStep) return null;
  if (!text) {
    return {
      severity: "hard",
      violation: "missing greeting on first step",
    };
  }

  // Acceptable: "Hi {FIRSTNAME},", "Hello {FIRSTNAME},", "Hey {FIRSTNAME},"
  const hasGreeting = /^(Hi|Hello|Hey)\s+\{[A-Z]+\}/i.test(text.trimStart());
  if (!hasGreeting) {
    return {
      severity: "hard",
      violation:
        "first step must begin with a greeting (Hi/Hello/Hey {FIRSTNAME},)",
    };
  }
  return null;
}

/**
 * Banned AI-cliche CTA patterns. Internal to checkCTAFormat.
 */
const BANNED_CTA_PATTERNS = [
  /worth a chat\?/i,
  /open to exploring\?/i,
  /ring any bells\?/i,
  /sound familiar\?/i,
  /\bthoughts\?/i,
  /\binterested\?/i,
  /make sense for your team\?/i,
  /make sense\?/i,
];

/**
 * Check that the CTA is a question (ends with ?) and is not an AI-cliche.
 * Scans the last 2 sentences of the text.
 */
export function checkCTAFormat(text: string): CheckResult | null {
  if (!text) return null;

  const sentences = text.trim().split(/(?<=[.!?])\s+/);
  const lastTwo = sentences.slice(-2).join(" ");

  // Check for banned AI-cliche CTAs (hard-block)
  for (const pattern of BANNED_CTA_PATTERNS) {
    if (pattern.test(lastTwo)) {
      return {
        severity: "hard",
        violation: `AI-cliche CTA detected: "${lastTwo.match(pattern)?.[0]}" — rewrite with a specific, human-sounding question`,
      };
    }
  }

  // Check that CTA is a question (ends with ?)
  const trimmed = text.trimEnd();
  if (!trimmed.endsWith("?")) {
    return {
      severity: "hard",
      violation: "CTA must be a question ending with ?",
    };
  }
  return null;
}

/**
 * Check for spintax patterns in LinkedIn messages.
 * Spintax = {option1|option2} (pipe inside braces).
 * Variables like {FIRSTNAME} (no pipe) are fine.
 */
export function checkLinkedInSpintax(text: string): CheckResult | null {
  if (!text) return null;

  const hasSpintax = /\{[^{}|]+\|[^{}]+\}/.test(text);
  if (hasSpintax) {
    return {
      severity: "hard",
      violation:
        "spintax found in LinkedIn copy — LinkedIn is 1-to-1, pick one option",
    };
  }
  return null;
}

/**
 * Check subject line rules: no exclamation marks, max 6 words.
 */
export function checkSubjectLine(text: string): CheckResult | null {
  if (!text) return null;

  // Exclamation mark = hard violation
  if (text.includes("!")) {
    return {
      severity: "hard",
      violation: "subject line must not contain exclamation marks",
    };
  }

  // Word count: over 6 words = soft violation
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount > 6) {
    return {
      severity: "soft",
      violation: `subject line is ${wordCount} words (limit 6) — consider shortening`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Validation aggregator (Phase 54 — runs ALL checks for a single field)
// ---------------------------------------------------------------------------

/**
 * Run all applicable quality checks for a single text field.
 *
 * Dispatches to the correct checks based on field type and channel:
 *   - body + email:    wordCount, greeting, CTA, banned patterns
 *   - body + linkedin: wordCount(linkedin), linkedInSpintax, greeting, banned patterns
 *   - subject/subjectVariantB: subjectLine, banned patterns
 *
 * Banned pattern violations from checkCopyQuality() are converted to hard CheckResults.
 */
export function validateAllChecks(
  text: string,
  field: "body" | "subject" | "subjectVariantB",
  options: ValidateAllOptions,
): StepValidationResult {
  const checks: CheckResult[] = [];

  if (!text) {
    return { field, checks, hasHardViolation: false };
  }

  if (field === "body") {
    // Word count — use "linkedin" strategy for linkedin channel, otherwise the provided strategy
    const wcStrategy = options.channel === "linkedin" ? "linkedin" as CopyStrategy : options.strategy;
    const wc = checkWordCount(text, wcStrategy);
    if (wc) checks.push(wc);

    // Greeting check (first step only)
    const gr = checkGreeting(text, options.isFirstStep);
    if (gr) checks.push(gr);

    // Channel-specific checks
    if (options.channel === "linkedin") {
      const sp = checkLinkedInSpintax(text);
      if (sp) checks.push(sp);
    } else {
      // CTA format check (email only — LinkedIn CTAs are more conversational)
      const cta = checkCTAFormat(text);
      if (cta) checks.push(cta);
    }
  } else {
    // subject or subjectVariantB
    const sl = checkSubjectLine(text);
    if (sl) checks.push(sl);
  }

  // Banned patterns apply to ALL fields
  const { violations: bannedViolations } = checkCopyQuality(text);
  for (const v of bannedViolations) {
    checks.push({ severity: "hard", violation: `banned pattern: ${v}` });
  }

  return {
    field,
    checks,
    hasHardViolation: checks.some((c) => c.severity === "hard"),
  };
}

// ---------------------------------------------------------------------------
// Full Sequence Validation (Phase 57 — aggregates all checks for portal gate)
// ---------------------------------------------------------------------------

export interface FullValidationResult {
  hardViolations: Array<{ step: number; field: string; violation: string }>;
  softWarnings: Array<{ step: number; field: string; violation: string }>;
  pass: boolean; // true if no hard violations
}

/**
 * Runs ALL copy quality checks on a sequence and classifies by severity.
 *
 * Used by the portal approve-content route to hard-block on violations (HTTP 422).
 *
 * Checks run per step:
 *   - Banned patterns (checkSequenceQuality) — all are hard violations
 *   - Word count (needs strategy)
 *   - Greeting (first step only)
 *   - CTA format (email body)
 *   - Subject line checks
 *   - LinkedIn spintax (if channel is linkedin)
 */
export function runFullSequenceValidation(
  sequence: Array<{
    position?: number;
    subjectLine?: string;
    subjectVariantB?: string;
    body?: string;
  }>,
  options?: {
    strategy?: CopyStrategy;
    channel?: "email" | "linkedin";
  },
): FullValidationResult {
  const hardViolations: FullValidationResult["hardViolations"] = [];
  const softWarnings: FullValidationResult["softWarnings"] = [];

  const strategy = options?.strategy ?? "pvp";
  const channel = options?.channel ?? "email";

  for (let i = 0; i < sequence.length; i++) {
    const step = sequence[i];
    const stepNum = step.position ?? i + 1;
    const isFirstStep = i === 0;

    // Check body
    if (step.body) {
      const bodyResult = validateAllChecks(step.body, "body", {
        strategy,
        channel,
        isFirstStep,
      });
      for (const check of bodyResult.checks) {
        const entry = { step: stepNum, field: "body", violation: check.violation };
        if (check.severity === "hard") {
          hardViolations.push(entry);
        } else {
          softWarnings.push(entry);
        }
      }
    }

    // Check subject line
    if (step.subjectLine) {
      const subjectResult = validateAllChecks(step.subjectLine, "subject", {
        strategy,
        channel,
        isFirstStep,
      });
      for (const check of subjectResult.checks) {
        const entry = { step: stepNum, field: "subject", violation: check.violation };
        if (check.severity === "hard") {
          hardViolations.push(entry);
        } else {
          softWarnings.push(entry);
        }
      }
    }

    // Check subject variant B
    if (step.subjectVariantB) {
      const variantResult = validateAllChecks(step.subjectVariantB, "subjectVariantB", {
        strategy,
        channel,
        isFirstStep,
      });
      for (const check of variantResult.checks) {
        const entry = { step: stepNum, field: "subjectVariantB", violation: check.violation };
        if (check.severity === "hard") {
          hardViolations.push(entry);
        } else {
          softWarnings.push(entry);
        }
      }
    }
  }

  return {
    hardViolations,
    softWarnings,
    pass: hardViolations.length === 0,
  };
}
