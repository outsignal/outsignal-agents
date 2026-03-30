# Architecture Research

**Domain:** Agent Quality Overhaul — v8.0 Integration Architecture
**Researched:** 2026-03-30
**Confidence:** HIGH — based on direct code inspection of all relevant agent files, rules files, and CLI scripts

---

## Standard Architecture

### System Overview (Current v7.0 State)

```
┌──────────────────────────────────────────────────────────────────────┐
│                        INVOCATION LAYER                              │
│  Dashboard Chat /api/chat     Claude Code CLI (.claude/skills/)      │
└───────────────────────────┬──────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│          ORCHESTRATOR — orchestrator.ts (Sonnet 4, 12 steps)         │
│   delegateToWriter | delegateToLeads | delegateToCampaign | etc.     │
│   cli-spawn.ts: routes to CLI skill (NOVA_CLI_ENABLED) or runAgent() │
└────────┬──────────────────┬──────────────────────┬───────────────────┘
         │                  │                       │
         ▼                  ▼                       ▼
  ┌─────────────┐   ┌─────────────┐        ┌──────────────┐
  │ Writer      │   │ Leads       │        │ Campaign     │
  │ writer.ts   │   │ leads.ts    │        │ campaign.ts  │
  │ (API path)  │   │ (API path)  │        │ (API path)   │
  └──────┬──────┘   └──────┬──────┘        └──────┬───────┘
         │                 │                       │
         ▼                 ▼                       ▼
  ┌──────────────────────────────────────────────────┐
  │           CLI WRAPPER SCRIPTS (55 scripts)        │
  │    scripts/cli/   →  dist/cli/  (tsup build)      │
  │  save-draft.ts  save-sequence.ts  search-*.ts     │
  │  discovery-plan.ts  discovery-promote.ts  etc.    │
  └──────────────────────────────────────────────────┘
         │                 │                       │
         ▼                 ▼                       ▼
  ┌──────────────────────────────────────────────────┐
  │              SHARED TOOL LAYER                    │
  │  Prisma/PostgreSQL  |  EmailBison API             │
  │  Discovery Adapters |  KB Store                   │
  │  copy-quality.ts    |  .nova/memory/{slug}/       │
  └──────────────────────────────────────────────────┘
```

### Current Quality Enforcement (v7.0 Gaps)

```
Writer Agent generates copy
    ↓
saveDraft / saveCampaignSequence tool called
    ↓
checkCopyQuality() / checkSequenceQuality()  ← 13 banned patterns only
    ↓ quality_violation? Agent is expected to rewrite (not enforced by runner)
    ↓
Draft saved to DB
    ↓
Client approves via portal /api/portal/.../approve-content
    ↓
checkSequenceQuality() again — WARN ONLY, approval proceeds regardless
    ↓
Campaign deployed
```

**Problems this architecture has:**
1. No word count enforcement — agent must count manually, often fails
2. No greeting enforcement — agent forgets on first-step emails
3. No spintax grammar check — bad options pass through
4. No campaign-holistic view — writer never sees all steps together before saving
5. No LinkedIn spintax block — writer adds spintax despite rules saying no
6. No validator between generation and save — quality_violation requires agent self-correction which is unreliable
7. No platform expertise encoding — leads agent has no structured knowledge of optimal Prospeo/Apollo filters
8. No pre-search validation — expensive API calls happen before input sanity checks
9. No channel-aware list building — email leads and LinkedIn leads mixed

---

## Target Architecture (v8.0)

### Integration Philosophy

The overhaul adds quality infrastructure *around* the existing agent loop, not inside it. The key principle: **enforce at the boundary, not in the prompt**. Prompts are probabilistic. Boundary functions are deterministic.

Three integration zones:

1. **Pre-generation** — Platform expertise data, campaign-holistic context load
2. **Post-generation, pre-save** — Validator agent reviews output before it touches the DB
3. **Pre-search** — Input validation gates before paid API calls fire

### System Overview (Target v8.0)

