# Phase 52: Copy Quality Module + Model Upgrade - Research

**Researched:** 2026-03-30
**Domain:** TypeScript utility module extension + AI agent model configuration
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Validation Tiering**
- Hard-block (must fix before save): banned phrases, wrong variable format (double braces or lowercase), missing greeting on step 1 email, spintax in LinkedIn messages, statement CTAs (no question mark), vague/AI-cliche CTAs
- Soft-block (save with review flag, admin sees in approval flow): word count within 10% grace of limit, filler spintax (semantically valid but low-quality), subject line slightly over 6 words
- Both outbound sequences AND reply suggestions are validated — replies skip spintax checks (replies don't use spintax)

**CTA Quality Rules**
- CTA must be a question (ends with ?)
- CTA must suggest a concrete next step (not just "thoughts?" or "interested?")
- CTA must sound human — not AI-cliche output
- Banned CTA phrases (hard-block): "worth a chat?", "open to exploring?", "ring any bells?", "sound familiar?", "thoughts?", "interested?", "make sense?", "make sense for your team?"
- Pass examples: "open to a quick call this week?", "want me to send over some examples?", "shall I put something together?"
- Fail examples: "worth a chat?" (AI cliche), "thoughts?" (no action), "interested?" (lazy), "make sense for your team?" (no action)

**Word Count Thresholds (per strategy)**
- PVP: 70 words max
- Creative Ideas: 90 words max
- One-liner: 50 words max
- Custom: 80 words max
- LinkedIn messages: 100 words max
- 10% grace period: up to 10% over = soft-block (warning). Over 10% = hard-block.
- Same limit applies to ALL steps in a sequence (follow-ups are not shorter)

**Rules Consolidation**
- copy-quality.ts is the single source of truth for all enforceable rules
- writer-rules.md references copy-quality.ts but does not duplicate rule definitions
- All ~25+ banned phrases from writer-rules.md consolidated into copy-quality.ts
- Existing 13 banned patterns expanded to full set

**Model Upgrade**
- Scope: CLI skills only — API fallback agents and Trigger.dev tasks stay as-is
- All Nova agents on Opus 4.6: orchestrator + all 7 specialists (writer, leads, campaign, research, deliverability, intelligence, onboarding)
- All GSD agents on Opus 4.6: planner, executor, researcher, verifier, checker
- Single config variable: one place to change model for all Nova skill files (e.g. in .claude config or env var). Not hardcoded per skill file.
- Model ID: `claude-opus-4-6`

### Claude's Discretion
- Exact implementation of CTA quality detection (regex vs pattern matching vs keyword check)
- How the single model config variable is exposed to skill files (env var, .claude config, or shared constant)
- Internal structure of the expanded banned phrases list (flat array vs categorized)
- How soft-block review flags are attached to saved drafts/sequences

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| COPY-01 | Extended copy-quality.ts — full rule set (word count tiered by strategy, all banned phrases, greeting check, CTA softness, variable format, subject line rules) | Existing file at `src/lib/copy-quality.ts` has 13 patterns; needs expansion to ~25+ banned phrases plus new check functions. Architecture patterns below cover all new checks. |
| CROSS-01 | All agents use Opus 4.6 (best available model) — no cost-optimised model downgrades since Max Plan covers all usage | Nova agent files (writer.ts, orchestrator.ts, leads.ts, campaign.ts, research.ts) hardcode model strings. GSD MODEL_PROFILES controls GSD agents. Single constant pattern documented below. |
</phase_requirements>

---

## Summary

Phase 52 is entirely self-contained within the project — no new external libraries are needed. The work splits into two independent tracks: (1) expanding `src/lib/copy-quality.ts` with new check functions and the full banned phrases list, and (2) upgrading model identifiers across Nova skill files and GSD agent configuration.

The existing `copy-quality.ts` is 112 lines with 13 `BANNED_PATTERNS`, two exported check functions (`checkCopyQuality`, `checkSequenceQuality`), and one formatter. It already integrates into `writer.ts` (saveDraft + saveSequence tools) and `portal/campaigns/[id]/approve-content/route.ts`. The expansion pattern is clear: add new exported functions alongside the existing ones. No breaking changes to existing callers — the new functions are additive.

The model upgrade affects five Nova agent TypeScript files plus the GSD MODEL_PROFILES in `.claude/get-shit-done/bin/lib/core.cjs`. The CONTEXT.md decision is a single shared constant, not per-file hardcoding. The cleanest implementation is a `NOVA_MODEL` constant at the top of `types.ts` (already imported by all agent files) — change one line, all agents update.

**Primary recommendation:** Extend `copy-quality.ts` with five new exported functions (checkWordCount, checkGreeting, checkCTAFormat, checkLinkedInSpintax, checkSubjectLine) and a single `NOVA_MODEL` constant in `types.ts` shared by all Nova agent configs.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ^5 (project standard) | Type-safe utility module | Already in use — no new dep |
| Vitest | ^4.0.18 (installed) | Unit test framework | Already configured — `vitest run` works |
| Zod | Already in use | Schema validation in agents | Already used in `types.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None required | — | No new dependencies needed | This phase is pure TypeScript extension |

**Installation:**
No new packages needed. All required libraries are already present.

---

## Architecture Patterns

### Existing File Structure
```
src/lib/
├── copy-quality.ts          # EXTEND THIS — single source of truth
└── agents/
    ├── types.ts             # ADD NOVA_MODEL constant here
    ├── writer.ts            # Already imports copy-quality.ts
    ├── orchestrator.ts      # Update model string
    ├── leads.ts             # Update model string
    ├── campaign.ts          # Update model string (two occurrences)
    └── research.ts          # Update model string
.claude/
└── get-shit-done/bin/lib/
    └── core.cjs             # Update MODEL_PROFILES for GSD agents
```

### Pattern 1: Additive Function Exports in copy-quality.ts

**What:** Add new exported functions alongside existing ones. Do not change existing function signatures — callers in writer.ts and approve-content/route.ts must not break.

**When to use:** Always. This file is the canonical source — functions are exported and consumed by writer agent and portal route.

**Example structure:**
```typescript
// EXISTING — do not modify
export const BANNED_PATTERNS: BannedPattern[] = [ ... ];
export function checkCopyQuality(text: string): CopyQualityResult { ... }
export function checkSequenceQuality(sequence): SequenceStepViolation[] { ... }
export function formatSequenceViolations(violations): string { ... }

// NEW — add below existing exports
export type CopyStrategy = "pvp" | "creative-ideas" | "one-liner" | "custom" | "linkedin";

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

export function checkWordCount(text: string, strategy: CopyStrategy): CheckResult | null { ... }
export function checkGreeting(text: string, isFirstStep: boolean): CheckResult | null { ... }
export function checkCTAFormat(text: string): CheckResult | null { ... }
export function checkLinkedInSpintax(text: string): CheckResult | null { ... }
export function checkSubjectLine(text: string): CheckResult | null { ... }
```

### Pattern 2: Severity-Tiered Return Type

**What:** New check functions return `CheckResult | null` where `null` = clean, `CheckResult` carries `severity: "hard" | "soft"` and `violation: string`. This enables callers to distinguish hard-blocks from soft-blocks.

**When to use:** All new check functions. The existing `checkCopyQuality` returns `CopyQualityResult` (all violations are treated as equal) — new functions use the tiered pattern.

**Key distinction:**
- `severity: "hard"` — caller MUST block save
- `severity: "soft"` — caller MAY save with review flag attached

### Pattern 3: Single NOVA_MODEL Constant in types.ts

**What:** Define a single exported constant `NOVA_MODEL` in `types.ts`. All agent config objects reference this constant.

**Why types.ts:** Already imported by every agent file (`import type { AgentConfig, ... } from "./types"`). One change propagates everywhere.

**Example:**
```typescript
// In types.ts — add at top after imports
export const NOVA_MODEL = "claude-opus-4-6" as const;

// In AgentConfig.model type — expand to include new ID
export interface AgentConfig {
  name: string;
  model:
    | "claude-opus-4-6"       // ADD
    | "claude-opus-4-20250514"
    | "claude-sonnet-4-20250514"
    | "claude-haiku-4-5-20251001";
  ...
}

// In writer.ts, orchestrator.ts, leads.ts, research.ts — replace hardcoded string:
import { NOVA_MODEL } from "./types";
const config: AgentConfig = {
  model: NOVA_MODEL,
  ...
};
```

**campaign.ts note:** Has two model references — one using Vercel AI SDK `anthropic("claude-haiku-4-5")` pattern (line 46) and one string (line 416). The string reference (line 416) is the AgentConfig — update to `NOVA_MODEL`. The `anthropic()` call on line 46 is a different usage context — verify if this is also in scope per CONTEXT.md "CLI skills only".

### Pattern 4: GSD MODEL_PROFILES Update

**What:** The `.claude/get-shit-done/bin/lib/core.cjs` file defines `MODEL_PROFILES` mapping GSD agent names to quality/balanced/budget model tiers. The `quality` tier maps to `'opus'` which resolves to `'inherit'` (meaning the spawning model's version). This already works for Opus 4.6 since `inherit` uses whatever Claude Code is running.

**Key finding:** GSD agents (planner, executor, researcher, verifier, checker) use `'inherit'` when `quality` tier is selected — they automatically get Opus 4.6 when the user's Claude Code session is Opus 4.6. No change needed to core.cjs unless the model profile is 'balanced' or 'budget'.

**Check config.json:** Current `model_profile: "balanced"` means GSD agents get `'sonnet'` not `'opus'`. To enforce Opus 4.6 for GSD agents, change `model_profile` to `"quality"` in `.planning/config.json` OR update the balanced tier in MODEL_PROFILES to point to opus.

### Anti-Patterns to Avoid
- **Modifying existing function signatures:** `checkCopyQuality` and `checkSequenceQuality` are called by both `writer.ts` and `approve-content/route.ts` — breaking changes would cascade
- **Duplicating banned phrases:** The new expanded list in `copy-quality.ts` IS the source. Do not keep separate lists in `writer-rules.md`
- **Hardcoding `claude-opus-4-6` per file:** The whole point of CROSS-01 is single-point change — use the `NOVA_MODEL` constant
- **Adding Trigger.dev model changes:** CONTEXT.md explicitly scopes this to CLI skill agents only

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Word counting | Custom tokenizer | `text.split(/\s+/).filter(Boolean).length` | Standard JS word count — sufficient for prose email copy |
| Spintax detection | Complex parser | Regex `/\{[^{}]+\|[^{}]+\}/` | Only need to detect presence, not parse content |
| CTA question detection | NLP classifier | `text.trimEnd().endsWith('?')` | Deterministic rule, not semantic — question mark check is sufficient |

**Key insight:** All checks in this phase are deterministic string rules — no ML, no external services, no new libraries. Pure TypeScript string operations.

---

## Common Pitfalls

### Pitfall 1: Word Count Grace Period Off-By-One
**What goes wrong:** 10% grace period calculation produces wrong threshold — e.g. PVP limit is 70, 10% of 70 is 7, so 77 words is the hard-block threshold. But is 77 a soft-block or hard-block?
**Why it happens:** Ambiguity in "up to 10% over = soft-block, over 10% = hard-block"
**How to avoid:** Clarify: `wordCount > limit` AND `wordCount <= Math.floor(limit * 1.1)` = soft-block; `wordCount > Math.floor(limit * 1.1)` = hard-block. This means PVP: 71-77 = soft, 78+ = hard.
**Warning signs:** Test cases at boundary (70, 71, 77, 78) to verify correct tier.

### Pitfall 2: Greeting Check False Positives on Follow-Ups
**What goes wrong:** `checkGreeting` flags a follow-up step (position 2+) for missing greeting when only step 1 requires one.
**Why it happens:** The function doesn't know step position.
**How to avoid:** `checkGreeting(text: string, isFirstStep: boolean)` — only returns a violation when `isFirstStep === true`. Callers must pass position context.

### Pitfall 3: Spintax Regex Matching Variable Format
**What goes wrong:** LinkedIn spintax check `/\{[^{}]+\|[^{}]+\}/` matches `{FIRSTNAME|LASTNAME}` which is not spintax — it's a broken variable.
**Why it happens:** The spintax pattern `{option1|option2}` and variables both use `{}`. Variables use UPPERCASE with no pipe — but a malformed variable like `{FIRST|LAST}` would falsely trigger spintax detection.
**How to avoid:** The variable check `\{[A-Z]+\}` already catches malformed variables as a separate rule. Spintax regex should check for pipe character: `/\{[^{}|]+\|[^{}]+\}/` — if there's a pipe, it's spintax. This correctly distinguishes `{FIRSTNAME}` (no pipe, variable) from `{first|second}` (pipe, spintax).

### Pitfall 4: CTA Banned Phrase List vs CTA Format Check
**What goes wrong:** Treating banned CTA phrases (e.g. "worth a chat?") as part of `BANNED_PATTERNS` instead of `checkCTAFormat` — this causes them to be flagged in ALL text, not just when they appear as a CTA.
**Why it happens:** `BANNED_PATTERNS` scans full text. "worth a chat?" might legitimately appear in a body paragraph differently.
**How to avoid:** Banned CTA phrases belong in `checkCTAFormat`, not `BANNED_PATTERNS`. The CTA is typically the last sentence of the email body — the check should focus on the last 1-2 sentences. Alternatively, scan the full body for these exact AI-cliche patterns since they are categorically banned anywhere.

### Pitfall 5: campaign.ts Has Two Model References
**What goes wrong:** Updating only the `AgentConfig` model string on line 416 but missing the `anthropic("claude-haiku-4-5")` call on line 46.
**Why it happens:** campaign.ts uses two different patterns — the AgentConfig (for runAgent) and a direct anthropic() call for a different operation.
**How to avoid:** Read both usages in context. The `anthropic()` call on line 46 may be for a streaming/non-runAgent usage — check if it's in scope for CLI skills upgrade.

### Pitfall 6: TypeScript model union type not updated
**What goes wrong:** Adding `"claude-opus-4-6"` to agent config files but not to the `AgentConfig.model` union type in `types.ts` — TypeScript compiler rejects the value.
**Why it happens:** The union type on line 8-11 of types.ts must list every valid model ID.
**How to avoid:** Update both the union type and the `NOVA_MODEL` constant in the same commit.

---

## Code Examples

### checkWordCount — Tiered Threshold
```typescript
// Deterministic word count check with 10% grace period
export function checkWordCount(text: string, strategy: CopyStrategy): CheckResult | null {
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
```

### checkGreeting — First Step Only
```typescript
// Greeting required on step 1 emails. LinkedIn: "Hey {FIRSTNAME}," or "Hi {FIRSTNAME},"
export function checkGreeting(text: string, isFirstStep: boolean): CheckResult | null {
  if (!isFirstStep) return null;
  if (!text) return { severity: "hard", violation: "missing greeting on first step" };
  // Acceptable: "Hi {FIRSTNAME},", "Hello {FIRSTNAME},", "Hey {FIRSTNAME},"
  const hasGreeting = /^(Hi|Hello|Hey)\s+\{[A-Z]+\}/i.test(text.trimStart());
  if (!hasGreeting) {
    return { severity: "hard", violation: "first step must begin with a greeting (Hi/Hello/Hey {FIRSTNAME},)" };
  }
  return null;
}
```

### checkLinkedInSpintax — Detect Spintax Patterns
```typescript
// LinkedIn messages must never contain spintax
export function checkLinkedInSpintax(text: string): CheckResult | null {
  if (!text) return null;
  // Spintax pattern: {option1|option2} — pipe character inside braces
  const hasSpintax = /\{[^{}|]+\|[^{}]+\}/.test(text);
  if (hasSpintax) {
    return { severity: "hard", violation: "spintax found in LinkedIn copy — LinkedIn is 1-to-1, pick one option" };
  }
  return null;
}
```

### checkCTAFormat — Statement vs Question
```typescript
// CTA must be a question (end with ?). Scan last 2 sentences of body.
// Also checks for banned AI-cliche CTA patterns.
const BANNED_CTA_PATTERNS = [
  /worth a chat\?/i,
  /open to exploring\?/i,
  /ring any bells\?/i,
  /sound familiar\?/i,
  /\bthoughts\?/i,
  /\binterested\?/i,
  /make sense\?/i,
  /make sense for your team\?/i,
];

export function checkCTAFormat(text: string): CheckResult | null {
  if (!text) return null;
  const sentences = text.trim().split(/(?<=[.!?])\s+/);
  const lastTwo = sentences.slice(-2).join(" ");

  // Check for banned AI-cliche CTAs (hard-block)
  for (const pattern of BANNED_CTA_PATTERNS) {
    if (pattern.test(lastTwo)) {
      return { severity: "hard", violation: `AI-cliche CTA detected: "${lastTwo.match(pattern)?.[0]}" — rewrite with a specific, human-sounding question` };
    }
  }

  // Check that CTA is a question (ends with ?)
  const trimmed = text.trimEnd();
  if (!trimmed.endsWith("?")) {
    return { severity: "hard", violation: "CTA must be a question ending with ?" };
  }
  return null;
}
```

### NOVA_MODEL Constant Pattern
```typescript
// In types.ts — single source of truth for Nova agent model
export const NOVA_MODEL = "claude-opus-4-6" as const;

// In AgentConfig interface — add to union:
export interface AgentConfig {
  name: string;
  model:
    | "claude-opus-4-6"          // v8.0 standard (CROSS-01)
    | "claude-opus-4-20250514"
    | "claude-sonnet-4-20250514"
    | "claude-haiku-4-5-20251001";
  ...
}

// In each agent file — replace hardcoded string:
import { NOVA_MODEL, type AgentConfig } from "./types";
const config: AgentConfig = {
  model: NOVA_MODEL,
  ...
};
```

### GSD config.json Model Profile Change
```json
// .planning/config.json — change model_profile from "balanced" to "quality"
// This causes GSD agents to use "inherit" tier = Opus 4.6 in current session
{
  "model_profile": "quality"
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 13 BANNED_PATTERNS, flat structure | 25+ patterns + dedicated check functions per rule type | Phase 52 | Single source of truth — downstream gates (writer, portal) use same rules |
| Hardcoded model strings per agent | `NOVA_MODEL` constant in types.ts | Phase 52 | One-line change to upgrade all agents |
| No word count enforcement | Tiered soft/hard blocks by strategy | Phase 52 | PVP can no longer drift to 100 words |

---

## Open Questions

1. **campaign.ts `anthropic("claude-haiku-4-5")` on line 46**
   - What we know: line 416 is an AgentConfig model string (in scope). Line 46 uses `anthropic()` directly — likely a streaming or vercel AI SDK call for a different operation.
   - What's unclear: Is this usage in scope for CROSS-01 ("CLI skills only")? The CONTEXT.md says campaign agent is included. Needs code inspection at line 46 context.
   - Recommendation: Executor should read the full context of line 46 before deciding. If it's part of campaign agent CLI operation, update it.

2. **GSD `model_profile` change scope**
   - What we know: `model_profile: "balanced"` currently means GSD agents get Sonnet. CONTEXT.md says GSD agents should all be on Opus 4.6.
   - What's unclear: Should the planner change `config.json` or update `MODEL_PROFILES` in `core.cjs`?
   - Recommendation: Change `model_profile` to `"quality"` in `config.json` — this is per-project config that controls GSD agents for THIS project. More surgical than editing `core.cjs` globally.

3. **Soft-block flag storage for saved drafts**
   - What we know: CONTEXT.md says soft-block means "save with review flag, admin sees in approval flow". The existing `EmailDraft` and campaign sequence models exist in Prisma.
   - What's unclear: Is there a `reviewFlag` or `qualityWarnings` field on the Prisma `EmailDraft` model?
   - Recommendation: This is Phase 52 scope only for the CHECK functions — the actual soft-block save behaviour is Phase 54 (COPY-02 writer self-review gate). Phase 52 just defines the `CheckResult { severity }` return type. Executor should NOT add DB schema changes in this phase.

---

## Validation Architecture

> nyquist_validation not in config.json — section skipped per instructions (field absent = false).

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection — `src/lib/copy-quality.ts` (verified 112 lines, 13 patterns, exact integration points)
- Direct codebase inspection — `src/lib/agents/types.ts` (verified AgentConfig model union, all agent model strings)
- Direct codebase inspection — `src/lib/agents/writer.ts` (verified existing copy-quality integration at lines 233, 310)
- Direct codebase inspection — `src/app/api/portal/campaigns/[id]/approve-content/route.ts` (verified checkSequenceQuality usage)
- Direct codebase inspection — `.claude/get-shit-done/bin/lib/core.cjs` (verified MODEL_PROFILES, 'quality' tier resolves to 'inherit')
- Direct codebase inspection — `.planning/config.json` (verified `model_profile: "balanced"`)
- `.planning/phases/52-copy-quality-module-model-upgrade/52-CONTEXT.md` — locked decisions

### Secondary (MEDIUM confidence)
- `.claude/rules/writer-rules.md` — confirmed full banned phrases list (26 phrases) and rule structure

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries, all inspection-based
- Architecture: HIGH — exact file locations, line numbers, function signatures verified from codebase
- Pitfalls: HIGH — derived from actual code inspection and explicit rule analysis from CONTEXT.md

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable codebase, no fast-moving external deps)
