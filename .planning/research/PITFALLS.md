# Domain Pitfalls

**Domain:** Campaign Intelligence Hub — reply classification, campaign analytics, cross-workspace benchmarking, AI insight generation, admin action queue
**Researched:** 2026-03-09
**System context:** Next.js 16, Prisma 6, Neon PostgreSQL, Vercel Hobby, 14.5k people, 6 client workspaces, existing webhook/notification pipeline

---

## Critical Pitfalls

Mistakes that cause rewrites, data corruption, or trust erosion.

### Pitfall 1: Classification Taxonomy That Doesn't Match Reality

**What goes wrong:** You design a clean taxonomy (interested / not interested / out of office / unsubscribe / referral / objection) and discover real replies don't fit. "Let me check with my boss" — is that interested or objection? "We already use [competitor]" — objection or buying signal? A one-month-old OOO auto-reply followed by a real reply from the same person creates conflicting classifications.

**Why it happens:** Taxonomies designed from theory, not from reading actual replies. Cold outreach replies are messy: multi-intent, ambiguous, context-dependent. The existing webhook handler already has a `isNonRealReply` heuristic (lines 135-151 of `src/app/api/webhooks/emailbison/route.ts`) that catches OOO/bounce patterns with regex — this will conflict with LLM classification unless reconciled.

**Consequences:** Admins stop trusting classifications. Campaign performance metrics become unreliable. Downstream insight generation produces garbage conclusions.

**Prevention:**
- Export all existing `WebhookEvent` records with `eventType` in (LEAD_REPLIED, LEAD_INTERESTED, UNTRACKED_REPLY_RECEIVED) and manually label 100-200 replies before designing the taxonomy.
- Use a flat primary intent + confidence score, not a deep hierarchy. Start with 6-8 categories max: `interested`, `soft_positive` (referral, "check with boss"), `objection`, `not_interested`, `ooo_autoresponder`, `bounce_autoresponder`, `unsubscribe`, `unclear`.
- Add a `classificationOverride` field so the admin can correct misclassifications — this becomes training data for prompt refinement.
- Reconcile the existing `isAutomated` flag on `WebhookEvent` with the new classification engine — one source of truth, not two parallel systems.

**Detection:** If >15% of classifications land on "unclear" or admins override >10% of results in the first two weeks, the taxonomy needs revision.

**Phase:** Must be addressed in the very first phase (classification engine design).

---

### Pitfall 2: Cross-Workspace Data Leakage in Benchmarking

**What goes wrong:** Cross-workspace benchmarking exposes one client's campaign performance, reply content, or lead data to another client's view. Even if the admin dashboard is admin-only today, the client portal exists (`portal.outsignal.ai`) and benchmark data could leak through future portal features, API responses, or cached metrics.

**Why it happens:** The current data model uses `workspaceSlug` as a filter, not a hard security boundary. `Person` and `Company` are workspace-agnostic. Benchmarking queries that aggregate across workspaces inherently cross boundaries. The `CachedMetrics` model already has `workspace` scoping but benchmark aggregates would be `workspace="__global__"` or similar — any bug in the query exposes cross-tenant data.

**Consequences:** Client trust destroyed. Potential contractual/legal violations. Competitors seeing each other's reply rates.

**Prevention:**
- Benchmarking data must ONLY expose anonymized aggregates: "your reply rate is 4.2%, vertical average is 3.1%". Never expose campaign names, lead names, reply text, or per-workspace breakdowns that identify other clients.
- Store benchmark aggregates as pre-computed snapshots (vertical averages, overall averages) — never compute them on-the-fly from raw cross-workspace data in client-facing contexts.
- Add a `benchmarkConsent` boolean to `Workspace` — only include workspaces that opt in to anonymous benchmarking.
- If benchmark data ever reaches the client portal, use a dedicated read-only table that physically cannot contain identifying information.
- Code review checklist: "Does this query join/aggregate across workspaces? If yes, is identifying data excluded?"

**Detection:** Any API response that contains data from workspace X when workspace Y is the requesting context is a data leak.

**Phase:** Architecture decision needed before any cross-workspace analytics. Benchmark phase must come AFTER single-workspace analytics are solid.

