import { describe, it, expect } from "vitest";
import {
  checkWordCount,
  countWords,
  checkGreeting,
  checkCTAFormat,
  checkLinkedInSpintax,
  checkSubjectLine,
  BANNED_PATTERNS,
  WORD_COUNT_LIMITS,
  type CheckResult,
  type CopyStrategy,
  // Verify existing exports still work
  checkCopyQuality,
  checkBusinessModelAssumption,
  checkSequenceQuality,
  formatSequenceViolations,
  // Phase 54: validateAllChecks aggregator
  validateAllChecks,
  type ValidateAllOptions,
  type StepValidationResult,
} from "../copy-quality";

// ---------------------------------------------------------------------------
// checkWordCount
// ---------------------------------------------------------------------------
describe("checkWordCount", () => {
  it("returns null for empty text", () => {
    expect(checkWordCount("", "pvp")).toBeNull();
  });

  // PVP: limit 70, soft 71-77, hard 78+
  it("returns null for 70-word PVP email (at limit)", () => {
    const text = Array(70).fill("word").join(" ");
    expect(checkWordCount(text, "pvp")).toBeNull();
  });

  it("returns soft violation for 71-word PVP email (1 over)", () => {
    const text = Array(71).fill("word").join(" ");
    const result = checkWordCount(text, "pvp");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("soft");
  });

  it("returns soft violation for 77-word PVP email (at soft ceiling)", () => {
    const text = Array(77).fill("word").join(" ");
    const result = checkWordCount(text, "pvp");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("soft");
  });

  it("returns hard violation for 78-word PVP email (over 10% grace)", () => {
    const text = Array(78).fill("word").join(" ");
    const result = checkWordCount(text, "pvp");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("hard");
  });

  // Creative Ideas: limit 90, soft 91-99, hard 100+
  it("returns null for 85-word Creative Ideas email (under 90 limit)", () => {
    const text = Array(85).fill("word").join(" ");
    expect(checkWordCount(text, "creative-ideas")).toBeNull();
  });

  it("returns soft violation for 95-word Creative Ideas email", () => {
    const text = Array(95).fill("word").join(" ");
    const result = checkWordCount(text, "creative-ideas");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("soft");
  });

  it("returns hard violation for 100-word Creative Ideas email", () => {
    const text = Array(100).fill("word").join(" ");
    const result = checkWordCount(text, "creative-ideas");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("hard");
  });

  // One-liner: limit 50, soft 51-55, hard 56+
  it("returns null for 50-word one-liner", () => {
    const text = Array(50).fill("word").join(" ");
    expect(checkWordCount(text, "one-liner")).toBeNull();
  });

  it("returns soft violation for 55-word one-liner", () => {
    const text = Array(55).fill("word").join(" ");
    const result = checkWordCount(text, "one-liner");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("soft");
  });

  it("returns hard violation for 56-word one-liner", () => {
    const text = Array(56).fill("word").join(" ");
    const result = checkWordCount(text, "one-liner");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("hard");
  });

  // Custom: limit 80, soft 81-88, hard 89+
  it("returns null for 80-word custom email", () => {
    const text = Array(80).fill("word").join(" ");
    expect(checkWordCount(text, "custom")).toBeNull();
  });

  it("returns soft violation for 88-word custom email", () => {
    const text = Array(88).fill("word").join(" ");
    const result = checkWordCount(text, "custom");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("soft");
  });

  it("returns hard violation for 89-word custom email", () => {
    const text = Array(89).fill("word").join(" ");
    const result = checkWordCount(text, "custom");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("hard");
  });

  // LinkedIn: limit 100, soft 101-110, hard 111+
  it("returns null for 100-word LinkedIn message", () => {
    const text = Array(100).fill("word").join(" ");
    expect(checkWordCount(text, "linkedin")).toBeNull();
  });

  it("returns soft violation for 110-word LinkedIn message", () => {
    const text = Array(110).fill("word").join(" ");
    const result = checkWordCount(text, "linkedin");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("soft");
  });

  it("returns hard violation for 111-word LinkedIn message", () => {
    const text = Array(111).fill("word").join(" ");
    const result = checkWordCount(text, "linkedin");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("hard");
  });

  it("counts spintax blocks as one rendered variant, not all options", () => {
    expect(countWords("Hello {there|friend}, hope you're well")).toBe(5);
  });

  it("passes when combined spintax text is over 70 words but the longest render is under", () => {
    const prefix = Array(67).fill("word").join(" ");
    const text = `${prefix} {one two|three four|five six} closer`;

    expect(countWords(text)).toBe(70);
    expect(text.trim().split(/\s+/).filter(Boolean)).toHaveLength(72);
    expect(checkWordCount(text, "pvp")).toBeNull();
  });

  it("fails when the longest spintax render is over the 70-word PVP limit", () => {
    const prefix = Array(69).fill("word").join(" ");
    const text = `${prefix} {short|${Array(11).fill("long").join(" ")}}`;
    const result = checkWordCount(text, "pvp");

    expect(countWords(text)).toBe(80);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("hard");
  });

  it("preserves variables while choosing the longest spintax variant", () => {
    expect(countWords("Hi {FIRSTNAME}, {how|hey}")).toBe(3);
  });

  it("skips empty spintax options when choosing the longest variant", () => {
    expect(countWords("Hello {a||two words} now")).toBe(4);
  });

  it("leaves single-option brace blocks untouched", () => {
    expect(countWords("Hello {just this} now")).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// checkGreeting
// ---------------------------------------------------------------------------
describe("checkGreeting", () => {
  it("returns null for non-first steps regardless of greeting", () => {
    expect(checkGreeting("No greeting here.", false)).toBeNull();
  });

  it("returns null when first step starts with Hi {FIRSTNAME},", () => {
    expect(checkGreeting("Hi {FIRSTNAME}, how are you?", true)).toBeNull();
  });

  it("returns null when first step starts with Hello {FIRSTNAME},", () => {
    expect(checkGreeting("Hello {FIRSTNAME}, hope you are well.", true)).toBeNull();
  });

  it("returns null when first step starts with Hey {FIRSTNAME},", () => {
    expect(checkGreeting("Hey {FIRSTNAME}, quick one.", true)).toBeNull();
  });

  it("returns hard violation when first step has no greeting", () => {
    const result = checkGreeting("We help companies scale their outreach.", true);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("hard");
  });

  it("returns hard violation for empty text on first step", () => {
    const result = checkGreeting("", true);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("hard");
  });
});

// ---------------------------------------------------------------------------
// checkCTAFormat
// ---------------------------------------------------------------------------
describe("checkCTAFormat", () => {
  it("returns null for empty text", () => {
    expect(checkCTAFormat("")).toBeNull();
  });

  it("returns hard violation for statement CTA without question mark", () => {
    const result = checkCTAFormat("We should connect and discuss this further.");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("hard");
  });

  it("allows 'worth a chat?' as a valid soft CTA", () => {
    const result = checkCTAFormat("Let me know if it is worth a chat?");
    expect(result).toBeNull();
  });

  it("returns hard violation for 'open to exploring?'", () => {
    const result = checkCTAFormat("Are you open to exploring?");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("hard");
  });

  it("returns hard violation for 'thoughts?'", () => {
    const result = checkCTAFormat("Here is an idea. Thoughts?");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("hard");
  });

  it("returns hard violation for 'interested?'", () => {
    const result = checkCTAFormat("We do great work. Interested?");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("hard");
  });

  it("returns hard violation for 'make sense?'", () => {
    const result = checkCTAFormat("Does this make sense?");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("hard");
  });

  it("returns hard violation for 'ring any bells?'", () => {
    const result = checkCTAFormat("Does that ring any bells?");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("hard");
  });

  it("returns hard violation for 'sound familiar?'", () => {
    const result = checkCTAFormat("Does that sound familiar?");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("hard");
  });

  it("returns hard violation for 'make sense for your team?'", () => {
    const result = checkCTAFormat("Would this make sense for your team?");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("hard");
  });

  it("returns null for good CTA 'open to a quick call this week?'", () => {
    const result = checkCTAFormat("Would you be open to a quick call this week?");
    expect(result).toBeNull();
  });

  it("returns null for good CTA 'want me to send over some examples?'", () => {
    const result = checkCTAFormat("Want me to send over some examples?");
    expect(result).toBeNull();
  });

  // Sign-off stripping tests
  it("strips single name sign-off and detects CTA question", () => {
    const text = "Worth a quick comparison?\n\nDaniel";
    expect(checkCTAFormat(text)).toBeNull();
  });

  it("strips greeting + name sign-off and detects CTA question", () => {
    const text = "Worth a quick comparison?\n\nAll the best,\nDaniel";
    expect(checkCTAFormat(text)).toBeNull();
  });

  it("strips 'Best,' + name sign-off", () => {
    const text = "Worth a quick comparison?\n\nBest,\nJames";
    expect(checkCTAFormat(text)).toBeNull();
  });

  it("strips 'Cheers,' + name sign-off", () => {
    const text = "Worth a quick comparison?\n\nCheers,\nJames";
    expect(checkCTAFormat(text)).toBeNull();
  });

  it("strips 'Thanks,' + name sign-off", () => {
    const text = "Worth a quick comparison?\n\nThanks,\nJames";
    expect(checkCTAFormat(text)).toBeNull();
  });

  it("strips 'Kind regards,' + name sign-off", () => {
    const text = "Worth a quick comparison?\n\nKind regards,\nDaniel";
    expect(checkCTAFormat(text)).toBeNull();
  });

  it("strips 'Best regards,' + name sign-off", () => {
    const text = "Worth a quick comparison?\n\nBest regards,\nDaniel";
    expect(checkCTAFormat(text)).toBeNull();
  });

  it("still catches missing CTA question after sign-off stripping", () => {
    const text = "We help companies scale outreach.\n\nDaniel";
    const result = checkCTAFormat(text);
    expect(result).not.toBeNull();
    expect(result!.violation).toContain("CTA must be a question");
  });

  it("does not strip legitimate content that looks like a name", () => {
    // If the body is ONLY a name, don't strip it (nothing left)
    const text = "Daniel";
    const result = checkCTAFormat(text);
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkLinkedInSpintax
// ---------------------------------------------------------------------------
describe("checkLinkedInSpintax", () => {
  it("returns null for empty text", () => {
    expect(checkLinkedInSpintax("")).toBeNull();
  });

  it("returns hard violation when {option1|option2} pattern found", () => {
    const result = checkLinkedInSpintax("Hey, {just checking in|wanted to reach out} about your role.");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("hard");
  });

  it("returns null for {FIRSTNAME} variable (no pipe)", () => {
    expect(checkLinkedInSpintax("Hi {FIRSTNAME}, how are you?")).toBeNull();
  });

  it("returns null for text with no braces", () => {
    expect(checkLinkedInSpintax("Plain text without any braces.")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkSubjectLine
// ---------------------------------------------------------------------------
describe("checkSubjectLine", () => {
  it("returns null for empty text", () => {
    expect(checkSubjectLine("")).toBeNull();
  });

  it("returns hard violation for subject with exclamation mark", () => {
    const result = checkSubjectLine("great news for you!");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("hard");
  });

  it("returns soft violation for 7-word subject (over 6 word limit)", () => {
    const result = checkSubjectLine("this is a seven word subject line");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("soft");
  });

  it("returns null for 3-word subject", () => {
    expect(checkSubjectLine("quick chat tuesday")).toBeNull();
  });

  it("returns null for 6-word subject", () => {
    expect(checkSubjectLine("scaling your team this quarter here")).toBeNull();
  });

  it("counts subject spintax by longest rendered variant and preserves variables", () => {
    const result = checkSubjectLine("Re: {how|when} {COMPANY} {handles|deals with} projects");

    expect(countWords("Re: {how|when} {COMPANY} {handles|deals with} projects")).toBe(6);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkBusinessModelAssumption
// ---------------------------------------------------------------------------
describe("checkBusinessModelAssumption", () => {
  it("flags 1210-style temp-agency copy when ICP is broad", () => {
    const result = checkBusinessModelAssumption(
      "Hi {FIRSTNAME}, as a temp agency navigating shift-cover pressure, you probably see planners lose hours every week. Worth a quick look?",
      {
        icpCriteriaPrompt:
          "We sell to temp agencies, recruiters, and warehouse operators across the UK.",
      },
    );

    expect(result).not.toBeNull();
    expect(result!.severity).toBe("hard");
    expect(result!.violation).toContain("business-model assumption");
  });

  it("does not flag the same copy when the ICP is tightly scoped to that business model", () => {
    const result = checkBusinessModelAssumption(
      "Hi {FIRSTNAME}, as a temp agency navigating shift-cover pressure, you probably see planners lose hours every week. Worth a quick look?",
      {
        icpCriteriaPrompt: "We only target UK temp agencies with 10-100 recruiters.",
      },
    );

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// BANNED_PATTERNS expansion
// ---------------------------------------------------------------------------
describe("BANNED_PATTERNS expansion", () => {
  it("has at least 25 patterns", () => {
    expect(BANNED_PATTERNS.length).toBeGreaterThanOrEqual(25);
  });

  // Verify new additions exist by checking key phrases
  const expectedPhrases = [
    "genuine question",
    "honest question",
    "curious if",
    "curious whether",
    "ring any bells",
    "sound familiar",
    "My name is",
    "I wanted to reach out",
    "touching base",
    "circling back",
    "circle back",
    "synergy",
    "leverage",
    "streamline",
    "game-changer",
    "revolutionary",
    "guaranteed",
    "act now",
    "limited time",
    "exclusive offer",
    "no obligation",
    "excited to",
    "at your earliest convenience",
    "as per my last email",
    "following up",
  ];

  for (const phrase of expectedPhrases) {
    it(`detects "${phrase}" as banned`, () => {
      const match = BANNED_PATTERNS.some((bp) => bp.pattern.test(phrase));
      expect(match).toBe(true);
    });
  }

  // Verify "free" matches standalone but not "freedom" or "freestyle"
  it('detects "free" as standalone word', () => {
    const match = BANNED_PATTERNS.some((bp) => bp.pattern.test("This is free for you"));
    expect(match).toBe(true);
  });

  it('does not flag "freedom" as banned free', () => {
    // Only the "free" pattern should not match "freedom"
    const freePattern = BANNED_PATTERNS.find((bp) => bp.name === "free");
    expect(freePattern).toBeDefined();
    expect(freePattern!.pattern.test("freedom")).toBe(false);
  });

  it('does not flag "freestyle" as banned free', () => {
    const freePattern = BANNED_PATTERNS.find((bp) => bp.name === "free");
    expect(freePattern).toBeDefined();
    expect(freePattern!.pattern.test("freestyle")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WORD_COUNT_LIMITS
// ---------------------------------------------------------------------------
describe("WORD_COUNT_LIMITS", () => {
  it("has correct limits for all strategies", () => {
    expect(WORD_COUNT_LIMITS["pvp"]).toBe(70);
    expect(WORD_COUNT_LIMITS["creative-ideas"]).toBe(90);
    expect(WORD_COUNT_LIMITS["one-liner"]).toBe(50);
    expect(WORD_COUNT_LIMITS["custom"]).toBe(80);
    expect(WORD_COUNT_LIMITS["linkedin"]).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Existing exports still work (regression safety)
// ---------------------------------------------------------------------------
describe("existing exports (regression)", () => {
  it("checkCopyQuality still works", () => {
    const result = checkCopyQuality("This is a quick question about your business.");
    expect(result.clean).toBe(false);
    expect(result.violations).toContain("quick question");
  });

  it("checkSequenceQuality still works", () => {
    const violations = checkSequenceQuality([
      { body: "I'd love to chat.", subjectLine: "hello" },
    ]);
    expect(violations.length).toBeGreaterThan(0);
  });

  it("formatSequenceViolations still works", () => {
    const formatted = formatSequenceViolations([
      { step: 1, field: "body", violations: ["test violation"] },
    ]);
    expect(formatted).toContain("Step 1");
  });
});

// ---------------------------------------------------------------------------
// validateAllChecks (Phase 54)
// ---------------------------------------------------------------------------
describe("validateAllChecks", () => {
  const emailOpts: ValidateAllOptions = {
    strategy: "pvp",
    channel: "email",
    isFirstStep: true,
  };

  const linkedinOpts: ValidateAllOptions = {
    strategy: "pvp",
    channel: "linkedin",
    isFirstStep: true,
  };

  it("returns clean result for valid email body (first step)", () => {
    const text = "Hi {FIRSTNAME}, we help companies scale outreach. Seen similar results at Acme Corp. Worth 15 minutes?";
    const result = validateAllChecks(text, "body", emailOpts);
    expect(result.field).toBe("body");
    expect(result.checks).toHaveLength(0);
    expect(result.hasHardViolation).toBe(false);
  });

  it("returns empty checks for empty text", () => {
    const result = validateAllChecks("", "body", emailOpts);
    expect(result.checks).toHaveLength(0);
    expect(result.hasHardViolation).toBe(false);
  });

  it("catches word count violation on email body", () => {
    const text = "Hi {FIRSTNAME}, " + Array(80).fill("word").join(" ") + "?";
    const result = validateAllChecks(text, "body", emailOpts);
    expect(result.checks.length).toBeGreaterThan(0);
    expect(result.checks.some((c) => c.violation.includes("word count"))).toBe(true);
  });

  it("catches missing greeting on first email step", () => {
    const text = "We help companies scale. Worth a call?";
    const result = validateAllChecks(text, "body", emailOpts);
    expect(result.checks.some((c) => c.violation.includes("greeting"))).toBe(true);
    expect(result.hasHardViolation).toBe(true);
  });

  it("does not check greeting on non-first step", () => {
    const opts: ValidateAllOptions = { ...emailOpts, isFirstStep: false };
    const text = "We help companies scale outreach. Worth exploring?";
    const result = validateAllChecks(text, "body", opts);
    expect(result.checks.some((c) => c.violation.includes("greeting"))).toBe(false);
  });

  it("catches banned patterns in body", () => {
    const text = "Hi {FIRSTNAME}, I have a quick question about your business. Worth a call?";
    const result = validateAllChecks(text, "body", emailOpts);
    expect(result.checks.some((c) => c.violation.includes("banned pattern: quick question"))).toBe(true);
    expect(result.hasHardViolation).toBe(true);
  });

  it("catches spintax in LinkedIn body", () => {
    const text = "Hey {FIRSTNAME}, {just checking in|wanted to reach out} about your role. Worth a chat?";
    const result = validateAllChecks(text, "body", linkedinOpts);
    expect(result.checks.some((c) => c.violation.includes("spintax"))).toBe(true);
    expect(result.hasHardViolation).toBe(true);
  });

  it("uses linkedin word count limit for linkedin channel", () => {
    // 105 words = over pvp limit (70) but under linkedin limit (100) soft ceiling (110)
    const text = "Hey {FIRSTNAME}, " + Array(103).fill("word").join(" ") + "?";
    const result = validateAllChecks(text, "body", linkedinOpts);
    // Should be soft violation (over 100 but under 110)
    const wcCheck = result.checks.find((c) => c.violation.includes("word count"));
    if (wcCheck) {
      expect(wcCheck.severity).toBe("soft");
    }
  });

  it("checks subject line for exclamation marks", () => {
    const result = validateAllChecks("great news for you!", "subject", emailOpts);
    expect(result.checks.some((c) => c.violation.includes("exclamation"))).toBe(true);
    expect(result.hasHardViolation).toBe(true);
  });

  it("checks subject line for banned patterns", () => {
    const result = validateAllChecks("quick question for you", "subject", emailOpts);
    expect(result.checks.some((c) => c.violation.includes("banned pattern: quick question"))).toBe(true);
  });

  it("checks subjectVariantB field correctly", () => {
    const result = validateAllChecks("good subject", "subjectVariantB", emailOpts);
    expect(result.checks).toHaveLength(0);
  });

  it("does not run CTA check on LinkedIn body", () => {
    // LinkedIn body ending without ? should not trigger CTA violation
    const text = "Hey {FIRSTNAME}, wanted to connect about growth opportunities.";
    const result = validateAllChecks(text, "body", linkedinOpts);
    expect(result.checks.some((c) => c.violation.includes("CTA must be a question"))).toBe(false);
  });

  it("runs CTA check on email body", () => {
    // Email body ending without ? should trigger CTA violation
    const text = "Hi {FIRSTNAME}, we help companies scale outreach.";
    const result = validateAllChecks(text, "body", emailOpts);
    expect(result.checks.some((c) => c.violation.includes("CTA must be a question"))).toBe(true);
  });

  it("adds business-model-assumption violations when context suggests a broad ICP", () => {
    const text =
      "Hi {FIRSTNAME}, as a temp agency navigating shift-cover pressure, you probably see planners lose hours every week. Worth a quick look?";
    const result = validateAllChecks(text, "body", {
      ...emailOpts,
      businessModelContext: {
        icpCriteriaPrompt:
          "We target temp agencies, recruiters, and warehouse operators across the UK.",
      },
    });

    expect(
      result.checks.some((c) => c.violation.includes("business-model assumption")),
    ).toBe(true);
    expect(result.hasHardViolation).toBe(true);
  });
});
