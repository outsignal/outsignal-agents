# Phase 55: Validator Agent - Research

**Researched:** 2026-03-30
**Domain:** LLM-as-semantic-quality-gate for cold outreach copy
**Confidence:** HIGH

## Summary

Phase 55 builds a stateless validator agent that reviews completed email/LinkedIn sequences for semantic quality issues that structural checks (copy-quality.ts) cannot catch. The validator is invoked via a Claude Code CLI skill after the writer's self-review loop (Phase 54) and before copy is confirmed saved. It operates as the third and final quality gate: (1) writer per-step self-review, (2) writer cross-step dedup, (3) validator semantic + structural re-check.

The implementation creates four artifacts: a Zod-typed ValidationResult schema in types.ts, a `.claude/skills/validator.md` skill file containing the validation prompt, a `.claude/rules/validator-rules.md` rules file defining what to check and severity mapping, and a `scripts/cli/validate-sequence.js` wrapper script that accepts sequence JSON + workspace context, invokes the validator skill via Claude Code CLI, parses the result, and returns structured output. The writer agent (from Phase 54) calls this wrapper after generating and self-validating copy, before confirming the save.

**Primary recommendation:** Build the validator as a Claude Code CLI skill with a thin wrapper script. The skill receives the full sequence + workspace context as a single prompt, returns a ValidationResult JSON. The wrapper handles serialization and parsing. Integration into the writer flow uses a new `validateSequence` tool in writer.ts that calls the wrapper via `cliSpawn()`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Semantic + structural re-check** -- validator re-runs copy-quality.ts structural checks as a safety net AND performs semantic analysis that only an LLM can assess
- **All four semantic checks enforced**: (1) Filler spintax detection, (2) Tonal mismatch, (3) Angle repetition across steps, (4) AI-sounding patterns
- **Checklist + open section** -- fixed checklist for the four semantic checks, plus "general observations" for anything else the LLM spots
- **Balanced strictness** -- flag clear issues, let borderline cases through. Avoid alert fatigue.
- **Structured Zod schema + human-readable summary** -- typed ValidationResult JSON for programmatic use, plus summary paragraph for admin readability
- **Hard / Soft severity** matching copy-quality.ts -- consistent language across the whole pipeline
- **Describe problem + suggest fix** -- each finding includes what's wrong AND a concrete suggestion
- **Runs after every save** -- no API cost on Max Plan, so validator always runs for maximum quality
- **Writer auto-rewrites** on hard findings -- validator feedback fed back to writer for one rewrite attempt. If still failing, save with review notes.
- **1 validator-triggered rewrite max** -- combined with writer's 2 self-review retries, this is attempt #4 total
- **Both per-step and full sequence review** -- first pass per-step, then full sequence as a unit
- **New Claude Code skill file** -- dedicated .claude/skills/validator.md
- **Wrapper script for invocation** -- new validate-sequence.js wrapper
- **Full workspace context provided** -- validator receives sequence + workspace context (ICP, tone prompt, strategy)
- **Dedicated rules file** -- .claude/rules/validator-rules.md

### Claude's Discretion
- Exact Zod schema design for ValidationResult (field names, nesting)
- How the wrapper script serializes sequence + context for the skill
- Internal structure of the validator checklist prompt
- How "general observations" are weighted vs checklist findings

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| COPY-07 | Validator agent (Opus 4.6 via Claude Code CLI) reviews copy after writer self-review -- catches semantic issues (filler spintax, tonal mismatch, angle repetition) | All research findings below directly enable this: Zod schema design, skill file architecture, wrapper script pattern, writer integration via validateSequence tool |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | v4 (already in project) | ValidationResult schema | Already used for all agent output schemas in types.ts |
| Claude Code CLI | Latest | Invoke validator skill with Opus 4.6 | Project pattern for agent invocation (CROSS-01) |
| child_process (spawn) | Node built-in | Wrapper script to call Claude Code | Already used via cliSpawn() pattern in cli-spawn.ts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| copy-quality.ts | Internal module | Structural re-check inside validator | Validator re-runs structural checks as safety net |
| load-rules.ts | Internal module | Load validator-rules.md into system prompt | If validator is also invoked via API runner (not just CLI) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Claude Code CLI skill | runAgent() via API | CLI keeps validator fully stateless and isolated. API would couple it to the runner.ts audit infrastructure. CLI is the locked decision. |
| Wrapper shell script | Node.js wrapper | Node wrapper allows Zod parsing and structured error handling. Shell would need jq or similar. |

