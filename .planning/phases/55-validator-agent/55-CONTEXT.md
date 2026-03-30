# Phase 55: Validator Agent - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

A stateless validator agent (Opus 4.6 via Claude Code CLI) reviews every completed sequence for semantic quality issues that structural checks miss — angle repetition, tone mismatch, filler spintax, AI-sounding patterns — before copy is confirmed saved. This is the third and final quality gate after the writer's per-step self-review and cross-step dedup check.

</domain>

<decisions>
## Implementation Decisions

### What the Validator Catches
- **Semantic + structural re-check** — validator re-runs copy-quality.ts structural checks as a safety net AND performs semantic analysis that only an LLM can assess
- **All four semantic checks enforced**:
  1. Filler spintax detection — options are interchangeable throwaways, technically valid but low-quality
  2. Tonal mismatch — copy doesn't match workspace outreachTonePrompt or feels inconsistent across steps
  3. Angle repetition across steps — same value prop or pain point reused despite writer's dedup tracking
  4. AI-sounding patterns — overly structured sentences, unnatural transitions, template-feeling copy that dodges the banned phrase list
- **Checklist + open section** — fixed checklist for the four semantic checks, plus a "general observations" section for anything else the LLM spots
- **Balanced strictness** — flag clear issues, let borderline cases through. Avoid alert fatigue from too many false positives.

### Validation Result Format
- **Structured Zod schema + human-readable summary** — typed ValidationResult JSON for programmatic use, plus a summary paragraph for admin readability
- **Hard / Soft severity** matching copy-quality.ts — consistent language across the whole pipeline. Hard = must fix before save. Soft = save with flag.
- **Describe problem + suggest fix** — each finding includes what's wrong AND a concrete suggestion (e.g. "Step 2 CTA repeats step 1 angle. Suggest: switch to social proof angle.")

### Integration with Writer Flow
- **Runs after every save** — no API cost on Max Plan, so validator always runs for maximum quality. No reason to skip.
- **Writer auto-rewrites** on hard findings — validator feedback fed back to writer for one rewrite attempt. If still failing, save with review notes.
- **1 validator-triggered rewrite max** — combined with writer's 2 self-review retries, this is attempt #4 total. If still failing, escalate with review notes.
- **Both per-step and full sequence review** — first pass per-step, then full sequence as a unit. Catches both individual step issues and cross-step problems.

### Validator as CLI Skill
- **New Claude Code skill file** — dedicated .claude/skills/validator.md, invoked via Claude Code CLI. Full Opus 4.6 reasoning for semantic checks. Stateless — receives sequence, returns ValidationResult.
- **Wrapper script for invocation** — new validate-sequence.js wrapper: accepts sequence JSON + workspace context, calls validator skill via Claude Code CLI, parses ValidationResult, returns structured output. Clean I/O contract.
- **Full workspace context provided** — validator receives sequence + workspace context (ICP, tone prompt, strategy) so it can assess tonal consistency, ICP relevance, and strategy compliance.
- **Dedicated rules file** — .claude/rules/validator-rules.md defines what to check, severity mapping, output format, review philosophy. Consistent with other agents.

### Claude's Discretion
- Exact Zod schema design for ValidationResult (field names, nesting)
- How the wrapper script serialises sequence + context for the skill
- Internal structure of the validator checklist prompt
- How "general observations" are weighted vs checklist findings

</decisions>

<specifics>
## Specific Ideas

- The validator is the THIRD gate in the pipeline: (1) writer per-step self-review, (2) writer cross-step dedup, (3) validator semantic + structural review. Three layers before copy reaches admin.
- "AI-sounding patterns" is deliberately broad — the validator should use LLM judgement to catch things that feel templated or robotic even when they technically pass all rules. This is the whole point of using Opus 4.6 for this.
- The "general observations" open section lets the validator flag novel quality issues we haven't explicitly listed — it can evolve its catches over time as we learn what patterns to watch for.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 55-validator-agent*
*Context gathered: 2026-03-30*
