# Project Research Summary

**Project:** Outsignal v3.0 Campaign Intelligence Hub
**Domain:** Outbound sales campaign intelligence — reply classification, performance analytics, feedback loops
**Researched:** 2026-03-09
**Confidence:** HIGH

## Executive Summary

The Campaign Intelligence Hub is a feedback-loop layer on top of Outsignal's existing outbound pipeline. Today, replies arrive via webhook, trigger notifications, update person status, and stop. v3.0 intercepts this flow to classify reply intent with Claude Haiku, aggregate campaign performance metrics locally, generate AI-powered actionable insights, and surface recommendations through an admin action queue. This is an application-layer build, not a stack expansion — zero new dependencies are needed. Every required capability (structured AI output, charting, scheduling, data aggregation) already exists in the installed stack.

The recommended approach follows a strict data-first sequence: persist reply data and classify it (foundation), pre-compute analytics into the existing CachedMetrics model (intelligence layer), build the dashboard UI on top of pre-computed data (visibility), then layer AI insight generation and action queue on top (automation). The critical architectural decision is pre-computing all analytics via cron rather than computing on-demand — Neon serverless cold starts and complex aggregation queries would make the dashboard unusable otherwise. Classification uses a two-tier approach: rule-based for obvious cases (OOO, unsubscribe, bounce — ~60% of replies), Claude Haiku for ambiguous cases (~$0.001/reply). Total AI cost projection is under $10/month.

The primary risks are: (1) classification taxonomy that doesn't match real-world reply patterns — mitigated by labeling 100+ actual replies before finalizing categories, (2) cross-workspace data leakage in benchmarking — mitigated by anonymized-aggregate-only computation with no workspace identifiers in benchmark data, (3) insight generation hallucinating numbers — mitigated by having the LLM narrate pre-computed metrics rather than performing arithmetic, and (4) alert fatigue from too many insights — mitigated by hard-capping at 3-5 insights per workspace per cycle. The system must remain admin-driven: AI suggests, admin decides. No auto-actions, ever.

## Key Findings

### Recommended Stack

No new packages. The existing stack handles everything v3.0 requires. This is a strength — zero integration risk, zero new dependency management.

**Core technologies (all existing):**
- **AI SDK `generateObject` + Haiku**: Reply classification with structured output — identical pattern to existing ICP scorer
- **Prisma + PostgreSQL (Neon)**: 3 new models (ReplyClassification, Insight, AdminAction), aggregation via `$queryRaw` for date bucketing
- **Recharts 3.7**: Campaign performance charts, benchmark visualizations — already installed
- **CachedMetrics model**: Pre-computed analytics storage — already in schema, currently unused, perfect for this use case
- **cron-job.org**: Scheduling for analytics computation and insight generation — Vercel Hobby cron slots are full
- **Existing agent framework**: Reuse `src/lib/agents/runner.ts` for insight generation agent

### Expected Features

**Must have (table stakes):**
- Reply persistence (ReplyClassification) — currently replies pass through without storage, blocking all analytics
- Reply classification with 8-9 intent categories — industry standard; binary interested/not-interested is obsolete
- Sentiment scoring (positive/neutral/negative) — orthogonal to intent, classified in the same Haiku call
- Local campaign performance metrics — currently fetched live from EmailBison API with no historical tracking
- Per-step sequence analytics — which email step generates the most replies
- Campaign ranking/comparison view — side-by-side performance within a workspace

**Should have (differentiators):**
- ICP score calibration — correlate icpScore with actual reply outcomes, auto-suggest threshold adjustments (killer feature, no SaaS competitor does this)
- Cross-workspace benchmarking — unique multi-tenant advantage Instantly/Smartlead cannot replicate
- Copy strategy effectiveness comparison — creative-ideas vs PVP vs one-liner aggregate metrics
- AI insight generation — scheduled analysis producing actionable cards with data-backed recommendations
- Admin action queue — approve/dismiss/defer AI suggestions
- Objection pattern detection — cluster common objections for copy iteration

**Defer (build storage now, UI later):**
- Objection pattern analysis UI — needs 50+ objection replies for statistical meaning
- Signal-to-conversion tracking UI — needs signal campaigns running long enough to produce data
- Digest notifications — low urgency, build after action queue exists

### Architecture Approach

The intelligence layer hooks into 4 existing touchpoints (webhook handler, poll-replies cron, dashboard stats API, agent framework) without disrupting them. Classification runs as fire-and-forget in the webhook handler (same proven pattern as `generateReplySuggestion`). Analytics are pre-computed to CachedMetrics via external cron every 6 hours. The Intelligence Hub dashboard reads only from pre-computed data — zero raw aggregation queries at request time. All new code lives in `src/lib/intelligence/` with clear separation: classifier (function), aggregator (function), insight generator (agent), action queue (CRUD).

