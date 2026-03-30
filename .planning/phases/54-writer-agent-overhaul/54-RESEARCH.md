# Phase 54: Writer Agent Overhaul — Research

**Researched:** 2026-03-30
**Question:** What do I need to know to PLAN this phase well?

## Current State Analysis

### Writer Agent Architecture (`src/lib/agents/writer.ts`)
- Uses `runAgent()` from `runner.ts` with `generateText()` from Vercel AI SDK
- Model: `NOVA_MODEL` (claude-opus-4-6) from `types.ts`
- System prompt: loads `writer-rules.md` via `loadRules()` at invocation time
- Tools available: `getWorkspaceIntelligence`, `getCampaignPerformance`, `getSequenceSteps`, `searchKnowledgeBase`, `getExistingDrafts`, `getCampaignContext`, `saveCampaignSequence`, `saveDraft`, `generateKBExamples`
- `maxSteps: 20` — sufficient headroom for generate-validate-rewrite loops
- Output validated against `writerOutputSchema` (Zod) in runner.ts

### Existing Quality Gates (Pre-Phase 54)
1. **`saveCampaignSequence` tool** — calls `checkSequenceQuality()` (banned patterns only) before DB write. Returns `quality_violation` status if violations found.
2. **`saveDraft` tool** — calls `checkCopyQuality()` per field (subject, subjectVariantB, body) before DB write. Returns `quality_violation` status if violations found.
3. **`copy-quality.ts`** (Phase 52 extended) — has both legacy functions (`checkCopyQuality`, `checkSequenceQuality`, `formatSequenceViolations`) AND new Phase 52 functions (`checkWordCount`, `checkGreeting`, `checkCTAFormat`, `checkLinkedInSpintax`, `checkSubjectLine`) with `CheckResult` type including severity levels.

### Gap: Save Tools Only Check Banned Patterns
The save tools (`saveCampaignSequence`, `saveDraft`) currently ONLY call the legacy `checkCopyQuality()` / `checkSequenceQuality()` which check banned patterns. They do NOT call the Phase 52 structural checks (`checkWordCount`, `checkGreeting`, `checkCTAFormat`, `checkLinkedInSpintax`, `checkSubjectLine`). This is the core gap Phase 54 must close.

### Writer Rules (`writer-rules.md`)
- Comprehensive rules file (~260 lines) loaded into system prompt
- Has a "FINAL CHECK" section at the end — instructions for the LLM to self-review before returning
- Does NOT have a structured self-review checklist section (Phase 53 dependency note: the CONTEXT.md says Phase 53 adds "writer-rules.md self-review checklist section" — but Phase 53 is about leads platform expertise. The self-review checklist must be added as part of Phase 54 or confirmed as existing.)
- Rules cover: copy strategies (PVP, Creative Ideas, One-liner, Custom), signal-aware rules, shared quality rules (banned phrases, greetings, word count, CTAs, variables, spintax), LinkedIn defaults, KB examples mode, reply suggestion mode

### Runner Architecture (`src/lib/agents/runner.ts`)
- `runAgent<TOutput>()` calls `generateText()` once, extracts tool calls, parses JSON output
- No retry/rewrite loop at the runner level — the agent must self-manage rewrites within its tool calls
- Output schema validation is graceful (logs error, continues with raw output)
- Creates AgentRun audit record with status, steps, duration, token usage

## Requirements to Address

### COPY-02: Mandatory Self-Review Gate
**Current:** Save tools check banned patterns only. No pre-save structural validation.
**Needed:** A `validate-copy` CLI wrapper tool the writer calls before saving. Runs ALL checks (banned patterns + word count + greeting + CTA + LinkedIn spintax + subject line). Returns structured CheckResult[] with severity levels. Writer auto-rewrites on violations (max 2 retries).
**Implementation approach:**
- New tool: `validateCopy` added to `writerTools` — runs all copy-quality.ts checks and returns structured results
- The tool does NOT need to be a CLI script — it can be a direct tool in writer.ts that calls the copy-quality functions. The CONTEXT.md mentions "CLI wrapper" for pattern consistency, but since the writer already has direct tools (not CLI spawns), a direct tool is simpler and faster.
- Writer system prompt updated to mandate: generate -> validate -> (rewrite if violations -> validate) -> save
- Max 2 rewrite attempts. On persistent violation, save with review notes in the `notes` field.

### COPY-03: Campaign-Holistic Awareness
**Current:** Writer has `getCampaignContext` tool that loads campaign details including existing email/LinkedIn sequences. Also has `getSequenceSteps` (loads from EmailBison) and `getExistingDrafts` (loads from DB).
**Needed:** Writer MUST load all existing steps before generating any new step. Must build an internal "taken angles/CTAs" list and avoid reuse.
**Implementation approach:**
- System prompt update: when generating for a campaign (campaignId provided), MUST call `getCampaignContext` first to load all existing sequences
- The existing tool already returns `emailSequence` and `linkedinSequence` from the Campaign entity
- System prompt instruction: "Before generating, list all angles and CTAs from existing steps. Do not reuse any."
- No new tools needed — this is a system prompt behavioral change enforced by the validate tool (cross-step CTA dedup check)

### COPY-04: Intent-Based Anti-Pattern Descriptions
**Current:** Banned phrases are literal strings in rules. Patterns like "quick question" are banned but the underlying INTENT (fake-casual engagement bait) is not described.
**Needed:** writer-rules.md updated with intent descriptions alongside banned phrases. E.g., "Don't use fake-casual engagement bait (phrases that pretend to be conversational but are obviously templated: 'quick question', 'genuine question', 'curious if')."
**Implementation approach:**
- Update writer-rules.md Shared Quality Rules section: group banned phrases by intent category with descriptions
- No code changes — this is a rules file edit that improves LLM understanding