```
┌──────────────────────────────────────────────────────────────────────┐
│                        INVOCATION LAYER (unchanged)                  │
└───────────────────────────┬──────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│          ORCHESTRATOR (unchanged interface, minor additions)          │
│   delegateToWriter (+ campaignHolisticLoad flag added)               │
│   delegateToLeads  (+ channelMode param added)                       │
└────────┬──────────────────┬──────────────────────────────────────────┘
         │                  │
         ▼                  ▼
  ┌──────────────────┐  ┌────────────────────────────────────────────┐
  │  WRITER AGENT    │  │  LEADS AGENT                               │
  │  (modified)      │  │  (modified)                                │
  │                  │  │                                            │
  │ 1. Load campaign │  │ 1. Pre-search input validation gate        │
  │    context FIRST │  │    (domain format, title sanity, ICP fit)  │
  │    (all steps)   │  │                                            │
  │ 2. Generate all  │  │ 2. Platform expertise context load         │
  │    steps         │  │    (optimal filters per source)            │
  │ 3. Self-review   │  │                                            │
  │    gate (NEW)    │  │ 3. Source-specific execution               │
  │ 4. Pass to       │  │                                            │
  │    Validator     │  │ 4. Post-search quality gates               │
  │    Agent (NEW)   │  │    (% verified, % LinkedIn, ICP threshold) │
  │ 5. Save if pass  │  │                                            │
  └──────────────────┘  └────────────────────────────────────────────┘
         │
         ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │  VALIDATOR AGENT (NEW — src/lib/agents/validator.ts)             │
  │  Sonnet 4, 4 steps max, structured output                        │
  │                                                                  │
  │  Input: full campaign sequence (all steps as one unit)           │
  │  Checks: word count, banned phrases, greetings, CTA format,      │
  │          spintax validity, variable syntax, LinkedIn format,      │
  │          UK English, campaign angle dedup, CTA dedup             │
  │  Output: ValidationResult { pass: bool, violations: [], fixes: }  │
  │                                                                  │
  │  On fail: returns violations to Writer for targeted rewrite      │
  │  On pass: writer calls saveCampaignSequence                      │
  └──────────────────────────────────────────────────────────────────┘
         │ (after validation pass)
         ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │  EXISTING SAVE LAYER (checkCopyQuality still runs — last resort) │
  │  saveDraft / saveCampaignSequence → DB                           │
  └──────────────────────────────────────────────────────────────────┘
```

---

## Component Boundaries

### New Components

| Component | File | Responsibility | Calls |
|-----------|------|----------------|-------|
| Validator Agent | `src/lib/agents/validator.ts` | Deterministic copy QA — reviews full sequence as a unit, returns typed violations | `copy-quality.ts`, new extended checks |
| Extended copy-quality.ts | `src/lib/copy-quality.ts` | Add: word count check, greeting check, CTA format check, LinkedIn spintax check, spintax grammar check | Existing module, extended |
| Platform expertise docs | `.claude/rules/platform-expertise.md` (or `leads-platform-expertise.md`) | Optimal filters, cost/lead, verified vs unverified handling per source (Prospeo, Apollo, AI Ark, Leads Finder, Google Maps, Ecommerce) | Read by leads agent at runtime via loadRules() |
| Pre-search validator tool | New tool inside `leads.ts` | Input validation before any paid API call: domain format, ICP filter sanity, title format | Pure TypeScript, no API calls |
| Post-search quality gate | New tool inside `leads.ts` | Quality metrics after discovery: % verified, % with LinkedIn, placeholder detection, ICP fit sample | Reads staged results from DB |
| Campaign-holistic context loader | New tool inside `writer.ts` (`loadCampaignSequence`) | Load all existing sequence steps as a unit before generation begins | Extends existing `getCampaignContext` |
| Channel-aware list validator | New tool inside `leads.ts` or `campaign.ts` | Checks that email campaigns use email-verified leads, LinkedIn campaigns use leads with LinkedIn URLs | DB query |

### Modified Existing Components