---

### Pitfall 3: Analytics Queries Killing Dashboard Page Load on Vercel

**What goes wrong:** Dashboard pages make 3-5 analytics queries per render. Each query scans `WebhookEvent` (growing fast — every EMAIL_SENT, BOUNCE, reply, unsubscribe creates a row), `Person`, `PersonWorkspace`, and `Campaign` tables. On Neon serverless, cold-start wake-up adds 300-500ms. Complex aggregations (GROUP BY workspace, campaign, date range with JOINs) add 1-3 seconds. Page load hits 4-8 seconds, or worse, the Vercel Hobby 10-second function timeout kills the request.

**Why it happens:** Analytics queries are fundamentally different from CRUD queries. The existing codebase is optimized for single-record operations (webhook creates, lead updates). Aggregating 14k+ people across 6 workspaces with date range filters and campaign grouping requires table scans. Neon handles them, but not instantly — especially with cold starts.

**Consequences:** Intelligence Hub dashboard is unusable. Admin stops checking it. The entire v3.0 feature becomes shelfware.

**Prevention:**
- Pre-compute ALL analytics into a `CachedMetrics`-like table (model already exists in schema at line 241). Compute on a schedule or on-demand with cache TTL, never on page load.
- Dashboard pages read ONLY from pre-computed tables. Zero raw aggregation queries in page components.
- Use a "last computed: X minutes ago" indicator + manual refresh button instead of real-time computation.
- Add database indexes for analytics: composite indexes on `WebhookEvent(workspaceSlug, receivedAt)` already exist (line 237-239), but add `(workspaceSlug, eventType, receivedAt)` for filtered time-range queries.
- Single API route that returns the full pre-computed dashboard payload in one request — no waterfall of 5 separate fetches.

**Detection:** If any analytics API route takes >2 seconds in development, it will timeout in production under load.

**Phase:** Caching/pre-computation infrastructure must be built BEFORE the dashboard UI. Build the compute engine first, then the display layer.

---

### Pitfall 4: LLM Classification Cost Spiral

**What goes wrong:** Every incoming reply triggers an LLM call for classification. At current volume (~3.4% reply rate on thousands of emails = 50-200 replies/month), this is manageable. But the webhook handler fires for EMAIL_SENT, BOUNCE, UNSUBSCRIBED events too. If classification is naively triggered on all webhook events, or if the poll-replies cron (`/api/cron/poll-replies`) reprocesses already-classified replies, costs multiply. The existing `generateReplySuggestion()` function (line 65) already calls the Writer Agent per reply — adding classification doubles per-reply LLM costs.

**Why it happens:** The boundary between "what needs classification" and "what doesn't" isn't obvious. The webhook handler processes 6+ event types. The poll-replies cron catches missed webhooks and will re-fetch replies that may already be classified.

**Consequences:** Unnecessary API spend. Duplicate classifications creating conflicting records. Classification results overwritten on re-processing.

**Prevention:**
- Gate classification strictly: ONLY on `(LEAD_REPLIED | LEAD_INTERESTED | UNTRACKED_REPLY_RECEIVED)` AND `isAutomated === false`. This matches the existing notification trigger (line 332-334 of webhook route).
- Add a `classifiedAt` timestamp to the classification record. Skip if already classified (idempotency guard).
- Use Haiku for classification — structured extraction, not creative writing. ~$0.001 per call vs $0.015 for Sonnet.
- Batch classify in the poll-replies cron rather than one-at-a-time.
- Track classification cost in `DailyCostTotal` alongside enrichment costs.
- Coordinate with existing `generateReplySuggestion()` — classify first, then use classification result to inform reply suggestion (one LLM call feeds the other, avoid duplicate analysis).

**Detection:** If classification costs exceed $5/month at current volume, something is processing events it shouldn't.

**Phase:** Classification engine phase must include cost tracking from day one.

---

## Moderate Pitfalls

### Pitfall 5: Action Queue Without Idempotency

**What goes wrong:** Admin clicks "Apply suggestion" on an insight card. Network is slow, they click again. Two campaign adjustments are applied. Or: the cron that generates insights runs twice (Vercel cold start retry, cron-job.org timeout retry), creating duplicate insight cards.

