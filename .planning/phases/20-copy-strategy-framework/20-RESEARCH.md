# Phase 20: Copy Strategy Framework - Research

**Researched:** 2026-03-04
**Domain:** Writer Agent architecture — multi-strategy copy generation, KB tiered retrieval, groundedIn validation, signal-aware copy rules
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Strategy definitions (4 at launch):**
- Creative Ideas: 3 separate full email drafts (not 3 ideas in one email), each built around one idea grounded in a specific client offering. Admin picks the best variant.
- PVP (Problem-Value-Proof): classic Problem -> Value -> Proof framework. One email per sequence step.
- One-liner: short, punchy cold email format.
- Custom: admin provides a freeform text prompt describing their copy approach. Writer uses it as system instructions alongside KB best practices.

**KB Examples and Tagging:**
- Tags use strategy + industry (e.g. `creative-ideas-branded-merchandise`, `pvp-recruitment`) — NOT strategy + client slug. More reusable across clients in same vertical.
- Tiered retrieval: (1) match strategy + industry, (2) if none, strategy-only match, (3) if none, general KB best practices. Always consults general KB too.
- Writer cites sources — output includes a "References" section listing which KB docs influenced the copy.
- Start with curated set of examples per combo; data-driven optimization deferred to future phase.
- Ingestion via existing `scripts/ingest-document.ts` CLI with appropriate tags.

**groundedIn Validation (Creative Ideas only):**
- Hard reject: if writer can't trace an idea to a real client service/offering, it MUST NOT include that idea.
- Writer checks all sources: KB docs, onboarding document, workspace data (`coreOffers`, `differentiators`, etc.) to ground ideas.
- Partial output allowed: if only 1-2 ideas are groundable, output what it can with a note. Minimum 1 idea.
- `groundedIn` field is part of structured output, visible to admin for quality review.

**Signal-Aware Copy Rules:**
- Separate layer that applies on top of any strategy (not per-strategy rules).
- Never mention the triggering signal — writer infers relevance and picks the right angle/offering, frames as value not surveillance.
- Signal-type -> angle mapping: each signal type maps to a recommended copy angle (funding -> growth, hiring -> scaling, etc.). Guidance not rigid template.
- High-intent leads (2+ stacked signals): same professional tone, but writer picks the strongest angle from multiple signals. No urgency change.

**Ingestion:** Existing CLI script `scripts/ingest-document.ts` with appropriate tags.

**Campaign tracking (COPY-11, COPY-12):** Writer generates multiple strategy variants per campaign. Campaign tracks which strategy variant each lead receives.

### Claude's Discretion

- One-liner strategy output format and structure
- Exact signal-type -> angle mapping definitions (funding -> growth, hiring -> scaling, etc.)
- How the writer technically queries KB with tiered retrieval
- Sequence step structure for PVP campaigns
- Error handling when no KB examples exist for a strategy+industry combo

### Deferred Ideas (OUT OF SCOPE)