| Component | File | Changes |
|-----------|------|---------|
| `copy-quality.ts` | `src/lib/copy-quality.ts` | Add: `checkWordCount()`, `checkGreeting()`, `checkCTAFormat()`, `checkLinkedInSpintax()`, `checkSpintaxGrammar()` — extend existing `CopyQualityResult` type |
| `writer.ts` | `src/lib/agents/writer.ts` | Add: `validateSequence` tool (calls Validator Agent), add `loadCampaignSequence` tool, update system prompt to mandate self-review + validator call before save |
| `leads.ts` | `src/lib/agents/leads.ts` | Add: `validateDiscoveryInputs` tool, `checkPostSearchQuality` tool, update system prompt to load platform expertise |
| `writer-rules.md` | `.claude/rules/writer-rules.md` | Add: campaign-holistic section, self-review checklist, validator call instruction |
| `leads-rules.md` | `.claude/rules/leads-rules.md` | Add: platform expertise reference, pre-search validation steps, post-search quality thresholds |
| `orchestrator.ts` | `src/lib/agents/orchestrator.ts` | Add `channelMode` param to `delegateToLeads`, add `campaignId` requirement enforcement for Writer delegation |
| `save-sequence.ts` CLI | `scripts/cli/save-sequence.ts` | No change — quality enforcement happens before this is called |
| Portal `approve-content` route | `src/app/api/portal/.../approve-content/route.ts` | Upgrade from warn-only to hard block if violations exist (last-resort gate) |

### Unchanged Components

- `runner.ts` — execution engine unchanged
- `cli-spawn.ts` — subprocess routing unchanged
- `orchestrator.ts` delegation tool interface (params extended, not replaced)
- All 55 CLI wrapper scripts (no changes needed)
- `.nova/memory/` namespace and files
- Dashboard chat route

---

## Data Flow

### Writer Flow: Campaign-Holistic with Validator Gate

```
Orchestrator delegates to Writer (with campaignId)
    ↓
Writer: loadCampaignContext(campaignId)
  → returns: existing steps, targetList info, channel, strategy
    ↓
Writer: loadCampaignSequence(campaignId)  [NEW — loads all existing steps as unit]
  → returns: full existing sequence if any (for dedup / continuation)
    ↓
Writer: getWorkspaceIntelligence(slug)
    ↓
Writer: searchKnowledgeBase(×3 tiered calls)
    ↓
Writer: generate ALL steps (not one at a time)
  → internal self-review checklist executed before returning
    ↓
Writer: validateSequence(fullSequence)  [NEW tool — calls Validator Agent]
  Validator Agent receives: all steps as JSON, channel, strategy
  Validator runs: word count, banned phrases, greeting, CTA, spintax, variables,
                  LinkedIn format, UK English, angle dedup across steps
  Validator returns: { pass: bool, violations: PerStepViolation[], suggestedFixes: string }
    ↓
  IF violations exist:
    Writer receives violations → targeted rewrite of failing steps → re-validate (max 2 loops)
    If still failing after 2 loops: save with violations logged, flag for admin review
  IF pass:
    Writer: saveCampaignSequence(campaignId, sequence)
    ↓
    checkSequenceQuality() fires again (13 patterns — existing last-resort gate)
    ↓
    Saved to Campaign.emailSequence / Campaign.linkedinSequence
```

### Leads Flow: Platform-Expert with Pre/Post Gates

```
Orchestrator delegates to Leads (with workspaceSlug, channelMode)
    ↓
Leads: buildDiscoveryPlan(sources, filters)  [existing — modified to include expertise hint]
  → Platform expertise context loaded from leads-rules.md at agent startup
  → Plan shows: optimal filters per source, estimated quality metrics
    ↓
Admin approves plan
    ↓
Leads: validateDiscoveryInputs(plan)  [NEW tool — runs before any API call]
  Checks:
  - Prospeo domain search: are domains formatted correctly? (no https://, no paths)
  - Apollo/Prospeo/AIArk: are industry/title filters using known-good terms?
  - Company name list: does domain resolution step exist?
  - Estimated volume: sanity check (>10k from single source = suspicious)
  Returns: { valid: bool, warnings: string[], blockers: string[] }
  Blockers halt execution. Warnings shown to admin.
    ↓
Leads: execute searches (existing search-*.ts tools)
    ↓
Leads: runDeduplicateAndPromote(runIds)  [existing]
    ↓
Leads: checkPostSearchQuality(promotedIds, channelMode)  [NEW tool]
  Checks:
  - % with verified email (for email channel: require >60%)
  - % with LinkedIn URL (for linkedin channel: require >50%)
  - Placeholder detection: firstName contains "N/A", email contains "info@"
  - ICP fit sample: spot-check 10 random leads vs workspace ICP
  Returns: { qualityScore: number, issues: string[], passesThreshold: bool }
    ↓
  IF issues: report to admin with counts, recommend next step
    (route unverified emails through BounceBan / LeadMagic)
  IF passes: proceed to list building
```

