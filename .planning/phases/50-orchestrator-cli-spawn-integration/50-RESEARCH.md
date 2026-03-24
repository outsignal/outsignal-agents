# Phase 50: Orchestrator CLI Spawn Integration - Research

**Researched:** 2026-03-24
**Domain:** Node.js child_process spawn, API agent tool layer, feature-flagged delegation bridge
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Execution model**
- Dashboard keeps API agents — `generateText()` with Anthropic API remains the dashboard execution engine. CLI skills in VS Code terminal are the primary (free) path. The user does not use dashboard chat.
- The "bridge" is a shared tool layer — API agent tool functions optionally call `cli-spawn.ts` to run the same `dist/cli/*.js` scripts that CLI skills use. Same data, same behavior, both paths.
- No Trigger.dev task queue or Railway worker — the original STATE.md blocker about task queue patterns is resolved by keeping API agents server-side. cli-spawn.ts runs synchronously within Vercel serverless tool calls.

**Feature flag**
- Single boolean `USE_CLI_AGENTS` — one env var, not per-agent granularity. Default `false` (existing inline behavior unchanged)
- Checked at tool level — each tool function checks `process.env.USE_CLI_AGENTS === 'true'` and either runs inline or calls `cliSpawn('script-name.js', args)`. No orchestrator-level changes needed.
- No dashboard UX changes — streaming behavior unchanged. No CLI indicator badges or mode switching in the chat UI.

**cli-spawn.ts behavior**
- Subprocess creation — `child_process.spawn('node', ['dist/cli/script.js', ...args])` with stdout/stderr buffering
- 300s timeout — matches existing chat API route timeout
- JSON envelope parsing — expects `{ ok: true, data: {...} }` or `{ ok: false, error: "..." }` from scripts
- Error handling: throw with parsed error — on non-zero exit, parse the JSON envelope and throw the error message. On timeout, throw `'CLI script timed out after 300s'`.
- Location — `src/lib/agents/cli-spawn.ts` alongside runner.ts and types.ts

**Audit trail**
- No changes to AgentRun schema — tool layer swap is transparent to audit. Whether a tool runs inline or via cli-spawn doesn't change the agent-level AgentRun record. Tool call steps are already logged in the `steps` JSON field.

### Claude's Discretion
- Exact cli-spawn.ts implementation (spawn vs execFile, buffer size limits)
- Which tool functions get the USE_CLI_AGENTS conditional first (prioritize by coverage)
- Whether to add a small utility wrapper for the flag check pattern
- stdout/stderr handling strategy (combine or separate)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BRG-01 | Dashboard chat delegates to CLI agents for writer and orchestrator paths | Orchestrator `delegateToWriter` tool execute function is the primary injection point; same pattern applies to `delegateToResearch`, `delegateToCampaign`, `delegateToLeads` |
| BRG-02 | API agent fallback preserved and verified working when `USE_CLI_AGENTS=false` | Flag defaults to `false`; existing inline code paths unchanged; all tool `execute` functions wrap in `if (USE_CLI_AGENTS) { cliSpawn(...) } else { existing code }` |
| BRG-03 | Dashboard bridge extended to all 7 specialist agents | 4 delegation tools in orchestrator.ts (`delegateToResearch`, `delegateToLeads`, `delegateToWriter`, `delegateToCampaign`) map to 7 specialist agents via their own internal routing; each tool's execute gets the flag conditional |
| BRG-04 | `cli-spawn.ts` utility handles subprocess creation, 300s timeout, stdout buffering, error translation | Core Node.js `child_process.spawn` API with AbortController timeout; JSON envelope parsing from harness output |
| BRG-05 | AgentRun audit logging preserved for CLI-invoked agent sessions | No changes to `runAgent()` or AgentRun schema; tool-level swap is invisible to audit — AgentRun still records the orchestrator's tool call steps |
</phase_requirements>

## Summary

