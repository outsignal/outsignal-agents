# Project Research Summary

**Project:** Agent Quality Overhaul — Outsignal v8.0 Milestone
**Domain:** LLM agent quality gates, self-review loops, platform API expertise, pipeline validation
**Researched:** 2026-03-30
**Confidence:** HIGH

## Executive Summary

The v8.0 milestone is not a rebuild — it is a quality enforcement layer added around an existing, working agent pipeline. The core problem is documented and evidence-backed: the writer agent generates copy that violates rules it knows, the leads agent burns credits on low-quality searches, and there is no deterministic gate between "agent generates output" and "output reaches the database." The research confirms this is fixable without new infrastructure, new models, or new API contracts. The fix is enforcement at boundaries, not better prompts.

The recommended approach is a 7-phase build in strict dependency order: extend the TypeScript copy quality module first (deterministic, zero risk), then encode platform expertise into rules files (text edit, no code), then build the Validator Agent (Haiku-based, stateless, typed output), then integrate it into the writer agent, then add pre/post search gates to the leads agent, then wire up campaign pipeline validation, then run end-to-end confirmation. No new npm packages are needed. No schema migrations are needed. No new CLI scripts are required — the validator runs inside the agent layer. The six existing research files (`STACK.md`, `FEATURES.md`, `ARCHITECTURE.md`, `PITFALLS.md`) converge on the same build order independently.

The two highest-risk failure modes are Goodhart's Law in copy validation (structural rules pass while semantic quality fails — the agent learns to satisfy the checklist, not the intent) and the self-review loop getting stuck in infinite rewrites without convergence. Both require design-level decisions before any implementation begins: word count thresholds must be tiered by strategy (PVP: 70 words, Creative Ideas: 90 words, One-liner: 50 words, LinkedIn: 100 words), and the retry loop must carry forward context on each attempt with a hard 3-iteration limit and explicit escalation to admin review on failure. These decisions cannot be retrofitted safely once the validation logic is written.

## Key Findings

### Recommended Stack

No new packages required. The entire v8.0 quality system is implemented as TypeScript extensions to existing modules, new agent rules files, and one new agent file. The platform API layer (Prospeo, AI Ark, Apollo, Apify, BounceBan) remains unchanged — v8.0 only changes how the leads agent *uses* these APIs, not the adapters themselves.

The key stack insight from STACK.md: Prospeo deprecated its Domain Search, Email Finder, and Social URL Enrichment endpoints in March 2026. The correct flow is now Search Person + Enrich Person (two-step). AI Ark has two confirmed broken filters (`contact.department` returns all records; `contact.keyword` returns 400) — these must be encoded as hard rules in leads-rules.md, not left to agent memory. BounceBan is the only provider that handles catch-all email verification at 97%+ accuracy, making it the right tool for recovering the 20-30% of enriched leads that land in CATCH_ALL status rather than discarding them all.

**Core technologies (no changes from v7.0):**
- Next.js 16 / Prisma 6 / PostgreSQL (Neon) / Vercel — unchanged
- Vercel AI SDK + `@ai-sdk/anthropic` — agent execution layer, unchanged
- `claude-haiku-4-5-20251001` — new use: Validator Agent (structured output via `generateObject()`, ~$0.002/campaign)

**New code artifacts (not packages):**
- `src/lib/agents/validator.ts` — Validator Agent, stateless, typed `ValidationResult` output
- `src/lib/copy-quality.ts` — extended with `checkWordCount()`, `checkGreeting()`, `checkCTAFormat()`, `checkLinkedInSpintax()`, `checkSpintaxGrammar()`
- `src/lib/normalize.ts` — extended with `normalizeCompanyNameForCopy()`
- `.claude/rules/writer-rules.md` — self-review checklist section added
- `.claude/rules/leads-rules.md` — platform expertise section added (API filter guidance, cost-per-lead, known bugs)

### Expected Features

This is a quality gates retrofit on an existing production system. All existing agent capabilities (orchestrator, writer, leads, campaign; 55 CLI scripts; AgentRun audit; copy strategies; discovery adapters; enrichment waterfall) are preserved unchanged.

**Must have — v8.0 core (P1):**
- Writer mandatory self-review checklist before `saveCampaignSequence` — covers all 12 quality rules
- Automatic rewrite loop (max 3 iterations, carry-forward context on retry, escalate on failure)
- Campaign-holistic copy awareness — writer loads all existing sequence steps before generating any new step
- Validator Agent (`validator.ts`) — Haiku-based, stateless, structured PASS/FAIL with per-step violations
- Post-search data quality report — verified email %, LinkedIn URL %, ICP score distribution after discovery
- Channel-aware enrichment routing — skip email enrichment for LinkedIn-only campaigns
- Cost estimate required in discovery plan — pre-flight credit budget always shown
- Company name normalisation gate — checked at list-build time, blocks copy generation if not cleaned

