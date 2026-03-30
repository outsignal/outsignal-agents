# Feature Research

**Domain:** AI Agent Quality Systems — Cold Outreach Lead Engine (v8.0 Overhaul)
**Researched:** 2026-03-30
**Confidence:** HIGH (existing codebase well-understood; patterns from verified sources; benchmarks from industry data)

---

## Context: What Already Exists

This is a v8.0 overhaul of an existing system. The features below are net-new additions to an established agent architecture:

- **Writer agent** — 4 copy strategies, 13 banned patterns in copy-quality.ts, sequence generation
- **Leads agent** — Discovery plan → approve → execute flow, 8+ discovery sources, staging table promotion
- **Campaign agent** — Campaign lifecycle, target list linking, publish for approval flow
- **13 banned patterns** already enforced in `copy-quality.ts` (runtime check, not agent-side)
- **Per-workspace memory** — `.nova/memory/{slug}/` flat files (profile, campaigns, feedback, learnings)
- **CLI wrapper scripts** — 55 scripts in `scripts/cli/` giving agents DB/API access

The overhaul adds quality **gates** to the existing pipeline — not new pipelines.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features the admin already assumes exist based on the v7.0 CLI agent architecture. Missing these means the overhaul doesn't deliver on its promise.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Writer mandatory self-review before save | Writer currently generates and saves without structured self-check — violations only caught post-save at runtime | MEDIUM | In-prompt review checklist covering all 12 quality rules from writer-rules.md before `save-draft.js` runs |
| Automatic rewrite loop on violations | If writer catches a violation in self-review, it must fix it without human intervention | MEDIUM | Existing runner.ts supports multi-step; add a convention: generate → check → rewrite loop, max 3 iterations, escalate if still failing |
| Post-search data quality report | After discovery executes, admin needs to know: how many have valid emails, how many have LinkedIn URLs, how many passed ICP filter | LOW | Already have per-source breakdown; extend `discovery-promote.js` output to include field-coverage stats |
| Channel-aware enrichment routing | LinkedIn-only campaigns must not waste credits on email verification; email campaigns must require it | LOW | Add `channel` param to leads agent enrichment path; skip email API calls if channel=linkedin |
| List overlap detection before campaign creation | Admin needs to know if a list being used in a new campaign already exists in another active campaign | LOW | DB query on PersonWorkspace junction + Campaign.targetListId; surface as warning, not blocker |
| Company name normalisation gate | {COMPANYNAME} variable is the most common failure mode in copy; a gate before save is expected | LOW | Extend copy-quality.ts pattern check; also add writer rule to call `workspace-intelligence.js` normalizationPrompt before inserting company names |
| Cost estimate before paid API calls | Admin expects to see "this will cost ~$X and use Y credits" before any paid discovery runs | LOW | Already partially in discovery plan; formalise as a required field in plan output |
| Credit spend report after discovery | Total cost per discovery run, broken down by source, should be logged to the campaign/run record | LOW | `PROVIDER_COSTS` already exists in `src/lib/enrichment/costs.ts`; extend to sum per discovery run |

### Differentiators (Competitive Advantage)

