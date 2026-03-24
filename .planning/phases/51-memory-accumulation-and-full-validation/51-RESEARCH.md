# Phase 51: Memory Accumulation and Full Validation — Research

**Researched:** 2026-03-24
**Domain:** End-to-end validation of Nova CLI agent system (Phases 46-50)
**Confidence:** HIGH — all findings based on direct file system inspection of the built system

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Test target and scenarios**
- Primary test workspace: Rise — most mature client, has campaigns, reply data, full ICP.
- Test approach: individual agents first, then full pipeline — test `/nova-writer rise`, `/nova-leads rise`, `/nova-intelligence rise` etc. in isolation first, then run the full orchestrator pipeline via `/nova rise`.
- Pipeline test request: "Create a full campaign for Rise targeting UK marketing directors" — tests complete pipeline including lead discovery and campaign creation. Will create real DB records.
- No cleanup after testing — draft campaigns and discovered leads are harmless. Nothing gets published or sent.

**Dashboard chat validation (simplified)**
- VAL-02: smoke test only — set `USE_CLI_AGENTS=true` locally, send one request through the dashboard chat API, confirm it doesn't crash. No quality comparison against API path. User does not use dashboard chat.
- VAL-05: smoke test only — set `USE_CLI_AGENTS=false`, send one request, confirm API path works without errors. The inline code paths are unchanged from pre-v7.0.

**Memory accumulation proof**
- Manual inspection — run 2 sessions with `/nova-writer rise` and `/nova-intelligence rise`. Then cat the memory files and check for new ISO-timestamped entries. No automated diff scripts.
- Test agents: writer + intelligence — writer produces copy wins/preferences (writes to campaigns.md, feedback.md). Intelligence produces analytics patterns (writes to learnings.md, global-insights.md). Both have clear write targets.
- Not all 7 agents — onboarding and deliverability may not produce writeable insights in a test scenario.

**Context overflow check**
- Token count estimation — cat all Rise memory files + global-insights.md and estimate token count. Document a ceiling budget ("memory should stay under X tokens total per workspace"). No need to run a full session to prove current state doesn't overflow.
- The real overflow risk is future accumulation — documenting the budget ceiling is more useful than proving today's small files fit.

**Validation format**
- One-time manual validation — run the tests once, document results in VERIFICATION.md (pass/fail per criterion). No repeatable test scripts. This is a milestone validation, not a regression suite.

### Claude's Discretion
- Order of individual agent tests
- Exact dashboard chat API requests for smoke tests
- Token counting method (wc -c estimate vs tokenizer)
- How to structure the validation report

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VAL-01 | End-to-end campaign generation session tested via CLI (research → leads → writer → campaign) | `/nova rise` orchestrator exists and routes all 4 agents in sequence; cli scripts verified working |
| VAL-02 | Dashboard chat verified working with CLI delegation enabled | `POST /api/chat` route exists; `USE_CLI_AGENTS` env var gates `isCliMode()` in utils.ts; smoke test only |
| VAL-03 | API fallback verified working with `USE_CLI_AGENTS=false` | Same route, same tools; inline API agents (runWriterAgent etc.) untouched since Phase 50 |
| VAL-04 | Memory accumulation verified — run 2+ sessions and confirm memory files grow with relevant intelligence | All 4 Rise files exist and are writable; append governance wired into skill files + rules files |
| VAL-05 | No context overflow during full orchestrated session with memory loaded | Current Rise memory: 4825 bytes (~1200 tokens); token budget ceiling must be documented |
</phase_requirements>

---

## Summary

Phase 51 is a pure validation milestone. The Nova CLI agent system was built across Phases 46-50 — all 36 v7.0 requirements (SEC, MEM, CLI, SKL, BRG) are marked complete in REQUIREMENTS.md. This phase runs actual sessions against the Rise workspace, inspects results, and documents pass/fail for each of the 5 VAL requirements. No new code is written unless a bug is discovered.

The system is fully in place: 8 specialist skill files live in `.claude/commands/`, 55 compiled CLI scripts exist in `dist/cli/`, Rise memory files are seeded across 4 documents (total 4,825 bytes / ~1,200 tokens at seed time), and `cli-spawn.ts` bridges the dashboard chat API to CLI agent subprocesses controlled by the `USE_CLI_AGENTS` env var. Memory accumulation is governed by append-only rules embedded in every skill file and its companion `rules/*.md` file — agents write ISO-timestamped single-line entries after sessions that produce actionable insights.

