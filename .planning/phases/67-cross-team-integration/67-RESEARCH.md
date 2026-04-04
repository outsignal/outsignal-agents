# Phase 67: Cross-Team Integration - Research

**Researched:** 2026-04-04
**Domain:** Cross-team memory communication, structured notification format, Monty Radar polling
**Confidence:** HIGH

## Summary

Phase 67 connects Nova and Monty agent teams through structured cross-team memory writes and automated alerting. The foundation is mostly built: Monty agents (Dev, QA, Security) already write to `.nova/memory/global-insights.md` via `appendToGlobalMemory()` in their `onComplete` hooks. The existing writes use a `[Monty Dev]` / `[Monty QA]` / `[Monty Security]` prefix but lack structured machine-parseable prefixes with change type classification.

What's missing is threefold: (1) structured prefixes on Monty-to-Nova writes that identify source agent AND change type, (2) the reverse direction -- Nova agents writing platform issues to `.monty/memory/incidents.md`, and (3) Monty Radar polling these cross-team files for new entries and triggering acknowledgment.

Monty Radar is a scheduled remote Claude Code agent (Opus 4.6, Max plan) that runs hourly. It is NOT a Trigger.dev task and NOT an in-app cron. It calls `GET /api/health/radar` (authenticated via `x-api-key`) and alerts via ntfy (`outsignal-monty-jjay` topic) and Slack. The radar currently monitors workspace health, LinkedIn senders, email domains, blacklists, and API credit balances. Cross-team memory polling is a new capability to add to the radar's health endpoint response.

**Primary recommendation:** Add structured prefix format to existing `appendToGlobalMemory` calls, add `appendToMontyMemory("incidents.md", ...)` to Nova agents' onComplete hooks, extend `/api/health/radar` to return cross-team memory entries since last poll, and document how Monty Radar (the remote agent) should interpret and act on them.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FOUND-09 | Cross-team notification system -- Monty agents write platform changes to `.nova/memory/global-insights.md`, Nova agents write platform issues to `.monty/memory/incidents.md` | Monty->Nova direction already exists (3 agents write via onComplete hooks). Nova->Monty direction does not exist yet. Both directions need structured prefixes. |
| FOUND-10 | Monty Radar polls cross-team memory files hourly for new entries -- alerts user via ntfy/Slack with which orchestrator is being notified and a summary of the update, AND triggers the receiving team's orchestrator to read and acknowledge | Radar health endpoint exists at `/api/health/radar`. Must be extended to parse cross-team memory files, detect new entries, and return them in the API response. Monty Radar (remote agent) handles the alerting and acknowledgment triggering. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js fs/promises | built-in | Read/append memory files | Already used in memory.ts |
| Next.js route handler | 16 | Extend /api/health/radar | Existing pattern |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| appendToGlobalMemory | existing | Monty->Nova writes | Already in memory.ts |
| appendToMontyMemory | existing | Nova->Monty writes | Already in memory.ts, currently only used by Monty agents |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| File-based cross-team memory | Database table for notifications | Over-engineered -- memory files are the established pattern, no new infrastructure needed |
| Webhook-based notifications | Polling via radar endpoint | Webhook adds infra complexity. Hourly polling is sufficient given Monty Radar already runs hourly. |

**Installation:**
No new packages required. Zero dependencies added.

## Architecture Patterns

### Current Cross-Team Write Pattern (Monty -> Nova)

All three Monty agents already have this in their onComplete hooks:

```typescript
// monty-dev.ts (line ~271)
if (output?.affectsNova && output?.novaNotification) {
  await appendToGlobalMemory(`[Monty Dev] ${output.novaNotification}`);
}

// monty-qa.ts (line ~249)
if (output?.affectsNova && output?.novaNotification) {
  await appendToGlobalMemory(`[Monty QA] ${output.novaNotification}`);
}

// monty-security.ts (line ~318)
if (output?.affectsNova && output?.novaNotification) {
  await appendToGlobalMemory(`[Monty Security] ${output.novaNotification}`);
}
```

### Structured Prefix Format (New)

The current `[Monty Dev]` prefix identifies the source agent but not the change type. Success Criteria 1 requires structured prefixes with both source agent AND change type.

**Recommended format:**
```
[CROSS-TEAM] [Source: monty-dev] [Type: schema-change] Description here
[CROSS-TEAM] [Source: monty-qa] [Type: qa-finding] Description here
[CROSS-TEAM] [Source: monty-security] [Type: security-advisory] Description here
[CROSS-TEAM] [Source: nova-orchestrator] [Type: platform-issue] Workspace: rise -- Description here
```

