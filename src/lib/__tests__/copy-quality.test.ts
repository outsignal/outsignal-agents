import { describe, it, expect } from "vitest";
import {
  checkWordCount,
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
  checkSequenceQuality,
  formatSequenceViolations,
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

  it("returns hard violation for 'worth a chat?'", () => {
    const result = checkCTAFormat("Let me know if it is worth a chat?");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("hard");
    expect(result!.violation).toContain("AI-cliche");
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