Phase 50 is a minimal bridge layer: `cli-spawn.ts` (a thin subprocess utility) plus `USE_CLI_AGENTS` conditionals inserted into the `execute` functions of the 4 orchestrator delegation tools. The flag check pattern is identical across all tools — check env var, if true call `cliSpawn('script-name.js', args)` and return the parsed result, otherwise execute the existing inline logic. No orchestrator-level changes, no schema changes, no UX changes.

The codebase already has everything needed: `dist/cli/` with 38 compiled scripts, a `runWithHarness` pattern that outputs `{ ok: true, data }` or `{ ok: false, error }` JSON envelopes, and 4 delegation tools in `orchestrator.ts` whose `execute` functions call `runWriterAgent`, `runResearchAgent`, `runLeadsAgent`, and `runCampaignAgent`. The bridge simply redirects those execution paths when the flag is set. The underlying CLI scripts already exist from Phase 48 and are already tested independently.

The `cli-spawn.ts` utility should use `child_process.spawn` (not `execFile`) because stdout streaming allows incremental buffer collection as the subprocess runs (important for 300s timeout scenarios). Node.js built-in `AbortController` + `signal` option handles timeout cleanly without an external dependency.

**Primary recommendation:** Build `cli-spawn.ts` first, then instrument tool execute functions one agent at a time starting with writer (highest value) through research, campaign, and leads. Each tool is self-contained so parallelization is possible after `cli-spawn.ts` is proven.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `child_process` (Node.js built-in) | Node 18+ | Subprocess creation and output buffering | Zero dependency; already used in the project ecosystem |
| `AbortController` (Node.js built-in) | Node 18+ | Timeout signaling for spawn | Native, clean cancellation without setTimeout race conditions |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| TypeScript (project standard) | ~5.x | Type safety for envelope parsing and function signatures | Always — all new files in src/ are TypeScript |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `child_process.spawn` | `child_process.execFile` | `execFile` buffers all output before resolving — simpler but can OOM on large outputs; `spawn` enables streaming. For 300s long-running scripts, `spawn` with incremental buffer append is safer. |
| `AbortController` + signal | `setTimeout` + `child.kill()` | `setTimeout` + kill works but AbortController gives cleaner `AbortError` detection in the promise chain. |
| JSON envelope parse | Stream parse | All CLI scripts write exactly one JSON envelope at the end of stdout. Single `JSON.parse(stdout)` is correct and simple. |

**Installation:** No new packages required. Uses Node.js built-ins only.

## Architecture Patterns

### Recommended Project Structure
```
src/lib/agents/
├── cli-spawn.ts      # NEW — subprocess utility (this phase)
├── runner.ts         # Existing — API agent execution engine
├── orchestrator.ts   # MODIFIED — delegation tool execute functions get USE_CLI_AGENTS conditionals
├── writer.ts         # MODIFIED — writerTools execute functions get USE_CLI_AGENTS conditionals
├── research.ts       # MODIFIED — researchTools execute functions (if applicable)
├── leads.ts          # MODIFIED — leadsTools execute functions
├── types.ts          # Unchanged
├── load-rules.ts     # Unchanged
└── utils.ts          # OPTIONALLY MODIFIED — add isCliMode() helper
```

### Pattern 1: cli-spawn.ts Implementation

**What:** Thin async wrapper around `child_process.spawn` that runs a compiled dist/cli script, buffers stdout, enforces timeout, and parses the JSON envelope.
**When to use:** Called from tool execute functions when `USE_CLI_AGENTS === 'true'`