**Why it happens:** Serverless functions are stateless. The existing system already has retry patterns — `LinkedInAction` uses `status` + `attempts` for safety, but the action queue is a different domain needing its own idempotency.

**Prevention:**
- Every action queue item gets an idempotency key derived from content (hash of `insightType + workspaceSlug + campaignId + suggestedAction + period`). Use `@@unique` constraint to prevent duplicates.
- Admin actions use optimistic locking: update with `WHERE status = 'pending'`. If 0 rows affected, already processed.
- Insight generation uses `upsert` with unique composite key on `[workspaceSlug, insightType, period]`.
- State transitions are one-directional: `pending -> approved | dismissed | deferred`. No reversals.

**Detection:** Duplicate insight cards in the dashboard, or admin seeing "already actioned" errors frequently.

**Phase:** Action queue model design phase. Baked into schema, not bolted on.

---

### Pitfall 6: Insight Generation Hallucinations

**What goes wrong:** The AI insight engine says "Campaign X has a 12% reply rate, which is 3x your average" but the actual reply rate is 4%. Or worse: "Rise's email style outperforms Lime Recruitment's" — leaking cross-workspace comparison in a generated insight.

**Why it happens:** LLMs are unreliable at arithmetic. If you pass raw data and ask "what's the reply rate?", it might count wrong. If you pass data from multiple workspaces for comparison context, it might reference them by name in the output.

**Prevention:**
- NEVER let the LLM compute metrics. Pre-compute ALL numbers (reply rate, open rate, conversion rate) with SQL/code. Pass pre-computed numbers to the LLM with a prompt: "Given these metrics, generate 3 actionable insights."
- The LLM's job is narrative generation and pattern recognition on pre-computed data, NOT arithmetic.
- Validate output: if an insight references a number, check against pre-computed value. If it mentions a workspace name other than the current one, reject it.
- Template-based insights for common patterns ("Reply rate dropped X% this week") with LLM only for nuanced observations.
- System prompt: "You are analyzing data for {workspace}. Never mention other workspace names or identifiable client data."

**Detection:** A/B test first batch of insights against manually verified data. If accuracy on factual claims is below 95%, add more guardrails.

**Phase:** Insight generation phase. Build metric computation first, layer LLM narrative on top.

---

### Pitfall 7: Alert Fatigue from Insight Overload

**What goes wrong:** System generates 15 insight cards per workspace per week. Admin has 6 workspaces = 90 cards to review. Within two weeks, the admin stops checking. The Slack digest becomes noise. The action queue grows stale.

**Why it happens:** Easy to generate insights — hard to generate valuable ones. "Your reply rate is 3.2%" is an observation. "Your reply rate dropped 40% since switching from Creative Ideas to PVP copy strategy — consider reverting" is actionable.

**Prevention:**
- Hard cap: 3-5 insight cards per workspace per analysis cycle. Force-rank by impact score.
- Insight categories: `action_required` (something broken/declining), `opportunity` (improvement available), `fyi` (informational). Only `action_required` triggers notifications.
- Auto-dismiss stale insights after 14 days without action. No unbounded queue growth.
- Dedup: if same pattern repeats across consecutive cycles, consolidate into one persistent insight with a trend indicator — don't create 4 separate cards.
- Start with weekly digest only. Add real-time notifications later if admin asks.

**Detection:** If admin dismisses >50% of insights without reading them (track time-to-dismiss), signal-to-noise is too low.

**Phase:** Insight generation phase. Ranking/filtering logic matters more than generation logic.

---

### Pitfall 8: Scheduling Analytics Runs — No Cron Slots Left

**What goes wrong:** Vercel Hobby allows 2 cron expressions. Both already used externally via cron-job.org (reply poller every 10min, inbox health check daily at 6am UTC). Analytics computation needs scheduled runs (hourly metric refresh, daily insight generation). No cron slot available, and cron-job.org free tier has a 30-second timeout — analytics might exceed that.

**Why it happens:** Vercel Hobby is for simple apps, not analytics platforms. The workaround (cron-job.org) works but has timeout limits.