## Architecture Patterns

### Recommended Project Structure
```
.claude/
  rules/
    validator-rules.md      # What to check, severity mapping, review philosophy
  skills/
    validator.md            # Claude Code skill file (the prompt + tool definition)
scripts/
  cli/
    validate-sequence.ts    # Wrapper: serialize input, call claude CLI, parse output
src/
  lib/
    agents/
      writer.ts             # Enhanced: new validateSequence tool calling the wrapper
    agents/
      types.ts              # New: ValidationResult, ValidationFinding Zod schemas
    copy-quality.ts          # Existing: structural checks re-used by validator
```

### Pattern 1: Claude Code CLI Skill Invocation
**What:** The validator is a Claude Code skill file (.claude/skills/validator.md) that defines the validation prompt and expected output format. A Node.js wrapper script serializes the sequence + workspace context into a prompt, invokes `claude` CLI with the skill, and parses the JSON output.
**When to use:** When you need full LLM reasoning (Opus 4.6) for a stateless review task.
**How it works:**
```
Writer generates copy
  -> Writer self-validates (Phase 54 validateCopy tool)
  -> Writer calls validateSequence tool
    -> Tool calls cliSpawn("validate-sequence.js", [--file /tmp/{uuid}.json])
      -> Wrapper reads JSON file with sequence + workspace context
      -> Wrapper invokes: claude --skill validator --message "{serialized prompt}"
      -> Claude Code loads validator.md skill + validator-rules.md rules
      -> Returns ValidationResult JSON
    -> Tool parses result
  -> If hard findings: writer rewrites once, re-validates
  -> If clean or only soft: proceeds to save
```

### Pattern 2: ValidationResult Zod Schema Design
**What:** A structured result type that matches the hard/soft severity model from copy-quality.ts.
**Design:**
```typescript
// In src/lib/agents/types.ts

export interface ValidationFinding {
  check: string;           // "filler_spintax" | "tonal_mismatch" | "angle_repetition" | "ai_patterns" | "structural" | "general"
  severity: "hard" | "soft";
  step?: number;           // null for sequence-level findings
  field?: string;          // "body" | "subject" | "subjectVariantB"
  problem: string;         // What's wrong
  suggestion: string;      // How to fix it
}

export interface ValidationResult {
  passed: boolean;            // true if zero hard findings
  findings: ValidationFinding[];
  summary: string;            // Human-readable paragraph
  checklist: {
    fillerSpintax: "pass" | "fail" | "warn";
    tonalMismatch: "pass" | "fail" | "warn";
    angleRepetition: "pass" | "fail" | "warn";
    aiPatterns: "pass" | "fail" | "warn";
  };
}
```

Severity mapping:
- **Hard** = must fix before save: filler spintax (clear cases), structural violations caught on re-check, tone grossly mismatched with outreachTonePrompt
- **Soft** = save with flag: borderline AI patterns, slight angle overlap, minor tonal inconsistency, general observations

### Pattern 3: Writer Integration Flow
**What:** The writer calls validateSequence after its own self-review (validateCopy) passes, but before final save.
**Sequence:**
1. Writer generates copy
2. Writer calls `validateCopy` (Phase 54 structural checks) -- max 2 retries
3. Writer calls `validateSequence` (Phase 55 semantic + structural re-check)
4. If hard findings: writer rewrites affected steps, calls `validateSequence` again (1 retry max)
5. If still hard findings: save with `[REVIEW NEEDED]` notes (same escalation pattern as Phase 54)
6. If clean or only soft findings: save normally, include soft findings in notes

### Anti-Patterns to Avoid
- **Over-strict validator causing alert fatigue:** The validator must let borderline cases through. If it flags 5+ issues on every sequence, writers will start ignoring it. The "balanced strictness" decision is critical.
- **Validator duplicating structural checks without value:** The structural re-check is a safety net, not the primary purpose. If structural checks pass in Phase 54, the validator should focus on semantic analysis. Don't bloat the output with structural findings that already passed.
- **Circular rewrite loops:** The 1-rewrite limit is absolute. If the validator triggers a rewrite, the rewritten version goes through ONE more validation. If it still fails, save with notes. Never loop.
- **Overly verbose prompts:** The validator skill prompt should be focused. It receives the full sequence and context -- the prompt should be the checklist + guidance, not a full copy of writer-rules.md. Reference rules by principle, not by copying 260 lines of writer rules.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Structural copy validation | New structural checks in validator | Re-run existing copy-quality.ts functions | Already tested (77 tests), consistent severity model |
| JSON schema validation | Manual JSON parsing | Zod v4 safeParse | Already used for all agent output schemas |
| CLI process management | Raw child_process | cliSpawn() from cli-spawn.ts | Handles timeout, JSON envelope parsing, error handling |
| Severity classification | Custom severity system | Existing "hard"/"soft" from CheckResult | Consistency across the pipeline (copy-quality + validator) |