```typescript
// src/lib/agents/cli-spawn.ts
import { spawn } from "child_process";
import { join } from "path";

const CLI_TIMEOUT_MS = 300_000; // 300s — matches chat route maxDuration

export interface CliEnvelope<T = unknown> {
  ok: true;
  data: T;
}

type CliResult<T> = T;

export async function cliSpawn<T = unknown>(
  scriptName: string,
  args: string[] = []
): Promise<CliResult<T>> {
  const scriptPath = join(
    process.env.PROJECT_ROOT ?? process.cwd(),
    "dist",
    "cli",
    scriptName
  );

  return new Promise<CliResult<T>>((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, CLI_TIMEOUT_MS);

    const child = spawn("node", [scriptPath, ...args], {
      signal: controller.signal,
      env: { ...process.env },
    });

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));

    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(chunks).toString("utf-8").trim();

      try {
        const envelope = JSON.parse(stdout) as { ok: boolean; data?: T; error?: string };
        if (envelope.ok) {
          resolve(envelope.data as T);
        } else {
          reject(new Error(envelope.error ?? `CLI script exited with code ${code}`));
        }
      } catch {
        reject(new Error(`CLI script produced invalid JSON. Exit code: ${code}. Stderr: ${Buffer.concat(errChunks).toString("utf-8").slice(0, 500)}`));
      }
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.name === "AbortError" || controller.signal.aborted) {
        reject(new Error(`CLI script timed out after 300s: ${scriptName}`));
      } else {
        reject(err);
      }
    });
  });
}
```

**Key details:**
- `scriptPath` resolves via `PROJECT_ROOT` env var — same pattern as `load-rules.ts`, already established in Phase 48
- `env: { ...process.env }` inherits all env vars (DATABASE_URL, ANTHROPIC_API_KEY, etc.) without manual forwarding
- AbortController signals the child process on timeout; `child.on("error")` catches the resulting AbortError
- stderr buffered but only used for diagnostics in the error message, not for normal output

### Pattern 2: Tool-Level Flag Check

**What:** Each delegation tool's `execute` function checks `USE_CLI_AGENTS` and routes to CLI or inline.
**When to use:** Applied to all 4 delegation tools in orchestrator.ts, and optionally to individual writerTools/researchTools/etc.

The scope decision (CONTEXT.md) says to check at the tool level. For the delegation tools, the most practical approach is to check in the `execute` of `delegateToWriter`, `delegateToResearch`, `delegateToLeads`, `delegateToCampaign` — these are the entry points that call `runWriterAgent()` etc.

**Wrapper approach (recommended for DRY):**

```typescript
// src/lib/agents/utils.ts — add this helper
export function isCliMode(): boolean {
  return process.env.USE_CLI_AGENTS === "true";
}
```

**Delegation tool pattern:**

```typescript
// In orchestrator.ts — delegateToWriter execute function
execute: async ({ workspaceSlug, task, channel, campaignName, campaignId, feedback, copyStrategy, customStrategyPrompt, signalContext }) => {
  if (isCliMode()) {
    // Route to CLI script — writer agent is the primary CLI skill
    // The CLI scripts for writer tasks require workspaceSlug + a task description
    // Write task args to /tmp JSON file (matching the json-file input pattern from Phase 48)
    const { writeFileSync } = await import("fs");
    const { randomUUID } = await import("crypto");
    const tmpFile = `/tmp/${randomUUID()}.json`;
    writeFileSync(tmpFile, JSON.stringify({ workspaceSlug, task, channel, campaignName, campaignId, feedback, copyStrategy, customStrategyPrompt, signalContext }));

    try {
      const data = await cliSpawn("save-sequence.js", ["--file", tmpFile]);
      return { status: "complete", ...data };
    } catch (error) {
      return { status: "failed", error: error instanceof Error ? error.message : "CLI writer failed" };
    }
  }

  // Existing inline path (unchanged)
  try {
    const result = await runWriterAgent({ workspaceSlug, task, ... });
    return { status: "complete", ... };
  } catch (error) { ... }
}
```

**IMPORTANT NOTE:** The CLI scripts in `dist/cli/` are tool-level atomic operations (save-sequence, workspace-intelligence, etc.), NOT full agent runners. The writer CLI skill is a Claude Code skill that *uses* those scripts as tools — it is not itself a compiled script. The bridge therefore cannot directly `cliSpawn("writer-agent.js")` because no such compiled script exists.

This is the key architectural insight: **the CLI path for Phase 50 routes the tool function's work to individual CLI scripts, not to a monolithic agent runner.** Each delegation tool's execute function calls the appropriate `dist/cli/*.js` scripts directly (possibly multiple in sequence), mirroring what the CLI skill does but in a programmatic rather than conversational way.