**Major components:**
1. **Reply Classifier** (`src/lib/intelligence/classifier.ts`) — rule-based + Haiku two-tier classification, hooks into webhook handler and poll-replies cron
2. **Analytics Aggregator** (`src/lib/intelligence/aggregator.ts`) — computes campaign rankings, strategy comparisons, intent distributions, ICP calibration, writes to CachedMetrics
3. **Insight Generator** (`src/lib/intelligence/insight-generator.ts`) — AI agent that reads pre-computed metrics and generates actionable insight cards
4. **Intelligence Hub Page** (`src/app/(admin)/intelligence/page.tsx`) — dashboard with 6 visualization panels reading from 7 API endpoints
5. **Action Queue** (`src/lib/intelligence/action-queue.ts`) — admin approve/dismiss/defer workflow for AI suggestions

### Critical Pitfalls

1. **Classification taxonomy mismatch** — Design from real data, not theory. Label 100+ actual replies before finalizing categories. Add `classificationOverride` for admin corrections. Reconcile with existing `isAutomated` flag.
2. **Cross-workspace data leakage** — Benchmark data must be anonymized aggregates only. Never expose campaign names, reply text, or per-workspace breakdowns in cross-workspace contexts. Add `benchmarkConsent` to Workspace model.
3. **Analytics killing page load** — Pre-compute everything into CachedMetrics via cron. Dashboard reads single-row lookups only. Show "last computed" timestamps. Never run aggregation queries at request time.
4. **LLM cost spiral** — Gate classification strictly on reply events only (not EMAIL_SENT/BOUNCE). Idempotency guard via `classifiedAt` timestamp. Use Haiku not Sonnet for classification. Track costs in DailyCostTotal.
5. **Insight hallucinations** — LLM narrates pre-computed numbers, never computes them. Validate that referenced numbers match source data. System prompt constrains output to current workspace only.

## Implications for Roadmap

Based on dependency analysis across all research, suggested phase structure:

### Phase 1: Reply Storage and Classification Engine
**Rationale:** Everything downstream depends on classified reply data. This is the absolute foundation — without it, the Intelligence Hub is just another stats dashboard.
**Delivers:** ReplyClassification Prisma model, two-tier classifier (rule-based + Haiku), webhook handler integration, poll-replies integration, idempotency guards
**Addresses:** Reply storage (P0), reply classification (P0), sentiment scoring (P0)
**Avoids:** Taxonomy mismatch (label real replies first), cost spiral (strict event gating), status conflict (separate intent from lifecycle status)

### Phase 2: Analytics Aggregation Engine
**Rationale:** Classification data needs to be aggregated before it can be visualized. Pre-computation infrastructure must exist before the dashboard UI.
**Delivers:** Analytics aggregator, CachedMetrics population, cron endpoint (`/api/cron/compute-intelligence`), campaign performance snapshots, strategy comparison data, intent distributions
**Addresses:** Campaign performance metrics (P0), per-step sequence analytics (P1), campaign ranking (P1), copy strategy comparison (P1)
**Avoids:** Dashboard page load kills (all computation happens in cron, not at request time), sparse data misleading (minimum thresholds per metric)

### Phase 3: Intelligence Hub Dashboard
**Rationale:** With pre-computed data available, the UI can be built as a pure read layer — fast, simple, no performance concerns.
**Delivers:** Intelligence Hub page at `/admin/intelligence`, campaign rankings table, strategy comparison chart, intent breakdown visualization, workspace filter, "last computed" indicators
**Addresses:** Intelligence Hub page (P1), cross-workspace benchmarking (P1)
**Avoids:** Data leakage (anonymized benchmarks only), slow loads (reads from CachedMetrics only)

### Phase 4: ICP Score Calibration
**Rationale:** By this point, classification data has been accumulating for weeks/months. ICP calibration requires sufficient data volume to be statistically meaningful.
**Delivers:** ICP score vs conversion correlation analysis, score bucket breakdown, threshold recommendation, calibration visualization on Intelligence Hub
**Addresses:** ICP score calibration (P2), signal-to-conversion tracking foundation (P2)
**Avoids:** Chicken-and-egg problem (prospective data only, no retroactive analysis), insufficient data (minimum 50 data points per bucket threshold)

### Phase 5: AI Insight Generation and Action Queue
**Rationale:** Insights depend on stable analytics data. The action queue depends on insights. Building these last means the insight generator has rich, validated data to analyze.
**Delivers:** Insight generator agent, Insight Prisma model, AdminAction model, action queue UI (approve/dismiss/defer), insight cards on Intelligence Hub, weekly insight generation cron
**Addresses:** AI insight generation (P2), admin action queue (P2), objection pattern detection storage (P2)
**Avoids:** Hallucinations (LLM narrates pre-computed data only), alert fatigue (3-5 insights per workspace cap), autonomous actions (suggest-only, admin decides)

