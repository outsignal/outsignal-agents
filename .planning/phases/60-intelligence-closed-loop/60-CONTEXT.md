# Phase 60: Intelligence Closed Loop - Context

**Gathered:** 2026-04-01
**Status:** Ready for planning
**Source:** PRD Express Path (.planning/briefs/intelligence-closed-loop.md) + conversation decisions

<domain>
## Phase Boundary

Close the feedback loop: reply data -> analysis -> memory -> better copy. Every future writer/orchestrator session should be informed by what actually worked. Also fix the orchestrator CLI (chat.ts) not receiving memory context.

**In scope:**
- Backfill outboundSubject/outboundBody on 407 existing campaign-linked replies
- Cross-workspace reply analysis (per-client + global patterns)
- Write findings to memory files (global-insights.md + per-workspace campaigns.md)
- Make analysis recurring (weekly cron)
- Wire outbound copy tracking on new replies going forward
- Fix chat.ts orchestrator to load memory context (currently bypasses runAgent and misses memory injection)

**Out of scope:**
- Moving memory storage to database (agents run locally via CLI, Trigger.dev/Vercel agents handle empty memory gracefully)
- Changes to individual agent configs (memory injection is centralized in runner.ts)

</domain>

<decisions>
## Implementation Decisions

### Outbound Copy Backfill
- Reply model has outboundSubject and outboundBody fields — they exist but are never populated
- When a reply has campaignId + sequenceStep, look up the corresponding email sequence step from the campaign and backfill
- 407 of 439 replies (93%) have campaign linkage — these are the backfill targets
- Write a backfill script (or extend existing scripts/backfill-all-replies.ts)

### Reply Analysis
- Per-workspace analysis: reply rate by campaign/strategy, by sequence step, positive vs negative ratio, top subjects, top angles, objection patterns
- Cross-workspace analysis: strategy performance across verticals, universal step patterns, subject line length correlation, vertical benchmarks, campaign fatigue curves
- Analysis should produce specific, data-backed insights (not vague observations)

### Memory Write Format
- global-insights.md: `[ISO-DATE] [Vertical: {vertical}] — {pattern with specific numbers}`
- Per-workspace campaigns.md: `[ISO-DATE] — {copy insight specific to this client}`
- Format matches what loadMemoryContext() expects (hasRealEntries checks for ISO timestamps)
- Use appendToMemory() for per-workspace writes (validates entries, prevents garbage)
- Direct file write for global-insights.md (intelligence agent has write governance)

### Recurring Analysis
- Weekly cron (Monday) via Trigger.dev — extend existing infrastructure
- Re-runs cross-workspace analysis, updates memory files
- Compares current week vs previous to detect trend changes
- Existing daily insight cron: trigger/generate-insights.ts (runs 08:10 UTC)

### Webhook Handler Update
- src/app/api/webhooks/emailbison/route.ts — update to populate outboundSubject/outboundBody on new replies
- When reply arrives with campaignId + sequenceStep, look up outbound email and store
- Makes the analysis self-sustaining — new data feeds automatically

### Chat.ts Orchestrator Memory Fix
- scripts/chat.ts calls generateText() directly, bypassing runAgent() and missing memory injection
- Add loadMemoryContext(workspaceSlug) call before generateText()
- Merge into system prompt: `orchestratorConfig.systemPrompt + memoryContext + workspace context`
- Same pattern as runner.ts (best-effort, try/catch, never blocks)

### Claude's Discretion
- How to look up outbound email from campaignId + sequenceStep (EmailBison API vs cached data)
- Whether backfill script is standalone or extends existing backfill-all-replies.ts
- Whether weekly cron is a new Trigger.dev task or extends generate-insights.ts
- Analysis query strategy (Prisma queries vs CLI tools)

</decisions>

<specifics>
## Specific Ideas

### Data Inventory (from brief)
- 439 replies (Rise 105, Outsignal 103, MyAcq 92, YoopKnows 81, Lime 56, 1210 2)
- 93% have campaign linkage (407/439)
- Reply classification: intent, sentiment, objection subtype
- Campaign snapshots in CachedMetrics table
- EmailBison API available via campaigns-get.js CLI

### Key Files
- prisma/schema.prisma — Reply model (lines 283-364), CachedMetrics, Insight
- src/app/api/webhooks/emailbison/route.ts — webhook handler (525 lines)
- trigger/generate-insights.ts — daily insight cron
- trigger/snapshot-metrics.ts — daily campaign snapshot cron
- src/lib/emailbison/client.ts — EB API client
- .nova/memory/global-insights.md — cross-client patterns
- .nova/memory/{slug}/campaigns.md — per-workspace copy insights
- scripts/chat.ts — orchestrator CLI (needs memory fix)
- src/lib/agents/memory.ts — loadMemoryContext() function

### Memory System Integration
- Phase 59 built the read system: loadMemoryContext() loads 3 layers into agent system prompts
- appendToMemory() has isValidEntry() guard (rejects undefined, empty entries)
- hasRealEntries() checks for ISO timestamps — analysis output format must include these
- global-insights.md currently has placeholder text (cleaned in phase 59)

</specifics>

<deferred>
## Deferred Ideas

- Memory storage migration to database (for Trigger.dev/Vercel agents) — deferred until agent workloads move to production
- Real-time analysis triggers (analyze on each reply vs batch) — weekly batch is sufficient for now
- Writer agent auto-A/B testing based on memory insights — future phase

</deferred>

---

*Phase: 60-intelligence-closed-loop*
*Context gathered: 2026-04-01 via PRD Express Path*