**Revised understanding of scope:** BRG-01 says "delegates to CLI agents" — in context, this means the tool functions call the same `dist/cli/*.js` scripts the CLI skills use. The tool execute functions already know what operations to perform; they gain the ability to run them via subprocess instead of in-process DB calls.

### Anti-Patterns to Avoid

- **Trying to spawn a CLI-based agent runner:** No `nova-writer.js` compiled script exists and none should be created. The CLI skills are conversational prompts, not executables. The bridge calls atomic `dist/cli/*.js` scripts directly.
- **Passing secrets via args:** Never pass `DATABASE_URL`, `ANTHROPIC_API_KEY` etc. as command-line args. Inherit via `env: { ...process.env }` (already demonstrated in the spawn pattern above).
- **Buffering to string before exit:** Collect chunks as Buffers, concatenate at close, then `.toString()`. Collecting as strings can corrupt multi-byte characters.
- **forgetting PROJECT_ROOT in Vercel:** Vercel serverless functions have a different working directory. `process.env.PROJECT_ROOT` must be set via Vercel env vars for the scriptPath resolution to work correctly at runtime. For local dev, `process.cwd()` works.
- **Not forwarding env to subprocess:** `spawn('node', [...])` without an `env` option gives the child an empty environment. Always use `env: { ...process.env }`.
- **stderr-only error detection:** The CLI harness always writes a JSON envelope to stdout even on error. Do not use stderr presence as an error signal. Parse the JSON envelope on stdout.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Subprocess execution | Custom exec wrapper with raw string parsing | `child_process.spawn` with JSON envelope from existing harness | Harness already sanitizes output and formats errors — trust it |
| Timeout management | `setTimeout` + manual PID kill | `AbortController` + `signal` option to `spawn` | Cleaner signal propagation; AbortError is detectable by name |
| Arg serialization for complex inputs | Custom encoding/escaping | Existing `/tmp/{uuid}.json` file pattern from Phase 48-02 | Already proven; avoids shell escaping issues with quotes, brackets, etc. |
| Per-script routing logic | Large switch/case mapping scripts to agent functions | Direct `cliSpawn(scriptName, args)` call in each tool | Tools already know which script to call; no indirection needed |

**Key insight:** The JSON envelope pattern from `_cli-harness.ts` is the contract. `{ ok: true, data }` and `{ ok: false, error }` are reliable. Parse once, throw on error.

## Common Pitfalls

### Pitfall 1: Vercel Runtime Missing dist/cli/
**What goes wrong:** `dist/cli/` is a build artifact — if it's gitignored or not deployed with the Next.js build, the subprocess call fails with ENOENT.
**Why it happens:** `tsup` output in `dist/` may be excluded from Vercel deployments if `.vercelignore` or the build config doesn't include it.
**How to avoid:** Verify `dist/cli/` is NOT in `.gitignore` and NOT in `.vercelignore`. The `build:cli` script must run as part of Vercel build or the files must be committed. Check if current deployment already has `dist/cli/` files available.
**Warning signs:** `ENOENT: no such file or directory, dist/cli/workspace-get.js` in Vercel function logs.

### Pitfall 2: process.cwd() Mismatch in Serverless
**What goes wrong:** `process.cwd()` in Vercel serverless is `/var/task` (or similar), not the project root. The `scriptPath` resolves to `/var/task/dist/cli/script.js` which may not exist.
**Why it happens:** Vercel changes the working directory for serverless function execution.
**How to avoid:** Set `PROJECT_ROOT` as a Vercel env var pointing to the correct path. Alternatively, use `__dirname`-based resolution from `src/lib/agents/cli-spawn.ts` since `__dirname` in compiled Next.js points to `.next/server/` — test carefully.
**Warning signs:** Works locally, fails in Vercel production.

### Pitfall 3: stdin Handling
**What goes wrong:** Some Node.js processes wait on stdin if it's inherited. The child process hangs indefinitely.
**Why it happens:** Default `spawn` options inherit stdin from parent.
**How to avoid:** Pass `stdio: ['ignore', 'pipe', 'pipe']` to spawn — explicitly close stdin. All CLI scripts read from argv and files, not stdin, so this is safe.