The key validation tasks are: (1) run individual specialist agents via `/nova-writer rise` etc. to confirm they load memory and produce output, (2) run `/nova rise` with a full campaign request to validate the orchestrator chain, (3) inspect memory files after writer + intelligence sessions for new entries, (4) estimate token budget for current and projected file sizes, and (5) smoke-test `POST /api/chat` with both feature flag states.

**Primary recommendation:** Run tests in the order writer → intelligence → full pipeline, then do both dashboard smoke tests, then write VERIFICATION.md with the results table.

---

## Standard Stack

### Core (no installation needed — all built)

| Component | Location | Purpose | Status |
|-----------|----------|---------|--------|
| Nova skill files | `.claude/commands/nova*.md` | CLI agent invocation targets | 8 files confirmed present |
| Agent rules | `.claude/rules/*.md` | Behavioral rules loaded via `@` syntax | 6 files confirmed present |
| CLI wrapper scripts | `scripts/cli/*.ts` → `dist/cli/*.js` | Compiled tool scripts for agents | 55 scripts in dist/cli/ |
| Memory files (Rise) | `.nova/memory/rise/*.md` | Per-workspace persistent memory | 4 files, 4,825 bytes total |
| Global insights | `.nova/memory/global-insights.md` | Cross-client intelligence | 1,626 bytes, 42 lines |
| cli-spawn.ts | `src/lib/agents/cli-spawn.ts` | Dashboard-to-CLI subprocess bridge | Confirmed present and wired |
| Chat API route | `src/app/api/chat/route.ts` | Dashboard chat endpoint | maxDuration=300, feature-flagged |
| USE_CLI_AGENTS | `.env` (local) / Vercel env vars | Feature flag for CLI delegation | Not set in .env → defaults false |

### Key Supporting Facts

- `dist/cli/workspace-intelligence.js rise` — verified working, returns full ICP + case studies
- `dist/cli/cached-metrics.js rise` — verified working, returns 5 campaigns with reply/open/bounce data
- `isCliMode()` in `utils.ts` reads `process.env.USE_CLI_AGENTS === "true"` — local toggle via `.env`
- Chat route: `POST /api/chat` with body `{ messages: [{role, content}], context: {workspaceSlug} }` — no authentication bypass needed locally (uses `requireAdminAuth`)

---

## Architecture Patterns

### How CLI Skills Are Invoked

CLI skills are Claude Code slash commands under `.claude/commands/`. They are invoked in a Claude Code session as:

```
/nova-writer rise
/nova-intelligence rise
/nova rise
```

The `$ARGUMENTS[0]` token in the skill file captures the slug (`rise`). The `!` syntax at the top of each skill file executes a shell command at invocation time to inject the memory files into the conversation context:

```bash
# nova-writer.md line 13:
! `cat .nova/memory/$ARGUMENTS[0]/profile.md .nova/memory/$ARGUMENTS[0]/campaigns.md .nova/memory/$ARGUMENTS[0]/feedback.md .nova/memory/$ARGUMENTS[0]/learnings.md 2>/dev/null || echo "(No memory files found — workspace may not be seeded)"`
```

The nova-intelligence skill additionally injects `global-insights.md`:

```bash
! `cat .nova/memory/$ARGUMENTS[0]/profile.md ... .nova/memory/global-insights.md 2>/dev/null`
```

The nova.md orchestrator loads only `profile.md + campaigns.md` (not feedback/learnings) — specialist-level context stays with specialists.

### Memory Append Format

All agents are instructed to append in this exact format after sessions that produce actionable insights:

```
[2026-03-24T15:30:00Z] — Rise: 'merch volume' angle underperforms vs 'branded kits' — 1.1% vs 3.4% reply rate
```

The governance rules are embedded in both the skill file's "Memory Write-Back" section and the companion `rules/*.md` file. Agents only append if the insight is actionable for future sessions.

### Memory Write Targets by Agent

| Agent | May Write To | Must NOT Write To |
|-------|-------------|-------------------|
| nova-writer | campaigns.md, feedback.md, learnings.md | profile.md |
| nova-intelligence | learnings.md, global-insights.md | profile.md, campaigns.md, feedback.md |
| nova-research | learnings.md | profile.md, campaigns.md, feedback.md |
| nova-leads | learnings.md, feedback.md | profile.md, campaigns.md |
| nova-campaign | campaigns.md, feedback.md, learnings.md | profile.md |
| nova-deliverability | learnings.md | profile.md, campaigns.md, feedback.md |
| nova-onboarding | learnings.md, feedback.md | profile.md, campaigns.md |