### Validator Agent Internal Flow

```
Input: { steps: EmailStep[] | LinkedInStep[], channel, strategy, workspaceSlug }
    ↓
Validator calls: checkExtendedCopyQuality(steps)
  [Extended function in copy-quality.ts — deterministic, no LLM]
  Returns structural violations (word count, variables, spintax, banned phrases)
    ↓
Validator calls: checkCampaignCoherence(steps)
  [LLM call — Haiku 4.5, ~500 tokens per campaign]
  Checks: angle dedup across steps, CTA dedup, step-to-step narrative flow,
          UK English flags, tone consistency
  Returns: CoherenceResult { issues: string[], severity: "block" | "warn" }
    ↓
Validator assembles: ValidationResult {
  pass: structuralViolations.length === 0 && !coherence.hasBlockers,
  structuralViolations: PerStepViolation[],
  coherenceIssues: string[],
  warningsOnly: string[],  // non-blocking issues for reviewNotes
  suggestedFixes: string   // plain text guidance for rewrite
}
    ↓
Returns to Writer Agent
```

### Platform Expertise Data Flow

```
Agent startup (Writer or Leads)
    ↓
loadRules("writer-rules.md") or loadRules("leads-rules.md")
  [existing loadRules() mechanism — reads .claude/rules/ at runtime]
    ↓
Rules file now contains platform expertise section:
  - Per-source: optimal filters, cost-per-lead, quality expectations
  - Prospeo: domain-based search is cheapest, verified email included
  - Apollo: free but no emails, use for initial volume only
  - AI Ark: paid peer to Prospeo, different record coverage
  - Leads Finder: verified emails included, no pagination, use for speed
  - Google Maps: local/SMB only, not B2B enterprise
    ↓
Agent has expertise baked into system prompt — no separate tool call needed
```

---

## Recommended Project Structure

### New Files

```
src/lib/agents/
├── validator.ts              NEW — Validator Agent (Haiku 4.5, 4 steps)
│
src/lib/
├── copy-quality.ts           MODIFIED — extend with word count, greeting,
│                               CTA, LinkedIn spintax, spintax grammar checks
│
.claude/rules/
├── writer-rules.md           MODIFIED — add self-review checklist section,
│                               validator call instruction, holistic awareness
├── leads-rules.md            MODIFIED — add platform expertise section,
│                               pre-search validation steps, post-search thresholds
│
src/lib/agents/
├── writer.ts                 MODIFIED — add validateSequence tool,
│                               loadCampaignSequence tool, update system prompt
├── leads.ts                  MODIFIED — add validateDiscoveryInputs tool,
│                               checkPostSearchQuality tool
├── orchestrator.ts           MODIFIED — add channelMode to delegateToLeads,
│                               minor param additions
│
src/app/api/portal/campaigns/[id]/approve-content/
├── route.ts                  MODIFIED — upgrade from warn to hard block
```

### No New Files Needed For

- CLI wrapper scripts — no new scripts required; validator runs inside agent layer
- Memory files — platform expertise lives in rules files, not memory
- Database schema — no new tables; ValidationResult logged in AgentRun.steps (existing)
- Orchestrator tools — existing delegation interface extended, not replaced

---

## Architectural Patterns

### Pattern 1: Rules File as Platform Knowledge Base

**What:** Platform expertise (optimal Prospeo filters, Apollo limitations, cost-per-lead, quality expectations per source) lives in `.claude/rules/leads-rules.md`. Loaded at agent startup via existing `loadRules()` mechanism. No new infrastructure needed.