**Prevention:**
- Use cron-job.org for the trigger, but make the endpoint fast: enqueue the job (write to `ScheduledJob` table) and return 200 in <1s.
- Actual computation runs via `waitUntil()` / Next.js `after()` for background processing within the Vercel function invocation (Fluid Compute supports this on Hobby).
- Alternatively, Railway already runs the LinkedIn worker — add analytics cron to Railway. Cleaner path since Railway has no 30s timeout.
- For daily insight generation (LLM calls, 30-60s), Railway is the only viable option on Hobby tier.
- Design computation to be resumable: if function times out, save progress, continue next invocation.

**Detection:** If analytics data shows "last computed: 6 hours ago" when it should be hourly, scheduling is failing silently.

**Phase:** Infrastructure decision needed early. Decide Railway vs cron-job.org + background processing before building the compute engine.

---

### Pitfall 9: Building an Autonomous System When Admin-Driven Is the Goal

**What goes wrong:** System automatically pauses underperforming campaigns, adjusts ICP thresholds, or changes sending schedules based on AI analysis. A campaign gets paused at 2am on a Friday. Admin wakes up to angry client messages because leads stopped flowing. The system "optimized" something that didn't need it.

**Why it happens:** Tempting to make the system smart and autonomous. The v3.0 description explicitly says "the system does the analysis; the admin makes the decisions" — but scope creep turns suggestions into auto-actions.

**Prevention:**
- HARD RULE: The system SUGGESTS, the admin ACTS. No auto-actions, ever. Every suggestion is a card in the action queue requiring explicit approval.
- Even "obvious" actions (pause campaign with 0% reply rate after 2 weeks) must be suggestions, not automatic.
- Three responses: Approve (execute), Dismiss (ignore), Defer (remind later). No "auto-approve" option.
- Log every admin action via existing `AuditLog` model for intelligence actions too.
- Visually distinguish suggestions from applied actions in UI (yellow for "suggested", green for "applied").

**Detection:** If any code path modifies campaign/workspace settings without an admin action record, it violates the design principle.

**Phase:** Design constraint from phase one, enforced throughout all phases.

---

## Minor Pitfalls

### Pitfall 10: Reply Classification on Sparse Data

**What goes wrong:** A new workspace has 2 replies. System computes reply rate, classifies sentiment distribution, generates insights. The numbers are meaningless (50% positive sentiment = 1/2 replies). "Your interested rate is 3x the vertical average" is statistically invalid.

**Prevention:**
- Minimum thresholds: no campaign performance ranking until 50+ emails sent. No sentiment distribution until 10+ classified replies. No cross-workspace benchmarking until 3+ workspaces have sufficient data.
- Display "insufficient data" placeholders with threshold needed: "12 more replies needed for sentiment analysis."

**Phase:** Dashboard UI phase. Build threshold checks into every metric component.

---

### Pitfall 11: Schema Migration Complexity

**What goes wrong:** Intelligence hub needs 4-6 new models (ReplyClassification, CampaignMetric, InsightCard, AdminAction, BenchmarkSnapshot). Adding to a 1099-line schema with 30+ models using `db push` (no migration history) risks data loss if push goes wrong.

**Prevention:**
- Continue `db push` (proven pattern) but back up Neon DB before schema changes (Neon branching or `pg_dump`).
- Add new models incrementally — one or two per phase, test each on a Neon branch first.
- New models should be additive (new tables). The only existing table needing modification is `WebhookEvent` (add classification linkage) — plan that carefully.

**Phase:** Every phase that adds models.

---

### Pitfall 12: Conflicting Classification Between Webhook Handler and Classification Engine

**What goes wrong:** The webhook handler (lines 267-289) already sets `Person.status` to "replied" or "interested" based on `eventType`. The new classification engine assigns its own intent categories. Now `Person.status = "interested"` but `ReplyClassification.intent = "objection"` because EmailBison's `LEAD_INTERESTED` flag disagrees with the LLM assessment.

