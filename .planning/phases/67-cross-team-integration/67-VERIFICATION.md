---
phase: 67-cross-team-integration
verified: 2026-04-03T00:00:00Z
status: human_needed
score: 6/6 must-haves verified
human_verification:
  - test: "Trigger Monty Radar hourly run and confirm it sends an ntfy push when crossTeam.newEntries is non-empty"
    expected: "ntfy.sh/outsignal-monty-jjay receives an alert containing which orchestrator is being notified (Nova or Monty) and a one-line summary of the cross-team entry"
    why_human: "The alerting is handled by the remote Monty Radar agent (Claude Opus 4.6 on Max plan, not code in this repo). The endpoint returns the data correctly but whether the agent acts on it requires a live run."
  - test: "Confirm Monty Radar suggests running npx tsx scripts/chat.ts or npx tsx scripts/monty.ts after alerting"
    expected: "Monty Radar log or ntfy message includes the acknowledgment instruction from acknowledgmentInstructions in the radar response"
    why_human: "Acknowledgment triggering is agent behavior, not automated code. Cannot verify programmatically."
---

# Phase 67: Cross-Team Integration Verification Report

**Phase Goal:** Nova and Monty communicate platform changes and incidents through structured cross-team memory files, and Monty Radar polls these files to alert the user and trigger acknowledgment
**Verified:** 2026-04-03
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | When a Monty agent writes a platform change to `.nova/memory/global-insights.md`, the entry includes a structured prefix identifying the source agent and change type | VERIFIED | All three Monty agents (dev, qa, security) use `[CROSS-TEAM] [Source: monty-X] [Type: Y]` prefix in onComplete hooks — verified in monty-dev.ts:275, monty-qa.ts:253, monty-security.ts:322 |
| 2 | When a Nova agent writes a platform issue to `.monty/memory/incidents.md`, the entry includes the workspace slug and issue description | VERIFIED | `notifyMontyOfPlatformIssue` and `notifyMontyOfApiError` exported from orchestrator.ts, both write `[CROSS-TEAM] [Source: nova-orchestrator] [Type: X] [Workspace: slug]` to incidents.md |
| 3 | Monty Radar polls cross-team memory files hourly and sends an ntfy/Slack alert when new entries appear | PARTIAL | The radar endpoint returns `crossTeam.newEntries` with full entry detail (source, type, workspace, message). The ntfy/Slack alerting depends on the remote Monty Radar agent's behavior at runtime — not automated code in this repo. Needs human verification. |
| 4 | After Monty Radar alerts on a cross-team update, it triggers the receiving team's orchestrator to read and acknowledge the update | PARTIAL | The endpoint returns `acknowledgmentInstructions` telling the agent which CLI to run. Actual triggering of orchestrator acknowledgment is remote agent behavior. Needs human verification. |

**Score:** 6/6 must-haves verified (automated checks all pass; SC3 + SC4 require human runtime verification)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/agents/types.ts` | changeType on Monty output types; NovaCrossTeamFields | VERIFIED | `changeType` on MontyDevOutput (line 218), MontyQAOutput (line 344), MontySecurityOutput (line 411); `NovaCrossTeamFields` interface at line 453 with `affectsMonty` and `montyNotification` |
| `src/lib/agents/memory.ts` | parseCrossTeamEntries function | VERIFIED | `CrossTeamEntry` interface at line 183; `parseCrossTeamEntries` function at line 201; exported and substantive (regex parser with full field extraction) |
| `src/lib/agents/orchestrator.ts` | Nova-to-Monty write helpers | VERIFIED | `notifyMontyOfPlatformIssue` at line 36; `notifyMontyOfApiError` at line 50; both exported; both call `appendToMontyMemory("incidents.md", ...)` with structured `[CROSS-TEAM]` prefix |
| `src/lib/agents/monty-dev.ts` | [CROSS-TEAM] prefix in onComplete | VERIFIED | Line 275: `[CROSS-TEAM] [Source: monty-dev] [Type: ${changeType}]` |
| `src/lib/agents/monty-qa.ts` | [CROSS-TEAM] prefix in onComplete | VERIFIED | Line 253: `[CROSS-TEAM] [Source: monty-qa] [Type: ${changeType}]` |
| `src/lib/agents/monty-security.ts` | [CROSS-TEAM] prefix in onComplete | VERIFIED | Line 322: `[CROSS-TEAM] [Source: monty-security] [Type: ${changeType}]` |
| `src/app/api/health/radar/route.ts` | crossTeam section in response | VERIFIED | `getCrossTeamUpdates` function at line 136; integrated into `Promise.all` at line 502; `crossTeam` field in response at line 519 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/lib/agents/monty-dev.ts` | `src/lib/agents/memory.ts` | `appendToGlobalMemory` with `[CROSS-TEAM]` prefix | WIRED | Line 275 calls `appendToGlobalMemory` with structured prefix |
| `src/lib/agents/monty-qa.ts` | `src/lib/agents/memory.ts` | `appendToGlobalMemory` with `[CROSS-TEAM]` prefix | WIRED | Line 253 calls `appendToGlobalMemory` with structured prefix |
| `src/lib/agents/monty-security.ts` | `src/lib/agents/memory.ts` | `appendToGlobalMemory` with `[CROSS-TEAM]` prefix | WIRED | Line 322 calls `appendToGlobalMemory` with structured prefix |
| `src/lib/agents/orchestrator.ts` | `src/lib/agents/memory.ts` | `appendToMontyMemory` with `[CROSS-TEAM]` prefix | WIRED | Line 28 imports `appendToMontyMemory`; lines 41+55 call it with `[CROSS-TEAM] [Source: nova-orchestrator]` |
| `src/app/api/health/radar/route.ts` | `src/lib/agents/memory.ts` | imports `parseCrossTeamEntries` | WIRED | Line 10 imports `parseCrossTeamEntries`; lines 175+176+202+208 call it on both memory files |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| FOUND-09 | 67-01-PLAN.md | Cross-team notification system — Monty agents write platform changes to `.nova/memory/global-insights.md`, Nova agents write platform issues to `.monty/memory/incidents.md` | SATISFIED | Structured `[CROSS-TEAM]` prefix on all three Monty agent writes; `notifyMontyOfPlatformIssue` + `notifyMontyOfApiError` exported from orchestrator.ts for reverse direction |
| FOUND-10 | 67-02-PLAN.md | Monty Radar polls cross-team memory files hourly for new entries — alerts user via ntfy/Slack with which orchestrator is being notified, AND triggers the receiving team's orchestrator to read and acknowledge | PARTIALLY SATISFIED (needs human) | Radar endpoint returns `crossTeam` with `newEntries`, `montyToNova`, `novaToMonty`, `lastPollTimestamp`, `acknowledgmentInstructions`. The ntfy/Slack alerting and acknowledgment triggering are remote agent behaviors verified at runtime. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