Features that go beyond what any competitor platform offers today. These are the reason v8.0 exists.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| LLM-as-Judge validator agent | Separate Haiku-based agent that reviews writer output against all quality rules before save — catches semantic violations (filler spintax, weak CTAs, generic copy) that regex cannot catch | HIGH | Separate agent invocation in runner; writer generates, validator scores 0-100 with explicit pass/fail per rule, writer rewrites if score < 85. Use Haiku for cost efficiency. Requires own `.claude/rules/validator-rules.md` |
| Campaign-holistic copy awareness | Writer sees ALL existing steps in the campaign before generating new ones — prevents angle repetition, ensures natural follow-up progression, catches duplicate CTAs | MEDIUM | Pass full campaign context (all existing sequences) in writer system prompt via `campaign-context.js` output; writer must explicitly reference prior angles before writing new ones |
| Expert-level platform recommendations | Leads agent recommends specific platforms with reasoning ("use Prospeo here because they support SIC codes for your manufacturing ICP; skip Apollo for this niche as coverage is weak") rather than always defaulting to all three | HIGH | Add `platform-expertise.md` knowledge file to leads agent context; encode platform-specific capabilities, known strengths/weaknesses per ICP type, verified vs unverified handling |
| Cross-campaign CTA and angle dedup | Writer checks existing campaigns for the same ICP before writing — if another campaign already uses the "scaling pain" angle and "worth a chat?" CTA, it picks a different angle automatically | HIGH | New CLI script `existing-campaign-copy.js --slug {slug} --icp {description}` returns angles/CTAs used in recent campaigns for the workspace; writer must treat these as taken |
| Filler spintax auto-detection and removal | Systematic detection of spintax variants that are semantically interchangeable — the most violated rule in the current system; regex cannot catch this | MEDIUM | Add LLM-based spintax evaluation to the validator: for each `{A|B}` pair, evaluate "does swapping A for B change the meaning?" — if no, it is filler and must be rewritten |
| Pre-search input validation | Before executing paid API calls, validate filters for internal consistency: company domain searches on Apollo do not use keyword filters; Prospeo does not support certain filter combos; catch these before credits are spent | MEDIUM | Add validation function `validateDiscoveryFilters(source, filters)` in discovery adapters; return warnings before execution |
| Validator reviews specialist agent output before save | No generated output (leads, copy, campaign config) reaches the database without a structured validation step that produces explicit PASS/FAIL with reasons | HIGH | Implement the Executor → Validator pattern: each specialist agent produces output, a lightweight validator agent checks it against defined rules before the save tool call executes |
| Sequential pipeline with explicit stage gates | Each stage (discover → promote → enrich → qualify → list → copy → validate → publish) is explicit; gate function evaluated before handoff; failures surface at the correct stage rather than cascading | HIGH | Formalise as a pipeline state machine — add `PipelineStage` enum and gate functions in `src/lib/pipeline/`; each stage produces a gated result with PASS/WARN/FAIL status |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Hard-block on validator failure | "Don't let bad copy through ever" | Creates a stuck pipeline if writer fails 3 rewrites — admin gets no output and no way to proceed; review fatigue if thresholds too tight | Soft-block with escalation: after 3 rewrites, save as DRAFT with violations flagged, notify admin to review manually. Never silently discard work |
| Fully autonomous validator-to-deployment | "Agent should deploy without human review" | Removes the dual-approval gate that is a core product promise; clients expect to review before deployment | Keep validator as a pre-save gate only; client approval gate stays mandatory downstream |
| Per-lead approve/reject in validator | "Let me review each flagged lead" | Already out of scope (PROJECT.md); binary list-level approval is intentional to keep portal UX clean | List-level threshold (e.g., reject list if <60% verified emails) is the right lever |
| Expand BANNED_PATTERNS regex to 50+ patterns | "More patterns = better quality" | Pattern bloat causes false positives on legitimate copy; regex cannot catch context — "no worries" in a specific reassurance context may be appropriate | Keep regex for unambiguous cases; use LLM judge for nuanced semantic violations |
| Real-time copy quality score during editing | "Show quality score as I review" | This is an operations tool, not a CMS; the admin reviews agent output, not edits it inline | Quality gates are pre-save; admin reviews results, not scores |
| Automatic A/B variant generation on every campaign | "Always give me two options" | Writer currently generates one angle per call by design; automatic double-generation doubles cost and creates decision paralysis | Keep explicit: admin requests variant with "write another angle" |
| Global discovery filters applied to all workspaces | "Set ICP filters once, use everywhere" | Each workspace has a distinct ICP; global filters silently produce wrong leads for some clients | Per-workspace discovery defaults stored in workspace profile; no global filter inheritance |

---

## Feature Dependencies