**Should have — v8.1 (P2, add after P1 quality loop is proven working):**
- LLM-as-Judge validator agent (second-opinion layer; adds latency, worth it once writer self-review is stable)
- Filler spintax auto-detection (semantic check via validator; belongs after validator exists)
- Cross-campaign CTA and angle dedup (new `existing-campaign-copy.js` CLI script needed)
- Expert-level platform recommendations (platform-expertise.md knowledge file)

**Defer — v8.2+ (P3):**
- Sequential pipeline state machine (`PipelineStage` enum + gate handoffs)
- Unverified email rescue via BounceBan (new enrichment provider adapter)
- Pre-search input validation per-adapter
- List overlap detection
- Credit spend report logged to campaign entity

**Anti-features to avoid:**
- Hard-block saves on all violations (creates stuck pipeline; soft-block with escalation is correct)
- Per-lead approve/reject in validator (list-level threshold is the right lever)
- Fully autonomous deployment without human approval gate
- Global discovery filters across workspaces (each client ICP is distinct)

### Architecture Approach

The v8.0 overhaul adds quality infrastructure around the existing agent loop, not inside it. The key principle from ARCHITECTURE.md: **enforce at the boundary, not in the prompt**. Prompts are probabilistic. Boundary functions are deterministic. Three integration zones: pre-generation (platform expertise context, campaign-holistic context load), post-generation pre-save (Validator Agent reviews before DB write), and pre-search (input validation gates before paid API calls fire).

The Validator Agent is implemented as a TypeScript function (`validateSequence()`) called via a tool inside `writer.ts` — not as a runner.ts invocation. It is stateless (no DB calls, no API calls, no tools), uses `generateObject()` with a Zod schema for structured output, and does not create an AgentRun audit record. Its output feeds back into the writer's tool result which is logged in the writer's existing AgentRun.steps. The portal `approve-content` route upgrades from warn-only to HTTP 422 hard block when violations exist (last-resort gate).

**Major components:**
1. **Extended `copy-quality.ts`** — deterministic structural checks (word count, greeting, CTA format, LinkedIn spintax, spintax grammar); single source of truth for all banned patterns
2. **`validator.ts` (new)** — Haiku Validator Agent; calls extended `copy-quality.ts` for structural checks + `generateObject()` for coherence checks (angle dedup, UK English, tone); returns `ValidationResult { pass, structuralViolations, coherenceIssues, warningsOnly, suggestedFixes }`
3. **Modified `writer.ts`** — new `loadCampaignSequence` tool (holistic context load) + new `validateSequence` tool (calls validator.ts); updated system prompt with self-review checklist and rewrite loop instructions
4. **Modified `leads.ts`** — new `validateDiscoveryInputs` tool (pre-search gate) + new `checkPostSearchQuality` tool (post-search gate); system prompt updated with platform expertise reference
5. **Modified `leads-rules.md` / `writer-rules.md`** — platform expertise, self-review checklist, pre/post search gate instructions; loaded unconditionally at agent startup via existing `loadRules()` mechanism
6. **Modified `orchestrator.ts`** — `channelMode` param added to `delegateToLeads`; `campaignId` required for writer delegation
7. **Modified `approve-content` portal route** — upgraded from warn-only to HTTP 422 hard block

### Critical Pitfalls

1. **Goodhart's Law in copy validation (structural pass, semantic fail)** — Writer satisfies the word count and banned phrases checklist but generates vague, generic copy with no specific ICP pain point. Prevention: self-review must include at least 2 semantic checks that evaluate meaning, not structure ("does the first sentence name a specific pain point?"). Deterministic gates alone are not sufficient. Phase to address: Phase 1 (writer gate design).

2. **Self-review loop stuck in infinite rewrites** — Word count and CTA checks conflict; agent cycles through the same variants without converging. Prevention: hard 3-iteration limit, carry-forward context on retry (pass previous draft + exact failed check + what to preserve), priority ordering (structural violations are always fatal; semantic checks are advisory on retry 1-2, fatal on retry 3). Phase to address: Phase 1.