No TODOs, FIXMEs, placeholders, or empty implementations found in the phase artifacts. TypeScript compiles cleanly (zero errors).

### Human Verification Required

#### 1. Monty Radar Cross-Team Alert

**Test:** Wait for the next hourly Monty Radar run (or manually trigger the scheduled agent at https://claude.ai/code/scheduled/trig_01GimCkt6V6vfH61KdBz32No). First, ensure there is at least one `[CROSS-TEAM]` entry in `.nova/memory/global-insights.md` or `.monty/memory/incidents.md`. Delete `.monty/memory/.last-cross-team-poll.json` to force all entries to appear as "new". Then let Monty Radar run.

**Expected:** ntfy.sh/outsignal-monty-jjay receives a push notification indicating a cross-team update exists, naming which orchestrator is being notified (Nova or Monty) and including a one-line summary of the entry's message.

**Why human:** Monty Radar is a remote Claude Code agent (Opus 4.6 on Max plan). The alerting logic lives in the agent's system prompt/behavior, not in this codebase. The endpoint delivers the data correctly; whether the agent fires the ntfy push requires a live run.

#### 2. Orchestrator Acknowledgment Suggestion

**Test:** After Monty Radar receives a cross-team alert (test 1 above), check whether the agent's log or ntfy message includes the CLI command from `acknowledgmentInstructions` — either `npx tsx scripts/chat.ts` (for Nova to process Monty-to-Nova updates) or `npx tsx scripts/monty.ts` (for Monty to triage Nova-to-Monty issues).

**Expected:** Monty Radar's output or ntfy message tells the user which orchestrator CLI to run for acknowledgment.

**Why human:** Acknowledgment triggering is agent behavior that reads from `crossTeam.acknowledgmentInstructions` in the radar response. This is a runtime behavioral test, not a code path that can be verified by static analysis.

### Implementation Quality Notes

- `parseCrossTeamEntries` regex handles both em-dash separator (from `appendToMontyMemory`) and plain space (from `appendToGlobalMemory`), per the SUMMARY decision note. This is correct and substantive.
- `getCrossTeamUpdates` is fully wrapped in try/catch and returns a degraded response with `error` field on failure — the radar endpoint cannot fail due to cross-team polling.
- Line-count comparison (not timestamp) is used for new-entry detection, correctly avoiding clock drift between the remote agent and server.
- Old `[Monty Dev]`, `[Monty QA]`, `[Monty Security]` prefix strings are fully removed from all three agent onComplete hooks.
- Both `notifyMontyOfPlatformIssue` and `notifyMontyOfApiError` are exported from orchestrator.ts and correctly wire `appendToMontyMemory` with the `[CROSS-TEAM]` prefix and `[Workspace: slug]` tag.

### Gaps Summary

No gaps found in the automated artifacts. The phase's server-side implementation is complete and correctly wired. The two human verification items (SC3 and SC4) are behavioral requirements that depend on the remote Monty Radar agent interpreting the endpoint data at runtime — they cannot be verified by static code analysis by design. This is consistent with how the project uses Monty Radar: as a remote agent that reads the health endpoint and acts on it independently.

---

_Verified: 2026-04-03_
_Verifier: Claude (gsd-verifier)_