The `[CROSS-TEAM]` prefix makes entries machine-parseable and distinguishable from existing entries (nova-intel insights use `[Vertical: ...]` prefix). This is critical for radar polling to detect new cross-team entries vs general insights.

**Change types for Monty->Nova:**
- `schema-change` -- Prisma schema modification affecting agent tools
- `api-change` -- API endpoint added/modified/removed
- `tool-change` -- CLI tool or agent tool modified
- `config-change` -- Environment, deploy config, or infrastructure change
- `qa-finding` -- QA finding that affects Nova agent behaviour
- `security-advisory` -- Security finding that affects Nova agents

**Change types for Nova->Monty:**
- `platform-issue` -- Platform problem discovered during campaign operations
- `api-error` -- API endpoint returning errors during agent use
- `data-issue` -- Data integrity problem found in DB
- `performance-issue` -- Slow queries, timeouts, or degraded performance

### Nova -> Monty Direction (New)

Nova agents currently have NO writes to `.monty/memory/incidents.md`. This needs to be added to relevant Nova agent onComplete hooks. The most logical agents to add this to:

1. **Nova Orchestrator** (`src/lib/agents/orchestrator.ts`) -- when delegation fails due to platform issues
2. **Deliverability agent** -- when domain health checks reveal infrastructure problems
3. **Intelligence agent** -- when metrics queries fail or return inconsistent data

Each Nova agent output type needs an `affectsMonty` boolean and `montyNotification` string field, mirroring the existing Monty pattern.

### Radar Health Endpoint Extension

`/api/health/radar` (route.ts) currently returns workspace health, blacklist status, and credit balances. It needs a new section:

```typescript
// New section in GET handler
const crossTeamUpdates = await parseCrossTeamEntries();

return NextResponse.json({
  timestamp: new Date().toISOString(),
  workspaces: workspaceResults,
  blacklistCheck,
  credits: { ... },
  crossTeam: crossTeamUpdates,  // NEW
});
```

The `parseCrossTeamEntries` function reads both memory files, filters for `[CROSS-TEAM]` prefix entries, and returns entries newer than the last poll timestamp.

**Last-poll tracking:** Store last poll timestamp in a simple file (`.monty/memory/.last-cross-team-poll`) or return all entries and let the Monty Radar remote agent track what it has already seen. The file approach is simpler and keeps state server-side.

### Monty Radar Acknowledgment Flow

Success Criteria 4 requires that after alerting, Monty Radar triggers the receiving team's orchestrator to "read and acknowledge" the update. Since Monty Radar is a remote Claude Code agent (not code in this repo), this means:

1. Radar polls `/api/health/radar` and sees new cross-team entries
2. Radar sends ntfy/Slack alert with entry summary
3. Radar calls the appropriate orchestrator entry point:
   - For Monty->Nova entries: Radar tells the user "Nova needs to read these updates" (or could trigger `npx tsx scripts/chat.ts` with a prompt)
   - For Nova->Monty entries: Radar tells the user "Monty needs to triage these issues" (or could trigger `npx tsx scripts/monty.ts`)
4. The orchestrator reads the cross-team memory file on startup (via `loadMemoryContext()`) and acknowledges

**Practical approach:** The radar is a remote agent that runs non-interactively. It cannot start interactive chat sessions. The acknowledgment should be:
- Write a `.acknowledged` marker (timestamp) to prevent re-alerting
- Include the acknowledgment instruction in the ntfy/Slack alert ("Run `npx tsx scripts/chat.ts` to let Nova process these updates")
- Optionally: add an API endpoint that the radar can POST to, which queues an acknowledgment task

### Recommended Project Structure
```
src/
├── lib/agents/
│   ├── memory.ts            # Add parseCrossTeamEntries(), update appendToGlobalMemory format
│   ├── monty-dev.ts         # Update prefix format in onComplete
│   ├── monty-qa.ts          # Update prefix format in onComplete
│   ├── monty-security.ts    # Update prefix format in onComplete
│   └── orchestrator.ts      # Add Nova->Monty write in onComplete
├── app/api/health/radar/
│   └── route.ts             # Add crossTeam section to response
```