### Phase 6: Digest Notifications
**Rationale:** Last phase — requires insights, analytics, and action queue to all exist. Low complexity, leverages existing notification infrastructure.
**Delivers:** Weekly digest via Slack and email, top insights summary, best/worst campaign highlights, pending action count
**Addresses:** Digest notifications (P3)

### Phase Ordering Rationale

- **Data flows downhill:** Reply -> Classification -> Aggregation -> Visualization -> Insights -> Actions -> Notifications. Each phase produces data the next phase consumes.
- **Immediate value at Phase 3:** Classified replies + analytics dashboard is useful without AI insights. Phases 1-3 deliver a functional Intelligence Hub. Phases 4-6 add the "intelligence" layer.
- **Data accumulation:** ICP calibration and insight generation improve with more data. Placing them later gives 4-8 weeks of classification data to work with.
- **Risk front-loading:** The hardest architectural decisions (taxonomy design, pre-computation strategy, webhook integration) are in Phases 1-2. Later phases are lower risk.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1 (Classification):** Needs real reply data labeling before taxonomy finalization. Export existing WebhookEvent reply data and manually classify 100+ samples. The two-tier rule-based/AI approach needs careful threshold tuning.
- **Phase 4 (ICP Calibration):** Statistical analysis at low data volumes is tricky. May need to research confidence interval approaches for small samples. Minimum viable data thresholds need validation.
- **Phase 5 (Insight Generation):** Prompt engineering for insight quality is the hard part. The difference between "your reply rate is 3%" (useless) and "your reply rate dropped 40% after switching copy strategy" (actionable) requires careful system prompt design and output validation.

Phases with standard patterns (skip research-phase):
- **Phase 2 (Analytics Aggregation):** Well-understood pattern — SQL aggregation + cron + cache table. Existing CachedMetrics model is ready.
- **Phase 3 (Dashboard UI):** Standard Next.js page + Recharts components + API routes reading from cache. No novel patterns.
- **Phase 6 (Digest Notifications):** Existing notification system with 17 types and audit logging. One more type following established patterns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new dependencies. Every capability verified against existing codebase with line-level references. |
| Features | MEDIUM-HIGH | Taxonomy based on competitor analysis (Instantly, Smartlead, Outreach, Reply.io). ICP calibration is novel — less external validation. |
| Architecture | HIGH | All integration points verified against existing code. Patterns follow established project conventions. |
| Pitfalls | MEDIUM-HIGH | Critical pitfalls well-documented. Neon cold-start estimates directional, not measured. Scheduling constraints verified. |

**Overall confidence:** HIGH

### Gaps to Address

- **Real reply data labeling:** Classification taxonomy is based on competitor analysis, not validated against actual Outsignal reply data. Must label 100+ real replies before finalizing Phase 1 plan.
- **EmailBison webhook payload completeness:** Research assumes `sequence_step` and `campaign_id` are available in webhook payloads. Must verify with actual webhook data before relying on per-step analytics.
- **CachedMetrics model behavior:** Model exists in schema but has zero usage anywhere in the codebase. Need to verify `upsert` behavior and unique constraint works as expected.
- **Cron-job.org capacity:** Adding 3 more scheduled jobs. Free tier supports this, but 30-second timeout constraint needs testing with actual aggregation runtime.
- **ICP calibration data volume:** At ~50-200 replies/month across 6 workspaces, meaningful per-workspace calibration may take 2-3 months of data accumulation.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `prisma/schema.prisma`, `src/app/api/webhooks/emailbison/route.ts`, `src/app/api/cron/poll-replies/route.ts`, `src/lib/agents/runner.ts`, `src/lib/icp/scorer.ts`, `src/lib/notifications.ts` — direct inspection with line-level references
- AI SDK `generateObject` usage pattern — verified in `src/lib/icp/scorer.ts`
- CachedMetrics model — verified in schema (line 241), confirmed unused via codebase grep

### Secondary (MEDIUM confidence)
- [Instantly Cold Email Benchmark 2026](https://instantly.ai/cold-email-benchmark-report-2026) — reply rate benchmarks (3.43% average)
- [Smartlead AI Categorization](https://helpcenter.smartlead.ai/en/articles/150-what-is-ai-categorization-and-how-does-it-work-with-smartlead) — classification taxonomy patterns
- [Outreach Sentiment Classification](https://support.outreach.io/hc/en-us/articles/4408420569883-Outreach-Sequence-Email-Sentiment-Classification) — sentiment layer design
- [Neon Connection Pooling](https://neon.com/docs/connect/connection-pooling) — cold start and connection behavior
- [Vercel Function Timeouts](https://vercel.com/kb/guide/what-can-i-do-about-vercel-serverless-functions-timing-out) — Hobby tier limits

### Tertiary (LOW confidence)
- Neon cold-start latency estimates (300-500ms) — based on known architecture, not measured on this project
- ICP calibration statistical validity thresholds (50+ data points per bucket) — general statistical practice, not validated for this domain

---
*Research completed: 2026-03-09*
*Ready for roadmap: yes*