```
[Campaign-Holistic Copy Awareness]
    └──requires──> [campaign-context.js already returns full sequence list] (already built)
    └──requires──> [Writer system prompt includes all prior steps] (new: pass full context)

[LLM-as-Judge Validator Agent]
    └──requires──> [Campaign-Holistic Copy Awareness] (validator needs full campaign context to check angle repetition)
    └──requires──> [Dedicated validator rules file: .claude/rules/validator-rules.md] (new file)
    └──enhances──> [Writer mandatory self-review] (validator catches what self-review misses)

[Cross-Campaign CTA and Angle Dedup]
    └──requires──> [existing-campaign-copy.js CLI script] (new script needed)
    └──requires──> [Campaign-Holistic Copy Awareness]

[Automatic Rewrite Loop]
    └──requires──> [Writer mandatory self-review] (review must run before rewrite is triggered)
    └──requires──> [max iteration guard in runner.ts] (prevent infinite loops — add rewriteCount param)

[Channel-Aware Enrichment Routing]
    └──requires──> [Campaign entity has channel field] (already exists on Campaign model)
    └──requires──> [Leads agent receives campaign channel context] (new: pass channel to discovery plan)

[Sequential Pipeline State Machine]
    └──requires──> [All individual gate functions to exist first] (cannot formalise until gates exist)
    └──requires──> [Post-search quality report] (first gate)
    └──requires──> [Channel-aware enrichment routing] (second gate)
    └──requires──> [Writer self-review + validator] (third gate)

[Unverified Email Rescue via BounceBan]
    └──requires──> [Channel-aware enrichment routing] (only runs for email campaigns)
    └──requires──> [BounceBan adapter] (new provider adapter in src/lib/enrichment/)

[Pre-search Input Validation]
    └──enhances──> [Existing discovery plan → approve flow] (adds validation step before plan is shown)

[Expert-Level Platform Recommendations]
    └──requires──> [platform-expertise.md knowledge file] (new file, must be authored based on real provider behaviour)
    └──enhances──> [Existing discovery plan] (better recommendations in plan output)

[Filler Spintax Detection]
    └──requires──> [LLM-as-Judge Validator Agent] (semantic check belongs in validator, not regex layer)
```

### Dependency Notes

- **Campaign-holistic awareness requires no new scripts** — `campaign-context.js` already returns linked sequences; the missing piece is passing all existing step bodies into the writer system prompt, not building new tooling.
- **LLM-as-Judge requires its own rules file** — do not add validator logic to writer-rules.md; they are separate agents with separate responsibilities. The validator evaluates, the writer generates.
- **Sequential pipeline state machine is a v8.2 concern** — build individual gates first, then formalise the abstraction. The state machine shell without gate content has no value.
- **Rewrite loop requires a max-iteration guard** — runner.ts currently has `maxSteps`; add a separate `rewriteCount` tracker to prevent the writer from entering infinite correction loops.
- **Channel-aware routing is a prerequisite for unverified email rescue** — rescue only makes sense for email campaigns; it must be gated by channel context first.

---

## MVP Definition

### Launch With (v8.0 core)

Minimum viable overhaul — addresses the documented quality failures without adding infrastructure complexity.

- [ ] Writer mandatory self-review in-prompt before save — covers all 12 quality rules in writer-rules.md
- [ ] Automatic rewrite loop (max 3 iterations) — writer auto-fixes before escalating to admin
- [ ] Campaign-holistic copy awareness — writer receives all prior steps before generating
- [ ] Post-search data quality report — field coverage stats (email %, LinkedIn URL %, ICP score distribution) after discovery-promote
- [ ] Channel-aware enrichment routing — skip email enrichment for LinkedIn-only campaigns
- [ ] Cost estimate required in discovery plan — pre-flight credit budget always shown
- [ ] Company name normalisation gate — checked before {COMPANYNAME} used in any copy

### Add After Validation (v8.1)

Features to add once the core quality loop is working and demonstrably reducing rewrite cycles.

- [ ] LLM-as-Judge validator agent — adds a second opinion layer; high value but adds latency; validate that writer self-review improves quality first before layering a second review
- [ ] Filler spintax auto-detection — LLM-based semantic check; add to validator once validator exists
- [ ] Cross-campaign CTA and angle dedup — requires `existing-campaign-copy.js` script; defer until writer self-review is stable
- [ ] Expert-level platform recommendations — `platform-expertise.md` knowledge file authoring

### Future Consideration (v8.2+)

- [ ] Sequential pipeline state machine — formal `PipelineStage` enum and gate handoffs; only worth the abstraction after all individual gates work reliably
- [ ] Unverified email rescue via BounceBan — new enrichment provider adapter; cost/benefit analysis needed first
- [ ] Pre-search input validation — `validateDiscoveryFilters()` per-adapter; add after observing filter errors in practice
- [ ] Credit spend report logged to campaign entity — useful for future client billing; defer until billing phase
- [ ] List overlap detection — warning when a list is reused across active campaigns

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Writer mandatory self-review | HIGH | LOW | P1 |
| Automatic rewrite loop | HIGH | LOW | P1 |
| Campaign-holistic copy awareness | HIGH | MEDIUM | P1 |
| Post-search quality report | HIGH | LOW | P1 |
| Channel-aware enrichment routing | HIGH | LOW | P1 |
| Cost estimate in discovery plan | MEDIUM | LOW | P1 |
| Company name normalisation gate | MEDIUM | LOW | P1 |
| LLM-as-Judge validator agent | HIGH | HIGH | P2 |
| Filler spintax detection | HIGH | MEDIUM | P2 |
| Cross-campaign CTA dedup | MEDIUM | MEDIUM | P2 |
| Expert-level platform recommendations | MEDIUM | HIGH | P2 |
| Sequential pipeline state machine | MEDIUM | HIGH | P3 |
| Unverified email rescue | LOW | HIGH | P3 |
| Pre-search input validation | LOW | MEDIUM | P3 |
| List overlap detection | LOW | LOW | P3 |