### Dashboard Chat Smoke Test Pattern

To smoke-test `POST /api/chat` locally, the request needs a valid session. The route uses `requireAdminAuth` which reads from the session cookie. The cleanest approach for a smoke test is:

1. Start the dev server: `npm run dev`
2. Log in to the dashboard in a browser to get a session cookie
3. Use `curl` with the session cookie, or use the built-in chat UI in the dashboard

Alternatively, for a more direct test: set `USE_CLI_AGENTS=true` in `.env`, restart dev server, open the dashboard chat, type a simple orchestrator request like "list campaigns for rise", and confirm a response returns without a 500 error.

### Token Budget Analysis

**Current state (seeded, no accumulated learnings):**

| File | Size (bytes) | Estimated tokens (÷4) |
|------|-------------|----------------------|
| profile.md | 2,354 | ~589 |
| campaigns.md | 957 | ~239 |
| feedback.md | 601 | ~150 |
| learnings.md | 913 | ~228 |
| global-insights.md | 1,626 | ~407 |
| **Total (Rise + global)** | **6,451** | **~1,613 tokens** |

**Projected mature state (after 6 months of sessions):**

Assuming each file grows to ~5,000 tokens at maturity (200-line max × ~25 chars/line = 5,000 chars ÷ 4 = ~1,250 tokens):

| Scenario | Tokens |
|----------|--------|
| Today (seed state) | ~1,600 tokens |
| Mature (200-line cap hit on all 4 files) | ~5,000 tokens |
| Mature + global-insights | ~6,250 tokens |
| Skill file content (nova-writer.md + writer-rules.md) | ~5,250 tokens |
| Total context budget (skill + memory, mature) | ~11,500 tokens |

**Ceiling recommendation:** Memory for any single workspace (4 files) should stay under 10,000 tokens (40,000 chars). The 200-line max per file enforced by governance headers provides a natural cap at ~5,000 tokens per workspace. This is well within Claude's 200K context window — overflow is not a risk even at maturity.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token counting | Custom tokenizer | `wc -c` byte count ÷ 4 estimate | Sufficient for budget estimation; exact token count not needed |
| Memory diff verification | Automated diff script | `cat` before/after + visual inspection | CONTEXT.md locked: manual inspection, no scripts |
| Dashboard auth bypass | Mock auth layer | Open dashboard in browser + use UI | requireAdminAuth reads real session; don't circumvent |
| Repeatable test suite | Jest/pytest fixtures | One-time manual validation + VERIFICATION.md | CONTEXT.md locked: milestone validation, not regression suite |

---

## Common Pitfalls

### Pitfall 1: CLI Script Argument Format
**What goes wrong:** Running `node dist/cli/workspace-intelligence.js --slug rise` returns `{"ok":true,"data":{"error":"Workspace '--slug' not found"}}` — the script treats `--slug` as the slug value.
**Why it happens:** The CLI harness `_cli-harness.ts` reads `process.argv[2]` as a positional slug, not a `--flag` argument.
**How to avoid:** Always pass the slug as a bare positional argument: `node dist/cli/workspace-intelligence.js rise` (confirmed working during research).
**Warning signs:** `data.error: "Workspace '--slug' not found"` in the JSON output.

### Pitfall 2: Working Directory for dist/cli
**What goes wrong:** Calling `node dist/cli/workspace-get.js` from a directory other than the project root fails because the harness uses `process.env.PROJECT_ROOT ?? process.cwd()` to resolve paths.
**Why it happens:** `cli-spawn.ts` and the harness assume the project root is the cwd.
**How to avoid:** Always run CLI scripts from `/Users/jjay/programs/outsignal-agents`.
**Warning signs:** `ENOENT` errors or database connection failures.

### Pitfall 3: USE_CLI_AGENTS Not Set
**What goes wrong:** Dashboard chat smoke test with "CLI mode" behaves as API mode because the env var is absent from `.env`.
**Why it happens:** `USE_CLI_AGENTS` is not present in `.env` by default — it must be added manually for the CLI delegation test.
**How to avoid:** Set `USE_CLI_AGENTS=true` in `.env`, restart dev server, verify `isCliMode()` returns true before testing.
**Warning signs:** Delegation tools call `runWriterAgent` etc. instead of `cliSpawn` — can be confirmed by watching server logs.