**When to use:** For knowledge that is semi-stable (changes when platforms update their APIs), needs to be shared between API agent and CLI skill, and should be human-editable without a code deploy.

**Trade-offs:** Rules files are text — no type safety, no structured validation. Acceptable because this is guidance content, not executable logic. When platform APIs change materially, a human updates the rules file.

**Do not:** Put this in the DB as a "platform knowledge document" — that adds query overhead for static content that changes rarely.

### Pattern 2: Validator as Thin Haiku Agent

**What:** The Validator Agent is a minimal `AgentConfig` using Haiku 4.5 with a narrow, deterministic task: receive a sequence as JSON, run checks, return a typed `ValidationResult`. It does not write to DB, does not call external APIs, and never saves anything. It is a pure function wrapped in an agent call for coherence checking that requires LLM reasoning (angle dedup, UK English, tone consistency).

**When to use:** When deterministic regex checks (existing `copy-quality.ts`) are insufficient — specifically for semantic checks like "are all three steps using the same CTA angle?" that require understanding content.

**Trade-offs:** A Haiku call adds ~2-3 seconds and ~$0.002 per campaign validation. Acceptable — validation happens once before save, not on every token. Running via API (not CLI skill) because it is a short, structured task that benefits from type-safe `generateObject()` with Zod schema.

**Implementation note:** `validator.ts` uses `generateObject()` with a Zod output schema, not `generateText()`. This ensures structured output without JSON parsing fragility. The `runner.ts` execute path is bypassed — validator has no `AgentRun` audit record (it is a sub-call, not a top-level agent invocation).

### Pattern 3: Self-Review Gate in System Prompt

**What:** The writer system prompt adds an explicit mandatory self-review checklist that runs before the agent calls `validateSequence`. The checklist mirrors the `copy-quality.ts` checks in plain English. The agent reasons through each point.

**When to use:** As a first-pass filter before the Validator Agent call. Catches obvious violations (em dashes, banned phrases, double-brace variables) without spending Haiku tokens.

**Trade-offs:** Self-review is probabilistic — Claude may miss violations. This is why the Validator Agent runs after. The self-review reduces the number of violations the Validator sees, reducing the chance of a rewrite loop. It does not replace the Validator.

**Updated writer-rules.md section:**

```markdown
## Mandatory Self-Review (runs before calling validateSequence)

Before calling validateSequence, mentally run this checklist against ALL steps:

1. Word count: count every word in each email body. Must be under 70. Count again.
2. Banned phrases: re-read rule 1 banned list. Scan body + subject for each phrase.
3. Variables: every {variable} must be UPPERCASE single braces. Search for {{ or {lower}.
4. Greetings: email step 1 must start with "Hi {FIRSTNAME}," or "Hello {FIRSTNAME},".
5. CTAs: every CTA must be a question. No "Let me know", "Are you free", "Can I send".
6. LinkedIn: zero spintax {option|option} patterns in any LinkedIn step.
7. Em dashes: zero —, zero –, zero " - " separators.

If any check fails: fix it, then call validateSequence.
If all checks pass: call validateSequence to confirm.
```

### Pattern 4: Channel-Aware List Building as Orchestrator Param

**What:** The orchestrator's `delegateToLeads` tool gains a `channelMode: "email" | "linkedin" | "hybrid"` param. This is passed into the Leads Agent's `buildDiscoveryPlan` and `checkPostSearchQuality` tools, which use it to set the right quality thresholds.

**When to use:** Any time a campaign has a defined channel before lead discovery starts. The orchestrator reads the channel from the Campaign entity and passes it through.

**Trade-offs:** Requires the campaign to exist before discovery runs (leads created for a campaign, not a generic workspace pool). This is already the intended workflow; this enforces it.

**Implementation note:** The `channelMode` param is optional for backward compatibility. When absent, quality checks run with relaxed thresholds (warning only, not blocking).

---

## Build Order (Dependency-Aware)

Dependencies are strict: each phase must be complete before the next begins.

### Phase 1: Extend copy-quality.ts (no dependencies)

Add new check functions to the existing module. All are pure TypeScript with zero external dependencies:

1. `checkWordCount(body: string): { count: number, pass: boolean }` — split on whitespace, count
2. `checkGreeting(body: string, stepPosition: number, channel: string): boolean` — regex for "Hi {FIRSTNAME}," at step 1
3. `checkCTAFormat(body: string): { hasBannedCTA: boolean, found: string[] }` — regex for "Let me know", "Are you free", "Can I send"
4. `checkLinkedInSpintax(body: string, channel: string): boolean` — detect {option|option} in LinkedIn messages
5. `checkSpintaxGrammar(body: string): { valid: boolean, suspects: string[] }` — extract all {a|b|c} patterns, flag ones where options have different word counts (rough grammar proxy)
6. Update `CopyQualityResult` type to include new check results
7. Update `checkCopyQuality()` to call all new checks

This phase has zero risk — adding to a pure utility module, no agent code touched.

### Phase 2: Platform expertise in rules files (no dependencies)

Update `.claude/rules/leads-rules.md` with a new "Platform Expertise" section documenting per-source optimal filters, cost-per-lead, and quality expectations. Update `.claude/rules/writer-rules.md` with the mandatory self-review checklist.

This is a text edit. Zero code changes. Affects both the API agent (via `loadRules()`) and the CLI skill (via `!` file include in skill files).

### Phase 3: Validator Agent (depends on Phase 1)

Create `src/lib/agents/validator.ts`:

- `AgentConfig` using `claude-haiku-4-5-20251001`, `maxSteps: 4`
- Uses `generateObject()` with Zod schema (not `generateText()` + runner.ts)
- Zod output schema: `ValidationResult { pass, structuralViolations, coherenceIssues, warningsOnly, suggestedFixes }`
- System prompt: focused narrowly on QA review, imports extended `checkExtendedCopyQuality()` logic from Phase 1 for the structural checks
- Export: `validateSequence(steps, channel, strategy, workspaceSlug): Promise<ValidationResult>`

No changes to runner.ts, orchestrator.ts, or any other file in this phase.

### Phase 4: Writer agent integration (depends on Phases 2 + 3)

Modify `src/lib/agents/writer.ts`:

1. Add `loadCampaignSequence` tool — loads all existing steps from a Campaign as a flat array (for dedup context). Extends existing `getCampaignContext` tool.
2. Add `validateSequence` tool — calls `validateSequence()` from Phase 3. Returns `ValidationResult` to agent.
3. Update `WRITER_SYSTEM_PROMPT`: add self-review checklist section from Phase 2, add instruction to call `validateSequence` before `saveCampaignSequence`, add campaign-holistic awareness instruction ("load all steps before generating any step").
4. Add rewrite loop logic in system prompt: "If validateSequence returns violations, fix only the flagged steps and call validateSequence again. Maximum 2 validation loops. If still failing, save with violations recorded in reviewNotes."

No changes to `runner.ts`, `types.ts`, or any CLI scripts.

### Phase 5: Leads agent integration (depends on Phase 2)

Modify `src/lib/agents/leads.ts`:

1. Add `validateDiscoveryInputs` tool — pure TypeScript, no API calls. Validates: domain format, title sanity, ICP filter structure. Returns blockers vs warnings.
2. Add `checkPostSearchQuality` tool — queries staged/promoted results from DB, computes quality metrics, applies channel-specific thresholds.
3. Update leads system prompt to reference platform expertise from Phase 2, mandate validateDiscoveryInputs call before any search tool, mandate checkPostSearchQuality call after discovery-promote.

### Phase 6: Campaign pipeline validation (depends on Phases 4 + 5)

1. Add `channelMode` param to `delegateToLeads` in `orchestrator.ts`
2. Add company name normalization gate — new check in `validateDiscoveryInputs` for {COMPANYNAME} usage patterns
3. Update `approve-content` portal route to hard-block on violations (upgrade from warn-only)
4. Add list overlap detection — new tool in `campaign.ts` or utility function that checks if a TargetList shares >10% of people with an active campaign for the same workspace

### Phase 7: End-to-end validation (depends on all previous phases)

