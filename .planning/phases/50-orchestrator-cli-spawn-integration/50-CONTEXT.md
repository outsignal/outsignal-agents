# Phase 50: Orchestrator CLI Spawn Integration - Context

**Gathered:** 2026-03-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Build cli-spawn.ts utility to run `node dist/cli/*.js` scripts as subprocesses. Wire it into API agent tool functions behind a `USE_CLI_AGENTS` feature flag so dashboard chat (if ever used) shares the same tool implementations as CLI skills. Preserve API fallback. No dashboard UX changes.

</domain>

<decisions>
## Implementation Decisions

### Execution model
- **Dashboard keeps API agents** — `generateText()` with Anthropic API remains the dashboard execution engine. CLI skills in VS Code terminal are the primary (free) path. The user does not use dashboard chat.
- **The "bridge" is a shared tool layer** — API agent tool functions optionally call `cli-spawn.ts` to run the same `dist/cli/*.js` scripts that CLI skills use. Same data, same behavior, both paths.
- **No Trigger.dev task queue or Railway worker** — the original STATE.md blocker about task queue patterns is resolved by keeping API agents server-side. cli-spawn.ts runs synchronously within Vercel serverless tool calls.

### Feature flag
- **Single boolean `USE_CLI_AGENTS`** — one env var, not per-agent granularity. Default `false` (existing inline behavior unchanged)
- **Checked at tool level** — each tool function checks `process.env.USE_CLI_AGENTS === 'true'` and either runs inline or calls `cliSpawn('script-name.js', args)`. No orchestrator-level changes needed.
- **No dashboard UX changes** — streaming behavior unchanged. No CLI indicator badges or mode switching in the chat UI.

### cli-spawn.ts behavior
- **Subprocess creation** — `child_process.spawn('node', ['dist/cli/script.js', ...args])` with stdout/stderr buffering
- **300s timeout** — matches existing chat API route timeout
- **JSON envelope parsing** — expects `{ ok: true, data: {...} }` or `{ ok: false, error: "..." }` from scripts
- **Error handling: throw with parsed error** — on non-zero exit, parse the JSON envelope and throw the error message. On timeout, throw `'CLI script timed out after 300s'`. Agent tool call fails naturally.
- **Location** — `src/lib/agents/cli-spawn.ts` alongside runner.ts and types.ts

### Audit trail
- **No changes to AgentRun schema** — tool layer swap is transparent to audit. Whether a tool runs inline or via cli-spawn doesn't change the agent-level AgentRun record. Tool call steps are already logged in the `steps` JSON field.

### Claude's Discretion
- Exact cli-spawn.ts implementation (spawn vs execFile, buffer size limits)
- Which tool functions get the USE_CLI_AGENTS conditional first (prioritize by coverage)
- Whether to add a small utility wrapper for the flag check pattern
- stdout/stderr handling strategy (combine or separate)

</decisions>

<specifics>
## Specific Ideas

- The user explicitly said they won't use dashboard chat — this is purely a backup path
- Keep it lightweight. The real product is the terminal CLI skills.
- cli-spawn.ts is a thin wrapper — most complexity lives in the CLI scripts themselves (already built in Phase 48)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 50-orchestrator-cli-spawn-integration*
*Context gathered: 2026-03-24*