---

## Concrete Implementation Patterns

### LLM Self-Review Pattern (Reflexion Architecture)

The Reflexion pattern (Shinn et al., 2023) is the research-backed approach for this use case. Applied to the writer agent:

```
1. GENERATE — Writer produces copy following strategy rules
2. REFLECT — Writer evaluates its own output against explicit checklist
   (in same agent call, as structured reasoning step before save tool call)
3. CHECK — Each rule evaluated: PASS / FAIL with specific violation text
4. REWRITE — If any FAIL, writer regenerates the failing steps only (not whole sequence)
5. REPEAT — Back to step 2, max 3 iterations
6. ESCALATE — After 3 failures, save with violations flagged, notify admin
```

The key insight from the Reflexion paper: reflection must be **grounded**. The writer re-reads its output against each specific rule in sequence — not just "does this look good?". A structured checklist in the prompt produces higher-quality reflection than open-ended self-critique.

Concrete checklist to embed in writer-rules.md (FINAL CHECK section):
```
FINAL CHECK before calling save-draft.js:
[ ] BANNED_PHRASES — scan for each of the 30 banned phrases
[ ] GREETING — first email must start with "Hi {FIRSTNAME}," or similar
[ ] WORD COUNT — count body words; must be under 70
[ ] VARIABLES — no {{double}} braces, no {lowercase} variables
[ ] SPINTAX — if LinkedIn: zero spintax; if email: options are semantically distinct
[ ] EM DASH / EN DASH — zero occurrences
[ ] CTA — ends with soft question; no "Let me know" or "Book a call"
[ ] SUBJECT LINE — no exclamation mark, 3-6 words, no spam triggers
[ ] CAMPAIGN CONTEXT — no angle repeated from prior steps in this campaign

If ANY item is FAIL: rewrite only the offending step. State violations and changes made.
```

### LLM-as-Judge Validator Pattern

Separate Haiku model invoked after writer saves draft. Uses direct assessment (point-wise scoring):

```
Validator receives:
- Full campaign sequences (all steps)
- Workspace ICP and value props
- Complete quality rules list

Validator outputs structured JSON:
{
  overallScore: 0-100,
  pass: boolean,  // true if score >= 85 and no CRITICAL failures
  violations: [{ rule, step, field, text, severity }],
  rewriteSuggestions: [{ step, suggestion }]
}

Threshold: overall >= 85 AND zero CRITICAL violations
If threshold not met:
- Return violations to writer
- Writer rewrites, validator re-evaluates
- Max 2 validator cycles (not 3 — validator is the last gate)
```

The validator is a **separate agent with separate rules** file. It must not share system prompt with the writer. Using Haiku keeps cost to ~$0.001 per validation.

### Campaign-Holistic Context Pattern

Writer must receive the full campaign state before generating any step. This prevents angle repetition (the documented primary failure mode).

```
Before writing any content for campaignId:
1. Run campaign-context.js --campaignId {id}
2. Extract from response: all existing email steps (subject + body), all LinkedIn steps
3. Build TAKEN ANGLES list: extract key theme/value prop from each existing step body
4. Build TAKEN CTAs list: extract the closing question from each existing step
5. Inject into system prompt as:
   "[CAMPAIGN CONTEXT — do not repeat these angles or CTAs:
    Step 1 angle: {angle}; CTA: {cta}
    Step 2 angle: {angle}; CTA: {cta}]"

Writer must:
- Acknowledge each taken angle before writing
- Explicitly state which new angle/angle each new step uses
- Ensure each CTA question is unique across the sequence
```

### Channel-Aware Enrichment Decision Tree

