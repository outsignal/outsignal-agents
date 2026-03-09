# Feature Landscape: Campaign Intelligence Hub

**Domain:** Outbound sales campaign intelligence, reply classification, performance analytics, feedback loops
**Researched:** 2026-03-09
**Overall confidence:** MEDIUM-HIGH

---

> **Note:** This document supersedes the v2.0 FEATURES.md (which covered multi-source discovery, signal monitoring, Creative Ideas copy — all now shipped).
> This file covers only **v3.0 milestone** features: reply classification, campaign analytics, cross-workspace benchmarking, ICP calibration, AI insights, admin action queue, Intelligence Hub dashboard, digest notifications.

---

## Existing Features (Out of Scope for v3.0 Research)

Already shipped and not re-researched:
- EmailBison webhook handling (LEAD_REPLIED, LEAD_INTERESTED, UNTRACKED_REPLY_RECEIVED)
- Binary `interested` boolean from EmailBison on replies
- PersonWorkspace.status: new | contacted | replied | interested | bounced | unsubscribed
- Campaign model with copyStrategy, emailSequence, linkedinSequence
- Dashboard stats API with aggregate open/reply/bounce rates (fetched live from EmailBison API)
- Dashboard charts (activity chart, performance chart)
- ICP scoring with static threshold (default 70), icpScore/icpConfidence on PersonWorkspace
- SignalCampaignLead with outcome tracking (added/below_threshold/enriching)
- EmailDraft with status/version/feedback tracking
- Sender health monitoring (bounce rate, warmup tracking)
- Slack + email notifications for replies (17 notification types, audit logging)
- Knowledge base with 150+ documents, tag filtering
- Signal campaigns with auto-pipeline (signal -> enrich -> score -> campaign -> copy -> portal)

---

## Table Stakes

Features that any campaign intelligence layer must have. Without these, the Intelligence Hub adds no value over the existing dashboard.

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| **Reply storage (ReplyEvent model)** | Can't analyze what you don't store. Currently replies pass through webhook -> notification with zero persistence. This is the #1 blocker for everything in v3.0. | Low | Webhook handler modification, new Prisma model | Must store: sender email, body text, subject, timestamp, classification result, campaignId, workspaceSlug, personId. Currently the webhook fires notifications and updates status but discards the reply body. |
| **Reply classification (intent taxonomy)** | Every competitor does this (Instantly, Smartlead, Reply.io, Outreach). Binary interested/not-interested is obsolete — industry standard is 7-9 categories. | Medium | ReplyEvent model, Claude Haiku API call in webhook | Industry standard taxonomy: interested, meeting_booked, objection, referral, not_now, unsubscribe, out_of_office, auto_reply, not_relevant. Existing system only has boolean `interested` from EmailBison. |
| **Sentiment scoring** | Orthogonal to intent — "interested but annoyed" vs "interested and enthusiastic" are different situations requiring different responses. Outreach, Gong, and Salesloft all provide this. | Low | Reply classification (runs at same time) | Three-tier: positive/neutral/negative. LLM-based, classified in the same Haiku call as intent. Don't over-engineer with numeric scores. |
| **Campaign performance metrics (local)** | Currently fetched live from EmailBison API on each dashboard load. Must own the data locally for historical tracking, comparison, and offline analysis. | Medium | Campaign model, EmailBison stats sync job | Periodic snapshot (daily cron) that pulls EmailBison campaign stats and stores locally. Enables historical trending that EmailBison's API doesn't provide. |
| **Per-step sequence analytics** | Which email in the sequence gets the most replies? Step 1 vs Step 3 vs Step 5? Every outbound platform shows this. Currently no step attribution. | Medium | Reply storage with step number, Campaign emailSequence | EmailBison tracks which sequence step triggered a reply — this data comes in the webhook payload but is currently discarded. Must capture `sequence_step` field. |
| **Campaign ranking/comparison view** | Side-by-side performance of campaigns within a workspace. Basic table: Campaign A 8% reply rate, Campaign B 3%. | Low | Local campaign performance metrics | Simple sorting/filtering of campaigns by key metrics. Table view with sortable columns on the Intelligence Hub page. |