**Key insight:** The validator's value is the SEMANTIC analysis -- LLM judgment on tone, angle repetition, AI-sounding patterns. Everything structural already exists. Don't rebuild it.

## Common Pitfalls

### Pitfall 1: Claude Code CLI Output Parsing
**What goes wrong:** The Claude Code CLI may return output in various formats (markdown, JSON in code blocks, plain text) depending on the prompt. Inconsistent parsing causes the wrapper to fail.
**Why it happens:** LLMs don't always follow output format instructions precisely, especially for complex structured output.
**How to avoid:** The wrapper script must handle multiple output formats: (1) raw JSON, (2) JSON in ```json code blocks, (3) JSON embedded in explanatory text. Use the same extraction pattern as runner.ts: try raw JSON parse first, then regex for code blocks.
**Warning signs:** ValidationResult parsing failures in production -- add a fallback that returns a "validation inconclusive" result rather than crashing.

### Pitfall 2: Prompt Size Explosion
**What goes wrong:** Sending the full sequence (3+ steps x subject + body) plus full workspace context (ICP, tone, case studies, website analysis) creates a massive prompt that may hit context limits or degrade quality.
**Why it happens:** Workspace intelligence can be very large (website analysis, multiple case studies, detailed ICP).
**How to avoid:** Serialize only what the validator needs: (1) the sequence steps themselves, (2) outreachTonePrompt (not full tone analysis), (3) workspace vertical and ICP summary (not full ICP fields), (4) the copy strategy used. Exclude website analysis, campaign performance, and enrichment data.
**Warning signs:** Slow validator responses (>30s) or degraded quality on long sequences.

### Pitfall 3: False Positives on "AI-Sounding Patterns"
**What goes wrong:** The validator flags perfectly good copy as "AI-sounding" because the check is intentionally broad. This creates alert fatigue and undermines trust in the validator.
**Why it happens:** "AI-sounding" is subjective. Different reviewers have different thresholds.
**How to avoid:** The validator-rules.md must provide concrete examples of what IS and ISN'T AI-sounding. Give 3-4 positive examples (natural copy that passes) and 3-4 negative examples (AI-sounding copy that should be flagged). Use "soft" severity for borderline cases.
**Warning signs:** Validator flagging AI patterns on >30% of sequences -- recalibrate the prompt.

### Pitfall 4: Wrapper Script File I/O Race Conditions
**What goes wrong:** Multiple concurrent validator invocations write to the same temp file path, causing data corruption.
**Why it happens:** Using predictable temp file paths without UUID.
**How to avoid:** Always use UUID-based temp file paths (`/tmp/{uuid}.json`). The wrapper should generate a unique path for each invocation and clean up after.
**Warning signs:** Intermittent validation failures with mismatched sequence data.

### Pitfall 5: Validator Timeout
**What goes wrong:** Claude Code CLI invocation takes too long (>60s) and times out, blocking the writer's save flow.
**Why it happens:** Opus 4.6 reasoning on a complex sequence with full context can be slow.
**How to avoid:** Set a reasonable timeout (60s) in the wrapper. On timeout, return a "validation skipped due to timeout" result with passed=true so the save isn't blocked. Log the timeout for monitoring.
**Warning signs:** Increasing validation timeouts -- consider trimming context or splitting per-step vs sequence review.

## Code Examples

### ValidationResult Zod Schema
```typescript
// Source: Project pattern from src/lib/agents/types.ts
import { z } from "zod";

export const validationFindingSchema = z.object({
  check: z.enum([
    "filler_spintax",
    "tonal_mismatch",
    "angle_repetition",
    "ai_patterns",
    "structural",
    "general",
  ]),
  severity: z.enum(["hard", "soft"]),
  step: z.number().optional(),
  field: z.string().optional(),
  problem: z.string(),
  suggestion: z.string(),
});