3. **Prospeo domain-name misuse burning credits** — Documented production failure: leads agent used `company.names` filter instead of `company.websites`, producing 97% placeholder email rate (43 usable leads from 1,638 results). Prevention: domain resolution is a mandatory pre-step, not optional; encode in leads-rules.md as hard rule; post-search quality gate fires before any enrichment credit is spent. Phase to address: Phase 2 (leads agent platform expertise).

4. **Validation too strict blocks legitimate output** — A 70-word hard limit blocks legitimate complex ICP emails (Covenco, 1210 Solutions enterprise copy). Prevention: tiered thresholds by strategy — PVP: 70, Creative Ideas: 90, One-liner: 50, LinkedIn: 100. Single global threshold causes admin to bypass the agent for complex campaigns, defeating the purpose. Phase to address: Phase 1.

5. **Agent gaming validation via semantically equivalent phrases** — Banned phrases are surface-level; model finds equivalent expressions that pass regex but have identical problematic intent. Prevention: supplement banned phrases with intent-based anti-pattern descriptions ("do not use hedging opener phrases — the banned list is examples, not the complete set"). Semantic quality checks backstop this. Phase to address: Phase 1.

## Implications for Roadmap

The build order is fully dependency-driven. Each phase must complete before the next begins — there are no phases that can safely run in parallel.

### Phase 1: Extended Copy Quality Module
**Rationale:** Zero dependencies, zero risk. Extending a pure TypeScript utility module with additive functions. Must exist before Phase 3 (Validator Agent imports it). All word count threshold decisions, tiering by strategy, and semantic quality criteria must be defined and committed here — these cannot be retrofitted after the validator is built around them.
**Delivers:** `checkWordCount()`, `checkGreeting()`, `checkCTAFormat()`, `checkLinkedInSpintax()`, `checkSpintaxGrammar()` in `copy-quality.ts`; tiered word count thresholds by strategy; updated `CopyQualityResult` type
**Addresses:** Word count enforcement, greeting enforcement, CTA format gate, LinkedIn spintax block
**Avoids:** Pitfalls 1 (semantic quality criteria defined), 4 (tiered thresholds defined before any validation ships), 5 (intent descriptions embedded in rules)

### Phase 2: Platform Expertise in Rules Files
**Rationale:** Text edits only. Zero code changes. Rules files load unconditionally at agent startup via existing `loadRules()` mechanism — platform expertise in a KB document would require a search step that might miss it. Leads agent platform expertise must exist before Phase 5 (leads agent integration references it).
**Delivers:** New "Platform Expertise" section in `leads-rules.md` (per-source optimal filters, cost-per-lead, known bugs, verified vs unverified handling); mandatory self-review checklist section in `writer-rules.md`
**Addresses:** Expert-level platform recommendations (leads), self-review gate (writer), Prospeo domain-name misuse prevention
**Avoids:** Pitfall 3 (domain resolution as mandatory pre-step encoded in rules), Pitfall 7 (post-search quality expectations encoded)

### Phase 3: Validator Agent
**Rationale:** Depends on Phase 1 (extended `copy-quality.ts` functions). Stateless `generateObject()` call — no runner.ts, no AgentRun record, no tools. Must exist before Phase 4 (writer.ts imports it). Uses Haiku for cost efficiency (~$0.002/campaign).
**Delivers:** `src/lib/agents/validator.ts`; `validateSequence()` function export; `ValidationResult` Zod schema; structural checks (from Phase 1) + coherence checks (Haiku LLM call for angle dedup, UK English, tone); two violation tiers (structural = blocker, coherence = warning)
**Addresses:** LLM-as-judge validation, angle dedup, campaign coherence, filler spintax detection
**Avoids:** Anti-pattern of putting Haiku call inside CLI save script; anti-pattern of giving validator external tool access

### Phase 4: Writer Agent Integration
**Rationale:** Depends on Phase 2 (writer-rules.md updated) and Phase 3 (validator.ts exists). Campaign-holistic awareness and validation gate wire into the existing writer flow without touching runner.ts or CLI scripts.
**Delivers:** `loadCampaignSequence` tool in writer.ts; `validateSequence` tool in writer.ts; updated WRITER_SYSTEM_PROMPT with self-review checklist + validator call instruction + rewrite loop (max 2 validation loops, escalate if still failing)
**Addresses:** Writer mandatory self-review, automatic rewrite loop, campaign-holistic copy awareness, validator integration
**Avoids:** Pitfall 2 (rewrite loop with carry-forward context and hard iteration limit)