## Differentiators

Features that go beyond what Instantly/Smartlead offer. These are the "Intelligence" in Campaign Intelligence Hub — the closed feedback loop that self-hosted multi-tenant platforms uniquely enable.

| Feature | Value Proposition | Complexity | Dependencies | Notes |
|---------|-------------------|------------|--------------|-------|
| **ICP score calibration** | Do high-ICP-score leads actually convert? Correlate icpScore at send time with reply outcomes. Auto-suggest threshold adjustments. | High | Reply storage with personId linkage, SignalCampaignLead.icpScore, PersonWorkspace.icpScore, sufficient reply volume (~50+ per workspace) | This is the killer differentiator. No SaaS tool does this because they don't own the ICP scoring. Outsignal owns both scoring AND outcomes. Generates insight: "Leads scored 80+ reply at 12%, leads scored 60-79 reply at 3%. Recommend raising threshold to 75." Requires minimum data volume to be statistically meaningful. |
| **Cross-workspace benchmarking** | "Rise gets 8% reply rates with creative-ideas copy; Lime gets 3% with PVP. Creative-ideas works better for branded merchandise vertical." | Medium | Local campaign performance metrics across all 6 workspaces, Campaign.copyStrategy field, Workspace.vertical | Unique advantage of multi-tenant agency platform. Instantly can't do this — each client is a separate account. Group by: vertical, copyStrategy, signal type, time period. |
| **Copy strategy effectiveness comparison** | Compare creative-ideas vs PVP vs one-liner across campaigns globally. "Creative-ideas averages 7.2% reply rate; PVP averages 4.1% across all workspaces." | Low | Campaign.copyStrategy field (already exists), local reply metrics | Low complexity because the data structure exists. Just needs aggregation queries and a chart. High value for deciding which copy framework to use per client vertical. |
| **AI insight generation** | Scheduled analysis that produces actionable cards: "Campaign X underperforms workspace average by 40%. Consider: different subject line angle, narrower ICP targeting." | High | All analytics data materialized locally, Claude API call (Haiku for cost), new Insight model | Run weekly or on-demand. Generate 3-5 insights per workspace. Each insight has: type, observation, evidence (data), suggested_action, confidence, status (pending/approved/dismissed/deferred). Store in DB for tracking. |
| **Admin action queue** | Approve/dismiss/defer AI suggestions. "AI says: pause Campaign X due to 8% bounce rate." Admin clicks Approve -> campaign pauses. | Medium | AI insight generation, Campaign/Sender status management | This is the decision layer. AI analyzes, admin decides. Three actions: approve (execute suggestion), dismiss (ignore), defer (remind in N days). Track approval rates to improve insight quality over time. |
| **Objection pattern detection** | Cluster common objections across campaigns: "42% of objections mention budget, 28% mention timing." Surface patterns for copy iteration. | Medium | Reply classification with objection subtype, sufficient reply volume (50+ objection replies) | Requires LLM to extract objection themes from classified replies at classification time. Store as `objectionSubtype` on ReplyEvent. Only valuable at scale — build the storage now, defer the analysis UI until data volume justifies it. |
| **Signal-to-conversion tracking** | Which signal types (funding, hiring, tech adoption) lead to actual replies/meetings? Feed back into signal campaign prioritization. | Medium | SignalCampaignLead with signalEventId, reply outcomes linked to persons in signal campaigns | Unique to signal-driven outbound. "Funding signals produce 3x more interested replies than hiring signals for Rise." Requires joining ReplyEvent.personId -> SignalCampaignLead.personId -> signalEventId -> Signal.signalType. |
| **Digest notifications** | Weekly Slack/email summary: top 3 insights, best/worst performing campaign, notable patterns, pending action queue items. | Low | AI insight generation, existing Slack/email notification infrastructure (17 types, audit logging) | Leverages existing notification system. Schedule: weekly Monday morning. Opt-in per workspace. New notification type in existing `notifications.ts`. |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **ML-trained custom classifier** | At 6 workspaces and ~50-200 replies/month, there's not enough data to train a custom model. LLM-based classification is cheaper to build and more accurate at low volume. | Use Claude Haiku for classification with a structured prompt. One API call per reply (~$0.001/reply). Revisit ML only if reply volume hits 1000+/month consistently. |
| **Real-time classification streaming** | Replies come in at ~5-20/day across all workspaces. WebSocket/SSE for real-time classification updates is massive over-engineering. | Classify synchronously on webhook receipt. Display in dashboard on next page load. 30s polling refresh on Intelligence Hub page if needed. |
| **Predictive deal scoring** | This is CRM territory (HubSpot, Salesforce). Outsignal is a lead engine, not a CRM. Predicting close probability requires pipeline stage data that lives in client CRMs. | Track reply outcomes only: interested, meeting_booked, objection, dead. Let clients use their own CRM for deal tracking. |
| **A/B test orchestration** | Building subject line A/B testing infrastructure is massive scope creep. EmailBison already handles variant sending natively. | Analyze outcomes of existing A/B variants from EmailBison data. Don't build the testing mechanism — just measure and compare results. |
| **Per-lead intelligence timeline** | A detailed per-lead activity feed (opened at 2:04pm, clicked link at 2:07pm, replied at 2:12pm) is vanity data at Outsignal's scale and duplicates EmailBison's lead view. | Show reply classification + key outcome on person detail page. Aggregate stats matter more than individual tracking for an agency admin. |
| **Automated campaign pausing** | Automatically pausing campaigns based on metrics sounds smart but is dangerous. A bounce spike might be temporary. High reply rates might be all negative. | Surface insights with recommended actions in the admin action queue. Admin decides. Never auto-execute without explicit approval — that's the whole point of the action queue pattern. |
| **Client-facing analytics portal** | Building a separate portal view of analytics for clients adds UI surface area and permission complexity. Clients care about leads and approvals, not analytics. | Keep intelligence admin-only. Share insights with clients via digest emails or Slack messages when relevant. Admin is the analyst; clients are the approvers. |
| **Custom dashboard builder** | Drag-and-drop widget dashboards are complex to build and rarely used. Agency admin (one person) doesn't need customizable layouts. | Fixed, opinionated Intelligence Hub layout. One page with the right views in the right order. Iterate on layout based on usage, not configuration. |
| **Email thread reconstruction** | Rebuilding full email threads from webhook data requires parsing quoted text, threading by Message-ID headers, and handling forwarded chains. Complex and brittle. | Store the latest reply body only. If thread context is needed, link to EmailBison inbox where full threads are visible. |

