# Phase 60: Intelligence Closed Loop - Research

**Researched:** 2026-04-01
**Domain:** Reply analysis, agent memory write-back, Trigger.dev cron, EmailBison API
**Confidence:** HIGH

## Summary

This phase closes the feedback loop from reply outcomes to agent memory. The data is ready: 439 replies across 6 workspaces, 407 with campaign linkage, 25 distinct campaigns all with EmailBison campaign IDs. The critical discovery is that **0 replies currently have outboundSubject/outboundBody populated** despite the code paths existing in `process-reply.ts` and `backfill-all-replies.ts`. The backfill script only handles single-step campaigns (line 165: `if (steps.length === 1)`), and the process-reply code relies on `campaign.emailSequence` which is unpopulated for all 25 reply-linked campaigns. However, all 25 campaigns have `emailBisonCampaignId`, so the EmailBison API's `getSequenceSteps(campaignId)` can provide the outbound copy.

The memory system (Phase 59) is ready: `loadMemoryContext()` loads 3 layers into agent prompts, `appendToMemory()` validates and persists entries, `hasRealEntries()` checks for ISO timestamps, and `global-insights.md` is seeded but empty. The `chat.ts` orchestrator bypasses `runAgent()` and calls `generateText()` directly, missing the memory injection that `runner.ts` provides.

**Primary recommendation:** Build a backfill script that fetches outbound copy from the EmailBison API (not local `emailSequence`), run cross-workspace analysis via Prisma queries with LLM synthesis, write findings to memory files, add a weekly Trigger.dev cron, and fix `chat.ts` to call `loadMemoryContext()`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Reply model has outboundSubject and outboundBody fields -- they exist but are never populated
- When a reply has campaignId + sequenceStep, look up the corresponding email sequence step from the campaign and backfill
- 407 of 439 replies (93%) have campaign linkage -- these are the backfill targets
- Per-workspace analysis: reply rate by campaign/strategy, by sequence step, positive vs negative ratio, top subjects, top angles, objection patterns
- Cross-workspace analysis: strategy performance across verticals, universal step patterns, subject line length correlation, vertical benchmarks, campaign fatigue curves
- global-insights.md format: `[ISO-DATE] [Vertical: {vertical}] -- {pattern with specific numbers}`
- Per-workspace campaigns.md format: `[ISO-DATE] -- {copy insight specific to this client}`
- Use appendToMemory() for per-workspace writes; direct file write for global-insights.md
- Weekly cron (Monday) via Trigger.dev
- Webhook handler update to populate outboundSubject/outboundBody on new replies
- Chat.ts fix: add loadMemoryContext(workspaceSlug) call before generateText(), merge into system prompt

### Claude's Discretion
- How to look up outbound email from campaignId + sequenceStep (EmailBison API vs cached data)
- Whether backfill script is standalone or extends existing backfill-all-replies.ts
- Whether weekly cron is a new Trigger.dev task or extends generate-insights.ts
- Analysis query strategy (Prisma queries vs CLI tools)

### Deferred Ideas (OUT OF SCOPE)
- Memory storage migration to database (for Trigger.dev/Vercel agents) -- deferred until agent workloads move to production
- Real-time analysis triggers (analyze on each reply vs batch) -- weekly batch is sufficient for now
- Writer agent auto-A/B testing based on memory insights -- future phase
</user_constraints>

## Architecture Patterns

### Data Flow: Reply -> Outbound Copy -> Analysis -> Memory -> Better Copy

```
1. BACKFILL (one-time):
   Reply (campaignId) -> Campaign (emailBisonCampaignId) -> EB API getSequenceSteps() -> outboundSubject/outboundBody

2. WEBHOOK (ongoing):
   EB webhook -> process-reply.ts (already does campaign lookup + emailSequence match)
   FIX: Also check EB API when local emailSequence is missing

3. ANALYSIS (weekly):
   Prisma queries across Reply + Campaign tables -> LLM synthesis -> memory files

4. MEMORY -> AGENT:
   loadMemoryContext() -> global-insights.md + campaigns.md -> runner.ts system prompt injection
   FIX: chat.ts also calls loadMemoryContext()
```