**Prevention:**
- Document the hierarchy: EmailBison's event type is the initial signal, LLM classification is the refined analysis. Different purposes — don't reconcile into one field.
- `Person.status` remains the lifecycle status (new -> contacted -> replied -> interested). `ReplyClassification.intent` is the semantic analysis.
- Intelligence Hub uses `ReplyClassification.intent` for analytics, not `Person.status`.
- Display both in UI: "Status: Interested (EmailBison) | Intent: Soft objection - budget concern (AI)" — let admin see both signals.

**Phase:** Classification engine design phase.

---

### Pitfall 13: ICP Score Calibration Chicken-and-Egg Problem

**What goes wrong:** A key v3.0 feature is "ICP score calibration — do high scores actually convert?" But reply classification data doesn't exist yet (being built in the same milestone). Campaign performance attribution requires mapping replies back to campaigns, which requires `WebhookEvent.campaignId` to reliably match `Campaign.emailBisonCampaignId`. If this linkage has gaps (untracked replies, replies from campaigns created before the Campaign model existed), calibration data is incomplete and conclusions are wrong.

**Why it happens:** ICP scores exist on `PersonWorkspace.icpScore` (0-100). Reply data exists on `WebhookEvent`. But connecting them requires: person X was scored Y, was sent campaign Z, and replied with intent W. Each join depends on data completeness from different system eras.

**Prevention:**
- Start ICP calibration as "prospective only" — only analyze people scored AND sent AND replied AFTER the classification engine is deployed. Don't try to retroactively classify old replies for calibration.
- Build the reply-to-campaign-to-person linkage first as a materialized view or pre-computed table, verify data completeness before building calibration logic on top.
- Accept that meaningful calibration data requires 2-3 months of classified replies before conclusions are statistically valid. Show "collecting data" placeholder until then.

**Detection:** If calibration analysis has <50 data points per ICP score bucket, the results are noise.