### Pitfall 4: Memory Write Not Triggering
**What goes wrong:** Writer or intelligence session completes but no new entries appear in memory files.
**Why it happens:** Agents only write back if the session produces an **actionable insight**. A test session that asks "write a sequence" may not surface a clear pattern worth recording.
**How to avoid:** Frame writer test as a copy generation + feedback loop ("generate a sequence, then tell me what you observed about Rise's copy preferences"). Frame intelligence test as "analyze Rise's campaign performance and identify patterns."
**Warning signs:** Memory files have same byte count after session as before.

### Pitfall 5: Campaign Creation in Pipeline Test
**What goes wrong:** Full pipeline test ("Create a full campaign for Rise targeting UK marketing directors") creates real DB records — workspace quota is consumed.
**Why it happens:** nova-campaign creates actual Campaign + TargetList entities in Postgres. Lead discovery also runs against real API credits.
**How to avoid:** This is expected and locked in CONTEXT.md — draft campaigns are harmless, nothing is published or sent. Document which records were created in the validation report.
**Warning signs:** None — this is intended behavior. Just note quota impact.

### Pitfall 6: Dashboard Auth for Smoke Test
**What goes wrong:** `curl -X POST /api/chat` without a session cookie returns 401 Unauthorized.
**Why it happens:** `requireAdminAuth` checks the NextAuth session cookie — there is no API key bypass.
**How to avoid:** Use the dashboard browser UI for smoke tests, or use browser DevTools to copy the session cookie into a curl request. The simplest approach: just use the built-in chat UI with the dev server running.

---

## Code Examples

### Running an Individual Agent Test

```bash
# From project root: /Users/jjay/programs/outsignal-agents
# In a Claude Code session:
/nova-writer rise
# Then provide a task: "Generate a 3-step PVP email sequence for Rise targeting UK marketing directors at sports teams"
```

```bash
# Intelligence agent test:
/nova-intelligence rise
# Then: "Analyze Rise's campaign performance and surface any patterns worth recording"
```

### Verifying Memory Accumulation

```bash
# Before session — record byte counts
wc -c .nova/memory/rise/campaigns.md .nova/memory/rise/feedback.md .nova/memory/rise/learnings.md

# After session — compare
wc -c .nova/memory/rise/campaigns.md .nova/memory/rise/feedback.md .nova/memory/rise/learnings.md

# View new entries
tail -5 .nova/memory/rise/campaigns.md
tail -5 .nova/memory/rise/learnings.md
tail -5 .nova/memory/global-insights.md
```

### Verifying Token Budget

```bash
# Total bytes across all Rise memory files + global
cat .nova/memory/rise/profile.md .nova/memory/rise/campaigns.md \
    .nova/memory/rise/feedback.md .nova/memory/rise/learnings.md \
    .nova/memory/global-insights.md | wc -c

# Tokens: divide byte count by 4 for rough estimate
# Budget ceiling: stay under 40,000 bytes (10,000 tokens) per workspace
```

### Dashboard Chat Smoke Test (USE_CLI_AGENTS=true)

```bash
# 1. Add to .env:
echo "USE_CLI_AGENTS=true" >> .env

# 2. Restart dev server:
npm run dev

# 3. Use the dashboard chat UI at http://localhost:3000
# Send: "What workspaces do we have?"
# Expected: CLI-routed response via orchestrator, no 500 error
```

### Dashboard Chat Smoke Test (USE_CLI_AGENTS=false)

```bash
# 1. Ensure USE_CLI_AGENTS is false (default — remove from .env or set false):
# USE_CLI_AGENTS=false  (or unset)

# 2. Restart dev server and use dashboard chat UI
# Send: "What workspaces do we have?"
# Expected: API-routed response via inline agent, no 500 error
```

### Full Pipeline Test via Orchestrator

```bash
# In a Claude Code session:
/nova rise
# Request: "Create a full campaign for Rise targeting UK marketing directors"
# Expected chain: Research (if needed) → Leads (discovery plan) → Writer (sequence) → Campaign (entity created)
```

---

## Current System State Summary

All pre-validation facts confirmed by direct inspection:

| Component | Status | Evidence |
|-----------|--------|---------|
| `.claudeignore` | Present | `ls .claudeignore` confirmed |
| `sanitize-output.ts` | Present | `ls src/lib/sanitize-output.ts` confirmed |
| Nova skill files (8) | All present | `.claude/commands/nova*.md` confirmed |
| Rules files (6) | All present | `.claude/rules/*.md` confirmed |
| `dist/cli/` compiled scripts | 55 scripts | `ls dist/cli/ | wc -l` = 55 |
| Rise memory files (4) | Seeded, writable | `wc -c .nova/memory/rise/*.md` = 4,825 bytes |
| global-insights.md | Seeded | 1,626 bytes, 42 lines |
| All 8 workspace memory dirs | Present | `ls .nova/memory/` confirmed |
| `cli-spawn.ts` | Present + wired | `src/lib/agents/cli-spawn.ts` confirmed |
| `isCliMode()` in utils.ts | Reads `USE_CLI_AGENTS` | Confirmed in source |
| `orchestratorTools` use `isCliMode()` | 4 delegation tools | Phase 50 complete |
| `POST /api/chat` route | Present | `src/app/api/chat/route.ts` confirmed |
| `USE_CLI_AGENTS` in `.env` | Not set (defaults false) | grep confirmed absent |
| `workspace-intelligence.js rise` | Working | Returns full ICP data |
| `cached-metrics.js rise` | Working | Returns 5 campaigns |

---

## Open Questions

1. **Session authentication for smoke test**
   - What we know: `requireAdminAuth` requires a real NextAuth session cookie; no API key bypass exists
   - What's unclear: Whether the tester will use the browser UI or needs curl with a copied cookie
   - Recommendation: Use the dashboard browser UI (simplest, no auth workaround needed)

2. **Memory write-back trigger reliability**
   - What we know: Agents only write back if they identify an actionable insight; not every session produces a write
   - What's unclear: Whether a short test session will generate enough signal to trigger a write
   - Recommendation: Frame test sessions explicitly ("analyze and identify patterns worth recording") to increase write-back probability; if first session produces no write, run a second with richer context

3. **Nova CLI skill invocation environment**
   - What we know: Skills run in a Claude Code session, not in the app's Next.js process
   - What's unclear: Whether the planner intends the validation to be run by a Claude Code subagent or by the user directly in their Claude Code terminal
   - Recommendation: The planner should specify tasks as "the executor runs `/nova-writer rise` in a Claude Code session" — not as programmatic subagent calls from within the plan itself

---

## Sources

### Primary (HIGH confidence — direct file system inspection)
- `/Users/jjay/programs/outsignal-agents/.claude/commands/nova*.md` — 8 skill files confirmed present and inspected
- `/Users/jjay/programs/outsignal-agents/.claude/rules/*.md` — 6 rules files confirmed present and read
- `/Users/jjay/programs/outsignal-agents/dist/cli/` — 55 compiled scripts confirmed present
- `/Users/jjay/programs/outsignal-agents/.nova/memory/rise/*.md` — All 4 Rise memory files read
- `/Users/jjay/programs/outsignal-agents/.nova/memory/global-insights.md` — Read and measured
- `/Users/jjay/programs/outsignal-agents/src/lib/agents/cli-spawn.ts` — Full source read
- `/Users/jjay/programs/outsignal-agents/src/lib/agents/utils.ts` — isCliMode() implementation confirmed
- `/Users/jjay/programs/outsignal-agents/src/app/api/chat/route.ts` — Full source read
- `node dist/cli/workspace-intelligence.js rise` — Live test executed, confirmed working
- `node dist/cli/cached-metrics.js rise` — Live test executed, confirmed working

### Secondary (HIGH confidence — project documentation)
- `.planning/REQUIREMENTS.md` — VAL-01 through VAL-05 confirmed pending, all others complete
- `.planning/STATE.md` — Phase 50 confirmed complete; all blockers resolved
- `.planning/phases/51-memory-accumulation-and-full-validation/51-CONTEXT.md` — All locked decisions read

---

## Metadata

**Confidence breakdown:**
- Current system state: HIGH — direct file inspection and live CLI tests
- Validation approach: HIGH — locked in CONTEXT.md
- Token budget estimates: MEDIUM — byte count ÷ 4 is a rough approximation; actual tokenization varies by content
- Memory write-back probability: MEDIUM — depends on session framing; not guaranteed per session

**Research date:** 2026-03-24
**Valid until:** 2026-04-24 (stable system, no external dependencies to go stale)