### Anti-Patterns to Avoid
- **Don't create a separate notification service:** Use existing memory file infrastructure. No new databases, no queues, no webhooks.
- **Don't make acknowledgment automatic:** The orchestrator should read and process the update, but a human should decide what action to take. The agent reads and surfaces the update, not auto-acts on it.
- **Don't modify global-insights.md write governance:** Currently the seed comment says "writer: nova-intel ONLY". Cross-team writes from Monty agents need to coexist. The `[CROSS-TEAM]` prefix distinguishes them from nova-intel entries.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Memory file append | Custom file writer | `appendToGlobalMemory()` / `appendToMontyMemory()` | Already handles validation, max lines, timestamps, error recovery |
| Parsing ISO timestamps | Custom date parser | `new Date(timestamp)` | ISO 8601 is natively parseable |
| HTTP health check | Custom fetch wrapper | Extend existing `/api/health/radar` | Already has auth, error handling, and is called by Monty Radar |

**Key insight:** Everything needed already exists in the codebase. This phase is about adding structured format conventions and extending existing functions, not building new infrastructure.

## Common Pitfalls

### Pitfall 1: Breaking Global Insights Write Governance
**What goes wrong:** The seed comment in global-insights.md says "writer: nova-intel ONLY". Adding Monty writes could confuse future agents about who can write.
**Why it happens:** Governance comments were written before cross-team writes were planned.
**How to avoid:** Update the seed comment to explicitly list both nova-intel and cross-team (Monty) writes. Use the `[CROSS-TEAM]` prefix to make the distinction clear.
**Warning signs:** Nova agents treating Monty cross-team entries as their own data.

### Pitfall 2: 200-Line Cap Exhaustion
**What goes wrong:** global-insights.md already has ~50 entries from nova-intel (all appended in one batch). Adding cross-team entries could hit the 200-line cap, blocking future writes.
**Why it happens:** The 200-line MAX_LINES cap in memory.ts is a hard limit.
**How to avoid:** Cross-team entries should be concise (one line each). Consider whether cross-team entries should have their own file instead of sharing global-insights.md. Alternatively, implement rotation (archive old entries).
**Warning signs:** `appendToGlobalMemory` returning false due to line cap.

### Pitfall 3: Monty Radar Cannot Start Interactive Sessions
**What goes wrong:** Success Criteria 4 says radar should "trigger the receiving team's orchestrator to read and acknowledge." The radar is a non-interactive remote agent -- it cannot start a REPL session.
**Why it happens:** Monty Radar runs as a scheduled Claude Code remote agent on Max plan. It can make API calls but cannot spawn interactive sessions.
**How to avoid:** Define "trigger" as: (a) send alert with instructions for user to run the orchestrator, and/or (b) call a lightweight API endpoint that marks the update as "pending acknowledgment" so the orchestrator picks it up on next interactive session.
**Warning signs:** Trying to implement `execSync("npx tsx scripts/chat.ts")` from the radar.

### Pitfall 4: Timestamp Comparison Drift
**What goes wrong:** Comparing timestamps between the radar's last-poll marker and entry timestamps may fail if the server clock and local clock differ.
**Why it happens:** The radar runs remotely (Claude Code Max plan), while memory files are written locally or on Vercel.
**How to avoid:** Use line-count comparison instead of timestamp comparison. Track "last seen line count" per file, and any new lines beyond that count are new entries. Alternatively, store the last-seen entry's exact timestamp string (not parsed) and do string comparison.
**Warning signs:** Missing entries or duplicate alerts.

## Code Examples

### Structured Prefix Write (Monty->Nova)
```typescript
// In monty-dev.ts onComplete hook (updated format)
if (output?.affectsNova && output?.novaNotification) {
  const changeType = output.changeType ?? "tool-change"; // default
  await appendToGlobalMemory(
    `[CROSS-TEAM] [Source: monty-dev] [Type: ${changeType}] ${output.novaNotification}`,
  );
}
```

### Nova->Monty Write (New)
```typescript
// In orchestrator.ts onComplete hook (new)
if (output?.affectsMonty && output?.montyNotification) {
  const slug = options?.workspaceSlug ?? "global";
  await appendToMontyMemory(
    "incidents.md",
    `[CROSS-TEAM] [Source: nova-orchestrator] [Type: platform-issue] [Workspace: ${slug}] ${output.montyNotification}`,
  );
}
```