### Current Data State (verified via DB queries)

| Metric | Value |
|--------|-------|
| Total replies | 439 |
| With campaignId | 407 (93%) |
| With sequenceStep | 41 (9%) |
| With outboundSubject | 0 (0%) |
| Distinct campaign IDs on replies | 25 |
| Campaigns with local emailSequence | 0 of 25 |
| Campaigns with emailBisonCampaignId | 25 of 25 |
| Workspaces with replies | 6 (Rise:105, Outsignal:103, MyAcq:92, YoopKnows:81, Lime:56, 1210:2) |

### Pattern 1: Outbound Copy Lookup Strategy

**Decision (Claude's discretion):** Use the EmailBison API `getSequenceSteps(campaignId)` as the primary source for outbound copy.

**Rationale:**
- 0/25 reply-linked campaigns have local `emailSequence` data
- All 25 have `emailBisonCampaignId` -- EB API is the only viable source
- `getSequenceSteps()` returns `{ id, campaign_id, position, subject, body, delay_days }`
- The `position` field maps to `Reply.sequenceStep` for step matching

**For replies missing sequenceStep (366/407):**
- Fetch all steps for the campaign via `getSequenceSteps(ebCampaignId)`
- If campaign has only 1 step, use it (same logic as existing backfill script)
- If multiple steps, leave outbound copy null (we can't determine which step was sent without EB data)
- The webhook path going forward sends `data.scheduled_email.sequence_step_order` so new replies will have this

**Implementation:**
```typescript
// Lookup pattern for both backfill and webhook fallback
async function lookupOutboundCopy(
  campaignId: string,
  sequenceStep: number | null,
): Promise<{ subject: string | null; body: string | null }> {
  // Try local emailSequence first (fast, no API call)
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { emailSequence: true, emailBisonCampaignId: true },
  });
  
  if (campaign?.emailSequence && sequenceStep != null) {
    const steps = JSON.parse(campaign.emailSequence);
    const match = steps.find((s: any) => s.position === sequenceStep);
    if (match) return { subject: match.subjectLine, body: match.body };
  }
  
  // Fall back to EmailBison API
  if (campaign?.emailBisonCampaignId) {
    const workspace = await prisma.workspace.findFirst({
      where: { campaigns: { some: { id: campaignId } } },
      select: { apiToken: true },
    });
    if (workspace?.apiToken) {
      const client = new EmailBisonClient(workspace.apiToken);
      const steps = await client.getSequenceSteps(campaign.emailBisonCampaignId);
      if (sequenceStep != null) {
        const match = steps.find(s => s.position === sequenceStep);
        if (match) return { subject: match.subject ?? null, body: match.body ?? null };
      } else if (steps.length === 1) {
        return { subject: steps[0].subject ?? null, body: steps[0].body ?? null };
      }
    }
  }
  
  return { subject: null, body: null };
}
```

### Pattern 2: Backfill Script Design

**Decision (Claude's discretion):** Create a new standalone script `scripts/backfill-outbound-copy.ts`.

**Rationale:**
- `backfill-all-replies.ts` does reply import from EB; mixing concerns would be confusing
- The new script has a single purpose: populate outboundSubject/outboundBody on existing replies
- Can be re-run safely (idempotent -- only updates null outbound fields)

**Design:**
1. Query all replies WHERE campaignId IS NOT NULL AND outboundSubject IS NULL
2. Group by campaignId to minimize API calls (1 call per campaign, not per reply)
3. For each campaign: fetch EB sequence steps once, cache them
4. For each reply: match by sequenceStep position, update outboundSubject/outboundBody
5. Handle missing sequenceStep: use single-step fallback
6. Report: per-workspace counts, total populated, total skipped

### Pattern 3: Cross-Workspace Analysis

**Analysis runs in two phases:**
1. **Data gathering** -- pure Prisma queries, no LLM needed
2. **Pattern synthesis** -- LLM summarizes findings into memory-format insights

**Prisma queries needed:**

```typescript
// Per-workspace: reply rate by campaign
const repliesByCampaign = await prisma.reply.groupBy({
  by: ['campaignId', 'campaignName'],
  where: { workspaceSlug, intent: { not: null } },
  _count: { id: true },
});

// Per-workspace: replies by sequence step
const repliesByStep = await prisma.reply.groupBy({
  by: ['sequenceStep'],
  where: { workspaceSlug, sequenceStep: { not: null } },
  _count: { id: true },
});

// Per-workspace: sentiment distribution
const sentimentDist = await prisma.reply.groupBy({
  by: ['sentiment'],
  where: { workspaceSlug, sentiment: { not: null } },
  _count: { id: true },
});

// Per-workspace: objection breakdown
const objections = await prisma.reply.groupBy({
  by: ['objectionSubtype'],
  where: { workspaceSlug, intent: 'objection', objectionSubtype: { not: null } },
  _count: { id: true },
});

// Cross-workspace: top subject lines (needs outbound data populated first)
const topSubjects = await prisma.reply.groupBy({
  by: ['outboundSubject'],
  where: { outboundSubject: { not: null }, sentiment: 'positive' },
  _count: { id: true },
  orderBy: { _count: { id: 'desc' } },
  take: 10,
});
```

**For reply rates**: CachedMetrics table has `campaign_snapshot` entries with `replyRate`, `openRate`, etc. Use these for rate calculations (they're pre-computed from EB campaign stats). Reply model counts alone show absolute numbers but not rates (we'd need total sends).

### Pattern 4: Weekly Cron Design

**Decision (Claude's discretion):** Create a new Trigger.dev task `trigger/weekly-analysis.ts` rather than extending `generate-insights.ts`.

**Rationale:**
- `generate-insights.ts` already does: daily insight generation, weekly digest emails, LinkedIn maintenance (3 separate concerns)
- Adding a 4th concern (cross-workspace analysis + memory write) would make it even harder to maintain
- A dedicated weekly task is cleaner, easier to test, and can run independently
- The existing `isMonday` check in `generate-insights.ts` is already used for the weekly digest -- don't overload it further

**Design:**
```typescript
// trigger/weekly-analysis.ts
export const weeklyAnalysis = schedules.task({
  id: "weekly-analysis",
  cron: "0 9 * * 1", // Monday 09:00 UTC (after generate-insights at 08:10)
  maxDuration: 120, // 2 min
  run: async () => {
    // 1. Gather data (Prisma queries)
    // 2. Synthesize patterns (LLM call with data)
    // 3. Write to global-insights.md
    // 4. Write to per-workspace campaigns.md via appendToMemory()
  },
});
```

**Note on Trigger.dev schedule limit:** Hobby plan has 100 schedule limit. Currently 18 tasks deployed. Adding 1 more is fine.

### Pattern 5: Webhook Handler Update

The webhook handler (`route.ts`) triggers `process-reply` via Trigger.dev. The `process-reply.ts` task already has outbound copy lookup logic (lines 76-105). The problem is:

1. It looks up from `campaign.emailSequence` which is null for all 25 reply-linked campaigns
2. It doesn't fall back to the EB API

**Fix:** Add EB API fallback in `process-reply.ts` when local emailSequence is missing. This is a small change (~15 lines) in the existing campaign lookup block.

The webhook handler itself (`route.ts`) does NOT need changes -- it already passes `campaignId` and `sequenceStep` to the process-reply task.

The inline fallback path in the webhook (lines 330-424) also needs the same fix, but it already uses the same pattern.

### Pattern 6: Chat.ts Memory Fix

`scripts/chat.ts` line 82-89 -- the `chat()` function:

```typescript
// CURRENT (broken -- no memory):
const result = await generateText({
  model: anthropic(orchestratorConfig.model),
  system:
    orchestratorConfig.systemPrompt +
    `\n\nCurrent workspace: ${workspaceSlug}\nInterface: CLI chat`,
  messages: trimMessages(messages),
  tools: orchestratorTools,
  stopWhen: stepCountIs(orchestratorConfig.maxSteps ?? 12),
});

// FIX (add memory):
const memoryContext = await loadMemoryContext(workspaceSlug);
const system = memoryContext
  ? `${orchestratorConfig.systemPrompt}\n\n${memoryContext}\n\nCurrent workspace: ${workspaceSlug}\nInterface: CLI chat`
  : `${orchestratorConfig.systemPrompt}\n\nCurrent workspace: ${workspaceSlug}\nInterface: CLI chat`;
```

This mirrors the pattern in `runner.ts` (lines 39-51). The memory load should be:
- Best-effort (try/catch, never blocks the chat)
- Loaded once at session start or per-message (per-message is safer for long sessions)
- Includes workspace slug for workspace-specific memory

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Outbound copy lookup | Custom EB API scraping | `EmailBisonClient.getSequenceSteps()` | Already implemented, handles pagination, rate limiting, retries |
| Memory file writing | Direct `fs.writeFile` for per-workspace | `appendToMemory()` from `src/lib/agents/memory.ts` | Validates entries, enforces 200-line cap, ISO timestamps, guards against corruption |
| Memory format | Custom format | ISO-dated entries per governance rules | `hasRealEntries()` regex checks for `[YYYY-MM-DDT` pattern -- must match |
| Reply rate calculation | Count replies / count leads | CachedMetrics `campaign_snapshot` entries | Pre-computed daily, includes `replyRate`, `openRate`, `bounceRate` per campaign |
| Insight synthesis | Template-based string building | LLM synthesis with structured data input | Patterns emerge from data -- LLM is better at identifying meaningful correlations |

## Common Pitfalls

### Pitfall 1: SequenceStep Position Mismatch
**What goes wrong:** EB API `getSequenceSteps()` returns `position` field, but it may be 0-indexed or 1-indexed depending on the campaign. Reply.sequenceStep comes from `data.scheduled_email.sequence_step_order` which is 1-indexed.
**Why it happens:** EB API docs don't clarify indexing.
**How to avoid:** When matching, try exact position match first. If no match and positions are off-by-one, try `position - 1`. Log mismatches for debugging.
**Warning signs:** Outbound copy doesn't match the reply subject when populated.

### Pitfall 2: Rate Limiting on EB API During Backfill
**What goes wrong:** 25 campaigns means 25 API calls to `getSequenceSteps()`. EB client has retry logic but may still hit rate limits.
**Why it happens:** Backfill runs all calls in quick succession.
**How to avoid:** Group replies by campaignId, fetch steps once per campaign (not per reply). Cache results in a Map. Add a small delay between campaigns if needed.

### Pitfall 3: Memory File Format Must Match hasRealEntries() Regex
**What goes wrong:** Analysis writes entries that `hasRealEntries()` doesn't recognize, so `loadMemoryContext()` skips the file thinking it's seed-only.
**Why it happens:** The regex `/\[\d{4}-\d{2}-\d{2}T/` requires ISO format with `T` separator.
**How to avoid:** Always use `[2026-04-01T09:00:00.000Z]` format, not `[2026-04-01]`. The `appendToMemory()` function handles this automatically, but direct writes to global-insights.md must also follow this pattern.

### Pitfall 4: Weekly Cron Runs on Vercel/Trigger.dev -- No Local Filesystem Access
**What goes wrong:** The weekly analysis task writes to `.nova/memory/` files, but Trigger.dev tasks run on Trigger.dev cloud, not the local machine.
**Why it happens:** Memory files are on the local filesystem, not in the database.
**How to avoid:** The weekly analysis task should NOT write to memory files directly. Instead, it should store analysis results in the database (e.g., Insight model or a new analysis results field). The memory write should happen via a LOCAL script that reads the analysis results and writes to files. OR: accept that the weekly cron outputs to DB/logs and manual/CLI triggers write to memory.
**This is the biggest design challenge of this phase.** CONTEXT.md defers DB memory migration, but the cron runs remotely. Options:
1. **CLI-only analysis**: Run analysis as a local script (`npx tsx scripts/weekly-analysis.ts`), not a Trigger.dev cron. Can write to local files directly. User runs it or sets up a local cron.
2. **Hybrid**: Trigger.dev cron gathers data + generates insights, stores in DB. A local post-hook reads DB and writes to memory files.
3. **Accept limitation**: The weekly cron writes insights to the Insight DB table (existing pattern). A simple local script syncs Insight rows to memory files periodically.

**Recommendation:** Option 3 (hybrid with DB storage). The generate-insights cron already writes to the Insight table. Add cross-workspace analysis to that pipeline, store results as Insight rows. Then a lightweight local script (`scripts/sync-insights-to-memory.ts`) reads recent Insights and writes to memory files. This keeps the cron pattern consistent and the memory write local.

### Pitfall 5: Backfill Script API Token Access
**What goes wrong:** Backfill script needs workspace API tokens to call EB API. These are stored in the Workspace table.
**Why it happens:** Not all workspaces have `apiToken` set.
**How to avoid:** Query workspaces with `apiToken: { not: null }` (same pattern as existing backfill script). Report skipped workspaces.

### Pitfall 6: Large Memory Files
**What goes wrong:** Weekly analysis appends many lines, hitting the 200-line max quickly.
**Why it happens:** `appendToMemory()` enforces a 200-line cap per file.
**How to avoid:** Write concise, deduplicated insights. For weekly updates, consider replacing old entries with updated stats rather than accumulating. For global-insights.md (direct write), implement similar capping logic.

## Code Examples

### Existing EmailBison Client - getSequenceSteps()
```typescript
// Source: src/lib/emailbison/client.ts lines 211-225
async getSequenceSteps(campaignId: number): Promise<SequenceStep[]> {
  const res = await this.request<{ data: Record<string, unknown>[] } | Record<string, unknown>[]>(
    `/campaigns/${campaignId}/sequence-steps`,
  );
  const raw = Array.isArray(res) ? res : (res.data ?? []);
  return raw.map((s) => ({
    id: s.id as number,
    campaign_id: (s.campaign_id ?? campaignId) as number,
    position: (s.order ?? s.position ?? 0) as number,
    subject: (s.email_subject ?? s.subject ?? "") as string,
    body: (s.email_body ?? s.body ?? "") as string,
    delay_days: (s.wait_in_days ?? s.delay_days ?? 0) as number,
  }));
}
```

### Existing Memory Append
```typescript
// Source: src/lib/agents/memory.ts lines 29-71
export async function appendToMemory(
  slug: string,
  file: MemoryFile,
  entry: string,
): Promise<boolean> {
  // Validates file exists, enforces 200-line max, checks isValidEntry()
  // Appends: [ISO-DATE] -- {entry}
}
```

### Existing Process-Reply Outbound Lookup
```typescript
// Source: trigger/process-reply.ts lines 76-105
// Currently only checks campaign.emailSequence (local DB)
// Needs fallback to EB API when emailSequence is null
if (campaign.emailSequence && sequenceStep != null) {
  const steps = JSON.parse(campaign.emailSequence);
  const matchedStep = steps.find((s) => s.position === sequenceStep);
  if (matchedStep) {
    outboundSubject = matchedStep.subjectLine ?? null;
    outboundBody = matchedStep.body ?? null;
  }
}
```

### Runner.ts Memory Injection Pattern
```typescript
// Source: src/lib/agents/runner.ts lines 39-51
let memoryContext = "";
try {
  memoryContext = await loadMemoryContext(options?.workspaceSlug);
} catch (err) {
  console.warn("[runner] Memory context load failed, proceeding without:", err);
}
const systemPrompt = memoryContext
  ? `${config.systemPrompt}\n\n${memoryContext}`
  : config.systemPrompt;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No outbound copy on replies | process-reply.ts looks up from local emailSequence | Phase 39 | Works only when emailSequence is populated (0/25 reply-linked campaigns) |
| No memory system | Phase 59: loadMemoryContext() + appendToMemory() | 2026-04-01 | Memory read/write infrastructure ready, but no data flowing |
| Daily insights only | generate-insights.ts + weekly digest | Phase 42 | Insights stored in DB but don't feed back to writer agent |

## Open Questions

1. **EB API Sequence Step Position Indexing**
   - What we know: EB webhook sends `scheduled_email.sequence_step_order`, EB API returns steps with `position` (or `order`)
   - What's unclear: Whether both use 0-indexed or 1-indexed positions
   - Recommendation: Test with one campaign during backfill. If mismatch, document and adjust.

2. **Weekly Cron vs Local Script for Memory Write**
   - What we know: Trigger.dev runs remotely, memory files are local. CONTEXT.md defers DB migration.
   - What's unclear: Whether the user prefers a fully automated cron (with DB intermediate storage) or a CLI script they run manually
   - Recommendation: Implement as CLI script first (`scripts/run-weekly-analysis.ts`), can be wired to Trigger.dev later when memory moves to DB. The backfill and initial analysis are one-time scripts anyway.

3. **CachedMetrics Freshness**
   - What we know: `snapshot-metrics.ts` runs daily, stores campaign snapshots
   - What's unclear: Whether all 25 reply-linked campaigns have recent snapshots (some may be old/completed)
   - Recommendation: Use CachedMetrics for reply rates where available, fall back to computing from Reply counts + EB campaign stats

## Sources

### Primary (HIGH confidence)
- `prisma/schema.prisma` -- Reply model (lines 283-364), Campaign model, CachedMetrics, Insight
- `trigger/process-reply.ts` -- existing outbound copy lookup logic (lines 76-105)
- `src/lib/emailbison/client.ts` -- getSequenceSteps() implementation (lines 211-225)
- `src/lib/agents/memory.ts` -- loadMemoryContext(), appendToMemory(), hasRealEntries()
- `src/lib/agents/runner.ts` -- memory injection pattern (lines 39-51)
- `scripts/chat.ts` -- current orchestrator CLI (no memory injection, lines 82-89)
- `trigger/generate-insights.ts` -- daily cron structure and weekly digest pattern
- `.nova/memory/global-insights.md` -- seed-only, empty (verified)
- DB queries -- verified actual data state (0 outbound populated, 407 campaign-linked, 25 campaigns with EB IDs)

### Secondary (MEDIUM confidence)
- `scripts/backfill-all-replies.ts` -- existing backfill pattern (single-step only limitation at line 165)
- `.planning/phases/60-intelligence-closed-loop/60-CONTEXT.md` -- user decisions and scope

## Metadata

**Confidence breakdown:**
- Data state: HIGH -- verified via direct DB queries
- Architecture: HIGH -- all key files read and understood
- Outbound copy lookup: HIGH -- EB API client exists and is proven
- Memory write pattern: HIGH -- Phase 59 infrastructure verified
- Weekly cron feasibility: MEDIUM -- remote execution vs local filesystem tension identified
- Chat.ts fix: HIGH -- simple pattern match from runner.ts

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable codebase, no external dependencies changing)