---

## Reply Classification Taxonomy

Based on competitor analysis (Instantly, Smartlead, Outreach, Reply.io) — this is the industry-converged standard with Outsignal-specific additions.

### Intent Categories (mutually exclusive, one per reply)

| Category | Description | Auto-Action | Example |
|----------|-------------|-------------|---------|
| `interested` | Wants to learn more, open to conversation | Update PersonWorkspace.status to "interested", flag for follow-up | "Sure, I'd be open to a quick chat" |
| `meeting_booked` | Explicitly agrees to a meeting or provides availability | Highest priority flag, update status | "How about Tuesday at 2pm?" |
| `objection` | Pushes back but door isn't fully closed | Flag for nurture, extract objection subtype | "Not the right time" / "We already have a solution" |
| `referral` | Points to someone else in the org | Create new person record, attribute to original campaign | "You should talk to Sarah, she handles this" |
| `not_now` | Timing-based delay, not a hard no | Schedule re-engagement (extract timing if provided) | "Reach out next quarter" / "We're locked in until June" |
| `unsubscribe` | Explicit opt-out request | Mark PersonWorkspace DNC, remove from sequences | "Please remove me from your list" |
| `out_of_office` | Auto-reply with return date | Parse return date if present, store for re-send | "I'm out of office until March 15" |
| `auto_reply` | Non-OOO automated response (confirmations, ticket systems) | Ignore — don't count as meaningful reply | "Your message has been received" / ticket number confirmations |
| `not_relevant` | Wrong person, wrong company, no longer there | Mark as misfire, flag for ICP review | "I don't work there anymore" / "Wrong department" |

### Objection Subtypes (when intent = `objection`)