1. Run a full pipeline on a test workspace: discovery → quality gate → list build → write copy → validate → save
2. Verify AgentRun audit logs capture validation results
3. Confirm portal hard-block works on a seeded campaign with violations
4. Verify rewrite loop triggers and resolves on a campaign with deliberate violations

---

## Integration Points

### Validator Agent Integration Boundary

The Validator Agent is called as a TypeScript function (`validateSequence()`), not via the runner.ts pattern. This is intentional:

- It does not need an `AgentRun` audit record — it is a sub-call within the writer's run
- It uses `generateObject()` for structured output, not `generateText()` + JSON parsing
- It has no tools (no DB calls, no API calls) — it is stateless
- Its output feeds directly back into the writer's tool result, which IS logged in the writer's `AgentRun.steps`

```typescript
// How validator.ts exports:
export async function validateSequence(
  steps: (EmailStep | LinkedInStep)[],
  channel: "email" | "linkedin" | "email_linkedin",
  strategy: string,
  workspaceSlug: string
): Promise<ValidationResult>

// How writer.ts calls it:
const validateSequence = tool({
  description: "Validate the complete sequence before saving...",
  inputSchema: z.object({ steps: ..., channel: ..., strategy: ... }),
  execute: async ({ steps, channel, strategy }) => {
    return validateSequence(steps, channel, strategy, workspaceSlug);
  }
});
```

### copy-quality.ts Extension Boundary

The existing `BANNED_PATTERNS`, `checkCopyQuality()`, and `checkSequenceQuality()` are kept exactly as-is. New functions are additive exports:

- Existing callers (`saveDraft`, `saveCampaignSequence`, portal `approve-content`) continue working unchanged
- Validator Agent imports the new extended functions
- `approve-content` route upgrade (Phase 6) imports the same extended functions

### Rules File Boundary

Platform expertise lives in `.claude/rules/` files. This means:

- API agents load it via `loadRules("leads-rules.md")` at agent config construction time
- CLI skills load it via `!` file include in the skill `.md` files (already how they work)
- A single source of truth — no divergence between API path and CLI skill path
- Human-editable without a code deploy — admin can update filter recommendations as platforms evolve

### Platform Expertise vs KB Documents

Platform expertise belongs in **rules files**, not the knowledge base. The distinction:

- KB documents: campaign strategy, copy frameworks, industry insights — things agents search contextually
- Rules files: behavioral constraints, tool usage instructions, platform configuration — things agents load unconditionally at startup

Putting Prospeo filter guidance in a KB document would require a search step that might miss it. Loading it from `leads-rules.md` guarantees it is always in context.

### Portal Approval Hard-Block Boundary

The `approve-content` route upgrade (Phase 6) changes behavior: if `checkSequenceQuality()` returns violations, the route returns `HTTP 422` instead of `HTTP 200 + warnings`. The frontend must handle this:

- If the portal approval button currently ignores `copyQualityWarnings` in the response, the frontend needs a minor update to show an error state on 422
- This is a deliberate product decision: clients should not be able to approve copy with banned patterns. The quality gate is not optional at approval time.

### AgentRun Audit Trail

Validation results are captured in the writer's existing `AgentRun` record:

- `AgentRun.steps` JSON array will include the `validateSequence` tool call and its `ValidationResult`
- No new DB table needed — existing audit infrastructure captures it
- `reviewNotes` field in `WriterOutput` should include a summary of validation status

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (10 workspaces, ~5 campaigns/week) | Single Validator Agent call per campaign write. Haiku cost ~$0.002/campaign. Negligible. |
| 50 workspaces, 20 campaigns/week | Same architecture. Validator is stateless — scales horizontally. |
| Signal campaigns at scale (100+ auto-generated) | Validator call per sequence. At $0.002 each, 100 = $0.20. Still negligible. May want to run structural checks only (no Haiku) for auto-generated signal copy to reduce latency. |

### Scaling Priorities

1. **Rewrite loop depth** — Max 2 validation loops prevents infinite recursion. If a workspace consistently generates violations after 2 loops, this is a rules file problem (too strict) or a writer prompt problem (not understanding the rules), not a scaling problem.