export const validationResultSchema = z.object({
  passed: z.boolean(),
  findings: z.array(validationFindingSchema),
  summary: z.string(),
  checklist: z.object({
    fillerSpintax: z.enum(["pass", "fail", "warn"]),
    tonalMismatch: z.enum(["pass", "fail", "warn"]),
    angleRepetition: z.enum(["pass", "fail", "warn"]),
    aiPatterns: z.enum(["pass", "fail", "warn"]),
  }),
});

export type ValidationFinding = z.infer<typeof validationFindingSchema>;
export type ValidationResult = z.infer<typeof validationResultSchema>;
```

### Wrapper Script Pattern
```typescript
// Source: Project pattern from scripts/cli/_cli-harness.ts + cli-spawn.ts
// scripts/cli/validate-sequence.ts

import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import { validationResultSchema } from "../../src/lib/agents/types";

// Read input file (sequence + workspace context)
const inputPath = process.argv.find(a => a.startsWith("--file="))?.split("=")[1]
  ?? process.argv[process.argv.indexOf("--file") + 1];
const input = JSON.parse(readFileSync(inputPath, "utf-8"));

// Serialize prompt for Claude Code CLI
const prompt = buildValidatorPrompt(input);
const promptPath = `/tmp/validator-prompt-${randomUUID()}.txt`;
writeFileSync(promptPath, prompt);

try {
  // Invoke Claude Code CLI with validator skill
  const result = execSync(
    `claude --skill validator --message-file "${promptPath}" --output-format json`,
    { timeout: 60_000, encoding: "utf-8" }
  );

  // Parse and validate
  const parsed = extractJSON(result);
  const validated = validationResultSchema.safeParse(parsed);

  if (validated.success) {
    console.log(JSON.stringify({ ok: true, data: validated.data }));
  } else {
    console.log(JSON.stringify({
      ok: true,
      data: { passed: true, findings: [], summary: "Validation parse error — skipped", checklist: { fillerSpintax: "pass", tonalMismatch: "pass", angleRepetition: "pass", aiPatterns: "pass" } }
    }));
  }
} catch (err) {
  // Timeout or error — don't block the save
  console.log(JSON.stringify({
    ok: true,
    data: { passed: true, findings: [], summary: "Validation timed out — skipped", checklist: { fillerSpintax: "pass", tonalMismatch: "pass", angleRepetition: "pass", aiPatterns: "pass" } }
  }));
} finally {
  try { unlinkSync(promptPath); } catch {}
}
```

### Writer Integration (validateSequence tool)
```typescript
// Source: Project pattern from src/lib/agents/writer.ts
validateSequence: tool({
  description: "Run the semantic validator agent on the complete sequence. Call AFTER validateCopy passes structural checks. Returns ValidationResult with findings and suggestions.",
  inputSchema: z.object({
    steps: z.array(z.object({
      position: z.number(),
      subjectLine: z.string().optional(),
      subjectVariantB: z.string().optional(),
      body: z.string(),
      channel: z.enum(["email", "linkedin"]),
      notes: z.string().optional(),
    })),
    strategy: z.enum(["pvp", "creative-ideas", "one-liner", "custom", "linkedin"]),
    workspaceSlug: z.string(),
  }),
  execute: async ({ steps, strategy, workspaceSlug }) => {
    // Load minimal workspace context for validator
    const ws = await prisma.workspace.findUnique({ where: { slug: workspaceSlug } });
    if (!ws) return { error: `Workspace '${workspaceSlug}' not found` };

    const context = {
      vertical: ws.vertical,
      outreachTonePrompt: ws.outreachTonePrompt,
      icpIndustries: ws.icpIndustries,
      icpDecisionMakerTitles: ws.icpDecisionMakerTitles,
      strategy,
    };

    // Write input to temp file
    const inputPath = `/tmp/validate-seq-${randomUUID()}.json`;
    writeFileSync(inputPath, JSON.stringify({ steps, context }));

    try {
      const result = await cliSpawn<ValidationResult>(
        "validate-sequence.js",
        ["--file", inputPath]
      );
      return result;
    } finally {
      try { unlinkSync(inputPath); } catch {}
    }
  },
}),
```

### Validator Rules File Structure
```markdown
# .claude/rules/validator-rules.md

# Validator Rules

## Purpose
Review completed outbound sequences for semantic quality issues that structural
checks miss. You are the THIRD quality gate after: (1) writer per-step self-review,
(2) writer cross-step dedup check.