- Response-data-driven KB optimization (track which copy examples lead to better reply/interested rates)
- A/B testing framework for strategy variants
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| COPY-01 | Writer Agent supports multiple copy strategies (Creative Ideas, PVP, one-liner, custom) and admin/agent selects which to use per campaign | Strategy selection added to `WriterInput` type + Campaign model field; Writer system prompt updated with per-strategy instruction blocks |
| COPY-02 | Creative Ideas strategy generates 3 constrained, personalized ideas per prospect based on company research and client offerings | Creative Ideas block in system prompt generates 3 full drafts; each stored as a top-level variant; admin selects via `getExistingDrafts` or campaign UI |
| COPY-03 | Each Creative Idea is constrained to a specific client offering/capability (AI cannot make up services the client doesn't provide) | groundedIn validation block; writer must trace each idea to `coreOffers`, `differentiators`, or KB doc before outputting |
| COPY-04 | Ideas are personalized using prospect's company description, website analysis, and ICP data — not generic | `getWorkspaceIntelligence` already returns `websiteAnalysis`; prospectContext passed in WriterInput for personalization |
| COPY-05 | Writer produces both 3-idea format (full) and one-liner variant ("If I were looking at your business, I'd help by...") | One-liner is its own strategy mode, not a sub-variant of Creative Ideas; separate system prompt block |
| COPY-06 | Per-client copy examples stored in KB with strategy+industry tags; agent retrieves relevant examples for selected strategy | Tiered `searchKnowledgeBase` calls: tags=`{strategy}-{industry}`, then tags=`{strategy}`, then general; existing `searchKnowledge()` tag filter supports this |
| COPY-07 | AI generates draft copy examples from Research Agent website analysis; admin reviews and refines before ingestion | New tool `generateKBExamples` added to Writer Agent; output formatted for `ingest-document.ts` CLI; no schema changes required |
| COPY-08 | Writer validates `groundedIn` field for Creative Ideas — every idea must trace to a real client offering (hallucination prevention) | Explicit validation step in system prompt; `groundedIn` is a required structured output field; hard-reject path documented |
| COPY-09 | Signal-triggered emails use signals for timing only — signals are invisible to the recipient, copy leads with value | `signalContext` added to WriterInput (internal only); system prompt has explicit NO-MENTION rule + signal-type-to-angle mapping |
| COPY-10 | Writer consults full Knowledge Base (46+ docs) for best practices regardless of selected strategy | Always-call pattern: `searchKnowledgeBase` called once per run for general best practices before strategy-specific KB search |
| COPY-11 | Writer generates multiple strategy variants for the same campaign (e.g., Creative Ideas vs PVP vs one-liner) for A/B split testing | Orchestrator can call Writer Agent multiple times with different `copyStrategy` values for same campaignId; sequences stored under separate keys |
| COPY-12 | Campaign tracks which strategy variant each lead receives so performance can be compared per strategy | `copyStrategy` field added to `Campaign` model; schema migration needed |
</phase_requirements>

## Summary

Phase 20 extends the existing Writer Agent (`src/lib/agents/writer.ts`) with a multi-strategy copy framework. The existing agent is already well-structured: it has `WriterInput`/`WriterOutput` typed interfaces, a tool set (getWorkspaceIntelligence, searchKnowledgeBase, saveCampaignSequence), and a long system prompt that currently implements a single implicit strategy (PVP-ish with quality rules). The task is to extend — not rewrite — these primitives.

The three areas of new engineering are: (1) adding `copyStrategy` and `signalContext` fields to `WriterInput` and the `Campaign` Prisma model; (2) restructuring the Writer's system prompt into strategy-specific instruction blocks that activate based on the selected strategy; and (3) implementing tiered KB retrieval so the agent first searches for strategy+industry examples, then strategy-only, then general best practices. The groundedIn validation for Creative Ideas is a system-prompt-level constraint with no new tooling — it relies on existing `getWorkspaceIntelligence` data (`coreOffers`, `differentiators`, `caseStudies`, `painPoints`) which is already returned.

Signal-aware copy is a thin overlay: pass `signalContext` in WriterInput (never shown to recipient), and add a system-prompt section that maps signal types to copy angles. No new tools or schema changes beyond `Campaign.copyStrategy`.

**Primary recommendation:** Extend existing primitives (WriterInput, writer.ts system prompt, Campaign schema) rather than building new agent infrastructure. The current agent architecture handles this cleanly with prompt restructuring + one schema migration.

## Standard Stack

### Core (already in use — no new installs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ai` (Vercel AI SDK) | Current | Agent runner, tool definitions, `generateText` | Already powering all agents |
| `@ai-sdk/anthropic` | Current | Claude model provider | Project standard |
| `zod` v3 | Current | Schema validation for tool inputs | Project standard; v3 not v4 (confirmed by Phase 18 decision) |
| `@prisma/client` | v6 | DB access; schema migration for `copyStrategy` field | Project standard |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `scripts/ingest-document.ts` | N/A (existing CLI) | Ingest strategy+industry example docs to KB | Used to add curated Creative Ideas + PVP examples per industry |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| System prompt strategy blocks | Separate agent per strategy | Separate agents = 4x infra complexity; prompt blocks are simpler and keep all quality rules shared |
| Tiered `searchKnowledgeBase` calls | Single search with complex tag logic | Tiered calls are explicit and debuggable; agent self-documents which tier matched |
| `groundedIn` as prompt constraint only | Separate validation tool | Prompt constraint is sufficient; no external validation needed since coreOffers data is in workspace intel |

**Installation:** No new packages required.

## Architecture Patterns

### Recommended File Changes

```
src/
├── lib/agents/
│   ├── writer.ts          # PRIMARY: strategy blocks, tiered KB, signal overlay, groundedIn
│   └── types.ts           # WriterInput adds copyStrategy + signalContext; WriterOutput adds groundedIn + strategyRefs
├── lib/campaigns/
│   └── operations.ts      # saveCampaignSequences: accept copyStrategy; getCampaign returns it
prisma/
└── schema.prisma          # Campaign model: add copyStrategy String? field
```

### Pattern 1: Strategy Selection via WriterInput

**What:** `copyStrategy` is added to `WriterInput` as an enum; it flows into the user message passed to the agent; the system prompt has separate instruction sections per strategy activated by recognizing the strategy name in the message.

**When to use:** Whenever the Orchestrator or CLI delegates to the Writer.

**Example:**

```typescript
// types.ts
export interface WriterInput {
  workspaceSlug: string;
  task: string;
  channel?: "email" | "linkedin" | "email_linkedin";
  campaignName?: string;
  campaignId?: string;
  feedback?: string;
  stepNumber?: number;
  // NEW in Phase 20:
  copyStrategy?: "creative-ideas" | "pvp" | "one-liner" | "custom";
  customStrategyPrompt?: string; // only for copyStrategy="custom"
  signalContext?: SignalContext;  // internal only, never shown to recipient
}

export interface SignalContext {
  signalType: "job_change" | "funding" | "hiring_spike" | "tech_adoption" | "news" | "social_mention";
  companyDomain: string;
  companyName?: string;
  isHighIntent: boolean; // 2+ stacked signals
}
```

```typescript
// buildWriterMessage() in writer.ts — append strategy context
if (input.copyStrategy) {
  parts.push(`Copy strategy: ${input.copyStrategy}`);
}
if (input.copyStrategy === "custom" && input.customStrategyPrompt) {
  parts.push(`Custom strategy instructions:\n${input.customStrategyPrompt}`);
}
if (input.signalContext) {
  // Internal context — writer uses for angle selection, never for recipient-facing copy
  parts.push(`[INTERNAL SIGNAL CONTEXT — never mention to recipient]`);
  parts.push(`Signal type: ${input.signalContext.signalType}`);
  parts.push(`Target company: ${input.signalContext.companyName ?? input.signalContext.companyDomain}`);
  parts.push(`High intent: ${input.signalContext.isHighIntent}`);
}
```

### Pattern 2: System Prompt Strategy Blocks

**What:** The Writer system prompt gains a `## Copy Strategies` section with a block per strategy. The agent reads which strategy is selected and follows only that block's rules. Shared quality rules (word count, no em dashes, variables, spintax, etc.) remain universal and are listed separately.

**When to use:** Always active in the Writer Agent.

**System prompt structure:**

```
## Copy Strategies

When "Copy strategy: [name]" appears in your task, follow the rules for that strategy.
If no strategy is specified, default to PVP.

### PVP (Problem-Value-Proof)
- Structure: Problem (why them, their pain) -> Value (what you offer) -> Proof (evidence)
- Generate one sequence: {N} steps, each with its own angle
- Each step: new proof point or angle, never repeat the same pitch
- [existing PVP rule from current prompt quality rule #9]

### Creative Ideas
- Generate EXACTLY 3 full email drafts (each is a standalone email, not 3 ideas in one email)
- Each draft must be built around ONE distinct idea grounded in a specific client offering
- REQUIRED: groundedIn field for each draft. Format: "Idea 1: {idea title} — grounded in: {exact offering from coreOffers/differentiators}"
- groundedIn VALIDATION (hard rule): before outputting a draft, verify you can trace the idea to:
  (a) a named offering in `coreOffers`, OR
  (b) a differentiator in `differentiators`, OR
  (c) a case study in `caseStudies`, OR
  (d) a KB doc retrieved via searchKnowledgeBase
  If you CANNOT trace the idea, DO NOT output that draft. Output fewer than 3 if needed (minimum 1).
- Personalization: use company description from `websiteAnalysis`, ICP data, and prospect context
- Admin picks the best variant — do not combine them into one email

### One-liner
- One short, punchy email per sequence step. Under 50 words.
- Format: "If I were looking at your business, I'd [specific observation] — we help [ICP] with [outcome]."
- No PVP structure. Leads with a specific insight, ends with a soft question CTA.
- [Claude's discretion on exact format — research recommendation below]

### Custom
- Admin has provided custom strategy instructions in the message under "Custom strategy instructions:"
- Follow those instructions as your primary writing framework
- Still apply all shared quality rules (word count, no em dashes, variables, spintax, CTAs, banned phrases)
- Still consult the full Knowledge Base for best practices

## Signal-Aware Copy Rules (applies to ALL strategies when signal context is present)

When [INTERNAL SIGNAL CONTEXT] appears in your task:
- This signal is WHY NOW — use it to select the most relevant client offering/angle
- NEVER mention the signal to the recipient ("I saw you raised a round", "I noticed you're hiring" — FORBIDDEN)
- Signal type -> copy angle mapping:
  - job_change: new leader, new priorities angle — offer fresh perspective / quick wins
  - funding: growth + scale angle — offer capacity/infrastructure to support growth
  - hiring_spike: scaling pains angle — offer efficiency/quality in whatever you provide
  - tech_adoption: modernization angle — offer alignment with their tech direction
  - news / social_mention: awareness + relevance angle — offer a specific solution to the discussed challenge
- High intent (2+ signals): pick the STRONGEST single angle, do not reference multiple signals
- Frame as value, not surveillance: "Companies scaling their sales team often need..." not "I saw you're hiring 5 SDRs..."
```

### Pattern 3: Tiered KB Retrieval

**What:** The agent calls `searchKnowledgeBase` multiple times per run: once for strategy+industry specific examples, once for strategy-only if no results, and once for general best practices. This replaces the current single-call pattern.

**When to use:** Every Writer Agent run, inside the process step before generating copy.

**Implementation in system prompt:**

```
## Your Process (updated)

### Step 1: Load workspace intelligence
Call getWorkspaceIntelligence. Note the workspace vertical (e.g. "Recruitment Services", "Branded Merchandise").

### Step 2: Tiered KB consultation (ALWAYS do all three searches)
a) Search for strategy + industry examples:
   searchKnowledgeBase(query="[strategy] examples [industry]", tags="[strategy-slug]-[industry-slug]")
   e.g. tags="creative-ideas-branded-merchandise"
b) If step (a) returns 0 results, search strategy-only:
   searchKnowledgeBase(query="[strategy] cold email examples", tags="[strategy-slug]")
c) Always search general best practices (regardless of a/b results):
   searchKnowledgeBase(query="cold email best practices subject lines follow-up personalization")

### Step 3: Gather campaign context
[existing steps for getCampaignContext, getCampaignPerformance, getExistingDrafts]

### Step 4: Generate copy following your selected strategy block
...

### Step 5: Save and include references
After saving, output a "References" section listing which KB docs influenced the copy.
Format: "References: [doc title] (strategy examples), [doc title] (best practices)"
```

**Tag naming convention for KB ingestion:**

| Tag | Example | Used for |
|-----|---------|---------|
| `creative-ideas-{industry-slug}` | `creative-ideas-branded-merchandise` | Strategy + industry specific examples |
| `pvp-{industry-slug}` | `pvp-recruitment` | PVP examples for industry |
| `one-liner-{industry-slug}` | `one-liner-b2b-lead-generation` | One-liner examples |
| `creative-ideas` | `creative-ideas` | Strategy-only fallback |
| `pvp` | `pvp` | PVP strategy-only fallback |

Industry slugs derived from `workspace.vertical`: lowercase, spaces to hyphens, strip special chars.
Example: "B2B Lead Generation" -> `b2b-lead-generation`, "Recruitment Services" -> `recruitment`, "Branded Merchandise" -> `branded-merchandise`.

### Pattern 4: groundedIn in Structured Output

**What:** `WriterOutput` gains a `creativeIdeas` array field for Creative Ideas strategy, each with a `groundedIn` field. `saveCampaignSequence` tool gains an optional `groundedIn` parameter per step.

**When to use:** Only when `copyStrategy === "creative-ideas"`.

```typescript
// types.ts additions
export interface CreativeIdeaDraft {
  position: number;         // 1, 2, or 3
  title: string;            // Short idea title (admin sees this when picking)
  groundedIn: string;       // "Exact offering name from coreOffers: ..."
  subjectLine: string;
  subjectVariantB?: string;
  body: string;
  notes: string;
}

export interface WriterOutput {
  campaignName: string;
  channel: "email" | "linkedin" | "email_linkedin";
  emailSteps?: EmailStep[];
  linkedinSteps?: LinkedInStep[];
  creativeIdeas?: CreativeIdeaDraft[]; // populated when strategy=creative-ideas
  strategy?: string;                   // which strategy was used
  references?: string[];               // KB docs cited
  reviewNotes: string;
}
```

### Pattern 5: Campaign Schema Extension

**What:** `Campaign` model gets a `copyStrategy` string field to track which strategy was used to generate the campaign's sequences. This enables COPY-12 (performance comparison per strategy) without blocking Phase 20 implementation.

**When to use:** Set when Writer saves sequences via `saveCampaignSequence`.

```prisma
// schema.prisma addition to Campaign model
copyStrategy String? // "creative-ideas" | "pvp" | "one-liner" | "custom" | null (legacy)
```

**Migration:** `prisma db push` (consistent with project pattern — no migration history, db push used throughout).

### Pattern 6: COPY-07 — AI-Generated KB Examples

**What:** A new `generateKBExamples` tool in the Writer Agent generates draft copy examples from existing workspace intelligence + website analysis. Output is formatted for admin review before ingestion via the existing CLI.

**When to use:** When admin asks "generate KB examples for [workspace] using [strategy]".

**Implementation:** This is a Writer Agent tool (not a standalone script) that:
1. Calls `getWorkspaceIntelligence`
2. Writes 2-3 example emails using the requested strategy, grounded in client offerings
3. Returns formatted text ready for copy-paste into a `.md` file for `ingest-document.ts`
4. No auto-ingestion — admin reviews first

### Anti-Patterns to Avoid

- **Separate Writer Agent per strategy:** 4x code duplication, all quality rules must be maintained in 4 places. One agent with strategy-aware prompt is correct.
- **Auto-ingesting generated KB examples:** Admin review is required before ingestion. Output to console/text, not directly to DB.
- **Exposing signalContext to the recipient:** The signal context must never appear in any email body or subject line. It is internal routing information only.
- **Failing entirely if groundedIn validation fails all 3 ideas:** Partial output (1-2 ideas) is correct behavior. Only fail if 0 ideas are groundable.
- **Using `tags` as exact-match filter:** `searchKnowledge()` uses `LIKE "%tag%"` substring matching. A doc tagged `creative-ideas-branded-merchandise` will match query for `creative-ideas`. This is intentional and means tiered retrieval works correctly.
- **Merging the 3 Creative Ideas into one email:** Each idea must be a separate, standalone full email draft. Admin picks one.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Strategy routing | Custom dispatcher class | System prompt strategy blocks + `copyStrategy` in user message | Agent reads natural language; no code routing needed |
| groundedIn validation | Separate LLM call or tool | Inline system prompt constraint + structured output field | Workspace data is already loaded in `getWorkspaceIntelligence`; no extra roundtrip |
| KB tag-based retrieval | Custom tag-match query | Existing `searchKnowledge(query, { tags })` with LIKE filter | Already works — tags are comma-separated and LIKE-matched |
| Strategy examples storage | Separate table | KnowledgeDocument with strategy+industry tags | KB already has embedding + keyword fallback; new table adds no value |
| Signal angle mapping | Hardcoded map object in code | System prompt signal-type mapping table | Agent needs flexibility; prompt table is more maintainable and overridable |

**Key insight:** This phase is primarily a system prompt engineering problem with a thin schema change. The existing agent infrastructure handles all the hard parts.

## Common Pitfalls

### Pitfall 1: Tag Substring Collision
**What goes wrong:** A doc tagged `pvp` matches when searching for `pvp-recruitment` because LIKE `%pvp%` matches both. Strategy-only results bleed into strategy+industry results.
**Why it happens:** `searchKnowledge()` uses `LIKE "%tag%"` which is a substring match, not exact tag matching.
**How to avoid:** Make strategy+industry search the first tier, check result count before falling back. If results > 0 for `pvp-recruitment`, use those. Don't merge tier-1 and tier-2 results — use tier-1 if results found.
**Warning signs:** KB search always returning results regardless of tier (never hitting the fallback).

### Pitfall 2: groundedIn Hallucination
**What goes wrong:** Writer generates an idea "grounded in" a service the client doesn't offer (e.g. "AI-powered analytics" when coreOffers only lists "branded merchandise").
**Why it happens:** LLM confabulation under creative pressure to produce 3 ideas.
**How to avoid:** System prompt must explicitly list the workspace's `coreOffers` as the allowed grounding sources. Writer must quote the specific offering name verbatim in the `groundedIn` field. Admin sees this field and can reject.
**Warning signs:** `groundedIn` contains vague phrases like "based on their expertise" instead of a specific named offering.

### Pitfall 3: Signal Leaking into Recipient Copy
**What goes wrong:** Writer mentions "I saw your company raised a Series B" or "noticed you're hiring 10 engineers" in the email body.
**Why it happens:** Signal context is provided as internal context but the writer includes it verbatim.
**How to avoid:** Signal context section in user message must be clearly labeled `[INTERNAL — never mention to recipient]`. System prompt must state this as a hard rule before discussing signal-to-angle mapping.
**Warning signs:** Any email body containing phrases like "I saw", "I noticed", "I heard", "your recent", or the signal source name.

### Pitfall 4: Creative Ideas Variant Count Failure
**What goes wrong:** Writer outputs 1 idea when it should output 3, or combines 3 ideas into one email.
**Why it happens:** Default writer behavior collapses sequences; "3 ideas" is misinterpreted as "mention 3 things".
**How to avoid:** System prompt must say "3 SEPARATE full email drafts" explicitly. Each draft has its own subject line, body, and groundedIn field. Use numbered sections (Draft 1, Draft 2, Draft 3).
**Warning signs:** Single email with a list of 3 bullet points, or only 1 draft in the creativeIdeas array.

### Pitfall 5: Strategy Falls Back to PVP Without Notice
**What goes wrong:** User requests Creative Ideas strategy but gets PVP output because strategy wasn't passed to the agent correctly.
**Why it happens:** `copyStrategy` not threaded through from Orchestrator -> WriterInput -> buildWriterMessage -> user message.
**How to avoid:** Verify the full data flow: `delegateToWriter` tool in orchestrator.ts must accept and pass `copyStrategy`; `buildWriterMessage` must include it in the text; system prompt must trigger the strategy block on the keyword.
**Warning signs:** Agent output has `strategy: "pvp"` even when `creative-ideas` was requested.

### Pitfall 6: PVP Conflict with Quality Rule #9
**What goes wrong:** Existing system prompt quality rule #9 says "Structure every cold email as Relevance -> Value -> Pain" which is a close variant of PVP. This will conflict when other strategies (Creative Ideas, One-liner) are active.
**Why it happens:** Current prompt was written before multi-strategy was planned. Quality rule #9 is a global rule that overrides strategy blocks.
**How to avoid:** Quality rule #9 must be moved from universal rules into the PVP strategy block specifically. Other strategies override this structure. This is a critical prompt refactor.
**Warning signs:** Creative Ideas emails following PVP structure despite no PVP selection.

## Code Examples

### searchKnowledgeBase tiered retrieval (in system prompt instructions)

The agent is guided to make 3 KB calls in sequence. In the system prompt:

```
## Step 2: Tiered KB consultation (ALWAYS complete all three)

Call 1 — Strategy + industry (most specific):
  searchKnowledgeBase({ query: "creative ideas branded merchandise cold email examples", tags: "creative-ideas-branded-merchandise", limit: 5 })

Call 2 — Strategy only (if Call 1 returns 0 results):
  searchKnowledgeBase({ query: "creative ideas cold email examples", tags: "creative-ideas", limit: 5 })

Call 3 — General best practices (always, regardless of Call 1/2):
  searchKnowledgeBase({ query: "cold email best practices subject lines personalization follow-up", limit: 8 })
```

### delegateToWriter extended (orchestrator.ts)

```typescript
const delegateToWriter = tool({
  description: "Delegate to the Writer Agent...",
  inputSchema: z.object({
    workspaceSlug: z.string(),
    task: z.string(),
    channel: z.enum(["email", "linkedin", "email_linkedin"]).optional(),
    campaignName: z.string().optional(),
    campaignId: z.string().optional(),
    feedback: z.string().optional(),
    // NEW in Phase 20:
    copyStrategy: z.enum(["creative-ideas", "pvp", "one-liner", "custom"]).optional(),
    customStrategyPrompt: z.string().optional(),
    signalContext: z.object({
      signalType: z.string(),
      companyDomain: z.string(),
      companyName: z.string().optional(),
      isHighIntent: z.boolean(),
    }).optional(),
  }),
  execute: async ({ ..., copyStrategy, customStrategyPrompt, signalContext }) => {
    const result = await runWriterAgent({
      ..., copyStrategy, customStrategyPrompt, signalContext,
    });
    return { status: "complete", strategy: result.strategy, ... };
  },
});
```

### Campaign schema migration (prisma/schema.prisma)

```prisma
model Campaign {
  // ... existing fields ...
  copyStrategy String? // "creative-ideas" | "pvp" | "one-liner" | "custom" | null (legacy)
}
```

Applied via: `cd /Users/jjay/programs/outsignal-agents && npx prisma db push`

### ingest-document.ts — example KB example ingestion

```bash
# After admin generates and reviews the copy examples:
npx tsx scripts/ingest-document.ts docs/rise-creative-ideas-examples.md \
  --title "Creative Ideas Examples: Branded Merchandise (Rise)" \
  --tags "creative-ideas,creative-ideas-branded-merchandise"

npx tsx scripts/ingest-document.ts docs/lime-pvp-examples.md \
  --title "PVP Examples: Recruitment Services (Lime)" \
  --tags "pvp,pvp-recruitment"
```

### One-liner strategy format (Claude's discretion — recommended)

Based on the context description ("If I were looking at your business, I'd help by..."), the recommended format:

```
Subject: one thing for {COMPANYNAME}

{FIRSTNAME},

If I were looking at {COMPANYNAME}, I'd [specific observation about their likely pain/situation]. We help [ICP description] [outcome in 10 words or fewer].

Worth 15 minutes?

[Sender]
```

- Under 50 words total
- Opens with a specific observation (not generic flattery)
- Ends with a soft single-question CTA
- No PVP structure — pure curiosity/relevance hook

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single implicit PVP strategy | Explicit strategy selection per campaign | Phase 20 | Admin can match copy style to ICP and campaign type |
| Generic KB search (any docs) | Tiered strategy+industry KB search | Phase 20 | More relevant examples fetched; fallback chain prevents empty results |
| No groundedIn constraint | Hard groundedIn validation per Creative Idea | Phase 20 | Eliminates hallucinated services in client-facing copy |
| Signal context unused by Writer | Signal-to-angle mapping, internal only | Phase 20 | Signal-triggered copy selects right angle without mentioning the signal |

**Deprecated/outdated in Phase 20:**
- Quality rule #9 ("Structure every cold email as Relevance -> Value -> Pain") must be moved from universal rules to PVP-only. It is incompatible with Creative Ideas and One-liner strategies.
- `generate-copy.ts` CLI script has its own inline system prompt — it will need updating to match the new Writer strategy prompt. (Low priority; primary path is via Orchestrator and `writer.ts`.)

## Open Questions

1. **Where do strategy+industry KB example docs come from initially?**
   - What we know: the ingest CLI exists; 6 client workspaces exist with known verticals (Branded Merchandise, Recruitment, Architecture PM, B2B Lead Generation, Business Acquisitions, Umbrella Company Solutions)
   - What's unclear: Does the admin want to manually write these, or use COPY-07 (AI-generated examples) first, then refine?
   - Recommendation: COPY-07 tool implementation (generateKBExamples) should be in the first plan wave so admin can generate examples before they are needed. Ingestion is manual CLI; no auto-ingestion.

2. **Should `saveCampaignSequence` store Creative Ideas variants as separate sequences or as a special field?**
   - What we know: `Campaign.emailSequence` is a single JSON column. Creative Ideas produces 3 full draft variants.
   - What's unclear: Should all 3 be stored for admin to pick from? Or should only the admin-selected one be saved?
   - Recommendation: Store all 3 as an array in `Campaign.emailSequence` where each element has a `variantIndex` (1, 2, 3) and `groundedIn` field. Admin picks one via the portal or chat. This keeps schema changes minimal (no new column) while preserving all drafts for review.

3. **How does the Orchestrator know the workspace's vertical for passing to the Writer for tag construction?**
   - What we know: `Workspace.vertical` is a string field (e.g. "Branded Merchandise"); `getWorkspaceIntelligence` returns it.
   - What's unclear: Should the Orchestrator pass the industry slug pre-computed, or should the Writer derive it from workspace data?
   - Recommendation: Let the Writer derive it from `workspace.vertical` returned by `getWorkspaceIntelligence`. No need to pass from Orchestrator. Industry slug transformation (lowercase, spaces to hyphens) lives in the Writer's system prompt instructions.

4. **COPY-11 — how to generate multiple strategy variants per campaign?**
   - What we know: REQUIREMENTS.md lists COPY-11 as Phase 20 scope. Phase 20 requirement IDs include COPY-11 and COPY-12.
   - What's unclear: Does this require a new Orchestrator tool, or is it just calling `delegateToWriter` N times with different strategies?
   - Recommendation: No new tool needed. Orchestrator calls `delegateToWriter` 2-3 times with different `copyStrategy` values for the same `campaignId`. Each call saves sequences under different variant labels. `Campaign.copyStrategy` stores the primary strategy; variants are labeled in sequence step `notes` fields. This is simpler than a parallel execution API.

## Sources

### Primary (HIGH confidence)

- Codebase direct read — `src/lib/agents/writer.ts`: current Writer Agent tools, system prompt, input/output types
- Codebase direct read — `src/lib/agents/types.ts`: WriterInput, WriterOutput, AgentConfig interfaces
- Codebase direct read — `src/lib/knowledge/store.ts`: `searchKnowledge()` tag filter implementation (`LIKE "%tag%"`)
- Codebase direct read — `prisma/schema.prisma`: Campaign model structure, KnowledgeDocument tags field
- Codebase direct read — `.planning/phases/20-copy-strategy-framework/20-CONTEXT.md`: all locked decisions
- Codebase direct read — `.planning/REQUIREMENTS.md`: COPY-01 through COPY-12 definitions
- Codebase direct read — `.planning/STATE.md`: accumulated project decisions (Zod v3, db push pattern, no auth guards)
- Live DB query — knowledge base document inventory: 70 documents, no strategy-specific tags yet (all general cold-email/linkedin/clay tags)

### Secondary (MEDIUM confidence)

- Phase 18 decision log (STATE.md): Zod v3 pattern confirmed for this project (not Zod v4)
- Phase 15 decision log (STATE.md): `prisma db push` is the schema migration method (no migration history)

### Tertiary (LOW confidence)

- One-liner format recommendation: derived from CONTEXT.md description ("If I were looking at your business, I'd help by...") + general cold email best practices from existing KB docs — specific format at Claude's discretion

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; all existing primitives confirmed in codebase
- Architecture: HIGH — direct analysis of writer.ts, types.ts, store.ts, schema.prisma
- Pitfalls: HIGH (PVP conflict, groundedIn hallucination) / MEDIUM (tag collision, signal leak) — derived from reading the actual code and KB infrastructure
- KB tag current state: HIGH — live DB query confirmed 0 strategy-specific tags exist yet; all Phase 20 KB seeding is greenfield

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable codebase, no fast-moving external dependencies)