**Phase:** ICP calibration should be one of the last phases — it depends on classification + analytics being stable first.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Reply classification engine | Taxonomy doesn't match reality (#1), cost spiral (#4), conflicts with existing status (#12) | Label 100+ real replies before designing taxonomy. Gate on reply events only. Separate intent from lifecycle status. |
| Campaign analytics computation | Queries kill page load (#3), sparse data misleads (#10) | Pre-compute everything into cache tables. Add minimum data thresholds per metric. |
| Cross-workspace benchmarking | Data leakage (#2), hallucination references other clients (#6) | Anonymize-only aggregates. Pre-compute benchmarks. Validate LLM output against workspace context. |
| Insight generation | Hallucinated numbers (#6), alert fatigue (#7), autonomous actions (#9) | LLM narrates pre-computed data only. Cap 3-5 insights/cycle. Suggest-only, never auto-act. |
| Action queue | No idempotency (#5), race conditions on approve/dismiss | Idempotency keys as unique constraints. Optimistic locking on status transitions. |
| Intelligence Hub dashboard | Slow page load (#3), stale data | Single-payload API route from pre-computed tables. "Last computed" indicator. Background refresh. |
| ICP score calibration | Chicken-and-egg (#13), insufficient data for conclusions | Prospective-only analysis. Minimum data thresholds. Build reply-campaign-person linkage first. |
| Scheduling/infrastructure | No cron slots (#8), timeout constraints | Railway for heavy computation. cron-job.org trigger + `after()` for light work. |
| Schema additions | Migration risk (#11) | Incremental model additions per phase. Neon branch testing. Backup before every `db push`. |

---

## Integration Pitfalls (v3.0-specific)

| Integration Point | Common Mistake | Correct Approach |
|-------------------|----------------|------------------|
| WebhookEvent → ReplyClassification | Classifying every webhook event, including EMAIL_SENT and BOUNCE | Gate strictly: only LEAD_REPLIED, LEAD_INTERESTED, UNTRACKED_REPLY_RECEIVED where `isAutomated === false` |
| Classification + Reply Suggestion | Running classification AND `generateReplySuggestion()` as independent LLM calls on the same reply | Classify first, pass classification result as context to reply suggestion — avoids duplicate analysis |
| Poll-replies cron + classification | Re-classifying replies already classified via webhook path | Check `classifiedAt` timestamp before calling LLM. Idempotency guard. |
| CachedMetrics + fresh data | Serving stale cached metrics without indicating staleness | Always display "last computed" timestamp. Allow manual refresh. Auto-refresh on page visit if cache is >1 hour old. |
| Benchmark aggregates + workspace identity | Including workspace identifiers in benchmark computation output | Pre-compute benchmarks as anonymous vertical/overall averages. Never pass workspace names to benchmark computation functions. |
| Campaign model + analytics | Assuming all campaigns have `emailBisonCampaignId` for reply attribution | Some campaigns are draft/signal/LinkedIn-only. Handle null `emailBisonCampaignId` gracefully in analytics joins. |
| Admin action execution | Executing the suggested action directly from the insight generation function | Insight generates a record. Admin clicks approve. Separate execution function reads the approved record and acts. Three separate steps, never collapsed. |

---

## "Looks Done But Isn't" Checklist (v3.0)

- [ ] **Classification engine returns results** — verify against 20 manually-labeled replies. Check that OOO replies match existing `isNonRealReply` logic. Check confidence scores distribute sensibly (not all 0.99).
- [ ] **Campaign analytics dashboard loads** — verify it reads from `CachedMetrics`, not raw tables. Check page load time under 2s. Verify Neon cold start doesn't cause timeout.
- [ ] **Cross-workspace benchmarks display** — verify no workspace names, campaign names, or reply text appear in benchmark data. Test with 2 workspaces and verify neither can see the other's specifics.
- [ ] **Insight cards generate** — verify all numbers in insights match pre-computed metrics. Check no insight references a workspace name other than the target. Verify cap of 3-5 per cycle is enforced.
- [ ] **Action queue approve/dismiss works** — verify double-click doesn't create duplicate actions. Check audit log entry is created. Verify the actual campaign/setting change happens only on approve.
- [ ] **Analytics cron runs on schedule** — verify it runs on Railway or cron-job.org (not Vercel cron). Check it completes within timeout. Check it's idempotent (running twice produces same result).
- [ ] **ICP calibration shows results** — verify minimum data thresholds are enforced. Check "insufficient data" placeholder appears for new workspaces. Verify only post-v3.0 classified replies are used.

---

## Sources

- [Neon Connection Pooling](https://neon.com/docs/connect/connection-pooling) — 10k pooled connection limit, PgBouncer transaction mode, 300-500ms cold start
- [Vercel Function Timeouts](https://vercel.com/kb/guide/what-can-i-do-about-vercel-serverless-functions-timing-out) — Hobby 10s limit, Fluid Compute for background processing
- [Upstash Vercel Workflow Patterns](https://upstash.com/blog/vercel-cost-workflow) — Queue-based decomposition for long-running jobs
- [AWS Multi-Tenant RLS Guide](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/) — Row-level security for workspace isolation
- [Voiceflow LLM Classification Tips](https://www.voiceflow.com/pathways/5-tips-to-optimize-your-llm-intent-classification-prompts) — Two-part classification architecture, prompt optimization
- [Langfuse Intent Classification Pipeline](https://langfuse.com/guides/cookbook/example_intent_classification_pipeline) — Structured classification with evaluation loops
- [IBM Alert Fatigue Reduction](https://www.ibm.com/think/insights/alert-fatigue-reduction-with-ai-agents) — AI-driven alert prioritization, 70% reduction in redundant notifications
- [Instantly Cold Email Benchmark 2026](https://instantly.ai/cold-email-benchmark-report-2026) — 3.43% average reply rate baseline for calibration
- [Prisma Production Guide](https://www.digitalapplied.com/blog/prisma-orm-production-guide-nextjs) — Connection management, race condition handling, P2002 error recovery
- [Neon 2025 Updates](https://dev.to/dataformathub/neon-postgres-deep-dive-why-the-2025-updates-change-serverless-sql-5o0) — PostgreSQL 18 async I/O improvements
- Existing codebase: `prisma/schema.prisma` (1099 lines, 30+ models), `src/app/api/webhooks/emailbison/route.ts` (428 lines, reply handling + classification hook points)

---
*Pitfalls research for: Campaign Intelligence Hub — v3.0 milestone*
*Researched: 2026-03-09*