### Pitfall 4: Large stdout Buffers
**What goes wrong:** Scripts that return large datasets (e.g. people-search with hundreds of records) can produce multi-MB JSON. Buffering all of it in memory before parsing is fine at scale but good to be aware of.
**Why it happens:** All output is buffered into `chunks[]` before parsing.
**How to avoid:** For this phase the concern is minimal — the scripts already sanitize and limit output. No need to stream-parse JSON. Flag if scripts start returning >10MB.

### Pitfall 5: AbortController/Signal Support
**What goes wrong:** Node 18+ is required for `spawn` with `signal` option. Older Node may silently ignore it or throw.
**Why it happens:** `signal` option was added in Node 15.x.
**How to avoid:** Project already runs on Node 18+ (Vercel default). Confirm with `node --version` in build output if uncertain.

### Pitfall 6: Tool Scope Confusion (writer "delegation" vs atomic CLI call)
**What goes wrong:** Treating `delegateToWriter` as a single CLI spawn when the writer agent in CLI mode is an interactive conversation, not a compiled script. Trying to call `node dist/cli/nova-writer.js` which does not exist.
**Why it happens:** The naming "delegate to writer" implies routing to an agent, but the CLI skills are prompts not executables.
**How to avoid:** The bridge calls individual atomic `dist/cli/*.js` scripts (e.g. `workspace-intelligence.js`, `save-sequence.js`) that the tool function already calls inline. The "delegation" is to the scripts, not to a conversational agent runner.

## Code Examples

Verified patterns from official sources:

### spawn with AbortController timeout
```typescript
// Pattern confirmed against Node.js 18+ docs
// Source: https://nodejs.org/api/child_process.html#child_processspawncommand-args-options

import { spawn } from "child_process";

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 300_000);

const child = spawn("node", ["dist/cli/script.js", "--arg", "value"], {
  signal: controller.signal,
  env: { ...process.env },
  stdio: ["ignore", "pipe", "pipe"],
});

child.on("error", (err: NodeJS.ErrnoException) => {
  clearTimeout(timer);
  if (controller.signal.aborted) {
    // timeout case
  }
});

child.on("close", (code) => {
  clearTimeout(timer);
  // parse stdout
});
```

### JSON file input pattern (from Phase 48-02, confirmed in codebase)
```typescript
// Pattern: write complex args to /tmp file, pass --file to script
// Used by: campaign-create, signal-campaign-create, discovery-plan, workspace-icp-update, etc.
import { writeFileSync } from "fs";
import { randomUUID } from "crypto";

const tmpFile = `/tmp/${randomUUID()}.json`;
writeFileSync(tmpFile, JSON.stringify(args));
const result = await cliSpawn("campaign-create.js", ["--file", tmpFile]);
```

### Flag check helper
```typescript
// src/lib/agents/utils.ts addition
export function isCliMode(): boolean {
  return process.env.USE_CLI_AGENTS === "true";
}
```