2. **Validator latency** — Haiku 4.5 at ~500 input tokens + 200 output tokens takes ~1-2 seconds. Acceptable in a workflow where the writer already takes 20-60 seconds. If latency becomes a concern, the structural checks (deterministic) can be separated from the coherence check (LLM) and the coherence check made optional for fast iteration modes.

---

## Anti-Patterns

### Anti-Pattern 1: Validator Inside save-sequence.ts

**What people do:** Move the validator call into the CLI wrapper (`save-sequence.ts`) so it "always runs."

**Why it's wrong:** CLI wrappers are thin data bridges — no agent logic, no LLM calls. Putting a Haiku call inside a CLI script violates the tool boundary and makes it impossible to test the writer agent independently of the validator. It also makes the rewrite loop impossible — the CLI script would just return an error with no way to loop back into the writer.

**Do this instead:** Validator call lives in `writer.ts` as a tool. The writer controls the loop. CLI script saves the final approved output.

### Anti-Pattern 2: Separate Knowledge Base Documents for Platform Expertise

**What people do:** Create a KB document titled "Prospeo Best Practices" and have the leads agent search for it.

**Why it's wrong:** KB search is probabilistic — the agent might not search for it, might search with a bad query, or might get other results back. Platform expertise is mandatory pre-search context, not optional reference material.

**Do this instead:** Put it in `leads-rules.md`. It loads unconditionally every time the leads agent runs.

### Anti-Pattern 3: Blocking the Validator Agent with Tool Calls

**What people do:** Give the Validator Agent tools (KB search, workspace lookup) so it can "make smarter decisions."

**Why it's wrong:** A validator that can call external APIs is a second writer. It introduces latency, unpredictability, and scope creep. The validator's job is narrow: check the copy it was given against known rules. It needs no external context beyond what the writer passes in.

**Do this instead:** Pass any needed context from the writer (channel, strategy, workspace vertical) as input params. Validator is stateless and tool-free.

### Anti-Pattern 4: Hard-Blocking Saves on All Violations

**What people do:** Return `quality_violation` from `saveCampaignSequence` for every violation type — including warnings that are judgement calls (UK English, tone consistency).

**Why it's wrong:** The writer gets stuck in a rewrite loop on subjective issues. Admin frustration increases. Copy quality improves on the clear violations (banned phrases, word count) but degrades on the subjective ones as the writer tries to satisfy an overly strict gate.

**Do this instead:** Two tiers. Structural violations (banned phrases, word count, variable syntax, LinkedIn spintax) are blockers. Coherence issues (angle dedup, tone) are warnings that appear in `reviewNotes` but do not block the save.

### Anti-Pattern 5: Duplicating Quality Rules in Three Places

**What people do:** Copy-paste the banned phrases list into `writer-rules.md`, `validator.ts` system prompt, and `copy-quality.ts` BANNED_PATTERNS array.

**Why it's wrong:** Lists diverge. The `.md` files get updated but `copy-quality.ts` does not. Violations pass the LLM checks but fail the TypeScript check, or vice versa.

**Do this instead:** Single source of truth is `copy-quality.ts`. The `writer-rules.md` describes the rules in plain English for agent comprehension. The validator's system prompt says "run the extended check functions" rather than listing patterns. The TypeScript implementation is the canonical list.

---

## Sources

- Direct code inspection: `src/lib/agents/writer.ts`, `leads.ts`, `orchestrator.ts`, `runner.ts`, `types.ts`, `cli-spawn.ts`
- Direct code inspection: `src/lib/copy-quality.ts`
- Direct code inspection: `scripts/cli/save-draft.ts`, `save-sequence.ts`
- Direct code inspection: `src/app/api/portal/campaigns/[id]/approve-content/route.ts`
- Direct inspection: `.claude/rules/writer-rules.md`, `leads-rules.md`, `campaign-rules.md`
- Project context: `.planning/PROJECT.md` — v8.0 milestone Active requirements
- Architecture decision record: existing `ARCHITECTURE.md` for v7.0 baseline

---
*Architecture research for: v8.0 Agent Quality Overhaul — Outsignal agents*
*Researched: 2026-03-30*