### Phase 5: Leads Agent Integration
**Rationale:** Depends on Phase 2 (leads-rules.md platform expertise). Pre/post search gates are pure TypeScript — no new APIs, no new adapters.
**Delivers:** `validateDiscoveryInputs` tool in leads.ts (domain format, title sanity, ICP filter structure; returns blockers vs warnings); `checkPostSearchQuality` tool in leads.ts (verified email %, LinkedIn URL %, placeholder detection, ICP fit sample; channel-specific thresholds); channel-aware enrichment routing via `channelMode` param
**Addresses:** Pre-search input validation, post-search quality gate, channel-aware list building, cost estimate in discovery plan
**Avoids:** Pitfall 3 (domain-name misuse blocked at tool level), Pitfall 7 (false confidence in structurally valid but semantically wrong searches), Pitfall 8 (credit budget two-tier design)

### Phase 6: Campaign Pipeline Validation
**Rationale:** Depends on Phases 4 + 5 (both agent integrations complete). Final wiring of channel-mode param through orchestrator, company name normalisation gate at list-link time, and portal hard-block upgrade.
**Delivers:** `channelMode` param added to `delegateToLeads` in orchestrator.ts; company name normalisation gate in `validateDiscoveryInputs`; `approve-content` portal route upgraded to HTTP 422 hard block; `normalizeCompanyNameForCopy()` in normalize.ts
**Addresses:** Channel-aware list validation, company name normalisation, portal approval hard-block
**Avoids:** Pitfall 4 (channel-blind list assignment), Pitfall 9 (company names not normalised before copy generation)

### Phase 7: End-to-End Validation
**Rationale:** Integration confirmation only — no new code. Runs after all previous phases are complete to confirm the full pipeline works as a unit and audit logs capture validation results correctly.
**Delivers:** Full pipeline test on a test workspace (discovery → quality gate → list build → write copy → validate → save); AgentRun audit log inspection; portal hard-block confirmed; rewrite loop trigger confirmed with deliberate violations
**Addresses:** Integration confidence, regression prevention
**Avoids:** Silent failures that only surface in production

### Phase Ordering Rationale

- **Deterministic before probabilistic:** Phase 1 (pure TypeScript) ships before Phase 3 (LLM-based) because the validator calls the TypeScript functions. Building the deterministic layer first makes the LLM layer testable.
- **Rules before code:** Phase 2 (rules files) ships before Phase 4+5 (agent code) because agent code references rules file content. Rules define the intended behavior; code enforces it.
- **Validator before integration:** Phase 3 ships before Phase 4 because writer.ts imports `validateSequence()`. No import = no integration.
- **Both agents before campaign wiring:** Phase 6 wires up the orchestrator and portal route — these changes only make sense once both agents (Phases 4 + 5) have their gates in place.
- **Validation last:** Phase 7 is a confirmation pass, not a build phase. Running it earlier would validate an incomplete system.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Validator Agent):** The exact Zod schema for `ValidationResult` and the Haiku system prompt for coherence checking need a planning design pass. The schema must be typed to allow the writer to act on structured violation data, not just a pass/fail bool. Coherence check scope (which issues are blockers vs warnings) needs a decision before implementation.
- **Phase 6 (Portal hard-block):** The frontend portal approval UI currently ignores `copyQualityWarnings` in the response body. An HTTP 422 change requires the frontend to handle an error state. This is a minor frontend change but needs to be planned to avoid a broken approval flow in production.

Phases with standard, well-documented patterns (skip additional research):
- **Phase 1:** Pure TypeScript module extension. Function signatures and test patterns are fully specified in ARCHITECTURE.md.
- **Phase 2:** Text edits to existing rules files. No implementation decisions needed.
- **Phase 5:** `validateDiscoveryInputs` is pure TypeScript with no external dependencies. The gate logic is fully specified in PITFALLS.md (domain format check, title sanity, ICP filter structure).
- **Phase 7:** End-to-end test with known inputs. No new patterns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | No new dependencies; existing codebase inspected directly; Prospeo/AI Ark deprecations verified against official docs dated March 2026; Haiku `generateObject()` pattern is established production use |
| Features | HIGH | Bounded scope — this is an additive quality layer on an existing system; feature dependencies are explicit and dependency graph is clean; v8.0 crisis evidence is first-party (production failures documented) |
| Architecture | HIGH | Based on direct code inspection of all relevant agent files, rules files, and CLI scripts; build order is dependency-derived, not estimated; all integration boundaries specified with TypeScript signatures |
| Pitfalls | HIGH | Cross-referenced against DeepMind research (LLM self-correction failures), documented production incidents (97% placeholder email rate), Goodhart's Law literature, and agent pattern failure mode taxonomy; all prevention strategies are concrete and verifiable |