## Severity Mapping
- **hard** = must fix before save. Writer will attempt one rewrite.
- **soft** = save with flag. Admin sees in review UI.

## Checklist (MANDATORY -- assess every sequence against all four)

### 1. Filler Spintax
...examples of filler vs substantive spintax...
Severity: hard (clear filler), soft (borderline)

### 2. Tonal Mismatch
...check against outreachTonePrompt + general cold outreach tone...
Severity: hard (grossly mismatched), soft (slightly off)

### 3. Angle Repetition Across Steps
...same value prop or pain point reused despite being a multi-step sequence...
Severity: hard (identical angle restated), soft (similar but not identical)

### 4. AI-Sounding Patterns
...examples of natural vs AI-sounding copy...
Severity: soft (always -- this is inherently subjective)

## General Observations
After the checklist, add any other quality issues you notice.
Weight: general observations are always SOFT severity.

## Output Format
Return ONLY a JSON object matching the ValidationResult schema.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single banned-pattern check at save time | Three-layer validation: structural + semantic + LLM review | Phase 52-55 (v8.0) | Copy quality gates before admin ever sees it |
| Writer writes and saves without self-review | Writer self-validates, rewrites, then external validator reviews | Phase 54-55 | Dramatically fewer manual QA cycles |

## Open Questions

1. **Claude Code CLI skill invocation syntax**
   - What we know: The project uses Claude Code for agent invocation. The `.claude/rules/` directory stores rules files loaded by agents.
   - What's unclear: The exact Claude Code CLI flags for invoking a skill file with a message. The `.claude/skills/` directory is currently empty -- no existing skill file pattern to follow.
   - Recommendation: The wrapper script should use `claude -p "{prompt}" --output-format json` or similar. Test the exact CLI syntax during implementation. The skill file may be loaded via `--skill` flag or by convention. Fallback: embed the validator prompt directly in the wrapper script if skill file loading is not straightforward.

2. **Validator invocation timing: "after every save" vs "before final save"**
   - What we know: CONTEXT.md says "runs after every save". But the integration pattern (writer calls validateSequence before saving) implies it runs BEFORE the final save.
   - What's unclear: Whether "after every save" means the validator runs post-save (as a non-blocking audit) or pre-save (as a blocking gate).
   - Recommendation: Implement as PRE-SAVE blocking gate for hard findings, consistent with the rewrite loop design. Hard findings block save. Soft findings are included in save notes. This matches the "writer auto-rewrites on hard findings" decision.

3. **Structural re-check scope in validator**
   - What we know: CONTEXT.md says validator re-runs copy-quality.ts structural checks as safety net.
   - What's unclear: Whether to run structural checks INSIDE the LLM prompt (asking the LLM to check word count, etc.) or OUTSIDE the LLM (wrapper script runs copy-quality.ts functions before/after LLM call).
   - Recommendation: Run structural checks in the WRAPPER SCRIPT (deterministic, tested code), not in the LLM prompt. The LLM focuses on semantic analysis. Structural findings are merged into the ValidationResult by the wrapper.

## Sources

### Primary (HIGH confidence)
- Project codebase: `src/lib/copy-quality.ts` -- all structural check functions and severity model
- Project codebase: `src/lib/agents/types.ts` -- existing Zod schemas, NOVA_MODEL constant, WriterOutput type
- Project codebase: `src/lib/agents/writer.ts` -- tool patterns, save tool quality gates, system prompt structure
- Project codebase: `src/lib/agents/runner.ts` -- runAgent() pattern, JSON extraction from LLM output
- Project codebase: `src/lib/agents/cli-spawn.ts` -- cliSpawn() subprocess utility
- Project codebase: `.claude/rules/writer-rules.md` -- full writer rules (260+ lines)

### Secondary (MEDIUM confidence)
- Phase 54 plans (54-01-PLAN.md, 54-02-PLAN.md) -- validateCopy tool interface, self-review protocol, cross-step dedup
- Phase 55 CONTEXT.md -- locked decisions and discretion areas

### Tertiary (LOW confidence)
- Claude Code CLI exact invocation syntax for skills -- needs validation during implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in project
- Architecture: HIGH -- follows existing project patterns exactly
- Zod schema design: HIGH -- follows existing types.ts conventions
- CLI skill invocation: MEDIUM -- skill directory is empty, no existing pattern to follow. May need adaptation.
- Pitfalls: HIGH -- based on direct analysis of the codebase and similar patterns

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable project architecture, no external dependency changes expected)