### COPY-05: LinkedIn-Specific Validation
**Current:** `checkLinkedInSpintax()` exists in copy-quality.ts. Writer-rules.md has LinkedIn defaults section.
**Needed:** The validate tool must enforce LinkedIn-specific rules: no spintax, no paragraph format, under 100 words, chat tone.
**Implementation approach:**
- The `validateCopy` tool receives a `channel` parameter. When channel is "linkedin", it runs `checkLinkedInSpintax()` and `checkWordCount(text, "linkedin")`.
- "No paragraph format" and "chat tone" are semantic checks better suited for Phase 55 (Validator Agent). The structural checks (spintax, word count) go here.

### COPY-06: KB Consultation Must Produce Applied Output
**Current:** Writer calls `searchKnowledgeBase` tool. The system prompt says to consult KB. But the output only has `references: string[]` field — no enforcement that KB results are actually APPLIED.
**Needed:** Writer output must name the specific KB principle applied, not just list references.
**Implementation approach:**
- System prompt update: "For every step, include in the `notes` field which specific KB principle was applied and how. Format: 'Applied: [principle name] from [KB doc title] — [how it shaped this step]'."
- WriterOutput type already has `notes` on each step — no schema change needed
- The validate tool can check that `notes` contains "Applied:" when references are present (soft warning if missing)

## Key Files to Modify

| File | Changes |
|------|---------|
| `src/lib/agents/writer.ts` | Add `validateCopy` tool; update system prompt for self-review mandate, campaign-holistic awareness, KB citation enforcement |
| `src/lib/copy-quality.ts` | Add `validateAllChecks()` aggregator function that runs all checks and returns CheckResult[] |
| `.claude/rules/writer-rules.md` | Add intent-based anti-pattern descriptions (COPY-04); add self-review checklist section |
| `src/lib/agents/types.ts` | Update WriterOutput to add optional `appliedPrinciples` or enforce via notes |
| `src/lib/__tests__/copy-quality.test.ts` | Add tests for `validateAllChecks()` |

## Dependencies Confirmed

- **Phase 52 (copy-quality.ts):** COMPLETE. All 5 check functions exist: `checkWordCount`, `checkGreeting`, `checkCTAFormat`, `checkLinkedInSpintax`, `checkSubjectLine`. Types `CheckResult`, `CopyStrategy` exported.
- **Phase 53 (writer-rules.md self-review checklist):** The roadmap says Phase 54 depends on Phase 53 for "writer-rules.md self-review checklist section". However, Phase 53 is about leads platform expertise, not writer rules. The self-review checklist should be added IN Phase 54 as part of the writer-rules.md updates. This is not a blocker.

## Design Decisions

### validate-copy: Tool vs CLI Script
The CONTEXT.md says "CLI wrapper invocation". However, examining the codebase:
- Writer tools are direct Zod-schema tools calling Prisma/imports directly (not CLI spawns)
- No CLI scripts exist in `scripts/cli/` or `src/cli/` — the "CLI" references in rules files are for the Nova CLI skill layer (Claude Code spawning)
- A direct tool in writer.ts is simpler, faster (no subprocess), and follows the existing pattern
- **Decision: Direct tool in writer.ts, not CLI script**

### Rewrite Loop: Agent-Internal vs Runner-Level
- Runner.ts has no retry mechanism — it calls `generateText()` once
- The rewrite loop must happen within the agent's tool usage: generate copy -> call validateCopy -> if violations, the LLM rewrites within the same conversation turn
- `maxSteps: 20` provides enough headroom for generate(1) + validate(1) + rewrite(1) + validate(1) + rewrite(1) + validate(1) + save(1) = 7 tool calls minimum
- **Decision: Agent-internal rewrite via system prompt mandate + validateCopy tool**

### Save Tool Enhancement
- Current save tools (`saveCampaignSequence`, `saveDraft`) only check banned patterns
- They should ALSO run the Phase 52 structural checks before saving (defense in depth)
- This makes the save tool the final gate even if the writer skips the explicit validate step
- **Decision: Enhance save tools to run full validation, not just banned patterns**

### Escalation Format
- When violations persist after 2 retries, save with inline review notes
- Use the existing `notes` field on each step: prefix with `[REVIEW NEEDED]` and list remaining violations
- Admin sees this in the existing campaign approval flow
- **Decision: Use notes field with [REVIEW NEEDED] prefix**

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Writer ignores validate tool despite system prompt | Save tools enforce validation as defense-in-depth — violations blocked at save time |
| Rewrite loop burns too many tokens | Max 2 retries caps at ~7 tool calls. maxSteps=20 has headroom |
| Cross-step dedup relies on LLM judgment | Structural CTA string matching in validate tool for exact duplicates; semantic dedup is Phase 55 |
| Phase 53 self-review checklist not yet added | Add it in this phase as part of writer-rules.md updates |

## Test Strategy

- Unit tests for `validateAllChecks()` aggregator function
- Unit tests for enhanced save tool validation (integration with all check functions)
- The success criteria are behavioral (LLM generates -> validates -> rewrites) — these are best verified via manual E2E test or integration test calling `runWriterAgent()`

---

*Phase: 54-writer-agent-overhaul*
*Research completed: 2026-03-30*