### Existing tool execute pattern (confirmed from orchestrator.ts)
```typescript
// Current pattern in orchestrator.ts delegateToWriter.execute:
execute: async ({ workspaceSlug, task, ... }) => {
  try {
    const result = await runWriterAgent({ workspaceSlug, task, ... });
    return { status: "complete", ... };
  } catch (error) {
    return { status: "failed", error: ... };
  }
}

// After bridge:
execute: async ({ workspaceSlug, task, ... }) => {
  if (isCliMode()) {
    // call dist/cli/*.js scripts directly
  }
  try { /* existing */ } catch { /* existing */ }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| All agent tools run inline (DB + API calls in-process) | Tool functions can route to `dist/cli/*.js` via subprocess when `USE_CLI_AGENTS=true` | Phase 50 | Dashboard becomes a thin orchestration layer; same scripts power both CLI skills and API agents |
| Trigger.dev task queue considered for delegation | Synchronous subprocess in serverless tool call | CONTEXT.md decision | Eliminates queue complexity; 300s serverless timeout is sufficient |

**Deprecated/outdated:**
- STATE.md blocker ("Phase 50 needs Trigger.dev task queue pattern"): resolved by keeping execution synchronous in serverless tool calls. No queue, no polling.

## Open Questions

1. **Does `dist/cli/` deploy to Vercel?**
   - What we know: `dist/cli/` is generated by `npm run build:cli` (tsup), NOT by `next build`
   - What's unclear: Whether `build:cli` runs as part of Vercel deployment, or whether `dist/cli/` files are committed to git
   - Recommendation: Check `.gitignore` for `dist/` entries before implementation. If `dist/` is gitignored, the planner must include a task to either (a) add `dist/cli/` to git, or (b) add `build:cli` to the Vercel build command (`prisma generate && npm run build:cli && next build`).

2. **Which tool functions get the conditional for BRG-01 (writer + orchestrator paths)?**
   - What we know: BRG-01 specifically calls out "writer and orchestrator paths"; BRG-03 extends to all 7 agents
   - What's unclear: Whether BRG-01 means just `delegateToWriter` in orchestrator.ts, or also individual writerTools execute functions (getWorkspaceIntelligence, getCampaignPerformance, etc.)
   - Recommendation: Interpret BRG-01 as the delegation tool level (`delegateToWriter.execute`) — this routes entire writer sessions. Individual writerTools sub-functions don't need the conditional since `runWriterAgent` won't be called via CLI at all in this phase. BRG-03 extends the same delegation-level approach to the other 3 delegation tools.

3. **What does "CLI delegation" return for writer tasks?**
   - What we know: `runWriterAgent` returns a `WriterOutput` with emailSteps, linkedinSteps, etc. The delegation tool's execute formats this for the orchestrator.
   - What's unclear: What a CLI-delegated writer invocation would return — the CLI scripts write to DB (save-sequence.js) and return success/failure, not the full sequence content.
   - Recommendation: For CLI mode, the return value from `delegateToWriter.execute` should be `{ status: "complete", message: "Sequences saved via CLI", campaignId }` — a confirmation rather than the full content. The orchestrator relays this to the user. This is acceptable since the user doesn't use dashboard chat (per CONTEXT.md "The user explicitly said they won't use dashboard chat — this is purely a backup path").

## Sources

### Primary (HIGH confidence)
- `/Users/jjay/programs/outsignal-agents/src/lib/agents/orchestrator.ts` — delegation tool structure, execute function patterns confirmed
- `/Users/jjay/programs/outsignal-agents/src/lib/agents/runner.ts` — AgentRun schema and audit logging confirmed unchanged
- `/Users/jjay/programs/outsignal-agents/scripts/cli/_cli-harness.ts` — JSON envelope contract (`{ ok: true, data }` / `{ ok: false, error }`) confirmed
- `/Users/jjay/programs/outsignal-agents/src/app/api/chat/route.ts` — `maxDuration = 300` confirmed, streaming unchanged
- Node.js 18+ built-in `child_process.spawn` with `signal` option — well-established API, HIGH confidence

### Secondary (MEDIUM confidence)
- `/Users/jjay/programs/outsignal-agents/tsup.cli.config.ts` — confirms `dist/cli/` output directory and CJS format; `dist/` git status not confirmed from this file alone

### Tertiary (LOW confidence)
- Vercel working directory behavior (`process.cwd()` in serverless) — based on training knowledge, not verified against current Vercel docs. Flag as needing local validation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Node.js built-ins, no external deps
- Architecture: HIGH — existing patterns (harness, tool structure, load-rules PROJECT_ROOT) confirmed in codebase
- Pitfalls: MEDIUM-HIGH — dist/cli deployment and Vercel cwd are real risks flagged with LOW confidence on specifics; all other pitfalls are HIGH confidence based on confirmed code patterns

**Research date:** 2026-03-24
**Valid until:** 2026-04-24 (stable domain — Node.js child_process API is stable; expires when Vercel runtime changes)