| Subtype | Description | Copy Iteration Signal |
|---------|-------------|----------------------|
| `budget` | Cost/budget constraints | Test lower-commitment CTAs, offer ROI proof |
| `timing` | Not the right time (no specific date — otherwise it's `not_now`) | Could become a re-engagement if timing shifts |
| `competitor` | Already using a competitor solution | Test competitive displacement angles |
| `authority` | Not the decision maker | Similar to `referral` but without redirect |
| `need` | Doesn't see the need / not a pain point | Weakest objection — may indicate poor ICP fit |
| `trust` | Skepticism about claims, company, or approach | Test social proof, case studies in copy |

### Sentiment (orthogonal to intent, assigned alongside)

| Level | Description | Impact on Prioritization |
|-------|-------------|------------------------|
| `positive` | Warm, open, enthusiastic tone | Higher priority within same intent category |
| `neutral` | Matter-of-fact, professional, no emotional signal | Standard priority |
| `negative` | Annoyed, hostile, frustrated tone | Lower priority, flag if pattern emerges |

### Classification Implementation

Single Claude Haiku API call per reply with structured output:
```json
{
  "intent": "objection",
  "objectionSubtype": "competitor",
  "sentiment": "neutral",
  "confidence": 0.92,
  "summary": "Uses competing solution (Lemlist), not interested in switching",
  "reengageDate": null
}
```

Estimated cost: ~$0.001 per classification. At 200 replies/month = $0.20/month. Negligible.

---

## Feature Dependencies

```
Reply Storage (ReplyEvent) ──────┬──> Reply Classification ──┬──> Sentiment Scoring
                                 │       (intent + objection  ├──> Objection Pattern Detection
                                 │        subtype + sentiment)├──> Per-Step Sequence Analytics
                                 │                            └──> Signal-to-Conversion Tracking
                                 │
                                 └──> All downstream analytics require stored replies

Campaign Perf Metrics (local) ───┬──> Campaign Ranking View
                                 ├──> Copy Strategy Comparison
                                 ├──> Cross-Workspace Benchmarking
                                 │
                                 └──┐
                                    ├──> AI Insight Generation ──> Admin Action Queue
Reply Classification ──────────────┘                          └──> Digest Notifications

ICP Score (exists on PersonWorkspace + SignalCampaignLead)
  + Reply Classification outcomes ──> ICP Score Calibration

SignalCampaignLead.signalEventId (exists)
  + Reply Classification outcomes ──> Signal-to-Conversion Tracking
```

**Critical path:** Reply Storage is the absolute foundation. Nothing works without persisting reply data. Classification depends on storage. All analytics depend on classification. Insights depend on analytics. Action queue depends on insights.

**Parallel tracks after Reply Storage:**
- Track A: Classification -> Sequence analytics -> Objection patterns
- Track B: Campaign metrics sync -> Ranking -> Benchmarking -> Copy comparison
- Track C (requires A+B): AI insights -> Action queue -> Digests
- Track D (requires A): ICP calibration, Signal-to-conversion

---

## Benchmark Data (for cross-workspace context)

Industry averages for cold outbound email (2025-2026 data, sourced from Instantly benchmark report and multiple platforms):

| Metric | Poor | Average | Good | Excellent |
|--------|------|---------|------|-----------|
| Open Rate | <25% | 27-40% | 40-55% | 55%+ |
| Reply Rate | <2% | 3-5% | 5-10% | 10%+ |
| Interested Rate (% of replies) | <15% | 15-25% | 25-40% | 40%+ |
| Bounce Rate | >5% | 2-5% | 1-2% | <1% |
| Positive Sentiment (% of replies) | <20% | 25-35% | 35-45% | 45%+ |

**By vertical (directional, not precise):**
| Vertical | Typical Reply Rate | Notes |
|----------|-------------------|-------|
| Branded Merchandise (Rise) | 4-7% | Product-focused, tangible offering |
| Recruitment (Lime) | 3-6% | Competitive space, high volume |
| Architecture PM (YoopKnows) | 5-8% | Niche vertical, less competition |
| Lead Generation (Outsignal) | 3-5% | Meta — selling to people who sell |
| Business Acquisitions (MyAcq) | 4-7% | High-value transactions, lower volume |
| Umbrella Solutions (1210) | 3-6% | Compliance-focused, timing-dependent |

These benchmarks should be built into the cross-workspace comparison view as reference bands, not hard rules.

---

## MVP Recommendation

**Phase 1 (Foundation):** Build these first — everything depends on them.
1. **Reply Storage model (ReplyEvent)** — new Prisma model, modify webhook handler to persist
2. **Reply Classification via Claude Haiku** — classify on webhook receipt, store intent/sentiment/objection subtype
3. **Campaign Performance snapshot** — daily cron to sync EmailBison campaign stats locally (CampaignMetricSnapshot model)

**Phase 2 (Analytics):** The core intelligence views.
4. **Intelligence Hub page** — new `/admin/intelligence` page with campaign ranking table
5. **Per-step sequence analytics** — which steps generate replies, heatmap or bar chart
6. **Cross-workspace benchmarking** — workspace-level metrics comparison with industry reference bands
7. **Copy strategy effectiveness comparison** — creative-ideas vs PVP vs one-liner aggregate metrics

**Phase 3 (Feedback Loop):** The differentiators that close the loop.
8. **ICP score calibration** — correlation analysis, threshold recommendation engine
9. **Signal-to-conversion tracking** — which signal types produce best outcomes
10. **Objection pattern detection** — cluster and surface common objection themes

**Phase 4 (AI Layer):** Automated insight generation.
11. **AI insight generation** — scheduled weekly analysis producing actionable cards (Insight model)
12. **Admin action queue** — approve/dismiss/defer UI on Intelligence Hub page
13. **Digest notifications** — weekly Slack/email summary of top insights + pending actions

**Defer:**
- **Objection pattern detection analysis UI**: Build the storage (objection subtypes) in Phase 1, but defer the clustering/visualization until data volume justifies it (~50+ objection replies).
- **Digest notifications**: Low complexity but low urgency. Build after the action queue exists so digests can include pending actions count.
- **Signal-to-conversion tracking**: Requires signal campaigns to have been running long enough to produce reply data. Build infrastructure in Phase 1 (link replies to signal campaigns) but defer analysis view.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Data Dependency | Priority |
|---------|------------|---------------------|-----------------|----------|
| Reply Storage (ReplyEvent) | CRITICAL (enables everything) | LOW | None | P0 |
| Reply Classification | HIGH (replaces binary interested) | MEDIUM | Reply Storage | P0 |
| Campaign Metrics Snapshot | HIGH (own the data locally) | MEDIUM | EmailBison API | P0 |
| Intelligence Hub page | HIGH (visibility, daily use) | MEDIUM | Classification + metrics | P1 |
| Campaign ranking/comparison | HIGH (which campaigns work?) | LOW | Local metrics | P1 |
| Cross-workspace benchmarking | HIGH (agency differentiator) | MEDIUM | Local metrics across workspaces | P1 |
| Copy strategy comparison | MEDIUM-HIGH (informs copy decisions) | LOW | Campaign.copyStrategy + metrics | P1 |
| Per-step sequence analytics | MEDIUM (optimization signal) | MEDIUM | Reply step attribution | P1 |
| ICP score calibration | HIGH (closes the scoring loop) | HIGH | Sufficient reply volume (~50+) | P2 |
| AI insight generation | HIGH (the "intelligence" in the name) | HIGH | All analytics data | P2 |
| Admin action queue | MEDIUM-HIGH (decision UX) | MEDIUM | AI insights | P2 |
| Signal-to-conversion tracking | MEDIUM (optimizes signal campaigns) | MEDIUM | Signal campaigns running + replies | P2 |
| Objection pattern detection | MEDIUM (copy optimization) | MEDIUM | 50+ objection replies | P3 |
| Digest notifications | LOW-MEDIUM (nice-to-have) | LOW | AI insights + existing notif system | P3 |

---

## Complexity Notes

### HIGH Complexity
- **ICP score calibration:** Requires statistical analysis (correlation between icpScore and reply outcomes), confidence intervals at low data volumes, actionable threshold recommendations. Must handle: insufficient data gracefully, multiple confounding variables (copy quality, timing, etc.), workspace-specific vs global calibration.
- **AI insight generation:** Must analyze multiple data streams (reply classification distribution, campaign metrics, ICP correlation, objection patterns, cross-workspace comparisons), produce non-obvious insights (not just "Campaign X has low reply rate"), and generate specific actionable suggestions. Prompt engineering is the hard part — the insight quality determines whether the action queue gets used.

### MEDIUM Complexity
- **Reply classification:** Single Haiku API call with structured output, but must handle edge cases: multi-intent replies ("I'm interested but not until Q3" = interested + not_now — pick dominant), non-English replies, very short replies ("K" or "?"), forwarded messages, and replies to replies (thread context).
- **Campaign metrics snapshot:** Must map EmailBison campaign IDs to local Campaign records, handle campaigns that exist in EmailBison but not locally (legacy), compute derived metrics (reply rate = replies / sent), and handle timezone alignment for daily snapshots.
- **Cross-workspace benchmarking:** Aggregation queries across workspaces with different campaign volumes, time periods, and maturity levels. Must normalize for volume (a workspace with 100 sends vs 10,000 sends shouldn't be compared raw). Statistical significance flags needed.

### LOW Complexity
- **Reply Storage model:** New Prisma model + webhook handler modification to persist reply body. ~50-80 lines of new code. Straightforward.
- **Campaign ranking view:** SQL query + table component. Sorting and filtering on existing metrics. ~100 lines.
- **Copy strategy comparison:** GROUP BY copyStrategy with AVG(replyRate). Chart component. ~80 lines.
- **Digest notifications:** New notification type using existing `notifications.ts` infrastructure. Scheduled via cron. ~100 lines.

---

## Sources

- [Instantly.ai Reply Agent system](https://instantly.ai/blog/ai-reply-agent-for-sales-teams/) — reply categories: interested, objection, not now, unsubscribe, OOO, auto-reply
- [Smartlead AI Categorization](https://helpcenter.smartlead.ai/en/articles/150-what-is-ai-categorization-and-how-does-it-work-with-smartlead) — interested/objection/referral/OOO/unsubscribe taxonomy
- [Outreach Sentiment Classification](https://support.outreach.io/hc/en-us/articles/4408420569883-Outreach-Sequence-Email-Sentiment-Classification) — positive/neutral/negative sentiment layer orthogonal to intent
- [Instantly Cold Email Benchmark Report 2026](https://instantly.ai/cold-email-benchmark-report-2026) — open/reply/bounce rate benchmarks across thousands of accounts
- [Cold Email Benchmarks 2026 (Oppora)](https://oppora.ai/blog/cold-email-benchmarks/) — industry vertical breakdown, conversion funnel data
- [Cold Email Reply-Rate Benchmarks (Digital Bloom)](https://thedigitalbloom.com/learn/cold-outbound-reply-rate-benchmarks/) — hook type vs reply rate data (timeline 10% vs problem 4.4%)
- [Coresignal: Predictive Lead Scoring](http://coresignal.com/blog/predictive-lead-scoring/) — self-learning ICP engine, feedback loop patterns
- [SayPrimer: ICP Feedback Loop](https://www.sayprimer.com/blog/customer-data-continuously-improve-b2b-icp) — continuous ICP refinement from conversion data
- [LaGrowthMachine: AI Intent Detection](https://lagrowthmachine.com/academy-chapter/ai-intent-detection-powered-segmentation/) — segmentation by intent for automated workflows
- [Instantly: Automate Email Reply Classification](https://instantly.ai/blog/automate-email-triage-classification-ai/) — AI triage taxonomy and automation patterns
- [B2B Cold Email Benchmarks by Industry](https://remotereps247.com/b2b-cold-email-benchmarks-2025-response-rates-by-industry/) — vertical-specific response rates
- Existing codebase: `src/app/api/webhooks/emailbison/route.ts` (webhook handler), `src/app/api/dashboard/stats/route.ts` (current stats API), `prisma/schema.prisma` (data model) — HIGH confidence (read directly)

---

*Feature research for: Outsignal Lead Engine v3.0 Campaign Intelligence Hub*
*Researched: 2026-03-09*