### Cross-Team Entry Parser (for radar endpoint)
```typescript
interface CrossTeamEntry {
  timestamp: string;
  source: string;      // "monty-dev" | "monty-qa" | "monty-security" | "nova-orchestrator"
  type: string;        // "schema-change" | "platform-issue" etc.
  workspace?: string;  // only for Nova->Monty entries
  message: string;
  direction: "monty-to-nova" | "nova-to-monty";
}

function parseCrossTeamEntries(content: string): CrossTeamEntry[] {
  const lines = content.split("\n");
  const entries: CrossTeamEntry[] = [];
  
  for (const line of lines) {
    const match = line.match(
      /^\[(.+?)\]\s+\[CROSS-TEAM\]\s+\[Source:\s*(.+?)\]\s+\[Type:\s*(.+?)\](?:\s+\[Workspace:\s*(.+?)\])?\s+(.+)$/
    );
    if (match) {
      entries.push({
        timestamp: match[1],
        source: match[2],
        type: match[3],
        workspace: match[4] ?? undefined,
        message: match[5],
        direction: match[2].startsWith("monty") ? "monty-to-nova" : "nova-to-monty",
      });
    }
  }
  return entries;
}
```

### Radar Response Extension
```typescript
// In /api/health/radar/route.ts
const crossTeamUpdates = await getCrossTeamUpdates();

// Return in response
crossTeam: {
  montyToNova: crossTeamUpdates.filter(e => e.direction === "monty-to-nova"),
  novaToMonty: crossTeamUpdates.filter(e => e.direction === "nova-to-monty"),
  lastPollTimestamp: lastPollTs,
  newEntriesSinceLastPoll: newEntries.length,
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No cross-team writes | Monty agents write to global-insights.md (unstructured) | Phase 64-66 (2026-04-04) | Foundation exists but lacks machine-parseable format |
| No Nova->Monty direction | (Not yet implemented) | Phase 67 | Closes the loop -- Nova can report platform issues to Monty |
| Radar monitors health only | (To be extended) | Phase 67 | Radar becomes cross-team communication hub |

## Open Questions

1. **Should cross-team entries go in a separate file instead of global-insights.md?**
   - What we know: global-insights.md already has ~50 lines of nova-intel data. The 200-line cap could become a constraint. The seed comment says "writer: nova-intel ONLY."
   - What's unclear: Whether mixing cross-team and analytics entries causes confusion for agents reading the file.
   - Recommendation: Add a new `.nova/memory/cross-team-updates.md` file for Monty->Nova direction. This keeps concerns separated and avoids the governance conflict. The existing `[Monty Dev/QA/Security]` writes in global-insights.md can be migrated.

2. **How does the Monty Radar "trigger" orchestrator acknowledgment?**
   - What we know: Monty Radar is a remote agent that calls an API endpoint. It cannot start interactive sessions.
   - What's unclear: Whether "trigger" means a human action prompt or an automated API call.
   - Recommendation: Two-part approach: (a) send ntfy/Slack alert with human-readable instructions, (b) write a `.pending-ack` marker file that the orchestrator checks on next interactive startup and processes pending cross-team updates.

3. **Do ALL Nova agents need Nova->Monty write capability, or just the orchestrator?**
   - What we know: The orchestrator is the entry point for all Nova work. Individual agents (writer, leads, research) are unlikely to discover platform issues directly.
   - What's unclear: Whether specialist agents should report issues independently.
   - Recommendation: Start with orchestrator only. If specialist agents need it later, the pattern is trivial to replicate.

## Sources

### Primary (HIGH confidence)
- `src/lib/agents/memory.ts` -- All memory read/write functions, established patterns
- `src/lib/agents/monty-dev.ts`, `monty-qa.ts`, `monty-security.ts` -- Existing cross-team write hooks
- `src/app/api/health/radar/route.ts` -- Current radar endpoint implementation
- `.planning/REQUIREMENTS.md` -- FOUND-09, FOUND-10 requirement text

### Secondary (MEDIUM confidence)
- `.planning/briefs/monty-credit-monitoring.md` -- Confirms Monty Radar is a remote agent calling `/api/health/radar`
- `.planning/research/FEATURES.md` -- Confirms "Monty Radar alerts via ntfy/Slack. Monty agents handle the fix after human triage."
- MEMORY.md -- Monty Radar config (ntfy topic: `outsignal-monty-jjay`, trigger ID, hourly schedule)

### Tertiary (LOW confidence)
- None. All findings are from primary codebase sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries, all existing patterns
- Architecture: HIGH - Extends existing memory.ts and radar endpoint with well-understood patterns
- Pitfalls: HIGH - All identified from direct codebase analysis (200-line cap, governance comments, remote agent constraints)

**Research date:** 2026-04-04
**Valid until:** Indefinite - no external dependencies that could change