**Overall confidence:** HIGH

### Gaps to Address

- **Zod schema for ValidationResult (Phase 3):** The specific shape of structured validator output (violation objects, severity levels, per-step vs per-sequence granularity) needs a design decision before `validator.ts` is implemented. Getting this wrong means the writer agent receives structured data it doesn't know how to act on.

- **Coherence check scope (Phase 3):** Which checks belong in the deterministic structural layer (copy-quality.ts) vs the LLM coherence check (Haiku call in validator.ts) needs to be explicitly drawn before implementation. ARCHITECTURE.md provides the initial split (structural: word count, variables, banned phrases; coherence: angle dedup, tone, UK English) but edge cases (CTA uniqueness — structural or coherence?) need a decision.

- **Filler spintax threshold calibration (Phase 3/4):** Detecting spintax where options are semantically interchangeable requires either a deterministic heuristic (options with identical word count ±1 and ≥50% word overlap) or an LLM judgment call. The threshold for "interchangeable" is not defined in research. Start with LLM judgment in the validator; if it produces false positives on legitimate spintax, calibrate to a heuristic.

- **BounceBan adapter (Phase deferred to v8.2):** The decision to add BounceBan as a new enrichment provider is confirmed (STACK.md has pricing + API pattern), but the adapter implementation and integration into the enrichment waterfall is explicitly deferred. When it moves to active scope, plan a dedicated spike — the enrichment waterfall ordering and cost/benefit calculation for CATCH_ALL recovery needs a planning pass.

## Sources

### Primary (HIGH confidence)
- `https://prospeo.io/api-docs/search-person` — filter spec, `company.websites` vs `company.names` distinction, constraint rules (verified 2026-03-30)
- `https://prospeo.io/api-docs/enrich-person` — credit costs, `only_verified_email` behavior, no-match free rule (verified 2026-03-30)
- `https://prospeo.io/api-docs/rate-limits` — rate limit headers, 429 behavior (verified 2026-03-30)
- `https://bounceban.com/pricing` — credit pricing, no-charge on unverifiable, catch-all parity pricing (verified 2026-03-30)
- `/Users/jjay/programs/outsignal-agents/src/lib/discovery/adapters/aiark-search.ts` — AI Ark filter bug status from live testing (`contact.department` bugged, `contact.keyword` broken) (HIGH — first-party evidence)
- Direct code inspection: `src/lib/agents/writer.ts`, `leads.ts`, `orchestrator.ts`, `runner.ts`, `types.ts`, `cli-spawn.ts`, `copy-quality.ts`
- Outsignal v8.0 quality crisis evidence (2026-03-25/26 sessions) — 97% placeholder rate, 43/1,638 verified leads, 106-word emails, 3+ rewrite cycles (HIGH — first-party production failures)
- [arXiv:2303.11366 — Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366) — grounded reflection architecture; max 3 iteration recommendation

### Secondary (MEDIUM confidence)
- `https://docs.ai-ark.com/` — endpoint list, async export model (MEDIUM — numeric rate limits not published)
- [DeepMind: LLMs Can't Self-Correct in Reasoning Tasks](https://bdtechtalks.com/2023/10/09/llm-self-correction-reasoning-failures/) — self-correction impairs semantic quality; structural-only review is insufficient
- [Goodhart's Law for AI Agents — Matt Hopkins](https://matthopkins.com/business/goodharts-law-ai-agents/) — metric gaming by capable optimizers; policy-driven vs metric-driven design
- [Infinite Agent Loop failure modes — Agent Patterns](https://www.agentpatterns.tech/en/failures/infinite-loop) — hard loop, soft loop, semantic loop; max_steps prevention
- [LLM-as-a-Judge — Evidently AI](https://www.evidentlyai.com/llm-guide/llm-as-a-judge) — direct assessment (point-wise scoring) for quality evaluation
- [Multi-Agent Validation — AWS Dev.to](https://dev.to/aws/how-to-stop-ai-agents-from-hallucinating-silently-with-multi-agent-validation-3f7e) — Executor → Validator → Critic architecture
- [Apollo 79% accuracy benchmark](https://fullenrich.com/tools/Apolloio-vs-Prospeoio) — Apollo vs Prospeo email accuracy comparison
- [Pipeline Quality Gates — InfoQ](https://www.infoq.com/articles/pipeline-quality-gates/) — gates too strict cause developer bypass; exception handling for edge cases

---
*Research completed: 2026-03-30*
*Ready for roadmap: yes*
