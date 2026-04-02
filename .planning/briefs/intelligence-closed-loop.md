# Brief: Intelligence Closed Loop — Reply Analysis → Agent Memory

## Problem
We have 439 classified replies across 6 workspaces dating back to October 2025. 93% have campaign linkage. But:
1. Nobody's analyzed the data to extract patterns
2. The `outboundSubject`/`outboundBody` fields on the Reply model aren't populated — we know which campaign got a reply but not the exact email that triggered it
3. `global-insights.md` is empty — no cross-workspace patterns exist
4. Per-workspace memory files (`.nova/memory/{slug}/campaigns.md`) have no data-driven copy insights
5. The intelligence agent generates daily insights but they sit in the DB unread and don't feed back into the writer

## Goal
Close the loop: reply data → analysis → memory → better copy. Every future writer session should be informed by what actually worked.

## Data Available
- **439 replies** (Rise 105, Outsignal 103, MyAcq 92, YoopKnows 81, Lime 56, 1210 2)
- **Reply classification**: intent (interested/objection/meeting_booked/etc), sentiment (positive/neutral/negative), objection subtype
- **Campaign linkage**: 407/439 replies (93%) linked to an Outsignal campaign
- **Sequence step**: tracked on each reply — which step in the sequence triggered the reply
- **Campaign snapshots**: daily metrics stored in CachedMetrics table (reply rates, open rates, bounce rates, per-step breakdowns)
- **EmailBison API**: full campaign + sequence data available via `campaigns-get.js` CLI
- **Backfill script**: `scripts/backfill-all-replies.ts` exists for historical import

## Tasks

### Task 1: Populate outbound copy on replies
The Reply model has `outboundSubject` and `outboundBody` fields but they're never written to. When a reply exists with a `campaignId` and `sequenceStep`, look up the corresponding email sequence step from the campaign and backfill these fields.

- Backfill all 407 existing replies that have campaign linkage
- Wire the webhook handler to populate these fields on new replies going forward
- This enables direct copy → outcome analysis

### Task 2: Cross-workspace reply analysis
Run a comprehensive analysis across all workspaces:

**Per-workspace:**
- Reply rate by campaign and strategy (PVP, creative-ideas, one-liner, custom)
- Reply rate by sequence step (step 1 vs 2 vs 3) — where do replies come from?
- Positive vs negative reply ratio per campaign
- Top-performing subject lines (by reply rate)
- Top-performing copy angles (by positive reply rate)
- Objection patterns — which objections come up most per vertical?
- Best-performing time/day patterns (if timestamp data available)

**Cross-workspace:**
- Which strategies outperform across verticals?
- Which sequence step generates the most replies globally?
- Are there universal subject line patterns that work?
- Vertical-specific benchmarks (recruitment vs branded merch vs acquisitions etc.)
- Average reply rates by campaign age (do campaigns fatigue over time?)

### Task 3: Write findings to memory
Output the analysis to:

**`global-insights.md`** — cross-client patterns in the format:
```
[ISO-DATE] [Vertical: {vertical}] — {pattern with specific numbers}
```
Examples:
- `[2026-04-01] [Vertical: Recruitment] — PVP strategy 4.2% reply rate vs 1.8% for one-liner across 3 campaigns`
- `[2026-04-01] [Cross-Client] — Step 2 follow-ups generate 58% of all positive replies. Step 1 openers underperform.`
- `[2026-04-01] [Cross-Client] — Subject lines under 4 words: 3.1% reply rate. 5+ words: 1.4% reply rate.`

**Per-workspace `.nova/memory/{slug}/campaigns.md`** — workspace-specific patterns:
```
[ISO-DATE] — {copy insight specific to this client}
```
Examples:
- `[2026-04-01] — Rise: "branded kits" angle 3.4% reply rate vs "merch volume" 1.1%. Use kits framing.`
- `[2026-04-01] — YoopKnows: 80% of replies come from step 2. Step 1 opener is warming but not converting.`

### Task 4: Make analysis recurring
The daily insight generation cron (`trigger/generate-insights.ts`) already runs at 08:10 UTC. Extend it or create a new weekly task that:
- Re-runs the cross-workspace analysis every Monday
- Updates `global-insights.md` with new patterns
- Updates per-workspace memory files
- Compares current week vs previous week to detect trend changes

### Task 5: Wire outbound copy tracking on new replies
Update the webhook handler (`src/app/api/webhooks/emailbison/route.ts`) so that when a new reply comes in with campaign linkage, it looks up the outbound email that was sent and stores `outboundSubject` and `outboundBody` on the Reply record. This makes the analysis self-sustaining — new data feeds in automatically.

## Integration with Agent Memory System
The other agent is currently wiring memory read-back into the Monty agent system. The memory files this phase produces (`global-insights.md` and per-workspace `campaigns.md`) are exactly what the writer agent should read before generating copy. Coordinate:
- Memory format must match what the reader expects
- Cross-client insights go to `global-insights.md` (read by all agents)
- Workspace-specific insights go to `.nova/memory/{slug}/campaigns.md` (read by writer for that workspace)

## Success Criteria
1. All 407 campaign-linked replies have `outboundSubject` and `outboundBody` populated
2. `global-insights.md` contains 10+ data-backed cross-workspace patterns
3. Each active workspace's `campaigns.md` contains 3+ actionable copy insights
4. New replies automatically populate outbound copy fields
5. Weekly analysis cron updates memory files with fresh patterns
6. Writer agent sessions are measurably informed by reply outcome data

## Files to Know
- `prisma/schema.prisma` — Reply model (lines 283-364), CachedMetrics, Insight
- `src/app/api/webhooks/emailbison/route.ts` — webhook handler (525 lines)
- `trigger/generate-insights.ts` — daily insight cron
- `trigger/snapshot-metrics.ts` — daily campaign snapshot cron
- `scripts/cli/cached-metrics.ts` — metrics CLI
- `scripts/cli/insight-list.ts` — insights CLI
- `src/lib/emailbison/client.ts` — EB API client (has getReplies, getRecentReplies)
- `.nova/memory/global-insights.md` — cross-client patterns (currently empty)
- `.nova/memory/{slug}/campaigns.md` — per-workspace copy insights
- `scripts/backfill-all-replies.ts` — historical reply import script