```
Campaign.channel = "linkedin"
  → Enrichment: LinkedIn URL only (from person DB record or LinkedIn search)
  → Skip: all email finding (Prospeo/AI Ark/LeadMagic/FindyMail)
  → Export gate: LinkedIn URL required

Campaign.channel = "email"
  → Enrichment: verified email required (full waterfall)
  → Run: Prospeo → AI Ark → LeadMagic → FindyMail
  → Export gate: verified email required (already enforced)
  → Optional (v8.2): BounceBan for unverified before discard

Campaign.channel = "email_linkedin"
  → Enrichment: both required
  → Run full email waterfall
  → Ensure LinkedIn URL populated
  → Export gate: both required
```

### Post-Search Quality Report Format

```
Discovery complete: {source} — {total found} leads staged

Data Coverage:
  Verified emails:   {n} ({pct}%)
  Unverified emails: {n} ({pct}%)
  No email found:    {n} ({pct}%)
  LinkedIn URLs:     {n} ({pct}%)

ICP Score Distribution:
  High (≥70):   {n} ({pct}%)
  Medium (40-70): {n} ({pct}%)
  Low (<40):    {n} ({pct}%)

Gate Result: [PASS / WARN / FAIL]
  PASS: >60% verified emails AND >70% ICP score ≥ 70
  WARN: 30-60% verified emails OR mixed ICP scores
  FAIL: <30% verified emails OR <50% ICP score ≥ 40

Estimated campaign-ready leads: {n}
```

---

## Competitor Feature Analysis

| Feature | Clay | Apollo | Instantly/Smartlead | Outsignal v8.0 Approach |
|---------|------|--------|---------------------|------------------------|
| Copy quality gates | None — manual review | None | Basic spam score (deliverability only) | Rule-based regex + LLM judge; semantic quality beyond spam |
| Self-review loop | N/A | N/A | N/A | Reflexion: generate → reflect → rewrite, max 3 iterations |
| Channel-aware enrichment | Manual flag per list | Manual per export | No | Automatic routing based on Campaign.channel field |
| Campaign-holistic copy | N/A | N/A | N/A | Full campaign context injected into writer before each generation |
| Discovery cost preview | Shows credits | Shows credits | N/A | Estimate before approval; itemised report after execution |
| Lead quality gate | ICP score only | Intent score | None | Multi-factor: email coverage + LinkedIn URL + ICP score threshold |
| Validator agent | None | None | None | Separate Haiku-based agent with explicit PASS/FAIL per rule |
| Angle dedup | None | None | None | Cross-campaign angle tracking via `existing-campaign-copy.js` |

---

## Sources

- [Reflexion: Language Agents with Verbal Reinforcement Learning (arXiv)](https://arxiv.org/abs/2303.11366) — Core self-review architecture pattern; grounded reflection outperforms ungrounded self-critique
- [Reflection Agents — LangChain Blog](https://blog.langchain.com/reflection-agents/) — Three implementation approaches: basic reflection, Reflexion, LATS; latency/quality tradeoff documented
- [Multi-Agent Validation: Stop Agents from Hallucinating Silently](https://dev.to/aws/how-to-stop-ai-agents-from-hallucinating-silently-with-multi-agent-validation-3f7e) — Executor → Validator → Critic architecture; explicit PASS/FAIL over silent failures
- [LLM-as-a-Judge Complete Guide — Evidently AI](https://www.evidentlyai.com/llm-guide/llm-as-a-judge) — Direct assessment (point-wise scoring) pattern for quality evaluation
- [Automated Self-Testing as Quality Gate (arXiv 2603.15676)](https://arxiv.org/html/2603.15676) — Evidence-driven quality gates; multi-dimension evaluation before save
- [Demystifying Evals for AI Agents — Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) — Evaluation methodology for production agentic systems
- [B2B Cold Outreach Benchmarks 2025 — Belkins](https://belkins.io/resources/b2b-cold-outreach-benchmarks) — Industry benchmarks for quality thresholds (email >60% verified, reply rate tiers)
- [State of LinkedIn Outreach H1 2025 — Expandi](https://expandi.io/blog/state-of-li-outreach-h1-2025/) — LinkedIn-specific data requirements and channel benchmarks
- [AI Lead Generation 2025 — Outreach.io](https://www.outreach.io/resources/blog/ai-lead-generation) — Quality gates in outreach pipeline design
- Existing codebase: `src/lib/copy-quality.ts`, `src/lib/agents/types.ts`, `src/lib/agents/leads.ts`, `.claude/rules/writer-rules.md`, `src/lib/enrichment/costs.ts`

---

*Feature research for: Outsignal Agent Quality Overhaul (v8.0)*
*Researched: 2026-03-30*
